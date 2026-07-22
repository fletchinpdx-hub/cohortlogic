# Cohort Logic — Trust / Security Page (PHASE 1 LAUNCH VERSION)

**Tracker item:** PR-10 (Phase 1)
**Status:** LAUNCH DRAFT — to be ported into `public/security.html` (later website batch). Live page NOT yet changed.
**Scope:** Class Builder + Schedule Builder only. **Supersedes the fuller `15_...` draft for launch** (15 is retained for when database-backed products ship).
**Last updated:** 2026-07-21 (by Claude)

> Launch copy for the Trust page. One clear message: **our products don't store student data.** Keep the existing page's clean design + honest voice; swap in this content.

---

## ⚠️ Reviewer notes — read first (not page content)
1. This version **only** describes the two browser-only products. No "database-backed tools" section — those are Phase 2 and can be shown as "coming later" if you want to signal the roadmap.
2. Keep the honest "not yet" section (SOC 2, pen test, signed DPAs).
3. Resolve the **PBC-vs-LLC** entity label and wire the dead footer **Terms/DPA** links before shipping.
4. Confirm-before-publishing: Supabase **US region** and exact **encryption-at-rest** wording; claim MFA as *available* until enforcement ships (SE-05).

---

## PAGE CONTENT

### Hero
**Eyebrow:** Trust & security
**Headline:** Your student data never reaches our servers.
**Subhead:** Cohort Logic's tools do their work in your browser. Class Builder and Schedule Builder never upload your rosters or schedules to us — that data stays on your device. Here's exactly how it works, what little we do store, and where we are as an early company.
**Honest note (amber callout):** We're early. We are not yet SOC 2 audited and haven't completed third-party penetration testing. We won't claim either until it's real. What *is* real is below.

### How it works — nothing student-identifying leaves your device
- **Class Builder** loads your roster in your browser, balances your classes, and hands you a file to download. Your roster is **never uploaded to Cohort Logic**.
- **Schedule Builder** builds your schedule in your browser and saves it to a **file you download**. Your schedule data is **never stored on our servers**.
- The only things we store are your **staff login** and **anonymous usage counts** — never student data.

### Trust at a glance
| Control | Status |
|---|---|
| Student data stored on our servers | **None — by design** |
| Encrypted in transit (TLS) | ✅ In place |
| Encrypted at rest (account data) | ✅ In place [confirm wording] |
| Per-account isolation (row-level security) | ✅ In place |
| Access control + admin approval | ✅ In place |
| Multi-factor authentication (admins) | ✅ Available [enforced: in progress] |
| Automated daily security monitoring | ✅ In place |
| No sale / no advertising / no model training | ✅ Commitment |
| Will sign district DPA / SDPC NDPA | ✅ On request |
| SOC 2 Type II · third-party pen test | ⏳ Not yet |

### What we store (and what we don't)
We store your **staff account** (name, email, school, role) so you can sign in, and **anonymous usage analytics** with no personal or student data. That's it. We do **not** store student names, rosters, schedules, demographics, or any student records.

### A good habit: anonymize at the source
Even though your roster never leaves your device, less identifying data in the file is always better. For Class Builder you can use **student IDs instead of names** and keep the lookup on your end.
*(Keep the existing "Avoid / Prefer" example table and the short guidelines — they're accurate for these products.)*

### What we never do
- Never sell your data. · Never use it for advertising. · Never train AI/ML models on it. · Never use it for anything beyond running the service.

### Sub-processors
| Provider | Role | Your data? | Region |
|---|---|---|---|
| Supabase (Postgres on AWS) | Accounts + auth, anonymous analytics | Staff account info; **no student data** | United States [confirm] |
| Cloudflare | Hosting, CDN, security edge | None | Global edge |

### Privacy & compliance
- **FERPA:** because student data never reaches our servers, we don't hold education records — it stays on your device, under your control. We'll sign your **DPA / SDPC NDPA** on request; our data schedule is essentially empty.
- **State laws (e.g., California SOPIPA):** no sale, no targeted advertising, purpose limitation, reasonable security.

### Data handling & your control
- **Retention:** account data kept while active; deletion on request within 30 days; backups age out within 90 days.
- **Export/delete:** manage or delete your account any time by contacting us.
- **Breach:** if a breach affects your data, we notify you without unreasonable delay.

### What we're building next (honest roadmap)
Published only when real:
- SOC 2 Type II · third-party penetration test · signed sub-processor DPAs + public registry · WCAG 2.2 AA accessibility audit + VPAT · enforced admin MFA
- *(and, later, our data-backed products — Check-in/Check-out and Referral Tracking — with the additional protections stored student data requires.)*

### Security contact
- **Security & vulnerability disclosure:** [security@cohortlogic.com] — good-faith reports welcome.
- **District security questionnaire or DPA?** [privacy@cohortlogic.com] or the contact form — we turn these around quickly.

---

## Web-port checklist
- [ ] Rewrite hero to the "never reaches our servers" message; drop any implication of stored student data.
- [ ] Replace the summary card with the control table above; add sub-processors + compliance + security-contact sections.
- [ ] Keep the anonymization example (scoped to Class Builder).
- [ ] Resolve PBC-vs-LLC; wire the dead Terms/DPA footer links.
- [ ] Confirm US-region + encryption-at-rest wording before publishing those lines.
