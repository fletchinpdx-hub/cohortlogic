-- ============================================================================
-- subscriptions.sql — school subscription / billing records (super-admin only)
-- ============================================================================
-- One current subscription per school. This is a CRM / record-keeping ledger:
-- it captures the contract you closed (package, seats, fee, dates), NOT payment
-- processing. Fees are visible to super admins only.
--
-- Depends on:
--   * public.schools                (ferpa_compliance.sql)
--   * public.is_super_admin()       (school_admin_roles.sql)
--   * public.log_audit_event()      (ferpa_compliance.sql) — reused for history
--
-- Money is stored as INTEGER CENTS. Never store money as float/numeric dollars.
-- Actual charge = fee_cents - discount_cents.
-- ============================================================================

create table if not exists public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools(id) on delete cascade,

  -- Lifecycle. 'cancelled'/'expired' can't be derived from dates alone, so the
  -- status is explicit. Default 'active' for a freshly recorded contract.
  status               text not null default 'active'
                       check (status in ('trial','active','past_due','cancelled','expired')),

  -- Package label from the ADMIN_PLANS preset in admin.js (e.g. 'Core','Pro',
  -- 'District'). Free text on purpose — the actual agreed terms below win over
  -- any package default, so custom/negotiated deals are representable.
  package              text not null,
  license_count        integer not null default 0 check (license_count >= 0),

  -- Dates. contract_signed_date = when the customer agreed; renewal_date = next
  -- renewal / term end (drives the "renewals due" surfaces in the admin).
  contract_signed_date date,
  term_start           date,
  renewal_date         date,

  billing_period       text not null default 'annual'
                       check (billing_period in ('annual','monthly','custom')),
  fee_cents            integer not null default 0 check (fee_cents >= 0),

  -- Promo support ships as columns now (so we never re-migrate) but the admin
  -- UI for it is Phase 3. discount_cents is a snapshot of the applied discount
  -- at purchase time, independent of any future promo_codes definition.
  promo_code           text,
  discount_cents       integer not null default 0 check (discount_cents >= 0),

  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- One current subscription per school (in-place edit model; history lives in the
-- audit_log via the trigger below). Drop this unique index if you later move to
-- a per-term ledger (multiple rows per school).
create unique index if not exists subscriptions_school_id_uniq
  on public.subscriptions(school_id);

create index if not exists subscriptions_renewal_date_idx
  on public.subscriptions(renewal_date);

-- Keep updated_at honest on every write.
create or replace function public.touch_subscription_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_subscription_updated_at();

-- ── RLS: super admin only ───────────────────────────────────────────────────
-- No policy for school_admin / user = zero access. Fees never leak below super.
alter table public.subscriptions enable row level security;

drop policy if exists "super admin manages subscriptions" on public.subscriptions;
create policy "super admin manages subscriptions" on public.subscriptions
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ── Audit history ───────────────────────────────────────────────────────────
-- Reuse the FERPA audit trigger so every price/renewal/status change lands in
-- audit_log with a dated old->new diff, viewable in the admin Audit Log tab.
drop trigger if exists audit_subscriptions on public.subscriptions;
create trigger audit_subscriptions
  after insert or update or delete on public.subscriptions
  for each row execute function public.log_audit_event();
