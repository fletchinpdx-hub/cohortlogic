# Cohort Logic — Privacy Policy (PHASE 1 LAUNCH VERSION)

**Tracker item:** FE-08 (Phase 1)
**Status:** LAUNCH DRAFT — for attorney review, then port into `public/privacy.html` (later website batch). Live page NOT yet changed.
**Scope:** Class Builder + Schedule Builder only. **Supersedes the fuller `08_...` draft for launch** (08 is retained as the Phase-2 baseline for when CICO/Referrals ship).
**Last updated:** 2026-07-21 (by Claude)

> The whole point of this version: our two launch products **do not store student data on our servers**. The policy leads with that and covers only what we actually hold — staff accounts and anonymous usage data. It is short on purpose.

---

## Privacy Policy

**Effective:** [DATE ON PUBLISH] · **Last updated:** [DATE]

Cohort Logic builds administrative tools for K-12 school staff. This policy explains what we collect, why, and how we protect it. **The short version: our products do not store student data on our servers.**

### 1. We don't store student data

Both of our products run in your browser:

- **Class Builder** loads your roster **in your browser**, generates balanced classes, and lets you download the result. **The roster is never uploaded to Cohort Logic.** When you close the tab, it's gone.
- **Schedule Builder** builds your schedule **in your browser** and saves it to a file **you** download to your own device. **Your schedule data is never stored on our servers.**

We never receive your student roster or schedule data on the server side. Student information is processed only on your own device.

### 2. What we do collect

To operate the service we store a small amount of **non-student** data:

| Data | Why | Where |
|---|---|---|
| **Staff account info** — name, email, school, role | Sign-in and access control | Supabase (US [confirm]) |
| **Anonymous usage analytics** — feature/session counts, no names | Understand product usage | Supabase — no personal or student data |
| **Support & marketing** — messages, contact-form and newsletter details you submit | Respond to you; send updates you asked for | Supabase |

We do **not** collect or store: student names, student records, rosters, schedules, demographics, or any student education records.

### 3. What we never do

- Never **sell** your data — to anyone, ever.
- Never use your data for **advertising** or serve ads in the product.
- Never use your data to **train machine-learning / AI models**.
- Never use your data for anything beyond **providing and supporting the service**.
- Never share data with third parties except the infrastructure providers in §5.

### 4. FERPA and student privacy

Because our products don't transmit or store student education records on our servers, Cohort Logic does not hold FERPA-protected records for these products — student data stays on your device and under your control. We still operate under your school's authority, make no commercial use of anything you enter, and will sign a **Data Processing Agreement** or the **SDPC National Data Privacy Agreement** on request. We comply with applicable state student-privacy laws (e.g., California SOPIPA): no sale, no targeted advertising, purpose limitation, and reasonable security.

### 5. Infrastructure and sub-processors

| Provider | Purpose | Data | Region |
|---|---|---|---|
| **Supabase** (Postgres on AWS) | Accounts + authentication, anonymous analytics | Staff account info; no student data | United States [confirm] |
| **Cloudflare** | Hosting, CDN, security edge | None — app files only | Global edge |

We won't add a sub-processor that touches your data without updating this list.

### 6. How we protect it

- **Encryption in transit** (TLS) and **at rest**.
- **Per-account / per-school isolation** enforced at the database level (row-level security).
- **Access approval + roles**; multi-factor authentication available for administrators.
- **Automated daily security monitoring** of our controls.

### 7. Retention and deletion

- Account data is kept while your account is active.
- **Deletion on request:** we delete your account data within **30 days** of a request.
- **Inactive accounts:** after **12 months** of non-use we may notify you, then delete and close the account.
- **Backups:** deleted data may persist in encrypted backups up to **90 days** before being overwritten.

### 8. Your rights

You can review or export your account information, request correction, deactivate access, and request full account deletion at any time by contacting us.

### 9. Data breach

If we become aware of a breach affecting your data, we will notify you without unreasonable delay and support any steps you need to take.

### 10. Changes and contact

We'll post changes here and update the date above. Questions or deletion requests: **[privacy@cohortlogic.com]** — we respond within 5 business days.

---

### Reviewer notes (not published)
- Confirm the Supabase **US region** before publishing (FE-06).
- Attorney: confirm the FERPA framing (§4) — the "we don't hold education records" position is strong but should be counsel-blessed.
- On web port: replace the current `privacy.html` body; keep the page design; set the `privacy@` address; fix the footer entity label (currently "PBC" — should be **"Cohort Logic, LLC"**) and dead links.
- Keep the fuller `08_...` draft on file — it becomes the basis for the privacy policy when CICO/Referral Tracking (student-data products) launch.
