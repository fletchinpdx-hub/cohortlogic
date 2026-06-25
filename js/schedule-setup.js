// ── Step 1: School Info ───────────────────────────────────────────────────────
const ALL_GRADES = ['TK','K','1','2','3','4','5','6','7','8','9','10','11','12'];
const WEEK_DAYS  = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

function gradeChipLabel(g) {
  if (g === 'TK') return 'TK';
  if (g === 'K')  return 'K';
  return g + ({ '1': 'st', '2': 'nd', '3': 'rd' }[g] || 'th');
}

function timeToMins(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function timeSlots15(start, end) {
  const slots = [];
  let cur = timeToMins(start);
  const fin = timeToMins(end);
  while (cur <= fin) {
    slots.push(String(Math.floor(cur / 60)).padStart(2, '0') + ':' + String(cur % 60).padStart(2, '0'));
    cur += 15;
  }
  return slots;
}

function renderSchoolInfo() {
  const s = SchedState.school;

  document.getElementById('view-school').innerHTML = `
    <div class="view-header">
      <h1>School Information</h1>
      <p class="view-subtitle">Tell us about your school. This sets the foundation for every schedule you build.</p>
    </div>

    <div class="setup-form">

      <!-- School Details -->
      <div class="form-section">
        <h2 class="form-section-title">School Details</h2>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">School Name</label>
            <input type="text" class="input" id="school-name" placeholder="e.g. Lincoln Elementary" value="${s.name}" />
          </div>
          <div class="form-group form-group-sm">
            <label class="form-label">School Year</label>
            <input type="text" class="input" id="school-year" placeholder="e.g. 2026-2027" value="${s.year}" />
          </div>
        </div>
      </div>

      <!-- Grade Levels -->
      <div class="form-section">
        <h2 class="form-section-title">Grade Levels</h2>
        <p class="form-hint">Select all grade levels in your building.</p>
        <div class="grade-chips" id="school-grade-chips">
          ${ALL_GRADES.map(g => `<button type="button" class="grade-chip ${s.grades.includes(g) ? 'active' : ''}" data-grade="${g}">${gradeChipLabel(g)}</button>`).join('')}
        </div>
      </div>

      <!-- School Day Hours -->
      <div class="form-section">
        <h2 class="form-section-title">School Day Hours</h2>
        <p class="form-hint">Define each time boundary. These drive the framework grid below.</p>
        <div class="time-bounds-grid">

          <div class="time-bound-row">
            <span class="time-bound-label">Teacher Contract</span>
            <div class="time-bound-inputs">
              <div class="form-group form-group-sm">
                <label class="form-label">Start</label>
                <input type="time" class="input" id="teacher-contract-start" value="${s.teacherContractStart || '07:30'}" />
              </div>
              <div class="form-group form-group-sm">
                <label class="form-label">End</label>
                <input type="time" class="input" id="teacher-contract-end" value="${s.teacherContractEnd || '15:00'}" />
              </div>
            </div>
          </div>

          <div class="time-bound-row">
            <span class="time-bound-label">Student Campus Hours <span class="form-hint-sm">(non-teacher supervision at start &amp; end)</span></span>
            <div class="time-bound-inputs">
              <div class="form-group form-group-sm">
                <label class="form-label">Start</label>
                <input type="time" class="input" id="student-campus-start" value="${s.studentCampusStart || '07:45'}" />
              </div>
              <div class="form-group form-group-sm">
                <label class="form-label">End</label>
                <input type="time" class="input" id="student-campus-end" value="${s.studentCampusEnd || '15:15'}" />
              </div>
            </div>
          </div>

          <div class="time-bound-row">
            <span class="time-bound-label">First Bell &amp; Dismissal <span class="form-hint-sm">(teacher instructional day)</span></span>
            <div class="time-bound-inputs">
              <div class="form-group form-group-sm">
                <label class="form-label">First Bell</label>
                <input type="time" class="input" id="first-bell" value="${s.firstBell || '08:00'}" />
              </div>
              <div class="form-group form-group-sm">
                <label class="form-label">Dismissal</label>
                <input type="time" class="input" id="dismissal" value="${s.dismissal || '14:30'}" />
              </div>
            </div>
          </div>

        </div>

        <div style="margin-top:16px;display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="mm-enabled" ${s.morningMeetingEnabled ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;flex-shrink:0" />
          <label for="mm-enabled" style="font-size:14px;font-weight:500;cursor:pointer;margin:0">Standard morning meeting</label>
        </div>
        <div id="mm-times" style="display:${s.morningMeetingEnabled ? 'flex' : 'none'};gap:16px;margin-top:12px;flex-wrap:wrap;align-items:flex-end">
          <div class="form-group form-group-sm" style="margin:0">
            <label class="form-label">Start</label>
            <input type="time" class="input" id="mm-start" value="${s.morningMeetingStart || ''}" />
          </div>
          <div class="form-group form-group-sm" style="margin:0">
            <label class="form-label">End</label>
            <input type="time" class="input" id="mm-end" value="${s.morningMeetingEnd || ''}" />
          </div>
        </div>
      </div>

      <!-- Lunch Periods -->
      <div class="form-section">
        <h2 class="form-section-title">Lunch Periods</h2>
        <p class="form-hint">Define each lunch wave. Multiple grades can share one period.</p>
        <div id="lunch-list">${s.lunchPeriods.map(renderLunchRow).join('')}</div>
        <button class="btn btn-outline btn-sm" id="add-lunch-btn" style="margin-top:8px">+ Add Lunch Period</button>
      </div>

      <!-- Recess Slots -->
      <div class="form-section">
        <h2 class="form-section-title">Recess</h2>
        <p class="form-hint">Define each recess. One grade can appear in multiple slots (morning + afternoon), and grades can share a slot.</p>
        <div id="recess-list">${s.recessSlots.map(renderRecessRow).join('')}</div>
        <button class="btn btn-outline btn-sm" id="add-recess-btn" style="margin-top:8px">+ Add Recess</button>
      </div>

      <!-- Alternate Schedule Days -->
      <div class="form-section">
        <h2 class="form-section-title">Alternate Schedule Days</h2>
        <p class="form-hint">Days that run on a different schedule — late start, early release, or both.</p>
        <div id="alt-days-list">
          ${(s.altDays || []).map(renderAltDayRow).join('')}
        </div>
        <div class="add-alt-day-row" style="margin-top:12px">
          <select class="input input-sm" id="alt-day-select">
            <option value="">Select a day…</option>
            ${WEEK_DAYS.filter(d => !(s.altDays || []).some(ad => ad.day === d))
              .map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
          <button class="btn btn-outline btn-sm" id="add-alt-day-btn">+ Add</button>
        </div>
      </div>

    </div>

    <!-- Framework Preview -->
    <div class="form-section" style="border-top:2px solid var(--indigo,#6366f1);margin-top:0">
      <h2 class="form-section-title" style="color:var(--indigo,#6366f1)">Schedule Framework</h2>
      <p class="form-hint">Based on your saved settings. Fixed blocks shown by grade — open (white) time is available for the master schedule.</p>
      <div id="framework-grid"></div>
    </div>

    <div class="view-actions">
      <button class="btn btn-primary" id="school-next-btn">Save & Continue to Staff</button>
      <div class="save-status" id="school-save-status"></div>
    </div>
  `;

  // School-level grade chips
  document.querySelectorAll('#school-grade-chips .grade-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  // Morning meeting toggle
  document.getElementById('mm-enabled').addEventListener('change', e => {
    document.getElementById('mm-times').style.display = e.target.checked ? 'flex' : 'none';
  });

  // Lunch add
  document.getElementById('add-lunch-btn').addEventListener('click', () => {
    SchedState.school.lunchPeriods.push({ id: uid(), start: '11:00', duration: 30, grades: [] });
    refreshLunchList();
  });

  // Recess add
  document.getElementById('add-recess-btn').addEventListener('click', () => {
    SchedState.school.recessSlots.push({ id: uid(), name: '', start: '10:00', duration: 15, grades: [] });
    refreshRecessList();
  });

  // Alt day add
  document.getElementById('add-alt-day-btn').addEventListener('click', () => {
    const sel = document.getElementById('alt-day-select');
    const day = sel.value;
    if (!day) return;
    SchedState.school.altDays = SchedState.school.altDays || [];
    SchedState.school.altDays.push({ day, lateStart: '', earlyRelease: '', altLunchRecess: false });
    const ad = SchedState.school.altDays.find(a => a.day === day);
    document.getElementById('alt-days-list').insertAdjacentHTML('beforeend', renderAltDayRow(ad));
    sel.querySelector(`option[value="${day}"]`)?.remove();
    sel.value = '';
    wireAltDayRemove();
  });

  wireAltDayRemove();
  wireLunchRecessEvents();
  renderFrameworkGrid();

  document.getElementById('school-next-btn').addEventListener('click', saveSchoolAndContinue);
}

function renderLunchRow(lp) {
  return `
    <div class="period-row" data-id="${lp.id}">
      <div class="period-row-main">
        <input type="time" class="input input-sm period-start" value="${lp.start}" data-id="${lp.id}" />
        <span class="period-sep">for</span>
        <input type="number" class="input input-sm period-dur" style="width:64px" min="5" max="120" step="5" value="${lp.duration}" data-id="${lp.id}" />
        <span class="period-sep">min</span>
        <button class="remove-period-btn btn-icon" data-id="${lp.id}" data-ptype="lunch">×</button>
      </div>
      <div class="period-grades">
        <span class="period-grades-label">Grades:</span>
        ${ALL_GRADES.map(g => `<button type="button" class="grade-chip grade-chip-xs ${lp.grades.includes(g) ? 'active' : ''}" data-id="${lp.id}" data-grade="${g}" data-ptype="lunch">${gradeChipLabel(g)}</button>`).join('')}
      </div>
    </div>
  `;
}

function renderRecessRow(rs) {
  return `
    <div class="period-row" data-id="${rs.id}">
      <div class="period-row-main">
        <input type="text" class="input input-sm period-name" placeholder="e.g. Morning Recess" style="width:160px" value="${rs.name || ''}" data-id="${rs.id}" />
        <input type="time" class="input input-sm period-start" value="${rs.start}" data-id="${rs.id}" />
        <span class="period-sep">for</span>
        <input type="number" class="input input-sm period-dur" style="width:64px" min="5" max="60" step="5" value="${rs.duration}" data-id="${rs.id}" />
        <span class="period-sep">min</span>
        <button class="remove-period-btn btn-icon" data-id="${rs.id}" data-ptype="recess">×</button>
      </div>
      <div class="period-grades">
        <span class="period-grades-label">Grades:</span>
        ${ALL_GRADES.map(g => `<button type="button" class="grade-chip grade-chip-xs ${rs.grades.includes(g) ? 'active' : ''}" data-id="${rs.id}" data-grade="${g}" data-ptype="recess">${gradeChipLabel(g)}</button>`).join('')}
      </div>
    </div>
  `;
}

function refreshLunchList() {
  document.getElementById('lunch-list').innerHTML = SchedState.school.lunchPeriods.map(renderLunchRow).join('');
  wireLunchRecessEvents();
}

function refreshRecessList() {
  document.getElementById('recess-list').innerHTML = SchedState.school.recessSlots.map(renderRecessRow).join('');
  wireLunchRecessEvents();
}

function wireLunchRecessEvents() {
  document.querySelectorAll('.grade-chip-xs').forEach(chip => {
    chip.addEventListener('click', () => {
      const { id, grade, ptype } = chip.dataset;
      const list = ptype === 'lunch' ? SchedState.school.lunchPeriods : SchedState.school.recessSlots;
      const item = list.find(x => x.id === id);
      if (!item) return;
      if (item.grades.includes(grade)) {
        item.grades = item.grades.filter(g => g !== grade);
        chip.classList.remove('active');
      } else {
        item.grades.push(grade);
        chip.classList.add('active');
      }
    });
  });

  document.querySelectorAll('.period-start').forEach(inp => {
    inp.addEventListener('change', () => {
      const item = [...SchedState.school.lunchPeriods, ...SchedState.school.recessSlots].find(x => x.id === inp.dataset.id);
      if (item) item.start = inp.value;
    });
  });

  document.querySelectorAll('.period-dur').forEach(inp => {
    inp.addEventListener('change', () => {
      const item = [...SchedState.school.lunchPeriods, ...SchedState.school.recessSlots].find(x => x.id === inp.dataset.id);
      if (item) item.duration = parseInt(inp.value, 10);
    });
  });

  document.querySelectorAll('.period-name').forEach(inp => {
    inp.addEventListener('change', () => {
      const item = SchedState.school.recessSlots.find(x => x.id === inp.dataset.id);
      if (item) item.name = inp.value;
    });
  });

  document.querySelectorAll('.remove-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { id, ptype } = btn.dataset;
      if (ptype === 'lunch') {
        SchedState.school.lunchPeriods = SchedState.school.lunchPeriods.filter(x => x.id !== id);
        refreshLunchList();
      } else {
        SchedState.school.recessSlots = SchedState.school.recessSlots.filter(x => x.id !== id);
        refreshRecessList();
      }
    });
  });
}

function renderAltDayRow(ad) {
  return `
    <div class="alt-day-row" data-day="${ad.day}">
      <span class="alt-day-label">${ad.day}</span>
      <div class="alt-day-fields">
        <label class="alt-day-option">
          <input type="checkbox" class="alt-late-start-cb" ${ad.lateStart ? 'checked' : ''} />
          Late start
        </label>
        <input type="time" class="input input-sm alt-late-start-time" value="${ad.lateStart || ''}" style="opacity:${ad.lateStart ? '1' : '.35'}" />
        <label class="alt-day-option">
          <input type="checkbox" class="alt-early-release-cb" ${ad.earlyRelease ? 'checked' : ''} />
          Early release
        </label>
        <input type="time" class="input input-sm alt-early-release-time" value="${ad.earlyRelease || ''}" style="opacity:${ad.earlyRelease ? '1' : '.35'}" />
        <label class="alt-day-option" style="font-size:12px;color:var(--gray-500)">
          <input type="checkbox" class="alt-lunch-recess-cb" ${ad.altLunchRecess ? 'checked' : ''} />
          Lunch/recess differ
        </label>
      </div>
      <button class="remove-alt-day btn-icon" data-day="${ad.day}" style="color:#ef4444">×</button>
    </div>
  `;
}

function wireAltDayRemove() {
  document.querySelectorAll('.remove-alt-day').forEach(btn => {
    btn.addEventListener('click', () => {
      const day = btn.dataset.day;
      btn.closest('.alt-day-row').remove();
      SchedState.school.altDays = (SchedState.school.altDays || []).filter(ad => ad.day !== day);
      const sel = document.getElementById('alt-day-select');
      if (sel) {
        const opt = document.createElement('option');
        opt.value = day; opt.textContent = day;
        sel.appendChild(opt);
      }
    });
  });

  document.querySelectorAll('.alt-late-start-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const inp = cb.closest('.alt-day-fields').querySelector('.alt-late-start-time');
      inp.style.opacity = cb.checked ? '1' : '.35';
      if (!cb.checked) inp.value = '';
    });
  });

  document.querySelectorAll('.alt-early-release-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const inp = cb.closest('.alt-day-fields').querySelector('.alt-early-release-time');
      inp.style.opacity = cb.checked ? '1' : '.35';
      if (!cb.checked) inp.value = '';
    });
  });
}

function renderFrameworkGrid() {
  const el = document.getElementById('framework-grid');
  if (!el) return;
  const s = SchedState.school;
  const grades = gradesSorted();

  if (!grades.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--gray-400)">Select grade levels and save to see the framework.</p>';
    return;
  }

  const campStart  = s.studentCampusStart || '07:45';
  const campEnd    = s.studentCampusEnd   || '15:15';
  const fbMins     = timeToMins(s.firstBell || '08:00');
  const disMins    = timeToMins(s.dismissal  || '14:30');
  const mmOn       = s.morningMeetingEnabled && s.morningMeetingStart && s.morningMeetingEnd;
  const mmS        = mmOn ? timeToMins(s.morningMeetingStart) : null;
  const mmE        = mmOn ? timeToMins(s.morningMeetingEnd)   : null;

  function block(grade, mins) {
    if (mins < fbMins)   return { label: 'Before School',   bg: '#f1f5f9', tc: '#94a3b8' };
    if (mins >= disMins) return { label: 'After School',    bg: '#f1f5f9', tc: '#94a3b8' };
    if (mmS !== null && mins >= mmS && mins < mmE) return { label: 'Morning Meeting', bg: '#ede9fe', tc: '#5b21b6' };
    const lp = s.lunchPeriods.find(x => x.grades.includes(grade) && mins >= timeToMins(x.start) && mins < timeToMins(x.start) + x.duration);
    if (lp) return { label: 'Lunch',  bg: '#d1fae5', tc: '#065f46' };
    const rs = s.recessSlots.find(x => x.grades.includes(grade) && mins >= timeToMins(x.start) && mins < timeToMins(x.start) + x.duration);
    if (rs) return { label: rs.name || 'Recess', bg: '#cffafe', tc: '#164e63' };
    return null;
  }

  const slots = timeSlots15(campStart, campEnd);
  const prev  = {};

  const rows = slots.map(slot => {
    const mins   = timeToMins(slot);
    const isHour = slot.endsWith(':00');
    const cells  = grades.map(g => {
      const blk  = block(g, mins);
      const key  = blk ? blk.label : '';
      const show = key && key !== (prev[g] || '');
      prev[g] = key;
      return `<td class="fw-td" style="${blk ? `background:${blk.bg}` : ''}">${show ? `<span class="fw-label" style="color:${blk.tc}">${blk.label}</span>` : ''}</td>`;
    }).join('');
    return `<tr class="${isHour ? 'fw-row-hour' : 'fw-row'}"><td class="fw-time">${isHour ? slot : ''}</td>${cells}</tr>`;
  }).join('');

  el.innerHTML = `
    <div class="fw-scroll">
      <table class="fw-table">
        <thead><tr>
          <th class="fw-th-time"></th>
          ${grades.map(g => `<th class="fw-th">${g === 'TK' || g === 'K' ? g : 'Gr ' + g}</th>`).join('')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function saveSchoolAndContinue() {
  const name = document.getElementById('school-name').value.trim();
  if (!name) { showFormError('school-save-status', 'Please enter a school name.'); return; }

  const s = SchedState.school;
  s.name  = name;
  s.year  = document.getElementById('school-year').value.trim() || '2026-2027';
  s.grades = [...document.querySelectorAll('#school-grade-chips .grade-chip.active')].map(c => c.dataset.grade);

  s.teacherContractStart = document.getElementById('teacher-contract-start').value;
  s.teacherContractEnd   = document.getElementById('teacher-contract-end').value;
  s.studentCampusStart   = document.getElementById('student-campus-start').value;
  s.studentCampusEnd     = document.getElementById('student-campus-end').value;
  s.firstBell            = document.getElementById('first-bell').value;
  s.dismissal            = document.getElementById('dismissal').value;
  s.dayStart = s.firstBell;
  s.dayEnd   = s.dismissal;

  s.morningMeetingEnabled = document.getElementById('mm-enabled').checked;
  s.morningMeetingStart   = s.morningMeetingEnabled ? document.getElementById('mm-start').value : '';
  s.morningMeetingEnd     = s.morningMeetingEnabled ? document.getElementById('mm-end').value   : '';

  s.altDays = [];
  document.querySelectorAll('.alt-day-row').forEach(row => {
    const lsCb = row.querySelector('.alt-late-start-cb');
    const erCb = row.querySelector('.alt-early-release-cb');
    const lrCb = row.querySelector('.alt-lunch-recess-cb');
    s.altDays.push({
      day:           row.dataset.day,
      lateStart:     lsCb?.checked ? row.querySelector('.alt-late-start-time').value    : '',
      earlyRelease:  erCb?.checked ? row.querySelector('.alt-early-release-time').value : '',
      altLunchRecess: lrCb?.checked || false,
    });
  });
  s.earlyReleaseDays = s.altDays.filter(a => a.earlyRelease).map(a => a.day);
  s.earlyReleaseEnd  = s.altDays.find(a => a.earlyRelease)?.earlyRelease || '';

  saveToLocal();
  showSaveStatus('school-save-status', 'Saving…');
  const result = await saveToSupabase();
  if (result.ok) {
    showSaveStatus('school-save-status', `Saved ✓  Schedule code: ${result.id}`);
  } else {
    showSaveStatus('school-save-status', 'Saved locally (Supabase unavailable)');
  }

  renderFrameworkGrid();
  updateSidebarStatus();
  setTimeout(() => { navigateTo('staff'); renderStaff(); }, 800);
}


// ── Step 2: Staff Roster ─────────────────────────────────────────────────────
function renderStaff() {
  document.getElementById('view-staff').innerHTML = `
    <div class="view-header">
      <h1>Staff Roster</h1>
      <p class="view-subtitle">Add everyone who will appear on the schedule — teachers, IAs, specialists, and support staff.</p>
    </div>

    <div class="staff-toolbar">
      <button class="btn btn-primary" id="add-staff-btn">+ Add Staff Member</button>
      <span class="text-muted" id="staff-count-label">${SchedState.staff.length} added</span>
    </div>

    <div id="add-staff-form" class="inline-form hidden"></div>

    <div id="staff-table-wrap">
      ${renderStaffTable()}
    </div>

    <div class="view-actions">
      <button class="btn btn-outline" id="staff-back-btn">← Back</button>
      <button class="btn btn-primary" id="staff-next-btn">Save & Continue to Block Types</button>
      <div class="save-status" id="staff-save-status"></div>
    </div>
  `;

  document.getElementById('add-staff-btn').addEventListener('click', () => showAddStaffForm());
  document.getElementById('staff-back-btn').addEventListener('click', () => { navigateTo('school'); renderSchoolInfo(); });
  document.getElementById('staff-next-btn').addEventListener('click', saveStaffAndContinue);
  wireStaffTable();
}

function renderStaffTable() {
  if (SchedState.staff.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">👤</div><p>No staff added yet. Click "+ Add Staff Member" to get started.</p></div>`;
  }

  const rows = SchedState.staff.map(s => `
    <tr data-id="${s.id}">
      <td><span class="color-swatch" style="background:${s.color}"></span></td>
      <td class="staff-name">${s.name}</td>
      <td>${ROLE_LABELS[s.role] || s.role}</td>
      <td>${s.gradeAssignment ? (GRADE_LABELS[s.gradeAssignment] || s.gradeAssignment) : '—'}</td>
      <td class="staff-actions">
        <button class="btn btn-sm btn-outline edit-staff-btn" data-id="${s.id}">Edit</button>
        <button class="btn btn-sm btn-danger remove-staff-btn" data-id="${s.id}">Remove</button>
      </td>
    </tr>
  `).join('');

  return `
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:32px"></th>
          <th>Name</th>
          <th>Role</th>
          <th>Grade Assignment</th>
          <th style="width:160px"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function showAddStaffForm(existingId) {
  const existing = existingId ? SchedState.staff.find(s => s.id === existingId) : null;
  const gradeOptions = SchedState.school.grades.length
    ? `<option value="">Building-wide</option>` + gradesSorted().map(g => `<option value="${g}" ${existing?.gradeAssignment === g ? 'selected' : ''}>${GRADE_LABELS[g] || g}</option>`).join('')
    : `<option value="">Building-wide</option>`;

  const form = document.getElementById('add-staff-form');
  form.classList.remove('hidden');
  form.innerHTML = `
    <div class="inline-form-grid">
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input type="text" class="input" id="sf-name" placeholder="e.g. Jordan Rivera" value="${existing?.name || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="input" id="sf-role">
          ${Object.entries(ROLE_LABELS).map(([val, label]) =>
            `<option value="${val}" ${(existing?.role || 'classroom_teacher') === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Grade Assignment</label>
        <select class="input" id="sf-grade">${gradeOptions}</select>
      </div>
      <div class="form-group form-group-color">
        <label class="form-label">Color</label>
        <div class="color-palette" id="sf-color-palette">
          ${STAFF_COLOR_PALETTE.map(c => `
            <button type="button" class="color-dot ${(existing?.color || nextStaffColor()) === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="inline-form-actions">
      <button class="btn btn-primary" id="sf-save-btn">${existing ? 'Update' : 'Add'} Staff Member</button>
      <button class="btn btn-outline" id="sf-cancel-btn">Cancel</button>
    </div>
  `;

  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
  });

  document.getElementById('sf-cancel-btn').addEventListener('click', () => {
    form.classList.add('hidden');
    form.innerHTML = '';
  });

  document.getElementById('sf-save-btn').addEventListener('click', () => {
    const name = document.getElementById('sf-name').value.trim();
    if (!name) { document.getElementById('sf-name').focus(); return; }

    const member = {
      id:              existing?.id || uid(),
      name,
      role:            document.getElementById('sf-role').value,
      gradeAssignment: document.getElementById('sf-grade').value,
      color:           document.querySelector('.color-dot.selected')?.dataset.color || nextStaffColor(),
    };

    if (existing) {
      const idx = SchedState.staff.findIndex(s => s.id === existingId);
      SchedState.staff[idx] = member;
    } else {
      SchedState.staff.push(member);
    }

    form.classList.add('hidden');
    form.innerHTML = '';
    document.getElementById('staff-table-wrap').innerHTML = renderStaffTable();
    document.getElementById('staff-count-label').textContent = `${SchedState.staff.length} added`;
    wireStaffTable();
    saveToLocal();
  });
}

function wireStaffTable() {
  document.querySelectorAll('.remove-staff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SchedState.staff = SchedState.staff.filter(s => s.id !== btn.dataset.id);
      document.getElementById('staff-table-wrap').innerHTML = renderStaffTable();
      document.getElementById('staff-count-label').textContent = `${SchedState.staff.length} added`;
      wireStaffTable();
      saveToLocal();
    });
  });
  document.querySelectorAll('.edit-staff-btn').forEach(btn => {
    btn.addEventListener('click', () => showAddStaffForm(btn.dataset.id));
  });
}

async function saveStaffAndContinue() {
  saveToLocal();
  showSaveStatus('staff-save-status', 'Saving…');
  const result = await saveToSupabase();
  showSaveStatus('staff-save-status', result.ok ? 'Saved ✓' : 'Saved locally');
  updateSidebarStatus();
  setTimeout(() => { navigateTo('blocks'); renderBlocks(); }, 600);
}

// ── Step 3: Block Types ───────────────────────────────────────────────────────
function renderBlocks() {
  const categorized = {};
  SchedState.blockTypes.forEach(bt => {
    if (!categorized[bt.category]) categorized[bt.category] = [];
    categorized[bt.category].push(bt);
  });

  const categoryOrder = ['instruction','specials','intervention','behavior','transition','admin'];

  document.getElementById('view-blocks').innerHTML = `
    <div class="view-header">
      <h1>Block Types</h1>
      <p class="view-subtitle">These are the activity blocks you'll place on the schedule. We've pre-loaded common types — add, edit, or remove as needed.</p>
    </div>

    <div class="blocks-toolbar">
      <button class="btn btn-primary" id="add-block-btn">+ Add Block Type</button>
    </div>

    <div id="add-block-form" class="inline-form hidden"></div>

    <div id="blocks-list">
      ${categoryOrder.map(cat => {
        const blocks = categorized[cat];
        if (!blocks?.length) return '';
        return `
          <div class="block-category-section">
            <h3 class="block-category-label">${BLOCK_CATEGORIES[cat] || cat}</h3>
            <div class="block-chips-grid">
              ${blocks.map(bt => `
                <div class="block-chip-card" data-id="${bt.id}">
                  <span class="block-chip-dot" style="background:${bt.color}"></span>
                  <span class="block-chip-name">${bt.name}</span>
                  ${bt.defaultDuration ? `<span class="block-chip-duration">${bt.defaultDuration} min</span>` : ''}
                  <div class="block-chip-actions">
                    <button class="icon-btn edit-block-btn" data-id="${bt.id}" title="Edit">✏️</button>
                    <button class="icon-btn remove-block-btn" data-id="${bt.id}" title="Remove">×</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }).join('')}
    </div>

    <div class="view-actions">
      <button class="btn btn-outline" id="blocks-back-btn">← Back</button>
      <button class="btn btn-primary" id="blocks-next-btn">Save Setup & Build Master Schedule →</button>
      <div class="save-status" id="blocks-save-status"></div>
    </div>
  `;

  document.getElementById('add-block-btn').addEventListener('click', () => showAddBlockForm());
  document.getElementById('blocks-back-btn').addEventListener('click', () => { navigateTo('staff'); renderStaff(); });
  document.getElementById('blocks-next-btn').addEventListener('click', saveBlocksAndContinue);
  wireBlocksList();
}

function showAddBlockForm(existingId) {
  const existing = existingId ? SchedState.blockTypes.find(b => b.id === existingId) : null;
  const form = document.getElementById('add-block-form');
  form.classList.remove('hidden');
  form.innerHTML = `
    <div class="inline-form-grid">
      <div class="form-group">
        <label class="form-label">Block Name</label>
        <input type="text" class="input" id="bf-name" placeholder="e.g. Writing Workshop" value="${existing?.name || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select class="input" id="bf-category">
          ${Object.entries(BLOCK_CATEGORIES).map(([val, label]) =>
            `<option value="${val}" ${(existing?.category || 'instruction') === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group form-group-sm">
        <label class="form-label">Default Duration</label>
        <div class="duration-input-row">
          <input type="number" class="input" id="bf-duration" min="5" max="180" step="5"
            placeholder="—" value="${existing?.defaultDuration || ''}" style="width:70px" />
          <span class="duration-unit">min</span>
        </div>
        <div class="form-hint-sm">Auto-fills this many minutes on single click. Leave blank for manual.</div>
      </div>
      <div class="form-group form-group-color">
        <label class="form-label">Color</label>
        <div class="color-palette" id="bf-color-palette">
          ${STAFF_COLOR_PALETTE.map(c => `
            <button type="button" class="color-dot ${(existing?.color || '#3b82f6') === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="inline-form-actions">
      <button class="btn btn-primary" id="bf-save-btn">${existing ? 'Update' : 'Add'} Block Type</button>
      <button class="btn btn-outline" id="bf-cancel-btn">Cancel</button>
    </div>
  `;

  document.querySelectorAll('#bf-color-palette .color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('#bf-color-palette .color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
    });
  });

  document.getElementById('bf-cancel-btn').addEventListener('click', () => {
    form.classList.add('hidden');
    form.innerHTML = '';
  });

  document.getElementById('bf-save-btn').addEventListener('click', () => {
    const name = document.getElementById('bf-name').value.trim();
    if (!name) { document.getElementById('bf-name').focus(); return; }
    const durVal = parseInt(document.getElementById('bf-duration').value, 10);
    const block = {
      id:              existing?.id || uid(),
      name,
      category:        document.getElementById('bf-category').value,
      color:           document.querySelector('#bf-color-palette .color-dot.selected')?.dataset.color || '#3b82f6',
      defaultDuration: (!isNaN(durVal) && durVal >= 5) ? durVal : null,
    };
    if (existing) {
      const idx = SchedState.blockTypes.findIndex(b => b.id === existingId);
      SchedState.blockTypes[idx] = block;
    } else {
      SchedState.blockTypes.push(block);
    }
    form.classList.add('hidden');
    form.innerHTML = '';
    saveToLocal();
    renderBlocks();
  });
}

function wireBlocksList() {
  document.querySelectorAll('.remove-block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SchedState.blockTypes = SchedState.blockTypes.filter(b => b.id !== btn.dataset.id);
      saveToLocal();
      renderBlocks();
    });
  });
  document.querySelectorAll('.edit-block-btn').forEach(btn => {
    btn.addEventListener('click', () => showAddBlockForm(btn.dataset.id));
  });
}

async function saveBlocksAndContinue() {
  saveToLocal();
  showSaveStatus('blocks-save-status', 'Saving…');
  const result = await saveToSupabase();
  showSaveStatus('blocks-save-status', result.ok ? 'Saved ✓' : 'Saved locally');
  updateSidebarStatus();
  setTimeout(() => { navigateTo('master'); renderMasterSchedule(); }, 600);
}

// ── Step 4: Review & Save ────────────────────────────────────────────────────
function renderReview() {
  const s = SchedState.school;
  const gradeList = gradesSorted().map(g => GRADE_LABELS[g] || g).join(', ') || '—';
  const altDays = s.earlyReleaseDays.length
    ? s.earlyReleaseDays.map(d => `${d} (ends ${s.earlyReleaseEnd})`).join(', ')
    : 'None';

  const staffByRole = {};
  SchedState.staff.forEach(st => {
    const label = ROLE_LABELS[st.role] || st.role;
    if (!staffByRole[label]) staffByRole[label] = [];
    staffByRole[label].push(st);
  });

  const blocksByCategory = {};
  SchedState.blockTypes.forEach(bt => {
    const label = BLOCK_CATEGORIES[bt.category] || bt.category;
    if (!blocksByCategory[label]) blocksByCategory[label] = [];
    blocksByCategory[label].push(bt);
  });

  const schedId = SchedState.scheduleId;

  document.getElementById('view-review').innerHTML = `
    <div class="view-header">
      <h1>Review & Save</h1>
      <p class="view-subtitle">Confirm your setup before building the schedule grid. You can always come back to edit.</p>
    </div>

    <div class="review-grid">

      <div class="review-card">
        <div class="review-card-header">
          <span class="review-card-icon">🏫</span>
          <h3>School Info</h3>
          <button class="btn btn-sm btn-outline review-edit-btn" data-view="school">Edit</button>
        </div>
        <div class="review-card-body">
          <div class="review-row"><span class="review-label">School</span><span class="review-value">${s.name || '—'}</span></div>
          <div class="review-row"><span class="review-label">Year</span><span class="review-value">${s.year}</span></div>
          <div class="review-row"><span class="review-label">Grades</span><span class="review-value">${gradeList}</span></div>
          <div class="review-row"><span class="review-label">School Day</span><span class="review-value">${s.dayStart} – ${s.dayEnd}</span></div>
          <div class="review-row"><span class="review-label">Alternate Days</span><span class="review-value">${altDays}</span></div>
        </div>
      </div>

      <div class="review-card">
        <div class="review-card-header">
          <span class="review-card-icon">👥</span>
          <h3>Staff (${SchedState.staff.length})</h3>
          <button class="btn btn-sm btn-outline review-edit-btn" data-view="staff">Edit</button>
        </div>
        <div class="review-card-body">
          ${Object.keys(staffByRole).length === 0
            ? '<p class="text-muted">No staff added yet.</p>'
            : Object.entries(staffByRole).map(([role, members]) => `
                <div class="review-row review-row-stack">
                  <span class="review-label">${role}</span>
                  <div class="review-staff-chips">
                    ${members.map(m => `<span class="review-staff-chip" style="border-left: 3px solid ${m.color}">${m.name}</span>`).join('')}
                  </div>
                </div>
              `).join('')
          }
        </div>
      </div>

      <div class="review-card review-card-full">
        <div class="review-card-header">
          <span class="review-card-icon">🟦</span>
          <h3>Block Types (${SchedState.blockTypes.length})</h3>
          <button class="btn btn-sm btn-outline review-edit-btn" data-view="blocks">Edit</button>
        </div>
        <div class="review-card-body">
          ${Object.entries(blocksByCategory).map(([cat, blocks]) => `
            <div class="review-row review-row-stack">
              <span class="review-label">${cat}</span>
              <div class="review-block-chips">
                ${blocks.map(b => `<span class="review-block-chip" style="background:${b.color}20;border:1px solid ${b.color};color:${b.color}">${b.name}</span>`).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

    </div>

    ${schedId ? `
      <div class="schedule-code-banner">
        <span class="schedule-code-label">Your schedule code</span>
        <span class="schedule-code-value" id="schedule-code-display">${schedId}</span>
        <button class="btn btn-sm btn-outline" id="copy-code-btn">Copy</button>
        <span class="code-hint">Share this code with colleagues so they can load this schedule.</span>
      </div>
    ` : ''}

    <div class="view-actions">
      <button class="btn btn-outline" id="review-back-btn">← Back</button>
      <button class="btn btn-primary btn-lg" id="review-save-btn">Save Setup</button>
      <div class="save-status" id="review-save-status"></div>
    </div>

    <div id="save-complete-banner" class="save-complete-banner hidden">
      <div class="save-complete-icon">✅</div>
      <div class="save-complete-text">
        <strong>Setup saved!</strong>
        <p>The visual schedule grid builder is the next step — it will be added to this tool shortly.</p>
        ${schedId ? `<p>Your schedule code: <strong>${schedId}</strong> — bookmark this page or save the code to return later.</p>` : ''}
      </div>
    </div>
  `;

  document.querySelectorAll('.review-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      navigateTo(view);
      if (view === 'school') renderSchoolInfo();
      if (view === 'staff')  renderStaff();
      if (view === 'blocks') renderBlocks();
    });
  });

  document.getElementById('review-back-btn').addEventListener('click', () => { navigateTo('blocks'); renderBlocks(); });
  document.getElementById('review-save-btn').addEventListener('click', finalSave);

  const copyBtn = document.getElementById('copy-code-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(SchedState.scheduleId).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    });
  }
}

async function finalSave() {
  showSaveStatus('review-save-status', 'Saving…');
  saveToLocal();
  const result = await saveToSupabase();
  if (result.ok) {
    showSaveStatus('review-save-status', `Saved ✓  Code: ${result.id}`);
    // Update the code display if it's a new ID
    const display = document.getElementById('schedule-code-display');
    if (display) display.textContent = result.id;
  } else {
    showSaveStatus('review-save-status', 'Saved locally (Supabase unavailable)');
  }
  updateSidebarStatus();
  document.getElementById('save-complete-banner').classList.remove('hidden');
  document.getElementById('review-save-btn').textContent = 'Saved ✓';
  document.getElementById('review-save-btn').disabled = true;

  if (typeof trackEvent === 'function') {
    trackEvent('schedule_setup_complete', { school: SchedState.school.name, staffCount: SchedState.staff.length });
  }
  // Re-render review to pick up the code banner if first save
  if (result.ok && !document.getElementById('schedule-code-display')) {
    setTimeout(() => renderReview(), 800);
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────
function showSaveStatus(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

function showFormError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.color = '#ef4444';
  el.style.opacity = '1';
}
