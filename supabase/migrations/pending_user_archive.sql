-- Archive support for pending (unapproved) users in the super-admin queue.
--
-- Adds archived_at so a super admin can dismiss a junk/duplicate/mistaken
-- signup from the Approvals queue without deleting the account outright.
-- Mirrors the feedback_archive.sql pattern (see that file). Un-archived
-- pending users (archived_at IS NULL) are what the queue shows by default;
-- archived ones move to a "Show archived" toggle with Restore + Delete.
--
-- No new RLS policy needed: admins already have broad UPDATE and DELETE
-- rights on public.profiles (granted directly via the Supabase SQL editor,
-- not a migration file — see CLAUDE.md "SQL changes run directly").
--
-- Run this in the Supabase SQL editor. Safe to re-run (idempotent).

alter table public.profiles
  add column if not exists archived_at timestamptz;

-- Index the active pending set — the approvals query filters
-- approved = false AND archived_at IS NULL.
create index if not exists profiles_pending_active_idx
  on public.profiles (created_at)
  where approved = false and archived_at is null;
