function renderResults() {
  populateResultsGradeFilter();
  renderResultsGrid();
}

function populateResultsGradeFilter() {
  const sel = document.getElementById('results-grade-filter');
  const grades = Object.keys(AppState.results);
  sel.innerHTML = '<option value="">All Grades</option>' +
    grades.map(g => `<option value="${g}">Grade ${g}</option>`).join('');
}

document.getElementById('results-grade-filter').addEventListener('change', renderResultsGrid);

function renderResultsGrid() {
  const filterGrade = document.getElementById('results-grade-filter').value;
  const grades = Object.keys(AppState.results).filter(g => !filterGrade || g === filterGrade);
  const grid   = document.getElementById('results-grid');
  const stats  = document.getElementById('results-stats');

  if (!grades.length) {
    grid.innerHTML  = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">✅</div><p>No results yet. Set up classes and click Generate.</p></div>`;
    stats.innerHTML = '';
    return;
  }

  // Stats
  const totalStudents = grades.reduce((n, g) => n + AppState.results[g].flat().length, 0);
  const totalClasses  = grades.reduce((n, g) => n + AppState.results[g].length, 0);
  const sepViolations = countSepViolations();
  stats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Students</div><div class="stat-value">${totalStudents}</div></div>
    <div class="stat-card"><div class="stat-label">Total Classes</div><div class="stat-value">${totalClasses}</div></div>
    <div class="stat-card"><div class="stat-label">Separation Violations</div><div class="stat-value" style="color:${sepViolations ? '#ef4444' : '#22c55e'}">${sepViolations}</div></div>
  `;

  // Class cards
  grid.innerHTML = '';
  grades.forEach(g => {
    const cfg     = AppState.gradeConfig[g] || { teachers: [] };
    const classes = AppState.results[g];

    classes.forEach((cls, ci) => {
      const teacher  = cfg.teachers[ci] || `Class ${ci + 1}`;
      const avgs     = classAverages(cls);
      const avgChips = Object.entries(avgs).map(([name, val]) =>
        `<div class="avg-chip">${name}: <strong>${val}</strong></div>`
      ).join('');

      const card = document.createElement('div');
      card.className    = 'class-card';
      card.dataset.grade = g;
      card.dataset.class = ci;

      card.innerHTML = `
        <div class="class-card-header">
          <h3>Grade ${g} · ${teacher}</h3>
          <div class="class-card-meta">${cls.length} students</div>
        </div>
        ${avgChips ? `<div class="class-averages">${avgChips}</div>` : ''}
        <div class="class-card-body" id="class-body-${g}-${ci}">
          ${renderStudentPills(cls, g, ci)}
        </div>
      `;

      setupDragDrop(card, g, ci);
      grid.appendChild(card);
    });
  });
}

function renderStudentPills(cls, g, ci) {
  const comps = AppState.competencies.filter(c => c.type === 'score' && c.name && c.column);
  return cls.map(s => {
    const scores = comps.map(c => {
      const v = s.scores[c.name];
      if (v == null) return '';
      return `<span class="score-badge score-${Math.round(v)}" title="${c.name}">${v}</span>`;
    }).join('');

    return `
      <div class="student-pill" draggable="true" data-id="${s.id}" data-grade="${g}" data-class="${ci}">
        <span class="student-name">${s.firstName} ${s.lastName}</span>
        <span class="student-scores">${scores}</span>
      </div>
    `;
  }).join('');
}

// ── Drag & drop between classes ──
function setupDragDrop(card, g, ci) {
  card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-target'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-target'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-target');
    const studentId  = parseInt(e.dataTransfer.getData('studentId'));
    const fromGrade  = e.dataTransfer.getData('fromGrade');
    const fromClass  = parseInt(e.dataTransfer.getData('fromClass'));
    if (fromGrade === g && fromClass === ci) return;

    // Move student
    const fromList = AppState.results[fromGrade][fromClass];
    const idx      = fromList.findIndex(s => s.id === studentId);
    if (idx === -1) return;
    const [student] = fromList.splice(idx, 1);
    AppState.results[g][ci].push(student);
    renderResultsGrid();
  });
}

document.getElementById('results-grid').addEventListener('dragstart', e => {
  const pill = e.target.closest('.student-pill');
  if (!pill) return;
  pill.classList.add('dragging');
  e.dataTransfer.setData('studentId', pill.dataset.id);
  e.dataTransfer.setData('fromGrade', pill.dataset.grade);
  e.dataTransfer.setData('fromClass', pill.dataset.class);
});

document.getElementById('results-grid').addEventListener('dragend', e => {
  const pill = e.target.closest('.student-pill');
  if (pill) pill.classList.remove('dragging');
});

// ── Export to Excel ──
document.getElementById('export-results-btn').addEventListener('click', exportResults);

function exportResults() {
  const wb = XLSX.utils.book_new();
  const grades = Object.keys(AppState.results);
  const comps  = AppState.competencies.filter(c => c.name && c.column);

  grades.forEach(g => {
    const cfg     = AppState.gradeConfig[g] || { teachers: [] };
    const classes = AppState.results[g];
    const rows    = [];

    classes.forEach((cls, ci) => {
      const teacher = cfg.teachers[ci] || `Class ${ci + 1}`;
      cls.forEach(s => {
        const row = {
          'Grade': g,
          'Class': ci + 1,
          'Teacher': teacher,
          'First Name': s.firstName,
          'Last Name': s.lastName,
        };
        comps.forEach(c => { row[c.name] = s.scores[c.name] ?? ''; });
        rows.push(row);
      });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, `Grade ${g}`);
  });

  XLSX.writeFile(wb, 'class-lists.xlsx');
}

// ── Regenerate ──
document.getElementById('regenerate-btn').addEventListener('click', () => {
  runBalancingAlgorithm();
  renderResultsGrid();
});

function countSepViolations() {
  let count = 0;
  AppState.separations.forEach(pair => {
    Object.values(AppState.results).forEach(classes => {
      classes.forEach(cls => {
        const hasA = cls.some(s => s.id === pair.a);
        const hasB = cls.some(s => s.id === pair.b);
        if (hasA && hasB) count++;
      });
    });
  });
  return count;
}
