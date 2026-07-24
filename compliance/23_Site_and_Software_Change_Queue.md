# Cohort Logic — Site & Software Change Queue

**Purpose:** the single running list of website/code edits that the compliance review generates, so they can be **batched into one deploy** instead of shipped piecemeal. Compliance-doc edits (the `.md`/`.docx` in this folder) are NOT tracked here — those get applied as we go. This file is only for changes to `public/*` (the live site) or app/backend code.

**Owner:** Michael Fletcher · maintained by Claude on request
**Convention:** items grouped by type — **A. Content** (site copy), **B. Software** (code to write), **C. Deploy-only** (already committed, just not shipped). Reference the source compliance doc and tracker ID where one exists. Nothing here is deployed until Michael calls the batch.

> Reminder for whoever runs the batch: every deploy goes through `bash scripts/deploy.sh` (never raw wrangler), bump the `?v=` cache tags on any touched HTML in lockstep, and the pre-deploy gate must pass. See CLAUDE.md → Deployment.

---

## A. Content edits (site copy)

| # | Change | Files | Source | Status |
|---|--------|-------|--------|--------|
| A1 | **State the free window at signup.** Add a clear one-line disclosure at the point of account creation: "Free for any school through **September 30, 2026**. After that, continued use requires a paid plan. No card is charged without an affirmative paid signup." | `public/signup.html` (+ wherever the account-create step renders) | Doc 20 Row 13 decision (2026-07-24) | Not started |
| A2 | **Reconcile the "60-day" promise wording.** The live pricing page says *"We'll email you 60 days before any pricing change."* Keep it, but make clear it covers **early termination of the free window or the go-forward price** — NOT the already-disclosed Sept 30 end (which needs no separate notice). Adjust copy so the two don't read as contradictory. | `public/pricing.html:111` | Doc 20 Row 13 decision (2026-07-24) | Not started |
| A3 | **Fix broken `Terms` footer link.** Footer link points at `href="#"` — should point at the Terms page once the production ToS is published. | `public/privacy.html:247` | Verified 2026-07-24 | Not started |
| A4 | **Port production Privacy Policy into the site.** Current `public/privacy.html` still references Netlify (now Cloudflare), omits Schedule Builder + Referral Tracking, doesn't disclose the demographic fields Referrals stores, **and claims 90-day backups at line 189 — now inaccurate (Supabase Pro = 7-day backups; fix to ~7 days when porting).** Doc 17 (Phase-1 launch) / Doc 08 (full) are the replacement content. | `public/privacy.html` | Docs 08 / 17; tracker FE-08 | Not started — awaiting Michael's content review |
| A5 | **Replace beta Terms with production ToS.** `public/terms-beta.html` is the beta "test data only" agreement; Doc 19 (Phase-1) / Doc 09 (full) is the replacement. Pairs with A3 (the footer link target). | `public/terms-beta.html` → production terms page | Docs 09 / 19; tracker BI-08 | Not started — awaiting Michael's content review |

## B. Software (code to write)

| # | Change | Area | Source | Status |
|---|--------|------|--------|--------|
| B1 | **Stripe billing.** Checkout + Supabase Edge Functions; webhook is single writer; gate via `enabled_products`. Blocked on Michael: Stripe account + keys (set as Edge Function secrets — Claude never handles keys), pricing number(s), and the "what's paid" decision. | Edge Functions + `subscriptions` | Doc 21; tracker PR-01 | Blocked on Michael |

## C. Deploy-only (committed, not yet shipped)

| # | Change | Area | Source | Status |
|---|--------|------|--------|--------|
| C1 | **`wipeSchoolData()` full FK-safe wipe.** Committed + pushed, NOT deployed. Now deletes referrals + cico tree → `students` roster → all config (backs the FERPA "deletion on request" promise). Destructive — test on a dummy school first; needs `admin/index.html` `?v=` bump. Phase-2 (CICO/Referrals) concern, not a launch blocker. | `public/admin/admin.js` | Tracker item; project notes | Awaiting batch deploy |

---

### How this list is used
- As we move through the compliance docs, any change that touches `public/*` or app code lands here instead of being edited/deployed immediately.
- When Michael calls the batch: work top-down within each section, deploy once via `scripts/deploy.sh`, then mark items Done here and update the tracker IDs.
