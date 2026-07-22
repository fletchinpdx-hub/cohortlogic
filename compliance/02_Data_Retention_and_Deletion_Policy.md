# Cohort Logic — Data Retention & Deletion Policy

**Tracker item:** FE-07
**Owner:** Michael Fletcher (Cohort Logic)
**Status:** DRAFT — business decisions marked `[DECIDE]` must be set before this is published or attached to a contract
**Last updated:** 2026-07-21 (by Claude)
**Review needed:** Set the `[DECIDE]` retention windows; verify the deletion mechanics against the live schema; attorney review before contractual use.

> Districts (and NY Ed Law 2-d, IL SOPPA, and the SDPC NDPA) require a stated retention schedule and a deletion-on-termination commitment. This policy is also what a parent/student data-deletion request is measured against.

---

## 1. Principles

1. **The school owns the data.** Cohort Logic holds student education records only to provide the service, and only for as long as the school's contract is active (plus a short, defined wind-down).
2. **Data minimization + purpose limitation.** We keep only what a product needs, for only as long as it is needed.
3. **Deletion is real and verifiable.** On request or termination, data is deleted from the primary database and aged out of backups within the backup cycle — not merely hidden.
4. **No secondary use.** Retained data is never used for advertising, resale, model training, or any purpose beyond delivering the service to that school.

---

## 2. Retention schedule

| Data category | Store | Retention while active | On school termination | Notes |
|---|---|---|---|---|
| Student roster & records (`students`, `cico_*`, `referral_referrals`) | Supabase | Duration of contract | Deleted within **[DECIDE: e.g., 30] days** of termination (or returned first if the school requests export) | Core education records |
| Audit trail (`audit_log`) | Supabase | `[DECIDE: e.g., 1–3 years]` | Deleted with the school's data, or retained as de-identified counts only | May embed student data — treat as an education record |
| Staff/user accounts (`profiles`, `auth.users`) | Supabase Auth | Duration of relationship; deactivated accounts `[DECIDE]` | Deleted/anonymized within **[DECIDE] days** | |
| Feedback (`feedback`) | Supabase | `[DECIDE: e.g., 2 years]` | N/A (not school-scoped student data) | Contains submitter name/email |
| Marketing (`contact_submissions`, `newsletter_subscribers`) | Supabase | Until unsubscribe / `[DECIDE]` | N/A | Honor opt-out |
| Error logs (`error_logs`) | Supabase | `[DECIDE: e.g., 90 days]` | N/A | Should contain no student PII |
| Anonymous analytics (`sessions`, `events`) | Supabase | `[DECIDE]` | N/A | Anonymous; no student records |
| Database backups / PITR | Supabase (AWS) | `[CONFIRM: Supabase Pro PITR window, e.g., 7 days]` | Aged out within the backup window after primary deletion | See §4 |
| Client-side data (Class Builder rosters, Schedule Builder files) | User device | Controlled by the user | User deletes their own files | Never transmitted to Cohort Logic |

---

## 3. Deletion mechanisms (current + gaps)

**What exists today:**
- **Per-school wipe.** The super-admin panel's `wipeSchoolData()` performs a **full** deletion of a school's student data in foreign-key-safe order — the CICO check-in tree, **all referral records**, the referral config, **and the shared `students` roster** (including demographics). Fixed 2026-07-21 (`public/admin/admin.js`); previously it cleared only the CICO check-in tables and left the roster + referrals behind.
- **Account deactivation** (`approved = false`) and removal via the admin/school-admin RPCs.

**Confirmed finding & the remaining gap:**
- ✅ **RESOLVED (2026-07-21):** the wipe now covers the roster + CICO + referrals + referral config, in FK-safe order (referrals before roster, since `referral_referrals.student_id` is `ON DELETE RESTRICT`).
- ⚠️ **`audit_log` is intentionally NOT purged by the wipe.** It has **no `school_id` column**, so it cannot be filtered per school without a targeted `record_id` sweep, and a blanket delete would destroy every school's trail. Its `old_data`/`new_data` snapshots can embed student rows. Deciding how to purge/anonymize the audit log on **full offboarding** (e.g., add `school_id`, or sweep by record_id) is a **Phase-2** item — tracker **FE-15**.

**Still to build (feed the tracker):**
- **[BUILD]** A documented, repeatable **offboarding SOP**: export offer → confirm → wipe → audit-log handling → confirm backup aging → issue a deletion certificate to the school.
- **[BUILD]** A **deletion-request intake** path (parent/student requests routed through the school; see §5).

---

## 4. Backups

- Student data persists in automated backups after primary deletion until the backup retention window rolls over.
- **Commitment:** deleted data will not be restored into production except as part of a bona fide disaster recovery, and will age out of backups within **[CONFIRM: PITR/backup window]** days.
- **Dependency:** requires Supabase **Pro** (SE-07) for Point-in-Time Recovery and a defined backup retention window; document RPO/RTO (SE-08).

---

## 5. Individual rights (access, correction, deletion)

Under FERPA, parents/eligible students exercise access and amendment rights **through the school**, not directly with the vendor. Cohort Logic's obligation is to **support the school** promptly:

1. School submits a verified access/correction/deletion request on behalf of a parent/student.
2. Cohort Logic fulfills within **[DECIDE: e.g., 15 business days]** (align with any stricter contract/state term).
3. Action is logged in `audit_log`; a confirmation is returned to the school.

(See FE-13 for the request runbook.)

---

## 6. Review

- This policy is reviewed at least annually and whenever the data model or sub-processors change.
- Retention windows and the deletion SOP are referenced by the DPA/NDPA and the Trust page.
