/**
 * checkin-state.js
 * Central state, Supabase data loading, navigation, and shared utilities
 * for the Check-in / Check-out app.
 */

// ── Central state ──────────────────────────────────────────────────────────
const CicoState = {
  currentUser: null,        // Supabase auth user object
  schoolId:    null,        // UUID of the user's school (null until assigned by admin)
  settings:    { id: null, period_count: 8 },
  categories:  [],          // [{id, name, display_order, active}]
  incidentTypes: [],        // [{id, abbreviation, description, tracks_minutes}]
  students:    [],          // [{id, first_name, last_name, grade, homeroom, student_ref, active}]

  // Entry form working state
  entry: {
    studentId:   null,
    studentName: '',
    date:        '',
    notes:       '',
    // periods: { 1: { scores: { catId: null|0|1|2 }, incidents: [...] }, ... }
    periods:     {}
  },

  // Pending incident modal state
  _pendingIncident: { period: null }
};

// ── Navigation ─────────────────────────────────────────────────────────────
function cicoNavigateTo(view) {
  document.querySelectorAll('.cico-nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.cico-view').forEach(el => el.classList.remove('active'));

  const navEl = document.querySelector(`.cico-nav-item[data-view="${view}"]`);
  const viewEl = document.getElementById(`view-${view}`);
  if (navEl) navEl.classList.add('active');
  if (viewEl) viewEl.classList.add('active');

  // Lazy-render views that need it
  if (view === 'history')  initHistoryView();
  if (view === 'students') renderStudentList();
  if (view === 'reports')  initReportsView();
  if (view === 'settings') renderSettings();
}

document.querySelectorAll('.cico-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    cicoNavigateTo(item.dataset.view);
    document.getElementById('cico-sidebar').classList.remove('menu-open');
  });
});

// Mobile menu toggle
const _mobileBtn = document.getElementById('cico-mobile-btn');
if (_mobileBtn) {
  _mobileBtn.addEventListener('click', () => {
    document.getElementById('cico-sidebar').classList.toggle('menu-open');
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.getElementById('cico-toast');
  el.textContent = msg;
  el.className = `cico-toast ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => { el.classList.add('hidden'); }, 3000);
}

// ── Date helpers ───────────────────────────────────────────────────────────
function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Load all reference data from Supabase ──────────────────────────────────
async function loadCicoData() {
  try {
    // Load user profile to get school_id
    const { data: profile } = await SupabaseClient
      .from('profiles')
      .select('school_id')
      .eq('id', CicoState.currentUser.id)
      .single();

    CicoState.schoolId = profile?.school_id || null;

    // All queries are automatically scoped by RLS using my_school_id().
    // The school_id filter on settings/categories/incident_types ensures
    // we get this school's config rather than another school's.
    const [settRes, catRes, incRes, studRes] = await Promise.all([
      SupabaseClient.from('cico_settings').select('*').limit(1).maybeSingle(),
      SupabaseClient.from('cico_categories').select('*').eq('active', true).order('display_order'),
      SupabaseClient.from('cico_incident_types').select('*').eq('active', true).order('display_order'),
      SupabaseClient.from('cico_students').select('*').eq('active', true).order('last_name').order('first_name')
    ]);

    if (settRes.data) {
      CicoState.settings = settRes.data;
    }
    CicoState.categories    = catRes.data  || [];
    CicoState.incidentTypes = incRes.data  || [];
    CicoState.students      = studRes.data || [];

  } catch (err) {
    console.error('Failed to load CICO data:', err);
    showToast('Failed to load data. Please refresh.', 'error');
  }
}

// ── Initialize entry periods from settings ─────────────────────────────────
function initEntryPeriods() {
  const count = CicoState.settings.period_count || 8;
  const periods = {};
  for (let p = 1; p <= count; p++) {
    const scores = {};
    CicoState.categories.forEach(cat => { scores[cat.id] = null; });
    periods[p] = { scores, incidents: [] };
  }
  CicoState.entry.periods = periods;
}

// ── App bootstrap ──────────────────────────────────────────────────────────
async function initApp() {
  // Confirm auth
  const { data: { session } } = await SupabaseClient.auth.getSession();
  if (!session) { window.location.replace('login.html'); return; }
  CicoState.currentUser = session.user;

  // Load data
  await loadCicoData();

  // Boot the entry view
  initEntryView();
}

// Kick off once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
