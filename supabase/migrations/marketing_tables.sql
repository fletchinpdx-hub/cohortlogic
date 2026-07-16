-- Marketing tables: contact form submissions + newsletter subscribers
--
-- REVISED 2026-07-16 to match the ACTUAL live schema/policies, which had
-- drifted from the original version of this file:
--   - contact_submissions: `notes` → `message`, `created_at` → `submitted`
--     (nullable, no `not null`), `source` column dropped entirely,
--     `products` is a comma-joined TEXT (see public/js/contact.js —
--     `products.join(', ')`), not a text[] array as originally written.
--   - Both tables' SELECT policies were found scoped `to authenticated
--     using (true)` — any signed-up user, not just admins, could read all
--     rows. Fixed in supabase/migrations/marketing_tables_rls_fix.sql;
--     folded into this file's canonical version below. Also reconciles
--     duplicate policies that had accumulated from concurrent work
--     (functionally redundant, not a vulnerability, just clutter).
--
-- This version is idempotent — safe to re-run any time to reconcile drift
-- back to this state. Run in the Supabase SQL Editor.

-- ── Contact form submissions ───────────────────────────────────────────────
create table if not exists public.contact_submissions (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text not null,
  role        text,
  school      text,
  enrollment  text,
  products    text,  -- comma-joined selected products, not an array — see public/js/contact.js
  timing      text,
  message     text,
  submitted   timestamptz default now()
);

alter table public.contact_submissions enable row level security;

-- Reconcile to exactly one INSERT + one SELECT policy.
drop policy if exists "Anon can insert contact submissions" on public.contact_submissions;
drop policy if exists "Authenticated can read contact submissions" on public.contact_submissions;
drop policy if exists "Admins can read submissions" on public.contact_submissions;
drop policy if exists "Anyone can submit contact form" on public.contact_submissions;
drop policy if exists "Super admins can read contact submissions" on public.contact_submissions;

-- anon + authenticated: a logged-in visitor can submit the contact form too.
create policy "Anyone can submit contact form"
  on public.contact_submissions
  for insert
  to anon, authenticated
  with check (true);

create policy "Super admins can read contact submissions"
  on public.contact_submissions
  for select
  using (public.is_admin());


-- ── Newsletter subscribers ─────────────────────────────────────────────────
-- Schema here already matched live reality — only the SELECT policy needed
-- the same authenticated-read-all fix as contact_submissions.
create table if not exists public.newsletter_subscribers (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  email       text not null,
  source      text default 'resources',
  -- silently ignore duplicate emails
  unique (email)
);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists "Anon can subscribe" on public.newsletter_subscribers;
drop policy if exists "Authenticated can read subscribers" on public.newsletter_subscribers;
drop policy if exists "Super admins can read subscribers" on public.newsletter_subscribers;

create policy "Anon can subscribe"
  on public.newsletter_subscribers
  for insert
  to anon
  with check (true);

create policy "Super admins can read subscribers"
  on public.newsletter_subscribers
  for select
  using (public.is_admin());
