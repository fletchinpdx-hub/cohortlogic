# Cohort Logic — CLAUDE.md

## What this is
A multi-product SaaS for school administrators. Built by Michael Fletcher (Cohort Logic).

**Live site:** cohortlogic.com  
**GitHub:** github.com/fletchinpdx-hub/cohortlogic  
**Supabase project:** dlqnzlwuzktcljxxxlit  
**Local dev:** http://localhost:3456 (run via `npx serve -l 3456 .`)  
**Hosting:** Netlify (auto-deploys on push to `main`). Switching to Cloudflare Pages soon.

## Compact Instructions
When compacting this conversation, preserve:
- All modified files and what changed in each
- Key architectural decisions and why they were made
- Any pending tasks or known issues
- Test commands that verify the work

---

## Git workflow
- Claude commits **and pushes** — no action needed from user
- Always ask to commit when a feature feels done
- Fetch/pull uses SSH (`git@github.com:fletchinpdx-hub/cohortlogic.git`)
- Push uses HTTPS with a token stored in `.git/config` (push URL set via `git remote set-url --push`)
- If push ever fails (expired token), regenerate a `repo`-scoped PAT on GitHub and run: `git remote set-url --push origin https://NEW_TOKEN@github.com/fletchinpdx-hub/cohortlogic.git`

---

## Products

### 1. Class Builder (`app.html`)
Generates balanced, equitable classroom assignments for school admins.
- **Demo access code:** democlass (hardcoded in client JS — known limitation, security theater only)
- **No backend** — everything runs in the browser. Data never sent to a server.
- Session-based auth via `sessionStorage`.
- File import: Excel (.xlsx/.xls) and CSV — drag/drop or browse
- Google Sheets: users export as CSV/Excel from Google Sheets, then upload (URL import removed — privacy concern)
- Usage analytics tracked to `sessions` + `events` Supabase tables (anon + authenticated INSERT allowed)

### 2. Check-in / Check-out (`checkin-app.html`)
Daily behavioral check-in/check-out tracker for students. Supabase-backed, multi-school.
- Requires login (Supabase auth) + admin approval + school assignment
- 5 views: Entry, History, Students, Reports, Settings
- Reports: 4 tabs — Student trend, By Teacher (homeroom), By Grade, School-wide
- Score colors: 0=red (#EF4444), 1=amber (#F59E0B), 2=green (#22C55E)
- 15-minute inactivity session timeout with 60-second warning banner

### 3. Referral Tracking (`referral-app.html`)
Tier 1 behavior / office-discipline referral tracker, modeled on PBISApps/SWIS. Supabase-backed, multi-school. Product key `referrals` (gated via `enabled_products` + `can_access_product('referrals')`, same as CICO).
- Views: New Referral, Referrals (list), Review (reviewers only), Students, Settings, Reports
- **Shared roster**: uses the `students` table (renamed from `cico_students`), shared with CICO; added demographic cols `race_ethnicity, gender, iep`
- Config: `referral_locations/behaviors/motivations/actions/others_involved` (school-scoped, full settings UI, default PBIS lists seeded client-side on first load); records in `referral_referrals`
- Reports (Chart.js): By Location / Behavior / Time of Day / Grade, Drill Down (filter + group-by), Equity (Risk Index / Risk Ratio / Interpretations by race/gender/grade/IEP)
- JS: `js/referral-{state,students,config,entry,list,reports,review}.js`; styles reuse `css/checkin.css` (cico-* classes) + `css/referral.css`
- Compat shim: a `cico_students` view (security_invoker) over `students` exists so pre-rename code keeps working; safe to drop now that the new code is deployed
- **Phase 4 (migration `referral_phase4.sql`)** — reviewer workflow + custom fields:
  - Reviewer workflow: `referral_referrals.status` (`open|pending_review|reviewed`) + `reviewed_by/reviewed_at/reviewer_notes`. "Send to reviewer" checkbox on entry → `pending_review`. Review queue + per-school default reviewer (`referral_settings.default_reviewer_id`). Review nav + reviewer settings gated client-side to `school_admin`/`super_admin` (RefState.isReviewer); RLS is the real backstop. List has a Status column.
  - Custom fields: `referral_custom_fields` + `referral_custom_field_options` (school-scoped); selections stored as jsonb `referral_referrals.custom_values` (`{field_id: option_id}`). Managed in Settings (reviewers); rendered as dropdowns on entry.
  - Custom fields ARE supported in Drill Down (one multi-select filter each + a `custom:<fieldId>` group-by dimension; reads `custom_values`). Not yet in the fixed per-dimension reports or Equity.
  - Staff still free-text (no staff roster yet)

---

## Infrastructure

### Supabase (free tier)
- Pauses after 1 week of inactivity — wake it up at supabase.com/dashboard
- Upgrading to Pro is a pending task (needed before onboarding paying schools)
- Anon/publishable key in all client JS: `sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe` (designed to be public; RLS is the protection)
- RLS enforced on all CICO tables
- Email confirmation required for new signups (enabled in Auth → Providers → Email)
- Redirect URL after email confirmation: `https://cohortlogic.com/login.html`
- MFA enabled on admin account

### Key Supabase tables
| Table | Purpose |
|-------|---------|
| `profiles` | `id, full_name, school_name, school_id, approved, role, product_overrides, is_admin (legacy), created_at` |
| `schools` | `id, name, district, state, enabled_products, created_at` |
| `audit_log` | FERPA audit trail: `id, user_id, action, table_name, record_id, old_data, new_data, created_at` |
| `cico_students` | Students per school |
| `cico_checkins` | Daily check-in records |
| `cico_period_scores` | Per-period scores (child of checkins, FK: `checkin_id`) |
| `cico_incidents` | Incident records (child of checkins, FK: `checkin_id`) |
| `cico_settings` | Period count per school |
| `cico_categories` | Scoring categories per school |
| `cico_incident_types` | Incident type definitions per school |
| `sessions` | Class Builder demo sessions (anon + authenticated INSERT, authenticated SELECT) |
| `events` | Class Builder demo events (anon + authenticated INSERT, authenticated SELECT) |

### Roles & tool access
- `profiles.role` enum: `'user' | 'school_admin' | 'super_admin'` — **source of truth** for access level. The legacy `profiles.is_admin` boolean is vestigial (kept so the signup trigger doesn't break); `is_admin()` now reads `role`.
- `schools.enabled_products text[]` — **hard master switch** per school (e.g. `{cico}`). If a product is off here, NO ONE at the school gets it, regardless of per-user override.
- `profiles.product_overrides jsonb` — per-user override, e.g. `{"cico": false}`. When the school has the product ON, a `false` override **blocks** that individual; an absent/`true` override = allowed. A per-user override can only subtract, never grant above the school setting.
- **Effective access** = `approved AND product ∈ school.enabled_products AND NOT (override = false)`. See `can_access_product()`.
- **Class Builder is never gated** (no backend). Only CICO + future backend products are.

### RLS helper functions (all SECURITY DEFINER)
- `public.is_admin()` — now means **super admin** (`role = 'super_admin'`). Name kept so existing policies keep working.
- `public.is_super_admin()` / `public.is_school_admin()` / `public.my_role()` — role checks.
- `public.my_school_id()` — returns `profiles.school_id` for current user.
- `public.can_access_product(p text)` — approved AND (per-user override else school default). Used in CICO RLS and by the CICO app at startup.

### School-admin mutation RPCs (SECURITY DEFINER; the only write path for school admins)
School admins have **no direct write on `profiles`** — they call these, which validate caller is super_admin OR (school_admin of the target's school) AND target is a plain `user`:
- `approve_school_user(target)`, `set_school_user_active(target, active)`, `remove_school_user(target)`
- `set_user_product_override(target, product, access)` — access = `'allow' | 'deny' | 'inherit'`
- `set_school_products(products text[])` — sets caller's own school's `enabled_products`

### Migrations (all run)
1. `supabase/migrations/ferpa_compliance.sql` — audit log, schools table, school_id columns, transition-safe RLS
2. `supabase/migrations/school_isolation_complete.sql` — strict RLS isolation, backfilled null school_ids
3. `supabase/migrations/school_admin_roles.sql` — role enum, tool-access columns, helper fns, school-admin RPCs, CICO RLS gated on approval + product access
4. `supabase/migrations/school_tool_master_switch.sql` — `can_access_product()` redefined so `schools.enabled_products` is a hard master switch (override can only block); audit trigger on `schools`

### SQL changes run directly (not migration files)
- **Profiles RLS** — tightened: users can only read their own profile; admins can read all; only admins can delete
- **Auto-create profile trigger** — `handle_new_user()` trigger on `auth.users` INSERT auto-creates a `profiles` row from signup metadata (required because email confirmation means no active session at signup time)
- **Class Builder tracking policies** — `sessions` + `events` INSERT policies updated to allow both `anon` and `authenticated` roles (not just anon)

---

## Admin panel (`admin/index.html` + `admin/admin.js`)

### Security
- Auth handler verifies `profiles.role = 'super_admin'` (source of truth, not the legacy is_admin column) before showing any UI — non-admins are signed out immediately
- MFA gate (`AdminMFA.gate`) runs after the role check: a TOTP challenge is required when a factor is enrolled (aal2); otherwise an enroll reminder shows
- 15-minute inactivity timeout (same as CICO)
- RLS is a second backstop at the data layer

### Sections
- **Pending Approvals** — approve new users, assign to a school; returning deactivated users show "Previously active" badge + "Reactivate" button
- **All Users** — approved users with school reassign dropdown + Deactivate button
- **Class Builder Analytics** — sessions, funnel (how far users get), feature usage, recent sessions
- **CICO Analytics** — enrolled students, check-ins (30d + today), active schools, per-school activity table with Wipe Data action
- **Audit Log** — FERPA audit trail, filter by table/action/date, paginated, detail modal
- **Schools** — Add, edit (inline), and delete schools; deletion blocked if users are assigned

### Key functions in admin.js
- `verifyAndLoad(session, event)` — async; called fire-and-forget from onAuthStateChange; checks `profiles.is_admin`, signs out non-admins, then calls showDashboard + loadDashboard
- `loadDashboard()` — synchronous dispatcher: fires loadSchools → loadPendingUsers + loadAllUsers + loadCicoStats in parallel; loadAuditLog and loadAnalytics independently
- `loadAnalytics()` — async: queries sessions + events tables for Class Builder stats
- `loadCicoStats()` — async: queries cico_students + cico_checkins for CICO stat cards and per-school table
- `loadSchools()` / `addSchool()` / `startEditSchool()` / `saveEditSchool()` / `deleteSchool()` / `confirmDeleteSchool()`
- `loadAllUsers()` — approved users with school reassign + deactivate button
- `deactivateUser()` / `confirmDeactivateUser()` — sets `approved = false`
- `approveUser(userId)` — sets `approved = true` + `school_id` together
- `wipeSchoolData()` / `confirmWipeSchoolData()` — deletes all CICO data for a school in safe order (child records first)
- `loadAuditLog(append)` — paginated 50/page, resolves user names via `_auditUserCache`
- `openAuditDetail(id)` — modal with INSERT/UPDATE/DELETE diff
- **All Users** now has a **Role** column (`setUserRole` — promote/revoke `school_admin`; super_admin only set via SQL)
- **Pending** has `assignPendingSchool` — "Route to school admin": sets `school_id` WITHOUT approving, so the user lands in their school admin's queue

---

## School-admin panel (`school-admin/index.html` + `school-admin.js`)

A per-school admin (designated by the super admin) manages **only their own school**. Auth gate verifies `role IN ('school_admin','super_admin')` and scopes everything to `my_school_id()`.

### Sections
- **Pending Approvals** — approve/decline signups routed to this school
- **Tool Settings** — toggle CICO on/off for the whole school (`set_school_products`)
- **Staff** — per-person CICO access (School default / Allowed / Denied via `set_user_product_override`), Deactivate (`set_school_user_active`), Remove (`remove_school_user`)

### Navigation (entry/exit)
- **Entry:** from the product dashboard, school admins see a **"Manage your school →"** link into `/school-admin/`; super admins see **"Open admin panel →"** into `/admin/`. The link is one role-aware element (`#admin-link`) in the dashboard header, shown/targeted by `role` in `js/dashboard.js` (which now selects `role`). Hidden for plain `user`. Convenience only — both panels still re-verify role server-side + RLS.
- **Exit:** a **"← Products"** link in the panel topbar returns to `dashboard.html`. Plain `<a>` nav; the Supabase session carries over both directions, so no re-authentication.

### Security
- **Zero direct write access to `profiles`** — every mutation goes through the SECURITY DEFINER RPCs above, which enforce same-school + target-is-plain-user. A school admin can't escalate roles, reach another school, or modify an admin account even via crafted API calls.
- **Privilege-escalation backstop** — `guard_profile_privileged_columns()` BEFORE UPDATE trigger forbids changing `role`/`approved`/`school_id`/`product_overrides`/`is_admin` unless the caller is a super admin or the write comes through a trusted RPC (transaction-local flag `app.allow_privileged_profile_update`). Defends even if an RLS UPDATE policy is permissive.
- **No user data in inline `onclick`** — handlers pass only UUIDs; names are looked up from a render-time `_nameById`/`_userNameById` map and rendered in escaped text context. (`esc()`/`escAdmin()` don't escape `'`, and HTML entity-encoding doesn't survive into inline-handler JS, so user-controlled strings must never be interpolated into `onclick`.)
- Read access via the additive `"School admins can view their school's profiles"` SELECT policy.
- 15-minute inactivity timeout (same as the other panels).

### User lifecycle (decoupled approval)
1. User self-signs-up → `approved=false`, `school_id=null`.
2. **Super admin** assigns a school (Route to school admin) — routes but does NOT approve.
3. **School admin** approves → `approved=true`. They manage tool access + deactivation thereafter.

### CICO tool gate
`checkin-state.js → initApp()` calls `can_access_product('cico')` at startup; denied users get a full-screen lockout message (`renderCicoAccessDenied`) instead of an empty app. Fail-open on RPC error — RLS still protects the data.

---

## File structure
```
index.html              — Marketing/landing page
dashboard.html          — Product dashboard (links to both products + role-aware admin link)
app.html                — Class Builder app
checkin-app.html        — Check-in / Check-out app
login.html              — Shared login for CICO
signup.html             — CICO signup (email verification + pending approval flow)
privacy.html            — Privacy policy (FERPA)
security.html           — Security & privacy marketing page
pricing.html            — Pricing page
contact.html            — Contact page
class-builder.html      — Class Builder marketing/product page
resources.html          — Resources
wrangler.toml           — Cloudflare Workers static asset config (no build step)
_headers                — Security headers for all routes (CSP, X-Frame-Options, etc.)
admin/
  index.html            — Super-admin panel
  admin.js              — All super-admin logic
  admin.css             — Shared admin styles (also used by school-admin/)
school-admin/
  index.html            — Per-school admin panel (reuses ../admin/admin.css)
  school-admin.js       — School-admin logic (approve/deactivate/remove staff, tool access)
css/
  styles.css            — Class Builder styles (--navy, --teal, --gold)
  checkin.css           — CICO styles (--ci-navy, --ci-teal, --ci-gold)
  marketing.css         — Marketing site design system
js/
  app.js                — Class Builder: AppState, navigation, utilities
  import.js             — File import (Excel + CSV)
  fieldMapping.js       — Column mapping, competency config
  students.js           — Student table, separation/together pairs
  classes.js            — Grade/class config, teacher assignment
  algorithm.js          — Snake-draft + separation/together fixing + category balancing
  results.js            — Class cards, drag-to-move, export by grade/teacher
  sample.js             — 500-student sample + blank template download
  supabase-config.js    — Shared: SupabaseClient, trackSession(), trackEvent()
  admin-mfa.js          — Shared MFA gate + TOTP enrollment for both admin panels (window.AdminMFA)
  checkin-state.js      — CicoState, loadCicoData(), navigation, toast, initApp(), session timeout
  checkin-entry.js      — Entry view: student search, period grid, incidents
  checkin-history.js    — History view: filter, load, render cards
  checkin-students.js   — Students view: list, add/edit, Excel import
  checkin-config.js     — Settings: period count, categories, incident types
  checkin-reports.js    — Reports: 4 tabs, Chart.js charts, stat cards
images/
  logo.png              — Transparent PNG logo
supabase/migrations/
  ferpa_compliance.sql           — (ALREADY RUN)
  school_isolation_complete.sql  — (ALREADY RUN)
```

---

## Class Builder — algorithm notes
- **Snake draft**: sorts students by composite score (normalized 0–1), distributes across classes
- **Regenerate**: adds ±7.5% random jitter to composite scores for varied arrangements
- **Category balancing** (`balanceCategories`): inner `drainPair` loop exhausts all improvements between each class pair before moving on
- **Default competencies**: Math, Reading, Writing, Behavior (score 1–5), IEP, 504 (flag), Gender, Ethnicity (category)

## Export options (Class Builder results)
- **By Grade**: one Excel tab per grade, students sorted by last name
- **By Teacher**: one Excel tab per teacher/class, named by teacher name

---

## Critical constraints — do not violate

### Admin `onAuthStateChange` must stay synchronous
`db.auth.onAuthStateChange(...)` in `admin/admin.js` **and `school-admin/school-admin.js`** **must not be `async`** and must not `await` anything inside the handler body. Supabase cannot finish processing auth state while the callback is blocked — the symptom is a completely silent login freeze on page refresh (no error, button stays on "Signing in…"). All async work goes in `verifyAndLoad()`, which is called fire-and-forget from the handler. This has been broken and fixed twice. Do not revert it.

---

## Brand & tech
- **Colors:** navy (#0a2240), teal (#0ea5e9 / --ci-teal: #2a9d8f), gold (#f59e0b)
- **Font:** Nunito (Google Fonts)
- **Logo:** height 30px, `align-items: flex-start` to prevent stretch
- **No framework** — vanilla HTML/CSS/JS only
- **SheetJS** — CDN, Excel + CSV parsing/export
- **Chart.js** — CDN, CICO reports
- **Event handling** — all `onclick=`/`onchange=`/`oninput=` attributes have been removed and replaced with `addEventListener` calls (required for CSP `script-src` without `unsafe-inline`). Modern Safari handles this fine.

---

## Deployment
- Claude pushes to `main` → Cloudflare Workers auto-deploys (no manual step needed)
- Live at: https://cohortlogic.com (DNS cutover complete — Cloudflare managing DNS)
- `wrangler.toml` configures static asset deployment (no build step)
- `_headers` file sets all security headers (supported by Cloudflare Workers static assets)

---

## Security status
| Area | Status |
|------|--------|
| School data isolation (RLS) | ✅ Done — strict isolation, school_id backfilled |
| Role-based access (`role` enum) | ✅ Done — user / school_admin / super_admin |
| Per-school tool access (CICO) | ✅ Done — RLS-enforced (approval + product), school default + per-user override |
| School-admin privilege isolation | ✅ Done — no direct profile writes; SECURITY DEFINER RPCs guard same-school + target-is-user |
| FERPA audit log | ✅ Done |
| Profiles RLS — users see only their own profile | ✅ Done |
| Auto-create profile trigger on signup | ✅ Done |
| Email verification on signup | ✅ Done (Supabase Auth setting) |
| MFA on admin account | ✅ Done |
| MFA enforced in code (aal2) on both admin panels | ✅ Done — `js/admin-mfa.js`; strict when a factor is enrolled, soft "enroll" reminder otherwise; fails open on SDK error to avoid lockout |
| Session timeout — CICO + admin (15 min) | ✅ Done |
| Security headers via `_headers` | ✅ Done (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) — applied by Cloudflare Workers |
| Privacy policy page | ✅ Done (`privacy.html`) |
| Google Sheets URL import removed | ✅ Done (privacy concern) |
| CSP `script-src` without `unsafe-inline` | ✅ Done — all `onclick=`/`onchange=`/`oninput=` migrated to `addEventListener` |
| CSP `style-src` without `unsafe-inline` | ⚠️ Intentionally not done — 1,193 inline `style=""` attributes site-wide; no injection vector on a static site, so the security benefit is negligible. `unsafe-inline` stays in `style-src` permanently. |
| Supabase DPA | ⏳ Pending (needed for formal FERPA) |
| Demo access code in client JS | ⚠️ Known limitation (v1 intentional) |

---

## Runbooks

### MFA recovery — admin locked out of their authenticator
There are no self-service recovery codes (factor removal is service-role only, intentionally not exposed to the client). To recover an admin who lost their device:
1. Verify the person's identity out-of-band first.
2. Supabase dashboard → **Authentication → Users** → open the user.
3. In their **Factors**, delete the TOTP factor.
4. They can now sign in with password alone (`aal1`); the **"Enable 2FA"** banner prompts them to re-enroll on next login (or it's required once MFA enforcement is turned on).

### Changing role / approval / school / tool access
The `guard_profiles_privileged` trigger blocks direct SQL-editor writes to `role`, `approved`, `school_id`, `product_overrides`, `is_admin` (no admin session ⇒ `is_super_admin()` is false). Make these changes **through the panels** (which run as the signed-in super-admin) or the school-admin RPCs — not raw SQL. Break-glass only: `set session_replication_role = replica;` disables triggers for that transaction (also skips the audit log), then reset to `default`.

---

## Pending / to do
- **Test signup flow end-to-end** — verify email confirmation → pending approvals → approval → login works
- **Teacher-level RLS** — on hold; needs product decisions on role model and homeroom assignment UX
- **CICO weekly trend chart** — 8-week bar chart in CICO Analytics to show usage trajectory
- **Pending Approvals UX** — edge cases for returning deactivated users (currently uses 3-day heuristic)
- **Disable Netlify site** — migration complete; go to Netlify → site settings → Delete this site
- **Safari smoke test** — test login, CICO app, and dashboard on Safari after addEventListener migration
- **Supabase Pro upgrade** — prevents pausing in active use; needed before onboarding paying schools
- **Supabase DPA** — formal FERPA compliance (requires Pro)
- **Data retention policy** — process decision, not yet defined
- Class Builder: print view, lock student to class
- CICO: mobile polish, print-friendly check-in sheets
