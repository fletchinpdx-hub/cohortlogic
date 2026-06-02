function buildGradeConfig() {
  const grades = getGrades();
  grades.forEach(g => {
    if (!AppState.gradeConfig[g]) {
      const count = AppState.students.filter(s => s.grade === g).length;
      const classCount = Math.max(1, Math.ceil(count / 30));
      AppState.gradeConfig[g] = {
        classCount,
        teachers: Array.from({ length: classCount }, () => ''),
      };
    }
  });
  renderClassSetup();
  updateSidebarStatus();
}

function renderClassSetup() {
  const container = document.getElementById('grades-config');
  const grades    = getGrades();

  if (!grades.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>No student data loaded yet. Import data first.</p></div>`;
    return;
  }

  // Regular grade cards
  const gradeCards = grades.map(g => {
    const cfg   = AppState.gradeConfig[g];
    const count = AppState.students.filter(s => s.grade === g).length;
    const avg   = cfg.classCount ? Math.round(count / cfg.classCount) : '—';
    return `
      <div class="grade-card" data-grade="${g}">
        <div class="grade-card-header">
          <h2>Grade ${g}</h2>
          <div class="grade-meta">${count} students · ~${avg} per class</div>
        </div>
        <div class="class-count-row">
          <label>Number of classes:</label>
          <input type="number" class="input" min="0" max="20" value="${cfg.classCount}" data-grade="${g}" />
        </div>
        <div class="teachers-grid" id="teachers-${g}">
          ${renderTeacherSlots(g)}
        </div>
      </div>
    `;
  }).join('');

  // Split classes card
  const splitCard = `
    <div class="grade-card">
      <div class="grade-card-header">
        <h2>Split Classes</h2>
        <div class="grade-meta">Classes combining two grade levels (~50/50 split)</div>
      </div>
      <div id="split-classes-list">${renderSplitList(grades)}</div>
      <button class="btn btn-outline btn-sm" id="add-split-btn" style="margin-top:14px;">+ Add Split Class</button>
    </div>
  `;

  container.innerHTML = gradeCards + splitCard;

  // Class count change listeners
  container.querySelectorAll('input[type="number"][data-grade]').forEach(input => {
    input.addEventListener('change', () => {
      const g = input.dataset.grade;
      const n = Math.max(0, parseInt(input.value) || 0);
      input.value = n;
      const existing = AppState.gradeConfig[g].teachers;
      AppState.gradeConfig[g].classCount = n;
      AppState.gradeConfig[g].teachers   = Array.from({ length: n }, (_, i) => existing[i] || '');
      document.getElementById(`teachers-${g}`).innerHTML = renderTeacherSlots(g);
      attachTeacherListeners(g);
      updateAvg(g);
    });
  });

  grades.forEach(g => attachTeacherListeners(g));

  document.getElementById('add-split-btn').addEventListener('click', () => {
    AppState.splitClasses.push({
      id:     `split-${Date.now()}`,
      grades: [grades[0], grades[Math.min(1, grades.length - 1)]],
      teacher: '',
    });
    document.getElementById('split-classes-list').innerHTML = renderSplitList(grades);
    attachSplitListeners(grades);
  });

  attachSplitListeners(grades);
}

function renderTeacherSlots(g) {
  const cfg = AppState.gradeConfig[g];
  return cfg.teachers.map((t, i) => `
    <div class="teacher-slot">
      <label>Class ${i + 1}</label>
      <input type="text" placeholder="Teacher name" value="${t}" data-grade="${g}" data-index="${i}" />
    </div>
  `).join('');
}

function attachTeacherListeners(g) {
  document.querySelectorAll(`#teachers-${g} input`).forEach(input => {
    input.addEventListener('input', () => {
      AppState.gradeConfig[g].teachers[parseInt(input.dataset.index)] = input.value;
    });
  });
}

function updateAvg(g) {
  const cfg   = AppState.gradeConfig[g];
  const count = AppState.students.filter(s => s.grade === g).length;
  const avg   = cfg.classCount ? Math.round(count / cfg.classCount) : '—';
  const card  = document.querySelector(`.grade-card[data-grade="${g}"] .grade-meta`);
  if (card) card.textContent = `${count} students · ~${avg} per class`;
}

function renderSplitList(grades) {
  if (!AppState.splitClasses.length) {
    return `<p style="color:var(--gray-500);font-size:13px;padding:4px 0 8px;">No split classes yet. Click "+ Add Split Class" to create one.</p>`;
  }
  return AppState.splitClasses.map((sc, i) => `
    <div class="split-class-row" data-split-index="${i}">
      <select class="input input-sm split-grade-a">
        ${grades.map(g => `<option value="${g}" ${sc.grades[0] === g ? 'selected' : ''}>Grade ${g}</option>`).join('')}
      </select>
      <span style="color:var(--gray-500);font-weight:700;">/</span>
      <select class="input input-sm split-grade-b">
        ${grades.map(g => `<option value="${g}" ${sc.grades[1] === g ? 'selected' : ''}>Grade ${g}</option>`).join('')}
      </select>
      <input type="text" class="input input-sm split-teacher" placeholder="Teacher name" value="${sc.teacher}" style="flex:1;" />
      <button class="remove-btn split-remove" title="Remove split class">×</button>
    </div>
  `).join('');
}

function attachSplitListeners(grades) {
  document.querySelectorAll('.split-class-row').forEach(row => {
    const i = parseInt(row.dataset.splitIndex);
    const sc = AppState.splitClasses[i];
    if (!sc) return;
    row.querySelector('.split-grade-a').addEventListener('change', e => { sc.grades[0] = e.target.value; });
    row.querySelector('.split-grade-b').addEventListener('change', e => { sc.grades[1] = e.target.value; });
    row.querySelector('.split-teacher').addEventListener('input',  e => { sc.teacher = e.target.value; });
    row.querySelector('.split-remove').addEventListener('click', () => {
      AppState.splitClasses.splice(i, 1);
      document.getElementById('split-classes-list').innerHTML = renderSplitList(grades);
      attachSplitListeners(grades);
    });
  });
}

document.getElementById('continue-to-students-btn').addEventListener('click', () => {
  if (!AppState.students.length) { alert('Please import student data first.'); return; }
  renderStudents();
  navigateTo('students');
});
