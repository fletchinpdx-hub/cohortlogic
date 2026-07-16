-- Fix: public.schools' SELECT policy was scoped `to authenticated using
-- (auth.role() = 'authenticated')` — any signed-up user, any school,
-- approved or not, could read every OTHER school's name/district/state/
-- enabled_products. Same overly-permissive-`authenticated` pattern as the
-- 2026-07-16 contact_submissions/newsletter_subscribers incident; caught
-- by the security-compliance agent's new semantic check.
--
-- Verified safe to tighten: every client call site (dashboard.js,
-- schedule-init.js, school-admin.js) already filters to the caller's own
-- `school_id` — nothing depends on seeing other schools' rows. signup.js
-- never queries `schools` at all (school assignment happens post-signup
-- via the admin panel, not self-selected). Only admin.js needs the full
-- list, and that's already covered by the existing "Admins can manage
-- schools" policy (for all, using is_admin()).
--
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.

drop policy if exists "Authenticated users can view schools" on public.schools;

create policy "Own school or admin can view schools"
  on public.schools for select
  using (public.is_admin() or id = public.my_school_id());
