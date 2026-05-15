const SUPABASE_URL = 'https://dlqnzlwuzktcljxxxlit.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const FUNNEL_STEPS = [
  { key: 'session_start',        label: 'Entered Demo' },
  { key: 'import_excel',         label: 'Imported Data',    alt: 'import_sheets' },
  { key: 'field_mapping_applied',label: 'Mapped Fields' },
  { key: 'classes_generated',    label: 'Generated Classes' },
  { key: 'export_results',       label: 'Exported Results' },
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
db.auth.onAuthStateChange(async (event, session) => {
  if (session) {
    showDashboard(session.user.email);
    await loadDashboard();
  } else {
    showLogin();
  }
});

function showLogin() {
  document.getElementById('login-view').style.display = 'flex';
  document.getElementById('dashboard-view').style.display = 'none';
}

function showDashboard(email) {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('dashboard-view').style.display = 'block';
  document.getElementById('admin-email').textContent = email;
}

// ── Magic link ──
document.getElementById('magic-link-btn').addEventListener('click', async () => {
  const email = document.getElementById('email-input').value.trim();
  if (!email) return;
  const btn = document.getElementById('magic-link-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: 'https://cohortlogic.com/admin/' },
  });

  if (error) {
    showLoginAlert(error.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Send Sign-In Link';
  } else {
    showLoginAlert(`Link sent to ${email} — check your inbox and click the link to sign in.`, 'success');
    btn.textContent = 'Link Sent';
  }
});

document.getElementById('email-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('magic-link-btn').click();
});

function showLoginAlert(msg, type) {
  const el = document.getElementById('login-alert');
  el.textContent = msg;
  el.className = `alert alert-${type}`;
  el.classList.remove('hidden');
}

// ── Logout ──
document.getElementById('logout-btn').addEventListener('click', async () => {
  await db.auth.signOut();
  // Force a clean reload to clear any session tokens from the URL hash
  window.location.replace(window.location.pathname);
});

// ── Change password ──
document.getElementById('change-pw-btn').addEventListener('click', () => {
  document.getElementById('change-pw-section').classList.remove('hidden');
  document.getElementById('change-pw-section').scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('cancel-pw-btn').addEventListener('click', () => {
  document.getElementById('change-pw-section').classList.add('hidden');
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-confirm').value = '';
});

document.getElementById('save-pw-btn').addEventListener('click', async () => {
  const pw1 = document.getElementById('pw-new').value;
  const pw2 = document.getElementById('pw-confirm').value;
  const alertEl = document.getElementById('pw-alert');

  if (pw1.length < 8) {
    alertEl.textContent = 'Password must be at least 8 characters.';
    alertEl.className = 'alert alert-error';
    alertEl.classList.remove('hidden');
    return;
  }
  if (pw1 !== pw2) {
    alertEl.textContent = 'Passwords do not match.';
    alertEl.className = 'alert alert-error';
    alertEl.classList.remove('hidden');
    return;
  }

  const { error } = await db.auth.updateUser({ password: pw1 });
  if (error) {
    alertEl.textContent = error.message;
    alertEl.className = 'alert alert-error';
    alertEl.classList.remove('hidden');
  } else {
    alertEl.textContent = 'Password updated successfully.';
    alertEl.className = 'alert alert-success';
    alertEl.classList.remove('hidden');
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
  }
});

// ── Dashboard data ──
async function loadDashboard() {
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
  const now      = new Date();
  const weekAgo  = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const weekSess = sessions.filter(s => new Date(s.created_at) >= weekAgo).length;
  const exports  = new Set(events.filter(e => e.event_name === 'export_results').map(e => e.session_token)).size;

  document.getElementById('stat-total-sessions').textContent = sessions.length;
  document.getElementById('stat-week-sessions').textContent  = weekSess;
  document.getElementById('stat-total-events').textContent   = events.length;
  document.getElementById('stat-exports').textContent        = exports;
}

function renderFunnel(sessions, events) {
  const totalSessions = sessions.length;
  if (!totalSessions) {
    document.getElementById('funnel-chart').innerHTML = '<p style="color:#9ca3af;font-size:13px;">No session data yet.</p>';
    return;
  }

  // For each step, count unique session_tokens that have that event
  const html = FUNNEL_STEPS.map((step, i) => {
    let count;
    if (i === 0) {
      count = totalSessions;
    } else {
      const tokens = new Set(
        events
          .filter(e => e.event_name === step.key || e.event_name === (step.alt || ''))
          .map(e => e.session_token)
      );
      count = tokens.size;
    }
    const pct = totalSessions ? Math.round((count / totalSessions) * 100) : 0;
    return `
      <div class="funnel-step">
        <div class="funnel-label">${step.label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${pct}%">
            ${count > 0 ? `<span class="funnel-count">${count}</span>` : ''}
          </div>
        </div>
        <div class="funnel-pct">${pct}%</div>
      </div>
    `;
  }).join('');

  document.getElementById('funnel-chart').innerHTML = html;
}

function renderFeatureUsage(events) {
  const counts = {};
  events.forEach(e => {
    counts[e.event_name] = (counts[e.event_name] || 0) + 1;
  });

  if (!Object.keys(counts).length) {
    document.getElementById('feature-usage').innerHTML = '<p style="color:#9ca3af;font-size:13px;">No events tracked yet.</p>';
    return;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = sorted[0][1];

  const html = sorted.map(([name, count]) => {
    const label = EVENT_LABELS[name] || name;
    const pct   = Math.round((count / max) * 100);
    return `
      <div class="funnel-step">
        <div class="funnel-label">${label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${pct}%;background:#8b5cf6">
            ${count > 0 ? `<span class="funnel-count">${count}</span>` : ''}
          </div>
        </div>
        <div class="funnel-pct">${count}×</div>
      </div>
    `;
  }).join('');

  document.getElementById('feature-usage').innerHTML = html;
}

function renderRecentSessions(sessions, events) {
  const tbody = document.getElementById('sessions-tbody');
  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-row">No sessions yet.</td></tr>';
    return;
  }

  // Group events by session_token
  const bySession = {};
  events.forEach(e => {
    if (!bySession[e.session_token]) bySession[e.session_token] = [];
    bySession[e.session_token].push(e);
  });

  tbody.innerHTML = sessions.slice(0, 50).map(s => {
    const date   = new Date(s.created_at);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const evts   = bySession[s.session_token] || [];
    const chips  = [...new Set(evts.map(e => e.event_name))]
      .map(n => `<span class="event-chip">${EVENT_LABELS[n] || n}</span>`)
      .join('');
    const ua     = parseUA(s.user_agent || '');

    return `
      <tr>
        <td>${dateStr}<br><span class="ua-text">${timeStr}</span></td>
        <td>${chips || '<span style="color:#9ca3af">No actions recorded</span>'}</td>
        <td><span class="ua-text">${ua}</span></td>
      </tr>
    `;
  }).join('');
}

function parseUA(ua) {
  let browser = 'Unknown browser';
  if (ua.includes('Chrome') && !ua.includes('Edg'))  browser = 'Chrome';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Firefox'))  browser = 'Firefox';
  else if (ua.includes('Edg'))      browser = 'Edge';

  let os = '';
  if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Mac'))     os = 'Mac';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Android')) os = 'Android';

  return [browser, os].filter(Boolean).join(' · ');
}
