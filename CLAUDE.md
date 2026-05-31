# Cohort Logic — CLAUDE.md

## What this is
A multi-product SaaS for school administrators. Built by Michael Fletcher (Cohort Logic).

**Live site:** cohortlogic.com  
**GitHub:** github.com/fletchinpdx-hub/cohortlogic  
**Supabase project:** dlqnzlwuzktcljxxxlit  
**Local dev:** http://localhost:3456 (run via `npx serve -l 3456 .`)  
**Hosting:** Netlify (auto-deploys on push to `main`). Switching to Cloudflare Pages in ~3 weeks.

## Git workflow
- Claude commits; **user runs `git push origin main` from their terminal**
- Remote is SSH: `git@github.com:fletchinpdx-hub/cohortlogic.git`
- Claude Code sandbox cannot access macOS Keychain or ssh-agent — pushes must come from user's terminal

---

## Products

### 1. Class Builder (`app.html`)
Generates balanced, equitable classroom assignments for school admins.
- **Demo access code:** democlass (hardcoded in client JS — known limitation, security theater only)
- **No backend** — everything runs in the browser. Data never sent to a server.
- Session-based auth via `sessionStorage`.
- File import: Excel (.xlsx/.xls) and CSV — drag/drop or browse
- Google Sheets: users export as CSV/Excel from Google Sheets, then upload (URL import removed — privacy concern)

### 2. Check-in / Check-out (`checkin-app.html`)
Daily behavioral check-in/check-out tracker for students. Supabase-backed, multi-school.
- Requires login (Supabase auth) + admin approval + school assignment
- 5 views: Entry, History, Students, Reports, Settings
- Reports: 4 tabs — Student trend, By Teacher (homeroom), By Grade, School-wide
- Score colors: 0=red (#EF4444), 1=amber (#F59E0B), 2=green (#22C55E)

---

## Infrastructure

### Supabase (free tier)
- Pauses after 1 week of inactivity — wake it up at supabase.com/dashboard
- Anon/publishable key in all client JS: `sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe` (designed to be public; RLS is the protection)
- RLS enforced on all CICO tables

### Key Supabase tables
| Table | Purpose |
|-------|---------|
| `profiles` | `id, full_name, school_name, school_id, approved, is_admin, created_at` |
| `schools` | `id, name, district, state, created_at` |
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

### Migrations (all run)
1. `supabase/migrations/ferpa_compliance.sql` — audit log, schools table, school_id columns, transition-safe RLS
2. `supabase/migrations/school_isolation_complete.sql` — strict RLS isolation, backfilled null school_ids

---

## Admin panel (`admin/index.html` + `admin/admin.js`)

### Security
- Auth handler verifies `profiles.is_admin = true` **before** showing any UI — non-admins are signed out immediately
- RLS is a second backstop at the data layer

### Sections
- **Pending Approvals** — approve new users, assign them to a school
- **All Users** — view all approved users, reassign school via inline dropdown
- **Overview / Analytics** — Class Builder usage funnel and events
- **Audit Log** — FERPA audit trail, filter by table/action/date, paginated, detail modal
- **Schools** — Add schools (name, district, state)

### Key functions in admin.js
- `loadDashboard()` — calls loadSchools → loadPendingUsers + loadAllUsers + loadAuditLog
- `loadSchools()` — populates `_schools` cache used by all dropdowns
- `addSchool()` — inserts to `schools` table
- `loadAllUsers()` — approved users with school assignment + reassign dropdown
- `approveUser(userId)` — sets `approved = true` + `school_id` together
- `loadAuditLog(append)` — paginated 50/page, resolves user names via `_auditUserCache`
- `openAuditDetail(id)` — modal with INSERT/UPDATE/DELETE diff

---

## File structure
```
index.html              — Marketing/landing page (Class Builder demo gate)
dashboard.html          — Product dashboard (links to both products)
app.html                — Class Builder app
checkin-app.html        — Check-in / Check-out app
login.html              — Shared login for CICO
admin/
  index.html            — Admin panel
  admin.js              — All admin logic
css/
  styles.css            — Class Builder styles (--navy, --teal, --gold)
  checkin.css           — CICO styles (--ci-navy, --ci-teal, --ci-gold)
js/
  app.js                — Class Builder: AppState, navigation, utilities
  import.js             — File import (Excel + CSV); Google Sheets = export then upload
  fieldMapping.js       — Column mapping, competency config; auto-fills name from column
  students.js           — Student table, separation/together pairs
  classes.js            — Grade/class config, teacher assignment, split classes
  algorithm.js          — Snake-draft + separation/together fixing + category balancing
  results.js            — Class cards, drag-to-move, export by grade/teacher, regenerate
  sample.js             — 500-student sample + blank template download
  checkin-state.js      — CicoState, loadCicoData(), navigation, toast, initApp()
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
- **Category balancing** (`balanceCategories`): inner `drainPair` loop exhausts all improvements between each class pair before moving on; outer loop repeats until no pair needs further adjustment. Fixes gender/ethnicity skew.
- **Default competencies**: Math, Reading, Writing, Behavior (score 1–5), IEP, 504 (flag), Gender, Ethnicity (category)
- Auto-fills field name from selected column if name is blank

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
- `git push origin main` (from user terminal) → Netlify auto-deploys
- DNS at Porkbun: A → 75.2.60.5, CNAME www → gleeful-banoffee-050c62.netlify.app
- Plan: switch to Cloudflare Pages in ~3 weeks

---

## Security status
| Area | Status |
|------|--------|
| Admin panel is_admin JS check | ✅ Done |
| School data isolation (RLS) | ✅ Done |
| FERPA audit log | ✅ Done |
| Google Sheets URL import removed | ✅ Done (privacy concern) |
| Privacy policy page | ⏳ Pending |
| Content Security Policy headers | ⏳ Pending (Netlify `_headers` file) |
| Supabase Pro + DPA | ⏳ Pending (needed for formal FERPA) |
| Demo access code in client JS | ⚠️ Known limitation (v1 intentional) |

## Pending / to do
- **Privacy policy page** on marketing site (FERPA requirement)
- **Content Security Policy** via Netlify `_headers` file
- **Teacher-level RLS** — teachers see only their homeroom students in CICO
- **Supabase Pro + DPA** — formal FERPA compliance
- **Data retention policy** — process decision
- **Switch to Cloudflare Pages** (~3 weeks)
- Class Builder: save/load sessions, print view, lock student to class
- CICO: mobile polish, print-friendly check-in sheets
