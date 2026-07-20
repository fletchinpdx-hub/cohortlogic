function renderStudents() {
  populateGradeFilter();
  renderStudentTable();
  renderSeparationDropdowns();
  renderSeparationList();
  renderTogetherDropdowns();
  renderTogetherList();
  updateDisplayModeToggle();
  if (document.getElementById('kwt-list')) renderKwtList();
}

function populateGradeFilter() {
  const sel = document.getElementById('grade-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Grades</option>' +
    getGrades().map(g => `<option value="${g}" ${current === g ? 'selected' : ''}>${gradeLabel(g)}</option>`).join('');
}

// Show display-mode selector only when student IDs are loaded
function updateDisplayModeToggle() {
  const hasIds = AppState.students.some(s => s.studentId);
  const sel    = document.getElementById('display-mode-sel');
  sel.classList.toggle('hidden', !hasIds);
  sel.value = AppState.displayMode;
}

document.getElementById('display-mode-sel').addEventListener('change', e => {
  AppState.displayMode = e.target.value;
  renderStudentTable();
  renderSeparationDropdowns();
  renderSeparationList();
  renderTogetherDropdowns();
  renderTogetherList();
});

function getFilteredStudents() {
  const grade  = document.getElementById('grade-filter').value;
  const search = document.getElementById('student-search').value.toLowerCase();
  return AppState.students.filter(s => {
    if (grade && s.grade !== grade) return false;
    if (search) {
      const byName = `${s.firstName} ${s.lastName}`.toLowerCase().includes(search);
      const byId   = s.studentId && s.studentId.toLowerCase().includes(search);
      if (!byName && !byId) return false;
    }
    return true;
  });
}

function renderStudentTable() {
  const students = getFilteredStudents();
  const comps    = AppState.competencies.filter(c => c.name && c.column);
  const showId   = AppState.students.some(s => s.studentId);

  // Header
  const thead = document.getElementById('students-thead');
  thead.innerHTML = `<tr>
    <th>#</th>
    ${showId ? '<th>Student ID</th>' : ''}
    <th>First Name</th>
    <th>Last Name</th>
    <th>Grade</th>
    ${comps.map(c => `<th>${c.name}</th>`).join('')}
    <th></th>
  </tr>`;

  // Body
  const tbody = document.getElementById('students-tbody');
  const colSpan = 5 + comps.length + (showId ? 1 : 0);
  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:32px;color:#9ca3af;">No students found.</td></tr>`;
    document.getElementById('student-count').textContent = '';
    return;
  }

  tbody.innerHTML = students.map((s, i) => `
    <tr>
      <td style="color:#9ca3af">${i + 1}</td>
      ${showId ? `<td style="font-family:monospace;font-size:12px;">${s.studentId || '—'}</td>` : ''}
      <td>${s.firstName}</td>
      <td>${s.lastName}</td>
      <td>${gradeLabel(s.grade)}</td>
      ${comps.map(c => {
        const val = s.scores[c.name];
        if (val === undefined || val === null || val === false) return `<td>${c.type === 'flag' ? '<span class="flag-no">No</span>' : '—'}</td>`;
        if (c.type === 'flag')     return `<td><span class="${val ? 'flag-yes' : 'flag-no'}">${val ? 'Yes' : 'No'}</span></td>`;
        if (c.type === 'category') return `<td><span class="cat-badge">${val}</span></td>`;
        return `<td><span class="score-badge ${getScoreBadgeClass(val, c)}">${val}</span></td>`;
      }).join('')}
      <td class="student-row-actions">
        <button class="student-edit-btn" data-id="${s.id}" title="Edit">✏️</button>
        <button class="remove-x student-delete-btn" data-id="${s.id}" title="Delete">×</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.student-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEditStudent(parseInt(btn.dataset.id)));
  });
  tbody.querySelectorAll('.student-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteStudent(parseInt(btn.dataset.id)));
  });

  document.getElementById('student-count').textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;
}

document.getElementById('grade-filter').addEventListener('change', renderStudentTable);
document.getElementById('student-search').addEventListener('input', renderStudentTable);

// ── Generate button (from Students view) ──
document.getElementById('generate-from-students-btn').addEventListener('click', () => {
  if (!AppState.students.length) { alert('Please import student data first.'); return; }

  const btn = document.getElementById('generate-from-students-btn');
  btn.disabled = true;
  btn.textContent = 'Generating…';

  navigateTo('results');
  // Show a generating state in the results view before blocking algorithm runs
  const grid  = document.getElementById('results-grid');
  const stats = document.getElementById('results-stats');
  if (grid)  grid.innerHTML  = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⏳</div><p>Generating classes…</p></div>`;
  if (stats) stats.innerHTML = '';

  setTimeout(() => {
    runBalancingAlgorithm();
    const totalClasses = Object.values(AppState.gradeConfig).reduce((n, g) => n + g.classCount, 0)
      + AppState.splitClasses.length;
    if (typeof trackEvent === 'function') trackEvent('classes_generated', { grades: getGrades().length, totalClasses });
    renderResults();
    btn.disabled = false;
    btn.textContent = 'Generate Classes';
  }, 50);
});

// ── Helper: build option list respecting displayMode ──
function studentOptions() {
  return [...AppState.students]
    .sort((a, b) => studentLabel(a).localeCompare(studentLabel(b)))
    .map(s => `<option value="${s.id}">${studentLabel(s)} (Gr. ${s.grade})</option>`)
    .join('');
}

// ── Keep Apart (Separations) modal ──
document.getElementById('manage-separations-btn').addEventListener('click', () => {
  document.getElementById('separations-modal').classList.remove('hidden');
  renderSeparationDropdowns();
  renderSeparationList();
});

document.getElementById('close-separations').addEventListener('click', () => {
  document.getElementById('separations-modal').classList.add('hidden');
});

document.querySelectorAll('.modal-backdrop:not(.tog-backdrop)').forEach(el => {
  el.addEventListener('click', () => document.getElementById('separations-modal').classList.add('hidden'));
});

function renderSeparationDropdowns() {
  const opts = studentOptions();
  document.getElementById('sep-student-a').innerHTML = `<option value="">Select student…</option>${opts}`;
  document.getElementById('sep-student-b').innerHTML = `<option value="">Select student…</option>${opts}`;
}

document.getElementById('add-separation-btn').addEventListener('click', () => {
  const aId = parseInt(document.getElementById('sep-student-a').value);
  const bId = parseInt(document.getElementById('sep-student-b').value);
  if (isNaN(aId) || isNaN(bId)) { alert('Please select two students.'); return; }
  if (aId === bId) { alert('Please select two different students.'); return; }

  const exists = AppState.separations.some(p =>
    (p.a === aId && p.b === bId) || (p.a === bId && p.b === aId)
  );
  if (exists) { alert('This pair already exists.'); return; }

  AppState.separations.push({ a: aId, b: bId });
  if (typeof trackEvent === 'function') trackEvent('separation_added', { total: AppState.separations.length });

  const aVal = document.getElementById('sep-student-a').value;
  renderSeparationList();
  document.getElementById('sep-student-a').value = aVal;
  document.getElementById('sep-student-b').value = '';
});

function renderSeparationList() {
  const container = document.getElementById('separations-list');
  if (!AppState.separations.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No keep-apart rules added yet.</p>';
    return;
  }

  const groups = new Map();
  AppState.separations.forEach((pair, i) => {
    const a = AppState.students.find(s => s.id === pair.a);
    const b = AppState.students.find(s => s.id === pair.b);
    if (!a || !b) return;
    if (!groups.has(pair.a)) groups.set(pair.a, { student: a, restricted: [] });
    groups.get(pair.a).restricted.push({ student: b, pairIndex: i });
    if (!groups.has(pair.b)) groups.set(pair.b, { student: b, restricted: [] });
    groups.get(pair.b).restricted.push({ student: a, pairIndex: i });
  });

  const rendered = new Set();
  let html = '';
  AppState.separations.forEach((pair) => {
    const a = AppState.students.find(s => s.id === pair.a);
    if (!a || rendered.has(pair.a)) return;
    rendered.add(pair.a);

    const group   = groups.get(pair.a);
    const entries = group.restricted.map(r => `
      <div class="sep-entry">
        <div class="sep-entry-name">${studentLabel(r.student)} <span style="color:var(--gray-400);font-size:12px;">(Gr. ${r.student.grade})</span></div>
        <button class="sep-remove-btn btn btn-sm" style="color:#ef4444;background:none;border:none;cursor:pointer;" data-pair="${r.pairIndex}">Remove</button>
      </div>
    `).join('');

    html += `
      <div class="sep-group">
        <div class="sep-group-header">
          <span class="sep-group-name">${studentLabel(a)} <span style="font-weight:400;color:var(--gray-500);">Gr. ${a.grade}</span></span>
          <span style="font-size:12px;color:var(--gray-400);">${group.restricted.length} restriction${group.restricted.length !== 1 ? 's' : ''}</span>
        </div>
        ${entries}
      </div>
    `;
  });

  container.innerHTML = html;
  container.querySelectorAll('.sep-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.separations.splice(parseInt(btn.dataset.pair), 1);
      renderSeparationList();
    });
  });
}

// ── Keep Together modal ──
document.getElementById('manage-togethers-btn').addEventListener('click', () => {
  document.getElementById('togethers-modal').classList.remove('hidden');
  renderTogetherDropdowns();
  renderTogetherList();
});

document.getElementById('close-togethers').addEventListener('click', () => {
  document.getElementById('togethers-modal').classList.add('hidden');
});

document.querySelector('.tog-backdrop').addEventListener('click', () => {
  document.getElementById('togethers-modal').classList.add('hidden');
});

function renderTogetherDropdowns() {
  const opts = studentOptions();
  document.getElementById('tog-student-a').innerHTML = `<option value="">Select student…</option>${opts}`;
  document.getElementById('tog-student-b').innerHTML = `<option value="">Select student…</option>${opts}`;
}

document.getElementById('add-together-btn').addEventListener('click', () => {
  const aId = parseInt(document.getElementById('tog-student-a').value);
  const bId = parseInt(document.getElementById('tog-student-b').value);
  if (isNaN(aId) || isNaN(bId)) { alert('Please select two students.'); return; }
  if (aId === bId) { alert('Please select two different students.'); return; }

  const exists = AppState.togethers.some(p =>
    (p.a === aId && p.b === bId) || (p.a === bId && p.b === aId)
  );
  if (exists) { alert('This pair already exists.'); return; }

  // Warn if this conflicts with a keep-apart rule
  const conflict = AppState.separations.some(p =>
    (p.a === aId && p.b === bId) || (p.a === bId && p.b === aId)
  );
  if (conflict) { alert('These students already have a Keep Apart rule — cannot also keep together.'); return; }

  AppState.togethers.push({ a: aId, b: bId });
  if (typeof trackEvent === 'function') trackEvent('together_added', { total: AppState.togethers.length });

  const aVal = document.getElementById('tog-student-a').value;
  renderTogetherList();
  document.getElementById('tog-student-a').value = aVal;
  document.getElementById('tog-student-b').value = '';
});

function renderTogetherList() {
  const container = document.getElementById('togethers-list');
  if (!AppState.togethers.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No keep-together rules added yet.</p>';
    return;
  }

  const groups = new Map();
  AppState.togethers.forEach((pair, i) => {
    const a = AppState.students.find(s => s.id === pair.a);
    const b = AppState.students.find(s => s.id === pair.b);
    if (!a || !b) return;
    if (!groups.has(pair.a)) groups.set(pair.a, { student: a, paired: [] });
    groups.get(pair.a).paired.push({ student: b, pairIndex: i });
    if (!groups.has(pair.b)) groups.set(pair.b, { student: b, paired: [] });
    groups.get(pair.b).paired.push({ student: a, pairIndex: i });
  });

  const rendered = new Set();
  let html = '';
  AppState.togethers.forEach((pair) => {
    const a = AppState.students.find(s => s.id === pair.a);
    if (!a || rendered.has(pair.a)) return;
    rendered.add(pair.a);

    const group   = groups.get(pair.a);
    const entries = group.paired.map(r => `
      <div class="sep-entry tog-entry">
        <div class="sep-entry-name">${studentLabel(r.student)} <span style="color:var(--gray-400);font-size:12px;">(Gr. ${r.student.grade})</span></div>
        <button class="tog-remove-btn btn btn-sm" style="color:#ef4444;background:none;border:none;cursor:pointer;" data-pair="${r.pairIndex}">Remove</button>
      </div>
    `).join('');

    html += `
      <div class="sep-group tog-group">
        <div class="sep-group-header tog-group-header">
          <span class="sep-group-name">${studentLabel(a)} <span style="font-weight:400;color:var(--gray-500);">Gr. ${a.grade}</span></span>
          <span style="font-size:12px;color:var(--gray-400);">${group.paired.length} pairing${group.paired.length !== 1 ? 's' : ''}</span>
        </div>
        ${entries}
      </div>
    `;
  });

  container.innerHTML = html;
  container.querySelectorAll('.tog-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.togethers.splice(parseInt(btn.dataset.pair), 1);
      renderTogetherList();
    });
  });
}

// ── Add student ──
document.getElementById('add-student-btn').addEventListener('click', () => {
  if (!AppState.competencies.some(c => c.column)) {
    alert('Please complete Field Mapping before adding students manually.');
    return;
  }
  openEditStudent(null);
});

// ── Add / Edit student modal ──
function openEditStudent(id) {
  const isAdd = id === null;
  const s     = isAdd ? null : AppState.students.find(s => s.id === id);
  if (!isAdd && !s) return;

  const comps  = AppState.competencies.filter(c => c.name && c.column);
  const showId = AppState.students.some(st => st.studentId);
  const grades = getGrades();

  const gradeInput = grades.length
    ? `<select id="edit-grade" class="input">
        <option value="">Select grade…</option>
        ${grades.map(g => `<option value="${g}" ${!isAdd && s.grade === g ? 'selected' : ''}>${g}</option>`).join('')}
       </select>`
    : `<input type="text" id="edit-grade" class="input" value="${isAdd ? '' : s.grade}" placeholder="e.g. 3" />`;

  const fields = `
    <div class="edit-field-row">
      <label>First Name</label>
      <input type="text" id="edit-firstName" class="input" value="${isAdd ? '' : s.firstName}" />
    </div>
    <div class="edit-field-row">
      <label>Last Name</label>
      <input type="text" id="edit-lastName" class="input" value="${isAdd ? '' : s.lastName}" />
    </div>
    <div class="edit-field-row">
      <label>Grade</label>
      ${gradeInput}
    </div>
    ${showId ? `<div class="edit-field-row">
      <label>Student ID</label>
      <input type="text" id="edit-studentId" class="input" value="${isAdd ? '' : (s.studentId || '')}" />
    </div>` : ''}
    ${comps.map(c => {
      const val = isAdd ? null : s.scores[c.name];
      if (c.type === 'score') {
        return `<div class="edit-field-row">
          <label>${c.name} (${c.min ?? 1}–${c.max ?? 5})</label>
          <input type="number" id="edit-score-${c.name}" class="input" value="${val ?? ''}" min="${c.min ?? 1}" max="${c.max ?? 5}" step="1" />
        </div>`;
      } else if (c.type === 'category') {
        return `<div class="edit-field-row">
          <label>${c.name}</label>
          <input type="text" id="edit-cat-${c.name}" class="input" value="${val || ''}" />
        </div>`;
      } else {
        return `<div class="edit-field-row">
          <label>${c.name}</label>
          <select id="edit-flag-${c.name}" class="input">
            <option value="no" ${!val ? 'selected' : ''}>No</option>
            <option value="yes" ${val ? 'selected' : ''}>Yes</option>
          </select>
        </div>`;
      }
    }).join('')}
  `;

  const modal = document.getElementById('edit-student-modal');
  modal.querySelector('h2').textContent = isAdd ? 'Add Student' : 'Edit Student';
  document.getElementById('save-edit-student-btn').textContent = isAdd ? 'Add Student' : 'Save Changes';
  document.getElementById('edit-student-fields').innerHTML = fields;
  modal.dataset.editId = isAdd ? '' : id;
  modal.classList.remove('hidden');
}

['close-edit-student', 'close-edit-student-cancel'].forEach(id => {
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('edit-student-modal').classList.add('hidden');
  });
});
document.querySelector('.edit-student-backdrop').addEventListener('click', () => {
  document.getElementById('edit-student-modal').classList.add('hidden');
});

document.getElementById('save-edit-student-btn').addEventListener('click', () => {
  const modal  = document.getElementById('edit-student-modal');
  const editId = modal.dataset.editId;
  const isAdd  = editId === '';

  const firstName = document.getElementById('edit-firstName').value.trim();
  const lastName  = document.getElementById('edit-lastName').value.trim();
  const grade     = document.getElementById('edit-grade').value.trim();
  if (!grade) { alert('Please enter a grade.'); return; }
  if (!firstName && !lastName && !document.getElementById('edit-studentId')?.value.trim()) {
    alert('Please enter at least a first name, last name, or student ID.'); return;
  }

  const scores = {};
  AppState.competencies.filter(c => c.name && c.column).forEach(c => {
    if (c.type === 'score') {
      const v = parseFloat(document.getElementById(`edit-score-${c.name}`)?.value);
      scores[c.name] = isNaN(v) ? null : Math.min(c.max ?? 5, Math.max(c.min ?? 1, v));
    } else if (c.type === 'category') {
      scores[c.name] = document.getElementById(`edit-cat-${c.name}`)?.value.trim() || null;
    } else {
      scores[c.name] = document.getElementById(`edit-flag-${c.name}`)?.value === 'yes';
    }
  });

  if (isAdd) {
    const newId = AppState.students.length
      ? Math.max(...AppState.students.map(s => s.id)) + 1
      : 0;
    AppState.students.push({
      id: newId,
      firstName,
      lastName,
      grade,
      studentId: document.getElementById('edit-studentId')?.value.trim() || '',
      scores,
    });
  } else {
    const s = AppState.students.find(s => s.id === parseInt(editId));
    if (!s) return;
    s.firstName = firstName;
    s.lastName  = lastName;
    s.grade     = grade;
    const idEl  = document.getElementById('edit-studentId');
    if (idEl) s.studentId = idEl.value.trim();
    Object.assign(s.scores, scores);
  }

  modal.classList.add('hidden');
  updateSidebarStatus();
  buildGradeConfig();
  renderStudents();
});

// ── Delete student ──
function deleteStudent(id) {
  const s = AppState.students.find(s => s.id === id);
  if (!s) return;
  const name = studentLabel(s);
  if (!confirm(`Remove ${name} from the student list? This cannot be undone.`)) return;

  AppState.students    = AppState.students.filter(s => s.id !== id);
  AppState.separations = AppState.separations.filter(p => p.a !== id && p.b !== id);
  AppState.togethers   = AppState.togethers.filter(p => p.a !== id && p.b !== id);
  AppState.keepWithTeacher = AppState.keepWithTeacher.filter(k => k.studentId !== id);

  updateSidebarStatus();
  renderStudents();
}

// ── Keep with Teacher modal ──
document.getElementById('manage-kwt-btn').addEventListener('click', () => {
  document.getElementById('kwt-modal').classList.remove('hidden');
  renderKwtDropdowns();
  renderKwtList();
});

document.getElementById('close-kwt').addEventListener('click', () => {
  document.getElementById('kwt-modal').classList.add('hidden');
});

document.querySelector('.kwt-backdrop').addEventListener('click', () => {
  document.getElementById('kwt-modal').classList.add('hidden');
});

function renderKwtDropdowns() {
  // Student dropdown
  document.getElementById('kwt-student').innerHTML =
    `<option value="">Select student…</option>${studentOptions()}`;

  // Class dropdown — regular classes from gradeConfig + split classes
  const opts = [];
  getGrades().forEach(g => {
    const cfg = AppState.gradeConfig[g];
    if (!cfg) return;
    cfg.teachers.forEach((t, i) => {
      const label = t ? `${gradeLabel(g)} — ${t}` : `${gradeLabel(g)} — Class ${i + 1}`;
      opts.push(`<option value="grade|${g}|${i}">${label}</option>`);
    });
  });
  AppState.splitClasses.forEach(sc => {
    const grades = sc.grades.join('/');
    const label  = sc.teacher
      ? `Grade ${grades} Split — ${sc.teacher}`
      : `Grade ${grades} Split`;
    opts.push(`<option value="split|${sc.id}">${label}</option>`);
  });
  document.getElementById('kwt-class').innerHTML =
    opts.length
      ? `<option value="">Select class…</option>${opts.join('')}`
      : `<option value="">— Set up classes first —</option>`;
}

document.getElementById('add-kwt-btn').addEventListener('click', () => {
  const studentId = parseInt(document.getElementById('kwt-student').value);
  const classVal  = document.getElementById('kwt-class').value;
  if (isNaN(studentId) || !classVal) { alert('Please select a student and a class.'); return; }

  // Remove any existing pin for this student
  AppState.keepWithTeacher = AppState.keepWithTeacher.filter(k => k.studentId !== studentId);

  if (classVal.startsWith('split|')) {
    const splitClassId = classVal.slice(6);
    AppState.keepWithTeacher.push({ studentId, splitClassId });
  } else {
    // format: "grade|g|classIndex"
    const [, grade, classIndex] = classVal.split('|');
    AppState.keepWithTeacher.push({ studentId, grade, classIndex: parseInt(classIndex) });
  }

  renderKwtList();
  document.getElementById('kwt-student').value = '';
  document.getElementById('kwt-class').value   = '';
});

function renderKwtList() {
  const container = document.getElementById('kwt-list');
  if (!AppState.keepWithTeacher.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No keep-with-teacher rules added yet.</p>';
    return;
  }

  const rows = AppState.keepWithTeacher.map((k, i) => {
    const student = AppState.students.find(s => s.id === k.studentId);
    if (!student) return '';
    let label;
    if (k.splitClassId) {
      const sc = AppState.splitClasses.find(c => c.id === k.splitClassId);
      label = sc
        ? `Grade ${sc.grades.join('/')} Split${sc.teacher ? ' — ' + sc.teacher : ''}`
        : 'Split Class';
    } else {
      const cfg     = AppState.gradeConfig[k.grade];
      const teacher = cfg?.teachers?.[k.classIndex] || `Class ${k.classIndex + 1}`;
      label = `Grade ${k.grade} — ${teacher}`;
    }
    return `
      <div class="sep-entry">
        <div class="sep-entry-name">
          ${studentLabel(student)} <span style="color:var(--gray-400);font-size:12px;">(Gr. ${student.grade})</span>
          <span style="color:var(--gray-500);font-size:12px;"> → ${label}</span>
        </div>
        <button class="kwt-remove-btn btn btn-sm" style="color:#ef4444;background:none;border:none;cursor:pointer;" data-index="${i}">Remove</button>
      </div>
    `;
  }).join('');

  container.innerHTML = rows;
  container.querySelectorAll('.kwt-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.keepWithTeacher.splice(parseInt(btn.dataset.index), 1);
      renderKwtList();
    });
  });
}
