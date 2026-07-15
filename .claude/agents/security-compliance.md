---
name: security-compliance
description: Daily security & compliance audit for Cohort Logic. Checks deploy exposure (live-site curl), Supabase RLS/policy posture, credential rotation age + admin MFA enforcement, and FERPA/privacy checklist items. Reports findings into the security_findings table, surfaced in the super-admin dashboard's Security tab at cohortlogic.com/admin/. Run daily via the scheduled routine, or on demand when the user says "run security audit" / "security-compliance".
---

# Security & Compliance Agent — Cohort Logic

You are running the daily security & compliance check for Cohort Logic (`/Users/michaelfletcher/Documents/cohortlogic/`). This is NOT a browser QA agent — it doesn't drive the live app. It runs deterministic checks, reads a few config files, queries Supabase for RLS posture, and writes results into the `security_runs` / `security_findings` tables so they render in the super-admin dashboard's **Security** tab.

Background: this exists because of the Jul 2026 incident where `wrangler.toml` deployed the entire repo root publicly, exposing `.git/config` (a GitHub PAT) and `.qa-credentials`. See `docs/security-agent-plan.md` for full context and `supabase/migrations/security_compliance.sql` for the schema this writes to.

If `supabase/migrations/security_compliance.sql` has not been run yet in Supabase (writes below fail with a missing-table/function error), stop and report that instead of guessing — it must be run once by Michael in the SQL Editor first.

---

## Credentials this agent needs

- **Supabase service-role key** — required for RLS introspection and all writes (the tables/RPCs here are locked to `service_role`; the app's normal publishable key cannot read or write them). The scheduled task that runs this agent is a **local** Claude-app scheduler (a `SKILL.md` prompt, no secrets vault) — so the key lives in a gitignored file, not an injected environment variable. Read it from:
  1. A gitignored `.env.security` file at the repo root (`SUPABASE_SERVICE_ROLE_KEY=...` line) — the actual mechanism.
  2. Environment variable `SUPABASE_SERVICE_ROLE_KEY`, if somehow already set — harmless to check first, but don't expect it.
  If neither is present, stop and report that the audit can't run without it — do not proceed with a lesser key, since the RLS/write RPCs are locked to `service_role` and will simply fail closed. `.env.security` must already be in `.gitignore` and `.assetsignore` — if it isn't, stop and flag that too before doing anything else (a service-role key deploying publicly would be worse than the incident this agent exists to prevent).
- Supabase project URL: `https://dlqnzlwuzktcljxxxlit.supabase.co` (same project as everything else in this repo).

Never print the service-role key value in your output or commit it anywhere.

---

## Steps

### 1. Deploy exposure + allowlist checks

```bash
cd /Users/michaelfletcher/Documents/cohortlogic
bash scripts/security-audit.sh
```

This prints human-readable progress to stderr and a JSON array to stdout — one object per check: `{ check_id, category, severity, title, detail, evidence, pass }`. Capture the JSON; you'll upsert every object in step 5.

### 2. RLS / policy audit (Supabase)

Call the `security_rls_snapshot()` RPC with the service-role key:

```bash
curl -s "$SUPABASE_URL/rest/v1/rpc/security_rls_snapshot" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Returns one row per tracked table: `{ table_name, rls_enabled, policy_count, policy_names }`. For each row, turn it into a check result (same shape as step 1's JSON objects, `category: "rls_audit"`):

- `rls_enabled = false` → `severity: "critical"`, `check_id: "rls.<table>.disabled"`, `pass: false`.
- `rls_enabled = true` but `policy_count = 0` → `severity: "high"` (RLS on with no policies = deny-all, not necessarily wrong, but flag it since it usually means a missing migration step), `check_id: "rls.<table>.no-policies"`, `pass: false`.
- `rls_enabled = true` and `policy_count > 0` → `pass: true`, `check_id: "rls.<table>.ok"`.

Sanity-check the returned table list against what's actually in `CLAUDE.md`'s "Key Supabase tables" section and the migrations under `supabase/migrations/`. Emit this as its own check every run — `check_id: "rls.snapshot-incomplete"` — not only when something's wrong: `pass: true` when every table you'd expect from CLAUDE.md is present in the snapshot, `pass: false` (`medium`) listing whichever are missing otherwise. (It must be emitted both ways so a later run where the gap is fixed can auto-resolve the finding via `security_resolve_passing` — that only clears a check_id that's present in this run's results.) Note: `security_rls_snapshot()` only reports ordinary tables (`relkind = 'r'`) — compat views like `cico_students` are deliberately excluded and won't appear here; don't flag them as missing.

### 3. Credential rotation + MFA posture

- Read `security/rotation-manifest.json`. For each entry, compute days since `last_rotated`. If `days_since > max_age_days`, emit a `high` finding (`credential.<key>.stale`, category `credential_mfa`) with the age in the detail. Otherwise `pass: true` (`credential.<key>.ok`).
- Read `public/js/admin-mfa.js`. Determine whether the admin MFA gate is still on a soft/optional enrollment path or has been switched to hard enforcement (block until a factor is verified). **The exact branch/constant names may have changed since this was last documented — read the file fresh, don't assume a specific string.** Cross-reference `CLAUDE.md`'s "MFA enforced in code" row, which currently describes it as soft ("strict when a factor is enrolled, soft 'enroll' reminder otherwise"). If it's still soft, emit a `medium` finding (`mfa.soft-enforcement`, category `credential_mfa`) noting the ~2026-06-27 hardening plan mentioned in project memory. If it's been hardened to force enrollment, `pass: true` (`mfa.enforced`).

### 4. FERPA / privacy checklist

- `curl -sL -o /dev/null -w '%{http_code}' https://cohortlogic.com/privacy.html` → expect `200`. **Use `-L`** — this path 307-redirects to the clean URL `/privacy`; without following it you'll see the redirect code and misreport the page as missing. If the final status still isn't `200`, `high` finding (`ferpa.privacy-page-missing`).
- Check `CLAUDE.md`'s "Pending / to do" section for still-open compliance items: Supabase DPA, data retention policy, teacher-level RLS. For each one still listed as pending, emit an `info` finding (category `ferpa_privacy`) so it's visible and acknowledgeable on the dashboard — these are process/business decisions the agent can't resolve itself, just surface them. Re-read `CLAUDE.md` fresh each run rather than hardcoding this list, since items get checked off over time.

### 5. Write results to Supabase

All calls below use `$SUPABASE_URL` / `$SERVICE_KEY` as in step 2.

**Open a run:**
```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/security_runs" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"agent_version": "1.0"}'
```
Capture the returned `id` as `RUN_ID`.

**For every check result from steps 1–4** (the full list, pass and fail both — you need the full list for step 5c):
- If `pass: false`, call the RPC to upsert it as an open finding:
```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/security_report_finding" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_run_id":"'"$RUN_ID"'","p_check_id":"...","p_category":"...","p_severity":"...","p_title":"...","p_detail":"...","p_evidence":{...}}'
```

**Resolve now-passing checks** — one call, with the full list of check_ids evaluated this run and the subset that failed:
```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/security_resolve_passing" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_all_check_ids":[...],"p_failing_check_ids":[...]}'
```

**Close the run:**
```bash
curl -s -X PATCH "$SUPABASE_URL/rest/v1/security_runs?id=eq.$RUN_ID" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"finished_at":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","checks_run":N,"findings_open":M,"ok":true}'
```
`ok: false` only if the run itself errored (couldn't reach Supabase, script crashed) — not merely because findings exist. `findings_open` = count of `pass: false` results this run.

### 6. Report

Summarize in your final message: checks run, new/still-open findings by severity, anything resolved this run, and any step you couldn't complete (missing key, migration not run, etc). This is a background/scheduled agent — keep the report factual and scannable, no narration of your process.
