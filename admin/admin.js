const SUPABASE_URL = 'https://dlqnzlwuzktcljxxxlit.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe';

let db;
try {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.error('Supabase init failed:', e);
}

const FUNNEL_STEPS = [
  { key: 'session_start',         label: 'Entered Demo' },
  { key: 'import_excel',          label: 'Imported Data', alt: 'import_sheets' },
  { key: 'field_mapping_applied', label: 'Mapped Fields' },
  { key: 'classes_generated',     label: 'Generated Classes' },
  { key: 'export_results',        label: 'Exported Results' },
];

const EVENT_LABELS = {
  session_start:         'Entered Demo',
  sample_downloaded:     'Downloaded Sample',
  import_excel:          'Imported Excel',
  import_sheets:         'Imported Google Sheet',
  field_mapping_applied: 'Applied Field Mapping',
  separation_added:      'Added Separation Rule',
  classes_generated:     'Generated Classes',
  student_moved:         'Moved Student',
  export_results:        'Exported Results',
};

// ── Auth state ──
if (db) {
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      // User clicked a password reset link — show dashboard then open change-password
      showDashboard(session.user.email);
      await loadDashboard();
      const section = document.getElementById('change-pw-section');
      section.classList.remove('hidden');
      section.scrollIntoView({ behavior: 'smooth' });
    } else if (session) {
      showDashboard(session.user.email);
      await loadDashboard();
    } else {
      showLogin();
    }
  });
}

function showLogin() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('dashboard-view').style.display = 'none';
}

function showDashboard(email) {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'block';
  document.getElementById('admin-email').textContent = email;
}

function showLoginAlert(msg, type) {
  const el = document.getElementById('login-alert');
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
}

// ── Password sign in ──
document.getElementById('signin-btn').addEventListener('click', async () => {
  const email    = document.getElementById('email-input').value.trim();
  const password = document.getElementById('password-input').value;
  if (!email || !password) { showLoginAlert('Please enter your email and password.', 'error'); return; }
  const btn = document.getElementById('signin-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    showLoginAlert('Incorrect email or password.', 'error');
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

document.getElementById('password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('signin-btn').click();
});

// ── Forgot password toggle (global so onclick attribute works in all browsers) ──
let magicLinkVisible = false;
function toggleMagicLink() {
  magicLinkVisible = !magicLinkVisible;
  document.getElementById('magic-link-section').style.display = magicLinkVisible ? 'block' : 'none';
}

// ── Magic link ──
document.getElementById('magic-link-btn').addEventListener('click', async () => {
  const email = document.getElementById('email-input').value.trim();
  if (!email) { showLoginAlert('Enter your email above first.', 'error'); return; }
  const btn = document.getElementById('magic-link-btn');
  btn.disabled = true; btn.textContent = 'Sending…';
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://cohortlogic.com/admin/',
  });
  if (error) {
    showLoginAlert(error.message, 'error');
    btn.disabled = false; btn.textContent = 'Send Sign-In Link';
  } else {
    showLoginAlert(`Link sent to ${email} — check your inbox.`, 'success');
    btn.textContent = 'Link Sent';
  }
});

// ── Logout ──
async function doLogout() {
  try { await db.auth.signOut({ scope: 'global' }); } catch(e) {}
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = window.location.href.split('#')[0];
}
document.getElementById('logout-btn').addEventListener('click', doLogout);

// ── Change password ──
document.getElementById('change-pw-btn').addEventListener('click', () => {
  const section = document.getElementById('change-pw-section');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('cancel-pw-btn').addEventListener('click', () => {
  document.getElementById('change-pw-section').classList.add('hidden');
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-confirm').value = '';
});

document.getElementById('save-pw-btn').addEventListener('click', async () => {
  const pw1     = document.getElementById('pw-new').value;
  const pw2     = document.getElementById('pw-confirm').value;
  const alertEl = document.getElementById('pw-alert');
  if (pw1.length < 8) {
    alertEl.textContent = 'Password must be at least 8 characters.';
    alertEl.className = 'alert alert-error'; alertEl.classList.remove('hidden'); return;
  }
  if (pw1 !== pw2) {
    alertEl.textContent = 'Passwords do not match.';
    alertEl.className = 'alert alert-error'; alertEl.classList.remove('hidden'); return;
  }
  const { error } = await db.auth.updateUser({ password: pw1 });
  alertEl.textContent = error ? error.message : 'Password updated successfully.';
  alertEl.className   = error ? 'alert alert-error' : 'alert alert-success';
  alertEl.classList.remove('hidden');
  if (!error) { document.getElementById('pw-new').value = ''; document.getElementById('pw-confirm').value = ''; }
});

// ── Schools ──────────────────────────────────────────────────────────────

let _schools = [];  // cached list for selects

async function loadSchools() {
  const container = document.getElementById('schools-list');
  const { data, error } = await db.from('schools').select('*').order('name');
  if (error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load schools: ${error.message}</p>`;
    return;
  }
  _schools = data || [];
  if (!_schools.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No schools yet. Add one below.</p>';
    return;
  }
  container.innerHTML = _schools.map(s => `
    <div class="school-row">
      <div>
        <div class="school-name">${escAdmin(s.name)}</div>
        <div class="school-meta">${[s.district, s.state].filter(Boolean).join(' · ') || 'No district / state set'}</div>
      </div>
      <span style="font-family:monospace;font-size:11px;color:#9ca3af;">${s.id.slice(0,8)}…</span>
    </div>
  `).join('');
}

async function addSchool() {
  const name     = document.getElementById('new-school-name').value.trim();
  const district = document.getElementById('new-school-district').value.trim();
  const state    = document.getElementById('new-school-state').value.trim();
  const alertEl  = document.getElementById('school-alert');

  if (!name) {
    alertEl.textContent = 'School name is required.';
    alertEl.className = 'alert alert-error';
    alertEl.classList.remove('hidden');
    return;
  }

  const { data, error } = await db.from('schools')
    .insert({ name, district: district || null, state: state || null })
    .select().single();

  if (error) {
    alertEl.textContent = 'Error: ' + error.message;
    alertEl.className = 'alert alert-error';
    alertEl.classList.remove('hidden');
    return;
  }

  alertEl.textContent = `"${name}" added.`;
  alertEl.className = 'alert alert-success';
  alertEl.classList.remove('hidden');
  setTimeout(() => alertEl.classList.add('hidden'), 3000);

  document.getElementById('new-school-name').value     = '';
  document.getElementById('new-school-district').value = '';
  document.getElementById('new-school-state').value    = '';
  await loadSchools();
}

function escAdmin(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Pending users (with school assignment) ───────────────────────────────

async function loadPendingUsers() {
  const container = document.getElementById('pending-users-list');
  const badge     = document.getElementById('pending-badge');

  const { data: pending, error } = await db
    .from('profiles')
    .select('id, full_name, school_name, created_at')
    .eq('approved', false)
    .order('created_at', { ascending: true });

  if (error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load pending users.</p>`;
    return;
  }

  if (!pending || !pending.length) {
    badge.style.display = 'none';
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No pending users. All accounts are approved.</p>';
    return;
  }

  badge.textContent = pending.length;
  badge.style.display = 'inline';

  const schoolOptions = _schools.map(s =>
    `<option value="${s.id}">${escAdmin(s.name)}</option>`
  ).join('');

  container.innerHTML = pending.map(u => {
    const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    // Try to find a matching school by name for pre-selection
    const matchedSchool = _schools.find(s =>
      s.name.toLowerCase() === (u.school_name || '').toLowerCase()
    );
    const selectedVal = matchedSchool ? matchedSchool.id : '';
    return `
      <div class="pending-row" id="row-${u.id}">
        <div class="pending-info">
          <strong>${escAdmin(u.full_name || '(no name)')}</strong>
          <div class="meta">${escAdmin(u.school_name || 'No school listed')} · Signed up ${date}</div>
          <div class="pending-school-row">
            <label style="font-size:12px;color:#6b7280;">Assign to school:</label>
            <select class="school-sel" id="school-sel-${u.id}">
              <option value="">— None / create below —</option>
              ${schoolOptions}
            </select>
            ${selectedVal ? `<script>document.getElementById('school-sel-${u.id}').value='${selectedVal}';<\/script>` : ''}
          </div>
        </div>
        <button class="approve-btn" onclick="approveUser('${u.id}')">Approve</button>
      </div>
    `;
  }).join('');

  // Pre-select matched schools after DOM is ready
  pending.forEach(u => {
    const matchedSchool = _schools.find(s =>
      s.name.toLowerCase() === (u.school_name || '').toLowerCase()
    );
    if (matchedSchool) {
      const sel = document.getElementById(`school-sel-${u.id}`);
      if (sel) sel.value = matchedSchool.id;
    }
  });
}

async function approveUser(userId) {
  const btn      = document.querySelector(`#row-${userId} .approve-btn`);
  const schoolSel = document.getElementById(`school-sel-${userId}`);
  const schoolId  = schoolSel ? (schoolSel.value || null) : null;

  if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }

  const { error } = await db
    .from('profiles')
    .update({ approved: true, school_id: schoolId })
    .eq('id', userId);

  if (error) {
    alert('Error approving user: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Approve'; }
    return;
  }

  const row = document.getElementById(`row-${userId}`);
  if (row) row.remove();
  const remaining = document.querySelectorAll('.pending-row').length;
  const badge = document.getElementById('pending-badge');
  if (remaining === 0) {
    badge.style.display = 'none';
    document.getElementById('pending-users-list').innerHTML =
      '<p style="color:#9ca3af;font-size:13px;">No pending users. All accounts are approved.</p>';
  } else {
    badge.textContent = remaining;
  }
}

// ── Dashboard data ──
async function loadDashboard() {
  await loadSchools();      // load schools first so approval dropdowns are populated
  loadPendingUsers();
  const [sessionsRes, eventsRes] = await Promise.all([
    db.from('sessions').select('*').order('created_at', { ascending: false }),
    db.from('events').select('*').order('created_at', { ascending: false }),
  ]);
  const sessions = sessionsRes.data || [];
  const events   = eventsRes.data  || [];
  renderStats(sessions, events);
  renderFunnel(sessions, events);
  renderFeatureUsage(events);
  renderRecentSessions(sessions, events);
}

function renderStats(sessions, events) {
  const weekAgo  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekSess = sessions.filter(s => new Date(s.created_at) >= weekAgo).length;
  const exports  = new Set(events.filter(e => e.event_name === 'export_results').map(e => e.session_token)).size;
  document.getElementById('stat-total-sessions').textContent = sessions.length;
  document.getElementById('stat-week-sessions').textContent  = weekSess;
  document.getElementById('stat-total-events').textContent   = events.length;
  document.getElementById('stat-exports').textContent        = exports;
}

function renderFunnel(sessions, events) {
  const total = sessions.length;
  if (!total) {
    document.getElementById('funnel-chart').innerHTML = '<p style="color:#9ca3af;font-size:13px;">No session data yet.</p>';
    return;
  }
  document.getElementById('funnel-chart').innerHTML = FUNNEL_STEPS.map((step, i) => {
    const count = i === 0 ? total : new Set(
      events.filter(e => e.event_name === step.key || e.event_name === (step.alt || ''))
            .map(e => e.session_token)
    ).size;
    const pct = Math.round((count / total) * 100);
    return `<div class="funnel-step">
      <div class="funnel-label">${step.label}</div>
      <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${pct}%">${count > 0 ? `<span class="funnel-count">${count}</span>` : ''}</div></div>
      <div class="funnel-pct">${pct}%</div>
    </div>`;
  }).join('');
}

function renderFeatureUsage(events) {
  const counts = {};
  events.forEach(e => { counts[e.event_name] = (counts[e.event_name] || 0) + 1; });
  if (!Object.keys(counts).length) {
    document.getElementById('feature-usage').innerHTML = '<p style="color:#9ca3af;font-size:13px;">No events tracked yet.</p>';
    return;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];
  document.getElementById('feature-usage').innerHTML = sorted.map(([name, count]) => {
    const pct = Math.round((count / max) * 100);
    return `<div class="funnel-step">
      <div class="funnel-label">${EVENT_LABELS[name] || name}</div>
      <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${pct}%;background:#8b5cf6">${count > 0 ? `<span class="funnel-count">${count}</span>` : ''}</div></div>
      <div class="funnel-pct">${count}×</div>
    </div>`;
  }).join('');
}

function renderRecentSessions(sessions, events) {
  const tbody = document.getElementById('sessions-tbody');
  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-row">No sessions yet.</td></tr>';
    return;
  }
  const bySession = {};
  events.forEach(e => {
    if (!bySession[e.session_token]) bySession[e.session_token] = [];
    bySession[e.session_token].push(e);
  });
  tbody.innerHTML = sessions.slice(0, 50).map(s => {
    const date    = new Date(s.created_at);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const evts    = bySession[s.session_token] || [];
    const chips   = [...new Set(evts.map(e => e.event_name))]
      .map(n => `<span class="event-chip">${EVENT_LABELS[n] || n}</span>`).join('');
    return `<tr>
      <td>${dateStr}<br><span class="ua-text">${timeStr}</span></td>
      <td>${chips || '<span style="color:#9ca3af">No actions recorded</span>'}</td>
      <td><span class="ua-text">${parseUA(s.user_agent || '')}</span></td>
    </tr>`;
  }).join('');
}

function parseUA(ua) {
  let browser = 'Unknown';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Edg'))     browser = 'Edge';
  let os = '';
  if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Mac'))     os = 'Mac';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Android')) os = 'Android';
  return [browser, os].filter(Boolean).join(' · ');
}
