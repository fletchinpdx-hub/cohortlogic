# Class Creator — CLAUDE.md

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
3. Define competencies — each is either a score (1–5) or a yes/no flag
4. Review student list, set separation pairs (students who can't be in the same class)
5. Configure classes per grade and assign teachers
6. Generate balanced class lists
7. Drag-and-drop to fine-tune, then export to Excel

## Key product decisions
- **No backend, no database** — everything runs in the browser. Data is never sent to a server. This is intentional for v1 (privacy, simplicity). Data does not persist between sessions — this is a known limitation to address in v2.
- **Session-based auth** — `sessionStorage` gate with a demo code. Not cryptographically secure but sufficient for trusted demo users. The code is in the client-side JS.
- **Public Google Sheets only** — private Sheets (OAuth) is a planned future feature.
- **Porkbun static hosting** — connected via GitHub Connect. Pushing to `main` branch auto-deploys.
- **No framework** — vanilla HTML, CSS, JavaScript only. SheetJS loaded from CDN for Excel parsing/generation.

## Balancing algorithm (js/algorithm.js)
- Computes a composite score per student (average of all score-type competencies)
- Sorts students by composite score descending
- Distributes using snake-draft order (1,2,3,4,4,3,2,1...) for even spread
- Then runs up to 10 passes to fix separation constraint violations by swapping students between classes
- Class sizes stay within 1–2 students of each other naturally from the snake-draft

## File structure
```
index.html        — Landing page with access code gate (Cohort Logic branding)
app.html          — The main application (redirects to index.html if no session)
css/
  styles.css      — All styles (CSS variables, layout, components)
js/
  app.js          — Central AppState object, navigation, sidebar status, utilities
  import.js       — Excel drag & drop + Google Sheets URL import, auto-guess mapping
  fieldMapping.js — Column mapping UI, competency configuration, builds student objects
  students.js     — Student table, grade filter, separation pairs modal
  classes.js      — Grade/class configuration, teacher assignment
  algorithm.js    — Balancing algorithm, separation constraint fixing, class averages
  results.js      — Class card display, drag-to-move students, Excel export
  sample.js       — Generates a 500-student sample Excel file for testing
```

## AppState (js/app.js)
Central state object shared across all modules:
- `rawRows` / `rawHeaders` — data as imported from spreadsheet
- `students` — mapped student objects with `id`, `firstName`, `lastName`, `grade`, `scores{}`
- `separations` — array of `{a: studentId, b: studentId}` pairs
- `competencies` — array of `{name, type: 'score'|'flag', column}` — configurable
- `columnMap` — maps required fields (firstName, lastName, grade) to spreadsheet columns
- `gradeConfig` — `{ grade: { classCount, teachers[] } }`
- `results` — `{ grade: [ [students], [students], ... ] }`

## Sample spreadsheet
500 students across grades K–5 with: First Name, Last Name, Grade, Math Score (1–5), Reading Score (1–5), Writing Score (1–5), Attitude Score (1–5), IEP (Yes/No). Generated in-browser via SheetJS — "Download Sample Spreadsheet" button on the Import view.

## Deployment
- Push to `main` on GitHub → Porkbun auto-deploys to cohortlogic.com
- No build step needed — static files served directly

## What's built (v1)
- Full import → map → review → configure → generate → export flow
- Configurable competencies (score or flag type)
- Separation pairs with grouped display (one student can have multiple restrictions)
- Snake-draft balancing algorithm with separation enforcement
- Drag-and-drop manual adjustments in results view
- Excel export of final class lists
- Landing page with demo access gate

## Planned / not yet built
- User accounts and persistent data storage (requires backend)
- Private Google Sheets import (requires OAuth)
- Save/load sessions
- Print-friendly class list view
- Ability to lock individual students to a specific class
- GitHub OAuth login for administrators
- Mobile responsiveness (currently desktop-only)
