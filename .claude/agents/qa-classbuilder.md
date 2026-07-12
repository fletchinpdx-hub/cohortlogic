---
name: qa-classbuilder
description: Post-deploy QA smoke test for the Cohort Logic Class Builder at cohortlogic.com. Run this after every `npx wrangler deploy` to verify the live site works end-to-end. Tests the full user flow: access gate → sample data → field mapping → class generation → violation detail cards → grade filter → drag-to-move. Reports pass/fail with screenshots on any failure. Use this skill whenever the user says "run QA", "test the deploy", "smoke test", or "qa-classbuilder".
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

Read the QA credentials from `/Users/michaelfletcher/Documents/cohortlogic/.qa-credentials`. It contains `qa_email` and `qa_password`.

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

Before generating, inject a separation rule so violation cards are testable in Step 6. Run this in `javascript_tool` **after** Field Mapping but **before** generating:

```javascript
// Force a separation between student 9001 (Alice Adams K) and 9002 (Ben Baker K)
// then set up 2 classes per grade so they might end up in the same class
AppState.separations = [{ a: 9001, b: 9002 }];
// Set 2 classes for K so the algorithm has to split them (or may fail to)
if (AppState.gradeConfig['K']) AppState.gradeConfig['K'].classCount = 2;
if (AppState.gradeConfig['1']) AppState.gradeConfig['1'].classCount = 2;
'separation rule injected';
```

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

With the injected separation rule, Alice Adams (9001) and Ben Baker (9002) may or may not end up in the same class — violations depend on the algorithm. Check the "Keep Apart Violations" stat card:

- If count > 0: click the stat card
  - **Pass:** A detail panel expands below the card showing the specific student pair (Alice Adams / Ben Baker)
  - **Fail:** Card is not clickable, nothing expands, or console shows `Content-Security-Policy` error after click
- If count = 0: the algorithm separated them successfully
  - Force a visible violation by running in JS: inject them into the same class manually, then re-render:
    ```javascript
    // Move student 9002 into same class as 9001 (both into K class 0)
    const kClasses = AppState.results['K'];
    if (kClasses && kClasses.length >= 2) {
      const s = kClasses[1].find(s => s.id === 9002);
      if (s) {
        kClasses[1] = kClasses[1].filter(s => s.id !== 9002);
        kClasses[0].push(s);
        if (typeof renderResults === 'function') renderResults();
        else if (typeof renderResultsGrid === 'function') renderResultsGrid();
      }
    }
    'done';
    ```
  - Then click the "Keep Apart Violations" stat card
  - **Pass:** Detail panel expands with the pair listed
  - **Fail:** CSP error, card not clickable, or panel doesn't expand

---

### 7. Drag-to-Move (JS unit test)

Drag uses the native `dataTransfer` API which can't be reliably automated via synthetic mouse events. Instead, test the drop handler directly:

```javascript
// Simulate a drop: move student 9003 (Clara Adams K) from K-class-1 to K-class-0
const kClasses = AppState.results['K'];
if (!kClasses || kClasses.length < 2) {
  'SKIP: need 2 K classes';
} else {
  const student = kClasses[1].find(s => s.id === 9003);
  if (!student) {
    'SKIP: student 9003 not found in K class 1';
  } else {
    const before0 = kClasses[0].length;
    const before1 = kClasses[1].length;

    // Replicate exactly what the drop handler does
    const idx = kClasses[1].findIndex(s => s.id === 9003);
    const [moved] = kClasses[1].splice(idx, 1);
    kClasses[0].push(moved);
    renderResultsGrid();

    const after0 = AppState.results['K'][0].length;
    const after1 = AppState.results['K'][1].length;
    `moved: class0 ${before0}→${after0}, class1 ${before1}→${after1}`;
  }
}
```

- **Pass:** Returns a string like `"moved: class0 5→6, class1 5→4"` and the Results grid re-renders showing updated counts
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
