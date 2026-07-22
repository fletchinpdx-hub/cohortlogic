-- ============================================================================
-- stripe_billing.sql — link the subscriptions ledger to Stripe (payment processing)
-- ============================================================================
-- Additive and idempotent. Safe to run once in the Supabase SQL editor.
-- Depends on: subscriptions.sql (public.subscriptions).
--
-- The subscriptions table stays the source of truth for the *contract* (package,
-- fee, dates). These columns add the Stripe linkage so a webhook can keep billing
-- state (status, period end) in sync. The Stripe webhook (a Supabase Edge Function
-- running with the service-role key) is the ONLY writer of these columns; client
-- code never touches them. The existing status check already covers Stripe's
-- lifecycle once mapped: trialing->trial, active->active, past_due->past_due,
-- canceled->cancelled, unpaid/incomplete_expired->expired.
-- ============================================================================

alter table public.subscriptions
  add column if not exists stripe_customer_id      text,
  add column if not exists stripe_subscription_id  text,
  add column if not exists stripe_price_id         text,
  add column if not exists current_period_end      timestamptz,
  add column if not exists cancel_at_period_end    boolean not null default false;

-- One Stripe customer / subscription maps to at most one school row.
create unique index if not exists subscriptions_stripe_customer_uniq
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists subscriptions_stripe_subscription_uniq
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

comment on column public.subscriptions.stripe_customer_id     is 'Stripe Customer id (cus_...) for this school; set by the billing webhook.';
comment on column public.subscriptions.stripe_subscription_id is 'Stripe Subscription id (sub_...); the webhook is the single writer.';
comment on column public.subscriptions.stripe_price_id        is 'Stripe Price id (price_...) the school is subscribed to.';
comment on column public.subscriptions.current_period_end     is 'End of the current paid period, from Stripe; drives access + renewal surfaces.';
comment on column public.subscriptions.cancel_at_period_end   is 'True when the school has cancelled but the paid period has not yet ended.';

-- RLS: subscriptions remains super-admin-only for reads/writes (subscriptions.sql).
-- The webhook uses the service-role key and bypasses RLS, so no policy change is
-- needed here. If/when a school admin needs to SEE their own billing status in the
-- app, add a narrow SELECT policy scoped to my_school_id() in a later migration
-- (do NOT expose the Stripe ids to the client — select only status/period).
