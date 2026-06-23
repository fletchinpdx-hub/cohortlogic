-- ============================================================================
-- referral_phase4.sql  —  Phase 4 of Referral Tracking
-- ============================================================================
-- Two features:
--   1. Reviewer workflow — a referral can be "sent to a reviewer" (status
--      open → pending_review → reviewed). Per-school default reviewer.
--   2. Custom fields — school-defined extra dropdowns (e.g. Hallway, Parent
--      Contact, Technology Violation), with their own option lists. Selections
--      are stored as jsonb on the referral: { "<field_id>": "<option_id>" }.
--
-- Same conventions as referral_tracking.sql: school-scoped, product-gated on
-- can_access_product('referrals'), super admin (is_admin()) bypasses.
--
-- Run once in the Supabase SQL editor. Idempotent. (The static analyzer can't
-- see the dynamic RLS in the DO block — choose "Run without RLS"; this script
-- enables RLS itself, same as the Phase 1 migration.)
-- ============================================================================

begin;

-- ── 1. Reviewer workflow columns on referral_referrals ──────────────────────
alter table public.referral_referrals
  add column if not exists status        text not null default 'open'
                             check (status in ('open','pending_review','reviewed')),
  add column if not exists reviewed_by    uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at    timestamptz,
  add column if not exists reviewer_notes text,
  -- Custom field selections: { "<field_id>": "<option_id>" }
  add column if not exists custom_values  jsonb not null default '{}'::jsonb;

create index if not exists referral_referrals_status_idx
  on public.referral_referrals (school_id, status);

-- ── 2. Per-school referral settings (default reviewer) ──────────────────────
create table if not exists public.referral_settings (
  school_id           uuid primary key references public.schools(id) on delete cascade,
  default_reviewer_id uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);

-- ── 3. Custom field definitions + their options ─────────────────────────────
create table if not exists public.referral_custom_fields (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  label      text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_custom_field_options (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete cascade,
  field_id   uuid not null references public.referral_custom_fields(id) on delete cascade,
  label      text not null,
  sort_order int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists referral_custom_field_options_field_idx
  on public.referral_custom_field_options (field_id);

-- ── 4. RLS — same school-scoped + product-gated policy as the other tables ──
do $$
declare
  t text;
  tables text[] := array[
    'referral_settings','referral_custom_fields','referral_custom_field_options'
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
