# Cohort Logic — State Student-Privacy Law Matrix

**Tracker item:** FE-10
**Owner:** Michael Fletcher (Cohort Logic)
**Status:** DRAFT — research-sourced; statute citations/timelines marked `[VERIFY]` must be confirmed by counsel before relied upon in a contract or public statement
**Last updated:** 2026-07-21 (by Claude), from background legal research

> Selling nationwide means layering **state** student-privacy laws on top of FERPA/COPPA. Most impose the same core operator duties (no sale, no targeted ads, purpose limitation, security, deletion); the differences that matter operationally are **breach timelines** and **specific artifacts** (e.g., NY's Parents' Bill of Rights + NIST-aligned security plan). Build to the strictest common denominator and you cover most states.

---

## Comparison table

| State | Statute | Applies to | Top vendor obligations | Breach timeline (vendor → school unless noted) | Source |
|---|---|---|---|---|---|
| **CA** | SOPIPA (Bus. & Prof. Code §22584); AB 1584 (Ed. Code §49073.1) | Operators marketed for K-12 (SOPIPA applies **even without a contract**) + contract parties | No sale; no targeted ads; no student profiling except for school purposes; reasonable security; deletion on request; contract keeps records as district property | No sector-specific day-count; general Civ. Code §1798.82 ("without unreasonable delay") | law.cornell / findlaw (§22584) |
| **NY** | Education Law §2-d; 8 NYCRR Part 121 | Educational agencies + **third-party contractors** | Adopt **Parents' Bill of Rights**; maintain a **Data Security & Privacy Plan aligned to NIST CSF**; purpose limitation; no sale/marketing; encryption; subcontractor flow-down | **7 calendar days** to agency; agency→NYSED 10 days; agency→parents 60 days; **contractor reimburses notification cost** | nysed.gov; 8 NYCRR §121.10 |
| **IL** | SOPPA (105 ILCS 85), strengthened eff. 2021-07-01 | Operators + districts | **Written agreement before receiving data**; reasonable security; no sale/rent; no targeted ads; deletion; support district's public transparency posting | **30 days** to school `[VERIFY]`; school posts within 10 days; **DPA + data elements become public** | ktjlaw / SOPPA summaries |
| **CO** | Student Data Transparency & Security Act (HB 16-1423; C.R.S. §22-16-101 et seq.) | School service contract/on-demand providers | No sale; no targeted ads; purpose limitation; deletion; security policy; transparency publication | Provider-specific day-count `[VERIFY]`; general §6-1-716 = 30 days | cde.state.co.us |
| **VA** | Va. Code §22.1-289.01 `[cite VERIFY]` | Providers under contract with school divisions | Comprehensive infosec program; no secondary/unauthorized use; subcontractor equivalence | `[VERIFY]` | edprivacy.com/state-guides/virginia |
| **TX** | Tex. Educ. Code §§32.151–32.156 (HB 2087) `[sections VERIFY]` | Operators of school-purpose sites/apps | No sale; no targeted ads; no profiling; reasonable security; deletion; may require state data-sharing agreement w/ unique ID | `[VERIFY]` | capitol.texas.gov |
| **CT** | Student Data Privacy Act (PA 16-189; C.G.S. §§10-234aa–dd) | Contractors with boards of education | No secondary use; deletion; security; required contract provisions; breach cost-bearing | Initial "ASAP"; detailed **≤30 days** `[VERIFY]` | law.justia.com (§10-234aa) |

---

## What this means for the product & contracts

1. **The common core is already our design goal:** no sale, no targeted advertising, no secondary use, purpose limitation, reasonable security, deletion on request. Stating these plainly in the privacy policy (FE-08) and DPA (FE-02) satisfies the bulk of every state above.
2. **New York is the high bar.** If you pursue NY districts you must produce a **Parents' Bill of Rights** and a **Data Security & Privacy Plan aligned to the NIST Cybersecurity Framework**, and accept a **7-day** breach-notice ceiling with cost reimbursement. Aligning your security program to NIST CSF also earns credit on the NDPA's Exhibit F and is good practice everywhere. (Tracker: FE-11.)
3. **Illinois makes your DPA public.** Under SOPPA, districts publish the operator list, the data elements collected, and the agreements. Assume your NDPA **Exhibit B (Schedule of Data)** will be visible to parents — keep it accurate and minimal.
4. **California's SOPIPA binds you even without a signed contract** because you're "marketed for K-12." The no-sale/no-ads/no-profiling duties are not contingent on a district agreement.
5. **Breach timing:** the **72-hour default / 7-day ceiling** in `05_Data_Breach_Notification_Policy.md` is set specifically to satisfy NY (7 days) and IL (30 days) simultaneously.

---

## Items requiring counsel verification (do not rely on until confirmed)

1. **IL SOPPA 30-day operator figure** — confirm against 105 ILCS 85/30 statutory text (came from a secondary summary).
2. **CO** — whether a school-service provider has a hard statutory breach day-count under Art. 22-16, or only via the general §6-1-716 (30 days).
3. **VA** — confirm exact code section (likely §22.1-289.01) and any breach timeline.
4. **TX** — confirm current codified Education Code sections and any vendor breach timeline.
5. **CT** — verify the ≤30-day detailed-notice figure against §10-234dd.
6. General: this matrix covers 7 states. Before entering a new state, add a row and confirm its specifics — several other states (e.g., WA, GA, LA, TN, UT) have student-privacy statutes not yet mapped here.

*Sources gathered from primary statutes and state education/AG pages plus reputable legal summaries during 2026-07-21 research; full URLs retained in the research record.*
