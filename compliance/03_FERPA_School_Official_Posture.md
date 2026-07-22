# Cohort Logic — FERPA "School Official" Posture Memo

**Tracker item:** FE-01
**Owner:** Michael Fletcher (Cohort Logic) — **requires attorney review before relied upon**
**Status:** DRAFT — internal working memo to align product/contract language with FERPA
**Last updated:** 2026-07-21 (by Claude)

> **This is not legal advice.** It is a plain-language working memo so that our contracts, privacy policy, and product all tell the same, defensible FERPA story. A licensed education-privacy attorney must confirm the regulatory reading and the contract language (FE-02, BI-08/09/10) before we rely on it with a paying district.

---

## 1. The question

FERPA (20 U.S.C. § 1232g; 34 CFR Part 99) generally bars a school from disclosing personally identifiable information (PII) from a student's **education records** without written parental consent. A cloud vendor like Cohort Logic receives that PII. **What lets a district share student data with us without collecting individual parental consents?**

Answer: the **"school official" exception** (34 CFR § 99.31(a)(1)(i)(B)), which lets a school designate an outside party as a "school official" with a "legitimate educational interest," provided specific conditions are met.

---

## 2. The four conditions (and how Cohort Logic meets each)

To qualify as a school official, the outside party must:

| # | FERPA condition (34 CFR §99.31(a)(1)(i)(B) & §99.33) | How Cohort Logic satisfies it |
|---|---|---|
| 1 | **Performs an institutional service or function** for which the school would otherwise use employees. | We provide classroom balancing, behavior tracking (CICO), scheduling, and referral tracking — administrative functions a school would otherwise staff internally. |
| 2 | Is under the **direct control** of the school with respect to the **use and maintenance** of education records. | The district's DPA gives it control: it grants/revokes access, directs permitted use, and can require return/deletion. Operationally, the school approves its own users and controls its roster; our staff do not use the data independently. |
| 3 | **Uses education records only for authorized purposes** and **does not redisclose** PII to third parties (§99.33(a)) unless the school authorizes it. | Contract commits us to use data solely to provide the service; no sale, no advertising, no secondary use, no training of models. Sub-processors (Supabase, Cloudflare) are disclosed and bound; no other redisclosure. |
| 4 | The school uses **reasonable methods** to ensure the vendor accesses only records in which it has a legitimate educational interest. | Multi-tenant Row-Level Security restricts every user (and by extension the service) to a single school's data; roles further scope access within a school. |

---

## 3. What we must have in place to stand behind this

FERPA compliance here is **mostly contractual and operational**, not a certificate. To be defensible we need:

1. **DPA language** in every school contract that expressly:
   - designates Cohort Logic as a school official with a legitimate educational interest;
   - places us under the district's **direct control** for use and maintenance of education records;
   - **limits use** to providing the service and **prohibits redisclosure** and secondary use;
   - requires **return or deletion** of data on termination (see `02_...Retention...`);
   - lists **sub-processors** and binds them to equivalent terms;
   - commits us to **reasonable security** (our RLS/encryption/audit posture).
   → Tracker: FE-02 (DPA template), aligned to the SDPC **NDPA** (FE-03).
2. **A privacy policy** that states the no-sale / no-advertising / no-secondary-use commitments explicitly (FE-08).
3. **The operational reality matching the paper:** access controls, audit logging, deletion capability, sub-processor list — all of which we largely have and which the daily security agent monitors.

---

## 4. Adjacent obligations (flag, handled elsewhere)

- **COPPA** (under-13 students): the school can consent on parents' behalf for educational use, but we must not use the data commercially and must delete on request — consistent with §2 above. (FE-09)
- **State laws** frequently add specifics on top of FERPA (e.g., NY Ed Law 2-d's Parents' Bill of Rights + security plan; IL SOPPA's breach timeline; CA SOPIPA's operator duties). Tracked in the state matrix (FE-10) and `06_State_Student_Privacy_Matrix.md`.
- **Directory information / consent nuances** are the school's determination, not ours — but our contract should not undercut them.

---

## 5. Bottom line

Cohort Logic's **architecture already supports** a clean school-official posture (tenant isolation, minimization, audit, no secondary use). The **gap is paper**: an attorney-reviewed DPA/NDPA and privacy policy that state the four conditions explicitly. Closing FE-02, FE-03, and FE-08 converts a good technical story into a contract a district's counsel can sign.
