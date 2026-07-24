# Cohort Logic — Business Continuity & Disaster Recovery Plan

**Tracker item:** SE-13 (companion to SE-12 Incident Response, SE-07/08 backups)
**Status:** DRAFT — RTO/RPO set (24h/24h), Supabase Pro enabled (7-day daily backups, no PITR), backup contact = Shawn Fletcher (§6, provisioning pending). Effectively complete pending Shawn's provisioning + an annual test-restore.
**Owner:** Michael Fletcher
**Last updated:** 2026-07-24 (by Claude)

> Districts and cyber-insurers ask "what happens if your systems go down or data is lost?" This plan answers it. It relies on **Supabase Pro** (enabled 2026-07-24) for automated daily backups and no-pause availability. PITR is not enabled (not needed for Phase 1 — no student data at rest).

---

## 1. Objectives

- **RTO (recovery time objective):** restore service within **24 hours** of a major outage.
- **RPO (recovery point objective):** lose no more than **24 hours** of data (≤ the backup/PITR cadence).
- Protect the confidentiality and integrity of student data throughout any recovery.

## 2. What we depend on (single points of failure)

| Dependency | Role | If it fails |
|---|---|---|
| **Supabase** (Postgres/Auth on AWS) | All server-side data + login | Highest-impact. Mitigation: Pro **7-day daily backups** (SE-07/08); provider has AWS-level redundancy |
| **Cloudflare** | Hosting/CDN/edge | Static assets; globally redundant; low data-loss risk |
| **Domain/DNS** (Cloudflare) | Reachability | Documented registrar/DNS recovery |
| **Founder availability** (solo) | Operator | Key-person risk — see §6 |

## 3. Backup strategy

- **Backups (Supabase Pro, enabled 2026-07-24):** no auto-pause, and **7-day daily encrypted backups**. Recovery granularity is one day (last daily snapshot), consistent with the 24h RPO. The **PITR** add-on ($100/mo) is intentionally not enabled — unnecessary for Phase 1 (no student data at rest). If longer-than-7-day retention is ever wanted, add periodic manual exports rather than PITR.
- **Client-side data** (Class Builder rosters, Schedule Builder files) is the user's responsibility — the app prompts users to download/save their schedule files.
- **Config-as-code:** the app, schema migrations, and security tooling live in Git (GitHub) — infrastructure is reproducible from the repo.

## 4. Recovery scenarios & procedures

**A. Data corruption / accidental deletion.** Restore from the most recent **daily backup** (Supabase Pro) — recovery granularity is one day, matching the 24h RPO (no PITR, so restore is to the last daily snapshot, not an arbitrary timestamp) → verify with the daily security agent + spot checks → notify affected schools if data was lost.

**B. Full database loss.** Restore from the most recent backup → re-point the app → verify auth + RLS → communicate status. Data since the last recovery point is lost up to the RPO.

**C. Hosting/edge outage (Cloudflare).** Usually provider-side and self-resolving; monitor the provider status page; communicate via the status page (SE-14). Re-deploy from Git if needed (`scripts/deploy.sh`).

**D. Account/credential compromise.** Follow the Incident Response Plan (`04_...`): rotate secrets, revoke sessions, restore integrity.

## 5. Communication during an outage

- Post status and ETA on the public **status page** (SE-14) and, for data-affecting events, notify schools directly (tie to breach policy `05_...` if student data is involved).
- Single owner (the Incident Commander) approves external messaging.

## 6. Key-person risk (solo founder)

Documented mitigations while the team is one person: everything is in Git; credentials are recoverable via the documented rotation path and provider account recovery. **Designated backup contact: Shawn Fletcher** (set 2026-07-24) — a second person who can act if the founder is unavailable. *Pending (Doc 20 B): Shawn still needs provisioned logins (Supabase, Cloudflare, GitHub) and a `@cohortlogic.com` email + documented emergency-access instructions before this mitigation is fully operational.* Revisit as the team grows.

## 7. Testing

- **Annually:** perform a **test restore** from backup (validates SE-08) and a tabletop walk-through of scenario B, recording actual RTO/RPO achieved vs. target.
- Update this plan after each test or real event.
