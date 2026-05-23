function renderResults() {
  populateResultsGradeFilter();
  renderResultsGrid();
}

function populateResultsGradeFilter() {
  const sel = document.getElementById('results-grade-filter');
  const grades = Object.keys(AppState.results);
  sel.innerHTML = '<option value="">All Grades</option>' +
    grades.map(g => `<option value="${g}">Grade ${g}</option>`).join('') +
    (AppState.splitResults.length ? '<option value="__split__">Split Classes</option>' : '');
}

document.getElementById('results-grade-filter').addEventListener('change', renderResultsGrid);

function renderResultsGrid() {
  const filterGrade = document.getElementById('results-grade-filter').value;
  const showSplit   = !filterGrade || filterGrade === '__split__';
  const grades      = Object.keys(AppState.results).filter(g => !filterGrade || filterGrade === '__split__' || g === filterGrade);
  const grid        = document.getElementById('results-grid');
  const stats       = document.getElementById('results-stats');

  const hasResults = grades.length || (showSplit && AppState.splitResults.length);
  if (!hasResults) {
    grid.innerHTML  = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">✅</div><p>No results yet. Set up classes and click Generate.</p></div>`;
    stats.innerHTML = '';
    return;
  }

  // Stats
  const regularStudents = grades.reduce((n, g) => n + AppState.results[g].flat().length, 0);
  const splitStudents   = AppState.splitResults.reduce((n, sr) => n + sr.students.length, 0);
  const totalStudents   = regularStudents + splitStudents;
  const totalClasses    = grades.reduce((n, g) => n + AppState.results[g].length, 0) + AppState.splitResults.length;
  const sepViolations   = countSepViolations();

  stats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Students</div><div class="stat-value">${totalStudents}</div></div>
    <div class="stat-card"><div class="stat-label">Total Classes</div><div class="stat-value">${totalClasses}</div></div>
    <div class="stat-card"><div class="stat-label">Separation Violations</div><div class="stat-value" style="color:${sepViolations ? '#ef4444' : '#22c55e'}">${sepViolations}</div></div>
  `;

  grid.innerHTML = '';

  // Regular grade classes
  if (filterGrade !== '__split__') {
    grades.forEach(g => {
      const cfg     = AppState.gradeConfig[g] || { teachers: [] };
      const classes = AppState.results[g];
      classes.forEach((cls, ci) => {
        const teacher = cfg.teachers[ci] || `Class ${ci + 1}`;
        const card = buildClassCard(`Grade ${g} · ${teacher}`, cls, g, ci, false);
        setupDragDrop(card, g, ci);
        grid.appendChild(card);
      });
    });
  }

  // Split classes
  if (showSplit) {
    AppState.splitResults.forEach((sr, i) => {
      const label = `Grade ${sr.grades.join('/')} Split · ${sr.teacher || `Class ${i + 1}`}`;
      const card  = buildClassCard(label, sr.students, `split-${i}`, 0, true);
      grid.appendChild(card);
    });
  }
}

function buildClassCard(title, cls, gradeKey, classIdx, isSplit) {
  const avgs     = classAverages(cls);
  const avgChips = Object.entries(avgs).map(([name, val]) =>
    `<div class="avg-chip">${name}: <strong>${val}</strong></div>`
  ).join('');

  const card = document.createElement('div');
  card.className     = 'class-card';
  card.dataset.grade = gradeKey;
  card.dataset.class = classIdx;

  const headerStyle = isSplit
    ? `background:var(--gold);color:var(--navy);`
    : '';

  card.innerHTML = `
    <div class="class-card-header" style="${headerStyle}">
      <h3>${title}</h3>
      <div class="class-card-meta">${cls.length} students${isSplit ? ' · Split' : ''}</div>
    </div>
    ${avgChips ? `<div class="class-averages">${avgChips}</div>` : ''}
    <div class="class-card-body" id="class-body-${gradeKey}-${classIdx}">
      ${renderStudentPills(cls, gradeKey, classIdx)}
    </div>
  `;
  return card;
}

function renderStudentPills(cls, g, ci) {
  const scoreComps = AppState.competencies.filter(c => c.type === 'score' && c.name && c.column);
  const catComps   = AppState.competencies.filter(c => c.type === 'category' && c.name && c.column);

  return cls.map(s => {
    const scoreBadges = scoreComps.map(c => {
      const v = s.scores[c.name];
      if (v == null) return '';
      return `<span class="score-badge ${getScoreBadgeClass(v, c)}" title="${c.name}">${v}</span>`;
    }).join('');

    const catBadges = catComps.map(c => {
      const v = s.scores[c.name];
      if (!v) return '';
      return `<span class="cat-badge" title="${c.name}">${v}</span>`;
    }).join('');

    return `
      <div class="student-pill" draggable="true" data-id="${s.id}" data-grade="${g}" data-class="${ci}">
        <span class="student-name">${s.firstName} ${s.lastName}</span>
        <span class="student-scores">${scoreBadges}${catBadges}</span>
      </div>
    `;
  }).join('');
}

function getScoreBadgeClass(val, comp) {
  const min = comp.min ?? 1;
  const max = comp.max ?? 5;
  let n = max > min ? (val - min) / (max - min) : 0.5;
  // If low = good, invert so green = low value
  if (comp.direction === 'desc') n = 1 - n;
  if (n <= 0.2) return 'score-1';
  if (n <= 0.4) return 'score-2';
  if (n <= 0.6) return 'score-3';
  if (n <= 0.8) return 'score-4';
  return 'score-5';
}

// ── Drag & drop between classes ──
function setupDragDrop(card, g, ci) {
  card.addEventListener('dragover',  e => { e.preventDefault(); card.classList.add('drag-target'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-target'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-target');
    const studentId = parseInt(e.dataTransfer.getData('studentId'));
    const fromGrade = e.dataTransfer.getData('fromGrade');
    const fromClass = parseInt(e.dataTransfer.getData('fromClass'));
    if (fromGrade === g && fromClass === ci) return;

    const fromList = AppState.results[fromGrade]?.[fromClass];
    if (!fromList) return;
    const idx = fromList.findIndex(s => s.id === studentId);
    if (idx === -1) return;
    const [student] = fromList.splice(idx, 1);
    AppState.results[g][ci].push(student);
    if (typeof trackEvent === 'function') trackEvent('student_moved');
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
  if (typeof trackEvent === 'function') trackEvent('export_results');
  const wb    = XLSX.utils.book_new();
  const comps = AppState.competencies.filter(c => c.name && c.column);

  const buildRows = (classes, gradeLabel, teachers) => {
    const rows = [];
    classes.forEach((cls, ci) => {
      const teacher = (teachers && teachers[ci]) || `Class ${ci + 1}`;
      cls.forEach(s => {
        const row = { 'Grade': gradeLabel, 'Class': ci + 1, 'Teacher': teacher, 'First Name': s.firstName, 'Last Name': s.lastName };
        comps.forEach(c => { row[c.name] = s.scores[c.name] ?? ''; });
        rows.push(row);
      });
    });
    return rows;
  };

  // Regular grades
  Object.keys(AppState.results).forEach(g => {
    const cfg  = AppState.gradeConfig[g] || { teachers: [] };
    const rows = buildRows(AppState.results[g], g, cfg.teachers);
    const ws   = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, `Grade ${g}`);
  });

  // Split classes
  if (AppState.splitResults.length) {
    const rows = [];
    AppState.splitResults.forEach((sr, i) => {
      const teacher = sr.teacher || `Split Class ${i + 1}`;
      sr.students.forEach(s => {
        const row = { 'Grade': sr.grades.join('/'), 'Class': `Split ${i + 1}`, 'Teacher': teacher, 'First Name': s.firstName, 'Last Name': s.lastName };
        comps.forEach(c => { row[c.name] = s.scores[c.name] ?? ''; });
        rows.push(row);
      });
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Split Classes');
  }

  XLSX.writeFile(wb, 'class-lists.xlsx');
}

// ── Regenerate ──
document.getElementById('regenerate-btn').addEventListener('click', () => {
  runBalancingAlgorithm();
  renderResultsGrid();
});

function countSepViolations() {
  let count = 0;
  const allClasses = [
    ...Object.values(AppState.results).flat(),
    ...AppState.splitResults.map(sr => sr.students),
  ];
  AppState.separations.forEach(pair => {
    allClasses.forEach(cls => {
      if (cls.some(s => s.id === pair.a) && cls.some(s => s.id === pair.b)) count++;
    });
  });
  return count;
}
