-- Marketing tables: contact form submissions + newsletter subscribers
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New query)

-- ── Contact form submissions ───────────────────────────────────────────────
create table if not exists public.contact_submissions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text,
  email       text not null,
  role        text,
  school      text,
  enrollment  text,
  products    text[],
  timing      text,
  notes       text,
  source      text default 'contact-form'
);

-- Anon INSERT only — no SELECT, no UPDATE, no DELETE from client
alter table public.contact_submissions enable row level security;

create policy "Anon can insert contact submissions"
  on public.contact_submissions
  for insert
  to anon
  with check (true);

-- Authenticated (you, in the admin panel or SQL editor) can read them
create policy "Authenticated can read contact submissions"
  on public.contact_submissions
  for select
  to authenticated
  using (true);


-- ── Newsletter subscribers ─────────────────────────────────────────────────
create table if not exists public.newsletter_subscribers (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  email       text not null,
  source      text default 'resources',
  -- silently ignore duplicate emails
  unique (email)
);

alter table public.newsletter_subscribers enable row level security;

create policy "Anon can subscribe"
  on public.newsletter_subscribers
  for insert
  to anon
  with check (true);

create policy "Authenticated can read subscribers"
  on public.newsletter_subscribers
  for select
  to authenticated
  using (true);
