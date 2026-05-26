function renderStudents() {
  populateGradeFilter();
  renderStudentTable();
  renderSeparationDropdowns();
  renderSeparationList();
  renderTogetherDropdowns();
  renderTogetherList();
  updateDisplayModeToggle();
}

function populateGradeFilter() {
  const sel = document.getElementById('grade-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Grades</option>' +
    getGrades().map(g => `<option value="${g}" ${current === g ? 'selected' : ''}>Grade ${g}</option>`).join('');
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
  </tr>`;

  // Body
  const tbody = document.getElementById('students-tbody');
  const colSpan = 4 + comps.length + (showId ? 1 : 0);
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
      <td>Grade ${s.grade}</td>
      ${comps.map(c => {
        const val = s.scores[c.name];
        if (val === undefined || val === null || val === false) return `<td>${c.type === 'flag' ? '<span class="flag-no">No</span>' : '—'}</td>`;
        if (c.type === 'flag')     return `<td><span class="${val ? 'flag-yes' : 'flag-no'}">${val ? 'Yes' : 'No'}</span></td>`;
        if (c.type === 'category') return `<td><span class="cat-badge">${val}</span></td>`;
        return `<td><span class="score-badge ${getScoreBadgeClass(val, c)}">${val}</span></td>`;
      }).join('')}
    </tr>
  `).join('');

  document.getElementById('student-count').textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;
}

document.getElementById('grade-filter').addEventListener('change', renderStudentTable);
document.getElementById('student-search').addEventListener('input', renderStudentTable);

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
