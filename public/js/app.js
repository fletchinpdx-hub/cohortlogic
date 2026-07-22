// Start tracking this session
if (typeof trackSession === 'function') trackSession();

// Global error capture for Class Builder
window.addEventListener('error', e => {
  if (typeof logError === 'function') logError('class_builder', 'unhandled_error', e.message);
});
window.addEventListener('unhandledrejection', e => {
  if (typeof logError === 'function') logError('class_builder', 'unhandled_promise', e.reason?.message || String(e.reason));
});

// Central app state
const AppState = {
  schoolName: '',
  district:   '',
  rawRows: [],         // raw rows from spreadsheet
  rawHeaders: [],      // column headers from spreadsheet
  students: [],        // mapped + parsed students
  separations:      [],  // [{a: id, b: id}]  — must be in different classes
  togethers:        [],  // [{a: id, b: id}]  — must be in the same class
  keepWithTeacher:  [],  // [{studentId, grade, classIndex}] — pinned to a specific class
  displayMode: 'name', // 'name' | 'id'  — how students are labelled in the UI
  competencies: [      // configurable scoring fields
    { name: 'Math',      type: 'score',    column: '', min: 1, max: 5, direction: 'asc' },
    { name: 'Reading',   type: 'score',    column: '', min: 1, max: 5, direction: 'asc' },
    { name: 'Writing',   type: 'score',    column: '', min: 1, max: 5, direction: 'asc' },
    { name: 'Behavior',  type: 'score',    column: '', min: 1, max: 5, direction: 'asc', priority: true },
    { name: 'IEP',       type: 'flag',     column: '' },
    { name: '504',       type: 'flag',     column: '' },
    { name: 'Gender',    type: 'category', column: '', priority: true },
    { name: 'Ethnicity', type: 'category', column: '' },
  ],
  columnMap: {         // required field -> spreadsheet column
    firstName:  '',
    lastName:   '',
    grade:      '',
    studentId:  '',    // optional
  },
  gradeConfig: {},     // { 'K': { classCount: 3, teachers: ['Ms. Smith', ...] }, ... }
  splitClasses: [],    // [{ id, grades: ['3','4'], teacher: '' }]
  results: {},         // { 'K': [ [students], [students], ... ], ... }
  splitResults: [],    // [{ id, grades, teacher, students: [] }]

  // Unified file passthrough — SB data preserved across CB save/load
  _schedTools:      [],    // _tools from loaded unified file
  _schedBlockTypes: [],    // blockTypes from the file (SB data)
  _schedData:       null,  // schedule namespace from the file (SB data)
};

// Navigation
function navigateTo(view) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  document.getElementById(`view-${view}`).classList.add('active');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const view = item.dataset.view;
    navigateTo(view);
    // Re-render results whenever the Results tab is opened, so it stays in sync
    if (view === 'fields' && AppState.rawHeaders.length) renderFieldMapping();
    if (view === 'results' && Object.keys(AppState.results).length) renderResults();
    // Close mobile menu after navigating
    document.getElementById('sidebar').classList.remove('menu-open');
  });
});

// Mobile sidebar toggle
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('menu-open');
  });
}

// Sidebar status updater
function updateSidebarStatus() {
  const studEl = document.getElementById('status-students-text');
  const classDot = document.querySelector('#status-classes .status-dot');
  const classEl = document.getElementById('status-classes-text');
  const studDot = document.querySelector('#status-students .status-dot');

  if (AppState.students.length > 0) {
    studEl.textContent = `${AppState.students.length} students loaded`;
    studDot.classList.add('green');
  } else {
    studEl.textContent = 'No students loaded';
    studDot.classList.remove('green');
  }

  const gradeCount = Object.keys(AppState.gradeConfig).length;
  if (gradeCount > 0) {
    classEl.textContent = `${gradeCount} grades configured`;
    classDot.classList.add('blue');
  } else {
    classEl.textContent = 'No classes configured';
    classDot.classList.remove('blue');
  }
}

// Show import status message
function showImportStatus(msg, type = 'info') {
  const el = document.getElementById('import-status');
  el.textContent = msg;
  el.className = `import-status ${type}`;
  el.classList.remove('hidden');
}

// Get unique grades from students, sorted
function getGrades() {
  const grades = [...new Set(AppState.students.map(s => s.grade))];
  return grades.sort((a, b) => gradeOrder(a) - gradeOrder(b));
}

function gradeOrder(g) {
  const upper = (g || '').toUpperCase();
  const map = { 'K': 0, 'TK': -1, 'PK': -2 };
  if (map[upper] !== undefined) return map[upper];
  return parseInt(g) || 99;
}

// "K" → "K", "TK" → "TK", "3" → "Grade 3", "10" → "Grade 10"
function gradeLabel(g) {
  return /^[A-Za-z]+$/.test(g) ? g.toUpperCase() : `Grade ${g}`;
}

// ── Trial / entitlement gating (see js/entitlements.js) ───────────────────────
// A full (paid) plan works with every grade; a trial works with only the unlocked
// "1st grade". These are the single levers the gated views + the algorithm read.
function cbFull() { return typeof Entitlements === 'undefined' || Entitlements.isFull(); }
function activeGrades() {
  const all = getGrades();
  if (cbFull()) return all;
  const g = Entitlements.unlockedGrade(all);
  return g ? [g] : [];
}
// True when a grade is visible-but-locked in a trial (shown greyed to entice upgrade).
function isGradeLocked(g) {
  return !cbFull() && typeof Entitlements !== 'undefined' && !Entitlements.isTrialGrade(g);
}
// Small inline "locked — upgrade" ribbon for a card/section header.
function cbLockRibbon(label) {
  return `<div class="cb-lock-note">🔒 ${label} <a href="pricing.html" target="_blank" rel="noopener">See plans →</a></div>`;
}
// Modal shown when a trial user triggers a gated ACTION (export / save). Emits a
// telemetry gate-hit and offers the upgrade path.
function showUpgradeModal(feature, title, body) {
  if (typeof Entitlements !== 'undefined') Entitlements.gateHit(feature);
  document.getElementById('cb-upgrade-modal')?.remove();
  const el = document.createElement('div');
  el.id = 'cb-upgrade-modal';
  el.className = 'cb-upgrade-overlay';
  el.innerHTML = `
    <div class="cb-upgrade-card" role="dialog" aria-modal="true">
      <div class="cb-upgrade-lock">🔒</div>
      <h2>${title}</h2>
      <p>${body}</p>
      <div class="cb-upgrade-actions">
        <a class="btn btn-primary" href="pricing.html" target="_blank" rel="noopener">See plans &amp; pricing</a>
        <button class="btn btn-outline" id="cb-upgrade-close">Not now</button>
      </div>
    </div>`;
  el.addEventListener('click', e => { if (e.target === el) el.remove(); });
  document.body.appendChild(el);
  document.getElementById('cb-upgrade-close').addEventListener('click', () => el.remove());
}
// Full-screen wall when a time-limited trial has expired (hard lockout).
function renderTrialLockout() {
  if (document.getElementById('cb-trial-lockout')) return;
  const el = document.createElement('div');
  el.id = 'cb-trial-lockout';
  el.className = 'cb-lockout-overlay';
  el.innerHTML = `
    <div class="cb-lockout-card">
      <div class="cb-upgrade-lock">🔒</div>
      <h1>Your free trial has ended</h1>
      <p>Thanks for trying Class Builder. Upgrade to a paid plan to keep building balanced classes for every grade — and to export, print, and save your work.</p>
      <div class="cb-upgrade-actions">
        <a class="btn btn-primary" href="pricing.html" target="_blank" rel="noopener">See plans &amp; pricing</a>
        <a class="btn btn-outline" href="dashboard.html">← Back to dashboard</a>
      </div>
    </div>`;
  document.body.appendChild(el);
}
// Persistent strip while on a trial: what's unlocked + days remaining.
function renderTrialBanner() {
  if (cbFull() || typeof Entitlements === 'undefined' || !Entitlements.isTrial()) return;
  if (document.getElementById('cb-trial-banner')) return;
  const days = Entitlements.daysLeft();
  const left = days == null ? '' : ` · ${days} day${days === 1 ? '' : 's'} left`;
  const bar = document.createElement('div');
  bar.id = 'cb-trial-banner';
  bar.className = 'cb-trial-banner';
  bar.innerHTML = `<span>🎓 <strong>Free trial</strong> — 1st grade only; export, print &amp; save are off${left}.</span>
    <a href="pricing.html" target="_blank" rel="noopener">Upgrade to unlock everything →</a>`;
  document.getElementById('main')?.prepend(bar);
}
// Apply entitlement chrome once the real state is known.
function applyEntitlementUI() {
  if (typeof Entitlements === 'undefined') return;
  if (Entitlements.isExpired()) { renderTrialLockout(); return; }
  renderTrialBanner();
}

// Feedback modal moved to the shared js/feedback.js widget (loaded on every product).

// Returns the display label for a student based on the current displayMode.
// Falls back to studentId when no name is available (ID-only datasets).
function studentLabel(s) {
  if (AppState.displayMode === 'id' && s.studentId) return s.studentId;
  const name = `${s.firstName} ${s.lastName}`.trim();
  return name || s.studentId || `Student ${s.id}`;
}

// ── School Profile view ───────────────────────────────────────────────────────
function syncSchoolProfileInputs() {
  const nameEl = document.getElementById('cb-school-name');
  const distEl = document.getElementById('cb-district');
  if (nameEl) nameEl.value = AppState.schoolName || '';
  if (distEl) distEl.value = AppState.district   || '';
}

document.addEventListener('DOMContentLoaded', () => {
  syncSchoolProfileInputs();

  // Load the server-authoritative entitlement, then apply trial chrome / lockout.
  if (typeof Entitlements !== 'undefined') Entitlements.load().then(applyEntitlementUI);

  document.getElementById('cb-school-next-btn').addEventListener('click', () => {
    AppState.schoolName = (document.getElementById('cb-school-name').value || '').trim();
    AppState.district   = (document.getElementById('cb-district').value   || '').trim();
    navigateTo('import');
  });

  // Persist school name/district on input change so navigating away doesn't lose it
  document.getElementById('cb-school-name').addEventListener('input', e => { AppState.schoolName = e.target.value.trim(); });
  document.getElementById('cb-district').addEventListener('input',   e => { AppState.district   = e.target.value.trim(); });

  // Import school profile from a Schedule Builder .clsched file
  const schedInput = document.getElementById('cb-import-sched-input');
  document.getElementById('cb-import-sched-link').addEventListener('click', e => {
    e.preventDefault();
    schedInput.click();
  });
  schedInput.addEventListener('change', () => {
    const file = schedInput.files[0];
    if (!file) return;
    schedInput.value = '';
    loadCohortFile(file);
  });
});

// Primary helper: build CB's gradeConfig + splitClasses from a staff[] array.
// staff[] is the unified file's source of truth for classroom teachers.
function applyStaffToCB(staff, grades) {
  (grades || []).forEach(g => {
    if (!AppState.gradeConfig[g]) AppState.gradeConfig[g] = { classCount: 1, teachers: [] };
  });
  (staff || [])
    .filter(s => s.role === 'classroom_teacher' && s.gradeAssignment && !s.splitGrade)
    .forEach(s => {
      const g = s.gradeAssignment;
      if (!AppState.gradeConfig[g]) AppState.gradeConfig[g] = { classCount: 0, teachers: [] };
      if (!AppState.gradeConfig[g].teachers) AppState.gradeConfig[g].teachers = [];
      if (s.name && !AppState.gradeConfig[g].teachers.includes(s.name)) {
        AppState.gradeConfig[g].teachers.push(s.name);
        AppState.gradeConfig[g].classCount = AppState.gradeConfig[g].teachers.length;
      }
    });
  (staff || [])
    .filter(s => s.role === 'classroom_teacher' && s.gradeAssignment && s.splitGrade)
    .forEach(s => {
      const exists = AppState.splitClasses.some(sc => sc.id === s.id || sc.teacher === s.name);
      if (!exists) {
        AppState.splitClasses.push({
          id:      s.id || ('split_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
          grades:  [s.gradeAssignment, s.splitGrade],
          teacher: s.name || '',
        });
      }
    });
}

// Legacy wrapper — used by old .clsched import flow; delegates to applyStaffToCB.
function applySchoolProfileToCB(sp) {
  if (!sp) return;
  if (sp.schoolName) AppState.schoolName = sp.schoolName;
  if (sp.district)   AppState.district   = sp.district;
  applyStaffToCB(sp.staff || [], sp.grades || []);
  updateSidebarStatus();
}
