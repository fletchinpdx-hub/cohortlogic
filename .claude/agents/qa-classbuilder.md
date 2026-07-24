---
name: qa-classbuilder
description: Post-deploy QA smoke test for the Cohort Logic Class Builder at cohortlogic.com/app.html. Run after every deploy to verify the live site works end-to-end. Tests the full user flow: access gate → sample data → field mapping → class generation → violation detail cards → grade filter → drag-to-move. Reports pass/fail with screenshots on any failure. Part of the full QA suite — see the "QA process" section in CLAUDE.md; running "QA" runs this AND every other qa-*.md agent. Use this whenever the user says "run QA", "run class builder QA", "test the deploy", "smoke test", or "qa-classbuilder".
---

# QA Smoke Test — Cohort Logic Class Builder

You are running a post-deploy QA check on the live Class Builder at **https://cohortlogic.com/app.html**.

Work through the checklist below in order. After each step, check the browser console for errors. If a step fails, take a screenshot and add it to the failure report. Keep going through remaining steps even after a failure — report everything at the end.

---

## Setup

Load the chrome browser tools before starting:
```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool
```

Read the QA credentials from `/Users/michaelfletcher/dev/cohortlogic/.qa-credentials`. It contains `qa_email` and `qa_password` (the **full-access** QA account) and may also contain `qa_trial_email` / `qa_trial_password` (a **trial-tier** account used only by step 9).

Open a fresh tab and navigate to `https://cohortlogic.com/login.html`.

### Suppress the intro tour — DO THIS BEFORE LOADING app.html

`js/tour.js` auto-runs a coach-mark tour on first visit and drops a **modal overlay over
the whole app**, which blocks every later step (clicks land on the dim layer, not the UI).
It only stays away because `localStorage.cb_tour_v1_done` persists — so a fresh Chrome
profile, a cleared profile, or incognito WILL hit it. Don't race the modal; pre-set the key.

After login, while on a `cohortlogic.com` page (localStorage is per-origin), run:

```javascript
localStorage.setItem('cb_tour_v1_done', '1');
'tour suppressed';
```

Then navigate to `app.html`. If a tour card is somehow still up (`.cb-tour-card` visible),
click **Skip ×** before continuing, and note it in the report — that means the key name
changed and this instruction needs updating.

---

## Checklist

### 1. Login
- Enter the `qa_email` into the Work Email field
- Enter the `qa_password` into the Password field
- Click **Sign in**
- **Pass:** Page redirects to `dashboard.html` (the product dashboard)
- **Fail:** Error message shown, stays on login, or console has a JS exception

After login, navigate directly to `https://cohortlogic.com/app.html`.
- **Pass:** The Class Builder app loads with its sidebar (School Profile, **Import/Export**, Field Mapping, Class Setup, Students, Results). Note the nav item is "Import/Export" — it was renamed from "Import Data" when file handling was consolidated onto one view.
- **Fail:** Redirected back to login or an error page

Check console for errors after this step. CSP errors look like `"Refused to execute inline script"` or `"Content-Security-Policy"`.

---

### 1b. Entitlement check — THIS DECIDES WHICH PATH YOU RUN

Class Builder is trial-gated. The QA account is a plain user, so unless its school has an
`active` subscription it resolves to **trial** — which legitimately blocks most of the
full-product checklist. Read the state before going further:

```
JSON.stringify(Entitlements.state())
```
- **`access:"full"`** → run steps 2–8 (the full product) and SKIP step 9.
- **`access:"trial"`** → SKIP steps 4–7 (they will fail *by design*: only 1st grade
  generates, export/save are blocked) and run **step 9** instead. Say so in the report —
  this is not a bug.
- **`access:"expired"`** → the app shows a full-screen lockout wall. Only step 9's lockout
  check applies; note it and stop.
- **`ReferenceError: Entitlements is not defined`** → real failure: `js/entitlements.js`
  didn't load (check the `?v=` on `app.html` and the script order — it must load after
  `supabase-config.js`).

Do NOT try to change the plan to get a different path — that needs the admin panel, which
QA automation must never drive. Report the state you got.

---

### 2. Sample Data Load

The import screen has **Download Sample** (downloads a CSV) — there is no "Load Sample Data" button. Instead, inject QA test data directly via JS, which includes a known separation rule so Step 6 (violation cards) is always testable.

Run this in `javascript_tool`:

```javascript
// Build 20 students across grades K–1, with one known separation violation
const rows = [];
let id = 9001;
const names = [
  ['Alice','Adams'],['Ben','Baker'],['Clara','Chen'],['Dan','Davis'],
  ['Eva','Evans'],['Frank','Fisher'],['Grace','Garcia'],['Henry','Hall'],
  ['Iris','Ito'],['Jack','Jones']
];
for (const grade of ['K','1']) {
  names.forEach(([first, last], i) => {
    rows.push({
      'Student ID': String(id++),
      'First Name': first,
      'Last Name': last,
      'Grade': grade,
      'Math Score': String(Math.round(60 + (i * 4))),
      'Reading Score': String(Math.round(55 + (i * 4))),
      'Gender': i % 2 === 0 ? 'F' : 'M',
    });
  });
}
loadRawData(rows, 'qa-sample.csv');
rows.length + ' students loaded';
```

- **Pass:** Returns `"20 students loaded"` and app navigates to Field Mapping
- **Fail:** JS error, or sidebar still shows "No students loaded"

---

### 3. Field Mapping
- The column mapping dropdowns should be pre-populated (Grade, First Name, Last Name auto-guessed)
- Click **Apply Mapping & Continue**
- **Pass:** App navigates to Class Setup; sidebar shows "20 students loaded" and "2 grades configured"
- **Fail:** Alert about missing fields, or no navigation occurs

---

### 4. Class Generation

Before generating, set 2 classes per grade so drag and violation tests have somewhere to move students. Run this in `javascript_tool` **after** Field Mapping but **before** generating:

```javascript
// Set 2 classes per grade
if (AppState.gradeConfig['K']) AppState.gradeConfig['K'].classCount = 2;
if (AppState.gradeConfig['1']) AppState.gradeConfig['1'].classCount = 2;
JSON.stringify({ K: AppState.gradeConfig['K']?.classCount, one: AppState.gradeConfig['1']?.classCount });
```

**IMPORTANT — student IDs:** The app assigns its own internal integer ids (`0, 1, 2, …`) in load order and **ignores the "Student ID" column**. Do NOT reference students by the 9001-style values from the sample CSV — they don't exist in `AppState`. Steps 6 and 7 below read the real ids straight off `AppState.results`, so they work regardless. If you inject a separation rule, use the internal ids (Alice Adams = 0, Ben Baker = 1).

- Navigate to the **Students** tab
- Click **Generate Balanced Classes** (the primary CTA button at the bottom of the student list)
- The page should navigate to the Results tab and briefly show "Generating…" then render class cards
- **Pass:** Results tab is active; stat cards show "Total Students: 20" and "Total Classes: 4"; class cards are visible
- **Fail:** App stays on Students tab, no class cards appear, or console shows an error

Check console for errors after generation completes.

---

### 5. Grade Filter Dropdown
- On the Results tab, find the grade filter dropdown (select#results-grade-filter)
- Check the option order via JS: `Array.from(document.getElementById('results-grade-filter').options).map(o => o.value)`
- **Pass:** Order is `["", "K", "1"]` — K before 1
- **Fail:** K appears after 1, or options are missing

Then filter by selecting K:
```javascript
const sel = document.getElementById('results-grade-filter');
sel.value = 'K';
sel.dispatchEvent(new Event('change'));
```
- **Pass:** Grid updates to show only K classes (2 cards); Total Students drops to 10
- **Fail:** Grid doesn't change, count stays at 20, or console error

Reset filter back to All Grades:
```javascript
sel.value = '';
sel.dispatchEvent(new Event('change'));
```

---

### 6. Violation Detail Cards

The "Keep Apart Violations" card starts at 0 (the algorithm separates students on its own). Force a real violation by moving one student into another's class using **real internal ids** — Alice Adams = 0, Ben Baker = 1 (the app renumbers students 0,1,2,… in load order; it does NOT use the CSV's Student ID column). This reads the student straight off `AppState.results` so it's robust:

```javascript
AppState.separations = [{ a: 0, b: 1 }];   // real internal ids
const kClasses = AppState.results['K'];
let result = 'no-op';
const s = kClasses[1].find(st => st.id === 1);   // Ben Baker in K class 2
if (s) {
  kClasses[1] = kClasses[1].filter(st => st.id !== 1);
  kClasses[0].push(s);                             // into K class 1 with Alice
  if (typeof renderResults === 'function') { renderResults(); result = 'moved'; }
  else if (typeof renderResultsGrid === 'function') { renderResultsGrid(); result = 'moved'; }
} else { result = 'Ben (id 1) not in K class 1 — inspect AppState.results to find him'; }
result;
```

If the return is not `'moved'`, inspect where Ben actually is:
`AppState.results['K'].map((c,i)=>c.filter(s=>s.id<2).map(s=>({i,id:s.id,name:s.firstName+' '+s.lastName})))` and adapt the source class index.

- Then click the "Keep Apart Violations" stat card (it shows "click for details" and a red border once count ≥ 1)
- **Pass:** Detail panel expands below the card listing "Alice Adams & Ben Baker — placed in the same class"
- **Fail:** Card not clickable, nothing expands, or `read_console_messages` shows a `Content-Security-Policy` error after the click (this is the exact bug class that was fixed — a CSP regression here is a real failure)

---

### 7. Drag-to-Move (real drop-event test)

Don't just replicate the handler's logic — fire the **actual `drop` event** with a populated `DataTransfer` so the real listener in `results.js` runs. Move a student between the two Grade-1 classes:

```javascript
const g1 = AppState.results['1'];
const before0 = g1[0].length, before1 = g1[1].length;
const moving = g1[1][0];                 // first student in G1 class 2
const destCard = document.querySelector('.class-card[data-grade="1"][data-class="0"]');
if (!destCard) { throw new Error('dest card not found — is the grade filter on All Grades?'); }

const dt = new DataTransfer();
dt.setData('studentId', String(moving.id));
dt.setData('fromGrade', '1');
dt.setData('fromClass', '1');
destCard.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));

const after0 = AppState.results['1'][0].length, after1 = AppState.results['1'][1].length;
JSON.stringify({ moved: moving.firstName+' '+moving.lastName, class0: before0+'→'+after0, class1: before1+'→'+after1 });
```

- **Pass:** class0 count goes up by 1, class1 down by 1 (e.g. `"class0":"5→6","class1":"5→4"`), and the grid re-renders to match (take a screenshot to confirm)
- **Fail:** counts unchanged (the real drop handler didn't fire), JS error, or grid doesn't update
- **Note:** if the grade filter is not on "All Grades", the dest card query may miss — reset the filter first (`document.getElementById('results-grade-filter').value=''; ...dispatchEvent(new Event('change'))`)
- **Fail:** JS error, counts unchanged, or grid doesn't update

---

### 8. Final Console Check
- Call `read_console_messages` with pattern `error|Error|CSP|Content-Security|Refused|Uncaught`
- Any `Content-Security-Policy` error is a **Fail** — note the exact message
- Any uncaught JS exception (`Uncaught TypeError`, `Uncaught ReferenceError`, etc.) is a **Fail**
- Warnings are OK to note but don't count as failures

---

### 9. Trial gating — RUN ONLY when step 1b reported `access:"trial"` (or `"expired"`)

Revenue-critical: these gates are what a free user hits. Load the sample data first
(step 2) so there's a roster to gate.

**Trial banner**
```
JSON.stringify({ banner: !!document.getElementById('cb-trial-banner') })
```
- **Pass:** `banner:true` — the strip states 1st grade only + export/print/save off.

**Only 1st grade is workable** (the sample roster is grades K and 1)
```
navigateTo('classes'); buildGradeConfig();
JSON.stringify({ active: activeGrades(), kLocked: isGradeLocked('K'), oneLocked: isGradeLocked('1') })
```
- **Pass:** `active:["1"]`, `kLocked:true`, `oneLocked:false` — K is locked, 1st is open.
- **Fail:** `active` contains more than one grade → the gate leaks.

**Generation only produces the unlocked grade**
```
runBalancingAlgorithm(); JSON.stringify({ grades: Object.keys(AppState.results) })
```
- **Pass:** `grades:["1"]` only. Any other grade present is a **leak — Fail**.

**Export + Save are blocked**
- Click **Export by Grade** on Results, then **Save session file** on Import/Export.
- **Pass:** each opens the upgrade modal (`#cb-upgrade-modal` exists) and NO file downloads.
```
JSON.stringify({ modal: !!document.getElementById('cb-upgrade-modal') })
```
- **Fail:** a file downloads → the gate leaks the deliverable.

**Expired only:** with `access:"expired"`, `#cb-trial-lockout` must exist and cover the app.

---

### 10. Bad-input / edge cases — RUN ON ANY ACCESS LEVEL

Every case below has either shipped as a real bug or is one field away from one. Pure
in-browser: no files, no writes. Run each, then continue — a failure here is a real bug.

**Two mechanics that these checks depend on (both verified live, don't "simplify" them):**
- `loadRawData()` only fills `AppState.rawRows`. Students are built when the mapping is
  applied, and that lives in the **button handler**, not a callable function — so you must
  click it: `document.getElementById('apply-mapping-btn').click()`. There is no
  `applyFieldMapping()` to call.
- **Use grade `1` for anything that generates.** On a trial account only the unlocked grade
  is ever *computed*, so `runBalancingAlgorithm()` with a grade-3 roster returns an empty
  `AppState.results['3']` — which looks like a failure but is the gate working. Grade 1 keeps
  these cases valid on **both** trial and full accounts.

**10a. Ordinal + mixed-case grades normalize.** The importer must fold `1st`/`1` and `k`/`K`
together, not create duplicates:
```javascript
loadRawData([
  {'First Name':'A','Last Name':'One','Grade':'1st'},
  {'First Name':'B','Last Name':'Two','Grade':'1'},
  {'First Name':'C','Last Name':'Three','Grade':'k'},
  {'First Name':'D','Last Name':'Four','Grade':'K'},
], 'qa-ordinal.csv');
document.getElementById('apply-mapping-btn').click();
JSON.stringify({ grades: getGrades(), students: AppState.students.length });
```
- **Pass:** exactly `["K","1"]` and `students:4`. K sorts **before** 1.
- **Fail:** four grades (`1st` and `1` split apart), or K sorted after 1 — both have shipped before.

**10b. Grade with a single student.** One student split into 2 classes must not crash or
duplicate them:
```javascript
loadRawData([{'First Name':'Solo','Last Name':'Student','Grade':'1'}], 'qa-solo.csv');
document.getElementById('apply-mapping-btn').click();
if (AppState.gradeConfig['1']) AppState.gradeConfig['1'].classCount = 2;
try { runBalancingAlgorithm(); JSON.stringify({ sizes: (AppState.results['1']||[]).map(c=>c.length) }); }
catch (e) { 'THREW: ' + e.message; }
```
- **Pass:** `[1,0]` or `[0,1]` — no exception, total still exactly 1.
- **Fail:** a thrown error, a `NaN` size, or the student in **both** classes.

**10c. Empty import — know what you're actually testing.**

The **user-facing** path is already guarded: `import.js` checks `if (!rows.length)` and shows
"The file appears to be empty." *before* calling `loadRawData`, so a real empty upload is
handled cleanly. `loadRawData([])` called **directly** throws
`Cannot convert undefined or null to object` (it does `Object.keys(rows[0])` unguarded) and
leaves `AppState.rawRows = []` behind.

So do NOT report that throw as a user-facing bug — it isn't reachable through the UI today.
What this check protects is that the **upstream guard still exists**:

```javascript
// Confirm the guard is still in the upload path, not just in our heads.
const src = document.querySelector('script[src*="import.js"]')?.src;
const txt = src ? await fetch(src).then(r=>r.text()) : '';
JSON.stringify({ guardPresent: /!rows\.length/.test(txt) });
```
- **Pass:** `guardPresent:true`.
- **Fail:** `guardPresent:false` → the guard was refactored away and an empty upload now
  throws at the user. That IS a real bug — report it.

**10d. Duplicate roster rows keep distinct internal ids.**
```javascript
loadRawData([
  {'First Name':'Same','Last Name':'Name','Grade':'1'},
  {'First Name':'Same','Last Name':'Name','Grade':'1'},
], 'qa-dupe.csv');
document.getElementById('apply-mapping-btn').click();
JSON.stringify({ n: AppState.students.length, ids: AppState.students.map(s=>s.id) });
```
- **Pass:** `n:2` with two **different** ids. Identical names must not collapse into one student.
- **Fail:** `n:1`, or two students sharing an id — that would corrupt every separation/together rule.

Reload the page after 10d to clear the edge-case roster before continuing.

---

### 11. Save → Load session round-trip — REQUIRES `access:"full"`

Nothing else tests the save format, and it's the format shared with Schedule Builder. Skip
with a note if step 1b reported `trial`/`expired` (Save is gated there by design — that's step 9).

Load the step-2 sample, apply mapping, set 2 classes/grade, and generate first. Then:

1. Click **💾 Save Session** (`#save-session-btn` on Results, or `#ie-save-session-btn` on
   Import/Export). A `.cohortlogic` file downloads.
2. Capture a fingerprint of the pre-save state:
```javascript
JSON.stringify({
  students: AppState.students.length,
  grades: Object.keys(AppState.results),
  sizes: Object.fromEntries(Object.entries(AppState.results).map(([g,cs])=>[g,cs.map(c=>c.length)])),
  seps: (AppState.separations||[]).length
});
```
3. Find the downloaded file: `ls -t ~/Downloads/*.cohortlogic | head -1`
4. **Reload `app.html`** (fresh state), then upload that file to `#restore-file-input` using
   the `file_upload` tool.
5. Re-run the same fingerprint snippet.

- **Pass:** student count, grade list, per-class sizes, and rule count all match the pre-save
  fingerprint. Take a screenshot of the restored Results grid.
- **Fail:** any field differs, the load throws, or the app silently stays empty. Report the
  two fingerprints side by side.

---

### 12. Cross-product file handoff (Class Builder → Schedule Builder) — REQUIRES `access:"full"`

The documented rule: loading a `.cohortlogic` file that carries **no** Schedule Builder data
must import **school + staff only** and leave SB's own schedule intact. Nothing tests this,
and it's subtle enough to regress silently.

1. In Class Builder, set a recognizable School Name (e.g. `QA Handoff School`) on School
   Profile, then Save Session (reuse the step-11 file if the name was already set).
2. Open `https://cohortlogic.com/schedule-app.html` and let it load.
3. If SB already has a schedule, note `JSON.stringify({before: Object.keys(SchedState.masterSchedule||{})})`.
4. Upload the Class Builder file to the SB load input (`#load-cohort-input`, triggered from
   Import/Export) via `file_upload`.
5. Check:
```javascript
JSON.stringify({
  school: SchedState.school?.name,
  staff: (SchedState.staff||[]).length,
  scheduleDays: Object.keys(SchedState.masterSchedule||{})
});
```
- **Pass:** `school` becomes `QA Handoff School`, and `scheduleDays` is **unchanged** from
  step 3 — SB kept its own schedule.
- **Fail:** SB's `masterSchedule` got wiped or replaced by the Class Builder file. That's data
  loss for a real user and a hard fail — report it prominently.

---

### 13. Excel export produces a real file — REQUIRES `access:"full"`

Verifies the deliverable users actually hand to staff isn't silently corrupt.

1. On Results (All Grades, after generating), click **⬇️ By Grade** (`#export-by-grade-btn`).
2. Then click **⬇️ By Teacher** (`#export-by-teacher-btn`).
3. Confirm both landed and are non-trivial:
```bash
ls -lt ~/Downloads/*.xlsx | head -2
```
4. Verify each is a genuine, readable workbook (not a 0-byte or HTML-error file):
```bash
cd ~/dev/cohortlogic && node -e "
const XLSX=require('./public/js/vendor-xlsx-shim.js');" 2>/dev/null || \
python3 -c "
import zipfile,sys,glob
f=sorted(glob.glob('$HOME/Downloads/*.xlsx'))[-1]
z=zipfile.ZipFile(f)
names=[n for n in z.namelist() if n.startswith('xl/worksheets/')]
print('file:',f,'sheets:',len(names),'ok' if names else 'NO SHEETS')
"
```
- **Pass:** each file is >5 KB, opens as a valid zip/xlsx, and reports ≥1 worksheet. By Grade
  should have one sheet per grade; By Teacher one per class.
- **Fail:** 0-byte file, not a valid zip (SheetJS wrote an error page), or zero worksheets.

**Clean up** the files this run created (per the self-clean policy):
```bash
rm -f ~/Downloads/*.cohortlogic ~/Downloads/*.xlsx
```
Only remove files this run downloaded — if the folder had pre-existing exports, delete by the
specific filenames you captured instead of globbing.

---

## Pre-deploy static check (run locally before deploying)

Before `npx wrangler deploy`, run:
```bash
bash scripts/check-csp.sh
```
This greps for `onclick=` / `onchange=` / etc. inside JS template strings. If it exits non-zero, fix the violations before deploying. (CICO files currently still have violations — known issue, tracked separately.)

---

## Log the run

After completing all steps (pass or fail), append one line to `/Users/michaelfletcher/dev/cohortlogic/qa-runs.log` (gitignored) recording the run. Use the Bash tool:

```bash
printf '%s | %s | %s | %s\n' "$(date '+%Y-%m-%d %H:%M')" "classbuilder" "RESULT" "NOTES" >> /Users/michaelfletcher/dev/cohortlogic/qa-runs.log
```

Where `RESULT` is like `7/8 PASS` and `NOTES` is a short summary of any failures (or `all green`). The `classbuilder` product tag keeps the shared log parseable now that multiple QA agents write to it. This is the only durable record of when QA last ran — always write it.

---

## Report Format

End with a clear summary using this format:

```
## QA Report — cohortlogic.com/app.html
Date: [today]

| Step | Result | Notes |
|------|--------|-------|
| 1. Login + App Load | ✅ PASS / ❌ FAIL | |
| 2. Sample Data | ✅ PASS / ❌ FAIL | |
| 3. Field Mapping | ✅ PASS / ❌ FAIL | |
| 4. Class Generation | ✅ PASS / ❌ FAIL | |
| 5. Grade Filter | ✅ PASS / ❌ FAIL | |
| 6. Violation Cards | ✅ PASS / ❌ FAIL | |
| 7. Drag to Move | ✅ PASS / ❌ FAIL | |
| 8. Console Errors | ✅ PASS / ❌ FAIL | |
| 9. Trial gating | ✅ PASS / ❌ FAIL / ⚪ N/A (full access) | |
| 10. Edge cases (a–d) | ✅ PASS / ❌ FAIL | |
| 11. Save/Load round-trip | ✅ PASS / ❌ FAIL / ⚪ SKIP (trial) | |
| 12. Cross-product handoff | ✅ PASS / ❌ FAIL / ⚪ SKIP (trial) | |
| 13. Excel export | ✅ PASS / ❌ FAIL / ⚪ SKIP (trial) | |

**Overall: X/13 steps passed** (note how many were N/A or skipped and why)
```

For any ❌ FAIL, include:
- What was expected
- What actually happened
- The console error text if relevant
- A screenshot

If all steps pass, end with: "Deploy looks good. ✅"
