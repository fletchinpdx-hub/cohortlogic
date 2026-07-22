# Cohort Logic — Recommended Defaults & Open Decisions

**Status:** Recommendations to approve — clears the `[DECIDE]` / `[FILL]` / `[CONFIRM]` blanks scattered through the compliance docs
**Owner:** Michael Fletcher
**Last updated:** 2026-07-21 (by Claude)

> Instead of leaving every blank open, here is a recommended value for each, with the reasoning. **Approve the ones you're happy with and I'll apply them across the docs;** the rest are things only you can supply or must confirm externally.

---

## A. Recommended values — just approve (I apply them)

| # | Item | Doc | Recommended value | Why |
|---|---|---|---|---|
| 1 | Data deletion after request/termination | 02, 17 | **30 days** | Matches your already-published privacy page; industry-normal |
| 2 | Inactive-account deletion | 02, 17 | **12 months** of non-use, after notice | Matches your published page |
| 3 | Backup retention window | 02, 12, 17 | **90 days** (encrypted), then overwritten | Matches your published page; confirm against Supabase Pro (row C) |
| 4 | Staff/user account deletion after request | 02 | **30 days** | Consistent with row 1 |
| 5 | Feedback retention | 02 | **24 months** | Long enough to act on; not indefinite |
| 6 | Marketing (contact/newsletter) retention | 02 | Until unsubscribe; purge after **24 months** inactive | Honors opt-out; avoids stale PII |
| 7 | Error-log retention | 02 | **90 days** | Enough for debugging; keeps PII exposure short |
| 8 | Anonymous analytics retention | 02 | **24 months** | Product trend analysis; no personal data anyway |
| 9 | Individual data-request turnaround | 02, 14 | **15 business days** | Reasonable; beats most state deadlines |
| 10 | Disaster-recovery **RTO** | 12 | **24 hours** | Realistic for a solo-run SaaS with no student data at stake |
| 11 | Disaster-recovery **RPO** | 12 | **24 hours** (≤ backup cadence) | Ties to the backup window |
| 12 | Governing law / venue | 09, 19, 10 | **State of Oregon** | Your home state (Portland); attorney to confirm |
| 13 | Free launch period | 17, 19 | **Free through Sept 30, 2026**, 60-day notice before any change | Already your public commitment |

## B. You must supply these (I can't invent them)

| # | Item | Doc | What's needed |
|---|---|---|---|
| 14 | **Entity name/type** | all footers, BI-01 | Footer says "Cohort Logic, PBC" — confirm the true legal entity and make it consistent everywhere |
| 15 | **Contact addresses** | 08/17/19/11/14 | Create + confirm `privacy@`, `security@`, `legal@` (or point all at `hello@` for now) |
| 16 | **Incident-response contacts** | 04 | Breach counsel (BI-14), cyber-insurance breach hotline + policy # (BI-04), Supabase support plan, Cloudflare support |
| 17 | **DR key-person contact** | 12 | Designate one trusted technical contact + document emergency access (solo-founder mitigation) |
| 18 | **Liability cap / warranty posture** | 09/19/10 | Attorney decision, coordinated with your insurance limits (BI-04/05) |

## C. Confirm externally (then I apply)

| # | Item | Doc | How to confirm |
|---|---|---|---|
| 19 | **Supabase data region = US** | 01/08/17/18, FE-06 | Supabase dashboard → project settings → region |
| 20 | **Backup/PITR window** | 12, SE-08 | Enable Supabase **Pro**, then read the actual PITR retention (row 3 assumes 90-day encrypted backups; PITR is typically a shorter window — reconcile) |
| 21 | **Encryption-at-rest wording** | 08/17/18 | Supabase/AWS attestation language (FE-09/SE-09) |

---

### How to use this
Reply with which A-rows you approve (or "all of A"), supply what you can from B, and I'll fill every matching blank across docs 02, 04, 12, 14, 17, 18, 19 in one pass and regenerate them. B/C items I'll leave as clearly-marked placeholders until you have them.
