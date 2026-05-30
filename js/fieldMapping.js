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
    { key: 'firstName', label: 'First Name', required: false, hint: 'Required if no Student ID' },
    { key: 'lastName',  label: 'Last Name',  required: false, hint: 'Required if no Student ID' },
    { key: 'grade',     label: 'Grade',      required: true  },
    { key: 'studentId', label: 'Student ID', required: false, hint: 'Required if no First/Last Name' },
  ];

  container.innerHTML = fields.map(f => `
    <div class="mapping-row">
      <div class="mapping-label">
        ${f.label}${f.required ? '<span class="required">*</span>' : ''}
        ${f.hint ? `<span class="mapping-hint">${f.hint}</span>` : ''}
      </div>
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

  container.innerHTML = AppState.competencies.map((c, i) => {
    const isScore = c.type === 'score';
    const dir = c.direction || 'asc';
    const rangeHtml = isScore
      ? `<input type="number" class="comp-min input input-sm" value="${c.min ?? 1}" min="0" max="9999" style="width:54px" title="Min value" />
         <span class="range-sep">–</span>
         <input type="number" class="comp-max input input-sm" value="${c.max ?? 5}" min="0" max="9999" style="width:54px" title="Max value" />
         <select class="comp-dir input input-sm" title="Which end of the scale is better?">
           <option value="asc"  ${dir === 'asc'  ? 'selected' : ''}>High = Good</option>
           <option value="desc" ${dir === 'desc' ? 'selected' : ''}>Low = Good</option>
         </select>`
      : `<span style="display:inline-block;width:224px;"></span>`;

    return `
      <div class="competency-item" data-index="${i}">
        <input type="text" value="${c.name}" placeholder="Field name" class="comp-name" />
        <select class="comp-type">
          <option value="score"    ${c.type === 'score'    ? 'selected' : ''}>Score</option>
          <option value="category" ${c.type === 'category' ? 'selected' : ''}>Category</option>
          <option value="flag"     ${c.type === 'flag'     ? 'selected' : ''}>Yes/No Flag</option>
        </select>
        ${rangeHtml}
        <select class="comp-column input input-sm">
          <option value="">— column —</option>
          ${headers.map(h => `<option value="${h}" ${c.column === h ? 'selected' : ''}>${h}</option>`).join('')}
        </select>
        <button class="remove-btn" title="Remove">×</button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.competency-item').forEach((row, i) => {
    row.querySelector('.comp-name').addEventListener('input', e => {
      AppState.competencies[i].name = e.target.value;
    });
    row.querySelector('.comp-type').addEventListener('change', e => {
      AppState.competencies[i].type = e.target.value;
      if (e.target.value === 'score') {
        AppState.competencies[i].min       = AppState.competencies[i].min ?? 1;
        AppState.competencies[i].max       = AppState.competencies[i].max ?? 5;
        AppState.competencies[i].direction = AppState.competencies[i].direction ?? 'asc';
      }
      renderCompetencies();
    });
    const minEl = row.querySelector('.comp-min');
    const maxEl = row.querySelector('.comp-max');
    const dirEl = row.querySelector('.comp-dir');
    if (minEl) minEl.addEventListener('change', e => { AppState.competencies[i].min = parseFloat(e.target.value) || 0; });
    if (maxEl) maxEl.addEventListener('change', e => { AppState.competencies[i].max = parseFloat(e.target.value) || 5; });
    if (dirEl) dirEl.addEventListener('change', e => { AppState.competencies[i].direction = e.target.value; });
    row.querySelector('.comp-column').addEventListener('change', e => {
      AppState.competencies[i].column = e.target.value;
      // Auto-fill the name field if it's still blank
      if (!AppState.competencies[i].name && e.target.value) {
        AppState.competencies[i].name = e.target.value;
        row.querySelector('.comp-name').value = e.target.value;
      }
    });
    row.querySelector('.remove-btn').addEventListener('click', () => {
      AppState.competencies.splice(i, 1);
      renderCompetencies();
    });
  });
}

document.getElementById('add-competency-btn').addEventListener('click', () => {
  AppState.competencies.push({ name: '', type: 'score', column: '', min: 1, max: 5, direction: 'asc' });
  renderCompetencies();
});

// ── Apply mapping ──
document.getElementById('apply-mapping-btn').addEventListener('click', () => {
  const map = AppState.columnMap;
  const hasNames = map.firstName && map.lastName;
  const hasId    = !!map.studentId;
  if (!map.grade) {
    alert('Please map the Grade field before continuing.');
    return;
  }
  if (!hasNames && !hasId) {
    alert('Please map either (First Name + Last Name) or Student ID before continuing.');
    return;
  }

  AppState.students = AppState.rawRows.map((row, i) => {
    const student = {
      id:        i,
      firstName: String(row[map.firstName] || '').trim(),
      lastName:  String(row[map.lastName]  || '').trim(),
      grade:     String(row[map.grade]     || '').trim(),
      studentId: map.studentId ? String(row[map.studentId] || '').trim() : '',
      scores:    {},
    };

    AppState.competencies.forEach(c => {
      if (!c.column || !c.name) return;
      const raw = row[c.column];
      if (c.type === 'score') {
        const num = parseFloat(raw);
        const min = c.min ?? 1;
        const max = c.max ?? 5;
        student.scores[c.name] = isNaN(num) ? null : Math.min(max, Math.max(min, num));
      } else if (c.type === 'category') {
        const val = String(raw ?? '').trim();
        student.scores[c.name] = val || null;
      } else {
        // flag
        const val = String(raw).toLowerCase().trim();
        student.scores[c.name] = ['yes', 'y', '1', 'true'].includes(val);
      }
    });

    return student;
  }).filter(s => s.firstName || s.lastName || s.studentId);

  // Auto-switch to ID mode if no names were mapped
  if (!hasNames) AppState.displayMode = 'id';

  if (typeof trackEvent === 'function') trackEvent('field_mapping_applied', { studentCount: AppState.students.length });
  updateSidebarStatus();
  renderStudents();
  buildGradeConfig();
  navigateTo('students');
});
