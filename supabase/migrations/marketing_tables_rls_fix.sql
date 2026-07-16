-- SUPERSEDED 2026-07-16: marketing_tables.sql was rewritten to be the
-- canonical, idempotent, up-to-date version (this same policy fix, folded
-- in, plus a schema correction and duplicate-policy reconciliation). Kept
-- here only as the historical record of the first fix attempt. Re-run
-- marketing_tables.sql, not this file, if you need to reconcile drift.
--
-- ═══════════════════════════════════════════════════════════════════════
-- Fix: contact_submissions / newsletter_subscribers SELECT policies were
-- scoped `to authenticated using (true)` — the original comment assumed
-- "authenticated" meant "you, the admin", but it actually means ANY
-- signed-in Supabase user. Cohort Logic has open public signup, so any
-- approved-or-not account at any school could read every lead's name,
-- email, role, school, enrollment, and notes, plus every newsletter
-- subscriber's email. Caught by the security-compliance agent's first
-- audit of these (newer, previously untracked) tables.
--
-- Fix: restrict SELECT to super_admin only, matching every other
-- admin-only table in this app (feedback, security_findings, etc).
-- No rows existed when this was found, so nothing has actually leaked.
--
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "Authenticated can read contact submissions" on public.contact_submissions;
create policy "Super admins can read contact submissions"
  on public.contact_submissions for select
  using (public.is_admin());

drop policy if exists "Authenticated can read subscribers" on public.newsletter_subscribers;
create policy "Super admins can read subscribers"
  on public.newsletter_subscribers for select
  using (public.is_admin());
