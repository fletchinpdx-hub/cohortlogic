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
- **Duty parity (lunch + recess only).** Spread lunch and recess supervision evenly
  across IAs, measured in **minutes**, balanced **per type** (separate lunch and
  recess tallies) and **across the whole week** — so no one becomes "the lunch
  person" or "the recess person." Parity balances *within* grade-preference tiers
  (preference still leads for these blocks) and is **subordinate to budget** (never
  forces an over-budget placement just to equalize). Only lunch/recess get parity;
  instructional coverage doesn't.
- **Each IA's own lunch.** Per IA, an optional **duration + time window** for their
  personal break (to eat, not supervise). The engine reserves it inside the window,
  marks that time **unavailable for coverage** (hard), and it is **not charged to a
  budget** and **not counted as duty** for parity. Configured on the **Staff
  Roster** (per-IA, next to hours). Warn if it can't be fit.
- **Consistent weekly schedules.** The engine assigns IAs to **weekly recurring
  coverage requirements** and reuses the same IA across every day a block occurs,
  falling back to another IA only on a day the first genuinely can't cover (flagged
  as an inconsistency). Consistency is by construction, not luck.

---

## Data model

### Changed — IA staff object
IAs stop using `gradeAssignment`/`splitGrade`; they gain:
```js
gradePreferences: string[]   // grade keys, e.g. ['3','4','5']; [] = no preference
ownLunch: {                  // optional; null/absent = no reserved break
  duration:    number,       // minutes
  windowStart: 'HH:MM',      // earliest the break may start
  windowEnd:   'HH:MM',      // latest the break may END
} | null
```
- Teachers keep `gradeAssignment`/`splitGrade` unchanged. The staff form shows the
  grade dropdown for classroom teachers, and — for IAs — a **Grade Preferences**
  multi-select plus the **own-lunch** duration + window fields (role-conditional,
  like the existing color field).
- **Migration:** on load, an IA with a legacy `gradeAssignment` and no
  `gradePreferences` → `gradePreferences = [gradeAssignment]`. Leave the old fields
  in place (inert for IAs) so old files round-trip. `ownLunch` absent = no break.

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
(no `Math.random`, stable sorts) so re-runs on the same inputs are identical. The
engine is organized around **weekly recurring requirements**, not per-day demands —
that's what delivers cross-day consistency and clean weekly parity.

**Inputs:** `iaCoverage`, `masterSchedule`, IA staff (`gradePreferences`,
`startTime`/`endTime`, `ownLunch`), `iaAllocations` (budgets), `gradeBands`.

**Step 0 — Reserve own lunches.** For each IA with `ownLunch`, find a
`duration`-long free run inside `[windowStart, windowEnd]` (best-effort: the least
coverage-contended spot; simplest robust = first-fit, ideally the SAME time each
day). Write it to `iaSchedule` as a sentinel break (`targetType:'own_lunch'`, no
`allocId`) so it renders on the grid and blocks double-booking. These slots are now
**unavailable** for coverage and **don't count** toward duty parity or budget. Warn
if it can't fit inside the window.

**Step 1 — Build weekly requirements.** For each coverage row, for each grade in
`row.grades`, emit one requirement:
`{ blockId, subId, grade, need: row.iasPerGrade, allowedAllocIds, occurrences: [{day, slots:[…]}, …] }`
where `occurrences` are that grade's runs of `blockId`(`|subId`) across Mon–Fri.
A grade/day with no occurrence contributes nothing. `isDuty = blockId ∈ {bt_lunch, bt_recess}`.

**Step 2 — Order requirements** hardest-first: fewest eligible IAs first (mirrors the
specials placer), tie-break by earliest occurrence then grade. Keeps a scarce IA from
being spent on an easy requirement a constrained one also needed.

**Step 3 — Assign each requirement to `need` IA(s), reused across all its days.**
For a candidate IA to take a requirement, per occurrence day they must (HARD):
working hours cover the run, and not already booked (coverage or own-lunch) in any
overlapping slot that day. Rank candidates by SOFT goals, **preference always first**:
   1. **grade ∈ `gradePreferences`** (a real tier boundary — non-preferring IAs are
      only reached if preferring ones run out). Applies to lunch/recess too.
   2. **duty parity** *(lunch/recess requirements only)* — within the preference
      tier, prefer the IA with the least accumulated **minutes of that same type**
      (separate `lunchMin`/`recessMin` tallies), so lunch and recess each spread.
   3. **total-load balance** — fewest assigned minutes so far, to even overall hours.
Assign the chosen IA to **every** occurrence day they're free; on a day they're not
free, fall back to the next-best candidate for that day only and flag an
**inconsistency** (`{grade, block, day, ...}`). Charge each placement to an allowed
category with the most remaining `hoursPerDay` headroom (budget balancing). Write
`iaSchedule[day][iaId][slot]` for every slot; bump the IA's `lunchMin`/`recessMin`/
total tallies.

**Step 4 — Record shortfalls.** If fewer than `need` eligible IAs for a requirement
(on any day) → push `{ day, grade, block, needed, placed }` to the warnings list.

**Output:** `iaSchedule` populated (coverage + own-lunch breaks); warnings arrays for
**coverage shortfalls**, **schedule inconsistencies**, and **over-budget categories**,
surfaced in a panel (reuse the consolidated-warnings pattern — `_mountWarning`).

**Trigger:** a **"Place IAs"** button (IA Assignment tab, and/or IA Schedule tab).
First clears every engine-written `iaSchedule` entry (all of them — manual edits
included, per the wipe decision), then runs. Guarded by a confirm dialog:
*"This will replace all current IA assignments, including any you've edited by hand.
Continue?"* Duties are not in `iaSchedule`, so they survive.

---

## Phases

All four phases are being built **in-session on Opus** (the user opted not to hand
any phase to Sonnet). Each still ships and is verified independently — gate +
browser/harness pass — so the plan stays resumable.

### Phase 0 — Plan doc ☑
This file.

### Phase 1 — Staff Roster: Grade Preferences + own lunch (IA only) ☑
- Replace the Primary/Split grade fields **for IAs** with a Grade Preferences
  multi-select (chips or checkboxes over `school.grades`). Classroom teachers keep
  the existing dropdown. Role-conditional show/hide like the color field.
- Add **own-lunch** fields for IAs: duration (min) + window start/end. Optional
  (blank = no reserved break). → `ownLunch: {duration, windowStart, windowEnd} | null`.
- Save → `gradePreferences: []` + `ownLunch`. Add the load-time migration.
- Staff table + Review card: show an IA's preferences (or "No preference") and, if
  set, their reserved lunch.
- **Files:** `schedule-setup.js` (form, collect, table, review), `schedule-state.js`
  (migration in load path).
- **Verify:** add an IA, set prefs + own lunch, save, reload from file → both
  persist; a legacy file's IA gets its old grade seeded as a preference; teachers
  unchanged.

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

### Phase 3 — Placement engine + warnings ☐
- Implement `placeIAs()` per the spec above. "Place IAs" button + confirm dialog +
  wipe + run. Coverage-shortfall + over-budget warnings panel.
- **Files:** `schedule-ia.js` (or `schedule-grid.js` alongside the other placement
  algorithms — keep engines together). Reuse `findBlockStart`/`getAllBlockSlots`,
  `timeToMins`/`minsToTime`, the warnings mount.
- **Verify with a node harness** (like the specials/off-carousel tests): feed a
  known master schedule + coverage + IAs, and assert — no double-booking; working
  hours respected; own lunches placed inside their windows and left uncovered;
  preferences honored when possible; the **same IA reused across days** (consistency)
  with fallbacks flagged; **lunch and recess minutes balanced per type** across IAs
  within a preference tier; shortfalls + inconsistencies + over-budget all reported;
  budgets balanced. Then a browser pass on real data.
- The high-judgment core — subtle bugs (overlap math, preference/parity interaction,
  own-lunch reservation, cross-day reuse) produce plausible-but-wrong schedules that
  are hard to eyeball, which is why it's tested with an assertion harness, not just a
  visual check.

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
- Each IA's **own lunch** is configured on the **Staff Roster** (not the IA
  Assignment tab), engine-placed within its window, optional per IA.
- **Duty parity = lunch + recess only**, by minutes, per type, across the week,
  within preference tiers, subordinate to budget.
