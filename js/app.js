// Start tracking this session
if (typeof trackSession === 'function') trackSession();

// Central app state
const AppState = {
  rawRows: [],         // raw rows from spreadsheet
  rawHeaders: [],      // column headers from spreadsheet
  students: [],        // mapped + parsed students
  separations: [],     // [{a: id, b: id}]
  competencies: [      // configurable scoring fields
    { name: 'Math',      type: 'score',    column: '', min: 1, max: 5, direction: 'asc' },
    { name: 'Reading',   type: 'score',    column: '', min: 1, max: 5, direction: 'asc' },
    { name: 'Writing',   type: 'score',    column: '', min: 1, max: 5, direction: 'asc' },
    { name: 'Behavior',  type: 'score',    column: '', min: 1, max: 5, direction: 'asc' },
    { name: 'IEP',       type: 'flag',     column: '' },
    { name: '504',       type: 'flag',     column: '' },
    { name: 'Ethnicity', type: 'category', column: '' },
  ],
  columnMap: {         // required field -> spreadsheet column
    firstName: '',
    lastName:  '',
    grade:     '',
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
  item.addEventListener('click', () => navigateTo(item.dataset.view));
});

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
