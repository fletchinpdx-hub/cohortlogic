/**
 * notify-approved
 *
 * Triggered by a Supabase Database Webhook when a row in `profiles` is updated.
 * Sends an approval email via Resend when `approved` flips from false → true.
 *
 * Required secrets (set via CLI: supabase secrets set KEY=value):
 *   RESEND_API_KEY        — from resend.com
 *   NOTIFY_WEBHOOK_SECRET — any random string; must match what the DB webhook sends
 *
 * Automatically available (no setup needed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY')!
const WEBHOOK_SECRET        = Deno.env.get('NOTIFY_WEBHOOK_SECRET')
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL               = 'https://cohortlogic.com'
const FROM_EMAIL            = 'Cohort Logic <hello@cohortlogic.com>'

Deno.serve(async (req: Request) => {
  // ── Verify webhook secret ──────────────────────────────────────────────
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get('x-webhook-secret')
    if (secret !== WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  // ── Parse payload ──────────────────────────────────────────────────────
  let payload: { type: string; record: Record<string, unknown>; old_record?: Record<string, unknown> }
  try {
    payload = await req.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }

  const { type, record, old_record } = payload

  // Only act on UPDATE where approved just flipped to true
  if (
    type !== 'UPDATE' ||
    !record.approved ||
    old_record?.approved === true
  ) {
    return new Response('No action needed', { status: 200 })
  }

  // ── Look up user email via admin API ───────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(
    record.id as string
  )

  if (userError || !user?.email) {
    console.error('Could not fetch user:', userError)
    return new Response('User lookup failed', { status: 500 })
  }

  // ── Build email ────────────────────────────────────────────────────────
  const firstName = (record.full_name as string | undefined)?.split(' ')[0] || 'there'

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:ui-sans-serif,system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:520px;margin:48px auto;padding:0 20px 48px;">

    <!-- Logo -->
    <div style="margin-bottom:28px;">
      <span style="font-size:20px;font-weight:600;color:#1E3A5F;letter-spacing:-.015em;">
        Cohort&nbsp;<span style="font-weight:400;opacity:.8;">Logic</span>
      </span>
    </div>

    <!-- Card -->
    <div style="background:#fff;border:1px solid #E5E9F0;border-radius:16px;padding:40px 36px;box-shadow:0 1px 0 rgba(15,23,42,.04),0 8px 24px -8px rgba(15,23,42,.08);">

      <p style="font-size:22px;font-weight:600;color:#0F172A;margin:0 0 6px;letter-spacing:-.02em;">
        Hi ${firstName} 👋
      </p>
      <p style="font-size:15px;color:#334155;margin:0 0 28px;line-height:1.65;">
        Your Cohort Logic account has been approved. You now have full access to
        <strong style="color:#0F172A;">Class Builder</strong> — free through September 2026.
      </p>

      <!-- CTA button -->
      <a href="${APP_URL}/login.html"
         style="display:inline-block;background:#1E3A5F;color:#fff;font-size:15px;font-weight:500;
                padding:13px 26px;border-radius:999px;text-decoration:none;letter-spacing:-.005em;">
        Sign in to Class Builder &nbsp;→
      </a>

      <!-- Divider -->
      <div style="height:1px;background:#E5E9F0;margin:32px 0;"></div>

      <!-- Quick tips -->
      <p style="font-size:13px;font-weight:600;color:#0F172A;margin:0 0 12px;text-transform:uppercase;letter-spacing:.06em;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;">
        Get started
      </p>
      <div style="display:grid;gap:10px;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-family:ui-monospace,monospace;font-size:11px;color:#2A9D8F;background:#EAF6F4;padding:2px 7px;border-radius:4px;margin-top:1px;white-space:nowrap;">01</span>
          <p style="font-size:13px;color:#334155;margin:0;line-height:1.5;">Import your student roster from Excel or paste a Google Sheet link.</p>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-family:ui-monospace,monospace;font-size:11px;color:#2A9D8F;background:#EAF6F4;padding:2px 7px;border-radius:4px;margin-top:1px;white-space:nowrap;">02</span>
          <p style="font-size:13px;color:#334155;margin:0;line-height:1.5;">Map your columns and set keep-apart or keep-together rules.</p>
        </div>
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-family:ui-monospace,monospace;font-size:11px;color:#2A9D8F;background:#EAF6F4;padding:2px 7px;border-radius:4px;margin-top:1px;white-space:nowrap;">03</span>
          <p style="font-size:13px;color:#334155;margin:0;line-height:1.5;">Generate balanced classes in one click, fine-tune by dragging, then export to Excel.</p>
        </div>
      </div>

      <div style="margin-top:28px;padding:14px 16px;background:#F8FAFC;border-radius:10px;border:1px solid #E5E9F0;">
        <p style="font-size:13px;color:#64748B;margin:0;line-height:1.6;">
          📚 Need help? Reply to this email or visit
          <a href="${APP_URL}" style="color:#2A9D8F;text-decoration:none;font-weight:500;">cohortlogic.com</a>.
          We read everything.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <p style="text-align:center;font-size:12px;color:#94A3B8;margin-top:24px;font-family:ui-monospace,monospace;">
      © ${new Date().getFullYear()} Cohort Logic ·
      <a href="${APP_URL}" style="color:#94A3B8;text-decoration:none;">cohortlogic.com</a>
    </p>
  </div>
</body>
</html>`

  // ── Send via Resend ────────────────────────────────────────────────────
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to:   [user.email],
      subject: "You're approved — welcome to Class Builder",
      html,
    }),
  })

  if (!emailRes.ok) {
    const body = await emailRes.text()
    console.error('Resend error:', body)
    return new Response('Email delivery failed', { status: 500 })
  }

  console.log(`Approval email sent to ${user.email}`)
  return new Response('OK', { status: 200 })
})
