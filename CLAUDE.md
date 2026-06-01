# Cohort Logic — CLAUDE.md

## What this is
A multi-product SaaS for school administrators. Built by Michael Fletcher (Cohort Logic).

**Live site:** cohortlogic.com  
**GitHub:** github.com/fletchinpdx-hub/cohortlogic  
**Supabase project:** dlqnzlwuzktcljxxxlit  
**Local dev:** http://localhost:3456 (run via `npx serve -l 3456 .`)  
**Hosting:** Netlify (auto-deploys on push to `main`). Switching to Cloudflare Pages soon.

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
| `profiles` | `id, full_name, school_name, school_id, approved, is_admin, created_at` |
| `schools` | `id, name, district, state, created_at` |
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

### RLS helper functions
- `public.is_admin()` — SECURITY DEFINER, checks `profiles.is_admin = true`
- `public.my_school_id()` — SECURITY DEFINER, returns `profiles.school_id` for current user

### Migrations (all run)
1. `supabase/migrations/ferpa_compliance.sql` — audit log, schools table, school_id columns, transition-safe RLS
2. `supabase/migrations/school_isolation_complete.sql` — strict RLS isolation, backfilled null school_ids

### SQL changes run directly (not migration files)
- **Profiles RLS** — tightened: users can only read their own profile; admins can read all; only admins can delete
- **Auto-create profile trigger** — `handle_new_user()` trigger on `auth.users` INSERT auto-creates a `profiles` row from signup metadata (required because email confirmation means no active session at signup time)
- **Class Builder tracking policies** — `sessions` + `events` INSERT policies updated to allow both `anon` and `authenticated` roles (not just anon)

---

## Admin panel (`admin/index.html` + `admin/admin.js`)

### Security
- Auth handler verifies `profiles.is_admin = true` before showing any UI — non-admins are signed out immediately
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

---

## File structure
```
index.html              — Marketing/landing page
dashboard.html          — Product dashboard (links to both products)
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
netlify.toml            — Netlify security headers (CSP, X-Frame-Options, etc.)
admin/
  index.html            — Admin panel
  admin.js              — All admin logic
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

## Brand & tech
- **Colors:** navy (#0a2240), teal (#0ea5e9 / --ci-teal: #2a9d8f), gold (#f59e0b)
- **Font:** Nunito (Google Fonts)
- **Logo:** height 30px, `align-items: flex-start` to prevent stretch
- **No framework** — vanilla HTML/CSS/JS only
- **SheetJS** — CDN, Excel + CSV parsing/export
- **Chart.js** — CDN, CICO reports
- **Safari quirk** — use `onclick="fn()"` attributes, not `addEventListener`, for reliable clicks

---

## Deployment
- Claude pushes to `main` → Netlify auto-deploys (no manual step needed)
- Netlify is on a paid plan
- DNS at Porkbun: A → 75.2.60.5, CNAME www → gleeful-banoffee-050c62.netlify.app
- Plan: switch to Cloudflare Pages soon

---

## Security status
| Area | Status |
|------|--------|
| School data isolation (RLS) | ✅ Done — strict isolation, school_id backfilled |
| FERPA audit log | ✅ Done |
| Profiles RLS — users see only their own profile | ✅ Done |
| Auto-create profile trigger on signup | ✅ Done |
| Email verification on signup | ✅ Done (Supabase Auth setting) |
| MFA on admin account | ✅ Done |
| Session timeout — CICO + admin (15 min) | ✅ Done |
| Security headers via netlify.toml | ✅ Done (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) |
| Privacy policy page | ✅ Done (`privacy.html`) |
| Google Sheets URL import removed | ✅ Done (privacy concern) |
| CSP `script-src` without `unsafe-inline` | ⏳ Pending — requires migrating `onclick=` to `addEventListener` (test on Safari) |
| Supabase DPA | ⏳ Pending (needed for formal FERPA) |
| Demo access code in client JS | ⚠️ Known limitation (v1 intentional) |

---

## Pending / to do
- **Test signup flow end-to-end** — verify email confirmation → pending approvals → approval → login works
- **Teacher-level RLS** — on hold; needs product decisions on role model and homeroom assignment UX
- **CICO weekly trend chart** — 8-week bar chart in CICO Analytics to show usage trajectory
- **Pending Approvals UX** — edge cases for returning deactivated users (currently uses 3-day heuristic)
- **CSP script-src unsafe-inline** — migrate `onclick=` to `addEventListener`; test Safari carefully
- **Supabase Pro upgrade** — prevents pausing in active use; needed before onboarding paying schools
- **Supabase DPA** — formal FERPA compliance (requires Pro)
- **Data retention policy** — process decision, not yet defined
- **Switch to Cloudflare Pages**
- Class Builder: save/load sessions, print view, lock student to class
- CICO: mobile polish, print-friendly check-in sheets
