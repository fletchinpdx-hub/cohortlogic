# Cohort Logic — Secrets Management Policy

**Tracker item:** SE-16
**Status:** DRAFT — documents current practice + closes gaps
**Owner:** Michael Fletcher
**Last updated:** 2026-07-21 (by Claude)

> Formalizes how Cohort Logic handles credentials and keys. Ties to `security/rotation-manifest.json` and the daily security agent, which already tracks credential rotation age.

---

## 1. Secrets inventory

| Secret | Where it lives | Sensitivity | Rotation |
|---|---|---|---|
| **Supabase service-role key** | Gitignored `.env.security` (local, for the security agent) — never in `public/`, never committed | **Critical** (bypasses RLS) | Tracked in rotation manifest |
| **Supabase publishable/anon key** | In client JS (designed to be public; RLS is the protection) | Low | N/A |
| **GitHub push PAT** | `.git/config` push URL (local) | High | Rotation manifest (90-day max) |
| **QA test-account password** | Gitignored `.qa-credentials` | Medium (low-privilege throwaway) | Rotation manifest (90-day max) |
| **Super-admin account + MFA** | Password manager + authenticator (human) | Critical | Human-managed; MFA enrolled |

## 2. Rules (do / never)

- **Never commit secrets.** `.env.security`, `.qa-credentials`, and `.env*` are gitignored **and** in `.assetsignore` so they can never deploy to the web. The daily security agent verifies secret paths 404 on the live site.
- **Never place a secret in `public/`** — only `public/` is web-served; everything else (including secrets) is not, by allowlist.
- **Never paste secret values** into chats, incident docs, commits, or logs — reference them by name.
- **Least privilege:** use the publishable key in the client; the service-role key only where RLS bypass is genuinely required (the security agent). QA automation uses only the low-privilege throwaway account — never the super-admin.
- **Human-held secrets** (super-admin password, MFA) live in a password manager with MFA, not in files.

## 3. Rotation

- Rotation ages are tracked in `security/rotation-manifest.json`; the daily security agent flags anything past `max_age_days` (currently 90 for the GitHub PAT and QA credentials).
- **On suspected exposure:** rotate immediately per the Incident Response Plan (`04_...`) — regenerate the key/token, update the store, and confirm the old value is dead.
- **GitHub PAT rotation runbook** is in `CLAUDE.md` (regenerate a repo-scoped PAT → `git remote set-url --push`).

## 4. Access

- Secrets are accessible only to the founder today. As the team grows, document who holds what, prefer per-person credentials over shared ones, and revoke on offboarding.

## 5. Review

- Reviewed at least annually and whenever a provider or credential changes. Keep this inventory in sync with `security/rotation-manifest.json`.
