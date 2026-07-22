# Cohort Logic — Data Processing Agreement (SHORT-FORM TEMPLATE)

**Tracker item:** FE-02 (Phase 1)
**Status:** TEMPLATE for attorney review — **do not sign as-is.** A fill-in-the-blanks agreement to offer districts that require one. For districts that mandate the **SDPC NDPA**, use theirs and attach Exhibit B from `07_...` instead.
**Owner:** Michael Fletcher — **must be reviewed by a licensed attorney before use**
**Last updated:** 2026-07-21 (by Claude)

> Because the launch products (Class Builder, Schedule Builder) **don't store student data on our servers**, this DPA is short and the data schedule is nearly empty — a genuine advantage in procurement. `[BRACKETS]` are fill-ins.

---

## DATA PROCESSING AGREEMENT

This Data Processing Agreement ("DPA") is entered into by **`[Cohort Logic entity — confirm PBC/LLC]`** ("Provider") and **`[School / District name]`** ("LEA"), and supplements the Terms of Service / Master Services Agreement between them (the "Agreement"). If it conflicts with the Agreement on the handling of Student Data, this DPA controls.

**1. Definitions.** "Student Data" means personally identifiable information from student education records. "Applicable Law" includes FERPA, COPPA, and applicable state student-privacy laws.

**2. Roles.** The LEA controls its education records. Provider acts as a **school official with a legitimate educational interest** under FERPA (34 CFR §99.31(a)(1)(i)(B)), under the LEA's direct control as to the use and maintenance of any education records, and processes data only to provide the services in the Agreement.

**3. Nature of processing (product-specific).** The Provider's launch products operate **in the end user's browser**: student rosters and schedules are processed **on the LEA's devices and are not transmitted to or stored on Provider's servers.** Provider stores only LEA staff account information (name, email, school, role) and anonymous, non-identifying usage analytics. **Provider does not receive, store, or maintain Student Data for these products.** *(This section is amended if/when the LEA enables a Provider product that stores Student Data.)*

**4. Use limitations.** Provider will: (a) use any data only to provide and support the services; (b) **not sell** data; (c) **not use** data for targeted advertising or to build non-educational profiles; (d) **not use** data to train machine-learning/AI models; (e) **not disclose** data except to the sub-processors in Exhibit C or as the LEA authorizes or law requires.

**5. Security.** Provider maintains reasonable administrative, technical, and physical safeguards, including encryption in transit and at rest, role-based access with approval, per-school/per-account isolation (row-level security), audit logging, and ongoing security monitoring.

**6. Sub-processors.** Provider uses the sub-processors in **Exhibit C**, bound to obligations no less protective than these. Provider will update the list before adding a sub-processor that would handle LEA data.

**7. Data breach.** Provider will notify the LEA of a confirmed breach affecting LEA data **without unreasonable delay, and no later than `[7]` calendar days** after discovery, cooperate with the LEA's response, and — where the breach is attributable to Provider — bear the LEA's reasonable notification costs. *(7 days satisfies the strictest state we've identified; tighten per contract if required.)*

**8. Data return and deletion.** On termination or LEA request, Provider will delete LEA account data within **`[30]` days**; because Student Data for the launch products lives on LEA devices, it remains with the LEA. Backups age out within **`[90]` days**.

**9. Parent/student rights.** Provider will support the LEA's fulfillment of access, correction, and deletion requests routed through the LEA.

**10. Compliance & term.** Provider complies with Applicable Law. This DPA runs for the term of the Agreement and survives as to any retained data until deletion.

**Signatures.** `[Provider name, title, date]` · `[LEA name, title, date]`

---

### Exhibit A — Services
`[List the products the LEA is using: Class Builder, Schedule Builder.]`

### Exhibit B — Schedule of Student Data
**For the launch products, Provider stores no Student Data on its servers.** Data processed **in-browser only** (not transmitted to Provider): student name/identifier, grade, and any attributes the LEA includes in its own roster/schedule files. Provider-stored data: LEA staff name, email, school, role; anonymous usage analytics.

### Exhibit C — Sub-processors
| Sub-processor | Purpose | Location |
|---|---|---|
| Supabase (Postgres on AWS) | Accounts + authentication, anonymous analytics | United States `[confirm]` |
| Cloudflare | Hosting / CDN / security edge | Global edge |

---

### Reviewer notes (not part of the agreement)
- Attorney must confirm the §2/§3 school-official + "no Student Data stored" framing and the §7 breach terms.
- Fill the `[BRACKETS]`: entity, LEA, day-counts (defaults from `20_...`), signatures.
- If a district sends its **own** DPA or the SDPC NDPA, use theirs — this template is for when *you* need to supply one.
- Keep numbers consistent with the Privacy Policy (`17_...`) and Retention Policy (`02_...`).
