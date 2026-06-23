/**
 * referral-students.js
 * Shared student roster: list, search, add/edit, deactivate, and Excel/CSV import.
 * The `students` table is shared with CICO, so changes here also affect that app.
 */

let _refImportRows = [];

// ── Render ────────────────────────────────────────────────────────────────────
function renderRefStudentList() {
  const container = document.getElementById('ref-student-list');
  const term = (document.getElementById('ref-students-search').value || '').toLowerCase().trim();

  let list = RefState.students;
  if (term) {
    list = list.filter(s =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(term) ||
      (s.student_ref || '').toLowerCase().includes(term));
  }

  if (!list.length) {
    container.innerHTML = `<p class="empty-state">${term ? 'No students match your search.' : 'No students yet. Add one or import a roster.'}</p>`;
    return;
  }

  const rows = list.map(s => `
    <tr>
      <td>${refEsc(s.last_name)}, ${refEsc(s.first_name)}</td>
      <td>${refEsc(s.grade) || '—'}</td>
      <td>${refEsc(s.homeroom) || '—'}</td>
      <td>${refEsc(s.race_ethnicity) || '—'}</td>
      <td>${s.iep ? 'Yes' : '—'}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="btn-cico btn-ghost-cico btn-sm-cico" data-rstudent-edit="${s.id}">Edit</button>
        <button class="btn-cico btn-ghost-cico btn-sm-cico" data-rstudent-remove="${s.id}">Remove</button>
      </td>
    </tr>`).join('');

  container.innerHTML = `
    <table class="cico-table">
      <thead>
        <tr><th>Student</th><th>Grade</th><th>Homeroom</th><th>Race/Ethnicity</th><th>IEP</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function populateRaceSelect() {
  const sel = document.getElementById('rstudent-race');
  sel.innerHTML = '<option value="">—</option>' +
    RACE_OPTIONS.map(r => `<option value="${refEsc(r)}">${refEsc(r)}</option>`).join('');
}

// ── Add / edit modal ────────────────────────────────────────────────────────
function openAddRefStudentModal() {
  document.getElementById('rstudent-modal-title').textContent = 'Add Student';
  document.getElementById('edit-rstudent-id').value = '';
  ['rstudent-first','rstudent-last','rstudent-grade','rstudent-homeroom','rstudent-ref'].forEach(id =>
    document.getElementById(id).value = '');
  populateRaceSelect();
  document.getElementById('rstudent-race').value = '';
  document.getElementById('rstudent-gender').value = '';
  document.getElementById('rstudent-iep').checked = false;
  document.getElementById('ref-student-modal').classList.remove('hidden');
}

function openEditRefStudentModal(id) {
  const s = RefState.students.find(st => st.id === id);
  if (!s) return;
  document.getElementById('rstudent-modal-title').textContent = 'Edit Student';
  document.getElementById('edit-rstudent-id').value = s.id;
  document.getElementById('rstudent-first').value    = s.first_name || '';
  document.getElementById('rstudent-last').value     = s.last_name || '';
  document.getElementById('rstudent-grade').value    = s.grade || '';
  document.getElementById('rstudent-homeroom').value = s.homeroom || '';
  document.getElementById('rstudent-ref').value      = s.student_ref || '';
  populateRaceSelect();
  document.getElementById('rstudent-race').value     = s.race_ethnicity || '';
  document.getElementById('rstudent-gender').value   = s.gender || '';
  document.getElementById('rstudent-iep').checked    = !!s.iep;
  document.getElementById('ref-student-modal').classList.remove('hidden');
}

function closeRefStudentModal() {
  document.getElementById('ref-student-modal').classList.add('hidden');
}

async function saveRefStudent() {
  const id    = document.getElementById('edit-rstudent-id').value;
  const first = document.getElementById('rstudent-first').value.trim();
  const last  = document.getElementById('rstudent-last').value.trim();
  if (!first || !last) { refToast('First and last name are required.', 'error'); return; }

  const payload = {
    first_name:     first,
    last_name:      last,
    grade:          document.getElementById('rstudent-grade').value.trim() || null,
    homeroom:       document.getElementById('rstudent-homeroom').value.trim() || null,
    student_ref:    document.getElementById('rstudent-ref').value.trim() || null,
    race_ethnicity: document.getElementById('rstudent-race').value || null,
    gender:         document.getElementById('rstudent-gender').value || null,
    iep:            document.getElementById('rstudent-iep').checked,
    school_id:      RefState.schoolId || null,
  };

  try {
    if (id) {
      const { error } = await SupabaseClient.from('students').update(payload).eq('id', id);
      if (error) throw error;
      const idx = RefState.students.findIndex(s => s.id === id);
      if (idx >= 0) RefState.students[idx] = { ...RefState.students[idx], ...payload };
      refToast('Student updated.', 'success');
    } else {
      const { data, error } = await SupabaseClient.from('students').insert(payload).select().single();
      if (error) throw error;
      RefState.students.push(data);
      refToast('Student added.', 'success');
    }
    RefState.students.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    closeRefStudentModal();
    renderRefStudentList();
  } catch (err) {
    console.error('Save student error:', err);
    refToast('Failed to save student.', 'error');
  }
}

async function removeRefStudent(id) {
  const s = RefState.students.find(st => st.id === id);
  if (!s) return;
  const name = `${s.first_name} ${s.last_name}`;
  if (!confirm(`Remove ${name} from your school roster?\n\nThis marks them inactive in BOTH Referral Tracking and Check-in / Check-out. Existing records are preserved.`)) return;
  try {
    const { error } = await SupabaseClient.from('students').update({ active: false }).eq('id', id);
    if (error) throw error;
    RefState.students = RefState.students.filter(st => st.id !== id);
    renderRefStudentList();
    refToast(`${name} removed.`, 'success');
  } catch (err) {
    console.error('Remove student error:', err);
    refToast('Failed to remove student.', 'error');
  }
}

// ── Import ────────────────────────────────────────────────────────────────────
function openRefImportModal() {
  _refImportRows = [];
  document.getElementById('ref-import-preview').innerHTML = '';
  document.getElementById('ref-import-confirm').disabled = true;
  document.getElementById('ref-import-file').value = '';
  document.getElementById('ref-import-modal').classList.remove('hidden');
}
function closeRefImportModal() {
  document.getElementById('ref-import-modal').classList.add('hidden');
}

// Header aliases → canonical field
const _COL_ALIASES = {
  first_name: ['first name','first','firstname','given name'],
  last_name:  ['last name','last','lastname','surname','family name'],
  grade:      ['grade','grade level','gr'],
  homeroom:   ['homeroom','homeroom teacher','teacher','hr'],
  student_ref:['student id','student ref','id','student number','sis id'],
  race_ethnicity:['race','ethnicity','race/ethnicity','race ethnicity'],
  gender:     ['gender','sex'],
  iep:        ['iep','iep status','has iep','sped'],
};

function _matchColumn(header) {
  const h = String(header || '').toLowerCase().trim();
  for (const field in _COL_ALIASES) {
    if (_COL_ALIASES[field].includes(h)) return field;
  }
  return null;
}

function _truthy(v) {
  const s = String(v || '').toLowerCase().trim();
  return ['y','yes','true','1','x','iep'].includes(s);
}

function handleRefImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const wb = XLSX.read(ev.target.result, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      if (!raw.length) { refToast('That file looks empty.', 'error'); return; }

      const headers = raw[0].map(_matchColumn);
      if (!headers.includes('first_name') || !headers.includes('last_name')) {
        refToast('File must have First Name and Last Name columns.', 'error');
        return;
      }

      _refImportRows = raw.slice(1).map(row => {
        const rec = { school_id: RefState.schoolId || null };
        headers.forEach((field, i) => {
          if (!field) return;
          const val = row[i];
          if (field === 'iep') rec.iep = _truthy(val);
          else rec[field] = (val === undefined || val === null || val === '') ? null : String(val).trim();
        });
        return rec;
      }).filter(r => r.first_name && r.last_name);

      const preview = document.getElementById('ref-import-preview');
      if (!_refImportRows.length) {
        preview.innerHTML = '<p class="empty-state">No valid student rows found.</p>';
        document.getElementById('ref-import-confirm').disabled = true;
        return;
      }
      preview.innerHTML = `<p style="font-size:14px;color:#374151;">Ready to import <strong>${_refImportRows.length}</strong> student${_refImportRows.length !== 1 ? 's' : ''}.</p>`;
      document.getElementById('ref-import-confirm').disabled = false;
    } catch (err) {
      console.error('Import parse error:', err);
      refToast('Could not read that file.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmRefImport() {
  if (!_refImportRows.length) return;
  const btn = document.getElementById('ref-import-confirm');
  btn.disabled = true; btn.textContent = 'Importing…';
  try {
    const { data, error } = await SupabaseClient.from('students').insert(_refImportRows).select();
    if (error) throw error;
    (data || []).forEach(s => RefState.students.push(s));
    RefState.students.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    closeRefImportModal();
    renderRefStudentList();
    refToast(`✅ Imported ${data.length} student${data.length !== 1 ? 's' : ''}.`, 'success');
  } catch (err) {
    console.error('Import error:', err);
    refToast('Import failed. Please check the file and try again.', 'error');
  } finally {
    btn.textContent = 'Import';
  }
}

// ── Event binding ───────────────────────────────────────────────────────────
function bindStudentEvents() {
  document.getElementById('ref-add-student-btn').addEventListener('click', openAddRefStudentModal);
  document.getElementById('ref-students-search').addEventListener('input', renderRefStudentList);

  // Modal
  document.querySelector('#ref-student-modal .cico-modal-backdrop').addEventListener('click', closeRefStudentModal);
  document.getElementById('rstudent-modal-close').addEventListener('click', closeRefStudentModal);
  document.getElementById('rstudent-modal-cancel').addEventListener('click', closeRefStudentModal);
  document.getElementById('rstudent-modal-save').addEventListener('click', saveRefStudent);

  // Import
  document.getElementById('ref-import-btn').addEventListener('click', openRefImportModal);
  document.querySelector('#ref-import-modal .cico-modal-backdrop').addEventListener('click', closeRefImportModal);
  document.getElementById('ref-import-close').addEventListener('click', closeRefImportModal);
  document.getElementById('ref-import-cancel').addEventListener('click', closeRefImportModal);
  document.getElementById('ref-browse-btn').addEventListener('click', () => document.getElementById('ref-import-file').click());
  document.getElementById('ref-import-file').addEventListener('change', handleRefImportFile);
  document.getElementById('ref-import-confirm').addEventListener('click', confirmRefImport);

  // Delegated row actions
  document.getElementById('ref-student-list').addEventListener('click', e => {
    const editBtn = e.target.closest('[data-rstudent-edit]');
    const rmBtn   = e.target.closest('[data-rstudent-remove]');
    if (editBtn) openEditRefStudentModal(editBtn.getAttribute('data-rstudent-edit'));
    if (rmBtn)   removeRefStudent(rmBtn.getAttribute('data-rstudent-remove'));
  });
}
