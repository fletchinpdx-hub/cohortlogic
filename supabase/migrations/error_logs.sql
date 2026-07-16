-- error_logs — client-side error capture, referenced/coded against since
-- early on (public/js/supabase-config.js:logError(), public/admin/admin.js
-- Overview error-count card + Logs → Errors tab) but the table itself was
-- never actually created. Error logging has been silently no-op-ing this
-- whole time (logError()'s insert fails and is swallowed by its own
-- try/catch); the admin Errors tab has been erroring on every load.
--
-- Column shape matches exactly what logError() inserts and loadErrors()
-- reads in admin.js — see those two call sites if this ever needs to change.
--
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.

create table if not exists public.error_logs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  product     text,
  error_type  text,
  message     text,
  url         text,
  browser     text,
  user_email  text
);

alter table public.error_logs enable row level security;

drop policy if exists "Anyone can insert error logs" on public.error_logs;
drop policy if exists "Super admins can read error logs" on public.error_logs;

-- anon + authenticated: an error can happen on any page, logged in or not —
-- matches the sessions/events analytics tables' INSERT policy shape.
create policy "Anyone can insert error logs"
  on public.error_logs
  for insert
  to anon, authenticated
  with check (true);

-- Admin-only read: message/url can carry PII fragments, and user_email is
-- direct PII — same admin-only pattern as feedback/contact_submissions.
create policy "Super admins can read error logs"
  on public.error_logs
  for select
  using (public.is_admin());
