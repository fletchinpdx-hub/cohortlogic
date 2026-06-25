// ── Step 1: School Info ───────────────────────────────────────────────────────
function renderSchoolInfo() {
  const GRADES = ['TK','K','1','2','3','4','5','6','7','8'];
  const DAYS   = ['Monday','Tuesday','Wednesday','Thursday','Friday'];

  document.getElementById('view-school').innerHTML = `
    <div class="view-header">
      <h1>School Information</h1>
      <p class="view-subtitle">Tell us about your school. This sets the foundation for every schedule you build.</p>
    </div>

    <div class="setup-form">

      <div class="form-section">
        <h2 class="form-section-title">School Details</h2>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">School Name</label>
            <input type="text" class="input" id="school-name" placeholder="e.g. Lincoln Elementary" value="${SchedState.school.name}" />
          </div>
          <div class="form-group form-group-sm">
            <label class="form-label">School Year</label>
            <input type="text" class="input" id="school-year" placeholder="e.g. 2026-2027" value="${SchedState.school.year}" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Grade Levels</h2>
        <p class="form-hint">Select all grade levels in your building.</p>
        <div class="grade-chips">
          ${GRADES.map(g => `
            <button type="button" class="grade-chip ${SchedState.school.grades.includes(g) ? 'active' : ''}" data-grade="${g}">
              ${g === 'TK' ? 'TK' : g === 'K' ? 'K' : g + (g==='1'?'st':g==='2'?'nd':g==='3'?'rd':'th')}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">School Day Hours</h2>
        <div class="form-row">
          <div class="form-group form-group-sm">
            <label class="form-label">Day Starts</label>
            <input type="time" class="input" id="day-start" value="${SchedState.school.dayStart}" />
          </div>
          <div class="form-group form-group-sm">
            <label class="form-label">Day Ends</label>
            <input type="time" class="input" id="day-end" value="${SchedState.school.dayEnd}" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Alternate Schedule Days</h2>
        <p class="form-hint">Select days that run on a different schedule, such as early release or late start.</p>
        <div id="alt-days-list">
          ${SchedState.school.earlyReleaseDays.map(day => renderAltDayRow(day, SchedState.school.earlyReleaseEnd)).join('')}
        </div>
        <div class="add-alt-day-row">
          <select class="input input-sm" id="alt-day-select">
            <option value="">Select a day...</option>
            ${DAYS.filter(d => !SchedState.school.earlyReleaseDays.includes(d))
              .map(d => `<option value="${d}">${d}</option>`).join('')}
          </select>
          <button class="btn btn-outline btn-sm" id="add-alt-day-btn">+ Add</button>
        </div>
      </div>

    </div>

    <div class="view-actions">
      <button class="btn btn-primary" id="school-next-btn">Save & Continue to Staff</button>
      <div class="save-status" id="school-save-status"></div>
    </div>
  `;

  // Grade chip toggles
  document.querySelectorAll('.grade-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
    });
  });

  // Alt day add
  document.getElementById('add-alt-day-btn').addEventListener('click', () => {
    const sel = document.getElementById('alt-day-select');
    const day = sel.value;
    if (!day) return;
    const list = document.getElementById('alt-days-list');
    list.insertAdjacentHTML('beforeend', renderAltDayRow(day, SchedState.school.earlyReleaseEnd || '12:30'));
    sel.querySelector(`option[value="${day}"]`).remove();
    sel.value = '';
    wireAltDayRemove();
  });

  wireAltDayRemove();

  document.getElementById('school-next-btn').addEventListener('click', saveSchoolAndContinue);
}

function renderAltDayRow(day, endTime) {
  return `
    <div class="alt-day-row" data-day="${day}">
      <span class="alt-day-label">${day}</span>
      <div class="alt-day-fields">
        <label class="form-label-inline">Ends at</label>
        <input type="time" class="input input-sm alt-day-end" value="${endTime || '12:30'}" />
        <label class="form-label-inline">Label</label>
        <input type="text" class="input input-sm alt-day-note" placeholder="e.g. Early Release" style="width:140px" />
      </div>
      <button class="btn btn-sm remove-alt-day" data-day="${day}" style="color:#ef4444;background:none;border:none;cursor:pointer;font-size:18px;line-height:1;padding:0 4px">×</button>
    </div>
  `;
}

function wireAltDayRemove() {
  document.querySelectorAll('.remove-alt-day').forEach(btn => {
    btn.onclick = () => {
      const day = btn.dataset.day;
      btn.closest('.alt-day-row').remove();
      const sel = document.getElementById('alt-day-select');
      if (sel) {
        const opt = document.createElement('option');
        opt.value = day;
        opt.textContent = day;
        sel.appendChild(opt);
      }
    };
  });
}

async function saveSchoolAndContinue() {
  const name = document.getElementById('school-name').value.trim();
  if (!name) {
    showFormError('school-save-status', 'Please enter a school name.');
    return;
  }

  SchedState.school.name      = name;
  SchedState.school.year      = document.getElementById('school-year').value.trim() || '2026-2027';
  SchedState.school.dayStart  = document.getElementById('day-start').value;
  SchedState.school.dayEnd    = document.getElementById('day-end').value;
  SchedState.school.grades    = [...document.querySelectorAll('.grade-chip.active')].map(c => c.dataset.grade);

  const altRows = document.querySelectorAll('.alt-day-row');
  SchedState.school.earlyReleaseDays = [];
  altRows.forEach(row => {
    SchedState.school.earlyReleaseDays.push(row.dataset.day);
    SchedState.school.earlyReleaseEnd = row.querySelector('.alt-day-end').value;
  });

  saveToLocal();
  showSaveStatus('school-save-status', 'Saving…');
  const result = await saveToSupabase();
  if (result.ok) {
    showSaveStatus('school-save-status', `Saved ✓  Schedule code: ${result.id}`);
  } else {
    showSaveStatus('school-save-status', 'Saved locally (Supabase unavailable)');
  }

  updateSidebarStatus();
  setTimeout(() => { navigateTo('staff'); renderStaff(); }, 600);
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
