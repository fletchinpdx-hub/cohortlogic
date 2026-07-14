# Monolith split plan — `public/js/schedule-grid.js`

**Status:** not started. **Owner:** any model/session can resume from this file.
**Goal:** carve the ~6,180-line `schedule-grid.js` into cohesive feature files
WITHOUT changing behavior. Started at v145.

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
Move WITH it: `classSchedUI`.

### 4. Export → `public/js/schedule-export.js`  (~250 lines)
- `exportXLSX`, `exportJSON`, `_blendColumnRuns`, `renderExportPlaceholder`
  and their local helpers. Read-only over state — lowest risk.

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

## Definition of done
- All 4 features extracted; `schedule-grid.js` ~2,900 lines.
- `scripts/check-refs.sh` in the gate and green.
- No behavior change; gate green; app boots clean.
- CLAUDE.md "Key JS files" list updated with the new files.
