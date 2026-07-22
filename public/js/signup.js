// Personal / free email providers aren't accepted — Cohort Logic is for school staff.
// This is a front-door deterrent + clear messaging; every signup still requires manual
// approval, which is the real (server-side) gate.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'protonmail.com', 'proton.me', 'pm.me', 'gmx.com', 'gmx.us', 'mail.com',
  'zoho.com', 'yandex.com', 'yandex.ru', 'tutanota.com', 'hey.com',
  'fastmail.com', 'duck.com', 'hushmail.com', 'inbox.com', 'yopmail.com',
]);
function isAllowedEmailDomain(email) {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain || !domain.includes('.')) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}

document.addEventListener('DOMContentLoaded', () => {
  // ── Password strength indicator ──
  document.getElementById('password').addEventListener('input', function () {
    const pw  = this.value;
    const bar = document.getElementById('pw-bar');
    const lbl = document.getElementById('pw-label');
    if (!pw) { bar.style.width = '0'; lbl.textContent = ''; return; }
    let score = 0;
    if (pw.length >= 8)           score++;
    if (pw.length >= 12)          score++;
    if (/[0-9]/.test(pw))         score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    const cfg = [
      { w: '20%',  bg: '#ef4444', text: 'Too short' },
      { w: '40%',  bg: '#f97316', text: 'Weak' },
      { w: '65%',  bg: '#eab308', text: 'Fair' },
      { w: '85%',  bg: '#22c55e', text: 'Good' },
      { w: '100%', bg: '#16a34a', text: 'Strong' },
    ][Math.min(score, 4)];
    bar.style.width      = cfg.w;
    bar.style.background = cfg.bg;
    lbl.style.color      = cfg.bg;
    lbl.textContent      = cfg.text;
  });

  // ── Sign up form ──
  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn       = document.getElementById('submit-btn');
    const errorEl   = document.getElementById('auth-error');
    const successEl = document.getElementById('auth-success');
    const fullName   = document.getElementById('full-name').value.trim();
    const email      = document.getElementById('email').value.trim();
    const schoolName = document.getElementById('school-name').value.trim();
    const password   = document.getElementById('password').value;
    const betaAgreed = document.getElementById('beta-agree').checked;

    errorEl.classList.remove('visible');
    successEl.classList.remove('visible');

    if (!fullName || !email || !schoolName) {
      errorEl.textContent = 'Please fill in all fields.';
      errorEl.classList.add('visible');
      return;
    }
    if (!isAllowedEmailDomain(email)) {
      errorEl.textContent = 'Please use your school or district email address. Personal accounts (Gmail, Yahoo, Outlook, iCloud, etc.) aren’t accepted.';
      errorEl.classList.add('visible');
      return;
    }
    if (password.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.classList.add('visible');
      return;
    }
    if (!betaAgreed) {
      errorEl.textContent = 'Please agree to the Beta Agreement to continue.';
      errorEl.classList.add('visible');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account…';

    // Create Supabase auth user — profile is auto-created by DB trigger
    const { data, error } = await SupabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName, school_name: schoolName, beta_agreement_version: '1.0' },
        emailRedirectTo: 'https://cohortlogic.com/login.html',
      }
    });

    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Create account <span class="arrow">→</span>';
      return;
    }

    // Show two-step pending message
    document.getElementById('signup-form').style.display = 'none';
    successEl.innerHTML = `
      <div class="pending-card">
        <div class="pending-icon">📬</div>
        <strong style="font-size:16px;color:var(--navy-deep);">One more step — check your email</strong>
        <p style="color:var(--text-2);">We sent a confirmation link to <strong>${email}</strong>. Click it to verify your address.</p>
        <p style="color:var(--text-2);margin-top:8px;">Once verified, your account will be reviewed for approval. When approved, you'll be able to sign in at <a href="login.html" style="color:var(--teal-deep);">cohortlogic.com/login</a>.</p>
        <p style="font-size:13px;color:var(--text-3);margin-top:10px;">Didn't get it? Check your spam folder.</p>
      </div>
    `;
    successEl.classList.add('visible');
  });
});
