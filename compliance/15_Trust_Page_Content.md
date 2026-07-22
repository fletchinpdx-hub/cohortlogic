# Cohort Logic — Trust / Security Page Content (DRAFT)

**Tracker item:** PR-10 (feeds VQ-01..18 questionnaire readiness)
**Status:** DRAFT content — to be ported into `public/security.html` in the later website batch. The live page is NOT yet changed.
**Owner:** Michael Fletcher
**Last updated:** 2026-07-21 (by Claude)

> This is the **copy** for a product-aware Trust page. Keep the existing page's clean design and its honest voice; swap the content. The goal: a public page that pre-answers most of a district's security questionnaire.
>
> **⚠️ SCOPE UPDATE (2026-07-21):** launch is **Class Builder + Schedule Builder only** (`16_Go_To_Market_Scope.md`) — **both browser-only, no student data stored on our servers.** So the launch page should lead hard with that single message and present the "database-backed tools" section as **coming later / not yet offered**, not as live. The full two-model content below becomes accurate once CICO/Referrals ship (Phase 2). Until then, trim the database-backed claims to "planned."

---

## ⚠️ Reviewer notes — read first (not page content)

1. **The core reframe.** The current page is built around "we don't save your data / anonymize before uploading." That's true for **Class Builder + Schedule Builder** (browser-only, nothing stored) but **wrong for CICO + Referral Tracking**, which are *designed* to store real student names and records under FERPA. The new structure below splits the two clearly so we don't tell a CICO district to "anonymize."
2. **Honesty preserved.** Keep the "what we don't have yet" section (SOC 2, pen test, signed DPAs). It builds trust. Update each item as it becomes real — never before.
3. **Entity discrepancy to resolve (BI-01):** the footer says **"Cohort Logic, PBC"**; other materials imply an LLC. Confirm the true legal entity and make it consistent everywhere before this page ships.
4. **Fix the dead links:** footer "Terms" and "DPA" are `href="#"`. Wire them when the ToS (`09_...`) and DPA (`07_...`) pages/exhibits exist.
5. **Confirm-before-publish claims (don't state until verified):** Supabase **US region** (FE-06) and the exact **encryption-at-rest** wording (FE-09/SE-09). Only claim MFA as *available* until enforcement ships (SE-05).

---

## PAGE CONTENT

### Hero
**Eyebrow:** Trust & security
**Headline:** Built for student data, honest about where we are.
**Subhead:** Cohort Logic is used by school administrators, and some of our tools handle student records. This page is a straight account of how we protect that data, what we collect, who we share it with (a short list), and what we're still building.
**Honest note (keep the amber callout):** We're early. We are not yet SOC 2 audited and have not completed third-party penetration testing. We won't claim either until it's real. What *is* real is below.

### Trust at a glance (the summary card — update it)
| Control | Status |
|---|---|
| Per-school data isolation (row-level security) | ✅ In place |
| Encrypted in transit (TLS) | ✅ In place |
| Encrypted at rest | ✅ In place [confirm wording] |
| Role-based access + admin approval | ✅ In place |
| Multi-factor authentication (admins) | ✅ Available [enforced: in progress] |
| FERPA audit logging | ✅ In place |
| Automated daily security monitoring | ✅ In place |
| No sale / no advertising / no model training on student data | ✅ Commitment |
| Will sign district DPA / SDPC NDPA | ✅ On request |
| SOC 2 Type II | ⏳ Not yet |
| Third-party penetration test | ⏳ Not yet |

### Two kinds of tools, two data models (the key section)
**Browser-only tools — nothing stored on our servers.**
Class Builder and Schedule Builder run entirely in your browser. The rosters and schedules you work with are never uploaded to Cohort Logic. When you close the tab, they're gone; you save your own file. Supabase is used only for sign-in and anonymous usage counts — never student records.
*(Even so, less identifying data leaving your school is always better — for Class Builder you can use student IDs instead of names. See the tips below.)*

**Database-backed tools — real student data, protected.**
Check-in/Check-out and Referral Tracking are *meant* to hold real student records so your staff can share them. Here, student data is stored in a secured, per-school database with the controls listed below. You enter real names here; that's by design, and it's protected accordingly.

### Security controls (what protects the database-backed tools)
- **Per-school isolation** enforced at the database level (row-level security) — one school can never see another's data. Verified automatically every day.
- **Encryption** in transit (TLS) and at rest.
- **Access control** — role-based (staff / school admin / super admin), new accounts require admin approval, and admin accounts support multi-factor authentication.
- **FERPA audit log** — every change to a student record is recorded with who and when.
- **Automated daily security audit** — an internal agent checks our data-isolation, headers, and access controls every day and flags anything off.
- **Session timeouts** on sensitive apps.

### Privacy & compliance
- **FERPA:** Your school owns the education records. Cohort Logic operates as a *school official with a legitimate educational interest*, under your school's direct control, using data only to provide the service and never re-disclosing it.
- **COPPA:** For students under 13, your school consents on parents' behalf for educational use; we make no commercial use of the data and delete it on request.
- **State laws:** We build to laws such as California SOPIPA, New York Education Law 2-d, and Illinois SOPPA — no sale, no targeted advertising, purpose limitation, security, and deletion on request.
- **Agreements:** We'll sign your district's Data Processing Agreement and the SDPC National Data Privacy Agreement (NDPA) on request.

### What we never do
- Never sell student or staff data.
- Never use student data for advertising.
- Never train machine-learning/AI models on student data.
- Never use student data for anything beyond providing and supporting the service.

### Sub-processors
The only vendors that touch customer data:
| Provider | Role | Student data? | Region |
|---|---|---|---|
| Supabase (Postgres on AWS) | Database + authentication | Yes (CICO/Referrals) | United States [confirm] |
| Cloudflare | Hosting, CDN, security edge | No | Global edge |

### Data handling & your control
- **Retention:** data is kept while your account is active; deletion on request is completed within 30 days; backups age out within 90 days.
- **Deletion & export:** school admins can export or delete their data any time from the admin panel; on termination we return or delete it.
- **Breach:** if a breach affects your data, we notify the affected school without unreasonable delay (our standard: within 72 hours) and support your notifications.

### What we're building next (keep honest)
We publish these when they're real, not before:
- SOC 2 Type II audit
- Third-party penetration test
- Signed sub-processor DPAs + a public sub-processor registry
- WCAG 2.2 AA accessibility audit + VPAT
- Enforced MFA for all admin accounts
*If your district has specific security requirements, tell us — we want to hear them.*

### Security contact (add this — questionnaires expect it)
- **Security & vulnerability disclosure:** [security@cohortlogic.com] — we welcome good-faith reports.
- **District security questionnaire or DPA?** [privacy@cohortlogic.com] or the contact form — we'll turn it around quickly.

---

## Web-port checklist (for the later batch)
- [ ] Reframe hero + add the "two data models" section (stop implying all products are browser-only).
- [ ] Scope the "anonymize before uploading" guidance to Class Builder/Schedule Builder only.
- [ ] Replace the summary card with the product-wide control table above.
- [ ] Add sub-processors, privacy/compliance, and security-contact sections.
- [ ] Resolve the PBC-vs-LLC entity label; wire the dead Terms/DPA footer links.
- [ ] Confirm US-region + encryption-at-rest wording before publishing those claims.
