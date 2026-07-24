# Cohort Logic — Recommended Defaults & Open Decisions

**Status:** Recommendations to approve — clears the `[DECIDE]` / `[FILL]` / `[CONFIRM]` blanks scattered through the compliance docs
**Owner:** Michael Fletcher
**Last updated:** 2026-07-21 (by Claude)

> Instead of leaving every blank open, here is a recommended value for each, with the reasoning. **Approve the ones you're happy with and I'll apply them across the docs;** the rest are things only you can supply or must confirm externally.

---

> **✅ Section A APPROVED 2026-07-24.** Rows 1–12 approved as recommended; Row 13 refined (see its row). Values applied across docs 02, 12, 14, 17, 18, 19. Section B/C still open.

## A. Recommended values — just approve (I apply them)

| # | Item | Doc | Recommended value | Why |
|---|---|---|---|---|
| 1 | Data deletion after request/termination | 02, 17 | **30 days** | Matches your already-published privacy page; industry-normal |
| 2 | Inactive-account deletion | 02, 17 | **12 months** of non-use, after notice | Matches your published page |
| 3 | Backup retention window | 02, 12, 18 | ~~90 days~~ → **7 days** (encrypted daily) — **superseded 2026-07-24** by the confirmed Supabase Pro reality (see C20). The published "90 days" didn't match the provider; docs corrected to 7 days. | Provider-actual, not aspirational |
| 4 | Staff/user account deletion after request | 02 | **30 days** | Consistent with row 1 |
| 5 | Feedback retention | 02 | **24 months** | Long enough to act on; not indefinite |
| 6 | Marketing (contact/newsletter) retention | 02 | Until unsubscribe; purge after **24 months** inactive | Honors opt-out; avoids stale PII |
| 7 | Error-log retention | 02 | **90 days** | Enough for debugging; keeps PII exposure short |
| 8 | Anonymous analytics retention | 02 | **24 months** | Product trend analysis; no personal data anyway |
| 9 | Individual data-request turnaround | 02, 14 | **15 business days** | Reasonable; beats most state deadlines |
| 10 | Disaster-recovery **RTO** | 12 | **24 hours** | Realistic for a solo-run SaaS with no student data at stake |
| 11 | Disaster-recovery **RPO** | 12 | **24 hours** (≤ backup cadence) | Ties to the backup window |
| 12 | Governing law / venue | 09, 19, 10 | **State of Oregon** | Your home state (Portland); attorney to confirm |
| 13 | Free launch period | 17, 19 | ✅ **DECIDED 2026-07-24: Free through Sept 30, 2026**, disclosed at signup + in ToS §7. No separate notice for the scheduled end (it's disclosed up front, and no card is charged without an affirmative paid signup). The existing **60-day email** commitment is kept but scoped to *early termination of the free window or go-forward pricing* — reconciled with the live pricing-page line. Signup disclosure + ToS §7 wording + pricing-page reconciliation are queued in [23_Site_and_Software_Change_Queue.md](23_Site_and_Software_Change_Queue.md) (A1/A2). | Was "60-day notice before any change" — refined so hitting the disclosed Sept 30 date isn't treated as a change requiring notice |

## B. You must supply these (I can't invent them)

| # | Item | Doc | What's needed |
|---|---|---|---|
| 14 | **Entity name/type** | all footers, BI-01 | ✅ **RESOLVED: Cohort Logic, LLC.** The site footers wrongly say "Cohort Logic, PBC" (a different entity type) on 10 pages — fix to "LLC" in the website batch. All `[confirm PBC/LLC]` placeholders resolve to **LLC**. |
| 15 | **Contact addresses** | 08/17/19/11/14 | ✅ **DECIDED 2026-07-24:** `privacy@`, `security@`, `legal@`, `hello@` — all pointing to one box for now. Applied across the docs. **⏳ Owed:** actually create them via **Cloudflare Email Routing** (free; forward to the central Gmail) — receive/forward works out of the box; add Gmail "Send As" later if sending as those addresses is needed. |
| 16 | **Incident-response contacts** | 04 | ⏳ **OPEN.** Internal response roster (these are people *we* call, not customer-facing): breach counsel (BI-14), cyber-insurance breach hotline + policy # (BI-04), Supabase support plan, Cloudflare support. Partly depends on obtaining insurance/counsel. |
| 17 | **DR key-person contact** | 12 | ✅ **DECIDED 2026-07-24: Shawn Fletcher** is the designated backup contact. **⏳ Owed:** provision Shawn's logins (Supabase, Cloudflare, GitHub) + a `@cohortlogic.com` email, and document emergency-access instructions, before the mitigation is operational. |
| 18 | **Liability cap / warranty posture** | 09/19/10 | ⏳ **OPEN** — Michael to address. Attorney decision, coordinated with insurance limits (BI-04/05). |
| 22 | **PO box / registered-agent address** | 10 (MSA), CAN-SPAM email footer | ⏳ **OPEN (new 2026-07-24).** Home address is currently the notice address in the MSA/DPA (private contracts only, not on the site). Decide whether to get a PO box / use the registered-agent address so the home address isn't in every district's contract files or the required marketing-email footer. |

## C. Confirm externally (then I apply)

| # | Item | Doc | How to confirm |
|---|---|---|---|
| 19 | **Supabase data region = US** | 01/08/17/18, FE-06 | ✅ **CONFIRMED 2026-07-24.** `[confirm]` placeholders removed across docs 17/18. |
| 20 | **Supabase plan → backup posture** | 02, 12, 18, SE-07/08 | ✅ **DECIDED 2026-07-24: Supabase Pro-minimal (~$25/mo, no PITR).** Removes auto-pause; provides **7-day daily encrypted backups**. Note: the earlier Section-A "90 days" figure was superseded — Pro's real window is **7 days** (fine for Phase 1; 90-day recoverability would need PITR/custom exports, not needed). Docs 02/12/18 finalized to 7-day reality. **⏳ Michael is enabling Pro in the Supabase dashboard.** SE-07/08 → Done once enabled. |
| 21 | **Encryption-at-rest wording** | 08/17/18 | ✅ **CONFIRMED + APPLIED 2026-07-24.** Verified from Supabase's published security statement: **AES-256 at rest, TLS in transit, SOC 2 Type 2, ISO 27001** (also HIPAA under BAA — not claimed). Wording applied to docs 17 (privacy) + 18 (trust), attributed to the *providers* (Cohort Logic is not itself SOC 2 audited). |

---

### How to use this
Reply with which A-rows you approve (or "all of A"), supply what you can from B, and I'll fill every matching blank across docs 02, 04, 12, 14, 17, 18, 19 in one pass and regenerate them. B/C items I'll leave as clearly-marked placeholders until you have them.
