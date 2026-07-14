# Monolith split plan — `public/js/schedule-grid.js`

**Status: DONE.** STEP 0 (d62be5d) + all 4 extractions complete: IA (v146,
510663d), Specials Schedule view (v147, 323ae97), Class Schedules view
(v148, 2753a28), Export (v149, commit below).
**Owner:** any model/session can resume from this file.
**Goal:** carve the ~6,180-line `schedule-grid.js` into cohesive feature files
WITHOUT changing behavior. Started at v145.

### Extraction 1 (IA) done — notes for whoever does extraction 2
- New file `public/js/schedule-ia.js` (~1,678 lines), loaded after
  `schedule-grid.js` and before `schedule-init.js`. `schedule-grid.js` is now
  ~4,512 lines (was ~6,177).
- **The plan's line numbers had already drifted AND the section wasn't purely
  IA** — the "IA Schedule" banner range (was 3281–4398) had Export functions
  (`renderExportPlaceholder`, `exportJSON`, `_blendColumnRuns`, `exportXLSX`)
  physically interleaved inside it, added later without their own banner.
  Those four stayed in `schedule-grid.js` (core) — they belong to extraction 4
  (Export), not IA. Verify actual section contents with
  `awk 'NR>=X && NR<=Y && /^function |^const |^let /{print NR": "$0}'`
  before cutting a range — don't trust banner ranges alone.
- `exportIASummaryCSV` (IA's own CSV export, distinct from the multi-tab
  `exportXLSX`) DID move to schedule-ia.js — it's IA-specific, wired to
  `#ia-summary-csv-btn` in `wireIAScheduleEvents`.
- Three contiguous ranges actually moved (original schedule-grid.js line
  numbers, now historical): 3281–4078 (IA Schedule view, iaSchedUI/iaDrag/
  iaMasterState), 4672–4772 (IA assignment edit/delete), 5409–6177 (IA
  assignment from master schedule + Individual IA grid + Duty panel, ran to
  EOF).
- `_cleanupStaleIAAssignments` and `_purgeFixedBlockConflicts` were NOT in the
  IA banner ranges at all (they live in the "Save"/"Conflict helpers" core
  sections) — no special handling needed, they stayed in core automatically.
- `iaMasterState` is referenced from core (`onPointerDown`, `switchDay`, the
  wireGridPointer area) — confirmed safe because every reference is inside a
  function body (runtime-only), never at load time.
- Verified: `check-refs.js` reports the identical defined-name count (1050)
  before and after — confirms a lossless move, nothing duplicated or dropped.
  Full gate green. Browser boot clean (schedule-ia.js?v=146 → 200, zero
  console errors, page reached the sign-in screen normally).
- Deployed via `scripts/deploy.sh` (gate-checked), not raw wrangler.

### Extraction 2 (Specials Schedule view) done — notes for whoever does extraction 3
- New file `public/js/schedule-specials-view.js` (~571 lines), loaded after
  `schedule-ia.js` and before `schedule-init.js`. `schedule-grid.js` is now
  ~3,958 lines (was ~4,512).
- **The "Specials Schedule View" banner range was interleaved with THREE
  different things, not one** — this section had more surprises than
  extraction 1, not fewer. Do not assume a banner range is homogeneous; map
  every declaration in the range with `awk` before cutting anything, every
  time:
  - `classSchedUI` (extraction-3 material) was declared immediately adjacent
    to `specialsSchedUI` inside the SAME banner block — had to split them
    apart (specialsSchedUI moved, classSchedUI stayed in core for extraction 3).
  - `printScheduleGrid` sits physically between "Specials individual override"
    and `renderClassSchedulesView`. It's a SHARED print utility called from
    core (master grid print button), the specials view, the class-schedules
    view, AND schedule-ia.js. It stays in `schedule-grid.js` (core) — do not
    move it into any single feature file, extraction 3 included.
  - `renderClassSchedulesView` itself (extraction-3 material) was physically
    sandwiched between specials-view functions. Left in core, untouched, for
    extraction 3 to pick up.
  - Net result: extraction 2 was FIVE non-contiguous cuts from
    `schedule-grid.js`, not one contiguous block like extraction 1. That's
    fine — cut/paste each piece independently, same verification either way.
- Also noted (not fixed, out of scope — same treatment as the
  `downloadIAScheduleCSV` finding from extraction 1): `renderSpecialsPlaceholder`
  (in the earlier "Placeholder views" section, before this range) is defined
  but never called anywhere in the bundle. Dead code, left in core.
- Moved: `getSpecialsCoverageReport`, `showSpecialsCoverageBanner`
  ("Specials coverage validation"), `specialsSchedUI`,
  `renderSpecialsScheduleView` ("Specials Schedule View"),
  `openSpecialsOverridePanel`, `applySpecialsOverride` ("Specials individual
  override"), `buildSpecialsTeacherGrid`. The specials scheduling ALGORITHM
  (`buildSpecialsSchedule`, `findGradeFixedTime`, rotation,
  `getSpecialsAtSlot`, `buildSpecialsCell`) correctly stayed in core per the
  original plan — confirmed none of it was inside these banner ranges.
- Verified: `check-refs.js` reports the identical 1050 defined names before
  and after (7 files now). Full gate green. Browser boot clean
  (schedule-specials-view.js?v=147 → 200, zero console errors).
- Deployed via `scripts/deploy.sh` v147.

### Extraction 3 (Class Schedules view) done — notes for whoever does extraction 4
- New file `public/js/schedule-class-view.js` (~326 lines), loaded after
  `schedule-specials-view.js` and before `schedule-init.js`.
  `schedule-grid.js` is now ~3,641 lines (was ~3,958).
- Cleanest extraction so far — no interlopers this time. Only two pieces:
  `classSchedUI` (6 lines, right where extraction 2's notes said it would be)
  and `renderClassSchedulesView` through the rest of the file to EOF
  (`getClassSlotEntry`, `buildClassScheduleCell`, `buildClassWeekGrid`,
  `buildGradeCompareGrid` — all genuinely Class-Schedules-only). Confirmed
  with the same `awk 'NR>=X && /^function |^const |^let /'` scan before
  cutting — came back clean.
- `printScheduleGrid` sat physically between the two pieces (right after
  `classSchedUI`, right before `renderClassSchedulesView`) and correctly
  stayed in core, per extraction 2's note.
- One easy-to-miss detail: the tail of the "move to EOF" range included a
  stray leftover breadcrumb from extraction 1 (`// IA assignment... moved to
  schedule-ia.js`, which had become the literal last line of the file after
  that earlier cut). Moving it along with this cut would have wrongly implied
  IA content once lived in schedule-class-view.js. Excluded it from the moved
  range; it stays in schedule-grid.js as-is — when a "move to end of file"
  range ends in an existing breadcrumb comment, check whether that comment
  describes THIS extraction's content or a different, earlier one before
  including it.
- Verified: `check-refs.js` reports the identical 1050 defined names before
  and after (8 files now). Full gate green. Browser boot clean
  (schedule-class-view.js?v=148 → 200, zero console errors).
- Deployed via `scripts/deploy.sh` v148.

### Extraction 4 (Export) done — last one, plan complete
- New file `public/js/schedule-export.js` (~324 lines), loaded after
  `schedule-class-view.js` and before `schedule-init.js`.
  `schedule-grid.js` is now ~3,323 lines (was ~3,641; ~6,177 originally).
- Simplest cut of the four: one contiguous range (`renderExportPlaceholder`
  through the end of `exportXLSX`), no interlopers — this was exactly the
  block extraction 1 found and correctly left behind, so its location was
  already known going in.
- One easy off-by-one: `awk` had shown a section banner appearing right
  AFTER `exportXLSX`'s definition line, which was `printScheduleGrid` — but
  the naive "last line before the next declaration" read initially missed
  that `exportXLSX`'s own closing `}` was the line right before
  `printScheduleGrid`, not the line before that. Caught immediately by
  counting `{`/`}` balance on the cut piece before assembling the new file
  (77/77) — would also have been caught by `node --check` in check-refs.js
  either way, since an unbalanced cut is a parse error. Worth doing the
  brace-count sanity check on any cut before running the full verification
  chain — cheaper and faster to catch locally.
- Verified: `check-refs.js` reports the identical 1050 defined names before
  and after (9 files now). Full gate green. Browser boot clean
  (schedule-export.js?v=149 → 200, zero console errors).
- Deployed via `scripts/deploy.sh` v149.

### Final numbers
`schedule-grid.js`: 6,177 → 4,512 (IA) → 3,958 (Specials view) → 3,641
(Class view) → **3,323 lines** (Export). Four new feature files:
`schedule-ia.js` (~1,678), `schedule-specials-view.js` (~571),
`schedule-class-view.js` (~326), `schedule-export.js` (~324). Total lines
across all schedule-*.js grew slightly (~6,177 → ~6,222) from added file
headers/breadcrumbs — expected for a pure reorganization, not a regression.

### Two pre-existing dead-code findings surfaced along the way (NOT fixed —
### out of scope for this behavior-neutral split; flag to the user separately
### if cleanup is wanted)
- `downloadIAScheduleCSV` — called behind a `typeof ... === 'function'` guard
  in `schedule-ia.js`, never defined anywhere. Harmless no-op; a working
  duplicate (`exportIASummaryCSV`) is wired to the same button elsewhere.
- `renderSpecialsPlaceholder` — defined in `schedule-grid.js`, never called
  anywhere in the bundle.

### STEP 0 done — notes for whoever does extraction 1
- `tests/check-refs.js` built, wired into `scripts/predeploy.sh` as 5/5.
- Verified: passes clean on the current (unsplit) codebase (1050 names, 5
  files); sanity-checked by deliberately renaming a real function definition
  and confirming the checker caught all 16 now-broken call sites (exit 1),
  then restoring and re-confirming a clean pass (exit 0).
- One PRE-EXISTING (not introduced by this work) finding surfaced and is
  reported as a non-blocking warning, not a failure: `downloadIAScheduleCSV`
  is called at `schedule-grid.js:6164` behind a `typeof ... === 'function'`
  guard but is never defined anywhere — looks like dead/orphaned code from an
  earlier refactor (a working duplicate, `exportIASummaryCSV`, is wired to the
  same `#ia-summary-csv-btn` element elsewhere, at `wireIAScheduleEvents`).
  Harmless today (the guard no-ops it). NOT fixed here — out of scope for a
  behavior-neutral split; flag to the user separately if you want it cleaned
  up.
- The checker is a **pragmatic bundle-wide check, not a real JS scope
  resolver**: a local helper defined inside any function anywhere in the
  bundle satisfies a same-named call anywhere else, even though real JS
  scoping wouldn't allow that. This is intentional — the risk being guarded
  against is "the definition doesn't exist ANYWHERE after a copy/paste split,"
  not scope leakage. It also recognizes `typeof NAME === 'function'`/
  `!== 'undefined'` guards and demotes those to non-blocking warnings.
- Gotcha discovered while building it: naive string-literal tokenizing breaks
  on regex literals containing quote characters (e.g. `escHtml`'s `/"/g`) — a
  bare `/.../ ` scanner must distinguish regex-literal position from division
  via a value-position heuristic, or it misreads a quote *inside* a regex as
  opening a real string and blanks out everything up to the next stray quote
  in the file. See the `regexContext` heuristic in `check-refs.js` if you need
  to touch the tokenizer.
- Run it standalone any time: `node tests/check-refs.js`.

This is a **mechanical, one-feature-per-commit** refactor. The plan and the
safety model are already decided (below) — execution is precise and verifiable.
Good fit for Sonnet 5.

---

## Hard constraints (do not violate)

- **No build step. Classic `<script src>` only.** The whole app is no-build
  global-function scripts under a strict CSP (`script-src 'self' cdn.jsdelivr.net
  cdn.sheetjs.com`, no `unsafe-inline`). Do NOT convert to ES modules — that
  touches every global and every file; huge regression surface, zero runtime
  benefit here.
- **Behavior must not change.** This is a pure move-and-rewire. If a change would
  alter behavior, it's out of scope for this task.
- **Deploy only via `scripts/deploy.sh`** (runs the pre-deploy gate). Never raw
  `npx wrangler deploy`.

## The safety model (this is what makes it safe)

1. **Core state stays in the core file, loaded first.** The shared module-level
   state used across the whole grid stays in `schedule-grid.js`:
   `DAYS, currentSlots, currentGrades, gridUI, _gridKeydownWired, drag,
   AUTO_FILL_PRIORITY`. (Lines ~3–27 and ~2005 at time of writing.)
2. **Feature-local state moves WITH its feature file.** `iaSchedUI, iaDrag,
   iaMasterState` → the IA file; `specialsSchedUI` → the specials-view file;
   `classSchedUI` → the class-view file.
3. **Extracted files contain only function declarations + their own feature
   state.** Nothing that executes at load time referencing another file. Function
   bodies run only after all scripts have loaded, so cross-file calls resolve
   regardless of load order. The ONLY ordering rule: load `schedule-grid.js`
   (core) before the feature files in `schedule-app.html`.
4. **One feature per commit**, fully verified before the next.

## Why classic-script moves are safe

Top-level `function foo(){}` in a classic script creates a global binding shared
across all classic scripts on the page. Moving a whole function declaration from
file A to file B is behavior-neutral as long as both load before any runtime call
(always true — user interaction happens post-load). Top-level `const`/`let` are
NOT window properties but ARE in the shared global lexical scope across classic
scripts, usable at runtime by later-running code. Risk is only **load-time**
references to a not-yet-defined `const` — avoided by rule 1 (core first) + rule 3
(extracted files don't run cross-file code at load).

---

## STEP 0 — Build the static reference checker (do this FIRST)

The app is auth-gated, so features can't all be clicked through. This checker is
the mechanical safety net; it also becomes a permanent gate check.

Create `scripts/check-refs.sh` (or `tests/check-refs.js`) that:
1. Concatenates all `public/js/schedule-*.js` in the SAME order as the
   `<script>` tags in `public/schedule-app.html`.
2. `node --check` on the concatenation (catches parse errors, duplicate `const`
   redeclarations — e.g. a state block accidentally left in both files).
3. Parses every top-level `function NAME(` definition across the files and every
   `NAME(` call site; asserts every called name is defined somewhere, minus an
   allowlist of known globals/builtins (`SchedState, XLSX, document, window,
   console, Math, Object, Array, JSON, setTimeout, escHtml, fmtTime*, uid,
   navigateTo, saveToLocal, updateSidebarStatus, gradesSorted, GRADE_LABELS,
   ALL_GRADES, render* from setup/init, …` — build the allowlist from
   `schedule-setup.js` / `schedule-state.js` / `schedule-init.js` exports so
   cross-file-but-legit calls pass). This catches the #1 split error: "forgot to
   move a helper."
4. Exit non-zero on any undefined reference.

Then wire it into `scripts/predeploy.sh` as check 5/5.

Verify STEP 0: run it against the CURRENT (un-split) file — it must PASS (proves
no false positives before any split), then run the gate.

Commit STEP 0 on its own.

---

## Extraction sequence (biggest / most-independent first)

For EACH step, follow the per-step checklist below.

### 1. IA Schedule → `public/js/schedule-ia.js`  (~2,000 lines)
Currently scattered across FOUR sections — consolidating is a double win.
Section banners to move (verify line numbers, they'll drift):
- `// ── IA Schedule ──` (renderIAScheduleView, buildIAGrid, wiring, …)
- `// ── IA assignment edit / delete ──`
- `// ── IA assignment from master schedule ──`
- `// ── Individual IA week-view grid ──`
- `// ── Duty panel ──`
Move WITH it: `iaSchedUI, iaDrag, iaMasterState`, and `_cleanupStaleIAAssignments`
if it's IA-only (check: it's called from placement — if so it may stay in core;
decide by where it's called, not where it sits).
Watch: `_cleanupStaleIAAssignments` is called from `rebuildPlacement`/save paths
in core — keep it callable (either leave in core or ensure the IA file loads and
it's global). Global either way; just don't lose it.

### 2. Specials Schedule view → `public/js/schedule-specials-view.js`  (~700 lines)
- `// ── Specials coverage validation ──`
- `// ── Specials Schedule View ──`
- `// ── Specials individual override ──`
Move WITH it: `specialsSchedUI`.
Do NOT move the specials *scheduling algorithm* (`buildSpecialsSchedule`,
`findGradeFixedTime`, rotation, `getSpecialsAtSlot`, `buildSpecialsCell`) — those
are core placement/render and stay in `schedule-grid.js`.

### 3. Class Schedules view → `public/js/schedule-class-view.js`  (~175 lines)
- `// ── Class Schedules view helpers ──` + `renderClassSchedulesView`.
Move WITH it: `classSchedUI` (currently sits in `schedule-grid.js` right where
extraction 2 left it — search `^const classSchedUI`).
Do NOT move `printScheduleGrid` (right next to `renderClassSchedulesView` in
the file) — it's a shared print utility used by core, IA, and the specials
view too; confirmed during extraction 2 that it must stay in core.

### 4. Export → `public/js/schedule-export.js`  (~250 lines)
- `exportXLSX`, `exportJSON`, `_blendColumnRuns`, `renderExportPlaceholder`
  and their local helpers. Read-only over state — lowest risk.
- Confirmed post-extraction-1: these four functions currently sit physically
  right after the (now-moved) IA Schedule view functions in `schedule-grid.js`
  — search `^function renderExportPlaceholder` to find the start of this block.

After all four: `schedule-grid.js` should be ~2,900 lines of genuine core
(grid render + interaction + placement algorithm).

---

## Per-step checklist (repeat for each extraction)

1. Create `public/js/schedule-<feature>.js`. Move the whole sections (functions +
   feature-local state). Leave a one-line breadcrumb comment where each section
   used to be, e.g. `// <feature> view moved to schedule-<feature>.js`.
2. Add `<script src="js/schedule-<feature>.js?v=NNN"></script>` to
   `public/schedule-app.html` AFTER `schedule-grid.js` and BEFORE
   `schedule-init.js`. Bump the `?v=` on ALL script+css tags (gate enforces
   consistency).
3. `node -c` each changed JS file.
4. Run `bash scripts/check-refs.sh` (STEP 0) — must pass (no undefined refs, no
   duplicate `const`).
5. Run `bash scripts/predeploy.sh` — must pass.
6. Load the app in the browser preview; confirm the console is CLEAN on boot
   (a moved-but-mis-ordered `const` throws a load-time ReferenceError here).
7. Deploy via `bash scripts/deploy.sh`.
8. Commit: `refactor: extract <feature> from schedule-grid.js (behavior-neutral)`.
   One feature per commit.
9. Update this file's Status line for the completed step.

## Definition of done — ALL COMPLETE
- [x] All 4 features extracted; `schedule-grid.js` is 3,323 lines (the
      ~2,900 estimate was approximate — actual core turned out to include a
      bit more shared/interaction code than originally guessed; not a
      problem, just noting the estimate vs. actual).
- [x] `tests/check-refs.js` in the gate (`scripts/predeploy.sh` check 5/5)
      and green.
- [x] No behavior change; gate green at every step; app boots clean at every
      step.
- [ ] CLAUDE.md "Key JS files" list still needs updating with the 4 new
      files (`schedule-ia.js`, `schedule-specials-view.js`,
      `schedule-class-view.js`, `schedule-export.js`) — do this next.
