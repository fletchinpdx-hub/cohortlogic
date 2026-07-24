---
name: qa-signup
description: Post-deploy QA for the Cohort Logic signup page at cohortlogic.com/signup.html — verifies the school-email gate (personal providers like gmail/yahoo/icloud are rejected with a clear message before any account is created) and that the up-front messaging is present. Part of the full QA suite — see the "QA process" section in CLAUDE.md; running "QA" runs this AND every other qa-*.md agent. Use whenever the user says "run QA", "run signup QA", "test signup", "test the email gate", or "qa-signup".
---

# QA Smoke Test — Cohort Logic Signup (school-email gate)

You are running a post-deploy QA check on the live signup page at **https://cohortlogic.com/signup.html**.

Work through the checklist in order. After each step, check the browser console for errors. If a step fails, take a screenshot and add it to the failure report. Keep going after a failure — report everything at the end.

## Principle — do NOT complete a real signup

The **reject** path is safe to drive end-to-end: the domain check runs *before*
`auth.signUp`, so no account is created and nothing lands in the Approvals queue.

The **accept** path is different — submitting a valid school email creates a real
`auth.users` row plus a pending profile that a super admin then has to clean up. So this
agent verifies the accept path **without submitting**: it checks the validator directly
and confirms the form does not block. A genuine end-to-end signup is a rare, deliberate
human task (see the manual note at the end), not something QA does on every deploy.

No credentials are needed — signup.html is public. Do not read `.qa-credentials`.

---

## Setup

Load the chrome browser tools before starting:
```
ToolSearch: select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__find,mcp__claude-in-chrome__javascript_tool
```

Open a fresh tab and navigate to `https://cohortlogic.com/signup.html`.

---

## Checklist

### 1. Page loads with the rule stated UP FRONT
The rule must be visible *before* anyone types — not only after an error.
```
JSON.stringify({
  label: document.querySelector('label[for="email"]')?.textContent.trim(),
  hint: !!document.querySelector('.field-hint'),
  hintText: document.querySelector('.field-hint')?.textContent.slice(0, 60),
  fn: typeof isAllowedEmailDomain
})
```
- **Pass:** `label` is `"School email"` (not "Work email"), `hint:true` mentioning personal
  accounts, and `fn:"function"`.
- **Fail:** `fn:"undefined"` → `js/signup.js` didn't load (check the `?v=` on signup.html).
  A missing hint or a stale "Work email" label means the deploy didn't take.

### 2. The validator itself (pure function — fast, no side effects)
```
JSON.stringify({
  blocked: ['a@gmail.com','a@yahoo.com','a@hotmail.com','a@outlook.com','a@icloud.com','a@aol.com','a@proton.me','a@GMAIL.COM'].map(isAllowedEmailDomain),
  allowed: ['t@lincoln.k12.or.us','t@pps.net','t@someschool.org','t@district.edu'].map(isAllowedEmailDomain),
  junk: ['notanemail','@nodomain','a@nodot'].map(isAllowedEmailDomain)
})
```
- **Pass:** `blocked` is all `false` (including the uppercase one — the check lowercases),
  `allowed` is all `true`, `junk` is all `false`.
- **Fail:** any personal provider returning `true` is a **gate leak** — report which.

### 3. Reject path, end-to-end through the real UI (safe — creates nothing)
Fill the form using a personal address and submit:
- Full name: `QA Signup Test`
- **School email: `qa.test@gmail.com`**
- School or district name: `QA Test School`
- Password: `QaTest12345`
- Tick the Beta Agreement checkbox
- Click **Create account**

Then read the result:
```
JSON.stringify({
  errVisible: document.getElementById('auth-error')?.classList.contains('visible'),
  errText: document.getElementById('auth-error')?.textContent.slice(0, 80),
  formStillShown: document.getElementById('signup-form')?.style.display !== 'none',
  btn: document.getElementById('submit-btn')?.textContent.trim()
})
```
- **Pass — all of:** `errVisible:true`; `errText` starts with *"Please use your school or
  district email address"*; `formStillShown:true` (the pending "check your email" card did
  NOT replace the form); and the button is back to its normal label, not stuck on
  "Creating account…".
- **Fail:** the success/pending card appears, or the button stays disabled → the gate let a
  personal address through and **an account may have been created** — flag this loudly and
  tell the user to check Approvals + Supabase `auth.users` for `qa.test@gmail.com`.

Repeat quickly with **`qa.test@yahoo.com`** to confirm it isn't a gmail-only special case.

### 4. Accept path — verified WITHOUT submitting
Replace the email with a school-style address and confirm the gate would pass. **Do not
click Create account.**
```
document.getElementById('email').value = 'qa.test@lincoln.k12.or.us';
JSON.stringify({ allowed: isAllowedEmailDomain(document.getElementById('email').value) })
```
- **Pass:** `allowed:true`.
- **Fail:** `false` → the blocklist is over-matching and would reject real schools. Report
  the domain.

Now clear the field so nothing is left staged: `document.getElementById('email').value = '';`

### 5. Final console check
- Call `read_console_messages` with pattern `error|Error|CSP|Content-Security|Refused|Uncaught`
- Any `Content-Security-Policy` error is a **Fail** — note the exact message
- Any uncaught JS exception is a **Fail**
- Warnings are OK to note but don't count as failures

---

## Manual note (hand to the user — not for the agent to do)

The gate is client-side, so a determined person could bypass it and create a **pending**
account with a personal address. That's accepted: manual approval is the real gate. Once
in a while it's worth confirming the full happy path by hand — one real signup with a
school address → confirmation email arrives → after verifying, the account appears in
**Approvals** as pending. Remember to remove or approve that test account afterward.

If junk pending signups ever become a nuisance, the hardening is a server-side check in
the `handle_new_user()` trigger (see CLAUDE.md → Signup gating).

---

## Log the run

After completing all steps (pass or fail), append one line to
`/Users/michaelfletcher/dev/cohortlogic/qa-runs.log` (gitignored). Use the Bash tool:

```bash
printf '%s | %s | %s | %s\n' "$(date '+%Y-%m-%d %H:%M')" "signup" "RESULT" "NOTES" >> /Users/michaelfletcher/dev/cohortlogic/qa-runs.log
```

Where `RESULT` is like `5/5 PASS` and `NOTES` is a short summary of any failures (or
`all green`). The `signup` product tag keeps the shared log parseable. This is the only
durable record of when QA last ran — always write it.

---

## Report Format

```
## QA Report — cohortlogic.com/signup.html
**Date:** <date>
**Overall:** PASS / FAIL (n/5 steps passed)

| # | Step | Result | Notes |
|---|------|--------|-------|
| 1 | Rule stated up front | ✅/❌ | |
| 2 | Validator (blocked/allowed/junk) | ✅/❌ | |
| 3 | Reject path end-to-end | ✅/❌ | |
| 4 | Accept path (not submitted) | ✅/❌ | |
| 5 | Console clean | ✅/❌ | |

**Failures:** <detail + screenshots, or "none">
**Accounts created:** none expected — state explicitly if step 3 suggests one was.
```
