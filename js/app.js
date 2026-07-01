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

// ── School Profile view ───────────────────────────────────────────────────────
function syncSchoolProfileInputs() {
  const nameEl = document.getElementById('cb-school-name');
  const distEl = document.getElementById('cb-district');
  if (nameEl) nameEl.value = AppState.schoolName || '';
  if (distEl) distEl.value = AppState.district   || '';
}

document.addEventListener('DOMContentLoaded', () => {
  syncSchoolProfileInputs();

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
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data._product !== 'schedule_builder' || !data.schoolProfile) {
          alert('This doesn\'t look like a Schedule Builder file (.clsched).');
          return;
        }
        applySchoolProfileToCB(data.schoolProfile);
        syncSchoolProfileInputs();
        alert(`School profile imported!\nSchool: ${data.schoolProfile.schoolName || '(unnamed)'}\n\nTeachers and grades from the Schedule Builder file have been applied to Class Setup.`);
      } catch (e) {
        alert('Could not read the file. Make sure it\'s a valid .clsched file.');
      }
    };
    reader.readAsText(file);
    schedInput.value = '';
  });
});

function applySchoolProfileToCB(sp) {
  if (!sp) return;
  if (sp.schoolName) AppState.schoolName = sp.schoolName;
  if (sp.district)   AppState.district   = sp.district;

  // Apply grades to gradeConfig
  if (sp.grades && sp.grades.length) {
    sp.grades.forEach(g => {
      if (!AppState.gradeConfig[g]) AppState.gradeConfig[g] = { classCount: 1, teachers: [] };
    });
  }

  // Convert classroom teachers into gradeConfig entries
  (sp.staff || [])
    .filter(s => s.role === 'classroom_teacher' && s.gradeAssignment && !s.splitGrade)
    .forEach(s => {
      const g = s.gradeAssignment;
      if (!AppState.gradeConfig[g]) AppState.gradeConfig[g] = { classCount: 0, teachers: [] };
      if (s.name && !AppState.gradeConfig[g].teachers.includes(s.name)) {
        AppState.gradeConfig[g].teachers.push(s.name);
        AppState.gradeConfig[g].classCount = AppState.gradeConfig[g].teachers.length;
      }
    });

  // Convert split class staff into AppState.splitClasses
  (sp.staff || [])
    .filter(s => s.role === 'classroom_teacher' && s.gradeAssignment && s.splitGrade)
    .forEach(s => {
      const exists = AppState.splitClasses.some(sc => sc.teacher === s.name);
      if (!exists) {
        AppState.splitClasses.push({
          id:      s.id || ('split_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
          grades:  [s.gradeAssignment, s.splitGrade],
          teacher: s.name || '',
        });
      }
    });

  updateSidebarStatus();
}
