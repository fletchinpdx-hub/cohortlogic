# Cohort Logic — CLAUDE.md

## What this is
A multi-product SaaS for school administrators. Built by Michael Fletcher (Cohort Logic).

**Live site:** cohortlogic.com  
**GitHub:** github.com/fletchinpdx-hub/cohortlogic  
**Supabase project:** dlqnzlwuzktcljxxxlit  
**Local dev:** http://localhost:3456 (run via `npx serve -l 3456 .`)  
**Hosting:** Netlify (auto-deploys on push to `main`). Switching to Cloudflare Pages in ~3 weeks.

---

## Products

### 1. Class Builder (`app.html`)
Generates balanced, equitable classroom assignments for school admins.
- **Demo access code:** democlass
- **No backend** — everything runs in the browser. No data persistence between sessions.
- Session-based auth via `sessionStorage`.

### 2. Check-in / Check-out (`checkin-app.html`)
Daily behavioral check-in/check-out tracker for students. Supabase-backed, multi-school.
- Requires login (Supabase auth) + admin approval
- 5 views: Entry, History, Students, Reports, Settings
- Reports: 4 tabs — Student trend, By Teacher (homeroom), By Grade, School-wide
- Score colors: 0=red (#EF4444), 1=amber (#F59E0B), 2=green (#22C55E)

---

## Infrastructure

### Supabase (free tier)
- Pauses after 1 week of inactivity — wake it up at supabase.com/dashboard
- Anon/publishable key used in all client JS: `sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe`
- RLS enforced on all CICO tables

### Key Supabase tables
| Table | Purpose |
|-------|---------|
| `profiles` | User profiles: `id, full_name, school_name, school_id, approved, is_admin, created_at` |
| `schools` | School registry: `id, name, district, state, created_at` |
| `audit_log` | FERPA audit trail: `id, user_id, action, table_name, record_id, old_data, new_data, created_at` |
| `cico_students` | Students per school |
| `cico_checkins` | Daily check-in records |
| `cico_period_scores` | Per-period scores (child of checkins) |
| `cico_incidents` | Incident records (child of checkins) |
| `cico_settings` | Period count per school |
| `cico_categories` | Scoring categories per school |
| `cico_incident_types` | Incident type definitions per school |

### RLS helper functions
- `public.is_admin()` — SECURITY DEFINER, checks `profiles.is_admin = true`
- `public.my_school_id()` — SECURITY DEFINER, returns `profiles.school_id` for current user

### Migrations run (in order)
1. `supabase/migrations/ferpa_compliance.sql` — audit log, schools table, school_id on all tables, transition-safe RLS
2. `supabase/migrations/school_isolation_complete.sql` — **NOT YET RUN** — backfills null school_ids and tightens RLS to strict isolation

### ⚠️ Pending: Run school isolation
Before running `school_isolation_complete.sql`:
1. Create a school at cohortlogic.com/admin → Schools section ✅ (done)
2. Confirm all approved users have a school assigned (use All Users section in admin)
3. Paste `supabase/migrations/school_isolation_complete.sql` into Supabase SQL Editor and run it

---

## Admin panel (`admin/index.html` + `admin/admin.js`)

### Sections
- **Pending Approvals** — approve new users, assign them to a school
- **All Users** — view all approved users, reassign school via inline dropdown
- **Overview / Analytics** — Class Builder usage funnel and events
- **Audit Log** — FERPA audit trail with filter by table/action/date, paginated, detail modal
- **Schools** — Add schools (name, district, state); list shows UUID prefix

### Key functions in admin.js
- `loadDashboard()` — calls loadSchools → loadPendingUsers + loadAllUsers + loadAuditLog in parallel
- `loadSchools()` — populates `_schools` cache used by all dropdowns
- `addSchool()` — inserts to `schools` table; requires `is_admin = true` on profile
- `loadAllUsers()` — shows approved users with school assignment; calls `reassignUserSchool()`
- `approveUser(userId)` — sets `approved = true` + `school_id` together
- `loadAuditLog(append)` — paginated, 50/page; resolves user names via `_auditUserCache`
- `openAuditDetail(id)` — modal showing INSERT/UPDATE/DELETE diff

---

## File structure
```
index.html              — Marketing/landing page (Class Builder demo gate)
dashboard.html          — Product dashboard (links to both products)
app.html                — Class Builder app
checkin-app.html        — Check-in / Check-out app
login.html              — Shared login page for CICO
admin/
  index.html            — Admin panel
  admin.js              — All admin logic
css/
  styles.css            — Class Builder styles (CSS vars: --navy, --teal, --gold)
  checkin.css           — CICO styles (CSS vars: --ci-navy, --ci-teal, --ci-gold)
js/
  app.js                — Class Builder: AppState, navigation, utilities
  import.js             — Excel + Google Sheets import
  fieldMapping.js       — Column mapping, competency config
  students.js           — Student table, separation pairs
  classes.js            — Grade/class config, teacher assignment, split classes
  algorithm.js          — Snake-draft balancing, separation fixing, category balancing
  results.js            — Class card display, drag-to-move, Excel export
  sample.js             — Generates 500-student sample (includes Student ID + Homeroom)
  checkin-state.js      — CicoState, loadCicoData(), navigation, toast, initApp()
  checkin-entry.js      — Entry view: student search dropdown, period grid, incidents
  checkin-history.js    — History view: filter, load, render check-in cards
  checkin-students.js   — Students view: list, add/edit modal, Excel import
  checkin-config.js     — Settings view: period count, categories, incident types
  checkin-reports.js    — Reports view: 4 tabs, Chart.js charts, stat cards
images/
  logo.png              — Transparent background PNG
supabase/migrations/
  ferpa_compliance.sql        — Audit log + school scoping (ALREADY RUN)
  school_isolation_complete.sql — Strict RLS isolation (NOT YET RUN)
```

---

## Brand & tech
- **Colors:** navy (#0a2240 / --ci-navy: #1e3a5f), teal (#0ea5e9 / --ci-teal: #2a9d8f), gold (#f59e0b)
- **Font:** Nunito (Google Fonts)
- **Logo:** images/logo.png, display at height 30px with `align-items: flex-start` to prevent stretch
- **No framework** — vanilla HTML/CSS/JS only
- **SheetJS** — CDN, Excel parsing/export
- **Chart.js** — CDN, used in CICO reports (line + bar charts)
- **Safari quirk** — button click handlers must use `onclick="fn()"` attribute, not `addEventListener`

---

## Deployment
- `git push origin main` → Netlify auto-deploys (no build step)
- DNS at Porkbun: A → 75.2.60.5, CNAME www → gleeful-banoffee-050c62.netlify.app
- Plan: switch to Cloudflare Pages in ~3 weeks

---

## What's built
- Class Builder: full import → map → generate → export flow
- CICO: full check-in entry, history, student management, settings, 4-tab reports
- Admin panel: approvals, school management, all-users view, FERPA audit log
- School-scoped multi-tenancy (RLS, transition-safe — strict isolation pending SQL run)
- FERPA audit log (triggers on all CICO tables + profiles)
- Product badges in both app sidebars, back-to-dashboard link in Class Builder

## Pending / to do
- **Run `school_isolation_complete.sql`** in Supabase (see instructions above)
- **Privacy policy page** on marketing site (FERPA checklist)
- **Teacher-level RLS** — teachers see only their homeroom students in CICO
- **Supabase Pro + DPA** — needed for formal FERPA compliance (can wait)
- **Data retention policy** — process decision, not yet defined
- **Switch to Cloudflare Pages** (~3 weeks)
- Class Builder: private Google Sheets (OAuth), save/load sessions, print view, lock student to class
- CICO: mobile polish, print-friendly check-in sheets
