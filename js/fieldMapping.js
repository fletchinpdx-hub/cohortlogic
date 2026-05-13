function renderFieldMapping() {
  renderColumnMapping();
  renderCompetencies();
}

// ── Required column mapping ──
function renderColumnMapping() {
  const container = document.getElementById('mapping-table');
  const headers   = AppState.rawHeaders;
  const map       = AppState.columnMap;

  const fields = [
    { key: 'firstName', label: 'First Name', required: true },
    { key: 'lastName',  label: 'Last Name',  required: true },
    { key: 'grade',     label: 'Grade',      required: true },
  ];

  container.innerHTML = fields.map(f => `
    <div class="mapping-row">
      <div class="mapping-label">${f.label}${f.required ? '<span class="required">*</span>' : ''}</div>
      <select class="input" data-field="${f.key}">
        <option value="">— select column —</option>
        ${headers.map(h => `<option value="${h}" ${map[f.key] === h ? 'selected' : ''}>${h}</option>`).join('')}
      </select>
    </div>
  `).join('');

  container.querySelectorAll('select').forEach(sel => {
    sel.addEventListener('change', () => {
      AppState.columnMap[sel.dataset.field] = sel.value;
    });
  });
}

// ── Competency list ──
function renderCompetencies() {
  const container = document.getElementById('competency-list');
  const headers   = AppState.rawHeaders;

  container.innerHTML = AppState.competencies.map((c, i) => `
    <div class="competency-item" data-index="${i}">
      <input type="text" value="${c.name}" placeholder="Field name" class="comp-name" />
      <select class="comp-type">
        <option value="score" ${c.type === 'score' ? 'selected' : ''}>Score (1–5)</option>
        <option value="flag"  ${c.type === 'flag'  ? 'selected' : ''}>Yes/No Flag</option>
      </select>
      <select class="comp-column input input-sm">
        <option value="">— column —</option>
        ${headers.map(h => `<option value="${h}" ${c.column === h ? 'selected' : ''}>${h}</option>`).join('')}
      </select>
      <button class="remove-btn" title="Remove">×</button>
    </div>
  `).join('');

  container.querySelectorAll('.competency-item').forEach((row, i) => {
    row.querySelector('.comp-name').addEventListener('input', e => {
      AppState.competencies[i].name = e.target.value;
    });
    row.querySelector('.comp-type').addEventListener('change', e => {
      AppState.competencies[i].type = e.target.value;
    });
    row.querySelector('.comp-column').addEventListener('change', e => {
      AppState.competencies[i].column = e.target.value;
    });
    row.querySelector('.remove-btn').addEventListener('click', () => {
      AppState.competencies.splice(i, 1);
      renderCompetencies();
    });
  });
}

document.getElementById('add-competency-btn').addEventListener('click', () => {
  AppState.competencies.push({ name: '', type: 'score', column: '' });
  renderCompetencies();
});

// ── Apply mapping ──
document.getElementById('apply-mapping-btn').addEventListener('click', () => {
  const map = AppState.columnMap;
  if (!map.firstName || !map.lastName || !map.grade) {
    alert('Please map First Name, Last Name, and Grade before continuing.');
    return;
  }

  // Build student objects from raw rows
  AppState.students = AppState.rawRows.map((row, i) => {
    const student = {
      id:        i,
      firstName: String(row[map.firstName] || '').trim(),
      lastName:  String(row[map.lastName]  || '').trim(),
      grade:     String(row[map.grade]     || '').trim(),
      scores:    {},
    };

    AppState.competencies.forEach(c => {
      if (!c.column || !c.name) return;
      const raw = row[c.column];
      if (c.type === 'score') {
        const num = parseFloat(raw);
        student.scores[c.name] = isNaN(num) ? null : Math.min(5, Math.max(1, num));
      } else {
        const val = String(raw).toLowerCase().trim();
        student.scores[c.name] = ['yes', 'y', '1', 'true'].includes(val);
      }
    });

    return student;
  }).filter(s => s.firstName || s.lastName);

  updateSidebarStatus();
  renderStudents();
  buildGradeConfig();
  navigateTo('students');
});
