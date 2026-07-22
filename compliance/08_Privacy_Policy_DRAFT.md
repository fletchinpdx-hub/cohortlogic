# Cohort Logic — Privacy Policy (PRODUCTION DRAFT)

**Tracker item:** FE-08
**Status:** DRAFT for attorney review — then to be ported into `public/privacy.html` (a later website/code batch; the live page is NOT yet changed)
**Owner:** Michael Fletcher — **requires attorney review before publishing**
**Last updated:** 2026-07-21 (by Claude)

> **⚠️ SCOPE UPDATE (2026-07-21) — read before publishing.** Go-to-market is **Class Builder + Schedule Builder only** (see `16_Go_To_Market_Scope.md`). **Neither stores student data on our servers.** For launch, the strongest, simplest policy leads with *"we do not store student data"* and covers only staff accounts + anonymous analytics. The **CICO/Referral Tracking sections below (§2, §5 rows) apply only when those products launch (Phase 2)** — keep them out of the launch version or clearly mark them "not yet offered." I can produce a **lean Phase-1 privacy policy** on request; the fuller text below is retained as the Phase-2 baseline.
>
> This rewrites the current `privacy.html` for a **production** posture, and fixes three factual gaps in the live page: (1) it lists **Netlify** as a host — you're on **Cloudflare** now; (2) it omits **Schedule Builder** and **Referral Tracking**; (3) it never discloses the **demographic data** (race/ethnicity, gender, IEP) that Referrals stores. Content below is the policy text; the web port keeps your existing page design.

---

## Privacy Policy

**Effective date:** [DATE ON PUBLISH] · **Last updated:** [DATE]

Cohort Logic builds administrative tools for K-12 schools. Some handle student data; some never do. This policy explains what we collect, why, where it lives, how long we keep it, and the commitments we make. When our tools process student education records, the **school or district is the data owner** and Cohort Logic acts as a **school official / service provider under the school's direct control** (see *FERPA*, below).

### 1. Our products and their data approaches

| Product | Student data stored on our servers? |
|---|---|
| **Class Builder** | **No.** Runs entirely in your browser; rosters are never uploaded to our servers. Closing the tab clears the data. |
| **Schedule Builder** | **No.** Schedule data stays in your browser and in a file you download; it is never stored on our servers. |
| **Check-in / Check-out (CICO)** | **Yes.** Stores student records and behavior data so staff can share them (see §2). |
| **Referral Tracking** | **Yes.** Stores office-discipline referrals and limited demographics for equity reporting (see §2). |

### 2. What we store (CICO and Referral Tracking)

- **Student records:** first/last name, grade level, homeroom/teacher, school-assigned student ID.
- **Demographics (Referral Tracking only, for equity reporting):** race/ethnicity, gender, and IEP/special-services indicator. Used solely to produce the equity analyses schools use to identify and address disproportionality; never for any other purpose.
- **Behavior data (CICO):** daily check-in/check-out scores, period scores, incidents, notes.
- **Discipline data (Referrals):** referral location, behavior, motivation, action taken, notes, and any school-defined custom fields.
- **Staff accounts:** name, email, school affiliation, role — for authentication and access control.
- **Change history:** an audit log records who changed what and when, for FERPA accountability.

### 3. What we never do

- We never **sell** student or staff data — to anyone, ever.
- We never use student data for **advertising** or serve ads in any product.
- We never use student data to **train machine-learning/AI models**.
- We never use student data for any purpose beyond **providing and supporting the service** to your school.
- We never share data with third parties except the infrastructure sub-processors in §5.

### 4. FERPA, COPPA, and state law

- **FERPA:** Your school remains responsible for student education records. Cohort Logic operates as a *school official with a legitimate educational interest*, under your school's direct control, using records only for the authorized purpose and never re-disclosing them. We sign a Data Processing Agreement (and the SDPC National Data Privacy Agreement) on request.
- **COPPA (under-13):** For students under 13, your school provides consent on parents' behalf for educational use. We use the data only for the school's benefit, with no commercial use, and delete it on request.
- **State student-privacy laws:** We build to the requirements of laws such as California SOPIPA, New York Education Law 2-d, and Illinois SOPPA — no sale, no targeted advertising, purpose limitation, security safeguards, and deletion on request.

### 5. Infrastructure and sub-processors

We use a small number of vendors to run the service. Student data is stored only with Supabase.

| Provider | Purpose | Data stored | Region |
|---|---|---|---|
| **Supabase** (managed Postgres on AWS) | Database + authentication | All CICO/Referrals data; staff credentials | United States [CONFIRM] |
| **Cloudflare** | Static hosting, CDN, security edge | None — HTML/CSS/JS only | Global edge |

We do not add a sub-processor that touches customer data without updating this list.

### 6. How we protect data

- **Per-school isolation** enforced at the database level (row-level security) — one school can never see another's data.
- **Encryption in transit** (TLS) and at rest.
- **Access approval + roles** — new staff require admin approval; access is role-scoped.
- **FERPA audit log** of student-record changes.
- **Automated daily security monitoring** of our controls.

### 7. Data retention and deletion

- **Active accounts:** retained while your account is active.
- **Deletion on request:** a school administrator can request deletion of all their school's data at any time; we complete it within **30 days**.
- **Inactive accounts:** after **12 months** of non-use we may notify you and then delete the data and close the account.
- **Backups:** deleted data may persist in encrypted backups for up to **90 days** before being overwritten.

*(These are your currently published windows; the retention policy doc `02_...` treats them as the decided values unless you change them.)*

### 8. Your rights (through the school)

Parents and eligible students exercise access, correction, and deletion rights **through the school**, consistent with FERPA. Schools can, at any time: export or review their data in-app; delete individual students or all data from the admin panel; deactivate staff to revoke access; and request full account deletion.

### 9. Data breach

If we become aware of a data breach affecting your data, we will notify the affected school **without unreasonable delay** (our standard: within 72 hours, and never later than any applicable legal deadline), and support the school's notification obligations.

### 10. Changes and contact

We'll post changes here and update the "last updated" date; material changes affecting student data will be communicated to schools. Questions or deletion requests: **[privacy@cohortlogic.com / hello@cohortlogic.com]**. We respond within 5 business days.

---

### Reviewer notes (not part of the published policy)
- Confirm the Supabase US region claim (FE-06) before publishing "United States."
- Decide the contact address (dedicated `privacy@` recommended).
- Attorney: confirm FERPA/COPPA/state-law statements and the breach-timing commitment.
- On web port: keep the current page's design; drop the Netlify row; add Schedule Builder + Referrals + demographics.
