# Cohort Logic — Stripe Billing Implementation Plan

**Tracker item:** PR-01 (Phase 1) — also touches PR-09 (pricing)
**Status:** PLAN — design + decisions before the code batch. No code written yet.
**Owner:** Michael Fletcher (+ Claude to implement)
**Last updated:** 2026-07-21 (by Claude)

> You can't charge money without this. This plan wires Stripe into the existing stack (static site on Cloudflare + Supabase) to sell **per-school** subscriptions, and reconciles it with the `subscriptions` table you already have.

---

## 1. What exists today

- **`subscriptions` table** is a **manual CRM ledger** — "captures the contract you closed, NOT payment processing" (status, package, license_count, fee_cents, dates). One row per school. Money in integer cents.
- **Product gating** = `schools.enabled_products[]` (hard master switch) + `can_access_product()`. Class Builder is **never gated**; Schedule Builder is gated on `enabled_products` containing `schedule_builder`.
- **Pricing** (public): per **school** (not per student), annual (monthly option), POs/MSAs for districts, **free through Sept 30 2026**, 60-day change notice, cancel → 60-day export then delete.
- **No payment processor. No backend server** (static assets via Cloudflare; data via Supabase).

## 2. Key decisions to make first (product, not code)

1. **What is paid?** Class Builder is currently ungated/free. Options: (a) keep Class Builder a free funnel and charge for Schedule Builder + future products; or (b) make the **whole per-school subscription** unlock everything and add product gating to Class Builder too. *Recommendation: (b) — a single per-school plan, consistent with your "per school, suite" pricing; add a lightweight product gate to Class Builder.*
2. **Self-serve vs invoiced.** Small schools pay by **card (Stripe Checkout)**; districts often need **PO / invoice**. *Recommendation: support both — Stripe Checkout for card, Stripe Invoicing (or the manual `subscriptions` ledger) for PO deals.*
3. **Plan shape.** One primary per-school annual plan (+ monthly). Suite discount as more products ship. Finalize the number(s) — currently unset (free period).
4. **Trial.** Since it's free through Sept 2026, launch billing in **test mode** now and flip live near the end of the free window, or offer a trial that converts.

## 3. Architecture (fits your stack)

There's no server, so the two server-side pieces run as **Supabase Edge Functions** (Deno; they already hold the DB + service-role, and keep Stripe secrets server-side). *(Cloudflare Workers is a viable alternative if you'd rather keep it all on Cloudflare.)*

```
Browser (dashboard.html / pricing.html)
   │  "Subscribe" → calls Edge Function
   ▼
Supabase Edge Function: create-checkout-session   ── uses STRIPE_SECRET_KEY
   │  returns Stripe Checkout URL → browser redirects to Stripe
   ▼
Stripe Checkout (hosted, PCI handled by Stripe)   ── card entry happens HERE, never on your site
   │  on success → Stripe fires webhook
   ▼
Supabase Edge Function: stripe-webhook            ── verifies signature, writes DB
   │  updates subscriptions + schools.enabled_products
   ▼
can_access_product() gate reflects the new state
```

Self-service management = **Stripe Customer Portal** (upgrade/cancel/update card), launched from a second Edge Function.

## 4. Data model changes (small, additive)

Add Stripe linkage to `subscriptions` (keep the CRM fields):
- `stripe_customer_id text`, `stripe_subscription_id text`, `stripe_price_id text`
- `current_period_end timestamptz` (from Stripe, drives access + renewal surfaces)
- reuse existing `status` (map Stripe statuses → your enum: `trialing→trial`, `active→active`, `past_due→past_due`, `canceled→cancelled`, etc.)

The webhook is the **single writer** of billing state (service-role), so client code never touches subscription/billing columns.

## 5. Gating flow

- On `checkout.session.completed` / `customer.subscription.updated` → set `status`, `current_period_end`, and **add** the paid product(s) to `schools.enabled_products`.
- On `customer.subscription.deleted` / `past_due` beyond grace → **remove** the product(s) (respecting the 60-day export window before data deletion).
- `can_access_product()` already reads `enabled_products`, so the gate needs no change beyond the webhook keeping it in sync. (If Class Builder becomes paid, add a `can_access_product('class_builder')` check to `auth-gate.js` for `app.html`.)

## 6. Security (ties to `13_Secrets_Management.md`)

- **`STRIPE_SECRET_KEY`** and **`STRIPE_WEBHOOK_SIGNING_SECRET`** live in Edge Function env vars (server-side) — **never** in client JS. *(You set these in Supabase; Claude never handles the key values — same rule as the service-role key.)*
- Webhook **verifies the Stripe signature** on every call (reject unsigned/replayed events).
- Only the publishable key (`pk_...`) is ever client-side, used to redirect to Checkout.
- No student data is involved in billing — only school + admin email + payment (handled entirely by Stripe).

## 7. Build steps (the eventual code batch)

1. Create products/prices in the Stripe dashboard (test mode first).
2. Add the Stripe columns to `subscriptions` (migration).
3. Edge Function `create-checkout-session` (auth'd; maps school → Stripe customer).
4. Edge Function `stripe-webhook` (signature-verified; updates subscriptions + enabled_products).
5. Edge Function `create-portal-session` (Customer Portal).
6. UI: a "Subscribe / Manage plan" entry on `dashboard.html` + `pricing.html` wiring; a billing state surface.
7. Admin Billing tab: show Stripe-synced status alongside the manual ledger.
8. Test end-to-end with Stripe **test cards**; then flip to live keys near launch.

## 8. What's needed from you

- The **pricing number(s)** and the decision in §2.1 (what's paid).
- A **Stripe account** + the API keys set as Edge Function secrets (you enter them).
- Confirm **Supabase Edge Functions** as the backend (vs Cloudflare Worker).
