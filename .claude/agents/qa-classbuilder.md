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

Read the QA credentials from `/Users/michaelfletcher/dev/cohortlogic/.qa-credentials`. It contains `qa_email` and `qa_password`.

Open a fresh tab and navigate to `https://cohortlogic.com/login.html`.

---

## Checklist

### 1. Login
- Enter the `qa_email` into the Work Email field
- Enter the `qa_password` into the Password field
- Click **Sign in**
- **Pass:** Page redirects to `dashboard.html` (the product dashboard)
- **Fail:** Error message shown, stays on login, or console has a JS exception

After login, navigate directly to `https://cohortlogic.com/app.html`.
- **Pass:** The Class Builder app loads with its sidebar (School Profile, Import Data, Field Mapping, Class Setup, Students, Results)
- **Fail:** Redirected back to login or an error page

Check console for errors after this step. CSP errors look like `"Refused to execute inline script"` or `"Content-Security-Policy"`.

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

**Overall: X/8 steps passed**
```

For any ❌ FAIL, include:
- What was expected
- What actually happened
- The console error text if relevant
- A screenshot

If all steps pass, end with: "Deploy looks good. ✅"
