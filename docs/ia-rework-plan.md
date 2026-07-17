# IA Rework — Plan

Resumable plan for reworking the Instructional Assistant (IA) flow in Schedule
Builder: grade **preferences** on the roster, a new **IA Assignment** config tab,
an **automatic placement engine**, and editing (incl. partial blocks) on the **IA
Schedule** tab. Written so any phase can be picked up cold.

Status legend: ☐ not started · ◐ in progress · ☑ done + deployed + verified.

---

## Goal (what the user asked for)

1. **Staff Roster:** for IAs, replace the single "Primary Grade" with **Grade
   Preferences** (a set of grades the IA prefers). Preference is *soft* — the
   engine may place them elsewhere if it can't be met.
2. **New "IA Assignment" tab**, directly **below Block Types** in Setup. It holds:
   - A **budget categories** table (name + hours/day), tabular + **auto-save**
     (no Save button), styled like the Specials list.
   - A **coverage plan** table: one row per block that needs IA coverage. Rows are
     added by picking any block entered so far — **including Recess & Lunch and
     sub-blocks**. Per row: which **grades** are covered, **how many IAs per
     grade**, and which **budget categories may fund** it. Auto-saves.
3. **Placement engine:** software places IAs per the coverage plan and shows the
   result on the **IA Schedule** tab.
4. **IA Schedule tab:** user edits assignments there, **including assigning an IA to
   a partial block** (part of a block's time, not the whole thing).

---

## Decisions locked (from the design conversation)

- **Budget categories stay** as named funding buckets (Gen Ed, Title I, …), each
  with an hours/day budget. Per coverage row you set an **allow-list** of which
  categories may fund it; the **engine picks which allowed category to charge**,
  balancing them (fewest-remaining-hours drained last).
- **Count is PER GRADE.** A row `{grades:[K,1,2], iasPerGrade:2}` means each of K,
  1, 2 gets 2 IAs during *its own* occurrence of that block. Distinct occurrences
  → distinct demand; a single IA may cover several if their times don't overlap.
- **IAs-per-grade is entered per row.** To vary the count across grades, the user
  splits into multiple rows (e.g. "K‑2 lunch → 2" and "3‑5 lunch → 1").
- **No ranked preferences.** Grade Preferences is an unordered set.
- **Re-run wipes and recomputes.** "Place IAs" clears all engine assignments and
  rebuilds, behind a **confirm dialog** warning that hand-edits will be lost.
  Duties (`SchedState.duties`) live outside `iaSchedule` and are **untouched**.
- **The Master Schedule "Assign IAs" mode is removed.** All IA editing happens on
  the IA Assignment tab (config) or the IA Schedule tab (per-assignment).
- **Budget hours/day is a SOFT cap** (warn, don't block). **No double-booking** and
  **within the IA's working hours** are HARD constraints.
- Grade preferences apply to IAs only; classroom teachers keep `gradeAssignment` /
  `splitGrade`.

---

## Data model

### Changed — IA staff object
IAs stop using `gradeAssignment`/`splitGrade`; they gain:
```js
gradePreferences: string[]   // grade keys, e.g. ['3','4','5']; [] = no preference
```
- Teachers keep `gradeAssignment`/`splitGrade` unchanged. The staff form shows the
  grade dropdown for classroom teachers, and a **Grade Preferences** multi-select
  for IAs (role-conditional, like the existing color field).
- **Migration:** on load, an IA with a legacy `gradeAssignment` and no
  `gradePreferences` → `gradePreferences = [gradeAssignment]`. Leave the old fields
  in place (inert for IAs) so old files round-trip.

### New — coverage plan
```js
SchedState.iaCoverage = [
  {
    id,                       // uid()
    blockId,                  // any block: required instructional, bt_lunch, bt_recess, bt_mm, …
    subId: null,              // sub-block id, or null for the whole block
    grades: ['K','1','2'],    // grades this row covers
    iasPerGrade: 2,           // PER grade, per occurrence
    allowedAllocIds: [ids],   // budget categories that MAY fund this row (allow-list)
  },
  …
]
```
Persisted in the `.cohortlogic` file (add to `downloadScheduleFile` payload +
`loadScheduleFromFile` restore). Auto-saved via `saveToLocal()` on every edit.

### Unchanged — budget categories
`SchedState.iaAllocations = [{ id, name, color, hoursPerDay }]`. Only the **editing
UI** changes (table + auto-save instead of the line-by-line "+ Add category" panel).
`hoursPerDay` becomes a real (soft) input to the engine's budget balancing.

### Unchanged — IA schedule entries
`iaSchedule[day][iaId][slot] = { allocId, targetType:'grade', targetId:<grade>, note }`.
The engine writes these; partial coverage is just a shorter contiguous slot run
(storage is already per-5-min-slot). No shape change.

---

## Nav & wiring

- Add `<a class="nav-item" data-view="ia-assign" id="nav-ia-assign">` **after Block
  Types** (`schedule-app.html`, after the `data-view="blocks"` item, still under
  PHASE 1 — SETUP).
- `VIEW_RENDERERS['ia-assign'] = () => { navigateTo('ia-assign'); renderIAAssignmentView(); }`
  (`schedule-init.js`).
- Add `<div id="view-ia-assign" class="view"></div>` to `<main>`.
- **Lock rule** (`updateSidebarStatus`): unlock `#nav-ia-assign` when at least one IA
  exists (`staff.some(s => s.role === 'ia')`) — same rule as `#nav-ia`. (Config also
  needs blocks, but blocks precede this tab in the flow, so the IA gate is enough.)
- The existing **"IA Schedule"** tab (`data-view="ia"`, PHASE 2 — DETAIL) stays put;
  it becomes view + edit only.

---

## Placement engine (Phase 3 — the core, high-judgment)

`placeIAs()` — pure data mutation over `SchedState.iaSchedule`, no DOM. Deterministic
(no `Math.random`, stable sorts) so re-runs on the same inputs are identical.

**Inputs:** `iaCoverage`, `masterSchedule`, IA staff (`gradePreferences`,
`startTime`/`endTime`), `iaAllocations` (budgets), `gradeBands`.

**Per day (Mon–Fri):**
1. **Build demand.** For each coverage row, for each grade in `row.grades`: find the
   block's occurrence(s) in `masterSchedule[day][grade]` — contiguous run(s) of
   `blockId` (or `blockId|subId` when `subId` set). Each occurrence is one demand
   unit: `{ day, grade, blockId, subId, slots:[…], need: row.iasPerGrade, allowedAllocIds }`.
   A grade with no occurrence of that block that day contributes nothing.
2. **Order demand** hardest-first: fewest eligible IAs first (mirrors the specials
   placer's tightest-first logic), tie-break by start time then grade. This keeps a
   scarce IA from being consumed by an easy demand a constrained one also needed.
3. **Assign.** For each demand unit, pick `need` IAs, each of whom is:
   - **HARD:** working hours cover the whole slot run (`startTime ≤ run start`,
     `endTime ≥ run end`); and **not already assigned** to any overlapping slot that
     day (no double-booking).
   - **SOFT, in priority order:** grade ∈ `gradePreferences`; then the IA with the
     most remaining daily hours (spread the load).
   Charge each placement to an allowed category chosen to **balance budgets** (the
   allowed alloc with the most remaining `hoursPerDay` headroom). Write
   `iaSchedule[day][iaId][slot]` for every slot in the run.
4. **Record shortfalls.** If fewer than `need` eligible IAs → push
   `{ day, grade, block, needed, placed }` to a warnings list.

**Output:** `iaSchedule` populated; a coverage-warnings array surfaced in a panel on
the IA Assignment / IA Schedule tab (reuse the consolidated-warnings pattern —
`_mountWarning`). Over-budget categories are a separate soft warning.

**Trigger:** a **"Place IAs"** button (IA Assignment tab, and/or IA Schedule tab).
First clears every engine-written `iaSchedule` entry (all of them — manual edits
included, per the wipe decision), then runs. Guarded by a confirm dialog:
*"This will replace all current IA assignments, including any you've edited by hand.
Continue?"* Duties are not in `iaSchedule`, so they survive.

---

## Phases

### Phase 0 — Plan doc ☑
This file.

### Phase 1 — Staff Roster: Grade Preferences (IA only) ☐
- Replace the Primary/Split grade fields **for IAs** with a Grade Preferences
  multi-select (chips or checkboxes over `school.grades`). Classroom teachers keep
  the existing dropdown. Role-conditional show/hide like the color field.
- Save → `gradePreferences: []`. Add the load-time migration.
- Staff table + Review card: show an IA's preferences (or "No preference").
- **Files:** `schedule-setup.js` (form, collect, table, review), `schedule-state.js`
  (migration in load path).
- **Verify:** add an IA, set prefs, save, reload from file → prefs persist; a
  legacy file's IA gets its old grade seeded as a preference; teachers unchanged.
- **Sonnet-suitable:** yes — mechanical, well-scoped, mirrors existing form patterns.

### Phase 2 — IA Assignment tab (config UI, no engine) ☐
- Nav item + view + renderer + lock rule (see Nav & wiring).
- **Budget categories table:** name + hours/day + color, add/remove rows,
  **auto-save on input** (`saveToLocal` on change, no Save button). Migrate the
  existing line-by-line allocations UI into this table; keep the `iaAllocations`
  shape.
- **Coverage plan table:** add-row picks a block/sub-block from everything entered
  so far (required blocks + `bt_lunch`/`bt_recess`/`bt_mm` + sub-blocks); per row set
  grades (multi-select), IAs/grade (number), allowed budget categories
  (multi-select). Auto-save. Fully editable (add/remove/edit).
- Style to match the Specials list / Block Types tables.
- **Files:** `schedule-app.html`, `schedule-init.js`, a new render fn (put it in
  `schedule-ia.js` next to the other IA UI, or a small `schedule-ia-assign` section),
  `schedule.css`, `schedule-state.js` (persist `iaCoverage` in file save/load).
- **Verify:** configure categories + rows; auto-save survives a reload; picking a
  sub-block works; file round-trips `iaCoverage`.
- **Sonnet-suitable:** yes, given this spec + the existing table code to pattern off.

### Phase 3 — Placement engine + warnings ☐
- Implement `placeIAs()` per the spec above. "Place IAs" button + confirm dialog +
  wipe + run. Coverage-shortfall + over-budget warnings panel.
- **Files:** `schedule-ia.js` (or `schedule-grid.js` alongside the other placement
  algorithms — keep engines together). Reuse `findBlockStart`/`getAllBlockSlots`,
  `timeToMins`/`minsToTime`, the warnings mount.
- **Verify with a node harness** (like the specials/off-carousel tests): feed a
  known master schedule + coverage + IAs, assert no double-booking, hours respected,
  preferences honored when possible, shortfalls reported, budgets balanced. Then a
  browser pass on real data.
- **Sonnet-suitable:** **no — keep on Opus.** This is the high-judgment core; subtle
  bugs (double-booking, overlap math, preference fallback, budget balance) produce
  plausible-but-wrong schedules that are hard to eyeball. Opus writes + tests it.

### Phase 4 — IA Schedule tab: edit incl. partial; remove master "Assign IAs" ☐
- **Remove** the Master Schedule "Assign IAs" mode (`toggleIAMasterMode`, the
  `#ia-mode-toggle-btn`, `openIABlockPanel` path). Check-refs will catch stragglers.
- IA Schedule editor (`openIAAssignmentEditor`) gains **partial-time** editing:
  set a custom start/end within a block for an assignment. The per-slot storage +
  `_getIAPartialTime` already exist in the (removed) master panel — lift that
  start/end-select logic into the IA Schedule editor.
- Also allow reassigning the IA and changing the budget category from here.
- **Files:** `schedule-ia.js`, `schedule-grid.js` (remove the mode), `schedule.css`.
- **Verify:** edit an assignment to cover half a block; it renders as a partial run;
  reassign IA/category; the master "Assign IAs" button is gone and nothing errors.
- **Sonnet-suitable:** borderline — the partial-edit UI is fiddly but bounded. OK for
  Sonnet with a tight spec + the existing custom-time code to copy; else Opus.

---

## Hard constraints / do-not-break

- **CSP:** no inline `onclick`/`onchange`/`oninput`; all handlers via
  `addEventListener`; file inputs via `<label for>`. Auto-save = `input`/`change`
  listeners.
- **Classic-script globals:** every function/const referenced across files must be
  defined in the loaded bundle — `tests/check-refs.js` enforces it. Removing the
  master "Assign IAs" mode (Phase 4) *will* trip it if a caller is missed; that's the
  gate doing its job.
- **Deploy** only via `bash scripts/deploy.sh`; bump ALL `?v=` in
  `schedule-app.html` in lockstep each deploy.
- **Determinism** in `placeIAs()` — no `Math.random`/`Date.now` in placement logic.
- **Duties** are separate from `iaSchedule`; never wipe them on re-run.
- **File round-trip:** `iaCoverage` + IA `gradePreferences` must be in the
  `.cohortlogic` payload and restored on load, or a save/reload silently drops the
  whole config.
- Use brand CSS vars, never raw hex.

---

## Open defaults (flagged; change if the user objects)

- Coverage applies to **every occurrence** of a block for a grade across the week
  (all days it appears, including alt/early-release days at whatever length they
  run). No per-day coverage overrides in v1.
- Budget hours/day = **soft** (warn only).
- "Place IAs" **wipes all** `iaSchedule` grade assignments (manual included) and
  rebuilds. No partial/incremental placement in v1.
- Partial-block coverage is a **manual edit**, not a config input — the coverage
  plan requests whole-block coverage; you shorten it by hand on the IA Schedule tab.
