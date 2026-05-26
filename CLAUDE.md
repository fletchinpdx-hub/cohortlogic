# Cohort Logic — CLAUDE.md

## What this is
A web app for school administrators to generate balanced, equitable classroom assignments. Built by Michael Fletcher (Cohort Logic) as the first product in a teacher tools suite.

**Live site:** cohortlogic.com  
**Demo access code:** democlass  
**GitHub:** github.com/fletchinpdx-hub/cohortlogic  
**Local dev:** http://localhost:3456 (run via `npx serve -l 3456 .`)

## Product name
Currently "TBD Class Tool" — name not finalized. Company is Cohort Logic.

## Who uses it
School administrators (not teachers directly). They manage multiple grades, each with multiple classes, and need to distribute ~500 students equitably across classrooms before the school year starts.

## Core workflow
1. Import student data from Excel (.xlsx) or public Google Sheet
2. Map spreadsheet columns to app fields (configurable)
3. Define competencies — each is a score, category, flag, or has a direction
4. Review student list, set separation pairs (students who can't be in the same class)
5. Configure classes per grade, assign teachers, optionally add grade-split classes
6. Generate balanced class lists
7. Drag-and-drop to fine-tune, then export to Excel

## Key product decisions
- **No backend, no database** — everything runs in the browser. Data is never sent to a server. This is intentional for v1 (privacy, simplicity). Data does not persist between sessions — known limitation for v2.
- **Session-based auth** — `sessionStorage` gate with a demo code. Not cryptographically secure but sufficient for trusted demo users. The code is in the client-side JS.
- **Public Google Sheets only** — private Sheets (OAuth) is a planned future feature.
- **Netlify hosting** — auto-deploys on every push to `main` on GitHub. Site: gleeful-banoffee-050c62.netlify.app → cohortlogic.com (DNS at Porkbun: A → 75.2.60.5, CNAME www → gleeful-banoffee-050c62.netlify.app).
- **No framework** — vanilla HTML, CSS, JavaScript only. SheetJS loaded from CDN for Excel parsing/generation.
- **Brand** — navy (#0a2240) / teal (#0ea5e9) / gold (#f59e0b), Nunito font (Google Fonts), logo at images/logo.png.

## Competency types (js/fieldMapping.js)
Each competency has a `type`:
- **score** — numeric value within a user-defined min/max range. Has a `direction`: `'asc'` (high = good, default) or `'desc'` (low = good). Shown as color-coded badges in results. Used in composite score for balancing.
- **category** — string value read from data (e.g. Ethnicity). Balanced across classes by a swap-pass algorithm. Shown as `.cat-badge` in results.
- **flag** — yes/no boolean (e.g. IEP, 504). Not used in composite score directly.

Default competencies: Math (score), Reading (score), Writing (score), Behavior (score), IEP (flag), 504 (flag), Ethnicity (category).

## Balancing algorithm (js/algorithm.js)
- `computeComposite(s)` — normalizes all score competencies to 0–1 using `(v - min) / (max - min)`, then inverts if `direction === 'desc'`. Averages across all score competencies.
- `sortByComposite(students)` — sorts students best → worst by composite.
- `snakeDraft(students, classCount)` — distributes students using snake-draft order (1,2,3,4,4,3,2,1…) for even score spread.
- `fixSeparations(classes)` — up to 10 passes to swap students violating separation constraints.
- `balanceCategories(classes)` — up to 10 swap passes to equalize category distributions across classes.
- **Split classes** — grouped by grade pair. `halfSize` calculated ONCE from original pool sizes. Each split class pulls ~50% from each grade using `pickDistributed`. Remaining students go to regular grade classes.

## Grade split classes (js/classes.js)
Admins can add one or more split classes that draw from two grade levels (e.g. a 3/4 split). Configured in the Classes step. Regular class counts can be set to 0 if all classes are splits. `AppState.splitClasses` holds the config; `AppState.splitResults` holds the generated output.

## File structure
```
index.html        — Landing page with access code gate (Cohort Logic branding)
app.html          — The main application (redirects to index.html if no session)
admin/
  index.html      — Admin panel (Supabase auth, password reset, user management)
  admin.js        — doLogout(), toggleMagicLink(), PASSWORD_RECOVERY handler
css/
  styles.css      — All styles (CSS variables, layout, components)
js/
  app.js          — Central AppState object, navigation, sidebar status, utilities
  import.js       — Excel drag & drop + Google Sheets URL import, auto-guess mapping
  fieldMapping.js — Column mapping UI, competency config (score/category/flag + direction)
  students.js     — Student table, grade filter, separation pairs modal
  classes.js      — Grade/class config, teacher assignment, split class UI
  algorithm.js    — Balancing algorithm, separation fixing, category balancing, averages
  results.js      — Class card display, drag-to-move students, Excel export
  sample.js       — Generates a 500-student sample Excel file for testing
images/
  logo.png        — Transparent background PNG logo
```

## AppState (js/app.js)
Central state object shared across all modules:
- `rawRows` / `rawHeaders` — data as imported from spreadsheet
- `students` — mapped student objects: `{ id, firstName, lastName, grade, scores{} }`
- `separations` — array of `{ a: studentId, b: studentId }` pairs
- `competencies` — array of `{ name, type: 'score'|'category'|'flag', column, min?, max?, direction? }`
- `columnMap` — maps required fields (firstName, lastName, grade) to spreadsheet columns
- `gradeConfig` — `{ grade: { classCount, teachers[] } }`
- `splitClasses` — `[{ id, grades: ['3','4'], teacher: '' }]`
- `results` — `{ grade: [ [students], [students], ... ] }`
- `splitResults` — `[{ id, grades, teacher, students: [] }]`

## Sample spreadsheet
500 students across grades K–5. Generated in-browser via SheetJS — "Download Sample Spreadsheet" button on the Import view.

## Deployment
- `git push origin main` → Netlify auto-deploys to cohortlogic.com (no build step)
- Admin panel lives at cohortlogic.com/admin/ — uses Supabase auth
- Safari-specific issue: button click handlers must use `onclick="fn()"` attribute pattern, not `addEventListener`, for reliable click registration

## What's built (v1)
- Full import → map → review → configure → generate → export flow
- Configurable competencies: score (with min/max/direction), category, yes/no flag
- Grade split classes with ~50/50 pull from two grade levels
- Separation pairs with grouped display
- Snake-draft balancing + category balancing + separation enforcement
- Drag-and-drop manual adjustments in results view
- Excel export of final class lists (regular grades + split classes tab)
- Cohort Logic branding (navy/teal/gold, Nunito, logo)
- Admin panel with Supabase auth and password reset

## Planned / not yet built
- User accounts and persistent data storage (requires backend)
- Private Google Sheets import (requires OAuth)
- Save/load sessions
- Print-friendly class list view
- Ability to lock individual students to a specific class
- Mobile responsiveness (currently desktop-only)
- Logo text fix: currently reads "Smarter fools for schools" — needs designer correction to "Smarter tools for schools"
