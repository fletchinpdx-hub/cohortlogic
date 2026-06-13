// ═══════════════════════════════════════════════════════════════════════
// Cohort Logic — School Admin panel
// A school admin manages ONLY their own school: approve/deactivate/remove
// staff and control which tools (products) each person can use.
//
// All user mutations go through SECURITY DEFINER RPCs (approve_school_user,
// set_school_user_active, remove_school_user, set_user_product_override,
// set_school_products) — the client has no direct write access to profiles.
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://dlqnzlwuzktcljxxxlit.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe';

let db;
try {
  db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.error('Supabase init failed:', e);
}

// Current admin context, populated by verifyAndLoad()
let _me = { id: null, role: null, schoolId: null, schoolName: '', enabledProducts: [] };

// ── Auth state ──
// ⚠️  Same constraint as the main admin panel: this handler MUST stay
//     synchronous. Do not make it async or await inside it — Supabase cannot
//     finish processing auth state while the handler is blocked, which causes
//     a silent login freeze on refresh. All async work lives in verifyAndLoad().
if (db) {
  db.auth.onAuthStateChange((event, session) => {
    if (!session) { showLogin(); return; }
    verifyAndLoad(session); // fire-and-forget
  });
}

async function verifyAndLoad(session) {
  const { data: profile, error } = await db
    .from('profiles')
    .select('role, school_id')
    .eq('id', session.user.id)
    .single();

  if (error || !profile || !['school_admin', 'super_admin'].includes(profile.role)) {
    await db.auth.signOut();
    showLogin();
    showLoginAlert('Access denied. This panel is for school administrators only.', 'error');
    return;
  }

  _me.id      = session.user.id;
  _me.role    = profile.role;
  _me.schoolId = profile.school_id;

  showDashboard(session.user.email);

  if (!_me.schoolId) {
    // School admin with no school assigned — nothing to manage.
    document.getElementById('no-school-notice').classList.remove('hidden');
    document.getElementById('school-subtitle').textContent = '';
    return;
  }

  loadSchoolMeta().then(loadAll);
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

// ── Auth actions ──
async function signIn() {
  const email    = document.getElementById('email-input').value.trim();
  const password = document.getElementById('password-input').value;
  if (!email || !password) { showLoginAlert('Please enter your email and password.', 'error'); return; }
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) showLoginAlert('Incorrect email or password.', 'error');
}

let _magicLinkVisible = false;
function toggleMagicLink() {
  _magicLinkVisible = !_magicLinkVisible;
  document.getElementById('magic-link-section').style.display = _magicLinkVisible ? 'block' : 'none';
}

async function sendMagicLink() {
  const email = document.getElementById('email-input').value.trim();
  if (!email) { showLoginAlert('Enter your email above first.', 'error'); return; }
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://cohortlogic.com/school-admin/',
  });
  showLoginAlert(error ? error.message : `Link sent to ${email} — check your inbox.`, error ? 'error' : 'success');
}

async function doLogout() {
  try { await db.auth.signOut({ scope: 'global' }); } catch (e) {}
  localStorage.clear();
  sessionStorage.clear();
  window.location.href = window.location.href.split('#')[0];
}

// ── Data loading ──
async function loadSchoolMeta() {
  const { data, error } = await db
    .from('schools')
    .select('id, name, enabled_products')
    .eq('id', _me.schoolId)
    .single();

  if (error || !data) {
    _me.schoolName = '';
    _me.enabledProducts = [];
    return;
  }
  _me.schoolName      = data.name || '';
  _me.enabledProducts = data.enabled_products || [];

  document.getElementById('school-title').textContent    = _me.schoolName || 'Your School';
  document.getElementById('school-subtitle').textContent = 'Manage staff access and tools for your school.';
}

function loadAll() {
  renderToolSettings();
  loadPending();
  loadUsers();
}

// ── Tool settings (school-wide default) ──
function renderToolSettings() {
  const wrap    = document.getElementById('tool-settings');
  const cicoOn  = _me.enabledProducts.includes('cico');
  wrap.innerHTML = `
    <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer;">
      <input type="checkbox" id="cico-school-toggle" ${cicoOn ? 'checked' : ''}
             onchange="toggleSchoolCico(this.checked)" style="width:18px;height:18px;cursor:pointer;" />
      <span><strong>Check-in / Check-out (CICO)</strong> — enabled for everyone at your school</span>
    </label>
    <p style="font-size:12px;color:#9ca3af;margin-top:8px;">Class Builder is always available and isn't restricted here.</p>`;
}

async function toggleSchoolCico(on) {
  const products = on ? ['cico'] : [];
  const { error } = await db.rpc('set_school_products', { products });
  if (error) { alert('Error updating tools: ' + error.message); renderToolSettings(); return; }
  _me.enabledProducts = products;
  renderToolSettings();
  loadUsers(); // refresh the "school default" labels in the per-user controls
}

// ── Pending approvals (this school) ──
async function loadPending() {
  const container = document.getElementById('pending-users-list');
  const badge     = document.getElementById('pending-badge');

  const { data, error } = await db
    .from('profiles')
    .select('id, full_name, email, created_at')
    .eq('school_id', _me.schoolId)
    .eq('approved', false)
    .order('created_at', { ascending: true });

  if (error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load pending users: ${esc(error.message)}</p>`;
    return;
  }
  if (!data || !data.length) {
    badge.style.display = 'none';
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No one is waiting for approval.</p>';
    return;
  }

  badge.textContent = data.length;
  badge.style.display = 'inline';

  container.innerHTML = data.map(u => {
    const date = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `
      <div class="pending-row" id="prow-${u.id}">
        <div class="pending-info">
          <strong>${esc(u.full_name || '(no name)')}</strong>
          ${u.email ? `<a href="mailto:${esc(u.email)}" style="font-size:12px;color:#6b7280;display:block;margin-top:2px;">${esc(u.email)}</a>` : ''}
          <div class="meta">Signed up ${date}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          <button class="approve-btn" onclick="approvePending('${u.id}')">Approve</button>
          <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="declinePending('${u.id}','${esc(u.full_name || 'this user')}')">Decline</button>
        </div>
      </div>`;
  }).join('');
}

async function approvePending(id) {
  const btn = document.querySelector(`#prow-${id} .approve-btn`);
  if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
  const { error } = await db.rpc('approve_school_user', { target: id });
  if (error) { alert('Error approving: ' + error.message); if (btn) { btn.disabled = false; btn.textContent = 'Approve'; } return; }
  const row = document.getElementById(`prow-${id}`);
  if (row) row.remove();
  refreshPendingBadge();
  loadUsers();
}

function declinePending(id, name) {
  const row = document.getElementById(`prow-${id}`);
  if (!row) return;
  row.innerHTML = `
    <div class="pending-info">
      <strong>${esc(name)}</strong>
      <div class="meta" style="color:var(--red);">Decline this request? They'll be removed from your school and won't get access.</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="confirmDecline('${id}')">Yes, decline</button>
      <button class="reassign-btn" onclick="loadPending()">Cancel</button>
    </div>`;
}

async function confirmDecline(id) {
  const { error } = await db.rpc('remove_school_user', { target: id });
  if (error) { alert('Error: ' + error.message); return; }
  const row = document.getElementById(`prow-${id}`);
  if (row) row.remove();
  refreshPendingBadge();
}

function refreshPendingBadge() {
  const remaining = document.querySelectorAll('.pending-row').length;
  const badge     = document.getElementById('pending-badge');
  if (remaining === 0) {
    badge.style.display = 'none';
    document.getElementById('pending-users-list').innerHTML =
      '<p style="color:#9ca3af;font-size:13px;">No one is waiting for approval.</p>';
  } else {
    badge.textContent = remaining;
  }
}

// ── Staff (approved users at this school) ──
async function loadUsers() {
  const container = document.getElementById('users-list');

  const { data: users, error } = await db
    .from('profiles')
    .select('id, full_name, email, approved, role, product_overrides, created_at')
    .eq('school_id', _me.schoolId)
    .eq('approved', true)
    .order('full_name', { ascending: true });

  if (error) {
    container.innerHTML = `<p style="color:#ef4444;font-size:13px;">Could not load staff: ${esc(error.message)}</p>`;
    return;
  }
  if (!users || !users.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No approved staff yet.</p>';
    return;
  }

  const defaultLabel = _me.enabledProducts.includes('cico') ? 'Allowed' : 'Denied';

  const rows = users.map(u => {
    const date    = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const isAdmin = u.role !== 'user';
    const access  = cicoAccessValue(u);
    const sel = `
      <select id="cico-sel-${u.id}" onchange="setUserCico('${u.id}', this.value)" style="padding:6px 8px;border:1px solid var(--gray-300);border-radius:7px;font-size:13px;font-family:inherit;">
        <option value="inherit" ${access === 'inherit' ? 'selected' : ''}>School default (${defaultLabel})</option>
        <option value="allow"   ${access === 'allow'   ? 'selected' : ''}>Allowed</option>
        <option value="deny"    ${access === 'deny'    ? 'selected' : ''}>Denied</option>
      </select>`;

    const roleBadge = u.role === 'super_admin'
      ? '<span style="background:#1e3a5f;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;margin-left:6px;">Super Admin</span>'
      : u.role === 'school_admin'
      ? '<span style="background:#0e7490;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;margin-left:6px;">School Admin</span>'
      : '';

    const actions = isAdmin
      ? '<span style="font-size:12px;color:#9ca3af;">—</span>'
      : `<div style="display:flex;gap:6px;flex-wrap:wrap;">
           <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="deactivateUser('${u.id}','${esc(u.full_name || 'this user')}')">Deactivate</button>
           <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="removeUser('${u.id}','${esc(u.full_name || 'this user')}')">Remove</button>
         </div>`;

    return `
      <tr id="urow-${u.id}">
        <td>
          <strong>${esc(u.full_name || '(no name)')}</strong>${roleBadge}
          ${u.email ? `<br><a href="mailto:${esc(u.email)}" style="font-size:11px;color:#6b7280;">${esc(u.email)}</a>` : ''}
        </td>
        <td>${isAdmin ? '<span style="font-size:12px;color:#9ca3af;">—</span>' : sel}</td>
        <td style="font-size:11px;color:#9ca3af;">${date}</td>
        <td>${actions}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <div style="overflow-x:auto;">
      <table class="users-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>CICO Access</th>
            <th>Joined</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// 'inherit' (no override) | 'allow' | 'deny'
function cicoAccessValue(u) {
  const ov = u.product_overrides || {};
  if (Object.prototype.hasOwnProperty.call(ov, 'cico')) return ov.cico ? 'allow' : 'deny';
  return 'inherit';
}

async function setUserCico(id, access) {
  const sel = document.getElementById(`cico-sel-${id}`);
  if (sel) sel.disabled = true;
  const { error } = await db.rpc('set_user_product_override', { target: id, product: 'cico', access });
  if (sel) sel.disabled = false;
  if (error) { alert('Error updating access: ' + error.message); loadUsers(); }
}

function deactivateUser(id, name) {
  const row = document.getElementById(`urow-${id}`);
  if (!row) return;
  row.innerHTML = `
    <td colspan="4">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;flex-wrap:wrap;">
        <span style="font-size:13px;">Deactivate <strong>${esc(name)}</strong>? They lose access immediately but stay on your school's list.</span>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="confirmDeactivate('${id}')">Yes, deactivate</button>
          <button class="reassign-btn" onclick="loadUsers()">Cancel</button>
        </div>
      </div>
    </td>`;
}

async function confirmDeactivate(id) {
  const { error } = await db.rpc('set_school_user_active', { target: id, active: false });
  if (error) { alert('Error: ' + error.message); return; }
  loadUsers();
  loadPending(); // deactivated users reappear in the pending list for re-approval
}

function removeUser(id, name) {
  const row = document.getElementById(`urow-${id}`);
  if (!row) return;
  row.innerHTML = `
    <td colspan="4">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;flex-wrap:wrap;">
        <span style="font-size:13px;">Remove <strong>${esc(name)}</strong> from your school entirely? They'll need to be reassigned by a Cohort Logic admin to return.</span>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button class="reassign-btn" style="color:var(--red);border-color:#fca5a5;" onclick="confirmRemove('${id}')">Yes, remove</button>
          <button class="reassign-btn" onclick="loadUsers()">Cancel</button>
        </div>
      </div>
    </td>`;
}

async function confirmRemove(id) {
  const { error } = await db.rpc('remove_school_user', { target: id });
  if (error) { alert('Error: ' + error.message); return; }
  const row = document.getElementById(`urow-${id}`);
  if (row) row.remove();
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Inactivity session timeout (15 min, mirrors the main admin panel) ──
(function () {
  const TIMEOUT_MS = 15 * 60 * 1000;
  const WARN_MS    =      60 * 1000;

  const banner = document.createElement('div');
  banner.id = 'session-timeout-banner';
  banner.style.display = 'none';
  banner.innerHTML = `
    <div style="position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
                background:#1e3a5f;color:#fff;padding:14px 20px;border-radius:10px;
                font-size:14px;font-family:inherit;box-shadow:0 4px 20px rgba(0,0,0,.3);
                display:flex;align-items:center;gap:14px;z-index:9999;white-space:nowrap;">
      <span>⏱ You'll be logged out in 60 seconds due to inactivity.</span>
      <button onclick="window._resetSchoolAdminTimer();"
              style="background:#2a9d8f;border:none;color:#fff;padding:6px 14px;
                     border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;">
        Stay logged in
      </button>
    </div>`;
  document.body.appendChild(banner);

  let _warnTimer = null, _logoutTimer = null;

  window._resetSchoolAdminTimer = function () {
    clearTimeout(_warnTimer);
    clearTimeout(_logoutTimer);
    banner.style.display = 'none';
    _warnTimer   = setTimeout(() => { banner.style.display = 'block'; }, TIMEOUT_MS - WARN_MS);
    _logoutTimer = setTimeout(() => doLogout(), TIMEOUT_MS);
  };

  ['click', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
    document.addEventListener(evt, window._resetSchoolAdminTimer, { passive: true })
  );

  if (db) {
    db.auth.onAuthStateChange((event, session) => {
      if (session) window._resetSchoolAdminTimer();
    });
  }
})();
