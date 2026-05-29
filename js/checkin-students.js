/**
 * checkin-students.js
 * Students view: list, add/edit, delete, and import from Excel.
 */

// ── Render Student List ────────────────────────────────────────────────────
function renderStudentList() {
  const tbody    = document.getElementById('students-tbody');
  const table    = document.getElementById('students-table');
  const empty    = document.getElementById('students-empty');
  const searchQ  = (document.getElementById('students-search').value || '').toLowerCase().trim();

  const filtered = CicoState.students.filter(s => {
    if (!searchQ) return true;
    const full = `${s.first_name} ${s.last_name}`.toLowerCase();
    const ref  = (s.student_ref || '').toLowerCase();
    return full.includes(searchQ) || ref.includes(searchQ);
  });

  if (!filtered.length) {
    table.classList.add('hidden');
    empty.style.display = 'block';
    empty.textContent = CicoState.students.length
      ? 'No students match your search.'
      : 'No students yet. Add students above or import from Excel.';
    return;
  }

  empty.style.display = 'none';
  table.classList.remove('hidden');

  tbody.innerHTML = filtered.map(s => `
    <tr>
      <td><strong>${escHtml(s.last_name)}</strong>, ${escHtml(s.first_name)}</td>
      <td>${escHtml(s.grade || '—')}</td>
      <td>${escHtml(s.homeroom || '—')}</td>
      <td style="font-family:monospace;font-size:12px;">${escHtml(s.student_ref || '—')}</td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="action-btn" onclick="openEditStudentModal('${s.id}')" title="Edit">✏️</button>
          <button class="action-btn danger" onclick="deleteStudent('${s.id}')" title="Remove">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterStudentList() {
  renderStudentList();
}

// ── Add / Edit Student Modal ───────────────────────────────────────────────
function openAddStudentModal() {
  document.getElementById('student-modal-title').textContent = 'Add Student';
  document.getElementById('edit-student-id').value   = '';
  document.getElementById('student-first').value     = '';
  document.getElementById('student-last').value      = '';
  document.getElementById('student-grade').value     = '';
  document.getElementById('student-homeroom').value  = '';
  document.getElementById('student-ref').value       = '';
  document.getElementById('student-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('student-first').focus(), 50);
}

function openEditStudentModal(id) {
  const s = CicoState.students.find(st => st.id === id);
  if (!s) return;
  document.getElementById('student-modal-title').textContent = 'Edit Student';
  document.getElementById('edit-student-id').value  = s.id;
  document.getElementById('student-first').value    = s.first_name || '';
  document.getElementById('student-last').value     = s.last_name  || '';
  document.getElementById('student-grade').value    = s.grade      || '';
  document.getElementById('student-homeroom').value = s.homeroom   || '';
  document.getElementById('student-ref').value      = s.student_ref || '';
  document.getElementById('student-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('student-first').focus(), 50);
}

function closeStudentModal() {
  document.getElementById('student-modal').classList.add('hidden');
}

async function saveStudent() {
  const id       = document.getElementById('edit-student-id').value;
  const first    = document.getElementById('student-first').value.trim();
  const last     = document.getElementById('student-last').value.trim();
  const grade    = document.getElementById('student-grade').value.trim();
  const homeroom = document.getElementById('student-homeroom').value.trim();
  const ref      = document.getElementById('student-ref').value.trim();

  if (!first || !last) {
    showToast('First and last name are required.', 'error');
    return;
  }

  const payload = {
    first_name:  first,
    last_name:   last,
    grade:       grade  || null,
    homeroom:    homeroom || null,
    student_ref: ref    || null
  };

  try {
    if (id) {
      // Update
      const { error } = await SupabaseClient.from('cico_students').update(payload).eq('id', id);
      if (error) throw error;
      const idx = CicoState.students.findIndex(s => s.id === id);
      if (idx >= 0) CicoState.students[idx] = { ...CicoState.students[idx], ...payload };
      showToast('Student updated.', 'success');
    } else {
      // Insert
      const { data, error } = await SupabaseClient.from('cico_students').insert(payload).select().single();
      if (error) throw error;
      CicoState.students.push(data);
      // Re-sort
      CicoState.students.sort((a,b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
      showToast('Student added.', 'success');
    }

    closeStudentModal();
    renderStudentList();

  } catch (err) {
    console.error('Save student error:', err);
    showToast('Failed to save student.', 'error');
  }
}

async function deleteStudent(id) {
  const s = CicoState.students.find(st => st.id === id);
  if (!s) return;
  const name = `${s.first_name} ${s.last_name}`;
  if (!confirm(`Remove ${name} from Check-in / Check-out?\n\nThis will mark them inactive. Existing check-in records will be preserved.`)) return;

  try {
    const { error } = await SupabaseClient.from('cico_students').update({ active: false }).eq('id', id);
    if (error) throw error;
    CicoState.students = CicoState.students.filter(st => st.id !== id);
    renderStudentList();
    showToast(`${name} removed.`, 'success');
  } catch (err) {
    console.error('Delete student error:', err);
    showToast('Failed to remove student.', 'error');
  }
}

// ── Import Students from Excel ─────────────────────────────────────────────
let _importRawData   = null;  // parsed rows
let _importHeaders   = null;  // column names

function openStudentImportModal() {
  _importRawData = null;
  _importHeaders = null;

  document.getElementById('import-step-1').classList.remove('hidden');
  document.getElementById('import-step-2').classList.add('hidden');
  document.getElementById('confirm-import-btn').classList.add('hidden');
  document.getElementById('import-file-input').value = '';
  document.getElementById('import-students-modal').classList.remove('hidden');

  // Drag-and-drop
  const dz = document.getElementById('import-drop-zone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processImportFile(file);
  });
}

function closeStudentImportModal() {
  document.getElementById('import-students-modal').classList.add('hidden');
  _importRawData = null;
  _importHeaders = null;
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (file) processImportFile(file);
}

function processImportFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb    = XLSX.read(e.target.result, { type: 'binary' });
      const ws    = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length < 2) { showToast('File appears empty.', 'error'); return; }

      _importHeaders = rows[0].map(h => String(h).trim());
      _importRawData = rows.slice(1).filter(r => r.some(c => c !== ''));

      showImportMapping();
    } catch (err) {
      console.error('File parse error:', err);
      showToast('Could not read file. Make sure it is a valid .xlsx file.', 'error');
    }
  };
  reader.readAsBinaryString(file);
}

function showImportMapping() {
  document.getElementById('import-step-1').classList.add('hidden');
  document.getElementById('import-step-2').classList.remove('hidden');
  document.getElementById('confirm-import-btn').classList.remove('hidden');

  const fields = [
    { key: 'first_name', label: 'First Name *', required: true },
    { key: 'last_name',  label: 'Last Name *',  required: true },
    { key: 'grade',      label: 'Grade',         required: false },
    { key: 'homeroom',   label: 'Homeroom',      required: false },
    { key: 'student_ref',label: 'Student ID',    required: false }
  ];

  const optionsHtml = ['— Skip —', ..._importHeaders].map((h, i) =>
    `<option value="${i === 0 ? '' : i - 1}">${escHtml(h)}</option>`
  ).join('');

  // Auto-guess
  function guessCol(keywords) {
    for (let k of keywords) {
      const idx = _importHeaders.findIndex(h => h.toLowerCase().includes(k));
      if (idx >= 0) return idx;
    }
    return -1;
  }

  const guesses = {
    first_name:  guessCol(['first', 'fname']),
    last_name:   guessCol(['last', 'lname', 'surname']),
    grade:       guessCol(['grade']),
    homeroom:    guessCol(['homeroom', 'teacher', 'room', 'class']),
    student_ref: guessCol(['id', 'student id', 'sis', 'ref'])
  };

  const mapHtml = document.getElementById('import-column-map');
  mapHtml.innerHTML = fields.map(f => `
    <div class="import-col-row">
      <label class="import-col-label">${f.label}</label>
      <select id="map-${f.key}" class="cico-input cico-select" style="width:100%;">
        ${['— Skip —', ..._importHeaders].map((h, i) => {
          const val = i === 0 ? '' : i - 1;
          const selected = (guesses[f.key] >= 0 && guesses[f.key] === i - 1) ? 'selected' : '';
          return `<option value="${val}" ${selected}>${escHtml(h)}</option>`;
        }).join('')}
      </select>
    </div>
  `).join('');

  // Preview: first 5 rows
  const preview = _importRawData.slice(0, 5);
  document.getElementById('import-preview').innerHTML = `
    <p style="font-size:12px;color:var(--ci-text-3);margin-bottom:8px;">Preview (first ${preview.length} rows):</p>
    <div style="overflow-x:auto;font-size:12px;border:1px solid var(--ci-hairline);border-radius:8px;">
      <table style="border-collapse:collapse;width:100%;">
        <thead>
          <tr>${_importHeaders.map(h => `<th style="padding:6px 10px;background:var(--ci-bg);white-space:nowrap;">${escHtml(h)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${preview.map(row => `<tr>${row.map(c => `<td style="padding:5px 10px;border-top:1px solid var(--ci-hairline);">${escHtml(String(c))}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function confirmStudentImport() {
  const getCol = key => {
    const val = document.getElementById(`map-${key}`)?.value;
    return val !== '' && val !== undefined ? parseInt(val) : null;
  };

  const firstIdx = getCol('first_name');
  const lastIdx  = getCol('last_name');

  if (firstIdx === null || lastIdx === null) {
    showToast('First Name and Last Name columns are required.', 'error');
    return;
  }

  const gradeIdx    = getCol('grade');
  const homeroomIdx = getCol('homeroom');
  const refIdx      = getCol('student_ref');

  const rows = _importRawData.map(row => ({
    first_name:  String(row[firstIdx] || '').trim(),
    last_name:   String(row[lastIdx]  || '').trim(),
    grade:       gradeIdx    !== null ? String(row[gradeIdx]    || '').trim() || null : null,
    homeroom:    homeroomIdx !== null ? String(row[homeroomIdx] || '').trim() || null : null,
    student_ref: refIdx      !== null ? String(row[refIdx]      || '').trim() || null : null
  })).filter(r => r.first_name && r.last_name);

  if (!rows.length) {
    showToast('No valid student rows found.', 'error');
    return;
  }

  const btn = document.getElementById('confirm-import-btn');
  btn.disabled = true;
  btn.textContent = 'Importing…';

  try {
    const { data, error } = await SupabaseClient.from('cico_students').insert(rows).select();
    if (error) throw error;

    (data || []).forEach(s => CicoState.students.push(s));
    CicoState.students.sort((a,b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));

    closeStudentImportModal();
    renderStudentList();
    showToast(`✅ Imported ${rows.length} student${rows.length !== 1 ? 's' : ''}.`, 'success');
  } catch (err) {
    console.error('Import error:', err);
    showToast('Import failed. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import Students';
  }
}
