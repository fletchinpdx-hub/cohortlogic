-- ============================================================================
-- entitlements.sql — trial/tier fields + a SAFE client read path for access gating
-- ============================================================================
-- Additive and idempotent. Safe to run once in the Supabase SQL editor.
-- Depends on: subscriptions.sql (public.subscriptions), stripe_billing.sql,
--             ferpa_compliance.sql (profiles.school_id), school_admin_roles.sql.
--
-- WHY an RPC instead of a SELECT policy: subscriptions stays super-admin-only so
-- fees / Stripe ids never leak to the client. my_entitlement() is SECURITY DEFINER
-- and returns ONLY the access-relevant fields for the CALLER's own school. This is
-- the "narrow read path" the stripe_billing.sql comment anticipated.
-- ============================================================================

-- Structural tier (drives seats + billing; the free-text `package` stays the
-- marketing label). Individual = a 1-seat school; School = default 5 seats;
-- District provisions member schools, each with its OWN school-level row.
alter table public.subscriptions
  add column if not exists tier text not null default 'individual'
    check (tier in ('individual','school','district')),
  -- Explicit trial clock. Distinct from renewal_date (paid-term end). When status
  -- is 'trial' and now() >= trial_ends_at, access is a HARD lockout.
  add column if not exists trial_ends_at timestamptz;

comment on column public.subscriptions.tier          is 'individual | school | district — structural plan tier (seats/billing).';
comment on column public.subscriptions.trial_ends_at is 'When a time-limited trial locks out (default 60 days from trial start). NULL = no clock.';

-- ── my_entitlement(): the ONLY thing the client reads for access gating ──────
-- Returns the caller's derived access, resolved from THEIR school's subscription.
-- A district-provisioned school has its own row, so resolution is always
-- user -> profiles.school_id -> subscriptions. No fees, no Stripe ids exposed.
--   access: 'full'    -> paid, no gating
--           'trial'   -> limited (trial grade only, no export/print/save)
--           'expired' -> trial ended -> hard lockout
create or replace function public.my_entitlement()
returns table (access text, tier text, status text, trial_ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  sid uuid;
  sub public.subscriptions%rowtype;
begin
  -- The operator (super admin) is never gated — they run the business, not a trial.
  if public.is_super_admin() then
    return query select 'full'::text, 'district'::text, 'active'::text, null::timestamptz;
    return;
  end if;

  select school_id into sid from public.profiles where id = auth.uid();

  -- No school yet, or no subscription row → treat as an un-started trial: the
  -- limited experience is usable, but NOT expired (we never lock someone out by
  -- accident; a super admin starts the 60-day clock explicitly).
  if sid is null then
    return query select 'trial'::text, 'individual'::text, 'trial'::text, null::timestamptz;
    return;
  end if;

  select * into sub from public.subscriptions where school_id = sid;
  if not found then
    return query select 'trial'::text, 'individual'::text, 'trial'::text, null::timestamptz;
    return;
  end if;

  return query select
    case
      when sub.status = 'active' then 'full'
      when sub.status = 'trial'
           and (sub.trial_ends_at is null or sub.trial_ends_at > now()) then 'trial'
      when sub.status = 'trial' then 'expired'   -- trial past its end date
      else 'expired'                              -- past_due / cancelled / expired
    end,
    sub.tier,
    sub.status,
    sub.trial_ends_at;
end;
$$;

grant execute on function public.my_entitlement() to authenticated;
