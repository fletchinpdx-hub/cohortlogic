# Cohort Logic — Data Breach Notification Policy

**Tracker item:** FE-12 (operational companion to SE-12 Incident Response Plan)
**Owner:** Michael Fletcher (Cohort Logic) — **requires attorney review before contractual use**
**Status:** DRAFT — statutory timelines below are research-sourced and marked where they still need counsel verification
**Last updated:** 2026-07-21 (by Claude)

> Under FERPA, the **school/district is the controller** of education records and Cohort Logic is a processor acting under the district's direct control. FERPA itself imposes **no** breach-notification mandate — the duty comes from **(a) the contract/DPA and (b) state law**. This policy sets a single internal standard that satisfies the strictest state we've identified.

---

## 1. The notification chain

**Vendor → District → Parents/Regulators.** Cohort Logic notifies the **affected school/district** (our customer, the data controller). The district then notifies parents/eligible students and any state regulator. We **support** the district's notification (facts, scope, cost) but do not notify parents directly unless a contract specifically directs it.

---

## 2. What counts as a breach

Unauthorized access to, acquisition of, disclosure of, or loss of student PII or other personal data we process — confirmed or reasonably believed. When student PII may be involved, treat it as a breach and start the clock; downgrade only after investigation proves no exposure. (Severity classification lives in the IRP, §3.)

---

## 3. The internal standard: 72-hour default, 7-day hard ceiling

To avoid tracking a different deadline per state under pressure, Cohort Logic commits internally to:

- **Notify the affected district within 72 hours** of confirming a breach involving their data (default), **and**
- **Never later than 7 calendar days** after discovery (absolute ceiling — this is New York's statutory limit for third-party contractors and is the strictest we've found).

This default comfortably satisfies the state windows below. Individual district contracts may specify tighter windows (24–48 hours is common in negotiated DPAs) — **the contract's window always wins if stricter.**

---

## 4. Statutory timelines that bind us (verified via research, confirm final text with counsel)

| Jurisdiction | Requirement | Source |
|---|---|---|
| **New York** (Ed Law 2-d / 8 NYCRR §121.10) | Contractor → agency: **≤ 7 calendar days** after discovery. (Agency → NYSED: 10 days; agency → parents: 60 days.) Contractor must **reimburse the agency's notification costs** when the breach is attributable to the contractor. | 8 NYCRR §121.10 |
| **Illinois** (SOPPA, 105 ILCS 85) | Operator → school: **≤ 30 days** after determining a breach occurred; school posts public notice within 10 days. **[Verify 30-day figure against 105 ILCS 85/30 text.]** Breach details become **public** via the district's required transparency posting. | 105 ILCS 85 |
| **Connecticut** (PA 16-189, C.G.S. §10-234dd) | Contractor → board: initial notice "as soon as reasonably possible"; detailed notice **≤ 30 days** after discovery. **[Verify against §10-234dd.]** | C.G.S. §10-234aa–dd |
| **California** (SOPIPA / general breach law Civ. Code §1798.82) | No sector-specific vendor day-count; "most expedient time possible, without unreasonable delay." | Civ. Code §1798.82 |
| **Colorado** (C.R.S. Art. 22-16 + general §6-1-716) | General breach statute = **30 days**; provider-specific day-count under the student act **[unverified — confirm]**. | C.R.S. §6-1-716 |
| **Texas / Virginia** | Vendor breach timelines **[unverified — confirm codified sections]**. | State matrix (`06_...`) |

> Our 72-hour default + 7-day ceiling is designed so that meeting our own standard automatically meets every row above.

---

## 5. Response procedure (ties to the IRP)

1. **Detect & confirm** (IRP phases 1–3): scope which schools, which data elements, how many records. Preserve evidence.
2. **Engage counsel + cyber-insurer first** (before external comms). Late insurer notice can void coverage; counsel scopes legal obligations.
3. **Assess** whether student PII was actually accessed/acquired (informs whether/what to notify).
4. **Notify each affected district** within the §3 window. Provide: what happened, when, which of their data elements/records, what we've done to contain, what we recommend, and our contact. Offer to bear notification costs where required (e.g., NY).
5. **Support the district's downstream notifications** to parents/regulators with facts and cost.
6. **Document** the whole timeline in the incident record and `audit_log`; retain for the records period.
7. **Post-incident review** (IRP phase 6): root cause → corrective actions filed as tracker items.

---

## 6. Notice contents (to the district)

- Date/time of discovery and (est.) of the incident
- The specific data elements and approximate record/student count affected, scoped to that district
- Cause and current containment status
- Steps taken and planned; recommended district actions
- Whether Cohort Logic will bear notification costs (per contract/state law)
- A single point of contact (the Incident Commander)

---

## 7. Standing commitments to put in the DPA

- Notify without unreasonable delay, and within the contractual window (default we offer: ≤ 72 hours; hard ceiling ≤ 7 days).
- Cooperate fully with the district's investigation and parent notification.
- Bear notification costs where the breach is attributable to us (required by NY; offer generally).
- Maintain the security controls that make a breach less likely (RLS isolation, encryption, MFA, audit logging, daily security agent).
