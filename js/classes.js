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

  container.innerHTML = grades.map(g => {
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
          <input type="number" class="input" min="1" max="20" value="${cfg.classCount}" data-grade="${g}" />
        </div>

        <div class="teachers-grid" id="teachers-${g}">
          ${renderTeacherSlots(g)}
        </div>
      </div>
    `;
  }).join('');

  // Class count change
  container.querySelectorAll('input[type="number"]').forEach(input => {
    input.addEventListener('change', () => {
      const g = input.dataset.grade;
      const n = Math.max(1, parseInt(input.value) || 1);
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

document.getElementById('generate-btn').addEventListener('click', () => {
  if (!AppState.students.length) { alert('Please import student data first.'); return; }
  runBalancingAlgorithm();
  const totalClasses = Object.values(AppState.gradeConfig).reduce((n, g) => n + g.classCount, 0);
  if (typeof trackEvent === 'function') trackEvent('classes_generated', { grades: getGrades().length, totalClasses });
  renderResults();
  navigateTo('results');
});
