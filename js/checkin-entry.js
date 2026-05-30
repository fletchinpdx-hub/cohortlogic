/**
 * checkin-entry.js
 * Handles the Check-in Entry view:
 *  - Student search dropdown
 *  - Period × Category score grid
 *  - Incident logging modal
 *  - Save to Supabase
 */

// ── Initialize Entry View ──────────────────────────────────────────────────
function initEntryView() {
  // Set today's date
  const dateInput = document.getElementById('entry-date');
  dateInput.value = todayISO();
  CicoState.entry.date = dateInput.value;
  dateInput.addEventListener('change', () => {
    CicoState.entry.date = dateInput.value;
  });

  // Wire clear button
  document.getElementById('clear-entry-btn').addEventListener('click', clearEntryForm);

  // Populate schedule selector
  populateEntryScheduleSelector();

  // Init student search
  initStudentSearch();

  // Init period grid (empty state until student selected)
  updateEntryGrid();
}

// ── Schedule Selector ──────────────────────────────────────────────────────
function populateEntryScheduleSelector() {
  const sel = document.getElementById('entry-schedule-sel');
  if (!sel) return;

  if (!CicoState.schedules.length) {
    sel.innerHTML = '<option value="">No schedules configured</option>';
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  sel.innerHTML = CicoState.schedules.map(s =>
    `<option value="${s.id}">${escHtml(s.name)} (${s.period_count} periods)</option>`
  ).join('');

  sel.value = CicoState.activeScheduleId || '';
}

function onScheduleChange() {
  const sel = document.getElementById('entry-schedule-sel');
  CicoState.activeScheduleId = sel.value || null;
  if (CicoState.entry.studentId) {
    initEntryPeriods();
    renderPeriodGrid();
  }
}

// ── Student Search Dropdown ────────────────────────────────────────────────
function initStudentSearch() {
  const input = document.getElementById('student-search-input');
  const dropdown = document.getElementById('student-dropdown');
  const hiddenId = document.getElementById('selected-student-id');

  let highlightIdx = -1;

  function getMatches(query) {
    const q = query.toLowerCase().trim();
    if (!q) return CicoState.students.slice(0, 20);
    return CicoState.students.filter(s => {
      const full = `${s.first_name} ${s.last_name}`.toLowerCase();
      const ref  = (s.student_ref || '').toLowerCase();
      return full.includes(q) || ref.includes(q);
    }).slice(0, 20);
  }

  function renderDropdown(matches) {
    if (!matches.length) {
      dropdown.innerHTML = '<div class="student-option" style="color:var(--ci-text-3);">No students found</div>';
      dropdown.classList.remove('hidden');
      return;
    }
    dropdown.innerHTML = matches.map((s, i) => `
      <div class="student-option" data-id="${s.id}" data-idx="${i}">
        <div>${s.first_name} ${s.last_name}</div>
        <div class="opt-sub">${[s.grade ? 'Grade ' + s.grade : '', s.homeroom, s.student_ref].filter(Boolean).join(' · ')}</div>
      </div>
    `).join('');
    dropdown.classList.remove('hidden');
    highlightIdx = -1;
  }

  function selectStudent(id) {
    const s = CicoState.students.find(st => st.id === id);
    if (!s) return;
    CicoState.entry.studentId   = s.id;
    CicoState.entry.studentName = `${s.first_name} ${s.last_name}`;
    hiddenId.value = s.id;
    input.value    = CicoState.entry.studentName;
    dropdown.classList.add('hidden');

    // Recall last schedule used for this student
    recallStudentSchedule(s.id);

    initEntryPeriods();
    updateEntryGrid();
  }

  input.addEventListener('input', () => {
    if (input.value !== CicoState.entry.studentName) {
      // User typed — clear selection
      CicoState.entry.studentId = null;
      hiddenId.value = '';
    }
    renderDropdown(getMatches(input.value));
  });

  input.addEventListener('focus', () => {
    // Don't reopen if a student is already selected and the text matches
    if (CicoState.entry.studentId && input.value === CicoState.entry.studentName) return;
    renderDropdown(getMatches(input.value));
  });

  input.addEventListener('keydown', e => {
    const opts = dropdown.querySelectorAll('.student-option[data-id]');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIdx = Math.min(highlightIdx + 1, opts.length - 1);
      opts.forEach((o, i) => o.classList.toggle('highlighted', i === highlightIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      opts.forEach((o, i) => o.classList.toggle('highlighted', i === highlightIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const highlighted = dropdown.querySelector('.highlighted');
      if (highlighted) selectStudent(highlighted.dataset.id);
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  dropdown.addEventListener('mousedown', e => {
    const opt = e.target.closest('.student-option[data-id]');
    if (opt) selectStudent(opt.dataset.id);
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (!document.getElementById('student-search-wrap').contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

// ── Period Grid ────────────────────────────────────────────────────────────
function updateEntryGrid() {
  const placeholder = document.getElementById('period-grid-placeholder');
  const grid        = document.getElementById('period-grid');
  const notesWrap   = document.getElementById('entry-notes-wrap');
  const saveBar     = document.getElementById('entry-save-bar');

  if (!CicoState.entry.studentId) {
    placeholder.classList.remove('hidden');
    grid.classList.add('hidden');
    notesWrap.classList.add('hidden');
    saveBar.classList.add('hidden');
    return;
  }

  placeholder.classList.add('hidden');
  grid.classList.remove('hidden');
  notesWrap.classList.remove('hidden');
  saveBar.classList.remove('hidden');
  renderPeriodGrid();
}

function renderPeriodGrid() {
  const grid       = document.getElementById('period-grid');
  const categories = CicoState.categories;
  const periods    = CicoState.entry.periods;
  const periodNums = Object.keys(periods).map(Number).sort((a,b) => a-b);

  if (!periodNums.length || !categories.length) {
    grid.innerHTML = '<p style="color:var(--ci-text-3);padding:16px;">No periods or categories configured. Visit Settings.</p>';
    return;
  }

  // Build table
  let html = '<table class="period-table"><thead><tr>';
  html += '<th>Period</th>';
  categories.forEach(cat => { html += `<th>${escHtml(cat.name)}</th>`; });
  html += '<th>Incidents</th>';
  html += '</tr></thead><tbody>';

  periodNums.forEach(p => {
    const periodData = periods[p];
    html += `<tr>`;
    html += `<td><strong>P${p}</strong></td>`;

    // Score cells
    categories.forEach(cat => {
      const currentScore = periodData.scores[cat.id];
      html += `<td><div class="score-cell">`;
      [0, 1, 2].forEach(score => {
        const activeClass = currentScore === score ? `active-${score}` : '';
        html += `<button class="score-btn ${activeClass}"
          onclick="toggleScore(${p}, '${cat.id}', ${score})"
          title="${cat.name}: ${score}">${score}</button>`;
      });
      html += `</div></td>`;
    });

    // Incident cell
    const incidents = periodData.incidents || [];
    html += `<td class="incident-cell">`;
    if (incidents.length) {
      html += `<div class="incident-chips">`;
      incidents.forEach((inc, idx) => {
        const minutesLabel = inc.minutes ? ` ${inc.minutes}m` : '';
        html += `<span class="incident-chip">${escHtml(inc.abbr)}${minutesLabel}
          <button class="incident-chip-remove" onclick="removeIncident(${p}, ${idx})" title="Remove">×</button>
        </span>`;
      });
      html += `</div>`;
    }
    html += `<button class="add-incident-btn" onclick="openIncidentModal(${p})">+ Incident</button>`;
    html += `</td>`;

    html += `</tr>`;
  });

  html += '</tbody></table>';
  grid.innerHTML = html;
}

// ── Schedule recall/persist per student ───────────────────────────────────
function recallStudentSchedule(studentId) {
  try {
    const stored = JSON.parse(localStorage.getItem('cico_student_schedules') || '{}');
    const lastId = stored[studentId];
    if (lastId && CicoState.schedules.find(s => s.id === lastId)) {
      CicoState.activeScheduleId = lastId;
      const sel = document.getElementById('entry-schedule-sel');
      if (sel) sel.value = lastId;
    }
  } catch (_) {}
}

function persistStudentSchedule(studentId) {
  try {
    const stored = JSON.parse(localStorage.getItem('cico_student_schedules') || '{}');
    stored[studentId] = CicoState.activeScheduleId;
    localStorage.setItem('cico_student_schedules', JSON.stringify(stored));
  } catch (_) {}
}

// ── Score toggling ─────────────────────────────────────────────────────────
function toggleScore(period, catId, score) {
  const periods = CicoState.entry.periods;
  if (!periods[period]) return;

  const current = periods[period].scores[catId];
  // Clicking the active score again → deselect
  periods[period].scores[catId] = (current === score) ? null : score;
  renderPeriodGrid();
}

// ── Incident Modal ─────────────────────────────────────────────────────────
function openIncidentModal(period) {
  CicoState._pendingIncident.period = period;

  const types = CicoState.incidentTypes;
  const sel   = document.getElementById('incident-type-sel');
  sel.innerHTML = types.map(t =>
    `<option value="${t.id}" data-minutes="${t.tracks_minutes ? 1 : 0}">${escHtml(t.abbreviation)} — ${escHtml(t.description)}</option>`
  ).join('');

  // Update minutes field visibility on type change
  updateIncidentMinutesVisibility();
  sel.addEventListener('change', updateIncidentMinutesVisibility);

  document.getElementById('incident-context-label').textContent =
    `Period ${period} · ${CicoState.entry.studentName}`;

  document.getElementById('incident-minutes').value = '';
  document.getElementById('incident-notes').value   = '';

  document.getElementById('incident-modal').classList.remove('hidden');
}

function updateIncidentMinutesVisibility() {
  const sel  = document.getElementById('incident-type-sel');
  const grp  = document.getElementById('incident-minutes-group');
  const opt  = sel.selectedOptions[0];
  const show = opt && opt.dataset.minutes === '1';
  grp.style.display = show ? 'block' : 'none';
}

function closeIncidentModal() {
  document.getElementById('incident-modal').classList.add('hidden');
  CicoState._pendingIncident.period = null;
}

function confirmLogIncident() {
  const period  = CicoState._pendingIncident.period;
  const sel     = document.getElementById('incident-type-sel');
  const typeId  = sel.value;
  const opt     = sel.selectedOptions[0];
  const abbr    = opt ? opt.text.split(' — ')[0] : '';
  const minutes = parseInt(document.getElementById('incident-minutes').value) || null;
  const notes   = document.getElementById('incident-notes').value.trim();

  if (!typeId) return;

  CicoState.entry.periods[period].incidents.push({ typeId, abbr, minutes, notes });

  closeIncidentModal();
  renderPeriodGrid();
}

function removeIncident(period, idx) {
  CicoState.entry.periods[period].incidents.splice(idx, 1);
  renderPeriodGrid();
}

// ── Save Check-in ──────────────────────────────────────────────────────────
async function saveCheckin() {
  const valMsg = document.getElementById('entry-validation-msg');
  const btn    = document.getElementById('save-checkin-btn');

  // Validate
  if (!CicoState.entry.studentId) {
    valMsg.textContent = 'Please select a student.';
    valMsg.classList.remove('hidden');
    return;
  }
  if (!CicoState.entry.date) {
    valMsg.textContent = 'Please set a date.';
    valMsg.classList.remove('hidden');
    return;
  }
  valMsg.classList.add('hidden');

  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    // 1. Insert checkin row
    const { data: checkinRow, error: ciErr } = await SupabaseClient
      .from('cico_checkins')
      .insert({
        student_id:    CicoState.entry.studentId,
        check_in_date: CicoState.entry.date,
        submitted_by:  CicoState.currentUser.id,
        school_id:     CicoState.schoolId || null,
        notes:         document.getElementById('entry-notes').value.trim() || null
      })
      .select()
      .single();

    if (ciErr) throw ciErr;
    const checkinId = checkinRow.id;

    // 2. Build period_scores rows (non-null scores only)
    const scoreRows = [];
    const periods   = CicoState.entry.periods;
    Object.entries(periods).forEach(([pNum, pData]) => {
      Object.entries(pData.scores).forEach(([catId, score]) => {
        if (score !== null) {
          scoreRows.push({
            checkin_id:    checkinId,
            period_number: parseInt(pNum),
            category_id:   catId,
            score
          });
        }
      });
    });

    if (scoreRows.length) {
      const { error: scErr } = await SupabaseClient.from('cico_period_scores').insert(scoreRows);
      if (scErr) throw scErr;
    }

    // 3. Build incident rows
    const incidentRows = [];
    Object.entries(periods).forEach(([pNum, pData]) => {
      (pData.incidents || []).forEach(inc => {
        incidentRows.push({
          checkin_id:       checkinId,
          period_number:    parseInt(pNum),
          incident_type_id: inc.typeId,
          minutes:          inc.minutes || null,
          notes:            inc.notes   || null
        });
      });
    });

    if (incidentRows.length) {
      const { error: incErr } = await SupabaseClient.from('cico_incidents').insert(incidentRows);
      if (incErr) throw incErr;
    }

    persistStudentSchedule(CicoState.entry.studentId);
    showToast('✅ Check-in saved!', 'success');
    clearEntryForm();

  } catch (err) {
    console.error('Save error:', err);
    showToast('Save failed. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Check-in';
  }
}

// ── Clear Entry Form ───────────────────────────────────────────────────────
function clearEntryForm() {
  CicoState.entry.studentId   = null;
  CicoState.entry.studentName = '';

  document.getElementById('student-search-input').value = '';
  document.getElementById('selected-student-id').value  = '';
  document.getElementById('entry-date').value  = todayISO();
  document.getElementById('entry-notes').value = '';
  CicoState.entry.date = todayISO();

  updateEntryGrid();
}

// ── Utility ────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
