# Cohort Logic — DPA / SDPC NDPA Readiness Brief

**Tracker items:** FE-02 (DPA template), FE-03 (adopt SDPC NDPA), feeds BI-10 (legal DPA exhibit)
**Owner:** Michael Fletcher (Cohort Logic) — **legal review required before signing anything**
**Status:** DRAFT — readiness plan + prepared inputs
**Last updated:** 2026-07-21 (by Claude), informed by background legal research

> Districts increasingly will not sign a vendor's home-grown data agreement — they send you **theirs**, and the national standard is the **SDPC National Data Privacy Agreement (NDPA)**. Being "NDPA-ready" is the single biggest procurement-efficiency lever for selling to many districts.

---

## 1. What the NDPA is

The **National Data Privacy Agreement (NDPA)** is a model student-data-privacy contract from the **Student Data Privacy Consortium (SDPC)**, a program of the **Access 4 Learning (A4L) Community**. One common contract, signed by a district (LEA) and a provider, standardizes privacy obligations so vendors don't renegotiate from scratch with every district.

- **Current version:** **NDPA v2.2 (published 2025-11-19).** Variants: Standard, Vendor-Specific, District-Modified. `[VERIFY exact current version at signing — versions update.]`
- **Signing a district's NDPA obligates the provider to:** use student data only to deliver the contracted services (no secondary/commercial use); no selling data; no targeted advertising with covered data; maintain the security controls declared in Exhibit F; return or destroy data on termination; notify the LEA of a breach within the contractual/statutory window; flow equivalent terms to subcontractors; and honor parent/eligible-student access rights **through the LEA**.

---

## 2. NDPA structure — Standard Clauses + Exhibits

The agreement is a set of **Standard Clauses** (do **not** redline these — redlining forces a non-Standard agreement and kills the piggyback benefit) plus lettered exhibits:

| Exhibit | Title | What we provide / do |
|---|---|---|
| **A** | Description of Services | List **all** Cohort Logic products the LEA uses (Class Builder, CICO, Schedule Builder, Referral Tracking) |
| **B** | **Schedule of Data** | **The data-elements table** — check the categories of student data we collect. Prefilled from our data map (see §4). *(This is the exhibit people mislabel "data elements / Exhibit E" — it's **B**.)* |
| **C** | Definitions | Standard defined terms |
| **D** | Directive for Disposition of Data `[VERIFY exact title in v2.2]` | Data return/destruction directive on termination — ties to our retention policy |
| **E** | **General Offer of Privacy Terms** | **Sign this** — it lets *other* LEAs in the state/alliance adopt the same terms without renegotiating. The piggyback lever. |
| **F** | Data Security Requirements | Declare which recognized cybersecurity framework(s) we align to (target: **NIST CSF**) |
| **G** | Supplemental State Terms | State-specific mandatory additions (uniform across an alliance) |
| **H** | Modifications | Any non-state redlines (avoid where possible) |

---

## 3. Becoming "NDPA-ready" — the plan

1. **Join SDPC as a vendor member** → gets a Resource Registry profile and access to the signatory/badge program. (The SDPC Resource Registry is the public repository of signed DPAs across thousands of districts and providers.)
2. **Prepare our standing inputs in advance** (so we can turn around any district's NDPA fast): the **Exhibit A product list**, the **Exhibit B data-elements selection** (§4), our **Exhibit F framework declaration** (NIST CSF once SE-items land), and our **sub-processor list** (Supabase, Cloudflare).
3. **When a district ("Originating LEA") sends an NDPA:** complete Exhibit A + B, confirm F, **do not redline the Standard Clauses**, and **sign Exhibit E** (General Offer) so other LEAs can piggyback.
4. **Upload to the Resource Registry** (usually the LEA does this) so future districts can find and reuse our signed terms.
5. **State alliances** (IL, NY, CA/CSDPA, MO, etc.) sit under the national SDPC umbrella — a signed alliance agreement is reusable in-state via Exhibit E.

**Legal note:** we still want our **own** attorney-reviewed DPA/MSA (BI-09/10) for districts that *don't* use the NDPA, kept substantively consistent with the NDPA so we're not maintaining two conflicting privacy postures.

---

## 4. Prepared input — Exhibit B "Schedule of Data" (from our data map)

This is the data-elements selection a district's NDPA Exhibit B asks us to check, derived from `01_Data_Inventory_and_Data_Map.md`. **Confirm before signing.**

**Student data we DO collect (CICO + Referrals):**
- Name (first/last), grade level, homeroom/teacher, school-assigned student ID
- Demographics: race/ethnicity, gender, IEP/special-indicator status *(equity reporting only)*
- Behavior data: daily check-in/check-out scores, behavior incidents
- Discipline data: office-discipline referrals (location, behavior, motivation, action, notes, custom fields)
- Audit metadata that may embed the above (`audit_log`)

**Student data we DO NOT collect / store server-side:**
- No SSN, no biometric data, no health records beyond the IEP flag, no financial data
- **No Class Builder rosters** (processed in-browser, never stored server-side)
- **No Schedule Builder student data** (file-based, never stored server-side)
- No student contact info (email/phone/address), no geolocation

**Sub-processors:** Supabase (managed Postgres on AWS), Cloudflare (edge/CDN). US region `[CONFIRM — FE-06]`.

---

## 5. Sequencing

1. Have counsel review this brief + the FERPA posture memo (FE-01) and produce the **own-paper DPA/MSA** (BI-08/09/10).
2. Join SDPC; stand up the Registry profile.
3. Finalize Exhibit B selection (§4) and the NIST-CSF alignment claim for Exhibit F (depends on the SE security items).
4. Sign Exhibit E on the first district NDPA to unlock piggyback reach.

---

## 6. Verify with counsel

- Confirm current **NDPA version** and the exact **Exhibit D** title/contents at signing.
- Confirm our **Exhibit B** selections and **Exhibit F** framework claim are accurate and defensible.
- Confirm consistency between the NDPA obligations and our own-paper DPA/MSA so we never present two different privacy commitments.
