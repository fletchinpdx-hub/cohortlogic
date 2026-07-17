-- ═══════════════════════════════════════════════════════════════════════
-- Cohort Logic — Security & Compliance Agent: findings store
--
-- Backs a daily scheduled agent that checks deploy exposure, RLS posture,
-- credential/MFA rotation, and FERPA compliance items, then reports into
-- the super-admin dashboard's Security tab.
--
--   • security_runs      — one row per agent run (dashboard heartbeat)
--   • security_findings  — upserted per check_id; still-failing checks
--                           update last_seen, now-passing checks resolve
--
-- RLS: super-admin READ only (is_admin()). No client INSERT/UPDATE/DELETE
-- policy on either table — all writes come from the agent's service-role
-- key, which bypasses RLS entirely. The publishable key used by every
-- other client in this app can never read or write findings directly;
-- dashboard mutation goes only through set_finding_status() below.
--
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────
-- PART 1: Tables
-- ─────────────────────────────────────────────────────────────────────

create table if not exists public.security_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  checks_run    int,
  findings_open int,
  ok            boolean,
  agent_version text
);

create table if not exists public.security_findings (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid references public.security_runs(id) on delete set null,
  check_id    text not null,
  category    text not null check (category in ('deploy_exposure', 'rls_audit', 'credential_mfa', 'ferpa_privacy')),
  severity    text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  status      text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  title       text not null,
  detail      text,
  evidence    jsonb not null default '{}'::jsonb,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  resolved_at timestamptz
);

-- One open/acknowledged row per check_id — the agent upserts against this.
create unique index if not exists security_findings_check_id_active_idx
  on public.security_findings (check_id)
  where status in ('open', 'acknowledged');

create index if not exists security_findings_run_id_idx on public.security_findings (run_id);
create index if not exists security_findings_status_idx on public.security_findings (status);


-- ─────────────────────────────────────────────────────────────────────
-- PART 2: RLS — super-admin read only, no client writes
-- ─────────────────────────────────────────────────────────────────────

alter table public.security_runs enable row level security;
alter table public.security_findings enable row level security;

drop policy if exists "Super admins can view security runs" on public.security_runs;
create policy "Super admins can view security runs"
  on public.security_runs for select
  using (public.is_admin());

drop policy if exists "Super admins can view security findings" on public.security_findings;
create policy "Super admins can view security findings"
  on public.security_findings for select
  using (public.is_admin());

-- Deliberately no INSERT/UPDATE/DELETE policies here. The agent writes via
-- the service-role key (bypasses RLS); dashboard mutation is via the RPC
-- below only, which re-checks is_admin() itself.


-- ─────────────────────────────────────────────────────────────────────
-- PART 3: Dashboard acknowledge/resolve RPC (SECURITY DEFINER)
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.set_finding_status(p_finding_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('open', 'acknowledged', 'resolved') then
    raise exception 'Invalid status: % (expected open | acknowledged | resolved)', p_status;
  end if;

  update public.security_findings
     set status      = p_status,
         resolved_at = case when p_status = 'resolved' then now() else null end
   where id = p_finding_id;
end; $$;

grant execute on function public.set_finding_status(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────
-- PART 4: Agent write path (service_role only)
--
-- security_runs/security_findings have no INSERT/UPDATE policies for
-- anon/authenticated, but Supabase's service_role carries BYPASSRLS, so
-- the agent can INSERT/UPDATE security_runs directly via REST with its
-- service-role key (open a run row, then PATCH it closed at the end).
--
-- Findings use these two RPCs instead of raw REST upsert: the "one open
-- row per check_id" rule is a PARTIAL unique index (only rows with
-- status in open/acknowledged), and Postgres's ON CONFLICT inference
-- can't target a partial index from PostgREST's on_conflict= param —
-- so upsert/resolve logic lives here instead of relying on ON CONFLICT.
-- ─────────────────────────────────────────────────────────────────────

-- Report one check's result. If an open/acknowledged finding already
-- exists for this check_id, refresh it in place (last_seen bump) rather
-- than creating a duplicate; otherwise insert a new open finding.
create or replace function public.security_report_finding(
  p_run_id   uuid,
  p_check_id text,
  p_category text,
  p_severity text,
  p_title    text,
  p_detail   text,
  p_evidence jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  existing_id uuid;
begin
  select id into existing_id
    from public.security_findings
   where check_id = p_check_id and status in ('open', 'acknowledged')
   limit 1;

  if existing_id is not null then
    update public.security_findings
       set run_id = p_run_id, category = p_category, severity = p_severity,
           title = p_title, detail = p_detail, evidence = p_evidence, last_seen = now()
     where id = existing_id;
  else
    insert into public.security_findings
      (run_id, check_id, category, severity, title, detail, evidence)
    values (p_run_id, p_check_id, p_category, p_severity, p_title, p_detail, p_evidence);
  end if;
end; $$;

-- Resolve any currently-open/acknowledged finding whose check_id was
-- evaluated this run (p_all_check_ids) but did NOT fail (not present in
-- p_failing_check_ids). Findings for checks that weren't run at all this
-- pass are left untouched — absence of evidence isn't evidence of a fix.
create or replace function public.security_resolve_passing(
  p_all_check_ids     text[],
  p_failing_check_ids text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.security_findings
     set status = 'resolved', resolved_at = now()
   where status in ('open', 'acknowledged')
     and check_id = any(p_all_check_ids)
     and not (check_id = any(p_failing_check_ids));
end; $$;

revoke execute on function public.security_report_finding(uuid, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.security_resolve_passing(text[], text[]) from public, anon, authenticated;
grant execute on function public.security_report_finding(uuid, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.security_resolve_passing(text[], text[]) to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- PART 5: RLS/policy snapshot for the RLS-audit check (service_role only)
--
-- PostgREST doesn't expose pg_catalog as a queryable table, so the RLS
-- audit needs a purpose-built RPC rather than a raw pg_policies query.
-- Locked to service_role — this reveals security posture and must never
-- be callable by a regular authenticated user, including super admins
-- through the client (the dashboard reads findings, not this).
--
-- v2: also returns each policy's full definition (qual / with_check /
-- roles / cmd) as a `policies` jsonb array, so the overly-permissive check
-- inspects real policy BODIES for every table instead of grepping migration
-- files — the old approach was blind to any policy authored directly in the
-- SQL Editor (profiles/features/feedback/sessions/events). This makes the
-- service_role lock even more important: the return value now includes the
-- literal USING / WITH CHECK expressions, not just policy names.
-- ─────────────────────────────────────────────────────────────────────

-- DROP first: v2 changed the return signature (added the `policies` column),
-- and create-or-replace cannot change an existing function's return type
-- (Postgres 42P13). `if exists` keeps this block re-runnable.
drop function if exists public.security_rls_snapshot();

create function public.security_rls_snapshot()
returns table(
  table_name   text,
  rls_enabled  boolean,
  policy_count int,
  policy_names text[],
  policies     jsonb
)
language sql stable security definer set search_path = public as $$
  select
    c.relname::text as table_name,
    c.relrowsecurity as rls_enabled,
    count(p.policyname)::int as policy_count,
    coalesce(array_agg(p.policyname) filter (where p.policyname is not null), '{}') as policy_names,
    -- Full per-policy detail for the semantic overly-permissive check.
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'name',       p.policyname,
          'cmd',        p.cmd,
          'permissive', p.permissive,
          'roles',      p.roles,
          'qual',       p.qual,
          'with_check', p.with_check
        ) order by p.policyname
      ) filter (where p.policyname is not null),
      '[]'::jsonb
    ) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
  where c.relkind = 'r'  -- ordinary tables only; views (e.g. the cico_students compat
                         -- shim over students) always report relrowsecurity=false and
                         -- would otherwise show as a false "RLS disabled" critical
  and c.relname in (
    'profiles', 'schools', 'students', 'cico_checkins',
    'cico_period_scores', 'cico_incidents', 'cico_settings', 'cico_categories',
    'cico_incident_types', 'referral_referrals', 'referral_locations',
    'referral_behaviors', 'referral_motivations', 'referral_actions',
    'referral_others_involved', 'referral_custom_fields', 'referral_custom_field_options',
    'referral_settings', 'audit_log', 'sessions', 'events', 'features',
    'security_runs', 'security_findings', 'contact_submissions', 'newsletter_subscribers',
    'feedback', 'subscriptions', 'error_logs'
  )
  group by c.relname, c.relrowsecurity
$$;

revoke execute on function public.security_rls_snapshot() from public, anon, authenticated;
grant execute on function public.security_rls_snapshot() to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- Done. security_runs/security_findings are readable only by super_admin
-- via RLS. All writes — the run row, per-check upserts, and RLS
-- introspection — happen through the agent's service-role key, which
-- either bypasses RLS directly (security_runs) or calls a
-- service_role-only RPC (findings upsert/resolve, RLS snapshot).
-- ─────────────────────────────────────────────────────────────────────
