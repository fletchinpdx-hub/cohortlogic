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

// ── Audit detail modal ──
const _auditOverlay = document.getElementById('audit-detail-modal');
_auditOverlay.addEventListener('click', closeAuditModal);
_auditOverlay.querySelector('.audit-modal').addEventListener('click', e => e.stopPropagation());
_auditOverlay.querySelector('.audit-modal-close').addEventListener('click', closeAuditModal);

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
      <td><button class="audit-detail-btn" onclick="openAuditDetail('${escAdmin(r.id)}')">View</button></td>
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
    ${hasMore ? `<button class="audit-load-more" onclick="loadAuditLog(true)">Load more (${totalCount - _auditOffset} remaining)</button>` : ''}
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

// ── Schools ──────────────────────────────────────────────────────────────

let _schools = [];  // cached list for selects
let _userNameById = {};  // id -> name, keeps user-controlled names out of inline onclick (XSS)

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
  container.innerHTML = _schools.map(s => schoolRowHtml(s)).join('');
}

function schoolRowHtml(s) {
  const meta = [s.district, s.state].filter(Boolean).join(' · ') || 'No district / state set';
  return `
    <div class="school-row" id="school-row-${s.id}">
      <div>
        <div class="school-name">${escAdmin(s.name)}</div>
        <div class="school-meta">${escAdmin(meta)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-family:monospace;font-size:11px;color:#9ca3af;">${s.id.slice(0,8)}…</span>
        <button class="reassign-btn" onclick="startEditSchool('${s.id}')">Edit</button>
        <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="deleteSchool('${s.id}')">Delete</button>
      </div>
    </div>`;
}

function startEditSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const row = document.getElementById(`school-row-${id}`);
  if (!row) return;
  row.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex:1;flex-wrap:wrap;">
      <input id="edit-name-${id}"     value="${escAdmin(school.name)}"           placeholder="School name *"   style="padding:7px 10px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-family:inherit;outline:none;flex:1;min-width:140px;" />
      <input id="edit-district-${id}" value="${escAdmin(school.district || '')}" placeholder="District"        style="padding:7px 10px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-family:inherit;outline:none;flex:1;min-width:120px;" />
      <input id="edit-state-${id}"    value="${escAdmin(school.state || '')}"    placeholder="State"           style="padding:7px 10px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-family:inherit;outline:none;width:70px;" />
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="reassign-btn" style="color:var(--teal);border-color:var(--teal);" onclick="saveEditSchool('${id}')">Save</button>
      <button class="reassign-btn" onclick="cancelEditSchool('${id}')">Cancel</button>
    </div>`;
  document.getElementById(`edit-name-${id}`).focus();
}

function cancelEditSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const row = document.getElementById(`school-row-${id}`);
  if (row) row.outerHTML = schoolRowHtml(school);
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

  // Re-render the row
  const row = document.getElementById(`school-row-${id}`);
  if (row) row.outerHTML = schoolRowHtml(_schools[idx]);
}

function deleteSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const row = document.getElementById(`school-row-${id}`);
  if (!row) return;
  row.innerHTML = `
    <div>
      <div class="school-name">${escAdmin(school.name)}</div>
      <div class="school-meta" style="color:var(--red);">Delete this school? This cannot be undone.</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="confirmDeleteSchool('${id}')">Yes, delete</button>
      <button class="reassign-btn" onclick="cancelDeleteSchool('${id}')">Cancel</button>
    </div>`;
}

function cancelDeleteSchool(id) {
  const school = _schools.find(s => s.id === id);
  if (!school) return;
  const row = document.getElementById(`school-row-${id}`);
  if (row) row.outerHTML = schoolRowHtml(school);
}

async function confirmDeleteSchool(id) {
  const school = _schools.find(s => s.id === id);
  const row    = document.getElementById(`school-row-${id}`);

  // Check for assigned users first
  const { data: assigned, error: checkErr } = await db
    .from('profiles').select('id').eq('school_id', id);

  if (checkErr) { alert('Error: ' + checkErr.message); return; }

  if (assigned && assigned.length) {
    if (row) row.innerHTML = `
      <div>
        <div class="school-name">${escAdmin(school?.name || '')}</div>
        <div class="school-meta" style="color:var(--red);">
          ${assigned.length} user${assigned.length !== 1 ? 's are' : ' is'} assigned here — reassign them first.
        </div>
      </div>
      <button class="reassign-btn" onclick="cancelDeleteSchool('${id}')">OK</button>`;
    return;
  }

  const { error } = await db.from('schools').delete().eq('id', id);
  if (error) { alert('Error deleting: ' + error.message); loadSchools(); return; }

  // Remove from cache and all dropdowns
  _schools = _schools.filter(s => s.id !== id);
  document.querySelectorAll(`.school-sel option[value="${id}"]`).forEach(opt => opt.remove());

  // Remove the row; show empty state if none left
  if (row) row.remove();
  const container = document.getElementById('schools-list');
  if (container && !container.querySelector('.school-row')) {
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
  await loadSchools();
  // Inject the new school into every existing dropdown immediately — no re-query needed
  const newOpt = `<option value="${escAdmin(data.id)}">${escAdmin(data.name)}</option>`;
  document.querySelectorAll('.school-sel').forEach(sel => sel.insertAdjacentHTML('beforeend', newOpt));
}

function escAdmin(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── All Users ─────────────────────────────────────────────────────────────

async function loadAllUsers() {
  const container = document.getElementById('all-users-list');

  const { data: users, error } = await db
    .from('profiles')
    .select('id, full_name, email, school_id, school_name, approved, role, created_at')
    .eq('approved', true)
    .order('full_name', { ascending: true });

  if (error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load users: ${escAdmin(error.message)}</p>`;
    return;
  }

  if (!users || !users.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No approved users yet.</p>';
    return;
  }

  const schoolOptions = _schools.map(s =>
    `<option value="${s.id}">${escAdmin(s.name)}</option>`
  ).join('');

  // id -> name lookup so user-controlled names never enter inline onclick (XSS)
  users.forEach(u => { _userNameById[u.id] = u.full_name || 'this user'; });

  const rows = users.map(u => {
    const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const assignedSchool = _schools.find(s => s.id === u.school_id);
    const schoolLabel = assignedSchool ? escAdmin(assignedSchool.name) : '<span style="color:#9ca3af;">— unassigned —</span>';
    return `
      <tr id="user-row-${u.id}">
        <td>
          <strong>${escAdmin(u.full_name || '(no name)')}</strong>
          ${u.email ? `<br><a href="mailto:${escAdmin(u.email)}" style="font-size:11px;color:#6b7280;">${escAdmin(u.email)}</a>` : ''}
        </td>
        <td style="color:#6b7280;">${escAdmin(u.school_name || '—')}</td>
        <td>${schoolLabel}</td>
        <td>
          <div class="school-assign-row">
            <select class="school-sel" id="reassign-sel-${u.id}">
              <option value="">— None —</option>
              ${schoolOptions}
            </select>
            <button class="reassign-btn" id="reassign-btn-${u.id}" onclick="reassignUserSchool('${u.id}')">Save</button>
          </div>
        </td>
        <td>${roleControlHtml(u)}</td>
        <td style="font-size:11px;color:#9ca3af;">${date}</td>
        <td><button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="deactivateUser('${u.id}')">Deactivate</button></td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>School (at signup)</th>
            <th>Assigned School</th>
            <th>Reassign</th>
            <th>Role</th>
            <th>Joined</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Pre-select current school in each dropdown
  users.forEach(u => {
    if (u.school_id) {
      const sel = document.getElementById(`reassign-sel-${u.id}`);
      if (sel) sel.value = u.school_id;
    }
  });
}

// Role control for the All Users table. Super admins are shown as a badge only
// (demote a super admin via SQL, deliberately not via the panel). A plain user
// can only be promoted once they have a school assigned, since school admins
// operate on their own school.
function roleControlHtml(u) {
  if (u.role === 'super_admin') {
    return `<span class="role-badge" style="background:#1e3a5f;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">Super Admin</span>`;
  }
  if (u.role === 'school_admin') {
    return `<span class="role-badge" style="background:#0e7490;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;">School Admin</span>
      <button class="reassign-btn" style="margin-left:6px;" onclick="setUserRole('${u.id}','user')">Revoke</button>`;
  }
  // plain user
  if (!u.school_id) {
    return `<span style="color:#9ca3af;font-size:12px;">User</span>
      <div style="font-size:11px;color:#9ca3af;">assign a school to promote</div>`;
  }
  return `<span style="color:#6b7280;font-size:12px;">User</span>
    <button class="reassign-btn" style="margin-left:6px;" onclick="setUserRole('${u.id}','school_admin')">Make school admin</button>`;
}

async function setUserRole(userId, role) {
  const { error } = await db.from('profiles').update({ role }).eq('id', userId);
  if (error) { alert('Error changing role: ' + error.message); return; }
  loadAllUsers();
}

async function reassignUserSchool(userId) {
  const sel     = document.getElementById(`reassign-sel-${userId}`);
  const btn     = document.getElementById(`reassign-btn-${userId}`);
  const schoolId = sel ? (sel.value || null) : null;

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const { error } = await db
    .from('profiles')
    .update({ school_id: schoolId })
    .eq('id', userId);

  if (btn) { btn.disabled = false; btn.textContent = 'Save'; }

  if (error) {
    alert('Error updating school: ' + error.message);
    return;
  }

  // Update the displayed school name in the row
  const assignedSchool = _schools.find(s => s.id === schoolId);
  const row = document.getElementById(`user-row-${userId}`);
  if (row) {
    const schoolCell = row.cells[2];
    schoolCell.innerHTML = assignedSchool
      ? escAdmin(assignedSchool.name)
      : '<span style="color:#9ca3af;">— unassigned —</span>';
  }

  if (btn) {
    btn.textContent = '✓ Saved';
    setTimeout(() => { if (btn) btn.textContent = 'Save'; }, 2000);
  }
}

function deactivateUser(id) {
  const row = document.getElementById(`user-row-${id}`);
  if (!row) return;
  const name = _userNameById[id] || 'this user';
  row.innerHTML = `
    <td colspan="7">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;">
        <span style="font-size:13px;">Deactivate <strong>${escAdmin(name)}</strong>? They'll lose access immediately.</span>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="confirmDeactivateUser('${id}')">Yes, deactivate</button>
          <button class="reassign-btn" onclick="cancelDeactivateUser('${id}')">Cancel</button>
        </div>
      </div>
    </td>`;
}

async function confirmDeactivateUser(id) {
  const { error } = await db.from('profiles').update({ approved: false }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  const row = document.getElementById(`user-row-${id}`);
  if (row) row.remove();
  const container = document.getElementById('all-users-list');
  const tbody = container ? container.querySelector('tbody') : null;
  if (tbody && !tbody.querySelector('tr')) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No approved users yet.</p>';
  }
}

function cancelDeactivateUser(id) { loadAllUsers(); }

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
    const daysSince = (Date.now() - new Date(u.created_at)) / (1000 * 60 * 60 * 24);
    const isReturning = daysSince > 3;
    const matchedSchool = _schools.find(s =>
      s.name.toLowerCase() === (u.school_name || '').toLowerCase()
    );
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
          <button class="approve-btn" onclick="approveUser('${u.id}')">${isReturning ? 'Reactivate' : 'Approve'}</button>
          <button class="reassign-btn" onclick="assignPendingSchool('${u.id}')" title="Set their school without approving — their school admin approves them">Route to school admin →</button>
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
        <button class="reassign-btn" onclick="document.getElementById('row-${userId}').remove();_updatePendingBadge();">Done</button>
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
      <button class="reassign-btn" onclick="document.getElementById('row-${userId}').remove();_updatePendingBadge();">Done</button>`;
  }
}

function _updatePendingBadge() {
  const remaining = document.querySelectorAll('.pending-row').length;
  const badge     = document.getElementById('pending-badge');
  if (remaining === 0) {
    badge.style.display = 'none';
    document.getElementById('pending-users-list').innerHTML =
      '<p style="color:#9ca3af;font-size:13px;">No pending users. All accounts are approved.</p>';
  } else {
    badge.textContent = remaining;
  }
}

// ── Dashboard data ──
function loadDashboard() {
  const today     = new Date().toISOString().split('T')[0];
  const thirtyAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
  document.getElementById('audit-from').value = thirtyAgo;
  document.getElementById('audit-to').value   = today;

  loadSchools().then(() => {
    loadPendingUsers();
    loadAllUsers();
    loadCicoStats();
  });
  loadAuditLog();
  loadAnalytics();
  loadErrors();
  loadFeedback();
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
  const productLabel = p => ({ class_builder: 'Class Builder', cico: 'CICO' }[p] || p);
  const productColor = p => ({ class_builder: '#e0f2fe;color:#0369a1', cico: '#d1fae5;color:#065f46' }[p] || '#f3f4f6;color:#374151');

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
    ${hasMore ? `<button class="audit-load-more" onclick="loadErrors(true)">Load more (${count - _errorOffset} remaining)</button>` : ''}
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
  const productLabel = p => p === 'class_builder' ? 'Class Builder' : 'CICO';

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
  const thirtyAgo  = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const todayStart = new Date().toISOString().split('T')[0];

  const [studentsRes, checkinsRes, todayRes] = await Promise.all([
    db.from('cico_students').select('school_id'),
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
        <td><button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="wipeSchoolData('${s.id}','${escAdmin(s.name)}',${s.students})">Wipe Data</button></td>
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

function wipeSchoolData(id, name, students) {
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
          <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="confirmWipeSchoolData('${id}','${escAdmin(name)}')">Yes, wipe all data</button>
          <button class="reassign-btn" onclick="loadCicoStats()">Cancel</button>
        </div>
      </div>
    </td>`;
}

async function confirmWipeSchoolData(id, name) {
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

  // Delete all school-scoped tables in parallel
  const results = await Promise.all([
    db.from('cico_checkins').delete().eq('school_id', id),
    db.from('cico_students').delete().eq('school_id', id),
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
      <button onclick="window._resetAdminTimer();"
              style="background:#2a9d8f;border:none;color:#fff;padding:6px 14px;
                     border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;">
        Stay logged in
      </button>
    </div>`;
  document.body.appendChild(banner);

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
