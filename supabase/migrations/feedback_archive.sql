-- Feedback archiving + "needs attention" indicator.
--
-- Adds archived_at so an admin can mark a feedback item handled. Un-archived
-- feedback (archived_at IS NULL) is what the admin dashboard surfaces as
-- "needs attention" / new-to-look-at; archiving is the single "I've dealt with
-- it" action that clears it from the active view and the badge.
--
-- Run this in the Supabase SQL editor (the feedback table was created via the
-- dashboard, not a prior migration file, so this is the first migration for it).
-- Safe to re-run (idempotent).

-- 1. The column. Existing rows stay NULL (= active / needs attention).
alter table public.feedback
  add column if not exists archived_at timestamptz;

-- 2. Index the active set — the dashboard's default query filters archived_at IS NULL.
create index if not exists feedback_active_idx
  on public.feedback (created_at desc)
  where archived_at is null;

-- 3. RLS: allow super-admins to archive/unarchive (UPDATE archived_at).
--    Anon INSERT (feedback widget) and admin SELECT policies already exist;
--    this only adds UPDATE, restricted to admins. public.is_admin() is the
--    existing SECURITY DEFINER helper meaning super_admin.
drop policy if exists "Admins can update feedback" on public.feedback;
create policy "Admins can update feedback"
  on public.feedback for update
  using (public.is_admin())
  with check (public.is_admin());
