# Cohort Logic — CLAUDE.md

## What this is
A multi-product SaaS for school administrators. Built by Michael Fletcher (Cohort Logic).

**Live site:** cohortlogic.com  
**GitHub:** github.com/fletchinpdx-hub/cohortlogic  
**Supabase project:** dlqnzlwuzktcljxxxlit  
**Local dev:** http://localhost:3456 (run via `npx serve -l 3456 public`)  
**Hosting:** Cloudflare Workers (static assets via `wrangler.toml`, `directory = "public"` — only files inside `public/` are ever served; this is an allowlist, not the old `.` denylist model). Deploy with `npx wrangler deploy` from `/Users/michaelfletcher/Documents/cohortlogic/`. GitHub push auto-deploys via Cloudflare Pages integration — but wrangler is the reliable fallback. Netlify site should be deleted.

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
- **Demo access code:** democlass (hardcoded in client JS — known limitation, security theater only)
- **No backend** — everything runs in the browser. Data never sent to a server.
- Session-based auth via `sessionStorage`.
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
Master schedule builder for school administrators. Phase 1 complete; Phase 2 Specials Schedule view live.

**Cache buster:** currently `?v=143` on all 5 script tags AND both CSS links in `schedule-app.html`. Bump ALL on every deploy.

**Data model — file-based, not Supabase:**
- Schedule data NEVER stored server-side. Users download a `.clsched` JSON file to save; upload it to resume.
- `localStorage` is a session cache only (survives tab close, not device switch).
- Supabase used only for auth + product gating (`enabled_products` includes `schedule_builder`).
- `downloadScheduleFile()` / `loadScheduleFromFile(file)` in `schedule-state.js`.

**Nav flow (current):**
- Phase 1 — Setup: School Info → Staff Roster → Specials → Block Types
- Phase 1 — Build: Master Schedule (locked until grades configured)
- Phase 2 — Detail: Specials Schedule (locked until specials configured) → IA Schedule (live) → Class Schedules (placeholder)
- Finish: Export (placeholder)

**Key state — `SchedState` in `schedule-state.js`:**
- `school` — name, year, grades, time bounds (firstBell, dismissal, arrival=studentCampusStart, dismissal=studentCampusEnd, teacherContractStart/End…), lunchPeriods[], gradeRecesses{}, gradeBands[], specials[], specialsRotationMode. NOTE: `morningMeetings[]` and legacy `morningMeeting*` fields are **defunct** (v124) — morning meetings are configured only as the `bt_mm` block (Block Types → school-wide time). Stale `morningMeetings` data is fully inert: it neither places blocks nor affects the minutes budget.
- `blockTypes[]` — DEFAULT_BLOCK_TYPES (6 blocks for new schedules): bt_spec (system), bt_mm, bt_lunch, bt_recess (fixed/auto-placed), bt_arr (Arrival Duty), bt_dis (Dismissal Duty). Schools add required instructional blocks via the Block Types tab. Required blocks have bandMinutes{} / subBandMinutes{}.
- `masterSchedule[day][grade][slot]` = blockTypeId — 5-minute slots Mon–Fri
- `conflicts[day][grade][slot]` = [btId, …] — blocks displaced by manual drag; never created by auto-fill
- `specialsSchedule[classId][day]` = `{ subjectId, teacherId, startTime }` — class-level specials (source of truth for Specials Schedule view)
- `iaSchedule[day][iaId][slot]` = `{ allocId, targetType, targetId, note }` — IA grade/class assignments
- `iaAllocations[]` = `[{ id, name, color, hoursPerDay }]` — budget categories for IAs
- `duties[]` = `[{ id, name, location, startTime, endTime, days[], iaIds[], allocId }]` — IA duty blocks (non-grade, e.g. "Morning Greeting"); not tied to master schedule

**Key JS files:**
- `js/schedule-state.js` — SchedState, DEFAULT_BLOCK_TYPES, saveToLocal, loadFromLocal, downloadScheduleFile, loadScheduleFromFile, uid(), updateSidebarStatus()
- `js/schedule-setup.js` — School Info, Staff Roster, Specials, Block Types views + save flows; SP_DEFAULT_COLORS
- `js/schedule-grid.js` — Master Schedule grid, drag-to-move, auto-populate, conflict rendering, specials scheduling, Specials Schedule view, IA Schedule view (All IAs + Individual IA), duty blocks, XLSX export, coverage validation
- `js/schedule-init.js` — boot (auth + product gate), landing screen, VIEW_RENDERERS, download/load wiring

**Key behaviors:**
- `preFillFixedBlocks()` — auto-places lunch (from `lunchPeriods`) + recess (from `computeRecessTimes`) + morning meeting (only from the `bt_mm` block's uniformStart/End). Clears all fixed-block slots first, then re-places. Calls `ensureFixedBlockTypes()` at the top (v126) so bt_mm/bt_lunch/bt_recess type defs always exist — without them `buildCell()` renders those slots as **empty cells** and the palette's Transition group vanishes. `ensureFixedBlockTypes()` used to run only on load; running it here self-heals every build.
- `autoPopulateGrade(grade)` — fills required instructional blocks per grade band requirements; grade-header click uses `clearFirst=true`
- `autoPopulateIfEmpty()` — runs on master schedule entry. Fill-gaps-only (`clearFirst=false`, v130): fully-placed blocks — including manual moves — stay put, so user edits survive leaving/re-entering the view. (v118 briefly used clearFirst=true to recover from v115 corruption, but that steamrolled manual edits every render.) Clearing + optimal re-place is reserved for the explicit grade-header auto-fill click. v135: the fill-gaps pass leaves ANY block that already has ≥1 slot exactly as-is (previously it cleared+re-placed partially-placed blocks, which on a tight day fell through to the split fallback and cut a block into two pieces after a manual move). Only completely-missing blocks are placed fresh; the unplaced banner flags anything left short.
- `_autoFillSlots(day)` — the instructional placement/display window. Starts at **firstBell** (v122), matching `computeMinutesBudget` — NOT the earliest of firstBell/arrival/dayStart (arrival is duty time, not instruction). `_populateGradeData`/`showUnplacedBlocksBanner` all key off this.
- `ensureFixedBlockTypes()` (schedule-state.js) — pushes missing bt_mm/bt_lunch/bt_recess defs into `blockTypes`. Idempotent. Called on load AND in `preFillFixedBlocks()`.
- `buildSpecialsSchedule(force=false)` — computes class-level rotation, finds grade-wide time slots, writes bt_spec|spId to masterSchedule and specialsSchedule. Unforced calls SKIP the rebuild while every class already has a specialsSchedule entry (v130) — a full rebuild wipes manual specials moves on the master grid. Rebuild triggers: specialsSchedule empty (Specials-tab save clears it), a new class appears, or force=true. v137: places grades **hardest-first** (`placementOrder` = most classes first — the tightest teacher-demand grade claims its carousel slot before easier grades consume availability), and runs in **two phases** — every grade's carousel (Phase 1) before any grade's straggler recovery (`recoveryQueue`, Phase 2) — so recovery's off-carousel scatter can't steal a clean shared-time slot a later grade's carousel still needs. `gradeIdx` still uses stable grade order so rotation offsets don't shift. v138: prefer ONE **fixed time across all 5 days** per grade (`findGradeFixedTime`, previously defined-but-unused) so a grade's specials land at the SAME clock-time every day (`fixedToPerDay`); only fall back to per-day `findGradeSpecialsTime` when no single weekly time is clear+staffable. v139 (the load-bearing one): on rebuild, `buildSpecialsSchedule` now CLEARS every grade's instruction (`_clearRequirementsForGrade`) BEFORE placing specials — specials get first pick, so `findGradeFixedTime` sees a clean day and can actually lock a consistent time (before, instruction filled the day first and forced the scattered per-day fallback). Callers re-flow instruction around the placed specials (`_populateGradeData` for all grades). `saveSpecialsAndContinue` now runs this full data-only pass immediately (buildSpecialsSchedule(true) → preFillFixedBlocks → _populateGradeData all grades) so the fresh schedule exists regardless of which view opens next. Trade-off: a Specials-tab save re-flows instruction (a deliberate "full new pass" — manual instruction moves are re-laid). NOTE: the Specials Schedule view is BY TEACHER, so one specials teacher spanning multiple grades still looks spread out (each grade at its own fixed time) — grade-level consistency is visible in Class Schedules → Compare Grade / the master grid, not the per-teacher view.
- Class Schedules off-carousel display (v137): at a grade `bt_spec` slot where a class's own special is at a different time, `getClassSlotEntry` returns an `isSpecialsHole` placeholder ("Specials · at H:MM") rendered muted/dashed (`.cls-specials-hole`) instead of an empty cell — the class reads as accounted-for, not deleted.
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
- IA Schedule view: two tabs — "All IAs" (`buildIAGrid`) and individual IA (`buildIndividualIAGrid`); both show duty blocks with dashed borders. Clicking an assignment cell (`.ia-assign-cell`) opens `openIAAssignmentEditor` — an anchored `.override-panel` popover to change the budget category / note or delete the whole assignment. `_iaAssignmentRun(day,iaId,slot)` returns the contiguous same-alloc/target run to edit/delete as one unit. (Assigning new IAs still happens via the Master Schedule "Assign IAs" mode; the IA tab is edit/delete + view.)
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

**`.clsched` file format:** v3 JSON; `school.specials[]` persisted with `color` field.

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
| `cico_students` | Students per school |
| `cico_checkins` | Daily check-in records |
| `cico_period_scores` | Per-period scores (child of checkins, FK: `checkin_id`) |
| `cico_incidents` | Incident records (child of checkins, FK: `checkin_id`) |
| `cico_settings` | Period count per school |
| `cico_categories` | Scoring categories per school |
| `cico_incident_types` | Incident type definitions per school |
| `sessions` | Class Builder demo sessions (anon + authenticated INSERT, authenticated SELECT) |
| `events` | Class Builder demo events (anon + authenticated INSERT, authenticated SELECT) |
| `features` | Feature flags: `key, enabled, updated_at` — read-only via RLS (SELECT only, no writes from client) |

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

### Sections
- **Pending Approvals** — approve new users, assign to a school; returning deactivated users show "Previously active" badge + "Reactivate" button
- **All Users** — approved users with school reassign dropdown + Deactivate button
- **Class Builder Analytics** — sessions, funnel (how far users get), feature usage, recent sessions
- **CICO Analytics** — enrolled students, check-ins (30d + today), active schools, per-school activity table with Wipe Data action
- **Audit Log** — FERPA audit trail, filter by table/action/date, paginated, detail modal
- **Schools** — Add, edit (inline), and delete schools; deletion blocked if users are assigned

### Key functions in admin.js
- `verifyAndLoad(session, event)` — async; called fire-and-forget from onAuthStateChange; checks `profiles.is_admin`, signs out non-admins, then calls showDashboard + loadDashboard
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
- **All Users** now has a **Role** column (`setUserRole` — promote/revoke `school_admin`; super_admin only set via SQL)
- **Pending** has `assignPendingSchool` — "Route to school admin": sets `school_id` WITHOUT approving, so the user lands in their school admin's queue

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
```
index.html              — Marketing/landing page
dashboard.html          — Product dashboard (links to both products + role-aware admin link)
app.html                — Class Builder app
checkin-app.html        — Check-in / Check-out app
schedule-app.html       — Building Schedule Builder app
login.html              — Shared login for CICO
signup.html             — CICO signup (email verification + pending approval flow)
privacy.html            — Privacy policy (FERPA)
security.html           — Security & privacy marketing page
pricing.html            — Pricing page
contact.html            — Contact page
class-builder.html      — Class Builder marketing/product page
resources.html          — Resources
wrangler.toml           — Cloudflare Workers static asset config (no build step)
_headers                — Security headers for all routes (CSP, X-Frame-Options, etc.)
admin/
  index.html            — Super-admin panel
  admin.js              — All super-admin logic
  admin.css             — Shared admin styles (also used by school-admin/)
school-admin/
  index.html            — Per-school admin panel (reuses ../admin/admin.css)
  school-admin.js       — School-admin logic (approve/deactivate/remove staff, tool access)
css/
  styles.css            — Class Builder styles (--navy, --teal, --gold)
  checkin.css           — CICO styles (--ci-navy, --ci-teal, --ci-gold)
  marketing.css         — Marketing site design system
js/
  app.js                — Class Builder: AppState, navigation, utilities
  import.js             — File import (Excel + CSV)
  fieldMapping.js       — Column mapping, competency config
  students.js           — Student table, separation/together pairs
  classes.js            — Grade/class config, teacher assignment
  algorithm.js          — Snake-draft + separation/together fixing + category balancing
  results.js            — Class cards, drag-to-move, export by grade/teacher
  sample.js             — 500-student sample + blank template download
  supabase-config.js    — Shared: SupabaseClient, trackSession(), trackEvent()
  admin-mfa.js          — Shared MFA gate + TOTP enrollment for both admin panels (window.AdminMFA)
  checkin-state.js      — CicoState, loadCicoData(), navigation, toast, initApp(), session timeout
  checkin-entry.js      — Entry view: student search, period grid, incidents
  checkin-history.js    — History view: filter, load, render cards
  checkin-students.js   — Students view: list, add/edit, Excel import
  checkin-config.js     — Settings: period count, categories, incident types
  checkin-reports.js    — Reports: 4 tabs, Chart.js charts, stat cards
  schedule-state.js     — SchedState, DEFAULT_BLOCK_TYPES, file save/load, uid()
  schedule-setup.js     — School Info, Block Types, Staff Roster views
  schedule-grid.js      — Master Schedule grid, drag-to-move, auto-populate, XLSX export
  schedule-init.js      — Boot, landing screen, download/load wiring
css/
  schedule.css          — Schedule Builder styles (extends styles.css)
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
- **Colors:** navy (#0a2240), teal (#0ea5e9 / --ci-teal: #2a9d8f), gold (#f59e0b)
- **Font:** Nunito (Google Fonts)
- **Logo:** height 30px, `align-items: flex-start` to prevent stretch
- **No framework** — vanilla HTML/CSS/JS only
- **SheetJS** — CDN, Excel + CSV parsing/export
- **Chart.js** — CDN, CICO reports
- **Event handling** — all `onclick=`/`onchange=`/`oninput=` attributes have been removed and replaced with `addEventListener` calls (required for CSP `script-src` without `unsafe-inline`). Modern Safari handles this fine.

---

## Deployment
- **Always use `npx wrangler deploy`** from `/Users/michaelfletcher/Documents/cohortlogic/` — GitHub auto-deploy broke after v54 and is NOT reliable
- Live at: https://cohortlogic.com (DNS cutover complete — Cloudflare managing DNS)
- `wrangler.toml` configures static asset deployment (no build step)
- `_headers` file sets all security headers (supported by Cloudflare Workers static assets)
- Hard refresh in browser (Cmd+Shift+R) needed after deploy to force re-download of cached HTML/JS

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
| Demo access code in client JS | ⚠️ Known limitation (v1 intentional) |

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
- **Class Schedules view** — BUILT (`renderClassSchedulesView`; Single Class `buildClassWeekGrid` + Compare Grade `buildGradeCompareGrid`).
- **Export view** — BUILT (`exportXLSX` + `exportJSON`; per-day master tabs, Class Schedules, Specials, IA, School Info, Staff). Potential upgrade: switch to SheetJS **styled/paid build** for cell colors/centering/borders on the XLSX export (free build writes merges but no styles).
- **Dismissal Duty (`bt_dis`)** — still appears in the Master Schedule palette (Arrival Duty was removed in v142); remove via `PALETTE_EXCLUDE` if it's non-paintable in the user's workflow.
- **CICO** — re-QA the entry/students/settings/reports flows after the v-Jul-2026 CSP handler migration (see security table note); those interactions were dead in prod and are now fixed but need a real click-through.
- **FERPA privacy policy page** — older pending item
- **Teacher-level RLS** — on hold; needs product decisions

### Other products
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
