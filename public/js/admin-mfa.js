// ═══════════════════════════════════════════════════════════════════════
// Shared MFA (TOTP) gate + enrollment for the admin panels.
// Loaded by admin/index.html and school-admin/index.html before their panel
// script. Exposes window.AdminMFA.
//
//   AdminMFA.gate(db)            → resolves 'ok' once the session is aal2 (or
//                                  MFA isn't required); when a factor exists but
//                                  the session is aal1, shows a BLOCKING TOTP
//                                  challenge and only resolves after verify.
//                                  Resolves 'enroll-optional' when no factor is
//                                  enrolled (caller may show the reminder).
//   AdminMFA.showEnrollReminder(db) → persistent banner + QR enrollment flow.
//
// Safety: fails OPEN on genuine SDK/network errors (returns 'ok') so a Supabase
// hiccup can never lock an admin out of their own panel. It stays STRICT in the
// normal enrolled-but-unverified state. Tighten to fail-closed once MFA is proven.
// ═══════════════════════════════════════════════════════════════════════

window.AdminMFA = (function () {
  const NAVY = '#1e3a5f', TEAL = '#2a9d8f', RED = '#ef4444';

  function node(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }

  async function signOutAndReload(db) {
    try { await db.auth.signOut({ scope: 'global' }); } catch (e) {}
    localStorage.clear(); sessionStorage.clear();
    window.location.href = window.location.href.split('#')[0];
  }

  async function getAAL(db) {
    try {
      const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw error;
      return data; // { currentLevel, nextLevel }
    } catch (e) {
      console.error('MFA AAL check failed (failing open):', e);
      return null;
    }
  }

  async function firstTotpFactor(db) {
    const { data, error } = await db.auth.mfa.listFactors();
    if (error) throw error;
    const totp = (data && data.totp) || [];
    return totp.find(f => f.status === 'verified') || totp[0] || null;
  }

  // ── Blocking TOTP challenge ─────────────────────────────────────────────
  function showChallenge(db) {
    return new Promise((resolve) => {
      if (document.getElementById('mfa-overlay')) return; // already shown
      const overlay = node(`
        <div id="mfa-overlay" style="position:fixed;inset:0;background:#f8fafc;z-index:10001;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Nunito,sans-serif;">
          <div style="max-width:400px;width:100%;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.06);text-align:center;">
            <div style="font-size:36px;margin-bottom:8px;">🔐</div>
            <h1 style="font-size:19px;color:${NAVY};margin:0 0 6px;">Two-factor authentication</h1>
            <p style="font-size:14px;color:#6b7280;margin:0 0 18px;">Enter the 6-digit code from your authenticator app.</p>
            <div id="mfa-alert" style="display:none;font-size:13px;color:${RED};margin-bottom:12px;"></div>
            <input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
                   placeholder="123456"
                   style="width:100%;box-sizing:border-box;text-align:center;letter-spacing:6px;font-size:22px;padding:12px;border:1px solid #d1d5db;border-radius:9px;font-family:inherit;outline:none;margin-bottom:14px;" />
            <button id="mfa-verify-btn" style="width:100%;background:${TEAL};color:#fff;border:none;padding:12px;border-radius:9px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">Verify</button>
            <button id="mfa-signout-btn" style="margin-top:12px;background:none;border:none;color:#6b7280;font-size:13px;text-decoration:underline;cursor:pointer;font-family:inherit;">Sign out</button>
          </div>
        </div>`);
      document.body.appendChild(overlay);

      const codeEl  = overlay.querySelector('#mfa-code');
      const btn     = overlay.querySelector('#mfa-verify-btn');
      const alertEl = overlay.querySelector('#mfa-alert');
      const setAlert = m => { alertEl.textContent = m; alertEl.style.display = m ? 'block' : 'none'; };
      codeEl.focus();

      const verify = async () => {
        const code = codeEl.value.trim();
        if (!/^\d{6}$/.test(code)) { setAlert('Enter the 6-digit code.'); return; }
        btn.disabled = true; btn.textContent = 'Verifying…'; setAlert('');
        try {
          const factor = await firstTotpFactor(db);
          if (!factor) throw new Error('No authenticator is set up on this account.');
          const { error } = await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
          if (error) throw error;
          overlay.remove();
          resolve('ok');
        } catch (e) {
          setAlert(e.message || 'That code was not valid. Try again.');
          btn.disabled = false; btn.textContent = 'Verify';
          codeEl.select();
        }
      };

      btn.addEventListener('click', verify);
      codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') verify(); });
      overlay.querySelector('#mfa-signout-btn').addEventListener('click', () => signOutAndReload(db));
    });
  }

  // ── Enrollment ──────────────────────────────────────────────────────────
  async function startEnroll(db) {
    if (document.getElementById('mfa-enroll-overlay')) return;

    let factorId = null;
    const overlay = node(`
      <div id="mfa-enroll-overlay" style="position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10002;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Nunito,sans-serif;">
        <div style="max-width:420px;width:100%;background:#fff;border-radius:14px;padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.25);">
          <h1 style="font-size:19px;color:${NAVY};margin:0 0 6px;">Set up two-factor authentication</h1>
          <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">Scan this with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
          <div id="mfa-enroll-body" style="text-align:center;color:#6b7280;font-size:13px;padding:20px;">Loading…</div>
          <div id="mfa-enroll-alert" style="display:none;font-size:13px;color:${RED};margin:10px 0;"></div>
          <div style="display:flex;gap:8px;margin-top:16px;">
            <button id="mfa-enroll-verify" style="flex:1;background:${TEAL};color:#fff;border:none;padding:11px;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;" disabled>Verify &amp; enable</button>
            <button id="mfa-enroll-cancel" style="background:#fff;border:1px solid #e5e7eb;color:#374151;padding:11px 16px;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(overlay);

    const body    = overlay.querySelector('#mfa-enroll-body');
    const verifyB = overlay.querySelector('#mfa-enroll-verify');
    const cancelB = overlay.querySelector('#mfa-enroll-cancel');
    const alertEl = overlay.querySelector('#mfa-enroll-alert');
    const setAlert = m => { alertEl.textContent = m; alertEl.style.display = m ? 'block' : 'none'; };

    const cleanup = async (unenroll) => {
      if (unenroll && factorId) { try { await db.auth.mfa.unenroll({ factorId }); } catch (e) {} }
      overlay.remove();
    };
    cancelB.addEventListener('click', () => cleanup(true));

    try {
      // A stale unverified factor blocks re-enroll; clear any before enrolling.
      const { data: existing } = await db.auth.mfa.listFactors();
      for (const f of ((existing && existing.totp) || [])) {
        if (f.status !== 'verified') { try { await db.auth.mfa.unenroll({ factorId: f.id }); } catch (e) {} }
      }

      const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + Date.now() });
      if (error) throw error;
      factorId = data.id;

      const qr = data.totp && data.totp.qr_code ? data.totp.qr_code : '';
      const secret = (data.totp && data.totp.secret) || '';
      const qrHtml = qr.trim().startsWith('<svg')
        ? `<div style="width:200px;height:200px;margin:0 auto;">${qr}</div>`
        : `<img src="${qr}" alt="QR code" style="width:200px;height:200px;" />`;
      body.innerHTML = `
        ${qrHtml}
        <div style="margin-top:12px;font-size:12px;color:#9ca3af;">Can't scan? Enter this key manually:</div>
        <code style="display:inline-block;margin:6px 0 14px;font-size:13px;background:#f3f4f6;padding:4px 8px;border-radius:6px;word-break:break-all;">${secret}</code>
        <input id="mfa-enroll-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"
               style="width:100%;box-sizing:border-box;text-align:center;letter-spacing:6px;font-size:20px;padding:11px;border:1px solid #d1d5db;border-radius:9px;font-family:inherit;outline:none;" />`;
      verifyB.disabled = false;
      const codeEl = overlay.querySelector('#mfa-enroll-code');
      codeEl.focus();

      const doVerify = async () => {
        const code = codeEl.value.trim();
        if (!/^\d{6}$/.test(code)) { setAlert('Enter the 6-digit code.'); return; }
        verifyB.disabled = true; verifyB.textContent = 'Verifying…'; setAlert('');
        try {
          const { error: vErr } = await db.auth.mfa.challengeAndVerify({ factorId, code });
          if (vErr) throw vErr;
          // Verified → session is now aal2. Reload so the gate re-runs cleanly.
          overlay.remove();
          const banner = document.getElementById('mfa-reminder');
          if (banner) banner.remove();
          window.location.reload();
        } catch (e) {
          setAlert(e.message || 'That code was not valid. Try again.');
          verifyB.disabled = false; verifyB.textContent = 'Verify & enable';
          codeEl.select();
        }
      };
      verifyB.addEventListener('click', doVerify);
      codeEl.addEventListener('keydown', e => { if (e.key === 'Enter') doVerify(); });
    } catch (e) {
      body.textContent = '';
      setAlert(e.message || 'Could not start enrollment. Check that MFA is enabled for this project.');
    }
  }

  function showEnrollReminder(db) {
    if (document.getElementById('mfa-reminder')) return;
    const banner = node(`
      <div id="mfa-reminder" style="position:fixed;top:0;left:0;right:0;z-index:9998;background:${NAVY};color:#fff;font-family:Nunito,sans-serif;
                  display:flex;align-items:center;justify-content:center;gap:14px;padding:10px 16px;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.15);flex-wrap:wrap;">
        <span>🔒 Protect this account — set up two-factor authentication.</span>
        <button id="mfa-reminder-enroll" style="background:${TEAL};border:none;color:#fff;padding:6px 14px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">Enable 2FA</button>
        <button id="mfa-reminder-later" style="background:none;border:none;color:#cbd5e1;font-size:13px;text-decoration:underline;cursor:pointer;font-family:inherit;">Later</button>
      </div>`);
    document.body.appendChild(banner);
    banner.querySelector('#mfa-reminder-enroll').addEventListener('click', () => startEnroll(db));
    banner.querySelector('#mfa-reminder-later').addEventListener('click', () => banner.remove());
  }

  async function gate(db) {
    const aal = await getAAL(db);
    if (!aal) return 'ok';                          // fail-open on error
    if (aal.currentLevel === 'aal2') return 'ok';   // already verified
    if (aal.nextLevel === 'aal2') {                 // factor enrolled, not verified this session
      await showChallenge(db);
      return 'ok';
    }
    return 'enroll-optional';                        // no factor enrolled
  }

  return { gate, showEnrollReminder };
})();
