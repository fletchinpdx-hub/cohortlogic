# Cohort Logic — Business Continuity & Disaster Recovery Plan

**Tracker item:** SE-13 (companion to SE-12 Incident Response, SE-07/08 backups)
**Status:** DRAFT — set the `[DECIDE]` RPO/RTO targets and confirm the Supabase backup capability
**Owner:** Michael Fletcher
**Last updated:** 2026-07-21 (by Claude)

> Districts and cyber-insurers ask "what happens if your systems go down or data is lost?" This plan answers it. It depends on the Supabase **Pro** upgrade (SE-07) for Point-in-Time Recovery.

---

## 1. Objectives

- **RTO (recovery time objective):** restore service within **[DECIDE: e.g., 24 hours]** of a major outage.
- **RPO (recovery point objective):** lose no more than **[DECIDE: e.g., 24 hours / the PITR window]** of data.
- Protect the confidentiality and integrity of student data throughout any recovery.

## 2. What we depend on (single points of failure)

| Dependency | Role | If it fails |
|---|---|---|
| **Supabase** (Postgres/Auth on AWS) | All server-side data + login | Highest-impact. Mitigation: Pro backups + PITR (SE-07/08); provider has AWS-level redundancy |
| **Cloudflare** | Hosting/CDN/edge | Static assets; globally redundant; low data-loss risk |
| **Domain/DNS** (Cloudflare) | Reachability | Documented registrar/DNS recovery |
| **Founder availability** (solo) | Operator | Key-person risk — see §6 |

## 3. Backup strategy

- **Automated database backups + Point-in-Time Recovery** via Supabase Pro (SE-07/08). Document the exact **backup frequency and retention window** once Pro is enabled `[CONFIRM]`.
- **Client-side data** (Class Builder rosters, Schedule Builder files) is the user's responsibility — the app prompts users to download/save their schedule files.
- **Config-as-code:** the app, schema migrations, and security tooling live in Git (GitHub) — infrastructure is reproducible from the repo.

## 4. Recovery scenarios & procedures

**A. Data corruption / accidental deletion.** Identify the last-good point → restore via Supabase PITR to that timestamp → verify with the daily security agent + spot checks → notify affected schools if data was lost.

**B. Full database loss.** Restore from the most recent backup → re-point the app → verify auth + RLS → communicate status. Data since the last recovery point is lost up to the RPO.

**C. Hosting/edge outage (Cloudflare).** Usually provider-side and self-resolving; monitor the provider status page; communicate via the status page (SE-14). Re-deploy from Git if needed (`scripts/deploy.sh`).

**D. Account/credential compromise.** Follow the Incident Response Plan (`04_...`): rotate secrets, revoke sessions, restore integrity.

## 5. Communication during an outage

- Post status and ETA on the public **status page** (SE-14) and, for data-affecting events, notify schools directly (tie to breach policy `05_...` if student data is involved).
- Single owner (the Incident Commander) approves external messaging.

## 6. Key-person risk (solo founder)

Documented mitigations while the team is one person: everything is in Git; credentials are recoverable via the documented rotation path and provider account recovery; **[DECIDE:** designate a trusted technical contact and document emergency access so the business survives founder unavailability**]**. Revisit as the team grows.

## 7. Testing

- **Annually:** perform a **test restore** from backup (validates SE-08) and a tabletop walk-through of scenario B, recording actual RTO/RPO achieved vs. target.
- Update this plan after each test or real event.
