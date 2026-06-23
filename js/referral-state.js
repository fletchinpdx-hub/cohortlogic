/**
 * referral-state.js
 * Central state, Supabase data loading, navigation, and shared utilities
 * for the Referral Tracking app. Mirrors the CICO (checkin-state.js) patterns.
 */

// Global error capture
window.addEventListener('error', e => {
  const email = window.RefState?.profile?.email || null;
  if (typeof logError === 'function') logError('referrals', 'unhandled_error', e.message, email);
});
window.addEventListener('unhandledrejection', e => {
  const email = window.RefState?.profile?.email || null;
  if (typeof logError === 'function') logError('referrals', 'unhandled_promise', e.reason?.message || String(e.reason), email);
});

// ── Reference data: the config lists and the tables that back them ──────────
// label_field is always `label`; table drives Supabase calls + seeding.
const REF_LISTS = [
  { key: 'locations',  table: 'referral_locations',        title: 'Locations' },
  { key: 'behaviors',  table: 'referral_behaviors',        title: 'Behaviors' },
  { key: 'motivations',table: 'referral_motivations',      title: 'Perceived Motivations' },
  { key: 'actions',    table: 'referral_actions',          title: 'Actions Taken' },
  { key: 'others',     table: 'referral_others_involved',  title: 'Others Involved' },
];

// Standard federal race/ethnicity categories (used in the roster + equity reports)
const RACE_OPTIONS = [
  'American Indian/Alaskan Native',
  'Asian',
  'Black/African American',
  'Hispanic/Latino/a/e',
  'Native Hawaiian/Other Pacific Islander',
  'White',
  'Multiracial',
];

// Default options seeded per-school on first use (school can edit afterward).
const DEFAULT_LISTS = {
  locations: [
    'Classroom','Hallway/Breezeway','Cafeteria','Playground','Bathroom','Gym',
    'Library','Bus','Bus Loading Zone','Parking Lot','Common Area','Office',
    'Special Event/Assembly','Stadium/Field','Off-Campus','Other',
  ],
  behaviors: [
    'Abusive Language/Inappropriate Language','Academic Dishonesty','Arson','Bullying',
    'Defiance/Insubordination/Non-Compliance','Disrespect','Disruption','Dress Code Violation',
    'Fighting','Forgery/Theft','Harassment','Inappropriate Display of Affection',
    'Inappropriate Location/Out of Bounds','Lying/Cheating','Physical Aggression',
    'Property Damage/Vandalism','Tardy','Technology Violation','Truancy/Skipping',
    'Use/Possession of Alcohol','Use/Possession of Drugs','Use/Possession of Tobacco',
    'Use/Possession of Weapons','Other Behavior',
  ],
  motivations: [
    'Obtain Peer Attention','Obtain Adult Attention','Obtain Items/Activities',
    'Avoid Peer(s)','Avoid Adult(s)','Avoid Task/Activity','Don’t Know/Unclear','Other',
  ],
  actions: [
    'Conference with Student','Parent Contact','Loss of Privilege','Time in Office',
    'Individualized Instruction','Detention','In-School Suspension',
    'Out-of-School Suspension (1-3 days)','Out-of-School Suspension (4+ days)',
    'Bus Suspension','Restitution','Saturday School','Counseling Referral','Expulsion','Other',
  ],
  others: [
    'None','Peers','Teacher','Staff','Substitute','Unknown','Other',
  ],
};

// ── Central state ───────────────────────────────────────────────────────────
const RefState = {
  currentUser: null,
  profile:     null,
  schoolId:    null,
  role:        null,    // 'user' | 'school_admin' | 'super_admin'
  isReviewer:  false,   // school_admin / super_admin — sees the Review queue + reviewer settings
  locations:   [],
  behaviors:   [],
  motivations: [],
  actions:     [],
  others:      [],
  customFields: [],     // [{id, label, sort_order, options:[{id, label, sort_order}]}]
  settings:    { default_reviewer_id: null },
  schoolStaff: [],      // approved staff at this school (for the reviewer dropdown; admins only)
  students:    [],      // shared roster: {id, first_name, last_name, grade, homeroom, student_ref, race_ethnicity, gender, iep, active}
};

// ── Navigation ───────────────────────────────────────────────────────────────
function refNavigateTo(view) {
  document.querySelectorAll('.cico-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.cico-view').forEach(el => el.classList.remove('active'));

  const navEl  = document.querySelector(`.cico-nav-item[data-view="${view}"]`);
  const viewEl = document.getElementById(`view-${view}`);
  if (navEl)  navEl.classList.add('active');
  if (viewEl) viewEl.classList.add('active');

  if (view === 'students') renderRefStudentList();
  if (view === 'settings') renderRefSettings();
  if (view === 'list')     loadReferrals();
  if (view === 'reports')  initReportsView();
  if (view === 'review')   loadReviewQueue();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function refToast(msg, type = 'success') {
  const el = document.getElementById('cico-toast');
  el.textContent = msg;
  el.className = `cico-toast ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => { el.classList.add('hidden'); }, 3000);
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function refTodayISO() { return new Date().toISOString().split('T')[0]; }
function refFormatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function refFormatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h, 10);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const h12 = hr % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

// Small HTML escaper for any user-supplied text rendered into innerHTML.
function refEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Seed default config lists for a brand-new school ───────────────────────────
async function seedDefaultList(table, defaults) {
  const rows = defaults.map((label, i) => ({
    school_id: RefState.schoolId, label, sort_order: i, active: true,
  }));
  const { data, error } = await SupabaseClient.from(table).insert(rows).select();
  if (error) { console.warn('Seed failed for', table, error.message); return []; }
  return data || [];
}

// ── Load all reference data ────────────────────────────────────────────────────
async function loadRefData() {
  try {
    const { data: profile } = await SupabaseClient
      .from('profiles').select('school_id, full_name, school_name, role').eq('id', RefState.currentUser.id).single();
    RefState.profile    = { ...profile, email: RefState.currentUser.email };
    RefState.schoolId   = profile?.school_id || null;
    RefState.role       = profile?.role || 'user';
    RefState.isReviewer = ['school_admin', 'super_admin'].includes(RefState.role);

    // RLS scopes everything to my_school_id(); the order makes lists stable.
    const fetches = REF_LISTS.map(l =>
      SupabaseClient.from(l.table).select('*').order('sort_order').order('label'));
    fetches.push(SupabaseClient.from('students').select('*').eq('active', true).order('last_name').order('first_name'));
    fetches.push(SupabaseClient.from('referral_custom_fields').select('*').eq('active', true).order('sort_order'));
    fetches.push(SupabaseClient.from('referral_custom_field_options').select('*').eq('active', true).order('sort_order'));
    fetches.push(SupabaseClient.from('referral_settings').select('*').maybeSingle());

    const results = await Promise.all(fetches);

    // Map config lists into state, seeding any that are empty.
    for (let i = 0; i < REF_LISTS.length; i++) {
      const l = REF_LISTS[i];
      let rows = results[i].data || [];
      if (rows.length === 0 && RefState.schoolId && DEFAULT_LISTS[l.key]) {
        rows = await seedDefaultList(l.table, DEFAULT_LISTS[l.key]);
      }
      RefState[l.key] = rows;
    }
    RefState.students = results[REF_LISTS.length].data || [];

    // Custom fields: nest each field's options under it.
    const fields  = results[REF_LISTS.length + 1].data || [];
    const options = results[REF_LISTS.length + 2].data || [];
    fields.forEach(f => { f.options = options.filter(o => o.field_id === f.id); });
    RefState.customFields = fields;

    RefState.settings = results[REF_LISTS.length + 3].data || { default_reviewer_id: null };

    // Reviewers (admins) also load the school staff list for the default-reviewer
    // picker. RLS lets admins read their school's profiles; plain users can't, so
    // we only attempt it for reviewers.
    if (RefState.isReviewer && RefState.schoolId) {
      const { data: staff } = await SupabaseClient
        .from('profiles').select('id, full_name, email')
        .eq('school_id', RefState.schoolId).eq('approved', true)
        .order('full_name');
      RefState.schoolStaff = staff || [];
    }

  } catch (err) {
    console.error('Failed to load referral data:', err);
    refToast('Failed to load data. Please refresh.', 'error');
  }
}

// ── Full-screen access-denied (referrals not enabled for this user) ───────────
function renderRefAccessDenied() {
  const overlay = document.createElement('div');
  overlay.id = 'ref-access-denied';
  overlay.innerHTML = `
    <div style="position:fixed;inset:0;background:#f8fafc;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;font-family:Nunito,sans-serif;">
      <div style="max-width:460px;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:40px 32px;box-shadow:0 4px 24px rgba(0,0,0,.06);">
        <div style="font-size:40px;margin-bottom:12px;">🔒</div>
        <h1 style="font-size:20px;color:#1e3a5f;margin:0 0 10px;">Referral Tracking isn't enabled for your account</h1>
        <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.5;">Your school administrator decides who can use this tool. Ask them to enable Referral Tracking for you, then sign back in.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
          <a href="dashboard.html" style="background:#2a9d8f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;">Back to Dashboard</a>
          <button id="ref-denied-signout" style="background:#fff;border:1px solid #e5e7eb;color:#374151;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">Sign Out</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('ref-denied-signout').addEventListener('click', async () => {
    try { await SupabaseClient.auth.signOut(); } catch (e) {}
    window.location.replace('login.html');
  });
}

// ── Event binding (CSP-safe: no inline handlers) ──────────────────────────────
function bindRefEvents() {
  document.querySelectorAll('.cico-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      refNavigateTo(item.dataset.view);
      document.getElementById('cico-sidebar').classList.remove('menu-open');
    });
  });
  const mobileBtn = document.getElementById('cico-mobile-btn');
  if (mobileBtn) mobileBtn.addEventListener('click', () =>
    document.getElementById('cico-sidebar').classList.toggle('menu-open'));

  // Each feature module binds its own listeners.
  if (typeof bindEntryEvents   === 'function') bindEntryEvents();
  if (typeof bindStudentEvents === 'function') bindStudentEvents();
  if (typeof bindConfigEvents  === 'function') bindConfigEvents();
  if (typeof bindListEvents    === 'function') bindListEvents();
  if (typeof bindReportEvents  === 'function') bindReportEvents();
  if (typeof bindReviewEvents  === 'function') bindReviewEvents();
}

// Show/hide reviewer-only UI (Review nav item + admin settings) based on role.
function applyReviewerVisibility() {
  const reviewNav = document.querySelector('.cico-nav-item[data-view="review"]');
  if (reviewNav) reviewNav.style.display = RefState.isReviewer ? '' : 'none';
  document.body.classList.toggle('ref-reviewer', RefState.isReviewer);
  if (RefState.isReviewer && typeof refreshReviewBadge === 'function') refreshReviewBadge();
}

// ── App bootstrap ─────────────────────────────────────────────────────────────
async function initRefApp() {
  const { data: { session } } = await SupabaseClient.auth.getSession();
  if (!session) { window.location.replace('login.html'); return; }
  RefState.currentUser = session.user;

  // Tool-access gate. RLS enforces this at the data layer too; this just gives a
  // denied user a clear message instead of an empty app. Fail-open on error/null.
  const { data: hasReferrals } = await SupabaseClient.rpc('can_access_product', { p: 'referrals' });
  if (hasReferrals === false) { renderRefAccessDenied(); return; }

  await loadRefData();
  bindRefEvents();
  applyReviewerVisibility();
  if (typeof initEntryView === 'function') initEntryView();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initRefApp);
} else {
  initRefApp();
}

// ── Inactivity session timeout (15 min, mirrors CICO) ─────────────────────────
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
      <button id="ref-stay-logged-in"
              style="background:#2a9d8f;border:none;color:#fff;padding:6px 14px;
                     border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;">
        Stay logged in
      </button>
    </div>`;
  document.body.appendChild(banner);

  let _warnTimer = null, _logoutTimer = null;
  window._resetSessionTimer = function () {
    clearTimeout(_warnTimer); clearTimeout(_logoutTimer);
    banner.style.display = 'none';
    _warnTimer   = setTimeout(() => { banner.style.display = 'block'; }, TIMEOUT_MS - WARN_MS);
    _logoutTimer = setTimeout(async () => {
      await SupabaseClient.auth.signOut();
      window.location.replace('login.html');
    }, TIMEOUT_MS);
  };
  document.getElementById('ref-stay-logged-in').addEventListener('click', window._resetSessionTimer);
  ['click', 'keydown', 'touchstart', 'scroll'].forEach(evt =>
    document.addEventListener(evt, window._resetSessionTimer, { passive: true }));
  window._resetSessionTimer();
})();
