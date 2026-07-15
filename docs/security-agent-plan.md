# Security & Compliance Agent — Build Plan

**Status:** Ready to build. Plan authored against live code (2026-07-15, commit `2217301` "Redesign super-admin panel").
**Owner decisions locked:** Supabase-backed dashboard reporting · all four scopes · daily scheduled cloud routine.

This doc is self-contained — a fresh session can execute it without prior conversation context.

---

## Goal

A standing agent that runs daily, checks Cohort Logic's security & compliance posture across four areas, and reports findings into the super-admin dashboard (`/admin/`) as a new **Security** tab. Motivated by the July 2026 deploy-exposure incident (public `.git/config` + `.qa-credentials`), the pending soft→hard MFA rollout, and outstanding credential rotation.

---

## Architecture (4 components)

### A. Supabase data store — `supabase/migrations/security_compliance.sql`

Match the conventions in `school_admin_roles.sql` (SECURITY DEFINER fns, `is_admin()` gating, `guard_*` triggers).

**Tables:**

`security_runs` — one row per agent run (dashboard heartbeat, proves the agent is alive):
- `id uuid pk default gen_random_uuid()`
- `started_at timestamptz default now()`, `finished_at timestamptz`
- `checks_run int`, `findings_open int`
- `ok boolean` (false if the run itself errored)
- `agent_version text`

`security_findings`:
- `id uuid pk default gen_random_uuid()`
- `run_id uuid references security_runs(id)`
- `check_id text not null` — stable slug, e.g. `deploy.git-exposure`, `rls.students-no-policy`, `mfa.soft-enforcement`
- `category text` — `deploy_exposure | rls_audit | credential_mfa | ferpa_privacy`
- `severity text` — `critical | high | medium | low | info`
- `status text default 'open'` — `open | acknowledged | resolved`
- `title text`, `detail text`
- `evidence jsonb` — e.g. `{ "url": "...", "http_status": 200 }` or `{ "table": "students", "rls_enabled": false }`
- `first_seen timestamptz default now()`, `last_seen timestamptz default now()`
- `resolved_at timestamptz`

**RLS (critical — findings must never leak):**
- Enable RLS on both tables.
- SELECT policy on both: `USING ( public.is_admin() )` — super-admin only.
- **No** INSERT/UPDATE/DELETE policies for `anon`/`authenticated`. All writes happen via the **service-role key**, which bypasses RLS. This guarantees the publishable key can neither read nor write findings.

**RPC (dashboard acknowledge/resolve, runs as the signed-in super-admin):**
```sql
create or replace function public.set_finding_status(p_finding_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('open','acknowledged','resolved') then raise exception 'bad status'; end if;
  update public.security_findings
     set status = p_status,
         resolved_at = case when p_status = 'resolved' then now() else null end
   where id = p_finding_id;
end $$;
```

**Upsert semantics (agent side):** upsert findings keyed on `check_id`. A still-failing check updates `last_seen`; a check that now passes flips its prior `open` finding to `resolved` with `resolved_at = now()`.

**Deliverable:** paste the full SQL inline in chat for Michael to run in the Supabase SQL editor (his stated preference — don't just point at the dashboard). Then save the file under `supabase/migrations/`.

---

### B. The agent — hybrid: deterministic shell script + judgment-based agent

Convention note: this repo already keeps live QA agents as `.claude/agents/qa-*.md` (glob-invoked by "run QA"). Follow that pattern.

**B1. `scripts/security-audit.sh`** — deterministic checks, emits a JSON findings array to stdout. No secrets, no browser. Reusable (could later join the predeploy gate).

- **Deploy exposure (highest value):** `curl -s -o /dev/null -w '%{http_code}'` each of these against `https://cohortlogic.com` — **every one must be 404**:
  - `/.git/config`, `/.qa-credentials`, `/.claude/settings.json`, `/CLAUDE.md`, `/wrangler.toml`,
    `/scripts/deploy.sh`, `/supabase/migrations/school_admin_roles.sql`, `/.env.security`, `/.env`, `/.dev.vars`
  - Any that returns 200 → `critical` finding. (Ground truth is the live site, not the local `.assetsignore` — note that `check-assetsignore.sh`'s header comment is stale; the real protection is now the `public/` allowlist in `wrangler.toml`.)
- **Allowlist integrity:** assert `wrangler.toml` still has `directory = "public"`; assert no obviously-sensitive files exist under `public/` (`.git`, `.env*`, `*.credentials`, `CLAUDE.md`). Drift → `high`.

**B2. `.claude/agents/security-compliance.md`** — the agent invoked by the daily routine. It:
1. Runs `scripts/security-audit.sh`, parses the JSON.
2. **RLS audit** (needs service-role key): query `pg_tables` / `pg_policies` for `profiles`, `schools`, `students`, `cico_*`, `referral_*`, `audit_log`. Flag: RLS disabled (`critical`), or a table with no policy referencing `is_admin()`/`my_school_id()`/`can_access_product()` school-isolation (`high`). Compare against the "Security status" table in `CLAUDE.md` as the expected baseline.
3. **Credential & MFA posture:**
   - Read `js/admin-mfa.js`; detect whether the gate still uses the soft enroll-reminder branch vs. hard force-enrollment. Soft → `medium` finding (`mfa.soft-enforcement`) referencing the ~2026-06-27 hardening plan. *(Verify the exact branch/const name in the current file — it has changed since memory was written.)*
   - Read `security/rotation-manifest.json` (see B3); flag any credential past its max-age policy (`high` if the PAT/QA creds from the July incident are still unrotated).
4. **FERPA / privacy checklist:** curl `/privacy.html` (expect 200); check for the outstanding items from `CLAUDE.md` "Pending" — Supabase DPA, data-retention policy, teacher-level RLS. Emit `info`/`medium` findings that Michael acknowledges from the dashboard.
5. **Writes results:** open a `security_runs` row at start, upsert `security_findings` (dedupe on `check_id`, resolve now-passing checks), close the run with `finished_at`/`findings_open`/`ok`. Uses the service-role key.

**B3. `security/rotation-manifest.json`** (gitignored) — records last-rotation dates for tracked secrets so the agent can apply a max-age policy:
```json
{ "github_pat": { "last_rotated": "2026-07-14", "max_age_days": 90 },
  "qa_credentials": { "last_rotated": "2026-07-14", "max_age_days": 90 } }
```

---

### C. Admin dashboard — new "Security" tab in `public/admin/`

**CSP + patterns (must match — see `check-csp.sh`):** all JS in `admin.js`, zero inline handlers, wire everything through the existing `data-act` delegation. Escape all dynamic text with `escAdmin()`.

**`public/admin/index.html`** — three edits:
1. Add a tab button to `<nav class="admin-tabs">` (after Logs, before Feedback):
   ```html
   <button class="tab-btn" data-act="gotoView" data-view="security">Security <span id="security-badge" class="tab-badge hidden"></span></button>
   ```
2. Add the view container (mirror the structure of `#view-logs`):
   ```html
   <div class="admin-view hidden" id="view-security">
     <h2 style="margin-bottom:12px;">Security &amp; Compliance</h2>
     <div id="security-heartbeat"></div>
     <div id="security-findings"><p style="color:#9ca3af;font-size:13px;">Loading…</p></div>
   </div>
   ```
3. (No `?v=` bump — admin assets aren't version-tagged; just hard-refresh after deploy.)

**`public/admin/admin.js`** — four edits:
1. `loadViewData(view)` (~`:242`): add `case 'security': loadSecurity(); break;`.
2. New `async function loadSecurity()` — mirror `loadCicoStats()`/`loadErrors()`: query `security_runs` (latest, for heartbeat) + open `security_findings` (grouped by category, severity-sorted). Render:
   - **Heartbeat banner**: green if latest `finished_at` < ~25h ago, red/stale otherwise (agent-down signal).
   - **Findings list**: severity badge, title, detail, evidence, first/last-seen, and per-finding **Acknowledge** / **Resolve** buttons: `<button data-act="setFindingStatus" data-id="${escAdmin(f.id)}" data-status="resolved">`.
3. New `async function setFindingStatus(_, el)` — `await db.rpc('set_finding_status', { p_finding_id: el.dataset.id, p_status: el.dataset.status })`, then re-`loadSecurity()`.
4. Register `loadSecurity, setFindingStatus` in the `data-act` dispatch table (~`:1028`).
5. **Overview attention card** (optional but recommended): in `loadOverview()` (~`:278`), add an `attention-card` linking to the Security tab when there are open `critical`/`high` findings, mirroring the pending-approvals/errors cards. Update `#security-badge` with the open-finding count.

Reads use the existing authenticated super-admin session; RLS lets `is_admin()` read. No new client credentials.

---

### D. Scheduling — daily cloud routine

Create a routine (via the `schedule` skill / scheduled-tasks) that runs each morning and invokes the `security-compliance` agent. **Store the Supabase service-role key as a secret in the routine's environment** — never in the repo.

- **Fallback** if the routine can't hold secrets: a gitignored root `.env.security` file (already covered by `.assetsignore` belt-and-suspenders and never under `public/`). If used: add `.env.security` to `.gitignore`, and the deploy-exposure check already curls it to confirm 404.

---

## Sequencing

1. **Migration** — write + run `security_compliance.sql` (paste SQL inline for Michael).
2. **Deterministic script** — `scripts/security-audit.sh`; verify curl checks against the live site.
3. **Agent + manifest** — `.claude/agents/security-compliance.md` + `security/rotation-manifest.json` + service-key wiring.
4. **Dashboard tab** — the four `admin.js` + three `index.html` edits. This is the only step touching admin files.
5. **Routine** — daily schedule with the service-key secret.
6. **Verify end-to-end** — run the agent once; confirm a `security_runs` row + findings appear in the Security tab; confirm acknowledge/resolve works; confirm the heartbeat + Overview card render.
7. **Deploy** — `bash scripts/deploy.sh` (runs the predeploy gate). Hard-refresh `/admin/`.

---

## Must-verify-against-live-code (don't trust memory)

- **`js/admin-mfa.js`** — exact branch/const names for the soft-vs-hard MFA gate (changed since memory).
- **`admin.js` dispatch table** at ~`:1028` and `loadViewData` at ~`:242` — confirm exact line/shape before editing (redesign was recent).
- **Existing migration style** — open `school_admin_roles.sql` and match its `is_admin()` / SECURITY DEFINER / policy-naming conventions.
- **Service-role key availability** in the routine's env — drives whether D uses the secret or the `.env.security` fallback.
- **CICO/referral table list** for the RLS audit — reconcile against the live `pg_tables`, not just `CLAUDE.md`.

---

## Notes / decisions

- **Why service-role key, not anon:** the RLS audit introspects `pg_policies`, and findings writes must bypass RLS. The anon/publishable key can do neither. Keeping the key in the routine env (not the repo) is the safest split.
- **Honest limits:** credential-rotation and FERPA items are partly state the agent can't directly observe — they're manifest/checklist-driven with manual acknowledgement from the dashboard, not fully automated detection. This is called out so the dashboard doesn't imply false certainty.
- **No admin cache-bump:** admin assets aren't `?v=`-tagged, so `check-versions.sh` doesn't apply; hard-refresh after deploy.
