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
- **Pass:** The Class Builder app loads with its sidebar (Import, Fields, Classes, Students, Results)
- **Fail:** Redirected back to login or an error page

Check console for errors after this step. CSP errors look like `"Refused to execute inline script"` or `"Content-Security-Policy"`.

---

### 2. Sample Data Load
- Find and click the **"Load Sample Data"** button (usually on the Import screen or a prominent call-to-action)
- **Pass:** The sidebar status updates to show students loaded (e.g. "500 students loaded") and the Fields nav item becomes active
- **Fail:** No students loaded, alert shown, or console error

---

### 3. Field Mapping
- Navigate to the **Fields** tab
- The column mapping dropdowns should be pre-populated (sample data has standard columns)
- Click **Apply Mapping** (or equivalent confirm button)
- **Pass:** App navigates to the Classes tab; sidebar shows student count confirmed
- **Fail:** Alert about missing fields, or no navigation occurs

---

### 4. Class Generation
- Navigate to the **Students** tab
- Click **Generate Classes** (the primary CTA button)
- The page should navigate to the Results tab and show a "Generating…" state briefly, then render class cards
- **Pass:** Results tab is active; stat cards show "Total Students" and "Total Classes" with non-zero numbers; class cards are visible in the grid
- **Fail:** App stays on Students tab, no class cards appear, or console shows an error during generation

Check console for errors after generation completes.

---

### 5. Grade Filter Dropdown
- On the Results tab, find the grade filter dropdown near the top
- Open the dropdown — it should list grades in order (K before 1, 1 before 2, etc.)
- Select a specific grade (e.g. "Grade 1" or "K" if present)
- **Pass:** The class grid updates to show only classes for that grade; "Total Students" stat card updates to a smaller number; no "All Grades" total remains
- **Fail:** Grid doesn't filter, count doesn't change, or dropdown is missing grades / in wrong order
- Reset filter back to "All Grades"

---

### 6. Violation Detail Cards
- Look at the "Keep Apart Violations" and "Keep Together Violations" stat cards
- If either shows a non-zero count, click that card
- **Pass:** A detail panel or list expands below the card showing the specific student pairs involved
- **Note:** If both show 0 (no violations), this step passes by default — note it in the report
- **Fail:** Card is not clickable, nothing expands, or console shows a CSP error on click (look for `"Content-Security-Policy"` in console after clicking)

---

### 7. Drag Student Between Classes
- In the Results grid (with "All Grades" selected), find two class cards for the same grade
- Click and drag a student pill from one class card to another
- **Pass:** The student moves to the new class; the student count on each card updates accordingly
- **Fail:** Drag has no effect, student disappears, or a JS error appears in console

---

### 8. Final Console Check
- Call `read_console_messages` one final time
- Scan for any errors not caught in earlier steps
- Any `Content-Security-Policy` error is a **Fail** — note the exact message
- Any uncaught JS exception (`Uncaught TypeError`, `Uncaught ReferenceError`, etc.) is a **Fail**
- Warnings are OK to note but don't count as failures

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
| 6. Violation Cards | ✅ PASS / ❌ FAIL / ⚪ N/A (0 violations) | |
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
