# Cohort Logic — Go-To-Market Scope & Phasing

**Status:** Strategic scope decision (2026-07-21) — governs how every other doc and tracker item is prioritized
**Owner:** Michael Fletcher
**Last updated:** 2026-07-21 (by Claude)

> **Decision:** Cohort Logic goes to market with **Class Builder and Schedule Builder only**. Check-in/Check-out (CICO) and Referral Tracking are **held for Phase 2**, after product-market fit is confirmed — deliberately, because they carry the larger security and expense burden.

---

## 1. Why this dramatically reduces the compliance burden

Both launch products are **browser-only / file-based — they store NO student data on Cohort Logic servers:**

| Product | Where student data lives | Stored on our servers? |
|---|---|---|
| **Class Builder** | In the user's browser during a session; results downloaded as a file | **No.** Only anonymous usage counts (`sessions`/`events`) go to Supabase — no student records. |
| **Schedule Builder** | In the browser + a `.cohortlogic` file the user downloads | **No.** Supabase used only for sign-in + product gating. |

**What we *do* store server-side (Supabase):** staff account info (name, email, school, role) for login, plus anonymous analytics and operational data (feedback, contact form, error logs). **This is ordinary business data — not FERPA education records.**

**The consequence:** for the launch products, Cohort Logic **never receives student education records**. Student data is processed only on the user's own device. That means:
- The heavy FERPA "school official" analysis, student-data retention/deletion, breach-notification timelines, COPPA, and state student-privacy statutes (NY 2-d, IL SOPPA, CA SOPIPA operator storage duties) are **largely not triggered at launch** — there is no stored student PII to lose.
- Our public answer becomes the strongest one in the market: **"Student data never leaves your device; our servers never receive it."**

Some districts will still ask for a DPA/NDPA as a formality even for no-storage tools — we sign it, and our **data-elements schedule (NDPA Exhibit B) is nearly empty**, which is a fast, easy conversation.

---

## 2. Phase 1 — what you actually need to launch (the short list)

**Business & legal (get paid + contract):**
- Confirm legal entity (resolve the "PBC" vs LLC label), EIN + W-9, business banking — BI-01/02/03
- **Insurance** (cyber + tech E&O + general liability) — *Michael obtaining* — BI-04/05/06/07
- Identify counsel — BI-14

**Public legal pages (attorney-reviewed, then published):**
- **Lean Privacy Policy** — leads with "we don't store student data" for both products — FE-08 / `08_...`
- **Terms of Service** (replaces the beta agreement) — BI-08 / `09_...`
- **Acceptable Use Policy** — BI-11 / `11_...`
- **Trust page** — the product-aware `security.html` — PR-10 / `15_...`

**Contracts (for district deals):**
- A simple **DPA / SDPC NDPA** ready to sign, with a near-empty data schedule — FE-02/03 / `07_...`
- **MSA** if selling on contract — BI-09/10 / `10_...`

**Sub-processors (covers staff data + analytics, not student data):**
- Sign Supabase + Cloudflare DPAs; publish the sub-processor list — FE-05

**Product & go-live:**
- Billing (Stripe) — PR-01 · Finalize pricing — PR-09 · Onboarding — PR-02 · Support/SLA — PR-03/07 · Accessibility/VPAT — PR-05 · Delete legacy Netlify — PR-08

**Security & reliability (foundational, mostly already done):**
- Keep: RLS isolation, RBAC, TLS/headers, audit log, daily security agent (SE-01..06 — done)
- Do: **Supabase Pro + backups** (so logins/gating don't pause) — SE-07/08 · Basic **Incident Response** + **BC/DR** — SE-12/13 · Uptime/status — SE-14 · Dependency scanning — SE-11 · Secrets policy — SE-16 · Enforce admin MFA (lighter, but good) — SE-05

---

## 3. Phase 2 — deferred until CICO / Referral Tracking launch

These activate only when a product that **stores** student data ships. The drafts are done and waiting:
- Full FERPA "school official" posture (heavy) — FE-01 / `03_...`
- Student-data inventory (the storing tables) — FE-04 / `01_...`
- Student-record retention & deletion + data-request runbook — FE-07/13 / `02_...`, `14_...`
- Breach-notification timelines (NY 7-day, IL 30-day, etc.) — FE-12 / `05_...`
- State student-privacy matrix + NY 2-d Parents' Bill of Rights & security plan — FE-10/11 / `06_...`
- COPPA (under-13 stored data) — FE-09
- Third-party penetration test — SE-10 · SOC 2 — SE-17 · SSO/rostering (Clever/ClassLink/Google) — PR-06

---

## 4. How this maps onto the documents already produced

| Doc | Phase 1 relevance |
|---|---|
| `01` Data map | Launch section = "nothing stored"; the student-data inventory is Phase 2 reference |
| `02` Retention | Applies to staff/account + analytics data now; student-record retention is Phase 2 |
| `03` FERPA posture | Minimal at launch (no records stored); full analysis is Phase 2 |
| `04` Incident Response | **Phase 1** — a basic plan still needed (account/security incidents) |
| `05` Breach notification | Mostly **Phase 2** (student-data timelines); keep a light account-breach path in `04` |
| `06` State matrix | **Phase 2** |
| `07` DPA/NDPA readiness | **Phase 1**, but lightweight (near-empty data schedule) |
| `08` Privacy Policy | **Phase 1** — publish a lean version (see its scope banner) |
| `09` ToS / `11` AUP | **Phase 1** |
| `10` MSA | **Phase 1** if contracting with districts |
| `12` BC/DR · `13` Secrets · `14` Data-request | 12 & 13 = Phase 1; 14 (student data-requests) = Phase 2 |
| `15` Trust page | **Phase 1** — the launch story is entirely the browser-only, no-storage message |

---

## 5. Bottom line

Going to market with only the two browser-only products means your launch compliance load is roughly: **entity + insurance + three attorney-reviewed public pages + a lightweight DPA + billing + a trust page.** The student-data-heavy work (most of the FERPA/state/breach material) is real and done, but it correctly waits for Phase 2 — exactly matching the "confirm PMF before the larger, more expensive build-out" strategy.
