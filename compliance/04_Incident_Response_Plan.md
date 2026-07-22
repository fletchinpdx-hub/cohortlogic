# Cohort Logic — Incident Response Plan (IRP)

**Tracker item:** SE-12
**Owner:** Michael Fletcher (Cohort Logic) — Incident Commander
**Status:** DRAFT — fill the `[FILL]` contacts before this is operational
**Last updated:** 2026-07-21 (by Claude)
**Cadence:** Review annually and after any incident or tabletop exercise.

> A written IRP is required by most district contracts, by NY Ed Law 2-d's security plan expectation, and by cyber-insurance applications. It is the operational half of the breach-notification policy (`05_Data_Breach_Notification_Policy.md`).

---

## 1. Purpose & scope

Defines how Cohort Logic detects, contains, resolves, and reports security incidents affecting the confidentiality, integrity, or availability of systems or data — especially **student education records**. Covers the app, Supabase (database/auth), Cloudflare (edge), and admin access.

---

## 2. Roles (solo founder today; scales with hiring)

| Role | Who | Responsibility |
|---|---|---|
| **Incident Commander (IC)** | Michael Fletcher | Owns the response end-to-end; decides severity; authorizes notifications |
| Technical lead | Michael (interim) | Containment, forensics, remediation |
| Legal / breach counsel | `[FILL: attorney name + phone]` (BI-14) | Notification obligations, regulator/AG contact |
| Cyber-insurance contact | `[FILL: carrier breach hotline + policy #]` (BI-04) | Many policies require notifying the carrier first |
| Comms / customer contact | Michael (interim) | District notifications, status page |

> Until there are more people, the IC role is concentrated. The mitigation is this written plan + pre-identified external counsel and insurer so response does not depend on improvising under pressure.

---

## 3. Severity classification

| Sev | Definition | Examples | Target response |
|---|---|---|---|
| **Sev-1 (Critical)** | Confirmed/likely unauthorized access to student PII, or full outage | Student data readable across schools; DB breach; leaked credentials with prod access | Immediate; IC engaged within 1 hour |
| **Sev-2 (High)** | Security control failure with exposure risk, no confirmed data access | RLS gap found; MFA bypass; exposed secret with limited blast radius | Same day |
| **Sev-3 (Low/Moderate)** | Localized issue, no PII risk | Single-account compromise contained; dependency CVE not yet exploited | Next business day |

Anything touching student PII starts at **Sev-1 until proven otherwise**.

---

## 4. Detection sources

- The **daily automated security & compliance agent** (deploy exposure, RLS anon-probe, headers, MFA, credential rotation) → admin Security dashboard.
- `error_logs` and application monitoring / uptime alerts (SE-14, once added).
- Supabase / Cloudflare provider alerts.
- Reports from users, schools, or security researchers.

---

## 5. Response phases (runbook)

**1. Detect & record.** Open an incident record (time, reporter, what/how detected). Start a timeline log — every action, timestamped. Assign a Sev.

**2. Triage.** Confirm it's real. Scope it: what systems/tables/schools/records are affected? Is student PII involved? Preserve evidence (don't wipe logs; snapshot before changing anything).

**3. Contain.** Stop the bleeding: rotate/revoke compromised credentials (service-role key, PATs, user sessions); tighten or disable the affected path; if cross-tenant data exposure, consider taking the surface offline. Use `scripts/deploy.sh` gate; never bypass controls while containing.

**4. Notify (start the clock).** If student PII is or may be involved, **engage breach counsel and the cyber-insurer immediately** (before broad external comms), then follow `05_Data_Breach_Notification_Policy.md` for district/parent/regulator notification and timelines. Notifying the insurer late can void coverage.

**5. Eradicate & recover.** Remove the root cause (patch, fix RLS/policy, close the exposure). Restore from known-good backups if integrity was affected (SE-08). Verify with the security agent + a targeted check before declaring recovery.

**6. Post-incident review (within 5 business days).** Blameless write-up: timeline, root cause, what worked, what to fix. File corrective actions as tracker items. Update this plan and controls.

---

## 6. Evidence & communication rules

- **Preserve first.** Snapshot logs (`audit_log`, `error_logs`, provider logs) and DB state before remediation where feasible.
- **Single source of truth.** One incident doc; the IC approves all external statements.
- **Don't over-share early.** Facts to affected schools through counsel; no speculation publicly. Use the status page (PR-07) for availability incidents.
- **Credentials/keys are never pasted into the incident doc or chat.** Reference them by name; rotate via the documented path.

---

## 7. Key contacts (fill before go-live)

| Contact | Detail |
|---|---|
| Breach/privacy counsel | `[FILL]` |
| Cyber-insurance breach hotline | `[FILL]` |
| Supabase support / security | `[FILL: support plan + URL]` |
| Cloudflare support | `[FILL]` |
| State AG / Ed-dept reporting portals | Per `06_State_Student_Privacy_Matrix.md` (populated from research) |

---

## 8. Testing

- Run a **tabletop exercise annually** (walk through a simulated Sev-1 student-data exposure end-to-end).
- Validate that backups restore (SE-08) and that credential rotation works (rotation manifest) as part of the exercise.
