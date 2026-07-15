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
// ⚠️  DO NOT make this handler async or add await inside it.
//     Supabase cannot finish processing auth state while the handler is blocked.
//     The symptom is a silent login freeze on page refresh — no error, just hangs.
//     All async work must go in verifyAndLoad() below, called fire-and-forget.
if (db) {
  db.auth.onAuthStateChange((event, session) => {
    if (!session) { showLogin(); return; }
    verifyAndLoad(session, event); // fire-and-forget async work
  });
}

async function verifyAndLoad(session, event) {
  // Verify super-admin status before showing anything — don't rely on RLS alone.
  // Reads `role` (source of truth) rather than the legacy is_admin column.
  const { data: profile, error } = await db
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (error || profile?.role !== 'super_admin') {
    await db.auth.signOut();
    showLogin();
    showLoginAlert('Access denied. This panel is for administrators only.', 'error');
    return;
  }

  // Require MFA (aal2) when a factor is enrolled; otherwise allow + remind.
  const mfa = await AdminMFA.gate(db);

  showDashboard(session.user.email);
  loadDashboard();
  if (mfa === 'enroll-optional') AdminMFA.showEnrollReminder(db);

  if (event === 'PASSWORD_RECOVERY') {
    _pwRecoveryMode = true;          // recovery token authorizes the reset
    showCurrentPwField(false);       // user doesn't know their old password
    const section = document.getElementById('change-pw-section');
    section.classList.remove('hidden');
    section.scrollIntoView({ behavior: 'smooth' });
  }
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
document.getElementById('toggle-magic-link-btn').addEventListener('click', toggleMagicLink);

// ── Audit filters ──
document.getElementById('audit-table-filter').addEventListener('change', loadAuditLog);
document.getElementById('audit-action-filter').addEventListener('change', loadAuditLog);
document.getElementById('audit-from').addEventListener('change', loadAuditLog);
document.getElementById('audit-to').addEventListener('change', loadAuditLog);
document.getElementById('clear-audit-filters-btn').addEventListener('click', clearAuditFilters);

// ── Schools ──
document.getElementById('add-school-btn').addEventListener('click', addSchool);

// ── User search (Schools & Users tab) ──
document.getElementById('user-search-input').addEventListener('input', (e) => {
  renderUserSearch(e.target.value.trim());
});

// ── Audit detail modal ──
const _auditOverlay = document.getElementById('audit-detail-modal');
_auditOverlay.addEventListener('click', closeAuditModal);
_auditOverlay.querySelector('.audit-modal').addEventListener('click', e => e.stopPropagation());
_auditOverlay.querySelector('.audit-modal-close').addEventListener('click', closeAuditModal);

// ── Change password ──
// Recovery sessions (forgot-password link) authorize a password set WITHOUT the
// current password; a normal in-app change requires it (the Supabase project
// has "Require current password when updating" enabled).
let _pwRecoveryMode = false;

function showCurrentPwField(show) {
  const cur = document.getElementById('pw-current');
  if (cur) cur.style.display = show ? '' : 'none';
}

document.getElementById('change-pw-btn').addEventListener('click', () => {
  _pwRecoveryMode = false;
  showCurrentPwField(true);
  const section = document.getElementById('change-pw-section');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('cancel-pw-btn').addEventListener('click', () => {
  document.getElementById('change-pw-section').classList.add('hidden');
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-confirm').value = '';
});

document.getElementById('save-pw-btn').addEventListener('click', async () => {
  const pwCurrent = document.getElementById('pw-current').value;
  const pw1     = document.getElementById('pw-new').value;
  const pw2     = document.getElementById('pw-confirm').value;
  const alertEl = document.getElementById('pw-alert');
  const fail = (msg) => { alertEl.textContent = msg; alertEl.className = 'alert alert-error'; alertEl.classList.remove('hidden'); };

  if (pw1.length < 10)                  { fail('Password must be at least 10 characters.'); return; }
  if (pw1 !== pw2)                      { fail('Passwords do not match.'); return; }
  if (!_pwRecoveryMode && !pwCurrent)   { fail('Enter your current password.'); return; }

  const attrs = _pwRecoveryMode
    ? { password: pw1 }
    : { current_password: pwCurrent, password: pw1 };
  const { error } = await db.auth.updateUser(attrs);

  if (error) {
    fail(/current password|incorrect|invalid|wrong/i.test(error.message)
      ? 'Your current password is incorrect.'
      : error.message);
    return;
  }

  alertEl.textContent = 'Password updated successfully.';
  alertEl.className   = 'alert alert-success';
  alertEl.classList.remove('hidden');
  document.getElementById('pw-current').value = '';
  document.getElementById('pw-new').value = '';
  document.getElementById('pw-confirm').value = '';
  _pwRecoveryMode = false;
});

// ── Tab navigation / router ─────────────────────────────────────────────────

const ADMIN_VIEWS  = ['overview', 'approvals', 'schools', 'analytics', 'logs', 'feedback'];
const _loadedViews = new Set();

function gotoView(_, el) { showView(el.dataset.view); }

function showView(view) {
  if (!ADMIN_VIEWS.includes(view)) view = 'overview';
  document.querySelectorAll('.admin-view').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.remove('hidden');
  location.hash = view;
  loadViewData(view);
}

function loadViewData(view) {
  if (view === 'overview') { loadOverview(); return; } // always refresh — it's a live summary
  if (_loadedViews.has(view)) return;
  _loadedViews.add(view);
  switch (view) {
    case 'schools':   loadSchoolsAndUsers(); break;
    case 'analytics': loadAnalytics(); loadCicoStats(); break;
    case 'logs':      loadAuditLog();  loadErrors();    break;
    case 'feedback':  loadFeedback();  break;
    // 'approvals' is loaded eagerly in loadDashboard() so its tab badge is always current
  }
}

function gotoSubtab(_, el) {
  const group = el.dataset.group;
  const sub   = el.dataset.sub;
  document.querySelectorAll(`.subtab-btn[data-group="${group}"]`).forEach(b => b.classList.toggle('active', b === el));
  document.querySelectorAll(`.admin-subview[data-group="${group}"]`).forEach(v => v.classList.add('hidden'));
  const target = document.getElementById(`${group}-${sub}`);
  if (target) target.classList.remove('hidden');
}

// Overview attention cards can deep-link straight into a specific sub-tab.
function gotoSubtabView(_, el) {
  showView(el.dataset.view);
  const btn = document.querySelector(`.subtab-btn[data-group="${el.dataset.view}"][data-sub="${el.dataset.sub}"]`);
  if (btn) gotoSubtab(null, btn);
}

window.addEventListener('hashchange', () => {
  const v = location.hash.replace('#', '');
  if (ADMIN_VIEWS.includes(v)) showView(v);
});

// ── Overview ─────────────────────────────────────────────────────────────

async function loadOverview() {
  const attnEl  = document.getElementById('overview-attention');
  const statsEl = document.getElementById('overview-stats');
  attnEl.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Loading…</p>';

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [pendingRes, errorsRes, feedbackRes, schoolsRes, usersRes, cbSessionsRes, cicoWeekRes] = await Promise.all([
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('approved', false),
    db.from('error_logs').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    db.from('feedback').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    db.from('schools').select('id', { count: 'exact', head: true }),
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('approved', true),
    db.from('sessions').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    db.from('cico_checkins').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
  ]);

  const pending  = pendingRes.count  ?? 0;
  const errors7d = errorsRes.count   ?? 0;
  const fb7d     = feedbackRes.count ?? 0;

  attnEl.innerHTML = `
    <div class="attention-card ${pending ? 'attention-hot' : ''}" data-act="gotoView" data-view="approvals">
      <div class="attention-value">${pending}</div>
      <div class="attention-label">Pending approvals</div>
    </div>
    <div class="attention-card ${errors7d ? 'attention-warn' : ''}" data-act="gotoSubtabView" data-view="logs" data-sub="errors">
      <div class="attention-value">${errors7d}</div>
      <div class="attention-label">New errors (7d)</div>
    </div>
    <div class="attention-card" data-act="gotoView" data-view="feedback">
      <div class="attention-value">${fb7d}</div>
      <div class="attention-label">New feedback (7d)</div>
    </div>`;

  statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Schools</div><div class="stat-value">${schoolsRes.count ?? 0}</div></div>
    <div class="stat-card"><div class="stat-label">Active Users</div><div class="stat-value">${usersRes.count ?? 0}</div></div>
    <div class="stat-card"><div class="stat-label">CB Sessions (7d)</div><div class="stat-value">${cbSessionsRes.count ?? 0}</div></div>
    <div class="stat-card"><div class="stat-label">CICO Check-ins (7d)</div><div class="stat-value">${cicoWeekRes.count ?? 0}</div></div>`;
}

// ── Audit Log ────────────────────────────────────────────────────────────

const AUDIT_PAGE_SIZE = 50;
let _auditOffset      = 0;
let _auditRecords     = [];   // accumulated rows for current filter set
let _auditUserCache   = {};   // userId → display name

async function loadAuditLog(append = false) {
  const wrap      = document.getElementById('audit-log-wrap');
  const tableFilter  = document.getElementById('audit-table-filter').value;
  const actionFilter = document.getElementById('audit-action-filter').value;
  const fromDate     = document.getElementById('audit-from').value;
  const toDate       = document.getElementById('audit-to').value;

  if (!append) {
    _auditOffset  = 0;
    _auditRecords = [];
    wrap.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Loading…</p>';
  }

  let query = db
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(_auditOffset, _auditOffset + AUDIT_PAGE_SIZE - 1);

  if (tableFilter)  query = query.eq('table_name', tableFilter);
  if (actionFilter) query = query.eq('action', actionFilter);
  if (fromDate)     query = query.gte('created_at', fromDate);
  if (toDate)       query = query.lte('created_at', toDate + 'T23:59:59');

  const { data, error, count } = await query;

  if (error) {
    wrap.innerHTML = `<p style="color:#ef4444;font-size:13px;">Error: ${escAdmin(error.message)}</p>`;
    return;
  }

  if (!data?.length && !append) {
    wrap.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No audit records match the selected filters.</p>';
    return;
  }

  // Fetch user names for any new user_ids
  const unknownIds = [...new Set((data || []).map(r => r.user_id).filter(id => id && !_auditUserCache[id]))];
  if (unknownIds.length) {
    const { data: profiles } = await db
      .from('profiles')
      .select('id, full_name')
      .in('id', unknownIds);
    (profiles || []).forEach(p => {
      _auditUserCache[p.id] = p.full_name || '(no name)';
    });
  }

  _auditRecords = append ? [..._auditRecords, ...(data || [])] : (data || []);
  _auditOffset += (data?.length || 0);

  renderAuditTable(wrap, _auditRecords, count);
}

function renderAuditTable(wrap, records, totalCount) {
  if (!records.length) {
    wrap.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No records found.</p>';
    return;
  }

  const rows = records.map(r => {
    const ts       = new Date(r.created_at);
    const dateStr  = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr  = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    const userName = r.user_id ? (_auditUserCache[r.user_id] || r.user_id.slice(0,8) + '…') : 'System';
    const actionClass = { INSERT: 'action-insert', UPDATE: 'action-update', DELETE: 'action-delete' }[r.action] || '';
    const shortId  = r.record_id ? r.record_id.slice(0, 8) + '…' : '—';

    // Brief summary of what changed
    let summary = '';
    if (r.action === 'INSERT' && r.new_data) {
      const keys = Object.keys(r.new_data).filter(k => !['id','created_at','updated_at'].includes(k));
      summary = keys.slice(0, 3).join(', ') + (keys.length > 3 ? '…' : '');
    } else if (r.action === 'UPDATE' && r.old_data && r.new_data) {
      const changed = Object.keys(r.new_data).filter(k => JSON.stringify(r.new_data[k]) !== JSON.stringify(r.old_data[k]));
      summary = changed.length ? changed.slice(0, 3).join(', ') + (changed.length > 3 ? '…' : '') : 'no changes';
    } else if (r.action === 'DELETE' && r.old_data) {
      const keys = Object.keys(r.old_data).filter(k => !['id','created_at'].includes(k));
      summary = keys.slice(0, 3).join(', ') + (keys.length > 3 ? '…' : '');
    }

    return `<tr>
      <td style="white-space:nowrap;">
        ${escAdmin(dateStr)}<br>
        <span style="font-size:11px;color:#9ca3af;">${escAdmin(timeStr)}</span>
      </td>
      <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAdmin(r.user_id||'')}">
        ${escAdmin(userName)}
      </td>
      <td><span class="action-badge ${actionClass}">${r.action}</span></td>
      <td><span class="table-chip">${escAdmin(r.table_name)}</span></td>
      <td style="font-family:monospace;font-size:11px;color:#9ca3af;" title="${escAdmin(r.record_id||'')}">${escAdmin(shortId)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9ca3af;font-size:12px;">${escAdmin(summary)}</td>
      <td><button class="audit-detail-btn" data-act="openAuditDetail" data-id="${escAdmin(r.id)}">View</button></td>
    </tr>`;
  }).join('');

  const hasMore = totalCount !== null && _auditOffset < totalCount;

  wrap.innerHTML = `
    <div style="font-size:12px;color:#9ca3af;margin-bottom:10px;">
      Showing ${records.length}${totalCount !== null ? ' of ' + totalCount : ''} records
    </div>
    <div style="overflow-x:auto;">
      <table class="audit-table">
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Table</th>
            <th>Record ID</th>
            <th>Fields</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${hasMore ? `<button class="audit-load-more" data-act="auditLoadMore">Load more (${totalCount - _auditOffset} remaining)</button>` : ''}
  `;
}

function clearAuditFilters() {
  document.getElementById('audit-table-filter').value  = '';
  document.getElementById('audit-action-filter').value = '';
  document.getElementById('audit-from').value = '';
  document.getElementById('audit-to').value   = '';
  loadAuditLog();
}

// ── Audit detail modal ────────────────────────────────────────────────────

function openAuditDetail(id) {
  const record = _auditRecords.find(r => r.id === id);
  if (!record) return;

  const ts       = new Date(record.created_at);
  const dateStr  = ts.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  const timeStr  = ts.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', second:'2-digit' });
  const userName = record.user_id ? (_auditUserCache[record.user_id] || record.user_id) : 'System';
  const actionClass = { INSERT: 'action-insert', UPDATE: 'action-update', DELETE: 'action-delete' }[record.action] || '';

  document.getElementById('audit-modal-title').innerHTML =
    `<span class="action-badge ${actionClass}">${record.action}</span>
     <span style="font-size:13px;font-weight:400;color:#6b7280;margin-left:8px;">${escAdmin(record.table_name)}</span>`;

  let bodyHtml = `
    <div class="audit-meta-row">
      <div><strong>When:</strong> ${escAdmin(dateStr)} at ${escAdmin(timeStr)}</div>
      <div><strong>Who:</strong> ${escAdmin(userName)}</div>
      <div><strong>Record:</strong> <span style="font-family:monospace;font-size:12px;">${escAdmin(record.record_id || '—')}</span></div>
    </div>`;

  if (record.action === 'INSERT') {
    bodyHtml += `<div class="diff-panel insert">
      <h4>New Record</h4>
      <pre>${formatJson(record.new_data)}</pre>
    </div>`;
  } else if (record.action === 'DELETE') {
    bodyHtml += `<div class="diff-panel delete">
      <h4>Deleted Record</h4>
      <pre>${formatJson(record.old_data)}</pre>
    </div>`;
  } else if (record.action === 'UPDATE') {
    // Highlight changed fields
    const changed = record.old_data && record.new_data
      ? Object.keys(record.new_data).filter(k => JSON.stringify(record.new_data[k]) !== JSON.stringify(record.old_data[k]))
      : [];

    bodyHtml += `
      ${changed.length ? `<p style="font-size:12px;color:#6b7280;margin-bottom:12px;">Changed fields: <strong>${changed.map(escAdmin).join(', ')}</strong></p>` : ''}
      <div class="diff-grid">
        <div class="diff-panel delete">
          <h4>Before</h4>
          <pre>${formatJson(record.old_data, changed)}</pre>
        </div>
        <div class="diff-panel insert">
          <h4>After</h4>
          <pre>${formatJson(record.new_data, changed)}</pre>
        </div>
      </div>`;
  }

  document.getElementById('audit-modal-body').innerHTML = bodyHtml;
  document.getElementById('audit-detail-modal').style.display = 'flex';
}

function closeAuditModal(e) {
  if (e && e.target !== document.getElementById('audit-detail-modal')) return;
  document.getElementById('audit-detail-modal').style.display = 'none';
}

function formatJson(obj, highlightKeys = []) {
  if (!obj) return '(none)';
  try {
    const str = JSON.stringify(obj, null, 2);
    // Basic escaping for HTML display
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  } catch {
    return String(obj);
  }
}

// ── Schools & Users ──────────────────────────────────────────────────────

let _schools       = [];  // cached list for selects
let _allUsersCache = [];  // flat list of all approved users, for cross-school search
let _userNameById  = {};  // id -> name, keeps user-controlled names out of inline onclick (XSS)

// Backend-gated products that can be switched per school (Class Builder is never gated).
const ADMIN_PRODUCTS = [
  { key: 'cico',             short: 'CICO' },
  { key: 'referrals',        short: 'Referrals' },
  { key: 'schedule_builder', short: 'Schedule' },
];

// Lightweight cache refresh — no rendering. Used at bootstrap and anywhere the
// schools list must be fresh before rendering something else (e.g. dropdowns).
async function loadSchools() {
  const { data, error } = await db.from('schools').select('*').order('name');
  if (error) { console.error('loadSchools error:', error.message); return; }
  _schools = data || [];
}

function _schoolUserCount(id) {
  return _allUsersCache.filter(u => u.school_id === id).length;
}

async function loadSchoolsAndUsers() {
  const container = document.getElementById('schools-users-list');
  container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Loading…</p>';

  const [schoolsRes, usersRes] = await Promise.all([
    db.from('schools').select('*').order('name'),
    db.from('profiles')
      .select('id, full_name, email, school_id, approved, role, created_at')
      .eq('approved', true)
      .order('full_name', { ascending: true }),
  ]);

  if (schoolsRes.error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load schools: ${escAdmin(schoolsRes.error.message)}</p>`;
    return;
  }
  _schools = schoolsRes.data || [];

  if (usersRes.error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load users: ${escAdmin(usersRes.error.message)}</p>`;
    return;
  }
  _allUsersCache = usersRes.data || [];
  _allUsersCache.forEach(u => { _userNameById[u.id] = u.full_name || 'this user'; });

  renderSchoolsUsersView();
}

function renderSchoolsUsersView() {
  const container = document.getElementById('schools-users-list');

  const byId = {};
  _allUsersCache.forEach(u => {
    const key = u.school_id || '__unassigned__';
    (byId[key] = byId[key] || []).push(u);
  });

  const unassigned = byId['__unassigned__'] || [];
  let html = '';
  if (unassigned.length) {
    html += schoolCardHtml({ id: '__unassigned__', name: 'Unassigned' }, unassigned, true);
  }
  if (!_schools.length && !unassigned.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No schools yet. Add one below.</p>';
    return;
  }
  html += _schools.map(s => schoolCardHtml(s, byId[s.id] || [], false)).join('');
  container.innerHTML = html;

  // Pre-select reassign dropdowns
  _allUsersCache.forEach(u => {
    const sel = document.getElementById(`reassign-sel-${u.id}`);
    if (sel && u.school_id) sel.value = u.school_id;
  });
}

function schoolCardHeaderHtml(s, userCount, isUnassignedGroup) {
  const meta = [s.district, s.state].filter(Boolean).join(' · ');
  const metaLine = (meta ? meta + ' · ' : '') + `${userCount} user${userCount !== 1 ? 's' : ''}`;
  const ep = s.enabled_products || [];
  const toggles = isUnassignedGroup ? '' : ADMIN_PRODUCTS.map(p => `
        <label class="product-toggle-label">
          <input type="checkbox" data-change="toggleSchoolProductAdmin" data-id="${s.id}" data-product="${p.key}" ${ep.includes(p.key) ? 'checked' : ''} />
          ${p.short}
        </label>`).join('');
  const actions = isUnassignedGroup ? '' : `
        <button class="reassign-btn" data-act="startEditSchool" data-id="${s.id}">Edit</button>
        <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" data-act="deleteSchool" data-id="${s.id}">Delete</button>`;

  return `
    <div class="school-card-header-main" data-act="toggleSchoolCard" data-id="${s.id}">
      <span class="school-card-chevron">▸</span>
      <div>
        <div class="school-name">${escAdmin(s.name)}</div>
        <div class="school-meta">${escAdmin(metaLine)}</div>
      </div>
    </div>
    <div class="school-card-header-actions">
      ${toggles ? `<div class="product-toggle-row">${toggles}</div>` : ''}
      ${actions}
    </div>`;
}

function schoolCardHtml(s, users, isUnassignedGroup) {
  const rows = users.map(u => userRowHtml(u)).join('')
    || `<tr><td colspan="5" class="empty-row" style="padding:16px;">No users${isUnassignedGroup ? '' : ' assigned to this school'} yet.</td></tr>`;

  return `
    <div class="school-card" id="school-card-${s.id}">
      <div class="school-card-header" id="school-card-header-${s.id}">
        ${schoolCardHeaderHtml(s, users.length, isUnassignedGroup)}
      </div>
      <div class="school-card-body collapsed" id="school-card-body-${s.id}">
        <div style="overflow-x:auto;">
          <table class="users-table">
            <thead><tr><th>Name</th><th>Reassign</th><th>Role</th><th>Joined</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function userRowHtml(u) {
  const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const schoolOptions = _schools.map(s => `<option value="${s.id}">${escAdmin(s.name)}</option>`).join('');
  return `
    <tr id="user-row-${u.id}">
      <td>
        <strong>${escAdmin(u.full_name || '(no name)')}</strong>
        ${u.email ? `<br><a href="mailto:${escAdmin(u.email)}" style="font-size:11px;color:#6b7280;">${escAdmin(u.email)}</a>` : ''}
      </td>
      <td>
        <div class="school-assign-row">
          <select class="school-sel" id="reassign-sel-${u.id}">
            <option value="">— None —</option>
            ${schoolOptions}
          </select>
          <button class="reassign-btn" id="reassign-btn-${u.id}" data-act="reassignUserSchool" data-id="${u.id}">Save</button>
        </div>
      </td>
      <td>${roleControlHtml(u)}</td>
      <td style="font-size:11px;color:#9ca3af;">${date}</td>
      <td><button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" data-act="deactivateUser" data-id="${u.id}">Deactivate</button></td>
    </tr>`;
}

function toggleSchoolCard(id) {
  const body = document.getElementById(`school-card-body-${id}`);
  if (!body) return;
  const collapsed = body.classList.toggle('collapsed');
  const chevron = document.querySelector(`#school-card-header-${id} .school-card-chevron`);
  if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
}

// Role control. Super admins are shown as a badge only (demote a super admin
// via SQL, deliberately not via the panel). A plain user can only be promoted
// once they have a school assigned, since school admins operate on their own school.
function roleControlHtml(u) {
  if (u.role === 'super_admin') {
    return `<span class="role-badge" style="background:#1e3a5f;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">Super Admin</span>`;
  }
  if (u.role === 'school_admin') {
    return `<span class="role-badge" style="background:#0e7490;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">School Admin</span>
      <button class="reassign-btn" style="margin-left:6px;" data-act="setUserRole" data-id="${u.id}" data-role="user">Revoke</button>`;
  }
  // plain user
  if (!u.school_id) {
    return `<span style="color:#9ca3af;font-size:12px;">User</span>
      <div style="font-size:11px;color:#9ca3af;">assign a school to promote</div>`;
  }
  return `<span style="color:#6b7280;font-size:12px;">User</span>
    <button class="reassign-btn" style="margin-left:6px;" data-act="setUserRole" data-id="${u.id}" data-role="school_admin">Make school admin</button>`;
}

async function setUserRole(userId, el) {
  const role = el.dataset.role;
  const { error } = await db.from('profiles').update({ role }).eq('id', userId);
  if (error) { alert('Error changing role: ' + error.message); return; }
  loadSchoolsAndUsers();
}

async function reassignUserSchool(userId) {
  const sel      = document.getElementById(`reassign-sel-${userId}`);
  const btn      = document.getElementById(`reassign-btn-${userId}`);
  const schoolId = sel ? (sel.value || null) : null;

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const { error } = await db.from('profiles').update({ school_id: schoolId }).eq('id', userId);

  if (error) {
    alert('Error updating school: ' + error.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    return;
  }

  loadSchoolsAndUsers();
}

function deactivateUser(id) {
  const row = document.getElementById(`user-row-${id}`);
  if (!row) return;
  const name = _userNameById[id] || 'this user';
  row.innerHTML = `
    <td colspan="5">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;">
        <span style="font-size:13px;">Deactivate <strong>${escAdmin(name)}</strong>? They'll lose access immediately.</span>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" data-act="confirmDeactivateUser" data-id="${id}">Yes, deactivate</button>
          <button class="reassign-btn" data-act="cancelDeactivateUser" data-id="${id}">Cancel</button>
        </div>
      </div>
    </td>`;
}

async function confirmDeactivateUser(id) {
  const { error } = await db.from('profiles').update({ approved: false }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  loadSchoolsAndUsers();
}

function cancelDeactivateUser(id) { loadSchoolsAndUsers(); }

// ── Cross-school user search ─────────────────────────────────────────────

function renderUserSearch(query) {
  const resultsEl = document.getElementById('user-search-results');
  const listEl    = document.getElementById('schools-users-list');
  if (!query) {
    resultsEl.classList.add('hidden');
    resultsEl.innerHTML = '';
    listEl.classList.remove('hidden');
    return;
  }
  const q = query.toLowerCase();
  const matches = _allUsersCache.filter(u =>
    (u.full_name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)
  );
  listEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');
  if (!matches.length) {
    resultsEl.innerHTML = '<p style="color:#9ca3af;font-size:13px;padding:12px 0;">No users match your search.</p>';
    return;
  }
  resultsEl.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="users-table">
        <thead><tr><th>Name</th><th>School</th><th>Role</th><th></th></tr></thead>
        <tbody>${matches.map(u => {
          const school = _schools.find(s => s.id === u.school_id);
          return `<tr>
            <td>
              <strong>${escAdmin(u.full_name || '(no name)')}</strong>
              ${u.email ? `<br><a href="mailto:${escAdmin(u.email)}" style="font-size:11px;color:#6b7280;">${escAdmin(u.email)}</a>` : ''}
            </td>
            <td>${school ? escAdmin(school.name) : '<span style="color:#9ca3af;">— unassigned —</span>'}</td>
            <td>${roleControlHtml(u)}</td>
            <td>${school ? `<button class="reassign-btn" data-act="jumpToSchoolCard" data-id="${school.id}">Open school →</button>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

function jumpToSchoolCard(schoolId) {
  document.getElementById('user-search-input').value = '';
  renderUserSearch('');
  const card   = document.getElementById(`school-card-${schoolId}`);
  const body   = document.getElementById(`school-card-body-${schoolId}`);
  const chevron = document.querySelector(`#school-card-header-${schoolId} .school-card-chevron`);
  if (body) body.classList.remove('collapsed');
  if (chevron) chevron.textContent = '▾';
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Super-admin per-school product master switch. Writes enabled_products
// directly (super admin already has UPDATE on schools via RLS), preserving the
// other products. This is the school-level switch; a user also needs to be
// approved + assigned to the school to actually get the product.
async function toggleSchoolProductAdmin(id, el) {
  const product = el.dataset.product;
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const set = new Set(school.enabled_products || []);
  if (el.checked) set.add(product); else set.delete(product);
  const enabled = Array.from(set);
  el.disabled = true;
  const { error } = await db.from('schools').update({ enabled_products: enabled }).eq('id', id);
  el.disabled = false;
  if (error) {
    alert('Error updating products: ' + error.message);
    el.checked = !el.checked; // revert the toggle on failure
    return;
  }
  school.enabled_products = enabled; // keep cache in sync
}

function startEditSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const header = document.getElementById(`school-card-header-${id}`);
  if (!header) return;
  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap;">
      <input id="edit-name-${id}"     value="${escAdmin(school.name)}"           placeholder="School name *"   style="padding:7px 10px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-family:inherit;outline:none;flex:1;min-width:140px;" />
      <input id="edit-district-${id}" value="${escAdmin(school.district || '')}" placeholder="District"        style="padding:7px 10px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-family:inherit;outline:none;flex:1;min-width:120px;" />
      <input id="edit-state-${id}"    value="${escAdmin(school.state || '')}"    placeholder="State"           style="padding:7px 10px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-family:inherit;outline:none;width:70px;" />
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="reassign-btn" style="color:var(--teal);border-color:var(--teal);" data-act="saveEditSchool" data-id="${id}">Save</button>
      <button class="reassign-btn" data-act="cancelEditSchool" data-id="${id}">Cancel</button>
    </div>`;
  document.getElementById(`edit-name-${id}`).focus();
}

function cancelEditSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const header = document.getElementById(`school-card-header-${id}`);
  if (header) header.innerHTML = schoolCardHeaderHtml(school, _schoolUserCount(id), false);
}

async function saveEditSchool(id) {
  const nameEl     = document.getElementById(`edit-name-${id}`);
  const districtEl = document.getElementById(`edit-district-${id}`);
  const stateEl    = document.getElementById(`edit-state-${id}`);
  const name       = nameEl     ? nameEl.value.trim()     : '';
  const district   = districtEl ? districtEl.value.trim() : '';
  const state      = stateEl    ? stateEl.value.trim()    : '';

  if (!name) {
    if (nameEl) nameEl.style.borderColor = 'var(--red)';
    return;
  }

  const { error } = await db.from('schools')
    .update({ name, district: district || null, state: state || null })
    .eq('id', id);

  if (error) { alert('Error saving: ' + error.message); return; }

  // Update cache
  const idx = _schools.findIndex(s => s.id === id);
  if (idx !== -1) _schools[idx] = { ..._schools[idx], name, district: district || null, state: state || null };

  // Update all dropdowns that list this school
  document.querySelectorAll(`.school-sel option[value="${id}"]`).forEach(opt => { opt.textContent = name; });

  // Re-render the header
  const header = document.getElementById(`school-card-header-${id}`);
  if (header && idx !== -1) header.innerHTML = schoolCardHeaderHtml(_schools[idx], _schoolUserCount(id), false);
}

function deleteSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const header = document.getElementById(`school-card-header-${id}`);
  if (!header) return;
  header.innerHTML = `
    <div>
      <div class="school-name">${escAdmin(school.name)}</div>
      <div class="school-meta" style="color:var(--red);">Delete this school? This cannot be undone.</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" data-act="confirmDeleteSchool" data-id="${id}">Yes, delete</button>
      <button class="reassign-btn" data-act="cancelDeleteSchool" data-id="${id}">Cancel</button>
    </div>`;
}

function cancelDeleteSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const header = document.getElementById(`school-card-header-${id}`);
  if (header) header.innerHTML = schoolCardHeaderHtml(school, _schoolUserCount(id), false);
}

async function confirmDeleteSchool(id) {
  const school = _schools.find(s => s.id === id);
  const card   = document.getElementById(`school-card-${id}`);

  // Check for assigned users first
  const { data: assigned, error: checkErr } = await db
    .from('profiles').select('id').eq('school_id', id);

  if (checkErr) { alert('Error: ' + checkErr.message); return; }

  if (assigned && assigned.length) {
    const header = document.getElementById(`school-card-header-${id}`);
    if (header) header.innerHTML = `
      <div>
        <div class="school-name">${escAdmin(school?.name || '')}</div>
        <div class="school-meta" style="color:var(--red);">
          ${assigned.length} user${assigned.length !== 1 ? 's are' : ' is'} assigned here — reassign them first.
        </div>
      </div>
      <button class="reassign-btn" data-act="cancelDeleteSchool" data-id="${id}">OK</button>`;
    return;
  }

  const { error } = await db.from('schools').delete().eq('id', id);
  if (error) { alert('Error deleting: ' + error.message); loadSchoolsAndUsers(); return; }

  // Remove from cache and all dropdowns
  _schools = _schools.filter(s => s.id !== id);
  document.querySelectorAll(`.school-sel option[value="${id}"]`).forEach(opt => opt.remove());

  // Remove the card; show empty state if none left
  if (card) card.remove();
  const container = document.getElementById('schools-users-list');
  if (container && !container.querySelector('.school-card')) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No schools yet. Add one below.</p>';
  }
}

async function addSchool() {
  const name     = document.getElementById('new-school-name').value.trim();
  const district = document.getElementById('new-school-district').value.trim();
  const state    = document.getElementById('new-school-state').value.trim();
  const alertEl  = document.getElementById('school-alert');
  const btn      = document.querySelector('.add-school-row .btn');

  if (!name) {
    alertEl.textContent = 'School name is required.';
    alertEl.className = 'alert alert-error';
    alertEl.classList.remove('hidden');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  alertEl.classList.add('hidden');

  const { data, error } = await db.from('schools')
    .insert({ name, district: district || null, state: state || null })
    .select().single();

  if (btn) { btn.disabled = false; btn.textContent = '+ Add School'; }

  if (error) {
    console.error('addSchool error:', error);
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
  await loadSchoolsAndUsers();
  // Inject the new school into dropdowns outside this view (Approvals) — the
  // Schools & Users view was just fully re-rendered above and already has it.
  const newOpt = `<option value="${escAdmin(data.id)}">${escAdmin(data.name)}</option>`;
  document.querySelectorAll('#view-approvals .school-sel').forEach(sel => sel.insertAdjacentHTML('beforeend', newOpt));
}

function escAdmin(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Event delegation ────────────────────────────────────────────────────────
// Replaces inline onclick so the CSP can drop script-src 'unsafe-inline'.
// Buttons carry data-act="<fn>" plus optional data-id / data-role / data-name /
// data-students; the dispatcher calls fn(dataset.id, element).
function auditLoadMore()  { loadAuditLog(true); }
function errorLoadMore()  { loadErrors(true); }
function dismissPendingRow(id) {
  const r = document.getElementById(`row-${id}`);
  if (r) r.remove();
  _updatePendingBadge();
}
function toggleAuditFilters() {
  document.getElementById('audit-filters-panel').classList.toggle('hidden');
}
function toggleErrorFilters() {
  document.getElementById('error-filters-panel').classList.toggle('hidden');
}

const ADMIN_ACTIONS = {
  openAuditDetail, auditLoadMore, errorLoadMore, loadErrors, clearErrorFilters, loadCicoStats,
  startEditSchool, deleteSchool, saveEditSchool, cancelEditSchool, confirmDeleteSchool, cancelDeleteSchool,
  reassignUserSchool, deactivateUser, setUserRole, confirmDeactivateUser, cancelDeactivateUser,
  approveUser, assignPendingSchool, dismissPendingRow,
  wipeSchoolData, confirmWipeSchoolData,
  gotoView, gotoSubtab, gotoSubtabView, toggleSchoolCard, jumpToSchoolCard,
  toggleAuditFilters, toggleErrorFilters,
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = ADMIN_ACTIONS[t.dataset.act];
  if (fn) fn(t.dataset.id, t);
});

const ADMIN_CHANGE_ACTIONS = { toggleSchoolProductAdmin };
document.addEventListener('change', (e) => {
  const t = e.target.closest('[data-change]');
  if (!t) return;
  const fn = ADMIN_CHANGE_ACTIONS[t.dataset.change];
  if (fn) fn(t.dataset.id, t);
});

// ── Pending users (with school assignment) ───────────────────────────────

async function loadPendingUsers() {
  const container = document.getElementById('pending-users-list');
  const badge     = document.getElementById('pending-badge');

  const { data: pending, error } = await db
    .from('profiles')
    .select('id, full_name, email, school_name, created_at')
    .eq('approved', false)
    .order('created_at', { ascending: true });

  if (error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load pending users.</p>`;
    return;
  }

  if (!pending || !pending.length) {
    badge.classList.add('hidden');
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No pending users. All accounts are approved.</p>';
    return;
  }

  badge.textContent = pending.length;
  badge.classList.remove('hidden');

  const schoolOptions = _schools.map(s =>
    `<option value="${s.id}">${escAdmin(s.name)}</option>`
  ).join('');

  container.innerHTML = pending.map(u => {
    const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const daysSince = (Date.now() - new Date(u.created_at)) / (1000 * 60 * 60 * 24);
    const isReturning = daysSince > 3;
    return `
      <div class="pending-row" id="row-${u.id}">
        <div class="pending-info">
          <strong>${escAdmin(u.full_name || '(no name)')}</strong>
          ${isReturning ? '<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;margin-left:6px;">Previously active</span>' : ''}
          ${u.email ? `<a href="mailto:${escAdmin(u.email)}" style="font-size:12px;color:#6b7280;display:block;margin-top:2px;">${escAdmin(u.email)}</a>` : ''}
          <div class="meta">${escAdmin(u.school_name || 'No school listed')} · ${isReturning ? 'Deactivated' : 'Signed up'} ${date}</div>
          <div class="pending-school-row">
            <label style="font-size:12px;color:#6b7280;">Assign to school:</label>
            <select class="school-sel" id="school-sel-${u.id}">
              <option value="">— None / create below —</option>
              ${schoolOptions}
            </select>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          <button class="approve-btn" data-act="approveUser" data-id="${u.id}">${isReturning ? 'Reactivate' : 'Approve'}</button>
          <button class="reassign-btn" data-act="assignPendingSchool" data-id="${u.id}" title="Set their school without approving — their school admin approves them">Route to school admin →</button>
        </div>
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
  const btn       = document.querySelector(`#row-${userId} .approve-btn`);
  const schoolSel = document.getElementById(`school-sel-${userId}`);
  const schoolId  = schoolSel ? (schoolSel.value || null) : null;

  // Grab user details before the row changes
  const nameEl  = document.querySelector(`#row-${userId} .pending-info strong`);
  const emailEl = document.querySelector(`#row-${userId} .pending-info a[href^="mailto:"]`);
  const name    = nameEl  ? nameEl.textContent  : '';
  const email   = emailEl ? emailEl.textContent : '';

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

  // Show notify prompt before removing the row
  const row = document.getElementById(`row-${userId}`);
  if (row && email) {
    const subject = encodeURIComponent('Your Cohort Logic account is approved');
    const body    = encodeURIComponent(
      `Hi ${name},\n\nYour Cohort Logic account has been approved. You can sign in here:\nhttps://cohortlogic.com/login.html\n\nIf you have any questions, just reply to this email.\n\n— The Cohort Logic team`
    );
    row.innerHTML = `
      <div class="pending-info">
        <strong style="color:var(--green);">✓ Approved</strong>
        <div class="meta">Notify ${escAdmin(name)} that their account is ready?</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <a href="mailto:${escAdmin(email)}?subject=${subject}&body=${body}"
           class="approve-btn" style="text-decoration:none;display:inline-flex;align-items:center;">
          Send email
        </a>
        <button class="reassign-btn" data-act="dismissPendingRow" data-id="${userId}">Done</button>
      </div>`;
  } else {
    if (row) row.remove();
    _updatePendingBadge();
  }
}

// Route a pending user to their school admin: set school_id WITHOUT approving.
// The user stays pending (approved=false) but now appears in that school's
// admin queue, where the school admin approves or declines them.
async function assignPendingSchool(userId) {
  const sel      = document.getElementById(`school-sel-${userId}`);
  const schoolId = sel ? (sel.value || null) : null;
  if (!schoolId) { alert('Pick a school in the dropdown first, then route.'); return; }

  const { error } = await db.from('profiles').update({ school_id: schoolId }).eq('id', userId);
  if (error) { alert('Error assigning school: ' + error.message); return; }

  const schoolName = (_schools.find(s => s.id === schoolId) || {}).name || 'the school';
  const row = document.getElementById(`row-${userId}`);
  if (row) {
    row.innerHTML = `
      <div class="pending-info">
        <strong style="color:var(--teal);">→ Routed to ${escAdmin(schoolName)}</strong>
        <div class="meta">Their school admin can now approve this user.</div>
      </div>
      <button class="reassign-btn" data-act="dismissPendingRow" data-id="${userId}">Done</button>`;
  }
}

function _updatePendingBadge() {
  const remaining = document.querySelectorAll('.pending-row').length;
  const badge     = document.getElementById('pending-badge');
  if (remaining === 0) {
    badge.classList.add('hidden');
    document.getElementById('pending-users-list').innerHTML =
      '<p style="color:#9ca3af;font-size:13px;">No pending users. All accounts are approved.</p>';
  } else {
    badge.textContent = remaining;
  }
}

// ── Dashboard bootstrap ──
function loadDashboard() {
  const today     = new Date().toISOString().split('T')[0];
  const thirtyAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
  document.getElementById('audit-from').value = thirtyAgo;
  document.getElementById('audit-to').value   = today;

  // Bootstrap: schools cache + pending queue power the Approvals badge, which
  // must stay current regardless of which tab is open.
  loadSchools().then(() => { loadPendingUsers(); });
  _loadedViews.add('approvals');

  const initial = location.hash.replace('#', '');
  showView(ADMIN_VIEWS.includes(initial) ? initial : 'overview');
}

// ── Error Logs ────────────────────────────────────────────────────────────

const ERROR_PAGE_SIZE = 50;
let _errorOffset  = 0;
let _errorRecords = [];

document.getElementById('error-product-filter').addEventListener('change', loadErrors);
document.getElementById('error-type-filter').addEventListener('change', loadErrors);

async function loadErrors(append = false) {
  const wrap          = document.getElementById('error-log-wrap');
  const productFilter = document.getElementById('error-product-filter').value;
  const typeFilter    = document.getElementById('error-type-filter').value;

  if (!append) {
    _errorOffset  = 0;
    _errorRecords = [];
    wrap.innerHTML = '<p style="color:#9ca3af;font-size:13px;">Loading…</p>';
  }

  let query = db
    .from('error_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(_errorOffset, _errorOffset + ERROR_PAGE_SIZE - 1);

  if (productFilter) query = query.eq('product', productFilter);
  if (typeFilter)    query = query.eq('error_type', typeFilter);

  const { data, error, count } = await query;

  if (error) {
    wrap.innerHTML = `<p style="color:#ef4444;font-size:13px;">Error: ${escAdmin(error.message)}</p>`;
    return;
  }

  if (!data?.length && !append) {
    wrap.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No errors logged yet.</p>';
    return;
  }

  _errorRecords = append ? [..._errorRecords, ...(data || [])] : (data || []);
  _errorOffset += (data?.length || 0);

  const fmt = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const productLabel = p => ({ class_builder: 'Class Builder', cico: 'CICO', referrals: 'Referral Tracking', schedule_builder: 'Schedule Builder' }[p] || p);
  const productColor = p => ({ class_builder: '#e0f2fe;color:#0369a1', cico: '#d1fae5;color:#065f46', referrals: '#eef0fb;color:#3b3f9e', schedule_builder: '#ede9fe;color:#5b21b6' }[p] || '#f3f4f6;color:#374151');

  const rows = _errorRecords.map(r => `
    <tr>
      <td style="white-space:nowrap;font-size:12px;">${fmt(r.created_at)}</td>
      <td><span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;background:${productColor(r.product)}">${escAdmin(productLabel(r.product))}</span></td>
      <td style="font-size:12px;font-family:monospace;color:#6b7280;">${escAdmin(r.error_type || '—')}</td>
      <td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;" title="${escAdmin(r.message || '')}">${escAdmin(r.message || '—')}</td>
      <td style="font-size:11px;color:#9ca3af;">${escAdmin(r.browser || '—')}</td>
      <td style="font-size:11px;color:#9ca3af;">${r.user_email ? `<a href="mailto:${escAdmin(r.user_email)}" style="color:#6b7280;">${escAdmin(r.user_email)}</a>` : '—'}</td>
    </tr>
  `).join('');

  const hasMore = count !== null && _errorOffset < count;

  wrap.innerHTML = `
    <div style="font-size:12px;color:#9ca3af;margin-bottom:10px;">
      Showing ${_errorRecords.length}${count !== null ? ' of ' + count : ''} errors
    </div>
    <div style="overflow-x:auto;">
      <table class="audit-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Product</th>
            <th>Type</th>
            <th>Message</th>
            <th>Browser</th>
            <th>User</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${hasMore ? `<button class="audit-load-more" data-act="errorLoadMore">Load more (${count - _errorOffset} remaining)</button>` : ''}
  `;
}

function clearErrorFilters() {
  document.getElementById('error-product-filter').value = '';
  document.getElementById('error-type-filter').value    = '';
  loadErrors();
}

// ── Feedback ──────────────────────────────────────────────────────────────

async function loadFeedback() {
  const container = document.getElementById('feedback-list');
  const { data, error } = await db.from('feedback')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data?.length) {
    container.innerHTML = `<p style="color:#9ca3af;font-size:13px;">${error ? 'Error loading feedback.' : 'No feedback submitted yet.'}</p>`;
    return;
  }

  const fmt = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const productLabel = p => ({ class_builder: 'Class Builder', cico: 'CICO', referrals: 'Referral Tracking', schedule_builder: 'Schedule Builder' }[p] || p);

  container.innerHTML = `
    <table class="event-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Product</th>
          <th>Name</th>
          <th>Email</th>
          <th>School</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(f => `
          <tr>
            <td style="white-space:nowrap">${fmt(f.created_at)}</td>
            <td><span style="font-size:11px;font-weight:600;padding:2px 7px;border-radius:999px;background:#e0f2fe;color:#0369a1">${productLabel(f.product)}</span></td>
            <td>${f.name || '<span style="color:#9ca3af">—</span>'}</td>
            <td>${f.email ? `<a href="mailto:${f.email}">${f.email}</a>` : '<span style="color:#9ca3af">—</span>'}</td>
            <td>${f.school_name || '<span style="color:#9ca3af">—</span>'}</td>
            <td style="max-width:340px;white-space:pre-wrap">${f.message}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function loadCicoStats() {
  await loadSchools(); // safety-refresh — this view can load before bootstrap resolves

  const thirtyAgo  = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const todayStart = new Date().toISOString().split('T')[0];

  const [studentsRes, checkinsRes, todayRes] = await Promise.all([
    db.from('students').select('school_id'),
    db.from('cico_checkins').select('school_id, created_at').gte('created_at', thirtyAgo),
    db.from('cico_checkins').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
  ]);

  const students   = studentsRes.data || [];
  const checkins   = checkinsRes.data || [];
  const todayCount = todayRes.count   ?? 0;

  // Aggregate per school
  const bySchool = {};
  students.forEach(s => {
    if (!bySchool[s.school_id]) bySchool[s.school_id] = { students: 0, checkins30d: 0, lastCheckin: null };
    bySchool[s.school_id].students++;
  });
  checkins.forEach(c => {
    if (!bySchool[c.school_id]) bySchool[c.school_id] = { students: 0, checkins30d: 0, lastCheckin: null };
    bySchool[c.school_id].checkins30d++;
    const ts = new Date(c.created_at);
    if (!bySchool[c.school_id].lastCheckin || ts > bySchool[c.school_id].lastCheckin) {
      bySchool[c.school_id].lastCheckin = ts;
    }
  });

  const activeSchools = Object.values(bySchool).filter(s => s.checkins30d > 0).length;

  document.getElementById('cico-stat-students').textContent = students.length;
  document.getElementById('cico-stat-checkins').textContent = checkins.length;
  document.getElementById('cico-stat-today').textContent    = todayCount;
  document.getElementById('cico-stat-schools').textContent  = activeSchools;

  const wrap = document.getElementById('cico-schools-table');
  if (!_schools.length) {
    wrap.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No schools configured yet.</p>';
    return;
  }

  const rows = [..._schools]
    .map(s => ({ ...s, ...(bySchool[s.id] || { students: 0, checkins30d: 0, lastCheckin: null }) }))
    .sort((a, b) => b.checkins30d - a.checkins30d)
    .map(s => {
      const lastActivity  = s.lastCheckin
        ? s.lastCheckin.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      const meta = [s.district, s.state].filter(Boolean).join(' · ');
      return `<tr id="cico-row-${s.id}">
        <td>
          <strong>${escAdmin(s.name)}</strong>
          ${meta ? `<br><span style="font-size:11px;color:#9ca3af;">${escAdmin(meta)}</span>` : ''}
        </td>
        <td style="text-align:center;">${s.students}</td>
        <td style="text-align:center;font-weight:${s.checkins30d > 0 ? '700' : '400'};color:${s.checkins30d > 0 ? 'var(--green)' : '#9ca3af'};">${s.checkins30d}</td>
        <td style="font-size:12px;color:#6b7280;">${lastActivity}</td>
        <td><button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" data-act="wipeSchoolData" data-id="${s.id}" data-name="${escAdmin(s.name)}" data-students="${s.students}">Wipe Data</button></td>
      </tr>`;
    }).join('');

  wrap.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="event-table">
        <thead><tr>
          <th>School</th>
          <th style="text-align:center;">Students</th>
          <th style="text-align:center;">Check-ins (30d)</th>
          <th>Last Activity</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function wipeSchoolData(id, el) {
  const name = el.dataset.name;
  const students = Number(el.dataset.students);
  const row = document.getElementById(`cico-row-${id}`);
  if (!row) return;
  const studentLabel = `${students} student${students !== 1 ? 's' : ''}`;
  row.innerHTML = `
    <td colspan="5">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;flex-wrap:wrap;">
        <div>
          <strong>${escAdmin(name)}</strong>
          <div style="font-size:12px;color:var(--red);margin-top:2px;">
            Permanently delete all CICO data — ${escAdmin(studentLabel)}, all check-ins, settings, and categories. Cannot be undone.
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" data-act="confirmWipeSchoolData" data-id="${id}" data-name="${escAdmin(name)}">Yes, wipe all data</button>
          <button class="reassign-btn" data-act="loadCicoStats">Cancel</button>
        </div>
      </div>
    </td>`;
}

async function confirmWipeSchoolData(id, el) {
  const name = el.dataset.name;
  const row = document.getElementById(`cico-row-${id}`);
  if (row) row.innerHTML = `<td colspan="5" style="color:#9ca3af;font-size:13px;padding:12px;">Wiping data for ${escAdmin(name)}…</td>`;

  // Delete child records first (cico_period_scores + cico_incidents reference checkin_id)
  const { data: checkinRows } = await db.from('cico_checkins').select('id').eq('school_id', id);
  const checkinIds = (checkinRows || []).map(c => c.id);
  if (checkinIds.length) {
    await Promise.all([
      db.from('cico_period_scores').delete().in('checkin_id', checkinIds),
      db.from('cico_incidents').delete().in('checkin_id', checkinIds),
    ]);
  }

  // Delete all CICO-specific school-scoped tables in parallel.
  // NOTE: the `students` roster is intentionally NOT wiped here — it is now a
  // SHARED roster (CICO + Referral Tracking), so it is no longer CICO-owned
  // data. Clearing it would also orphan/block referral records. Roster cleanup
  // is a separate concern handled at the school level.
  const results = await Promise.all([
    db.from('cico_checkins').delete().eq('school_id', id),
    db.from('cico_settings').delete().eq('school_id', id),
    db.from('cico_categories').delete().eq('school_id', id),
    db.from('cico_incident_types').delete().eq('school_id', id),
  ]);

  const errors = results.filter(r => r.error).map(r => r.error.message);
  if (errors.length) alert('Some data could not be deleted:\n' + errors.join('\n'));

  loadCicoStats();
}

async function loadAnalytics() {
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

// ── Inactivity session timeout ─────────────────────────────────────────────
(function () {
  const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes — adjust here if needed
  const WARN_MS    =      60 * 1000; // warn 60 seconds before logout

  const banner = document.createElement('div');
  banner.id = 'session-timeout-banner';
  banner.style.display = 'none';
  banner.innerHTML = `
    <div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
                background:#1e3a5f;color:#fff;padding:14px 20px;border-radius:10px;
                font-size:14px;font-family:inherit;box-shadow:0 4px 20px rgba(0,0,0,.3);
                display:flex;align-items:center;gap:14px;z-index:9999;white-space:nowrap;">
      <span>⏱ You'll be logged out in 60 seconds due to inactivity.</span>
      <button id="admin-timeout-stay"
              style="background:#2a9d8f;border:none;color:#fff;padding:6px 14px;
                     border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;">
        Stay logged in
      </button>
    </div>`;
  document.body.appendChild(banner);
  banner.querySelector('#admin-timeout-stay')
    .addEventListener('click', () => window._resetAdminTimer());

  let _warnTimer   = null;
  let _logoutTimer = null;

  window._resetAdminTimer = function () {
    clearTimeout(_warnTimer);
    clearTimeout(_logoutTimer);
    banner.style.display = 'none';

    _warnTimer = setTimeout(() => {
      banner.style.display = 'block';
    }, TIMEOUT_MS - WARN_MS);

    _logoutTimer = setTimeout(() => doLogout(), TIMEOUT_MS);
  };

  ['click', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
    document.addEventListener(evt, window._resetAdminTimer, { passive: true })
  );

  // Only start timer when dashboard is visible (not on login screen)
  if (db) {
    db.auth.onAuthStateChange((event, session) => {
      if (session) window._resetAdminTimer();
    });
  }
})();
