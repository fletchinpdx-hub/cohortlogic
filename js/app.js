// Start tracking this session
if (typeof trackSession === 'function') trackSession();

// Central app state
const AppState = {
  rawRows: [],         // raw rows from spreadsheet
  rawHeaders: [],      // column headers from spreadsheet
  students: [],        // mapped + parsed students
  separations: [],     // [{a: id, b: id}]  — must be in different classes
  togethers:   [],     // [{a: id, b: id}]  — must be in the same class
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
    navigateTo(item.dataset.view);
    // Close mobile menu after navigating
    document.getElementById('sidebar').classList.remove('menu-open');
  });
});

const _setupClassesBtn = document.getElementById('setup-classes-btn');
if (_setupClassesBtn) _setupClassesBtn.addEventListener('click', () => navigateTo('classes'));

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
  const map = { 'K': 0, 'TK': -1 };
  if (map[g] !== undefined) return map[g];
  return parseInt(g) || 99;
}

// ── Feedback modal ──
function openFeedbackModal() {
  document.getElementById('feedback-overlay').classList.remove('hidden');
  document.getElementById('feedback-form').classList.remove('hidden');
  document.getElementById('feedback-thanks').classList.add('hidden');
  document.getElementById('fb-error').classList.add('hidden');
}
function closeFeedbackModal() {
  document.getElementById('feedback-overlay').classList.add('hidden');
}
async function submitFeedback() {
  const message = document.getElementById('fb-message').value.trim();
  const errEl   = document.getElementById('fb-error');
  if (!message) {
    errEl.textContent = 'Please enter your feedback before submitting.';
    errEl.classList.remove('hidden');
    return;
  }
  errEl.classList.add('hidden');
  const btn = document.querySelector('#feedback-form .feedback-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';
  const { error } = await SupabaseClient.from('feedback').insert({
    product: 'class_builder',
    name:    document.getElementById('fb-name').value.trim()  || null,
    email:   document.getElementById('fb-email').value.trim() || null,
    message,
  });
  btn.disabled = false;
  btn.textContent = 'Submit Feedback';
  if (error) {
    errEl.textContent = 'Something went wrong. Please try again.';
    errEl.classList.remove('hidden');
    return;
  }
  document.getElementById('feedback-form').classList.add('hidden');
  document.getElementById('feedback-thanks').classList.remove('hidden');
}

// Returns the display label for a student based on the current displayMode.
// Falls back to studentId when no name is available (ID-only datasets).
function studentLabel(s) {
  if (AppState.displayMode === 'id' && s.studentId) return s.studentId;
  const name = `${s.firstName} ${s.lastName}`.trim();
  return name || s.studentId || `Student ${s.id}`;
}
