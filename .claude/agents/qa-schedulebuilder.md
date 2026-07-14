---
name: qa-schedulebuilder
description: Post-deploy QA smoke test for the Cohort Logic Building Schedule Builder at cohortlogic.com/schedule-app.html. Run after every deploy to verify the live app works end-to-end. Especially valuable after the schedule-grid.js monolith split (v146–v149) — it exercises each of the extracted feature files (IA Schedule, Specials Schedule view, Class Schedules view, Export) in a real logged-in session, which the static reference checker can't. Reports pass/fail with screenshots. Part of the full QA suite — see the "QA process" section in CLAUDE.md; running "QA" runs this AND every other qa-*.md agent. Use this whenever the user says "run QA", "run schedule QA", "test the deploy", "smoke test", or "qa-schedulebuilder".
---

# QA Smoke Test — Cohort Logic Schedule Builder

You are running a post-deploy QA check on the live Schedule Builder at **https://cohortlogic.com/schedule-app.html**.

**Why this exists:** the ~6,200-line `schedule-grid.js` was split into feature files (`schedule-ia.js`, `schedule-specials-view.js`, `schedule-class-view.js`, `schedule-export.js`) loaded as separate classic `<script>` tags sharing one global scope. The failure mode of a bad split is an **`Uncaught ReferenceError: <name> is not defined`** the moment a view opens — a function that didn't get moved, or loaded out of order. The whole point of this QA is to open each view in a real session and catch exactly that. **Any `Uncaught ReferenceError` or CSP error when a view renders is a FAIL — report the exact missing name.**

Work through the checklist in order. After each step, check the browser console. If a step fails, screenshot it and keep going — report everything at the end.

---

## Setup

Load the chrome browser tools before starting:
```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool
```

Read the QA credentials from `/Users/michaelfletcher/Documents/cohortlogic/.qa-credentials` (`qa_email`, `qa_password`).

Open a fresh tab and navigate to `https://cohortlogic.com/login.html`.

---

## Checklist

### 1. Login + product gate + app boot
- Enter `qa_email` / `qa_password`, click **Sign in**
- **Pass:** redirects to `dashboard.html`
- Navigate to `https://cohortlogic.com/schedule-app.html`
- **Pass:** the Schedule Builder loads — sidebar shows School Info, Staff Roster, Specials, Block Types, Master Schedule, Specials Schedule, Class Schedules, IA Schedule, Export
- **Fail (prerequisite, not a code bug — flag it clearly):** an access-denied / locked screen means the QA account lacks `schedule_builder` in its school's `enabled_products`. Note this and stop — the rest can't run until the account is granted access.
- Run `read_console_messages` — any CSP error (`Refused to execute inline script`, `Content-Security-Policy`) or uncaught exception at boot is a **Fail**. A boot-time `ReferenceError` here would mean a script failed to load or a top-level `const` is used before its file — the split's worst case.

---

### 2. Seed a minimal schedule (so every view has something to render)

The detail views need a configured school. Rather than click through the whole setup wizard, inject a minimal valid state via JS, then let the app build the schedule. Run in `javascript_tool`:

```javascript
// Minimal school: 2 grades, 1 band, lunch+recess, a special, an IA, one required block.
SchedState.school = Object.assign(SchedState.school, {
  name: 'QA Test School', year: '2026-2027',
  grades: ['K','1'],
  gradeBands: [{ id: 'bandA', name: 'K-1', grades: ['K','1'] }],
  firstBell: '08:00', dismissal: '14:30', studentCampusStart: '07:45',
  lunchPeriods: [{ id: 'lp1', start: '11:00', duration: 30, grades: [] }],
  gradeRecesses: {
    K:   [{ id: 'rK', duration: 20, lunchAdjacent: true, lunchSide: 'after' }],
    '1': [{ id: 'r1', duration: 20, lunchAdjacent: true, lunchSide: 'after' }],
  },
  specials: [{ id: 'sp_pe', name: 'PE', duration: 40, classesPerWeek: 1, teacherIds: ['t_pe'], color: '#f97316' }],
  specialsRotationMode: 'intermittent',
  blockPairings: [], morningMeetings: [], altDays: [],
});
SchedState.staff = [
  { id: 'c_k', name: 'Ms. K',    role: 'classroom_teacher', gradeAssignment: 'K' },
  { id: 'c_1', name: 'Mr. One',  role: 'classroom_teacher', gradeAssignment: '1' },
  { id: 't_pe', name: 'Coach P', role: 'specials_teacher' },
  { id: 'ia_1', name: 'Aide Amy', role: 'ia', color: '#22c55e' },
];
// Keep the default fixed block types; add one required instructional block.
if (typeof ensureFixedBlockTypes === 'function') ensureFixedBlockTypes();
if (!SchedState.blockTypes.some(b => b.id === 'bt_ela')) {
  SchedState.blockTypes.push({
    id: 'bt_ela', name: 'ELA', color: '#3b82f6', category: 'instruction',
    required: true, bandMinutes: { bandA: 60 }, subBandMinutes: {}, subBlocks: [],
  });
}
SchedState.iaAllocations = [{ id: 'alloc1', name: 'Reading Support', color: '#22c55e', hoursPerDay: 6 }];
SchedState.iaSchedule = SchedState.iaSchedule || {};
saveToLocal();
'seeded: ' + SchedState.school.grades.join(',') + ' | staff ' + SchedState.staff.length;
```

- **Pass:** returns `"seeded: K,1 | staff 4"` with no thrown error
- **If it throws** (SchedState shape drifted since this was written): note it, then either fix the field it complained about or fall back to driving the setup UI (School Info → set name + grades K,1 + times → Save; Staff → add the 4 people above; Specials → add PE; Block Types → add band K-1 + a required ELA block). The goal is only a populated schedule so the views have data.

---

### 3. Master Schedule (core `schedule-grid.js`)
- Click **Master Schedule** in the sidebar (or `navigateTo('master'); renderMasterSchedule();` via JS)
- **Pass:** the grid table renders with grade columns (Kindergarten, 1st Grade), time rows, and auto-filled blocks (Lunch, Recess, ELA, Specials visible). The left palette lists block types.
- `read_console_messages` — **Fail** on any `Uncaught ReferenceError` / CSP error.
- Sanity-check the placement engine still runs: confirm at least one `bt_lunch` and one instructional block are present:
  `JSON.stringify(Object.values((SchedState.masterSchedule.Monday||{}).K||{}).filter((v,i,a)=>a.indexOf(v)===i))`
  — **Pass:** array includes `"bt_lunch"` and `"bt_ela"` (or `bt_spec`).

---

### 4. IA Schedule view (extracted → `schedule-ia.js`) — KEY SPLIT CHECK
- Click **IA Schedule** (or `navigateTo('ia'); renderIAScheduleView();`)
- **Pass:** the IA view renders — the "All IAs" grid or individual-IA grid shows, with the IA (Aide Amy) and the allocation (Reading Support) present. No `ReferenceError`.
- Toggle to the individual-IA tab if present; confirm it renders.
- Exercise an assignment path — open the IA assignment on a master block:
  `navigateTo('master'); renderMasterSchedule(); if (typeof toggleIAMasterMode==='function') toggleIAMasterMode();`
  then confirm no error and the IA assign panel/hint appears. `read_console_messages` after — **Fail** on any error.
- Because this whole feature moved into a separate file, a missing helper (e.g. `buildIAGrid`, `openIABlockPanel`, `_dutySlotsFor`, `openDutyPanel`) would throw here — report the exact name.

---

### 5. Specials Schedule view (extracted → `schedule-specials-view.js`) — KEY SPLIT CHECK
- Click **Specials Schedule** (or `navigateTo('specials-sched'); renderSpecialsScheduleView();`)
- **Pass:** the by-teacher weekly grid renders; the Coverage panel is present; Coach P appears as a specials teacher. No `ReferenceError`.
- Click a filled specials cell (or confirm `openSpecialsOverridePanel` is defined: `typeof openSpecialsOverridePanel`) — the override panel should be reachable.
- `read_console_messages` — **Fail** on any error. A missing `getSpecialsCoverageReport` / `buildSpecialsTeacherGrid` / `showSpecialsCoverageBanner` would surface here.
- **Note:** the specials scheduling *algorithm* (`buildSpecialsSchedule`) stayed in core — if THAT is missing the Master Schedule (step 3) would already have failed.

---

### 6. Class Schedules view (extracted → `schedule-class-view.js`) — KEY SPLIT CHECK
- Click **Class Schedules** (or `navigateTo('class-sched'); renderClassSchedulesView();`)
- **Pass:** renders the single-class view; switching to grade-compare renders too. No `ReferenceError`.
- Confirm the helpers resolve: `[typeof getClassSlotEntry, typeof buildClassWeekGrid, typeof buildGradeCompareGrid, typeof classSchedUI]` — none should be `"undefined"`.
- `read_console_messages` — **Fail** on any error.

---

### 7. Export (extracted → `schedule-export.js`) — KEY SPLIT CHECK
- Click **Export** (or `navigateTo('export'); renderExportPlaceholder();`)
- **Pass:** the Export view renders with the download/export buttons.
- Confirm the export functions resolve: `[typeof exportXLSX, typeof exportJSON, typeof _blendColumnRuns]` — none `"undefined"`.
- Trigger the JSON export (safe, no multi-sheet complexity): `exportJSON();` — **Pass:** a download starts / no error thrown. (Optionally `exportXLSX();` — it opens SheetJS; a thrown error is a Fail, a download is a Pass.)
- `read_console_messages` — **Fail** on any error.

---

### 8. Final console check
- `read_console_messages` with pattern `error|Error|CSP|Content-Security|Refused|Uncaught|is not defined`
- Any `Content-Security-Policy` error → **Fail** (exact message).
- Any `Uncaught ReferenceError`/`TypeError` → **Fail** — for a `ReferenceError`, the missing name tells you exactly which function didn't get moved or which file loaded out of order.
- Warnings are OK to note, not failures.

---

## Pre-deploy static checks (run locally before deploying)

The gate already covers this, but for reference — before deploying, `bash scripts/predeploy.sh` runs all 5 checks including `tests/check-refs.js`, which catches a missing cross-file reference statically. This live QA is the runtime complement: it catches things a static check can't (load order, a handler that throws only when its view actually renders).

---

## Log the run

After all steps, append one line to `/Users/michaelfletcher/Documents/cohortlogic/qa-runs.log` (gitignored):

```bash
printf '%s | %s | %s | %s\n' "$(date '+%Y-%m-%d %H:%M')" "schedulebuilder" "RESULT" "NOTES" >> /Users/michaelfletcher/Documents/cohortlogic/qa-runs.log
```

`RESULT` like `7/8 PASS`, `NOTES` a short summary (or `all green`). Always write it.

---

## Report Format

```
## QA Report — cohortlogic.com/schedule-app.html
Date: [today]

| Step | Result | Notes |
|------|--------|-------|
| 1. Login + gate + boot     | ✅ PASS / ❌ FAIL | |
| 2. Seed schedule           | ✅ PASS / ❌ FAIL | |
| 3. Master Schedule (core)  | ✅ PASS / ❌ FAIL | |
| 4. IA Schedule view        | ✅ PASS / ❌ FAIL | |
| 5. Specials Schedule view  | ✅ PASS / ❌ FAIL | |
| 6. Class Schedules view    | ✅ PASS / ❌ FAIL | |
| 7. Export                  | ✅ PASS / ❌ FAIL | |
| 8. Console errors          | ✅ PASS / ❌ FAIL | |

**Overall: X/8 steps passed**
```

For any ❌ FAIL: what was expected, what happened, the exact console error text (especially any `is not defined` name), and a screenshot.

If all steps pass, end with: "Schedule Builder deploy looks good. ✅"
