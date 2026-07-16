# Subscriptions / Billing — build spec

Status: **spec, not yet built.** Hand this to a fresh session to implement.
Migration is written (`supabase/migrations/subscriptions.sql`) but **not yet run**.

## Goal

Manage paid subscriptions from the super-admin panel. Everyone is free today;
billing starts in the next few months. This is a **CRM / record-keeping ledger** —
we record the contract we closed, we do **not** process payments (no Stripe in
scope). Per customer, we track:

- date the contract was agreed (`contract_signed_date`)
- package purchased
- number of licenses (seats) it includes
- renewal date
- the fee we charge
- (future) promo code used + discount amount

## Where it lives

- Subscriptions attach to a **school** (the licensing unit), not a user.
- **One current subscription per school** (unique index on `school_id`). Renewals
  edit the row in place; full change history comes from the `audit_subscriptions`
  trigger → visible in the admin **Audit Log** tab.
- New top-level **"Billing"** tab in the admin nav (`admin/index.html` +
  `admin/admin.js`), placed after "Schools & Users".

## Decisions already made (don't re-litigate unless asked)

- **Money = integer cents.** `fee_cents`, `discount_cents`. Format client-side.
  Net charge = `fee_cents - discount_cents`.
- **In-place edit model** (not a per-term ledger). Audit log = history. The
  unique index enforces one sub per school; drop it if we ever move to term-rows.
- **Billing is decoupled from access.** `schools.enabled_products` stays the
  hand-toggled access switch. A package's product list is only a *prefill hint*
  in the Add form — it must NOT auto-write `enabled_products` in v1. (Coupling is
  a deliberate later decision, so a billing typo can't lock a school out.)
- **No seat enforcement in v1.** Data supports "block the Nth+1 approval" but we
  don't wire it yet.
- **Promo columns exist now, UI is Phase 3.** So we never re-migrate the table.
- USD only (no currency column). Revisit if selling cross-border.

## Data model

See `supabase/migrations/subscriptions.sql` for the authoritative schema. Summary:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `school_id` | uuid fk → schools | `on delete cascade`, unique |
| `status` | text | `trial\|active\|past_due\|cancelled\|expired`, default `active` |
| `package` | text | label from `ADMIN_PLANS` |
| `license_count` | int | ≥ 0 |
| `contract_signed_date` | date | when they agreed |
| `term_start` | date | service start |
| `renewal_date` | date | renewal / term end |
| `billing_period` | text | `annual\|monthly\|custom`, default `annual` |
| `fee_cents` | int | ≥ 0 |
| `promo_code` | text | Phase 3 |
| `discount_cents` | int | ≥ 0, Phase 3 |
| `notes` | text | free notes about the deal |
| `created_at` / `updated_at` | timestamptz | `updated_at` auto-touched by trigger |

**Security:** RLS `for all using (is_super_admin())`. School admins / users get no
policy → zero access, so fees never leak. `audit_subscriptions` trigger reuses
`public.log_audit_event()` for dated old→new history.

## Packages: a JS preset, not a table

Mirror the existing `ADMIN_PRODUCTS` const in `admin.js`:

```js
const ADMIN_PLANS = [
  { key: 'core',     name: 'Core',     defaultFeeCents: 0, defaultLicenses: 10, products: ['cico'] },
  { key: 'pro',      name: 'Pro',      defaultFeeCents: 0, defaultLicenses: 25, products: ['cico','referrals'] },
  { key: 'district', name: 'District', defaultFeeCents: 0, defaultLicenses: 0,  products: ['cico','referrals','schedule_builder'] },
];
```

Picking a package in the Add form **prefills** fee/licenses; every field stays
editable for custom deals. (`defaultFeeCents` are placeholders — set real numbers
when pricing is decided. `products` is display-only in v1 per the decoupling rule.)

## UI — the Billing tab

Follows the tab router already in `admin.js` (`ADMIN_VIEWS`, `showView`,
`_loadedViews`, `gotoView`, hash deep-linking). Add `billing` to `ADMIN_VIEWS`
and a lazy `loadBilling()` dispatched from `loadViewData()`.

**1. Summary strip** (stat-card row, reuse `.stats-grid`/`.stat-card`):
- **ARR** = Σ annualized net fee over `active` subs. Annualize: `annual` → net;
  `monthly` → net × 12; `custom` → treat as annual.
- **MRR** = ARR / 12.
- **Active subscriptions** count.
- **Renewals due (30d)** — count with `renewal_date` within 30 days.
- **Trials** count.

**2. Portfolio list** — one row per school (left-join schools → subscriptions so
schools with no sub still appear):
- school name · package · status badge · **seats used / total** · net fee ·
  renewal date (amber when ≤ 30 days out).
- **Seats used** = approved-profile count for that school. `_allUsersCache` is
  already loaded by the Schools & Users view; either reuse it or count in the
  billing query. Don't add a second heavy fetch if the cache is warm.
- Row action: **Edit** (has sub) or **+ Add subscription** (none).

**3. Add/Edit editor** — reuse the existing modal shell (`#audit-detail-modal`
pattern) since there are ~10 fields. Fields: package (select from `ADMIN_PLANS`,
prefills fee/licenses on change), status, license_count, contract_signed_date,
term_start, renewal_date, billing_period, fee (dollars input → convert to cents
on save), notes. Promo fields omitted in v1. Save = upsert on `school_id`;
Delete = confirm-then-delete row (matches the delete-confirm pattern already used
for schools / pending users).

## CSP + admin.js conventions (must follow)

- **No inline `onclick`/`onchange`** — CSP is `script-src 'self'`. Wire every
  action into the `ADMIN_ACTIONS` map (click) / `ADMIN_CHANGE_ACTIONS` (change),
  dispatched via the existing delegated listeners. Use `data-act` / `data-change`
  + `data-id`.
- **`escAdmin()`** for any interpolated text; it does NOT escape `'`, so never put
  user/free-text into an inline handler — pass only the school/sub UUID and look
  up the rest at render time.
- **Do not touch** `db.auth.onAuthStateChange` (must stay synchronous — see
  CLAUDE.md "Critical constraints") or the MFA gate / inactivity IIFE.
- Money input: collect dollars in the form, `Math.round(dollars * 100)` → cents on
  save; render cents as `(cents/100).toLocaleString('en-US',{style:'currency',currency:'USD'})`.

## Also update

- **Audit Log filter**: add `<option value="subscriptions">subscriptions</option>`
  to `#audit-table-filter` in `admin/index.html` so subscription history is
  filterable alongside the other tables.

## Build order

1. **Migration** — user runs `supabase/migrations/subscriptions.sql` in Supabase.
2. **Billing tab (v1)** — nav button + view, `ADMIN_PLANS`, summary strip,
   portfolio list, add/edit/delete modal, `ADMIN_ACTIONS` wiring, audit-filter
   option. Ship + `bash scripts/deploy.sh`.
3. **Phase 2** — Overview attention/stat cards ("Renewals due 30d", "ARR")
   reusing the overview grid; renewal-soon highlighting/sort; a compact billing
   summary line on each Schools & Users card ("Pro · 25 seats · renews Mar 3 2027").
4. **Phase 3 (later)** — promo code entry + discount math; optional
   package→`enabled_products` automation; optional seat-limit enforcement at
   approval time.

## Deploy / verify

- Deploy only via `bash scripts/deploy.sh` (runs the pre-deploy gate).
- `check-csp.sh` does NOT scan `public/admin/`, so CSP discipline here is
  self-enforced — grep the diff for `onclick=`/`onchange=` before deploying.
- Verify logged in as a super_admin (the `.qa-credentials` account is a
  low-privilege product account and can't see this panel — a human super_admin
  verifies the billing UI).
