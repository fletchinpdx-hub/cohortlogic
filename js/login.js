document.addEventListener('DOMContentLoaded', () => {
  const errorEl    = document.getElementById('auth-error');
  const loginForm  = document.getElementById('login-form');
  const forgotForm = document.getElementById('forgot-form');
  const resetForm  = document.getElementById('reset-form');
  const footerLinks = document.getElementById('auth-footer-links');

  function showForm(which, titleText, subtitleText) {
    loginForm.classList.add('hidden');
    forgotForm.classList.add('hidden');
    resetForm.classList.add('hidden');
    which.classList.remove('hidden');
    document.querySelector('h1').textContent = titleText || 'Sign in';
    document.querySelector('.auth-subtitle').textContent = subtitleText || '';
    errorEl.classList.remove('visible');
  }

  // Check URL hash immediately for recovery token
  // Supabase puts #access_token=...&type=recovery in the URL when reset link is clicked
  const hashParams = new URLSearchParams(window.location.hash.replace('#', ''));
  const isRecovery = hashParams.get('type') === 'recovery';

  if (isRecovery) {
    showForm(resetForm, 'Set new password', 'Choose a new password for your account.');
    footerLinks.classList.add('hidden');
  } else {
    // Only redirect if already logged in (normal visit, not recovery)
    (async () => {
      const { data: { session } } = await SupabaseClient.auth.getSession();
      if (session) window.location.href = 'dashboard.html';
    })();
  }

  // Belt-and-suspenders: also catch the auth state change event
  SupabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      showForm(resetForm, 'Set new password', 'Choose a new password for your account.');
      footerLinks.classList.add('hidden');
    }
  });

  // ── Sign in ──
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-btn');
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    btn.disabled = true; btn.textContent = 'Signing in…';
    errorEl.classList.remove('visible');

    const { error } = await SupabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = error.message === 'Invalid login credentials'
        ? 'Incorrect email or password. Please try again.' : error.message;
      errorEl.classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Sign in <span class="arrow">→</span>';
      return;
    }
    window.location.href = 'dashboard.html';
  });

  // ── Forgot password ──
  document.getElementById('forgot-link').addEventListener('click', (e) => {
    e.preventDefault();
    showForm(forgotForm, 'Reset password', 'Enter your email and we\'ll send a reset link.');
  });

  document.getElementById('back-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    showForm(loginForm, 'Sign in', 'Welcome back. Enter your email and password.');
  });

  forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('reset-btn');
    const email = document.getElementById('reset-email').value.trim();
    btn.disabled = true; btn.textContent = 'Sending…';
    errorEl.classList.remove('visible');

    const { error } = await SupabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://cohortlogic.com/login.html',
    });

    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Send reset link <span class="arrow">→</span>';
      return;
    }

    btn.textContent = '✓ Email sent';
    document.querySelector('.auth-subtitle').textContent =
      'Check your inbox for a reset link. You can close this tab.';
  });

  // ── Set new password ──
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn  = document.getElementById('set-pwd-btn');
    const pwd  = document.getElementById('new-password').value;
    const pwd2 = document.getElementById('confirm-password').value;
    errorEl.classList.remove('visible');

    if (pwd.length < 8) {
      errorEl.textContent = 'Password must be at least 8 characters.';
      errorEl.classList.add('visible'); return;
    }
    if (pwd !== pwd2) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.classList.add('visible'); return;
    }

    btn.disabled = true; btn.textContent = 'Saving…';
    const { error } = await SupabaseClient.auth.updateUser({ password: pwd });

    if (error) {
      errorEl.textContent = error.message;
      errorEl.classList.add('visible');
      btn.disabled = false;
      btn.innerHTML = 'Set new password <span class="arrow">→</span>';
      return;
    }

    window.location.href = 'dashboard.html';
  });
});
