# Cohort Logic — Data Access / Correction / Deletion Request Runbook

**Tracker item:** FE-13
**Status:** DRAFT — operational runbook
**Owner:** Michael Fletcher
**Last updated:** 2026-07-21 (by Claude)

> Under FERPA, parents/eligible students exercise data rights **through the school**, not directly with the vendor. This runbook is how Cohort Logic responds when a school submits such a request. Ties to the retention policy (`02_...` §5).

---

## 1. Principle

The **school is the data controller**. Cohort Logic does not act on a parent's request directly; we **support the school**, which verifies the requester's identity and authority. If a parent contacts us directly, we refer them to their school and (if the school is a customer) notify the school's admin.

## 2. Request types and how we fulfill them

| Request | How it's handled | Target time |
|---|---|---|
| **Access / review** | Most data is self-serve: the school admin can view/export student records in-app. For anything not self-serve, we assist. | **[DECIDE: 15 business days]** |
| **Correction / amendment** | The school edits records directly in-app (changes are captured in the audit log). We assist if a change isn't reachable in the UI. | Self-serve / [15 business days] |
| **Deletion** | School admin deletes an individual student, or requests full-school deletion (completed within **30 days** per the retention policy; backups age out within 90 days). | Per retention policy |
| **Restriction / stop processing** | School can deactivate users/records or disable a product; full stop = offboarding (`02_...`). | Per request |

## 3. Steps for a request from a school

1. **Receive & log** the request (who, school, type, date) in a request log.
2. **Confirm authority** — requester is an authorized admin of a customer school (verify against `profiles`/school records).
3. **Fulfill** using the self-serve tools where possible; assist directly otherwise.
4. **Record** the action in the FERPA `audit_log`.
5. **Confirm** completion back to the school in writing, within the target time.

## 4. Notes

- Keep a simple **request register** (date, school, type, resolution, date closed) — questionnaires and some state laws expect you to demonstrate a process exists.
- Set the dedicated intake address **[privacy@cohortlogic.com]** and reference it in the Privacy Policy.
- Decide the `[DECIDE]` access/correction turnaround and align it with any stricter contract or state-law deadline.
