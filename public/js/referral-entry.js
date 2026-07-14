/**
 * referral-entry.js
 * New Referral form: populate dropdowns, student autocomplete (with grade/IEP
 * autofill), validation, and save.
 */

// ── Populate the form's select dropdowns from config lists ──────────────────
function _fillSelect(elId, items, placeholder) {
  const sel = document.getElementById(elId);
  const opts = items.map(i => `<option value="${i.id}">${refEsc(i.label)}</option>`).join('');
  sel.innerHTML = `<option value="">${placeholder}</option>` + opts;
}

function initEntryView() {
  document.getElementById('ref-date').value = refTodayISO();
  _fillSelect('ref-location',   RefState.locations,   '— Select —');
  _fillSelect('ref-behavior',   RefState.behaviors,   '— Select —');
  _fillSelect('ref-motivation', RefState.motivations, '— Select —');
  _fillSelect('ref-others',     RefState.others,      '— Select —');
  _fillSelect('ref-action',     RefState.actions,     '— Select —');
  renderCustomFieldInputs();
  updateReviewerHint();
  clearReferralForm();
}

// Render the school's custom fields as dropdowns in the side column.
function renderCustomFieldInputs() {
  const wrap = document.getElementById('ref-custom-fields');
  if (!wrap) return;
  const fields = RefState.customFields || [];
  wrap.innerHTML = fields.map(f => {
    const opts = (f.options || [])
      .map(o => `<option value="${o.id}">${refEsc(o.label)}</option>`).join('');
    return `
      <div class="field-group">
        <label class="field-label">${refEsc(f.label)}</label>
        <select class="cico-input cico-select ref-custom-input" data-field-id="${f.id}">
          <option value="">— Select —</option>${opts}
        </select>
      </div>`;
  }).join('');
}

// Show the configured default reviewer's name next to the checkbox (admins have
// the staff list loaded; plain users just see "Send to reviewer").
function updateReviewerHint() {
  const hint = document.getElementById('ref-reviewer-hint');
  if (!hint) return;
  const rid = RefState.settings && RefState.settings.default_reviewer_id;
  const staff = (RefState.schoolStaff || []).find(s => s.id === rid);
  hint.textContent = staff ? `→ ${staff.full_name || staff.email}` : '';
}

// ── Student autocomplete ─────────────────────────────────────────────────────
function renderStudentDropdown(term) {
  const dd = document.getElementById('ref-student-dropdown');
  const t = term.toLowerCase().trim();
  if (!t) { dd.classList.add('hidden'); return; }

  const matches = RefState.students.filter(s =>
    `${s.first_name} ${s.last_name}`.toLowerCase().includes(t) ||
    (s.student_ref || '').toLowerCase().includes(t)
  ).slice(0, 12);

  if (!matches.length) {
    dd.innerHTML = '<div class="student-dropdown-item muted">No matches</div>';
    dd.classList.remove('hidden');
    return;
  }

  dd.innerHTML = matches.map(s => {
    const meta = [s.grade ? 'Gr ' + s.grade : '', s.homeroom, s.student_ref].filter(Boolean).join(' · ');
    return `<div class="student-dropdown-item" data-student-id="${s.id}">
      <strong>${refEsc(s.last_name)}, ${refEsc(s.first_name)}</strong>
      ${meta ? `<span class="muted"> — ${refEsc(meta)}</span>` : ''}
    </div>`;
  }).join('');
  dd.classList.remove('hidden');
}

function selectEntryStudent(id) {
  const s = RefState.students.find(st => st.id === id);
  if (!s) return;
  document.getElementById('ref-student-id').value = s.id;
  document.getElementById('ref-student-search').value = `${s.last_name}, ${s.first_name}`;
  document.getElementById('ref-grade').value = s.grade || '';
  document.getElementById('ref-iep').value   = s.iep ? 'IEP' : 'No IEP';
  document.getElementById('ref-student-dropdown').classList.add('hidden');
}

// ── Clear ─────────────────────────────────────────────────────────────────────
function clearReferralForm() {
  document.getElementById('ref-student-id').value = '';
  document.getElementById('ref-student-search').value = '';
  document.getElementById('ref-grade').value = '';
  document.getElementById('ref-iep').value = '';
  document.getElementById('ref-staff').value = '';
  document.getElementById('ref-time').value = '';
  document.getElementById('ref-notes').value = '';
  document.getElementById('ref-type').value = 'major';
  document.getElementById('ref-seclusion').value = 'no';
  ['ref-location','ref-behavior','ref-motivation','ref-others','ref-action'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.querySelectorAll('#ref-custom-fields .ref-custom-input').forEach(s => { s.value = ''; });
  const sendCb = document.getElementById('ref-send-review');
  if (sendCb) sendCb.checked = false;
  document.getElementById('ref-date').value = refTodayISO();
}

// ── Save ────────────────────────────────────────────────────────────────────
async function saveReferral() {
  const studentId  = document.getElementById('ref-student-id').value;
  const behaviorId = document.getElementById('ref-behavior').value;
  const actionId   = document.getElementById('ref-action').value;
  const date       = document.getElementById('ref-date').value;

  if (!studentId)  { refToast('Please select a student.', 'error'); return; }
  if (!date)       { refToast('Please choose a date.', 'error'); return; }
  if (!behaviorId) { refToast('Behavior is required.', 'error'); return; }
  if (!actionId)   { refToast('Action Taken is required.', 'error'); return; }

  const student = RefState.students.find(s => s.id === studentId);

  // Collect custom field selections → { field_id: option_id }
  const customValues = {};
  document.querySelectorAll('#ref-custom-fields .ref-custom-input').forEach(sel => {
    if (sel.value) customValues[sel.dataset.fieldId] = sel.value;
  });

  const sendReview = document.getElementById('ref-send-review').checked;

  const payload = {
    school_id:           RefState.schoolId,
    student_id:          studentId,
    referral_type:       document.getElementById('ref-type').value,
    referring_staff:     document.getElementById('ref-staff').value.trim() || null,
    incident_date:       date,
    incident_time:       document.getElementById('ref-time').value || null,
    location_id:         document.getElementById('ref-location').value   || null,
    behavior_id:         behaviorId,
    motivation_id:       document.getElementById('ref-motivation').value || null,
    others_involved_id:  document.getElementById('ref-others').value     || null,
    action_id:           actionId,
    seclusion_restraint: document.getElementById('ref-seclusion').value === 'yes',
    notes:               document.getElementById('ref-notes').value.trim() || null,
    grade_at_referral:   student ? (student.grade || null) : null,
    iep_at_referral:     student ? !!student.iep : null,
    reported_by:         RefState.currentUser.id,
    custom_values:       customValues,
    status:              sendReview ? 'pending_review' : 'open',
  };

  const btn = document.getElementById('save-referral-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const { error } = await SupabaseClient.from('referral_referrals').insert(payload);
    if (error) throw error;
    refToast('✅ Referral saved.', 'success');
    clearReferralForm();
  } catch (err) {
    console.error('Save referral error:', err);
    refToast('Failed to save referral.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save Referral';
  }
}

// ── Event binding ───────────────────────────────────────────────────────────
function bindEntryEvents() {
  const searchInput = document.getElementById('ref-student-search');
  searchInput.addEventListener('input', () => {
    document.getElementById('ref-student-id').value = '';  // clear selection on retype
    document.getElementById('ref-grade').value = '';
    document.getElementById('ref-iep').value = '';
    renderStudentDropdown(searchInput.value);
  });
  searchInput.addEventListener('focus', () => {
    if (searchInput.value) renderStudentDropdown(searchInput.value);
  });
  // Hide dropdown when clicking away
  document.addEventListener('click', e => {
    if (!e.target.closest('#ref-student-wrap')) {
      document.getElementById('ref-student-dropdown').classList.add('hidden');
    }
  });
  document.getElementById('ref-student-dropdown').addEventListener('click', e => {
    const item = e.target.closest('[data-student-id]');
    if (item) selectEntryStudent(item.getAttribute('data-student-id'));
  });

  document.getElementById('save-referral-btn').addEventListener('click', saveReferral);
  document.getElementById('clear-referral-btn').addEventListener('click', clearReferralForm);
}
