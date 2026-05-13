function renderStudents() {
  populateGradeFilter();
  renderStudentTable();
  renderSeparationDropdowns();
  renderSeparationList();
}

function populateGradeFilter() {
  const sel = document.getElementById('grade-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Grades</option>' +
    getGrades().map(g => `<option value="${g}" ${current === g ? 'selected' : ''}>Grade ${g}</option>`).join('');
}

function getFilteredStudents() {
  const grade  = document.getElementById('grade-filter').value;
  const search = document.getElementById('student-search').value.toLowerCase();
  return AppState.students.filter(s => {
    if (grade  && s.grade !== grade) return false;
    if (search && !`${s.firstName} ${s.lastName}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderStudentTable() {
  const students = getFilteredStudents();
  const comps    = AppState.competencies.filter(c => c.name && c.column);

  // Header
  const thead = document.getElementById('students-thead');
  thead.innerHTML = `<tr>
    <th>#</th>
    <th>First Name</th>
    <th>Last Name</th>
    <th>Grade</th>
    ${comps.map(c => `<th>${c.name}</th>`).join('')}
  </tr>`;

  // Body
  const tbody = document.getElementById('students-tbody');
  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="${4 + comps.length}" style="text-align:center;padding:32px;color:#9ca3af;">No students found.</td></tr>`;
    document.getElementById('student-count').textContent = '';
    return;
  }

  tbody.innerHTML = students.map((s, i) => `
    <tr>
      <td style="color:#9ca3af">${i + 1}</td>
      <td>${s.firstName}</td>
      <td>${s.lastName}</td>
      <td>Grade ${s.grade}</td>
      ${comps.map(c => {
        const val = s.scores[c.name];
        if (val === undefined || val === null) return '<td>—</td>';
        if (c.type === 'flag') return `<td><span class="${val ? 'flag-yes' : 'flag-no'}">${val ? 'Yes' : 'No'}</span></td>`;
        return `<td><span class="score-badge score-${Math.round(val)}">${val}</span></td>`;
      }).join('')}
    </tr>
  `).join('');

  document.getElementById('student-count').textContent = `${students.length} student${students.length !== 1 ? 's' : ''}`;
}

document.getElementById('grade-filter').addEventListener('change', renderStudentTable);
document.getElementById('student-search').addEventListener('input', renderStudentTable);

// ── Separations modal ──
document.getElementById('manage-separations-btn').addEventListener('click', () => {
  document.getElementById('separations-modal').classList.remove('hidden');
  renderSeparationDropdowns();
  renderSeparationList();
});

document.getElementById('close-separations').addEventListener('click', () => {
  document.getElementById('separations-modal').classList.add('hidden');
});

document.querySelector('.modal-backdrop').addEventListener('click', () => {
  document.getElementById('separations-modal').classList.add('hidden');
});

function sortedStudents() {
  return [...AppState.students].sort((a, b) =>
    `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
  );
}

function renderSeparationDropdowns() {
  const students = sortedStudents();
  const options  = students.map(s =>
    `<option value="${s.id}">${s.lastName}, ${s.firstName} (Gr. ${s.grade})</option>`
  ).join('');
  document.getElementById('sep-student-a').innerHTML = `<option value="">Select student…</option>${options}`;
  document.getElementById('sep-student-b').innerHTML = `<option value="">Select student…</option>${options}`;
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

  // Keep Student A selected so you can quickly add more restrictions for the same student
  const aVal = document.getElementById('sep-student-a').value;
  renderSeparationList();
  document.getElementById('sep-student-a').value = aVal;
  document.getElementById('sep-student-b').value = '';
});

function renderSeparationList() {
  const container = document.getElementById('separations-list');
  if (!AppState.separations.length) {
    container.innerHTML = '<p style="color:#9ca3af;font-size:13px;">No separation rules added yet.</p>';
    return;
  }

  // Group by student A — collect all students each person can't be with
  const groups = new Map();
  AppState.separations.forEach((pair, i) => {
    const a = AppState.students.find(s => s.id === pair.a);
    const b = AppState.students.find(s => s.id === pair.b);
    if (!a || !b) return;

    // Add b to a's group
    if (!groups.has(pair.a)) groups.set(pair.a, { student: a, restricted: [] });
    groups.get(pair.a).restricted.push({ student: b, pairIndex: i });

    // Also index from b's perspective so removal works from either side
    if (!groups.has(pair.b)) groups.set(pair.b, { student: b, restricted: [] });
    groups.get(pair.b).restricted.push({ student: a, pairIndex: i });
  });

  // Deduplicate (same pair appears in both directions) — only render from the "a" side
  const rendered = new Set();
  let html = '';
  AppState.separations.forEach((pair, i) => {
    const a = AppState.students.find(s => s.id === pair.a);
    if (!a || rendered.has(pair.a)) return;
    rendered.add(pair.a);

    const group = groups.get(pair.a);
    const entries = group.restricted.map(r => `
      <div class="sep-entry" data-pair="${r.pairIndex}">
        <div class="sep-entry-name">${r.student.firstName} ${r.student.lastName} <span style="color:var(--gray-400);font-size:12px;">(Gr. ${r.student.grade})</span></div>
        <button class="sep-remove-btn btn btn-sm" style="color:#ef4444;background:none;border:none;cursor:pointer;" data-pair="${r.pairIndex}">Remove</button>
      </div>
    `).join('');

    html += `
      <div class="sep-group">
        <div class="sep-group-header">
          <span class="sep-group-name">${a.firstName} ${a.lastName} <span style="font-weight:400;color:var(--gray-500);">Gr. ${a.grade}</span></span>
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
