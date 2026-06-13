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
  const sepViolations  = getSepViolations();
  const togViolations  = getTogViolations();
  const sepCount = sepViolations.length;
  const togCount = togViolations.length;

  const violationList = (violations, type) => {
    if (!violations.length) return '';
    const items = violations.map(v =>
      `<li>${v.nameA} &amp; ${v.nameB}${type === 'apart' ? ' — placed in the same class' : ' — placed in different classes'}</li>`
    ).join('');
    return `<ul class="violation-list">${items}</ul>`;
  };

  const sepCardExtra  = sepCount  ? ` violation-card" onclick="toggleViolationDetail('sep-detail')` : ``;
  const togCardExtra  = togCount  ? ` violation-card" onclick="toggleViolationDetail('tog-detail')` : ``;

  stats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Students</div><div class="stat-value">${totalStudents}</div></div>
    <div class="stat-card"><div class="stat-label">Total Classes</div><div class="stat-value">${totalClasses}</div></div>
    <div class="stat-card${sepCardExtra}">
      <div class="stat-label">Keep Apart Violations${sepCount ? ' <span class="violation-hint">click for details</span>' : ''}</div>
      <div class="stat-value" style="color:${sepCount ? '#ef4444' : '#22c55e'}">${sepCount}</div>
      ${sepCount ? `<div id="sep-detail" class="violation-detail hidden">${violationList(sepViolations, 'apart')}</div>` : ''}
    </div>
    <div class="stat-card${togCardExtra}">
      <div class="stat-label">Keep Together Violations${togCount ? ' <span class="violation-hint">click for details</span>' : ''}</div>
      <div class="stat-value" style="color:${togCount ? '#ef4444' : '#22c55e'}">${togCount}</div>
      ${togCount ? `<div id="tog-detail" class="violation-detail hidden">${violationList(togViolations, 'together')}</div>` : ''}
    </div>
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

// ── Per-card sort state: { compName, dir } ──
const _cardSortState = {};

function buildClassCard(title, cls, gradeKey, classIdx, isSplit) {
  const avgs     = classAverages(cls);
  const sortKey  = `${gradeKey}-${classIdx}`;
  const curSort  = _cardSortState[sortKey];

  const avgChips = Object.entries(avgs).map(([name, val]) => {
    const isActive = curSort && curSort.compName === name;
    const arrow    = isActive ? (curSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return `<div class="avg-chip sort-chip${isActive ? ' sort-active' : ''}" onclick="sortCardBy('${gradeKey}',${classIdx},'${name}')" title="Sort by ${name}">${name}: <strong>${val}</strong>${arrow}</div>`;
  }).join('');

  const card = document.createElement('div');
  card.className     = 'class-card';
  card.dataset.grade = gradeKey;
  card.dataset.class = classIdx;

  const headerStyle = isSplit ? `background:var(--gold);color:var(--navy);` : '';

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

function sortCardBy(gradeKey, classIdx, compName) {
  const sortKey = `${gradeKey}-${classIdx}`;
  const cur     = _cardSortState[sortKey];
  if (cur && cur.compName === compName) {
    _cardSortState[sortKey] = { compName, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  } else {
    _cardSortState[sortKey] = { compName, dir: 'asc' };
  }
  // Re-render just this card's body and chips
  renderResultsGrid();
}

function renderStudentPills(cls, g, ci) {
  const scoreComps = AppState.competencies.filter(c => c.type === 'score' && c.name && c.column);
  const catComps   = AppState.competencies.filter(c => c.type === 'category' && c.name && c.column);

  // Apply sort if one is active for this card
  const sortKey  = `${g}-${ci}`;
  const curSort  = _cardSortState[sortKey];
  let students   = [...cls];
  if (curSort) {
    const comp = AppState.competencies.find(c => c.name === curSort.compName);
    students.sort((a, b) => {
      const va = a.scores[curSort.compName] ?? (comp?.type === 'category' ? '' : -Infinity);
      const vb = b.scores[curSort.compName] ?? (comp?.type === 'category' ? '' : -Infinity);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return curSort.dir === 'asc' ? cmp : -cmp;
    });
  }

  return students.map(s => {
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
        <span class="student-name">${studentLabel(s)}</span>
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

// ── Export helpers ──
function buildStudentRow(s, gradeLabel, classNum, teacher, comps) {
  const row = { 'Grade': gradeLabel, 'Class': classNum, 'Teacher': teacher, 'First Name': s.firstName, 'Last Name': s.lastName };
  comps.forEach(c => { row[c.name] = s.scores[c.name] ?? ''; });
  return row;
}

function sortedByName(students) {
  return [...students].sort((a, b) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
  );
}

// Ensure sheet name is ≤31 chars and unique within this workbook
function uniqueSheetName(base, used) {
  let name = base.slice(0, 31);
  if (!used.has(name)) { used.add(name); return name; }
  for (let n = 2; n < 999; n++) {
    const suffix = ` (${n})`;
    const candidate = base.slice(0, 31 - suffix.length) + suffix;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  return name; // fallback (shouldn't happen)
}

// ── Export by Grade (one sheet per grade) ──
document.getElementById('export-by-grade-btn').addEventListener('click', exportByGrade);

function exportByGrade() {
  if (typeof trackEvent === 'function') trackEvent('export_results');
  const wb    = XLSX.utils.book_new();
  const comps = AppState.competencies.filter(c => c.name && c.column);
  const used  = new Set();

  Object.keys(AppState.results).forEach(g => {
    const cfg  = AppState.gradeConfig[g] || { teachers: [] };
    const rows = [];
    AppState.results[g].forEach((cls, ci) => {
      const teacher = cfg.teachers[ci] || `Class ${ci + 1}`;
      sortedByName(cls).forEach(s => rows.push(buildStudentRow(s, g, ci + 1, teacher, comps)));
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(`Grade ${g}`, used));
  });

  if (AppState.splitResults.length) {
    const rows = [];
    AppState.splitResults.forEach((sr, i) => {
      const teacher = sr.teacher || `Split Class ${i + 1}`;
      sortedByName(sr.students).forEach(s => rows.push(buildStudentRow(s, sr.grades.join('/'), `Split ${i + 1}`, teacher, comps)));
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName('Split Classes', used));
  }

  XLSX.writeFile(wb, 'class-lists-by-grade.xlsx');
}

// ── Export by Teacher (one sheet per teacher / class) ──
document.getElementById('export-by-teacher-btn').addEventListener('click', exportByTeacher);

function exportByTeacher() {
  if (typeof trackEvent === 'function') trackEvent('export_results');
  const wb    = XLSX.utils.book_new();
  const comps = AppState.competencies.filter(c => c.name && c.column);
  const used  = new Set();

  // Regular grade classes
  Object.keys(AppState.results).forEach(g => {
    const cfg = AppState.gradeConfig[g] || { teachers: [] };
    AppState.results[g].forEach((cls, ci) => {
      const teacher   = cfg.teachers[ci] || '';
      const sheetBase = teacher || `Grade ${g} - Class ${ci + 1}`;
      const rows = sortedByName(cls).map(s => buildStudentRow(s, g, ci + 1, teacher || `Class ${ci + 1}`, comps));
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(sheetBase, used));
    });
  });

  // Split classes
  AppState.splitResults.forEach((sr, i) => {
    const teacher   = sr.teacher || '';
    const sheetBase = teacher || `Gr ${sr.grades.join('/')} Split ${i + 1}`;
    const rows = sortedByName(sr.students).map(s => buildStudentRow(s, sr.grades.join('/'), `Split ${i + 1}`, teacher || `Split ${i + 1}`, comps));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(sheetBase, used));
  });

  XLSX.writeFile(wb, 'class-lists-by-teacher.xlsx');
}

// ── Regenerate ──
document.getElementById('regenerate-btn').addEventListener('click', () => {
  if (!confirm('Regenerate will completely re-sort all classes using a new random arrangement. Any manual moves you\'ve made by dragging students will be lost.\n\nContinue?')) return;

  const btn = document.getElementById('regenerate-btn');
  btn.disabled = true;
  btn.textContent = 'Regenerating…';

  // Slight delay so the button state renders before the (synchronous) algorithm runs
  setTimeout(() => {
    _balanceWithVariation = true;
    runBalancingAlgorithm();
    _balanceWithVariation = false;
    renderResults();
    btn.disabled = false;
    btn.textContent = '🔄 Regenerate';

    // Brief confirmation on the subtitle
    const sub = document.querySelector('#view-results .view-subtitle');
    if (sub) {
      const orig = sub.textContent;
      sub.textContent = '✓ Classes regenerated with a new arrangement.';
      setTimeout(() => { sub.textContent = orig; }, 2500);
    }
  }, 30);
});

function getSepViolations() {
  const violations = [];
  const allClasses = [
    ...Object.values(AppState.results).flat(),
    ...AppState.splitResults.map(sr => sr.students),
  ];
  AppState.separations.forEach(pair => {
    allClasses.forEach(cls => {
      const sA = cls.find(s => s.id === pair.a);
      const sB = cls.find(s => s.id === pair.b);
      if (sA && sB) {
        violations.push({ nameA: studentLabel(sA), nameB: studentLabel(sB) });
      }
    });
  });
  return violations;
}

function getTogViolations() {
  const violations = [];
  const allClasses = [
    ...Object.values(AppState.results).flat(),
    ...AppState.splitResults.map(sr => sr.students),
  ];
  AppState.togethers.forEach(pair => {
    const aClass = allClasses.findIndex(cls => cls.some(s => s.id === pair.a));
    const bClass = allClasses.findIndex(cls => cls.some(s => s.id === pair.b));
    if (aClass !== -1 && bClass !== -1 && aClass !== bClass) {
      const sA = allClasses[aClass].find(s => s.id === pair.a);
      const sB = allClasses[bClass].find(s => s.id === pair.b);
      violations.push({ nameA: studentLabel(sA), nameB: studentLabel(sB) });
    }
  });
  return violations;
}

function toggleViolationDetail(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('hidden');
}
