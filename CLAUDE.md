# Cohort Logic — CLAUDE.md

## What this is
A multi-product SaaS for school administrators. Built by Michael Fletcher (Cohort Logic).

**Live site:** cohortlogic.com  
**GitHub:** github.com/fletchinpdx-hub/cohortlogic  
**Supabase project:** dlqnzlwuzktcljxxxlit  
**Local dev:** http://localhost:3456 (run via `npx serve -l 3456 public`)  
**Hosting:** Cloudflare Workers (static assets via `wrangler.toml`, `directory = "public"` — only files inside `public/` are ever served; this is an allowlist, not the old `.` denylist model).  
**Deploy:** always `bash scripts/deploy.sh` from `/Users/michaelfletcher/dev/cohortlogic/` — never raw `npx wrangler deploy` (that skips the pre-deploy gate). GitHub push auto-deploy is **broken and unreliable** (since v54) — do not count on it. See the Deployment section for the full rule. Netlify site should be deleted.

**Repo location — `~/dev/cohortlogic`, never `~/Documents` or `~/Desktop`:** moved here 2026-07-16. Cause, not just symptom: this Mac has iCloud "Desktop & Documents" sync enabled, which makes both those folders live iCloud containers — the file-provider daemon holds them open and can duplicate files mid-write during heavy churn (`foo 2.ts`, and it has reached inside `.git` as `.git/index 2` on a sibling project, which is a real corruption risk, not just clutter). A repo with frequent build/deploy activity (like this one — multiple deploys/day, wrangler asset uploads) is more exposed than a static one. **If a `* 2.*` file ever shows up anywhere in this repo, don't just delete it and move on — first confirm the repo hasn't ended up back inside a synced folder** (`diff <(ls ~/Library/Mobile\ Documents/com~apple~CloudDocs/Documents) <(ls ~/Documents)` — identical output means sync is on).

## Compact Instructions
When compacting this conversation, preserve:
- All modified files and what changed in each
- Key architectural decisions and why they were made
- Any pending tasks or known issues
- Test commands that verify the work

---

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
- **Auth:** real Supabase email/password login + admin approval. `app.html` loads `js/auth-gate.js` in `<head>`, which requires a Supabase session and `profiles.approved` (no session → `login.html`; not approved → `dashboard.html`). `login.js` uses `signInWithPassword` — no OAuth. (The old hardcoded `democlass` demo code is GONE — removed from the repo; do not reference it.)
- **No backend for roster data** — all balancing runs in the browser and the student roster is never uploaded or stored server-side. Supabase is used only for auth + anonymous usage analytics (`sessions`/`events`), never student records.
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

### 3. Building Schedule Builder (`schedule-app.html`)
Master schedule builder for school administrators. All four phases (Setup → Build → Detail → Export) are built and live.

**Cache buster:** every script tag AND both CSS links in `public/schedule-app.html` carry a `?v=NNN` query. **Bump ALL of them, in lockstep, on every deploy** — the pre-deploy gate's version-consistency check fails if they drift. (Don't record the current number here; it goes stale immediately — read it off the file.) All app files live under `public/`; JS paths below are relative to `public/`.

**Data model — file-based, not Supabase:**
- Schedule data NEVER stored server-side. Users download a `.cohortlogic` JSON file to save; upload it to resume. (Legacy `.clsched` and `.cohort` files are still accepted on load and migrated — see `loadScheduleFromFile`.)
- `localStorage` is a session cache only (survives tab close, not device switch).
- Supabase used only for auth + product gating (`enabled_products` includes `schedule_builder`).
- `downloadScheduleFile()` / `loadScheduleFromFile(file)` in `schedule-state.js`.

**Nav flow (current):**
- Phase 1 — Setup: School Info → Staff Roster → Specials → Block Types → **IA Assignment** (locked until an IA exists)
- Phase 1 — Build: Master Schedule (locked until grades configured)
- Phase 2 — Detail: Specials Schedule (locked until specials configured) → IA Schedule → Class Schedules
- Finish: Import/Export
(All views are built — none are placeholders. An intro tour auto-runs on first visit; see `js/schedule-tour.js`.)

**Import/Export is the ONE place for file handling (v168).** The sidebar used to carry a download button + "Load a .cohortlogic file…" + "Import from Class Builder…" links; all three moved onto the Import/Export view and the sidebar footer is now just "← Back to dashboard".
- **One save format.** There were two parallel systems: `downloadScheduleFile()` → `.cohortlogic` (sidebar) and `exportJSON()`/`importJSON()` → a raw `SchedState` dump as `.json` (Export view). Two buttons, two incompatible shapes, same job — the direct cause of user "which file do I keep?" confusion. `.cohortlogic` won (it carries `_version`/`_product`/`_tools` + the Class Builder `classes` payload; the raw dump carried none). `exportJSON`/`importJSON` are **deleted**. Dropping the `.json` *download* is safe because *loading* still accepts `.json` — a raw dump has `masterSchedule` at top level and no `_product`, which `_migrateToCohortLogic()` treats as an old `.clsched`.
- **Hidden file inputs** (`#load-sched-file`, `#load-cohort-input`) stay page-level in `schedule-app.html`, wired ONCE in `schedule-init.js`, and are triggered from three places via `<label for="…">` (CSP-safe, no JS): the landing screen, the School Info load banner, and Import/Export. Don't move/rename them without updating those labels.
- **The "unsaved" nag moved with it.** It used to be the sidebar button's amber `.btn-download-unsaved` state; `updateDownloadBadge()` now toggles `.nav-item-unsaved` on `#nav-export`. This is load-bearing, not decoration — schedule data lives only in the browser until a file is downloaded, so losing the warning risks real data loss. The view also renders a plain-language `#ie-save-note` saying whether a file has ever been downloaded.
- **The view includes a non-technical explainer** ("Which file is which?") with an inline-SVG diagram: `.cohortlogic` round-trips (download ⇄ load), `.xlsx` is one-way (print/share, can't come back). Written for non-technical admins — the file types were stumping them.

**Key state — `SchedState` in `schedule-state.js`:**
- `school` — name, year, grades, time bounds (firstBell, dismissal, arrival=studentCampusStart, dismissal=studentCampusEnd, teacherContractStart/End…), lunchPeriods[], gradeRecesses{}, gradeBands[], blockPairings[], specials[], specialsRotationMode. NOTE: `morningMeetings[]` and legacy `morningMeeting*` fields are **defunct** (v124) — morning meetings are configured only as the `bt_mm` block (Block Types → school-wide time). Stale `morningMeetings` data is fully inert: it neither places blocks nor affects the minutes budget.
- `school.blockPairings[]` (v144) — `[{ id, blockId, subId|null, grades[] }]` — "Synchronized Blocks" from Block Types: force a block/sub-block to start at the SAME time across a set of grades, every day (independent of gradeBands; each grade keeps its own duration). Persisted via the whole-`school` save. Groundwork for specialist-run intervention windows aligned to these shared blocks (handled outside the master schedule later).
- `blockTypes[]` — DEFAULT_BLOCK_TYPES (6 blocks for new schedules): bt_spec (system), bt_mm, bt_lunch, bt_recess (fixed/auto-placed), bt_arr (Arrival Duty), bt_dis (Dismissal Duty). Schools add required instructional blocks via the Block Types tab. Required blocks have bandMinutes{} / subBandMinutes{}.
- `masterSchedule[day][grade][slot]` = blockTypeId — 5-minute slots Mon–Fri
- `conflicts[day][grade][slot]` = [btId, …] — blocks displaced by manual drag; never created by auto-fill
- `specialsSchedule[classId][day]` = `{ subjectId, teacherId, startTime }` — class-level specials (source of truth for Specials Schedule view)
- `iaSchedule[day][iaId][slot]` = `{ allocId, targetType, targetId, note }` — IA assignments. `targetType` is `'grade'` (coverage; `targetId` = grade), `'own_lunch'` (engine-reserved IA lunch; `allocId` optional), or `'break'` (engine-reserved break; no alloc). **Written by the placement engine `placeIAs()`, not by hand-assignment** — see the IA scheduling section below.
- `iaAllocations[]` = `[{ id, name, color, hoursPerDay }]` — budget **categories** (funding buckets) for IAs. Edited on the IA Assignment tab. (`hoursPerDay` is the field the engine + budget bar use; a legacy `hoursPerWeek` seed on the 4 defaults is inert.)
- `iaCoverage[]` = `[{ id, blockId, subId|null, grades[], iasPerGrade, allowedAllocIds[] }]` — the **coverage plan** (IA Assignment tab). Each row = "cover this block, for these grades, N IAs per grade, funded by these categories." Drives `placeIAs()`. Persisted in the `.cohortlogic` file parallel to `iaAllocations`.
- IA **staff** fields (`role === 'ia'`): `gradePreferences[]` (grades this IA prefers — soft), `ownLunch: { duration, windowStart, windowEnd, allocId } | null`, `breaks: { count, duration }` (default 1 × 15 min). Classroom teachers keep `gradeAssignment`/`splitGrade`; those are inert for IAs. Migration (`_normalizeIAStaff`) seeds `gradePreferences` from a legacy IA `gradeAssignment` and defaults `breaks`.
- `duties[]` = `[{ id, name, location, startTime, endTime, days[], iaIds[], allocId }]` — IA duty blocks (non-grade, e.g. "Morning Greeting"); **not** in `iaSchedule` and never wiped by re-placement.

**Key JS files** (load order in `schedule-app.html`; monolith split completed v146–v149, see `docs/monolith-split-plan.md` for full history — all extractions were behavior-neutral, verified by `tests/check-refs.js` + the pre-deploy gate + a clean browser boot at every step):
- `js/supabase-config.js` — shared Supabase client (SupabaseClient), loaded first
- `js/schedule-state.js` — SchedState, DEFAULT_BLOCK_TYPES, saveToLocal, loadFromLocal, downloadScheduleFile, loadScheduleFromFile, uid(), updateSidebarStatus()
- `js/schedule-setup.js` — School Info, Staff Roster, Specials, Block Types views + save flows; SP_DEFAULT_COLORS
- `js/schedule-grid.js` (~3,450 lines, was ~6,177 pre-split) — CORE: Master Schedule grid render/cells, drag-to-move, resize, context menu, undo, the consolidated warnings panel, conflict rendering/banners, the placement algorithm (specials scheduling incl. `buildSpecialsSchedule`/`findGradeFixedTime`, grade pairings/`placePairedBlocks`, `_populateGradeData`, `rebuildPlacement()`), and `printScheduleGrid` (a shared print utility used by IA/specials/class views — intentionally NOT extracted, stays here)
- `js/schedule-ia.js` (extraction 1) — everything IA: the **IA Assignment tab** (`renderIAAssignmentView` — budget categories + coverage plan + Place IAs), the **placement engine** (`placeIAs`), the **IA Schedule view** (All IAs + Individual IA), the assignment editors (`openIAAssignmentEditor` edit/reassign/partial/delete, `openIAAddAssignment` add on open cells), the placement-issues panel (`_iaPlacementIssuesHtml`), and duty blocks/panel. State: `iaSchedUI`, `iaDrag`. (The old master-grid "Assign IAs" mode + `iaMasterState` were removed in the IA rework.)
- `js/schedule-specials-view.js` (~570 lines, extraction 2) — Specials Schedule view (by-teacher grid), coverage validation/banner, the individual override panel. State: `specialsSchedUI`. (The specials *scheduling algorithm* stays in schedule-grid.js — this file is the view/UI layer only.)
- `js/schedule-class-view.js` (~390 lines, extraction 3) — Class Schedules view (single class + grade compare), incl. `getClassSlotEntry` + the off-carousel swap fill. State: `classSchedUI`
- `js/schedule-export.js` (extraction 4) — the **Import/Export view** (`renderImportExportView`, `_fileFlowDiagram`, `_renderSaveNote`) + XLSX export (`exportXLSX`, `_blendColumnRuns`). `exportJSON`/`importJSON` were deleted in v168 — see Import/Export above.
- `js/schedule-init.js` — boot (auth + product gate), landing screen, VIEW_RENDERERS, download/load wiring
- `js/schedule-tour.js` (~370 lines) — interactive intro tour (coach-marks), CSP-safe, auto-runs once on first visit, replayable from the sidebar. **Spotlight-only** (unlike the Class Builder tour in `js/tour.js`): it highlights the sidebar nav down the four phases rather than driving the grid.
- `js/feedback.js` — shared Send Feedback widget (see Shared components), loaded last

(Line counts are approximate and drift — treat them as "which file is big," not a spec.)

**Key behaviors:**
- `preFillFixedBlocks()` — auto-places lunch (from `lunchPeriods`) + recess (from `computeRecessTimes`) + morning meeting (only from the `bt_mm` block's uniformStart/End). Clears all fixed-block slots first, then re-places. Calls `ensureFixedBlockTypes()` at the top (v126) so bt_mm/bt_lunch/bt_recess type defs always exist — without them `buildCell()` renders those slots as **empty cells** and the palette's Transition group vanishes. `ensureFixedBlockTypes()` used to run only on load; running it here self-heals every build.
- `autoPopulateGrade(grade)` — fills required instructional blocks per grade band requirements; grade-header click uses `clearFirst=true`
- `autoPopulateIfEmpty()` — runs on master schedule entry. Fill-gaps-only (`clearFirst=false`, v130): fully-placed blocks — including manual moves — stay put, so user edits survive leaving/re-entering the view. (v118 briefly used clearFirst=true to recover from v115 corruption, but that steamrolled manual edits every render.) Clearing + optimal re-place is reserved for the explicit grade-header auto-fill click. v135: the fill-gaps pass leaves ANY block that already has ≥1 slot exactly as-is (previously it cleared+re-placed partially-placed blocks, which on a tight day fell through to the split fallback and cut a block into two pieces after a manual move). Only completely-missing blocks are placed fresh; the unplaced banner flags anything left short.
- `_autoFillSlots(day)` — the instructional placement/display window. Starts at **firstBell** (v122), matching `computeMinutesBudget` — NOT the earliest of firstBell/arrival/dayStart (arrival is duty time, not instruction). `_populateGradeData`/`showUnplacedBlocksBanner` all key off this.
- `ensureFixedBlockTypes()` (schedule-state.js) — pushes missing bt_mm/bt_lunch/bt_recess defs into `blockTypes`. Idempotent. Called on load AND in `preFillFixedBlocks()`.
- `buildSpecialsSchedule(force=false)` — computes class-level rotation, finds grade-wide time slots, writes bt_spec|spId to masterSchedule and specialsSchedule. Unforced calls SKIP the rebuild while every class already has a specialsSchedule entry (v130) — a full rebuild wipes manual specials moves on the master grid. Rebuild triggers: specialsSchedule empty (Specials-tab save clears it), a new class appears, or force=true. v137: places grades **hardest-first** (`placementOrder` = most classes first — the tightest teacher-demand grade claims its carousel slot before easier grades consume availability), and runs in **two phases** — every grade's carousel (Phase 1) before any grade's straggler recovery (`recoveryQueue`, Phase 2) — so recovery's off-carousel scatter can't steal a clean shared-time slot a later grade's carousel still needs. `gradeIdx` still uses stable grade order so rotation offsets don't shift. v138: prefer ONE **fixed time across all 5 days** per grade (`findGradeFixedTime`, previously defined-but-unused) so a grade's specials land at the SAME clock-time every day (`fixedToPerDay`); only fall back to per-day `findGradeSpecialsTime` when no single weekly time is clear+staffable. v139 (the load-bearing one): on rebuild, `buildSpecialsSchedule` now CLEARS every grade's instruction (`_clearRequirementsForGrade`) BEFORE placing specials — specials get first pick, so `findGradeFixedTime` sees a clean day and can actually lock a consistent time (before, instruction filled the day first and forced the scattered per-day fallback). Callers re-flow instruction around the placed specials (`_populateGradeData` for all grades). `saveSpecialsAndContinue` now runs this full data-only pass immediately (buildSpecialsSchedule(true) → preFillFixedBlocks → _populateGradeData all grades) so the fresh schedule exists regardless of which view opens next. Trade-off: a Specials-tab save re-flows instruction (a deliberate "full new pass" — manual instruction moves are re-laid). NOTE: the Specials Schedule view is BY TEACHER, so one specials teacher spanning multiple grades still looks spread out (each grade at its own fixed time) — grade-level consistency is visible in Class Schedules → Compare Grade / the master grid, not the per-teacher view.
- `placePairedBlocks()` (v144, non-overlap rule v150) — places `school.blockPairings` (Synchronized Blocks). Runs AFTER `buildSpecialsSchedule` + `preFillFixedBlocks`, BEFORE `_populateGradeData` in every placement path (autoPopulateIfEmpty / fillMissingRequirements / switchDay / autoPopulateGrade). Per pairing: `_pairingActiveInfo` → active grades (in a band, >0 min for the unit) with each grade's own slot count; `_findPairingTimes(unitId, info, avoidByDay)` → prefer ONE fixed start across all days that fits every grade avoiding fixed+specials (empty/instruction slots OK because specials-rebuild cleared instruction first), per-day fallback; `_placePairingUnit` writes the block (dropping any scattered copies). **Idempotent**: `_pairingCurrentTimes` returns the shared start times when aligned (all active grades have the unit at the same start, ≥ their slots, every day) else null; an aligned, non-colliding pairing is kept as-is, so it survives re-renders and preserves manual placement.
  - **Same-unit non-overlap (v150):** two pairings for the SAME unit (`blockId|subId`, e.g. WIN for {2,3} and WIN for {4,5}) must land in **fully non-overlapping** time windows — a shared intervention specialist can't cover both at once. `placePairedBlocks` processes pairings in deterministic order (lowest grade first within a unit, then config order), tracks each unit's claimed windows `{unitId:{day:[{s,e}]}}` (window = `[start, start + maxSlots*5)`, using the pairing's longest grade block), and `_findPairingTimes` rejects any candidate overlapping an earlier same-unit window. Different units may overlap freely (WIN {2,3} and Math {4,5} at the same time is fine). A pre-existing same-time collision (older schedule) is detected and the later group is re-staggered. `showPairingWarning()` flags BOTH unaligned pairings AND any residual same-unit overlap in the consolidated panel (warn-but-build).
  - `autoPopulateGrade` clears the grade first (`_clearRequirementsForGrade`) then re-syncs so a grade-header re-fill doesn't break the pairing. Priority is by design **after specials** (specials keep first pick; instruction flows around both). Known edge: a single grade-header re-fill on a too-full day can leave a pairing unsatisfiable → flagged by the warning; re-saving Block Types does a clean full rebuild.
- Off-carousel specials are PER-CLASS, not grade-wide (v154). When a class's special can't fit the grade's shared carousel time (teacher capacity), the recovery/fallback passes record it in `specialsSchedule[cls][day]` ONLY — they no longer write a grade-wide `bt_spec` to `masterSchedule` (previously they did, which made the OTHER classes show grey placeholders at that time). `_populateGradeData` then fills that slot with the grade's instruction for the other classes. Rendering recombines the two:
  - **Class Schedules** (`getClassSlotEntry`): checks the class's OWN special FIRST (before the grade block), so the off-carousel class shows its real special and every other class shows its real instruction — no grey hole.
  - **Swap fill** (v155, `_classHoleFillMap`): the off-carousel class still has a hole at the *carousel* time (its peers are on specials, it isn't, and the grade reserved that slot). It's filled with the grade instruction that runs DURING the class's own off-carousel special — mapped offset-for-offset from the special window onto the hole window. This both fills the grey box AND recovers instruction minutes the special overlapped (e.g. a split Content block that only partially fit in the afternoon gets its remainder at the hole). View-layer only (`_instructionEntry` marks it `isSwapFill`); grade master data untouched. Falls back to the muted `isSpecialsHole` placeholder only when no aligned swap exists (mismatched durations / multiple off-carousel specials that don't pair). Assumes carousel and off-carousel specials are the same length (true when all specials share a duration).
  - **Master grid** (`buildCell` → `getSpecialsAtSlot` → `buildSpecialsCell`, **Option 3, v158**): `buildCell` calls `getSpecialsAtSlot` for EVERY cell (null when no class is on a special) and routes three ways — (1) **carousel** (whole grade at specials, or grade block = `bt_spec`) → one unified "Specials" block; (2) **special-only** (some classes pulled AND the grade has no competing instruction at this slot) → a small labeled specials block (`buildSpecialsCell` labels the contiguous special-only RUN — `isSpecOnly`/`runStart`/`runEnd` — so a special that overlaps instruction for part of its length and is bare for the rest anchors its label at the first bare slot, e.g. "Art · 12:50–1:10 · 1 class out"); (3) **off-carousel WITH competing instruction** → the INSTRUCTION stays the primary full-width block (so the master grid reads as the *grade's* schedule) and gets a small "N classes → Special" pull-out tag (`_buildPulloutTag`, `.cell-pullout-tag`), appended at the special's start OR at an instruction block that begins mid-special. **This replaced the earlier two-column split** (v154–v157), which rendered an unlabeled "void" wherever the special outlasted the competing instruction and kept looking "funky"; Option 3 never carves the cell in half. When the special sits entirely inside one instruction block (common — specials and instruction are often the same length) the cell is just the instruction block + the tag, no separate specials block. The pulled class's real activity is still shown per-class in Class Schedules.
- Drag-to-move on a conflict split cell (v130): left half picks up the primary block, right half picks up the displaced conflict block (`drag.moveFromConflict` — commitMove removes it from `conflicts[]`, leaving the primary in place).
- Fixed-block drag protection (v134): `placeBlock` never overwrites/splits a fixed block (lunch/recess/MM); `commitMove` rejects a normal drop that would land on one (snap back, no split cells). Hard-time fixed blocks (lunch, MM, lunch-anchored recess) can't be picked up. A FREE-FLOATING recess CAN be dragged — the drop sets `gradeRecesses[grade][i].manualStart`, which `computeRecessTimes` Pass 2 honors so the move sticks (`_recessBlockInfo` maps the block→config; `_commitRecessMove` applies it). `_purgeFixedBlockConflicts` (run in autoPopulateIfEmpty) cleans stale fixed-block conflict data from before this protection existed.
- `computeClassSpecialsRotation(classes, specials, gradeOffset)` — rotation modes: `'intermittent'` (cycle all before repeating), `'sequential'` (complete one subject before starting next), `'none'` (no preference — place each special on first available day for max scheduler freedom)
- `getSpecialsCoverageReport()` — detects classes with missing specials (day-level gaps not caught by grade-level failure); called from master schedule and Specials Schedule view
- `getBtColor(btId)` / `getBtName(btId)` — resolve color/name for any block ID including compound `bt_spec|sp_id`
- `computeMinutesBudget()` — shared fn in schedule-setup.js; returns per-band `{ required, available, fixed, dayTotal, mmMins, lunchMins, recessMins }` used by budget panel and validation banners. `mmMins` counts ONLY the `bt_mm` block (v124) — not legacy `morningMeetings`. `dayTotal` uses firstBell→dismissal, aligned with `_autoFillSlots`.
- Required blocks support 2-way **split placement** (`_findSplitPlacements`) when a single contiguous gap won't fit. Split settings (`splitAllowed`, `splitMinMinutes`) are edited in a sibling `<tr id="req-split-row-{btId}">`; `collectReqFromDOM()` reads them via `document.getElementById` (NOT `row.querySelector`, since the inputs aren't inside `.req-row`) — v119 fix.
- `computeRecessTimes(s)` — returns recessMap[grade]; enforces 60-min minimum spacing between recesses per grade
- `collectUniformFromDOM()` — reads all uniform block time/duration inputs at save time; called by `saveBlocksAndContinue()` (no more per-row Apply button)
- **Consolidated warnings panel** (v123): all 9 Master Schedule warnings (`showUnplacedBlocksBanner`, `showRecessSpacingWarning`, `showOverBudgetWarning`, `showMissingRequirementsWarning`, `showLunchOutOfHoursWarning`, `showSpecialsConflictWarning`, `showSpecialsMissingWarning`, `showConflictBanner`, `showSpecialsCoverageBanner`) build their `.setup-banner` element as before, then call `_mountWarning(banner)` to route into ONE collapsible "N issues to review" panel above the grid. `_warningsHost()` lazily builds it; a MutationObserver refreshes count/visibility when a warning clears itself; `_refreshWarningsPanel()` hides the panel when empty. Collapse state in `gridUI.warningsCollapsed`. The transient `specials-move-warning` (drag feedback) is intentionally NOT routed here.
- `renderGradeSummaryRow()` — now a **no-op** (v125): the per-grade summary chip row below the grid was removed (its `#grade-summary-wrap` element is gone, and the fn early-returns when absent). Per-grade missing-block info lives in the consolidated warnings panel instead.
- Specials Schedule coverage panel is collapsible (v127): header toggles the detail table; state in `specialsSchedUI.coverageCollapsed`.
- Drag-to-move: pointerdown on filled cell with no paint tool → picks up block; commitMove() restores displaced conflict blocks instead of deleting them
- Conflict split cells: `placeBlock()` stores displaced block in `conflicts[]`; `buildCell()` renders side-by-side halves; isConflictStart logic shows labels even mid-block
- Conflict banner groups consecutive same-conflict slots into one time-range entry (not one per 5-min slot)
- Specials Schedule view: per-teacher weekly grid (Mon–Fri × time rows), teacher chip picker, coverage summary panel at top
- Specials override panel: clicking a filled cell in the Specials Schedule teacher grid opens an anchored panel to change day, start time, or teacher for that class's specials assignment (`applySpecialsOverride`)
- **IA scheduling model (rework — see `docs/ia-rework-plan.md`).** IAs are placed **automatically**, not hand-assigned. Config lives on the **IA Assignment tab** (budget categories + coverage plan, both auto-save); **Place IAs** runs `placeIAs()` (wipes `iaSchedule` — but not duties — behind a confirm, then rebuilds). Results show on the **IA Schedule tab**, where you adjust them.
  - **`placeIAs()`** — pure, deterministic. Organized around **weekly recurring requirements** (one per coverage-row × grade with ≥1 occurrence) for cross-day consistency (same IA reused across days; per-day fallback flagged as an inconsistency). **Priority order:** (1) IA **own lunches** then (2) **breaks** are reserved FIRST (so IAs always get them), demand-aware so they dodge busy times; then (3) all coverage is filled in the **coverage-plan ROW ORDER** — the user orders the list (↑↓ arrows on each row), and `reqs` sort by `rowIndex` first, then hardest-to-staff grade within a row. **No block type is special-cased** (the old "kids' lunches first" hardcode is gone — put that row at the top of the list to prioritize it). **Hard** constraints: within the IA's hours, no double-booking. **Soft** (in order): grade preference (leads, even for duty), duty parity for **lunch + recess by minutes per type across the week**, then load balance. Budget is a **soft** per-day cap (`hoursPerDay`) — warns, never blocks. Preference/parity/budget only decide *who* fills a slot, never *whether* — a gap is recorded only when no eligible IA is free.
  - **Own lunch / breaks are spread, not first-fit.** `reservePersonalTime` scores each candidate run by `busy×1000 + demand` (busy = IAs already on personal time at that slot → forces a spread across IAs; demand = per-slot coverage need → biases toward low-demand times), preferring the same clock time every day. This fixed a real bug where first-fit clustered every IA's lunch at the window start and stripped coverage. Breaks: default 1 × 15 min (per-IA `breaks`), **never in the first or last hour** of the shift; multiple breaks split the mid-day into segments.
  - `placeIAs()` returns a report (`SchedState._iaPlacementReport`, session-only): `shortfalls`, `inconsistencies`, `overBudget`, `ownLunchUnplaced`, `breaksUnplaced`. `_iaPlacementIssuesHtml()` renders it as a collapsible details panel at the top of the IA Schedule tab.
  - **IA Schedule view:** "All IAs" (`buildIAGrid`, one day) + Individual (`buildIndividualIAGrid`, week). own_lunch/break render as "Own lunch"/"Break" (via `_iaTargetLabel`). Click a **filled** cell → `openIAAssignmentEditor` (reassign IA, shorten to a partial block, change category/note, delete — with a no-double-booking guard). Click an **open** cell → `openIAAddAssignment` (pick a grade running a block at that time, the range, and the category). `_iaAssignmentRun` groups a contiguous same-alloc/target run.
  - **Engine tests:** `tests/ia-engine.test.js` (core placement), `tests/ia-breaks.test.js` (personal time + breaks), `tests/ia-spread.test.js` (lunch/break spread + coverage), `tests/ia-priority.test.js` (coverage-list row order drives fill priority). Not in the pre-deploy gate; run with `node tests/ia-*.test.js`.
- Duty blocks (`SchedState.duties`): assigned to 1+ IAs and 1+ days with start/end time + budget category; managed via `openDutyPanel`; persisted to localStorage and `.cohortlogic` file; appear in both IA view tabs
- `_dutySlotsFor(duty)` — returns array of 5-min slot strings between duty startTime and endTime
- `getIAsForBlock(day, grade, slot)` — returns IA assignments for a master schedule block; dots render bottom-right of each filled cell (`.ia-block-ind`, `position: absolute; bottom: 4px; right: 5px`). Dot color = allocation category color, NOT staff member's `.color`
- Block resize: drag bottom edge of any non-fixed, non-locked block to extend or shrink; blue outline preview; `commitResize()` handles extend (placeBlock) and shrink (restores displaced conflicts)
- Context menu: right-click any filled non-specials cell → replace with another block type, clear, or lock/unlock grade
- Palette tool model (v136): `gridUI.tool` is `'move' | 'erase' | btId`; `gridUI.activeBtId` mirrors it (null for move/erase). Move is a distinct, always-visible, default-active palette item — separate from Eraser. Previously "no color selected" was overloaded for both, so Eraser silently hijacked filled-cell clicks into drag-to-move and a plain click did nothing. `onPointerDown`'s move-mode branch now gates on `gridUI.tool === 'move'` specifically. `selectGridTool(tool)` is the one place that sets both fields; Esc calls it with `'move'` (wired in the same keydown listener as Cmd/Ctrl+Z, master-schedule-only).
- Palette exclusions (v141/v142): `buildPaletteGroups` filters out `PALETTE_EXCLUDE` = `bt_lunch, bt_recess, bt_mm, bt_arr` — auto-placed/config-driven blocks that aren't painted on the grid. Removing the last block in a category also drops that empty category header. (`bt_dis`/Dismissal Duty is still shown — remove similarly if requested.)
- Master Schedule specials color (v140): `buildSpecialsCell` renders ALL specials in the uniform `bt_spec` color (`fallback`), not per-subject — the subject name stays in the label. Per-subject colors are kept in the Specials Schedule and Class Schedule views (separate renderers: `getClassSlotEntry`, the specials-teacher grid).
- XLSX export blending (v143): `_blendColumnRuns(rows, cols, firstRow, lastRow)` merges each column's contiguous same-value runs into one vertical cell (label in the top row, continuations blanked) and returns `!merges` ranges, so a 60-min block is one merged cell instead of 12 repeated rows. Applied to the per-day master tabs and the Class Schedules tab (IA/Specials tabs already collapse to ranges). NOTE: the app ships the FREE SheetJS build (`xlsx.full.min.js`), which writes structure/merges but NOT cell styles — no colors/centering/borders on export without switching to the paid styled build.
- IA re-assign pre-fill: opening the IA block panel pre-selects existing IA assignments, alloc, and note for that block
- IA stale-assignment cleanup (v117): `_cleanupStaleIAAssignments()` removes `iaSchedule` entries whose master-schedule slot no longer has a block (master schedule wins over IA schedule — no locking). Called from `saveMaster`/`saveMasterAndNext`/`autoPopulateIfEmpty`/`fillMissingRequirements`. Accumulates a count in `SchedState.iaStalePurgeCount` (persisted); `renderIAScheduleView()` shows a dismissible banner and clears the count.
- Staff `.color`: only used/shown for IAs (dot on schedule). Teachers and specials teachers have no color swatch in roster table, no color border on review chips, and no color picker in the staff form (picker hidden unless role = IA)
- Staff form UX: `showAddStaffForm()` calls `scrollIntoView({behavior:'smooth'})` + focuses name field after render; default hours pre-fill from `teacherContractStart/End`; specials teachers show hours fields (only grade/split fields hide)
- Primary grade tooltip: `?` badge with hover-reveal CSS tooltip explains split-grade scheduling impact; contextual hint appears below split-grade dropdown when a second grade is selected
- "Update Requirements Table" button: after re-render, scrolls table into view + pulses with blue flash animation + button turns green "✓ Table Updated" for 2 seconds
- School Day Hours: three separate inputs — Arrival (`studentCampusStart`), First Bell (`firstBell`), Dismissal (`dismissal`). Instructional budget uses firstBell; IA budget uses arrival. `studentCampusEnd = dismissal` for backward-compat.

**CSP constraint:** `script-src 'self' cdn.jsdelivr.net cdn.sheetjs.com` — no `unsafe-inline`. All event handlers via `addEventListener`. Never use `onclick=`/`onchange=`/`oninput=` HTML attributes.

**Specials data flow:**
1. Specials tab (Setup): define specials (name, duration, sessions/wk, color) + assign teachers
2. Block Types tab: shows derived specials list with per-special color pickers (no editable `bt_spec` row)
3. Master Schedule: `buildSpecialsSchedule()` auto-places `bt_spec|sp_id` blocks; per-special colors used throughout
4. Specials Schedule (Phase 2): reads `specialsSchedule` + masterSchedule; shows teacher's weekly grid + coverage report

**SP_DEFAULT_COLORS:** defined at top of `schedule-setup.js`, globally accessible to `schedule-grid.js` (loads after).

**Schedule file format:** saves download as **`.cohortlogic`** (v3 JSON; `school.specials[]` persisted with `color`). `loadScheduleFromFile` also accepts legacy **`.clsched`** and **`.cohort`** files and migrates them to the unified shape.

---

### 4. Referral Tracking (`referral-app.html`)
Tier 1 behavior / office-discipline referral tracker, modeled on PBISApps/SWIS. Supabase-backed, multi-school. Product key `referrals` (gated via `enabled_products` + `can_access_product('referrals')`, same as CICO).
- Views: New Referral, Referrals (list), Review (reviewers only), Students, Settings, Reports
- **Shared roster**: uses the `students` table (renamed from `cico_students`), shared with CICO; added demographic cols `race_ethnicity, gender, iep`
- Config: `referral_locations/behaviors/motivations/actions/others_involved` (school-scoped, full settings UI, default PBIS lists seeded client-side on first load); records in `referral_referrals`
- Reports (Chart.js): By Location / Behavior / Time of Day / Grade, Drill Down (filter + group-by), Equity (Risk Index / Risk Ratio / Interpretations by race/gender/grade/IEP)
- JS: `js/referral-{state,students,config,entry,list,reports,review}.js`; styles reuse `css/checkin.css` (cico-* classes) + `css/referral.css`
- Compat shim: a `cico_students` view (security_invoker) over `students` exists so pre-rename code keeps working; safe to drop now that the new code is deployed
- **Phase 4 (migration `referral_phase4.sql`)** — reviewer workflow + custom fields:
  - Reviewer workflow: `referral_referrals.status` (`open|pending_review|reviewed`) + `reviewed_by/reviewed_at/reviewer_notes`. "Send to reviewer" checkbox on entry → `pending_review`. Review queue + per-school default reviewer (`referral_settings.default_reviewer_id`). Review nav + reviewer settings gated client-side to `school_admin`/`super_admin` (RefState.isReviewer); RLS is the real backstop. List has a Status column.
  - Custom fields: `referral_custom_fields` + `referral_custom_field_options` (school-scoped); selections stored as jsonb `referral_referrals.custom_values` (`{field_id: option_id}`). Managed in Settings (reviewers); rendered as dropdowns on entry.
  - Custom fields ARE supported in Drill Down (one multi-select filter each + a `custom:<fieldId>` group-by dimension; reads `custom_values`). Not yet in the fixed per-dimension reports or Equity.
  - Staff still free-text (no staff roster yet)

---

## Shared components

### Send Feedback (`public/js/feedback.js`) — standard on every product
One self-contained, CSP-safe widget used across all products. Drop-in: add ONE
line after `supabase-config.js`:
```html
<script src="js/feedback.js?v=NN" data-product="Schedule Builder" data-key="schedule_builder"></script>
```
- **Self-injecting:** creates its own floating "💬 Send Feedback" button (fixed
  bottom-right), modal, and `<style>` (namespaced `cf-fb-*`) — no per-product
  HTML/CSS. Guards against double-include (`window.__cohortFeedbackLoaded`).
- **CSP-safe:** every handler is `addEventListener` (NO inline `onclick`).
  **Why it exists:** the old per-product feedback (Class Builder `openFeedbackModal`,
  CICO `openCicoFeedbackModal`) used inline `onclick=` in the HTML, which the site
  CSP (`script-src 'self'`, no `unsafe-inline`) **silently blocks** — those buttons
  were broken in prod. `check-csp.sh` only scans JS, not static HTML `onclick`, so
  it never caught them. The shared widget replaced both.
- **Config:** `data-product` = human label in the modal; `data-key` = value in the
  `feedback.product` column (`class_builder`, `cico`, `schedule_builder`,
  `referrals`, `dashboard`). Keep `data-key` stable — it buckets feedback per product.
- **`SupabaseClient` gotcha:** it's a top-level `const` from supabase-config.js — a
  global lexical binding, NOT a window property — so the widget guards with
  `typeof SupabaseClient === 'undefined'`, never `!window.SupabaseClient` (which is
  always undefined and would break every submit).
- **Optional enrichment hook:** a product may define
  `window.getFeedbackContext()` → `{ name, email, fields }` to pre-fill name/email
  and merge extra columns into the insert. CICO uses this (checkin-state.js) to
  keep the `user_id` + `school_name` capture the old modal had.
- Inserts `{ product, name, email, message, ...fields }` into Supabase `feedback`.
- Dead CSS for the old buttons/modals (`#feedback-btn`, `.feedback-overlay` in
  styles.css/checkin.css) is now unused — harmless, pending cleanup.

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
| `profiles` | `id, full_name, school_name, school_id, approved, role, product_overrides, is_admin (legacy), created_at` |
| `schools` | `id, name, district, state, enabled_products, created_at` |
| `audit_log` | FERPA audit trail: `id, user_id, action, table_name, record_id, old_data, new_data, created_at` |
| `students` | Students per school — **shared roster** for CICO + Referrals (renamed from `cico_students`; a `cico_students` compat view still exists but nothing in the client uses it) |
| `cico_checkins` | Daily check-in records |
| `cico_period_scores` | Per-period scores (child of checkins, FK: `checkin_id`) |
| `cico_incidents` | Incident records (child of checkins, FK: `checkin_id`) |
| `cico_settings` | Period count per school |
| `cico_categories` | Scoring categories per school |
| `cico_incident_types` | Incident type definitions per school |
| `sessions` | Class Builder demo sessions (anon + authenticated INSERT, authenticated SELECT) |
| `events` | Class Builder demo events (anon + authenticated INSERT, authenticated SELECT) |
| `features` | Feature flags: `key, enabled, updated_at` — read-only via RLS (SELECT only, no writes from client) |
| `feedback` | Send Feedback submissions: `product, name, email, message, archived_at, …`. **anon INSERT allowed** (that's the public widget); SELECT/archive restricted to super_admin. Surfaced in admin → Feedback. |
| `subscriptions` | Billing / plan state per school — admin → Billing |
| `security_findings` / `security_runs` | Automated daily security audit (deploy exposure / RLS / MFA / FERPA) — admin → Security |
| `contact_submissions` | Marketing contact-form submissions |
| `newsletter_subscribers` | Marketing newsletter signups (resources page) |
| `error_logs` | Client error capture |
| `referral_referrals` | Referral records (see Referral Tracking) |
| `referral_settings` | Per-school referral config incl. `default_reviewer_id` |
| `referral_custom_fields` / `referral_custom_field_options` | School-scoped custom fields for referrals |
| `referral_locations/behaviors/motivations/actions/others_involved` | Referral dropdown config (school-scoped) |

### Roles & tool access
- `profiles.role` enum: `'user' | 'school_admin' | 'super_admin'` — **source of truth** for access level. The legacy `profiles.is_admin` boolean is vestigial (kept so the signup trigger doesn't break); `is_admin()` now reads `role`.
- `schools.enabled_products text[]` — **hard master switch** per school (e.g. `{cico}`). If a product is off here, NO ONE at the school gets it, regardless of per-user override.
- `profiles.product_overrides jsonb` — per-user override, e.g. `{"cico": false}`. When the school has the product ON, a `false` override **blocks** that individual; an absent/`true` override = allowed. A per-user override can only subtract, never grant above the school setting.
- **Effective access** = `approved AND product ∈ school.enabled_products AND NOT (override = false)`. See `can_access_product()`.
- **Class Builder is never gated** (no backend). Only CICO + future backend products are.

### RLS helper functions (all SECURITY DEFINER)
- `public.is_admin()` — now means **super admin** (`role = 'super_admin'`). Name kept so existing policies keep working.
- `public.is_super_admin()` / `public.is_school_admin()` / `public.my_role()` — role checks.
- `public.my_school_id()` — returns `profiles.school_id` for current user.
- `public.can_access_product(p text)` — approved AND (per-user override else school default). Used in CICO RLS and by the CICO app at startup.

### School-admin mutation RPCs (SECURITY DEFINER; the only write path for school admins)
School admins have **no direct write on `profiles`** — they call these, which validate caller is super_admin OR (school_admin of the target's school) AND target is a plain `user`:
- `approve_school_user(target)`, `set_school_user_active(target, active)`, `remove_school_user(target)`
- `set_user_product_override(target, product, access)` — access = `'allow' | 'deny' | 'inherit'`
- `set_school_products(products text[])` — sets caller's own school's `enabled_products`

### Migrations (all run)
1. `supabase/migrations/ferpa_compliance.sql` — audit log, schools table, school_id columns, transition-safe RLS
2. `supabase/migrations/school_isolation_complete.sql` — strict RLS isolation, backfilled null school_ids
3. `supabase/migrations/school_admin_roles.sql` — role enum, tool-access columns, helper fns, school-admin RPCs, CICO RLS gated on approval + product access
4. `supabase/migrations/school_tool_master_switch.sql` — `can_access_product()` redefined so `schools.enabled_products` is a hard master switch (override can only block); audit trigger on `schools`

### SQL changes run directly (not migration files)
- **Profiles RLS** — tightened: users can only read their own profile; admins can read all; only admins can delete
- **Auto-create profile trigger** — `handle_new_user()` trigger on `auth.users` INSERT auto-creates a `profiles` row from signup metadata (required because email confirmation means no active session at signup time)
- **Class Builder tracking policies** — `sessions` + `events` INSERT policies updated to allow both `anon` and `authenticated` roles (not just anon)

---

## Admin panel (`admin/index.html` + `admin/admin.js`)

### Security
- Auth handler verifies `profiles.role = 'super_admin'` (source of truth, not the legacy is_admin column) before showing any UI — non-admins are signed out immediately
- MFA gate (`AdminMFA.gate`) runs after the role check: a TOTP challenge is required when a factor is enrolled (aal2); otherwise an enroll reminder shows
- 15-minute inactivity timeout (same as CICO)
- RLS is a second backstop at the data layer

### Sections (tabs — `data-view` on the topbar buttons)
- **Overview** — at-a-glance stats
- **Approvals** — approve new users, assign to a school; returning deactivated users show "Previously active" badge + "Reactivate" button
- **Schools & Users** — Add/edit (inline)/delete schools (deletion blocked if users are assigned); approved users with school reassign, Role column (`setUserRole` — promote/revoke `school_admin`; super_admin only via SQL), Deactivate
- **Billing** — subscription / plan state per school (`subscriptions`)
- **Analytics** — Class Builder (sessions, funnel, feature usage, recent sessions) + CICO (enrolled students, check-ins 30d/today, active schools, per-school table with Wipe Data)
- **Logs** — FERPA audit trail, filter by table/action/date, paginated, detail modal
- **Security** — results of the automated daily security audit (`security_runs` / `security_findings`)
- **Feedback** — user submissions from the shared Send Feedback widget. Unread submissions light up a badge (`#feedback-badge`) on the tab so new feedback is obvious; each card can be **archived** when handled

### Key functions in admin.js
- `verifyAndLoad(session, event)` — async; called fire-and-forget from onAuthStateChange; reads `profiles.role` (**source of truth**, NOT the legacy `is_admin` column) and signs out anyone who isn't `super_admin`, then calls showDashboard + loadDashboard
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
- **Approvals** has `assignPendingSchool` — "Route to school admin": sets `school_id` WITHOUT approving, so the user lands in their school admin's queue

---

## School-admin panel (`school-admin/index.html` + `school-admin.js`)

A per-school admin (designated by the super admin) manages **only their own school**. Auth gate verifies `role IN ('school_admin','super_admin')` and scopes everything to `my_school_id()`.

### Sections
- **Pending Approvals** — approve/decline signups routed to this school
- **Tool Settings** — toggle CICO on/off for the whole school (`set_school_products`)
- **Staff** — per-person CICO access (School default / Allowed / Denied via `set_user_product_override`), Deactivate (`set_school_user_active`), Remove (`remove_school_user`)

### Navigation (entry/exit)
- **Entry:** from the product dashboard, school admins see a **"Manage your school →"** link into `/school-admin/`; super admins see **"Open admin panel →"** into `/admin/`. The link is one role-aware element (`#admin-link`) in the dashboard header, shown/targeted by `role` in `js/dashboard.js` (which now selects `role`). Hidden for plain `user`. Convenience only — both panels still re-verify role server-side + RLS.
- **Exit:** a **"← Products"** link in the panel topbar returns to `dashboard.html`. Plain `<a>` nav; the Supabase session carries over both directions, so no re-authentication.

### Security
- **Zero direct write access to `profiles`** — every mutation goes through the SECURITY DEFINER RPCs above, which enforce same-school + target-is-plain-user. A school admin can't escalate roles, reach another school, or modify an admin account even via crafted API calls.
- **Privilege-escalation backstop** — `guard_profile_privileged_columns()` BEFORE UPDATE trigger forbids changing `role`/`approved`/`school_id`/`product_overrides`/`is_admin` unless the caller is a super admin or the write comes through a trusted RPC (transaction-local flag `app.allow_privileged_profile_update`). Defends even if an RLS UPDATE policy is permissive.
- **No user data in inline `onclick`** — handlers pass only UUIDs; names are looked up from a render-time `_nameById`/`_userNameById` map and rendered in escaped text context. (`esc()`/`escAdmin()` don't escape `'`, and HTML entity-encoding doesn't survive into inline-handler JS, so user-controlled strings must never be interpolated into `onclick`.)
- Read access via the additive `"School admins can view their school's profiles"` SELECT policy.
- 15-minute inactivity timeout (same as the other panels).

### User lifecycle (decoupled approval)
1. User self-signs-up → `approved=false`, `school_id=null`.
2. **Super admin** assigns a school (Route to school admin) — routes but does NOT approve.
3. **School admin** approves → `approved=true`. They manage tool access + deactivation thereafter.

### CICO tool gate
`checkin-state.js → initApp()` calls `can_access_product('cico')` at startup; denied users get a full-screen lockout message (`renderCicoAccessDenied`) instead of an empty app. Fail-open on RPC error — RLS still protects the data.

---

## File structure

**Everything served lives under `public/`** (`wrangler.toml` → `directory = "public"`). Anything outside `public/` is never served — that's the allowlist that keeps `.git`/credentials off the web. Repo root holds only tooling: `CLAUDE.md`, `wrangler.toml`, `docs/`, `scripts/`, `tests/`, `supabase/`, `security/`, `sample/`.

```
public/
  _headers              — Security headers for all routes (CSP, X-Frame-Options, etc.)
  index.html            — Marketing/landing page
  dashboard.html        — Product dashboard (product links + role-aware admin link)
  app.html              — Class Builder app
  checkin-app.html      — Check-in / Check-out app
  schedule-app.html     — Building Schedule Builder app
  referral-app.html     — Referral Tracking app
  login.html / signup.html      — Shared auth (email verification + pending approval)
  privacy.html / terms-beta.html / security.html / pricing.html / contact.html
  products.html / class-builder.html / schedule-builder.html / checkin-checkout.html
  balanced-classes.html / prepare-student-roster.html / schedule.html / resources.html
  robots.txt / sitemap.xml
  admin/
    index.html          — Super-admin panel (8 tabs, see Admin panel)
    admin.js            — All super-admin logic
    admin.css           — Shared admin styles (also used by school-admin/)
  school-admin/
    index.html          — Per-school admin panel (reuses ../admin/admin.css)
    school-admin.js     — School-admin logic (approve/deactivate/remove staff, tool access)
  css/
    styles.css          — Class Builder styles (--navy, --teal, --gold)
    checkin.css         — CICO styles (--ci-navy, --ci-teal, --ci-gold); reused by Referrals
    referral.css        — Referral-specific styles
    schedule.css        — Schedule Builder styles (extends styles.css)
    marketing.css       — Marketing site design system
  images/logo.png       — Transparent PNG logo
  js/
    supabase-config.js  — Shared: SupabaseClient (top-level const!), trackSession(), trackEvent()
    auth-gate.js        — Session + approval gate (loaded in <head> of gated apps)
    session.js          — Inactivity/session timeout
    login.js / signup.js / dashboard.js / contact.js / marketing-chrome.js
    feedback.js         — Shared Send Feedback widget (all products)
    admin-mfa.js        — Shared MFA gate + TOTP enrollment for both panels (window.AdminMFA)
    tour.js             — Class Builder intro tour (coach-marks)
    — Class Builder:  app.js, import.js, fieldMapping.js, students.js, classes.js,
                      algorithm.js, results.js, sample.js
    — CICO:           checkin-state.js, checkin-entry.js, checkin-history.js,
                      checkin-students.js, checkin-config.js, checkin-reports.js
    — Referrals:      referral-state.js, referral-entry.js, referral-list.js,
                      referral-students.js, referral-config.js, referral-reports.js,
                      referral-review.js
    — Schedule:       schedule-state.js, schedule-setup.js, schedule-grid.js,
                      schedule-ia.js, schedule-specials-view.js, schedule-class-view.js,
                      schedule-export.js, schedule-init.js, schedule-tour.js
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

## Critical constraints — do not violate

### Admin `onAuthStateChange` must stay synchronous
`db.auth.onAuthStateChange(...)` in `admin/admin.js` **and `school-admin/school-admin.js`** **must not be `async`** and must not `await` anything inside the handler body. Supabase cannot finish processing auth state while the callback is blocked — the symptom is a completely silent login freeze on page refresh (no error, button stays on "Signing in…"). All async work goes in `verifyAndLoad()`, which is called fire-and-forget from the handler. This has been broken and fixed twice. Do not revert it.

---

## Brand & tech
- **Colors:** navy `#1E3A5F`, teal `#2A9D8F`, gold `#E9B949`. Defined once as `--navy` / `--teal` / `--gold` in `css/styles.css` `:root`, and mirrored with identical values by `marketing.css` and by `checkin.css` (as `--ci-navy` / `--ci-teal` / `--ci-gold`). `schedule.css` defines no `:root` — Schedule Builder loads `styles.css` first and inherits it. So the whole site is one palette.
  - **Use the variables, never a raw hex.** The stale navy/teal (`#0a2240`, `#0ea5e9`) were swept out of `styles.css`/`schedule.css` on 2026-07-17 — including the copies hiding in `rgba()` form (`rgba(14,165,233,…)` **is** `#0ea5e9`; `rgba(10,34,64,…)` **is** `#0a2240`), which a hex grep silently misses. Any `var(--x, #hex)` fallbacks left behind now carry the *correct* value.
  - **`#F59E0B` is NOT drift — do not "clean" it.** It survives in three places as a **semantic amber**, and only coincidentally matches the old gold hex: `--ci-score-1` in `checkin.css` (CICO score 1 — scores are 0=red `#EF4444`, 1=amber, 2=green `#22C55E`), `.nav-item-unsaved::after` (the unsaved-file warning), and `.budget-bar-fill.budget-tight` (whose sibling `budget-ok` is likewise a hardcoded green). Recolouring these to `--gold` would corrupt CICO's score display and flatten the warning states. Warning amber and brand gold are different jobs that happen to look alike.
  - This entry itself used to list the old hexes, which is exactly how both intro tours (`js/tour.js`, `js/schedule-tour.js`) shipped off-brand — written from this table rather than from `:root`. Fixed 2026-07-16; both tours now reference `var(--teal, …)` / `var(--navy, …)` so they track the app instead of restating it.
- **Font:** Nunito (Google Fonts)
- **Logo:** height 30px, `align-items: flex-start` to prevent stretch
- **No framework** — vanilla HTML/CSS/JS only
- **SheetJS** — CDN, Excel + CSV parsing/export
- **Chart.js** — CDN, CICO reports
- **Event handling** — all `onclick=`/`onchange=`/`oninput=` attributes have been removed and replaced with `addEventListener` calls (required for CSP `script-src` without `unsafe-inline`). Modern Safari handles this fine.

---

## Deployment
- **Always deploy via `bash scripts/deploy.sh`** from `/Users/michaelfletcher/dev/cohortlogic/` — NOT raw `npx wrangler deploy`. `deploy.sh` runs the Tier 1 pre-deploy gate (`scripts/predeploy.sh`) first and aborts if any check fails; raw wrangler skips the gate. (`--skip-gate` exists for genuine emergencies only.) GitHub auto-deploy broke after v54 and is NOT reliable.
- **The pre-deploy gate** (`scripts/predeploy.sh`, 5 checks, all sub-second, no browser): 1) CSP inline-handler scan, 2) cache-version **consistency + coverage**, 3) secret-exposure (.assetsignore), 4) Class Builder algorithm unit tests (`tests/algorithm.test.js`), 5) Schedule Builder reference check (`tests/check-refs.js` — every function/const referenced by a classic `<script>` must be defined somewhere in the loaded bundle; catches the #1 monolith-split failure mode). Each `check-*.sh` hard-fails if its scan target is missing (so a future restructure can't silently disarm it).

### Cache-busting (`?v=`) — the rule
Every **local** `.js`/`.css` tag in a served HTML carries `?v=`; all tags within a file share one value; bump them together on every deploy. CDN URLs are exempt (versioned in the URL). `check-versions.sh` enforces both **consistency** (one value per file) and **coverage** (no local asset without a `?v=`) across `app.html`, `schedule-app.html`, `checkin-app.html`, `referral-app.html`, `dashboard.html`, `login.html`, `admin/index.html`, `school-admin/index.html`. **Adding a new app? Add it to that `FILES` list.**
- Coverage is the load-bearing half: consistency alone is vacuous — a file with a single versioned tag passes while every other asset rides default caching. That was the real state until v159 (CICO/Referrals/Dashboard versioned only `feedback.js`; `app.html` left `auth-gate.js` unversioned; both admin panels weren't checked at all).
- **Two conventions, both fine:** `schedule-app.html` uses an incrementing counter (`?v=159`); everything else uses a date stamp (`?v=20260716`). They're per-file, so they don't need to agree with each other — only within a file.
- Live at: https://cohortlogic.com (DNS cutover complete — Cloudflare managing DNS)
- `wrangler.toml` configures static asset deployment from `public/` (no build step); `_headers` sets security headers
- Hard refresh (Cmd+Shift+R) needed after deploy to force re-download of cached HTML/JS

---

## QA process

Two tiers: the **static gate** (above, runs on every deploy) and **live post-deploy QA agents** (`.claude/agents/qa-*.md`) that log into cohortlogic.com and drive the real app in Chrome.

**When the user says "run QA" / "run the QA process" / "smoke test" / "test the deploy" (without naming a specific product): run ALL `.claude/agents/qa-*.md` agents.** Launch them **in parallel** (one Agent tool call per agent, in a single message), let each produce its own pass/fail report, then **aggregate into one combined summary** (a per-agent overall line + a merged failures list). This is glob-based on purpose — any new `qa-*.md` added later is automatically part of "run QA," no wiring needed. To run just one, the user names it (e.g. "run schedule QA" → `qa-schedulebuilder` only).

Current agents:
- `qa-classbuilder` — Class Builder (`app.html`): access gate → sample data → mapping → generation → violation cards → grade filter → drag-to-move.
- `qa-schedulebuilder` — Schedule Builder (`schedule-app.html`): login/gate → seed a minimal school → render + exercise Master Schedule (core) and each extracted feature view (IA, Specials view, Class view, Export); also confirms the shared feedback widget and the Synchronized-Blocks non-overlap rule.
- `qa-admin` — Feedback review flow for the super-admin dashboard (`admin/`). **Does NOT log into the admin panel by design** — that's the highest-privilege, MFA-protected surface, and automating its login would mean reading the super_admin password and/or defeating MFA. Instead it does the one safe, anonymous thing (seed a tagged `feedback` row, exactly what the public widget does) and hands a human super_admin a manual checklist (card goes hot, badge, archive/unarchive).

The product agents log in with the QA test account (`.qa-credentials`, gitignored); all agents append a line to `qa-runs.log` (gitignored) — the only durable record of when QA last ran.
- **Credential principle (do not violate):** QA automation may drive only the **low-privilege throwaway** account (`.qa-credentials`) for the product apps. It must **never** automate a privileged/admin login — no reading the super_admin password, no stripping MFA. Privileged surfaces (the admin panel) are verified by a human; agents for them only do least-privilege setup (e.g. an anon seed) and produce a manual checklist. If you'd rather perform even a product login yourself and hand the session to an agent, say so and it will pause at login.

**Adding a new product's QA:** drop a `qa-<product>.md` in `.claude/agents/` following the two existing files' structure (Chrome-tools setup → read `.qa-credentials` → login → per-feature checklist with console checks → log to `qa-runs.log` → report table). It joins "run QA" automatically.

---

## Security status
| Area | Status |
|------|--------|
| School data isolation (RLS) | ✅ Done — strict isolation, school_id backfilled |
| Role-based access (`role` enum) | ✅ Done — user / school_admin / super_admin |
| Per-school tool access (CICO) | ✅ Done — RLS-enforced (approval + product), school default + per-user override |
| School-admin privilege isolation | ✅ Done — no direct profile writes; SECURITY DEFINER RPCs guard same-school + target-is-user |
| FERPA audit log | ✅ Done |
| Profiles RLS — users see only their own profile | ✅ Done |
| Auto-create profile trigger on signup | ✅ Done |
| Email verification on signup | ✅ Done (Supabase Auth setting) |
| MFA on admin account | ✅ Done |
| MFA enforced in code (aal2) on both admin panels | ✅ Done — `js/admin-mfa.js`; strict when a factor is enrolled, soft "enroll" reminder otherwise; fails open on SDK error to avoid lockout |
| Session timeout — CICO + admin (15 min) | ✅ Done |
| Security headers via `_headers` | ✅ Done (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy) — applied by Cloudflare Workers |
| Privacy policy page | ✅ Done (`privacy.html`) |
| Google Sheets URL import removed | ✅ Done (privacy concern) |
| CSP `script-src` without `unsafe-inline` | ✅ Done — all `onclick=`/`onchange=`/`oninput=` migrated to `addEventListener`. This regressed once (15 CICO handlers silently broken in prod until Jul 2026) — run `scripts/check-csp.sh` before every deploy; it exits 1 on violations. |
| CSP `style-src` without `unsafe-inline` | ⚠️ Intentionally not done — 1,193 inline `style=""` attributes site-wide; no injection vector on a static site, so the security benefit is negligible. `unsafe-inline` stays in `style-src` permanently. |
| Supabase DPA | ⏳ Pending (needed for formal FERPA) |
| Class Builder auth | ✅ Real Supabase email/password + admin approval (`js/auth-gate.js` gates `app.html`); legacy `democlass` demo code removed |

---

## Runbooks

### MFA recovery — admin locked out of their authenticator
There are no self-service recovery codes (factor removal is service-role only, intentionally not exposed to the client). To recover an admin who lost their device:
1. Verify the person's identity out-of-band first.
2. Supabase dashboard → **Authentication → Users** → open the user.
3. In their **Factors**, delete the TOTP factor.
4. They can now sign in with password alone (`aal1`); the **"Enable 2FA"** banner prompts them to re-enroll on next login (or it's required once MFA enforcement is turned on).

### Changing role / approval / school / tool access
The `guard_profiles_privileged` trigger blocks direct SQL-editor writes to `role`, `approved`, `school_id`, `product_overrides`, `is_admin` (no admin session ⇒ `is_super_admin()` is false). Make these changes **through the panels** (which run as the signed-in super-admin) or the school-admin RPCs — not raw SQL. Break-glass only: `set session_replication_role = replica;` disables triggers for that transaction (also skips the audit log), then reset to `default`.

---

## Pending / to do

### Schedule Builder
- **Specials scheduling** — substantially reworked (v137–v139): hardest-grade-first placement order, two-phase (all carousels then recovery), prefer ONE fixed time per grade across all days (`findGradeFixedTime`), and specials get first pick of the day (instruction cleared before placement, re-flowed after). Remaining hard limit: consolidation is bounded by specials-teacher count free at a shared time; genuine shortfalls still stagger via recovery. Verify against real teacher/cpw data.
- **XLSX export styling** — potential upgrade: switch to the SheetJS **styled/paid build** for cell colors/centering/borders (the free build writes structure/merges but no styles).
- **Dismissal Duty (`bt_dis`)** — still appears in the Master Schedule palette (Arrival Duty was removed in v142); remove via `PALETTE_EXCLUDE` if it's non-paintable in the user's workflow.
- **CICO** — re-QA the entry/students/settings/reports flows after the v-Jul-2026 CSP handler migration (see security table note); those interactions were dead in prod and are now fixed but need a real click-through.
- **Teacher-level RLS** — on hold; needs product decisions

### Other products
- **Dead feedback CSS** — `#feedback-btn` / `.feedback-overlay` rules linger in `css/styles.css` (4) and `css/checkin.css` (2) from the pre-widget modals. Harmless, unused, safe to delete.
- **`cico_students` compat view** — nothing in the client references it any more (all reads use `students`); safe to drop.
- **Test signup flow end-to-end** — verify email confirmation → pending approvals → approval → login works
- **CICO weekly trend chart** — 8-week bar chart in CICO Analytics to show usage trajectory
- **Pending Approvals UX** — edge cases for returning deactivated users (currently uses 3-day heuristic)
- **Disable Netlify site** — migration complete; go to Netlify → site settings → Delete this site
- **Safari smoke test** — test login, CICO app, and dashboard on Safari after addEventListener migration
- **Supabase Pro upgrade** — prevents pausing in active use; needed before onboarding paying schools
- **Supabase DPA** — formal FERPA compliance (requires Pro)
- **Data retention policy** — process decision, not yet defined
- Class Builder: print view, lock student to class
- CICO: mobile polish, print-friendly check-in sheets
