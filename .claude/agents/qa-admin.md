---
name: qa-admin
description: Post-deploy QA for the Cohort Logic super-admin dashboard at cohortlogic.com/admin/. Currently focused on the Feedback review flow — the "needs attention" indicator (overview card + tab badge) and archive/unarchive. Part of the full QA suite — running "QA" runs this AND every other qa-*.md agent. Use whenever the user says "run QA", "run admin QA", "test the admin panel", "test feedback review", or "qa-admin". IMPORTANT prerequisite: the admin panel requires a super_admin account and passes an MFA gate — see the Auth section; if the run can't authenticate, report the manual checklist rather than failing.
---

# QA — Cohort Logic Admin Dashboard (Feedback review)

Verifies that new feedback is made obvious to the admin and can be archived, on
the live admin panel at **https://cohortlogic.com/admin/**.

## Auth prerequisite (read first)

The admin panel is stricter than the product apps:
- It **signs out any non-super_admin immediately** — a regular QA account bounces
  straight back to the login view.
- It runs an **MFA (TOTP) gate** when a factor is enrolled; browser automation
  can't produce a TOTP code.

So this agent can only run the automated flow when the credentials in
`/Users/michaelfletcher/Documents/cohortlogic/.qa-credentials` belong to a
**super_admin with no enrolled MFA factor** (soft "enroll" reminder is fine).
If login lands back on the sign-in view (non-super_admin) or an MFA challenge
appears, **do not fail** — report `PREREQUISITE — manual verification required`
and hand back the **Manual checklist** at the bottom for a human to run. That's
a valid outcome, not a bug.

## Setup

Load the chrome browser tools:
```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool
```
Read `.qa-credentials` (`qa_email`, `qa_password`). Open a fresh tab at
`https://cohortlogic.com/admin/`.

---

## Checklist

### 0. Seed a known feedback item (no admin needed)

Before logging in, drop a uniquely-tagged feedback row via the shared widget so
there's a guaranteed active item to find. On the admin **login page**
(`SupabaseClient` is loaded there, anon INSERT to `feedback` is allowed):

```javascript
(async () => {
  const tag = 'QA-ADMIN-' + Date.now();
  const { error } = await SupabaseClient.from('feedback').insert({
    product: 'schedule_builder', name: 'QA Admin Bot', email: null,
    message: tag + ' — automated admin QA, safe to archive/delete.',
  });
  return error ? 'INSERT ERROR: ' + error.message : 'seeded ' + tag;
})();
```
Remember the `tag` — you'll find that row by its message below. **Pass:** returns
`seeded QA-ADMIN-…`. (If INSERT errors, the widget→DB path itself is broken — note it.)

### 1. Login (+ auth-prerequisite gate)
- Enter `qa_email` / `qa_password`, sign in.
- If it reaches the dashboard (tabs: Overview, Approvals, …, Security, Feedback) → continue.
- If it bounces to the login view (non-super_admin) or shows an MFA/TOTP prompt →
  stop the automated flow, report `PREREQUISITE — manual verification required`,
  and return the Manual checklist. Not a failure.

### 2. Overview indicator
- On **Overview**, read the Feedback attention card:
  `(() => { const c=[...document.querySelectorAll('#overview-attention .attention-card')].find(x=>/Feedback to review/i.test(x.textContent)); return c ? {val:c.querySelector('.attention-value')?.textContent, hot:c.classList.contains('attention-hot')} : 'card not found'; })()`
- **Pass:** the card exists, its value is ≥ 1, and `hot:true` (attention-hot) since we just seeded one.
- Tab badge: `(() => { const b=document.getElementById('feedback-badge'); return {shown:!b.classList.contains('hidden'), n:b.textContent}; })()` — **Pass:** `shown:true` with a count ≥ 1.

### 3. Feedback list shows the seeded item
- Click the **Feedback** tab (`document.querySelector('[data-view="feedback"]').click()`), wait for load.
- Find the seeded row by its tag and confirm it has an **Archive** button:
  `(() => { const rows=[...document.querySelectorAll('#feedback-list tbody tr')]; const r=rows.find(tr=>/QA-ADMIN-/.test(tr.textContent)); return r ? {found:true, hasArchive:!!r.querySelector('[data-act="archiveFeedback"]')} : {found:false, rowCount:rows.length}; })()`
- **Pass:** `found:true, hasArchive:true`. Also confirm the toolbar reads "N items to review".
- `read_console_messages` — **Fail** on any error (esp. anything about `archived_at` — would mean the migration wasn't run).

### 4. Archive removes it + decrements the badge
- Note the badge count, then click the seeded row's Archive button:
  `[...document.querySelectorAll('#feedback-list tbody tr')].find(tr=>/QA-ADMIN-/.test(tr.textContent)).querySelector('[data-act="archiveFeedback"]').click()`
- After it reloads: the seeded row is **gone** from the active list, and the
  badge count dropped by 1 (or hid if it hit 0).
  `(() => { const gone=![...document.querySelectorAll('#feedback-list tbody tr')].some(tr=>/QA-ADMIN-/.test(tr.textContent)); const b=document.getElementById('feedback-badge'); return {gone, badge:b.classList.contains('hidden')?'hidden':b.textContent}; })()`
- **Pass:** `gone:true` and the badge decreased.

### 5. Show archived → Unarchive
- Click the **Show archived** toggle (`document.querySelector('[data-act="toggleFeedbackArchived"]').click()`), wait.
- **Pass:** the seeded row now appears with an **Unarchive** button
  (`[data-act="unarchiveFeedback"]`).
- Click **Unarchive** on it, wait.
- **Pass:** no error; toggling back to active (`toggleFeedbackArchived` again)
  shows the row restored with an Archive button and the badge back up.

### 6. Cleanup + final console check
- Re-archive the seeded row (so it doesn't linger as active): find it, click Archive.
- (The row stays in the DB, archived. If you want it fully gone, delete it in
  Supabase by its `QA-ADMIN-…` message — optional.)
- `read_console_messages` pattern `error|Error|CSP|Content-Security|Refused|Uncaught|archived_at` — any hit is a **Fail**.

---

## Log the run

```bash
printf '%s | %s | %s | %s\n' "$(date '+%Y-%m-%d %H:%M')" "admin" "RESULT" "NOTES" >> /Users/michaelfletcher/Documents/cohortlogic/qa-runs.log
```
`RESULT` like `6/6 PASS`, `PREREQUISITE` (couldn't auth), or `N/6`. Always write it.

---

## Report Format

```
## QA Report — cohortlogic.com/admin/ (Feedback review)
Date: [today]

| Step | Result | Notes |
|------|--------|-------|
| 0. Seed feedback         | ✅ PASS / ❌ FAIL | |
| 1. Login (super_admin)   | ✅ PASS / ⏭ PREREQUISITE | |
| 2. Overview indicator    | ✅ PASS / ❌ FAIL | |
| 3. List shows item       | ✅ PASS / ❌ FAIL | |
| 4. Archive + badge       | ✅ PASS / ❌ FAIL | |
| 5. Show archived/Unarch. | ✅ PASS / ❌ FAIL | |
| 6. Cleanup + console     | ✅ PASS / ❌ FAIL | |

**Overall: X/6** (or "PREREQUISITE — manual verification required")
```

---

## Manual checklist (use when auth can't be automated)

Have a human super_admin do this on cohortlogic.com/admin/:
1. Submit feedback from any product's 💬 Send Feedback button.
2. Admin **Overview**: the **Feedback to review** card is red (attention-hot)
   with a count; the **Feedback** tab shows a count badge.
3. **Feedback** tab: the item is listed with an **Archive** button; toolbar says
   "N items to review".
4. Click **Archive** → item disappears, badge decrements (hides at 0), and the
   Overview card is no longer hot once all are archived.
5. **Show archived** → the item appears with **Unarchive**; Unarchive restores it
   to the active list and re-lights the badge.
