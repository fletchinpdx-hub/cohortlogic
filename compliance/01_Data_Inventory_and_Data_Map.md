# Cohort Logic — Data Inventory & Data Flow Map

**Tracker item:** FE-04
**Owner:** Michael Fletcher (Cohort Logic)
**Status:** DRAFT — for internal review and to seed the DPA "Exhibit E / Data Elements" schedule
**Last updated:** 2026-07-21 (by Claude)
**Review needed:** Confirm the "CONFIRM" flags below; have counsel confirm the FERPA/PII classifications before publishing.

> This document is an operational data map, not legal advice. It exists to (a) answer the "what data do you collect and where does it live" question on every district questionnaire, and (b) generate the **NDPA "Exhibit B — Schedule of Data"** that attaches to a Data Processing Agreement / SDPC NDPA. (Note: the data-elements schedule is Exhibit **B**, not "Exhibit E" — Exhibit E is the separate "General Offer of Privacy Terms." See `07_DPA_and_NDPA_Readiness.md`.)

---

## 1. Company & processing role

- **Vendor:** Cohort Logic — a multi-product SaaS for K-12 school administrators.
- **Role under FERPA:** Cohort Logic acts as a **"school official"** performing an institutional service for the school/district (the FERPA data controller). The school controls the education records; Cohort Logic processes them only to provide the service. See `03_FERPA_School_Official_Posture.md`.
- **Products:**
  1. **Class Builder** — balanced classroom assignment. **No student data stored server-side** (see §4).
  2. **Check-in / Check-out (CICO)** — daily behavioral tracking. **Stores student education records.**
  3. **Schedule Builder** — master schedule builder. **No student data stored server-side** (file-based).
  4. **Referral Tracking** — office-discipline referral tracking. **Stores student education records.**

---

## 2. Where data lives (systems & sub-processors)

| Layer | Provider | What it holds | Region | DPA status |
|---|---|---|---|---|
| Application hosting / CDN / WAF | **Cloudflare** (Workers static assets) | Static app files only; no database | Global edge | ⚠️ Obtain Cloudflare DPA (FE-05) |
| Database, Auth, Storage | **Supabase** (managed Postgres on **AWS**) | All server-side records below | **CONFIRM US region** (FE-06) | ⚠️ Sign Supabase DPA (FE-05) |
| Client device | End-user browser | Class Builder rosters (in-memory) & Schedule Builder files (localStorage / downloaded `.cohortlogic` file) | User's device | N/A (never transmitted to us) |

**Sub-processor principle:** Supabase and Cloudflare are the only sub-processors that touch customer data. Any addition must be added here, disclosed to schools, and covered by a sub-processor DPA before go-live.

---

## 3. Data element inventory (server-side / Supabase)

Legend — **Category:** SR = Student education record (FERPA) · SP-D = Student demographic (sensitive) · Staff = Staff/user PII · Ops = Operational/marketing · Config = Non-PII configuration.

### 3a. Student education records (FERPA-protected)

| Data element | Table(s) | Category | Purpose | Who can access |
|---|---|---|---|---|
| Student name, grade, homeroom/teacher, external student ID | `students` | SR / SP-D | Roster for CICO & Referrals | School's approved users, scoped to their `school_id` via RLS |
| Race/ethnicity, gender, IEP status | `students` (`race_ethnicity`, `gender`, `iep`) | SP-D | Equity reporting (referral risk indices) | Same, RLS-scoped |
| Daily check-in/check-out records & scores | `cico_checkins`, `cico_period_scores` | SR | Behavior tracking & reports | Same school, RLS-scoped |
| Behavior incidents | `cico_incidents` | SR | Behavior tracking | Same school, RLS-scoped |
| Office-discipline referrals (location, behavior, motivation, action, notes, custom fields) | `referral_referrals`, `referral_custom_field_options` | SR | Referral tracking & reports | Same school, RLS-scoped; reviewer workflow |
| Audit snapshots that may embed student data | `audit_log` (`old_data`, `new_data` JSON) | SR | FERPA audit trail of changes | Super-admin only |

> **CONFIRM:** `audit_log.old_data/new_data` can contain copies of student rows. It is therefore an education record store and must be included in retention/deletion (see `02_...Retention...`), not treated as "just logs."

### 3b. Staff / user PII (school personnel, not students)

| Data element | Table(s) | Category | Purpose | Who can access |
|---|---|---|---|---|
| Full name, email, school, role, approval status | `profiles` | Staff | Authentication, RBAC, approval workflow | Self; school_admin (same school); super_admin |
| Auth identity (email, hashed password, MFA factors) | Supabase Auth (`auth.users`) | Staff | Login / MFA | Supabase-managed; not directly readable by app |
| Feedback submissions (name, email, message) | `feedback` | Staff/Ops | Product feedback widget | super_admin |
| Billing / subscription state | `subscriptions` | Ops | Plan management | super_admin |

### 3c. Marketing & operational (non-student)

| Data element | Table(s) | Category | Purpose |
|---|---|---|---|
| Contact-form submissions | `contact_submissions` | Ops | Sales inquiries |
| Newsletter signups | `newsletter_subscribers` | Ops | Marketing list |
| Client error captures | `error_logs` | Ops | Debugging (avoid storing PII in error payloads — CONFIRM) |
| Class Builder anonymous usage analytics | `sessions`, `events` | Ops | Product analytics — **anonymous**, no student records |
| Feature flags, school & referral config | `features`, `schools`, `referral_locations/behaviors/motivations/actions/others_involved`, `cico_settings/categories/incident_types`, `referral_settings`, `referral_custom_fields` | Config | App configuration; no student PII |

---

## 4. Privacy-by-design properties worth advertising

These are genuine architectural strengths — they belong in questionnaire answers and the Trust page:

1. **Class Builder never stores rosters.** All balancing runs in the browser; the student roster is never uploaded or persisted server-side. Supabase is used only for auth + anonymous usage analytics.
2. **Schedule Builder stores no student data server-side.** Schedule data lives in the browser (localStorage) and in a user-downloaded `.cohortlogic` file. Supabase is used only for auth + product gating.
3. **Strict multi-tenant isolation.** Every student-data table enforces Postgres Row-Level Security keyed on `school_id`; a user can only ever read/write their own school's rows. Verified daily by an automated security agent.
4. **Data minimization.** Demographics are collected only where a product needs them (equity reporting) and nowhere else.
5. **No sale, no advertising, no secondary use.** (To be stated explicitly in the privacy policy + DPA — FE-08.)

---

## 5. Data flow (narrative)

- **CICO / Referrals (student data):** School admin is approved → assigned a `school_id` → creates/imports students → staff record check-ins/referrals in-browser → written to Supabase over TLS → RLS confines every read/write to that `school_id` → reports computed from that school's rows → audit_log records changes.
- **Class Builder:** User uploads a roster file → parsed and balanced entirely in the browser → results downloaded as Excel → nothing student-identifying is sent to Supabase (only anonymous `sessions`/`events` counters).
- **Schedule Builder:** User builds a schedule in-browser → saved to localStorage and/or downloaded as a `.cohortlogic` file → no student data sent to Supabase.

---

## 6. Open items feeding other documents

- **FE-06:** Confirm and document the Supabase project's AWS region (US) and that backups stay in-region.
- **FE-05:** Sign Supabase + Cloudflare DPAs; publish this sub-processor list on the Trust page (PR-10).
- **FE-07:** This inventory is the input to the retention & deletion policy.
- **DPA/NDPA:** §3a + §3b become the NDPA **"Exhibit B — Schedule of Data"** a district will require (see `07_DPA_and_NDPA_Readiness.md` §4 for the prepared selection).
- **CONFIRM flags:** `audit_log` PII handling; `error_logs` payload hygiene; Supabase region.
