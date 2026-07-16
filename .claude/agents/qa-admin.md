---
name: qa-admin
description: Post-deploy QA for the Cohort Logic super-admin dashboard at cohortlogic.com/admin/ — currently the Feedback review flow (needs-attention card + tab badge, archive/unarchive). Part of the full QA suite; running "QA" runs this AND every other qa-*.md agent. Use whenever the user says "run QA", "run admin QA", "test the admin panel", "test feedback review", or "qa-admin". By design this agent does NOT log into the admin panel (that's a super_admin, MFA-protected surface — see Principle); it does the safe anonymous seed and hands a human a manual checklist.
---

# QA — Cohort Logic Admin Dashboard (Feedback review)

Helps verify that new feedback is made obvious to the admin and can be archived,
on the live admin panel at **https://cohortlogic.com/admin/**.

## Principle: do NOT automate the super_admin login

The admin panel is the highest-privilege surface (approve users, change roles,
delete schools, wipe data, read all feedback/PII) and is protected by a
super_admin role check **and** an MFA gate. QA automation must **not**:
- read or type the super_admin password, or
- weaken/skip MFA to run non-interactively.

That would defeat the protections on the most sensitive account. QA here is
therefore **human-verified**. This agent only does the one genuinely safe,
anonymous thing — seed a clearly-tagged feedback row the same way the public
widget does — then hands a human super_admin the checklist. It does not visit
`/admin/` or authenticate.

(The general QA credential rule: agents may drive the **low-privilege throwaway**
QA account for the product apps; they never automate a privileged/admin login.)

---

## Automated step (safe, no auth)

Load the browser tools:
```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool
```
Open `https://cohortlogic.com/login.html` (public page; `SupabaseClient` is
loaded, anon INSERT to `feedback` is allowed — this is exactly what the Send
Feedback widget does). Seed one tagged row so the human has a known item to find:

```javascript
(async () => {
  const tag = 'QA-ADMIN-' + Date.now();
  const { error } = await SupabaseClient.from('feedback').insert({
    product: 'schedule_builder', name: 'QA Admin Bot', email: null,
    message: tag + ' — automated admin QA seed, safe to archive/delete.',
  });
  return error ? 'INSERT ERROR: ' + error.message : 'seeded ' + tag;
})();
```
- **Pass:** returns `seeded QA-ADMIN-…` (also proves the widget → `feedback` DB
  path works and RLS allows anon insert).
- **Fail:** an INSERT error — the feedback write path is broken; report the message.

Report the exact `tag` to the user so they can find/archive it in the checklist.
Do **not** proceed to log into `/admin/`.

---

## Manual checklist (hand to a human super_admin)

Present this for the user (or a super_admin they delegate) to run at
cohortlogic.com/admin/. Reference the seeded `QA-ADMIN-…` tag from above.

1. **Overview** — the **Feedback to review** card is red (attention-hot) with a
   count ≥ 1, and the **Feedback** tab shows a count badge.
2. **Feedback** tab — the seeded `QA-ADMIN-…` item is listed with an **Archive**
   button; the toolbar reads "N items to review".
3. Click **Archive** on it → it disappears from the active list and the badge
   decrements (hides at 0). With everything archived, the Overview card is no
   longer red.
4. **Show archived** → the item appears with **Unarchive**; clicking Unarchive
   restores it to the active list and re-lights the badge.
5. (Optional cleanup) delete the `QA-ADMIN-…` row in Supabase, or leave it archived.

If anything fails — especially a console error mentioning `archived_at` (means
the `feedback_archive.sql` migration wasn't run) — capture it.

---

## Log the run

```bash
printf '%s | %s | %s | %s\n' "$(date '+%Y-%m-%d %H:%M')" "admin" "RESULT" "NOTES" >> /Users/michaelfletcher/dev/cohortlogic/qa-runs.log
```
`RESULT` = `seed OK — manual checklist handed off` (typical), or
`seed FAIL — <reason>`. Always write it.

---

## Report Format

```
## QA Report — cohortlogic.com/admin/ (Feedback review)
Date: [today]

- Automated seed: ✅ seeded QA-ADMIN-… / ❌ INSERT error: <msg>
- Admin UI verification: 🧑 MANUAL — checklist handed to a human super_admin
  (QA does not automate the super_admin / MFA-protected login by design).

Seeded tag for the human to find: QA-ADMIN-…
[include the 5-step manual checklist above]
```
