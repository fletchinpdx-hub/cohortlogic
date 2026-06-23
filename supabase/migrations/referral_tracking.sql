-- ============================================================================
-- referral_tracking.sql  —  Phase 1 of Referral Tracking (Tier 1 Behavior Tracker)
-- ============================================================================
-- Adds the "Referral Tracking" product. Mirrors the CICO conventions:
--   * everything school-scoped via public.my_school_id()
--   * config + record tables gated on public.can_access_product('referrals')
--   * super admin (public.is_admin()) bypasses
--
-- The student roster is SHARED with CICO: cico_students is renamed to `students`
-- so both products read one roster. The existing CICO roster RLS policy is
-- school-scoped only (NOT product-gated), so a referrals-only user can already
-- read/write their school's students — no policy change needed for sharing.
--
-- Default dropdown lists (behaviors, locations, etc.) are seeded per-school by
-- the app on first use (see js/referral-config.js), not here — config tables are
-- multi-tenant and we can't seed for schools that don't exist yet.
--
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent guards).
-- ============================================================================

begin;

-- ── 1. Shared student roster ────────────────────────────────────────────────
-- Rename in place: preserves data, the cico_checkins FK, indexes, and the RLS
-- policy. No data movement, no downtime beyond this transaction.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'cico_students')
     and not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'students') then
    alter table public.cico_students rename to students;
    -- The policy travels with the table; rename it so it no longer reads "CICO".
    alter policy "CICO access: students" on public.students rename to "School access: students";
  end if;
end $$;

-- Demographic columns needed by Referral Tracking + the Equity reports
-- (enrollment counts by group). All nullable / defaulted — additive and safe.
alter table public.students
  add column if not exists race_ethnicity text,
  add column if not exists gender         text,
  add column if not exists iep            boolean not null default false;

-- Backward-compat view: already-deployed CICO code still does
-- .from('cico_students') for reads/inserts/updates. A simple SELECT * view is
-- auto-updatable, and security_invoker makes the students RLS apply as the
-- querying user. This lets you run the migration, test, and deploy without an
-- outage window. DROP it once the new code is live (see note at the bottom).
-- (Embedded joins via PostgREST — e.g. CICO's History view — resolve against the
--  real table, so deploy the new code promptly; this view covers the rest.)
create or replace view public.cico_students with (security_invoker = true) as
  select * from public.students;

-- ── 2. Referral config tables (school-scoped, product-gated) ────────────────
-- One shape, five lists. Each row is a selectable option in the referral form.
create table if not exists public.referral_locations (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_behaviors (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_motivations (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_actions (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_others_involved (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 3. Referral records ─────────────────────────────────────────────────────
create table if not exists public.referral_referrals (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id) on delete cascade,
  student_id          uuid not null references public.students(id) on delete restrict,
  referral_type       text not null default 'major'
                        check (referral_type in ('minor','major')),
  -- Reporting / involved staff. Free text in v1; a staff roster comes later.
  referring_staff     text,
  incident_date       date not null,
  incident_time       time,
  location_id         uuid references public.referral_locations(id)        on delete set null,
  behavior_id         uuid references public.referral_behaviors(id)        on delete set null,
  motivation_id       uuid references public.referral_motivations(id)      on delete set null,
  others_involved_id  uuid references public.referral_others_involved(id)  on delete set null,
  action_id           uuid references public.referral_actions(id)          on delete set null,
  seclusion_restraint boolean not null default false,
  notes               text,
  -- Snapshots: grade/IEP as they were at referral time (roster values can change)
  grade_at_referral   text,
  iep_at_referral     boolean,
  reported_by         uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists referral_referrals_school_idx  on public.referral_referrals (school_id);
create index if not exists referral_referrals_student_idx on public.referral_referrals (student_id);
create index if not exists referral_referrals_date_idx    on public.referral_referrals (school_id, incident_date);

-- ── 4. RLS ──────────────────────────────────────────────────────────────────
-- Identical school-scoped + product-gated policy on every referral table.
do $$
declare
  t text;
  tables text[] := array[
    'referral_locations','referral_behaviors','referral_motivations',
    'referral_actions','referral_others_involved','referral_referrals'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Referrals access: %s" on public.%I', t, t);
    execute format($f$
      create policy "Referrals access: %1$s"
        on public.%1$I for all
        using (
          public.is_admin() or
          (public.my_school_id() is not null
           and school_id = public.my_school_id()
           and public.can_access_product('referrals'))
        )
        with check (
          public.is_admin() or
          (public.my_school_id() is not null
           and school_id = public.my_school_id()
           and public.can_access_product('referrals'))
        )
    $f$, t);
  end loop;
end $$;

commit;

-- ── 5. Enable the product for a school (run per school, or via the admin UI) ──
-- The admin / school-admin panels add 'referrals' to schools.enabled_products
-- through set_school_products(). To enable manually for one school:
--   update public.schools
--   set enabled_products = array(select distinct unnest(enabled_products || '{referrals}'))
--   where id = '<SCHOOL_UUID>';
-- (Run via a panel or break-glass; the guard trigger blocks raw profile writes,
--  but schools writes are allowed for super admins.)

-- ── 6. AFTER the new code is deployed: drop the compat view (optional) ────────
--   drop view if exists public.cico_students;
-- Leave it in place if you prefer; it's harmless. Drop it once you've confirmed
-- nothing references cico_students anymore.
