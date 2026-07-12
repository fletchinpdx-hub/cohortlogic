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

function minsToTime(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMMRow(m) {
  return `
    <div class="mm-row" data-mm-id="${m.id}">
      <input type="text" class="mm-name input" placeholder="Meeting name" value="${escHtml(m.name)}">
      <input type="time" class="mm-start input" value="${m.start || ''}">
      <span style="color:var(--gray-400)">–</span>
      <input type="time" class="mm-end input" value="${m.end || ''}">
      <button class="btn-icon remove-mm-btn" data-mm-id="${m.id}" title="Remove">×</button>
    </div>
  `;
}

const DEFAULT_SPECIALS = [
  { id: 'sp_pe',  name: 'PE',      duration: 45, classesPerWeek: 1, teacherIds: [], color: '#f97316' },
  { id: 'sp_mu',  name: 'Music',   duration: 45, classesPerWeek: 1, teacherIds: [], color: '#a855f7' },
  { id: 'sp_lib', name: 'Library', duration: 45, classesPerWeek: 1, teacherIds: [], color: '#3b82f6' },
];
const SP_DEFAULT_COLORS = ['#f97316','#a855f7','#3b82f6','#10b981','#ec4899','#14b8a6','#f59e0b','#6366f1'];

function renderSpecialRow(sp, idx) {
  const color = sp.color || SP_DEFAULT_COLORS[(idx || 0) % SP_DEFAULT_COLORS.length];
  const specialsTeachers = SchedState.staff.filter(s => s.role === 'specials_teacher');
  const assignedIds = sp.teacherIds || [];
  const teacherHtml = specialsTeachers.length
    ? specialsTeachers.map(t => `
        <label class="sp-teacher-check">
          <input type="checkbox" class="sp-teacher-cb" data-teacher-id="${t.id}" ${assignedIds.includes(t.id) ? 'checked' : ''}>
          ${escHtml(t.name)}
        </label>`).join('')
    : `<span class="text-muted sp-no-teachers">Add specials teachers in Staff Roster first</span>`;

  return `
    <div class="special-row" data-sp-id="${sp.id}">
      <div class="sp-color-col">
        <input type="color" class="sp-color-input" value="${color}" title="Block color">
      </div>
      <input type="text" class="input sp-name" placeholder="e.g. PE" value="${escHtml(sp.name || '')}">
      <div class="sp-field">
        <label class="form-label">Duration (min)</label>
        <input type="number" class="input input-sm sp-duration" placeholder="45" min="5" step="5" value="${sp.duration || 45}">
      </div>
      <div class="sp-field">
        <label class="form-label">Sessions/wk</label>
        <input type="number" class="input input-sm sp-cpw" placeholder="1" min="1" max="5" step="1" value="${sp.classesPerWeek || 1}">
      </div>
      <div class="sp-field sp-field-teachers">
        <label class="form-label">Teacher</label>
        <div class="sp-teacher-list">${teacherHtml}</div>
      </div>
      <button class="btn-icon remove-sp-btn" data-sp-id="${sp.id}" title="Remove">×</button>
    </div>
  `;
}

function wireSpRemove() {
  document.querySelectorAll('.remove-sp-btn').forEach(btn => {
    btn.replaceWith(btn.cloneNode(true));
  });
  document.querySelectorAll('.remove-sp-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.special-row').remove());
  });
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
          <div class="form-group">
            <label class="form-label">District <span class="form-hint-sm">(optional)</span></label>
            <input type="text" class="input" id="school-district" placeholder="e.g. Portland Public Schools" value="${s.district || ''}" />
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
            <span class="time-bound-label">Student Campus Hours</span>
            <div class="time-bound-inputs">
              <div class="form-group form-group-sm">
                <label class="form-label">Arrival</label>
                <input type="time" class="input" id="student-campus-start" value="${s.studentCampusStart || '07:45'}" />
              </div>
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

      </div>

      <!-- Lunch Periods -->
      <div class="form-section">
        <h2 class="form-section-title">Lunch Periods</h2>
        <p class="form-hint">Define each lunch wave. Multiple grades can share one period.</p>
        <div id="lunch-list">${s.lunchPeriods.map(renderLunchRow).join('')}</div>
        <button class="btn btn-outline btn-sm" id="add-lunch-btn" style="margin-top:8px">+ Add Lunch Period</button>
      </div>

      <!-- Recess — per grade -->
      <div class="form-section">
        <h2 class="form-section-title">Recess</h2>
        <p class="form-hint">Set how many recesses each grade has and the duration of each. One recess per grade will be placed immediately before or after that grade's lunch.</p>
        <div id="recess-grade-list">${renderGradeRecessHTML(s)}</div>
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

    <div id="school-warnings"></div>

    <div class="view-actions">
      <button class="btn btn-primary" id="school-next-btn">Save & Continue →</button>
      <div class="save-status" id="school-save-status"></div>
    </div>
  `;

  // School-level grade chips — update state + recess section immediately on toggle
  document.querySelectorAll('#school-grade-chips .grade-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      SchedState.school.grades = [...document.querySelectorAll('#school-grade-chips .grade-chip.active')].map(c => c.dataset.grade);
      document.getElementById('recess-grade-list').innerHTML = renderGradeRecessHTML(SchedState.school);
      wireRecessEvents();
    });
  });

  // Lunch add
  document.getElementById('add-lunch-btn').addEventListener('click', () => {
    SchedState.school.lunchPeriods.push({ id: uid(), start: '11:00', duration: 30, grades: [] });
    refreshLunchList();
  });

  wireRecessEvents();

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
  wireLunchEvents();

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

// ── Lunch events (formerly wireLunchRecessEvents, now lunch-only) ─────────────
function refreshLunchList() {
  document.getElementById('lunch-list').innerHTML = SchedState.school.lunchPeriods.map(renderLunchRow).join('');
  wireLunchEvents();
}

function wireLunchEvents() {
  document.querySelectorAll('.grade-chip-xs').forEach(chip => {
    chip.addEventListener('click', () => {
      const { id, grade } = chip.dataset;
      const item = SchedState.school.lunchPeriods.find(x => x.id === id);
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
      const item = SchedState.school.lunchPeriods.find(x => x.id === inp.dataset.id);
      if (item) item.start = inp.value;
    });
  });

  document.querySelectorAll('.period-dur').forEach(inp => {
    inp.addEventListener('change', () => {
      const item = SchedState.school.lunchPeriods.find(x => x.id === inp.dataset.id);
      if (item) item.duration = parseInt(inp.value, 10);
    });
  });

  document.querySelectorAll('.remove-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SchedState.school.lunchPeriods = SchedState.school.lunchPeriods.filter(x => x.id !== btn.dataset.id);
      refreshLunchList();
    });
  });
}

// ── Per-grade recess ──────────────────────────────────────────────────────────

function renderGradeRecessHTML(s) {
  const grades = gradesSorted();
  if (!grades.length) {
    return '<p class="form-hint" style="margin:0">Select grade levels above first.</p>';
  }
  if (!s.gradeRecesses) s.gradeRecesses = {};
  const gr = s.gradeRecesses;
  return grades.map(g => {
    if (!gr[g] || gr[g].length === 0) {
      gr[g] = [
        { id: uid(), duration: 20, lunchAdjacent: false, lunchSide: 'after' },
        { id: uid(), duration: 15, lunchAdjacent: true,  lunchSide: 'after' },
      ];
    }
    return renderGradeRecessItem(g, gr[g]);
  }).join('');
}

function renderGradeRecessItem(g, slots) {
  const count = slots.length;
  const lunchIdx = slots.findIndex(sl => sl.lunchAdjacent);

  const slotsHTML = count === 0 ? '' : `
    <div class="recess-slots-wrap">
      ${slots.map((sl, i) => {
        const isOnly = count === 1;
        const isLunch = sl.lunchAdjacent;
        const side = sl.lunchSide || 'after';
        return `
          <div class="recess-slot-row" data-grade="${g}" data-idx="${i}">
            <span class="recess-slot-num">${i + 1}</span>
            <input type="number" class="input input-sm recess-slot-dur"
              value="${sl.duration}" min="5" max="60" step="5"
              data-grade="${g}" data-idx="${i}" />
            <span class="period-sep">min</span>
            ${isOnly
              ? `<span class="recess-auto-label">Lunch recess</span>`
              : `<label class="alt-day-option recess-lunch-label">
                  <input type="checkbox" class="recess-lunch-cb" ${isLunch ? 'checked' : ''}
                    data-grade="${g}" data-idx="${i}" />
                  Lunch recess
                </label>`
            }
            ${isLunch ? `
              <span class="recess-side-wrap">
                <label class="alt-day-option">
                  <input type="radio" name="rs-side-${g}" class="recess-side-r" value="before"
                    ${side === 'before' ? 'checked' : ''} data-grade="${g}" data-idx="${i}" />
                  Before
                </label>
                <label class="alt-day-option">
                  <input type="radio" name="rs-side-${g}" class="recess-side-r" value="after"
                    ${side !== 'before' ? 'checked' : ''} data-grade="${g}" data-idx="${i}" />
                  After
                </label>
              </span>` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  return `
    <div class="recess-grade-item" data-grade="${g}">
      <div class="recess-grade-header">
        <span class="recess-grade-name">${GRADE_LABELS[g] || g}</span>
        <div class="recess-count-ctrl">
          <button class="btn-icon recess-dec" data-grade="${g}">−</button>
          <span class="recess-count-num">${count}</span>
          <button class="btn-icon recess-inc" data-grade="${g}">+</button>
          <span class="period-sep">${count === 1 ? 'recess' : 'recesses'}</span>
        </div>
      </div>
      ${slotsHTML}
    </div>
  `;
}

function refreshGradeRecessItem(g) {
  const slots = (SchedState.school.gradeRecesses || {})[g] || [];
  const el = document.querySelector(`.recess-grade-item[data-grade="${g}"]`);
  if (el) el.outerHTML = renderGradeRecessItem(g, slots);
  wireRecessEvents();
}

function wireRecessEvents() {
  // + / − count buttons
  document.querySelectorAll('.recess-inc').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.grade;
      const gr = SchedState.school.gradeRecesses || {};
      const slots = gr[g] || [];
      if (slots.length >= 4) return;
      const newSlot = { id: uid(), duration: 15, lunchAdjacent: slots.length === 0, lunchSide: 'after' };
      gr[g] = [...slots, newSlot];
      SchedState.school.gradeRecesses = gr;
      refreshGradeRecessItem(g);
    });
  });

  document.querySelectorAll('.recess-dec').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = btn.dataset.grade;
      const gr = SchedState.school.gradeRecesses || {};
      const slots = gr[g] || [];
      if (slots.length === 0) return;
      const updated = slots.slice(0, -1);
      // Ensure at least one is lunch-adjacent if any remain
      if (updated.length > 0 && !updated.some(s => s.lunchAdjacent)) {
        updated[0].lunchAdjacent = true;
      }
      gr[g] = updated;
      SchedState.school.gradeRecesses = gr;
      refreshGradeRecessItem(g);
    });
  });

  // Duration change
  document.querySelectorAll('.recess-slot-dur').forEach(inp => {
    inp.addEventListener('change', () => {
      const { grade, idx } = inp.dataset;
      const slots = (SchedState.school.gradeRecesses || {})[grade] || [];
      if (slots[idx]) slots[idx].duration = parseInt(inp.value, 10);
    });
  });

  // Lunch-adjacent checkbox — enforce exactly one per grade
  document.querySelectorAll('.recess-lunch-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const { grade, idx } = cb.dataset;
      const slots = (SchedState.school.gradeRecesses || {})[grade] || [];
      if (cb.checked) {
        // Uncheck all others for this grade
        slots.forEach((sl, i) => { sl.lunchAdjacent = (i === parseInt(idx)); });
      } else {
        // Don't allow unchecking the only lunch-adjacent
        if (!slots.some((sl, i) => sl.lunchAdjacent && i !== parseInt(idx))) {
          cb.checked = true; return;
        }
        slots[parseInt(idx)].lunchAdjacent = false;
      }
      // Re-render to show/hide the before/after toggle
      refreshGradeRecessItem(grade);
    });
  });

  // Before / After radio
  document.querySelectorAll('.recess-side-r').forEach(r => {
    r.addEventListener('change', () => {
      const { grade, idx } = r.dataset;
      const slots = (SchedState.school.gradeRecesses || {})[grade] || [];
      if (slots[parseInt(idx)]) slots[parseInt(idx)].lunchSide = r.value;
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

// ── Recess auto-scheduler ─────────────────────────────────────────────────────
// Returns { gradeKey: [{ id, duration, start, name }] }
function computeRecessTimes(s) {
  const result = {};
  const grades = gradesSorted();
  const fbMins = timeToMins(s.firstBell || '08:00');
  const gr     = s.gradeRecesses || {};

  // Collect grades that have a non-lunch-adjacent recess needing a morning slot
  // Sort youngest first so they get priority
  const morningQueue = [];
  grades.forEach(g => {
    const slots = gr[g] || [];
    const extras = slots.filter(sl => !sl.lunchAdjacent);
    extras.forEach((sl, i) => morningQueue.push({ g, sl, extraIdx: i }));
  });

  // Assign morning times: youngest grade starts at fb+60min, each subsequent grade
  // shifts right by (prev recess duration + 10 min) to stagger playground use
  let nextMorning = fbMins + 60;
  const morningTimes = new Map(); // key = `${g}-${extraIdx}` → start mins
  morningQueue.forEach(({ g, sl, extraIdx }) => {
    const lp = (s.lunchPeriods || []).find(x => (x.grades || []).includes(g))
            || (s.lunchPeriods || []).find(x => !(x.grades || []).length)
            || (s.lunchPeriods || [])[0];
    const lunchStart = lp ? timeToMins(lp.start) : fbMins + 4 * 60;
    // Clamp: must end at least 30 min before lunch
    const maxStart = lunchStart - sl.duration - 30;
    const assigned = Math.min(nextMorning, maxStart);
    const rounded  = Math.round(Math.max(assigned, fbMins + 30) / 5) * 5;
    morningTimes.set(`${g}-${extraIdx}`, rounded);
    nextMorning = rounded + Number(sl.duration) + 10;
  });

  grades.forEach(g => {
    const slots = gr[g] || [];
    if (!slots.length) return;

    const lp        = (s.lunchPeriods || []).find(x => (x.grades || []).includes(g))
                   || (s.lunchPeriods || []).find(x => !(x.grades || []).length)
                   || (s.lunchPeriods || [])[0];
    const lunchS    = lp ? timeToMins(lp.start) : null;
    const lunchE    = lp ? lunchS + lp.duration  : null;
    let extraCount  = 0;

    result[g] = slots.map((sl, i) => {
      let startMins;
      let name;

      if (sl.lunchAdjacent) {
        const side = sl.lunchSide || 'after';
        if (lunchS !== null) {
          startMins = side === 'before' ? lunchS - sl.duration : lunchE;
          name = side === 'before' ? 'Pre-Lunch Recess' : 'Lunch Recess';
        } else {
          // No lunch — put it in the morning with the rest
          const key = `${g}-${extraCount}`;
          startMins = morningTimes.get(key) || (fbMins + 90 + extraCount * 15);
          name = 'Morning Recess';
          extraCount++;
        }
      } else {
        const key = `${g}-${extraCount}`;
        if (extraCount === 0) {
          startMins = morningTimes.get(key) || (fbMins + 90);
          name = 'Morning Recess';
        } else {
          // Second non-lunch recess → afternoon, ~45 min after lunch ends
          startMins = lunchE ? Math.round((lunchE + 45) / 5) * 5 : (fbMins + 6 * 60);
          name = 'Afternoon Recess';
        }
        extraCount++;
      }

      startMins = Math.round(startMins / 5) * 5;
      const h = String(Math.floor(startMins / 60)).padStart(2, '0');
      const m = String(startMins % 60).padStart(2, '0');
      return { id: sl.id, duration: sl.duration, start: `${h}:${m}`, name, lunchAdjacent: sl.lunchAdjacent };
    });
  });

  // Enforce 60-min minimum gap between consecutive recesses within each grade.
  // Lunch-adjacent recesses are anchored to lunch, so they can't move — instead
  // pull the earlier (free-floating) recess earlier to create the required gap.
  // Free-floating recesses can be pushed later when the earlier slot is anchored.
  const MIN_RECESS_GAP = 60;
  Object.keys(result).forEach(grade => {
    const recesses = result[grade];
    if (recesses.length < 2) return;
    recesses.sort((a, b) => timeToMins(a.start) - timeToMins(b.start));
    for (let i = 0; i < recesses.length - 1; i++) {
      const endA  = timeToMins(recesses[i].start) + Number(recesses[i].duration);
      const startB = timeToMins(recesses[i + 1].start);
      if (startB - endA >= MIN_RECESS_GAP) continue;

      if (!recesses[i + 1].lunchAdjacent) {
        // Later recess is free-floating — push it later
        const newStart = Math.round((endA + MIN_RECESS_GAP) / 5) * 5;
        const h = String(Math.floor(newStart / 60)).padStart(2, '0');
        const m = String(newStart % 60).padStart(2, '0');
        recesses[i + 1].start = `${h}:${m}`;
      } else {
        // Later recess is lunch-adjacent (anchored) — pull earlier recess earlier
        const requiredEnd   = startB - MIN_RECESS_GAP;
        const newStart      = Math.round((requiredEnd - Number(recesses[i].duration)) / 5) * 5;
        const clamped       = Math.max(newStart, fbMins + 30);
        const h = String(Math.floor(clamped / 60)).padStart(2, '0');
        const m = String(clamped % 60).padStart(2, '0');
        recesses[i].start = `${h}:${m}`;
      }
    }
  });

  return result;
}

// Returns true for any fixed-block slot value, including compound bt_mm|id variants.
function isFixedBlock(id) {
  if (!id) return false;
  const base = id.includes('|') ? id.split('|')[0] : id;
  if (base === 'bt_mm' || base === 'bt_lunch' || base === 'bt_recess') return true;
  const bt = SchedState.blockTypes.find(b => b.id === base);
  return !!(bt && bt.uniformStart && bt.uniformEnd);
}

// Find the first time window common to ALL grades where numSlots consecutive slots are free.
function _findUniformSlot(durationMins) {
  const grades = gradesSorted();
  if (!grades.length) return null;
  const numSlots = Math.ceil(durationMins / 5);
  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  for (const day of DAYS) {
    const slots = generateTimeSlots(
      SchedState.school.firstBell || '08:00',
      SchedState.school.dismissal || '14:30'
    );
    for (let i = 0; i <= slots.length - numSlots; i++) {
      const window = slots.slice(i, i + numSlots);
      const allFree = grades.every(g => {
        const sched = SchedState.masterSchedule[day]?.[g] || {};
        return window.every(sl => !sched[sl] || isFixedBlock(sched[sl]));
      });
      if (allFree) {
        const endMins = timeToMins(slots[i + numSlots - 1]) + 5;
        return { start: slots[i], end: minsToTime(endMins) };
      }
    }
  }
  return null;
}

// Pre-fills the master schedule with fixed blocks from School Info settings.
// Called on save. Clears and replaces any previously auto-placed lunch/recess/MM blocks.
function preFillFixedBlocks() {
  const s      = SchedState.school;
  const grades = gradesSorted();
  if (!grades.length) return;

  const lunchBT  = 'bt_lunch';
  const recessBT = 'bt_recess';
  const recessMap = computeRecessTimes(s);

  const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  DAYS.forEach(day => {
    if (!SchedState.masterSchedule[day]) SchedState.masterSchedule[day] = {};
    grades.forEach(g => {
      if (!SchedState.masterSchedule[day][g]) SchedState.masterSchedule[day][g] = {};
      const sched = SchedState.masterSchedule[day][g];

      // Clear old auto-placed fixed blocks (bt_mm, bt_mm|id, bt_lunch, bt_recess)
      Object.keys(sched).forEach(slot => { if (isFixedBlock(sched[slot])) delete sched[slot]; });

      // Morning meeting / bt_mm — prefer block type's uniformStart/End over legacy morningMeetings
      const btMM = SchedState.blockTypes.find(bt => bt.id === 'bt_mm');
      const meetings = (btMM?.uniformStart && btMM?.uniformEnd)
        ? [{ id: null, start: btMM.uniformStart, end: btMM.uniformEnd }]
        : (s.morningMeetings?.length
          ? s.morningMeetings
          : (s.morningMeetingEnabled && s.morningMeetingStart && s.morningMeetingEnd
            ? [{ start: s.morningMeetingStart, end: s.morningMeetingEnd }] : []));
      meetings.forEach(m => {
        if (!m.start || !m.end) return;
        const slotId = m.id ? `bt_mm|${m.id}` : 'bt_mm';
        generateTimeSlots(m.start, m.end).forEach(slot => {
          if (!sched[slot] || isFixedBlock(sched[slot])) sched[slot] = slotId;
        });
      });

      // Other uniform block types with fixed time config
      SchedState.blockTypes.filter(bt => bt.id !== 'bt_mm' && bt.uniformStart && bt.uniformEnd)
        .forEach(bt => {
          generateTimeSlots(bt.uniformStart, bt.uniformEnd).forEach(slot => {
            if (!sched[slot] || isFixedBlock(sched[slot])) sched[slot] = bt.id;
          });
        });

      // Lunch — try: grade explicitly listed → universal period (no grades) → any period.
      // Always overwrite: if the user fixes a bad lunch time the corrected slot
      // must reclaim any instructional block that landed there previously.
      const lp = (s.lunchPeriods || []).find(p => (p.grades || []).includes(g))
              || (s.lunchPeriods || []).find(p => !(p.grades || []).length)
              || (s.lunchPeriods || [])[0];
      if (lp) {
        const lunchEnd = minsToTime(timeToMins(lp.start) + Number(lp.duration));
        generateTimeSlots(lp.start, lunchEnd)
          .forEach(slot => { sched[slot] = lunchBT; });
      }

      // Recess — always overwrite for the same reason.
      (recessMap[g] || []).forEach(rs => {
        const recessEnd = minsToTime(timeToMins(rs.start) + Number(rs.duration));
        generateTimeSlots(rs.start, recessEnd)
          .forEach(slot => { sched[slot] = recessBT; });
      });
    });
  });
}

function saveSchoolAndContinue() {
  const name = document.getElementById('school-name').value.trim();
  if (!name) { showFormError('school-save-status', 'Please enter a school name.'); return; }

  const s = SchedState.school;
  s.name     = name;
  s.district = document.getElementById('school-district').value.trim();
  s.year     = document.getElementById('school-year').value.trim() || '2026-2027';
  s.grades = [...document.querySelectorAll('#school-grade-chips .grade-chip.active')].map(c => c.dataset.grade);

  s.teacherContractStart = document.getElementById('teacher-contract-start').value;
  s.teacherContractEnd   = document.getElementById('teacher-contract-end').value;
  s.studentCampusStart   = document.getElementById('student-campus-start').value;
  s.firstBell            = document.getElementById('first-bell').value;
  s.dismissal            = document.getElementById('dismissal').value;
  s.studentCampusEnd     = s.dismissal; // kept for backward-compat with saved files
  s.dayStart = s.firstBell;
  s.dayEnd   = s.dismissal;

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
  preFillFixedBlocks();
  updateSidebarStatus();

  // Check for recess spacing and lunch errors; show warnings but don't block navigation
  const schoolWarnings = _computeSchoolInfoWarnings(s);
  if (schoolWarnings.length) {
    const warnEl = document.getElementById('school-warnings');
    if (warnEl) {
      warnEl.innerHTML = schoolWarnings.map(w =>
        `<div class="setup-banner setup-banner-error" style="margin-bottom:8px">${w}</div>`
      ).join('');
      warnEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return; // Show warnings in-place; user must re-save or dismiss to continue
    }
  }

  navigateTo('staff');
  renderStaff();
}

function _computeSchoolInfoWarnings(s) {
  const warnings = [];
  const fbMins  = timeToMins(s.firstBell || '08:00');
  const disMins = timeToMins(s.dismissal  || '14:30');

  // Lunch out-of-hours
  (s.lunchPeriods || []).forEach(lp => {
    if (!lp.start) return;
    const lsMins = timeToMins(lp.start);
    if (lsMins < fbMins || lsMins >= disMins) {
      warnings.push(
        `⚠ <strong>Lunch time error:</strong> Lunch at <strong>${fmtTime12(lp.start)}</strong> is outside ` +
        `the school day (${fmtTime12(s.firstBell || '08:00')} first bell – ${fmtTime12(s.dismissal || '14:30')} dismissal). ` +
        `Check for AM/PM mistakes.`
      );
    }
  });

  // Recess spacing + boundary checks
  if (typeof computeRecessTimes === 'function') {
    const recessMap = computeRecessTimes(s);
    const MIN_GAP   = 60;
    const fbMins    = timeToMins(s.firstBell  || '08:00');
    const disMins   = timeToMins(s.dismissal  || '14:30');
    Object.entries(recessMap).forEach(([grade, recesses]) => {
      if (!recesses.length) return;
      const label  = escHtml(GRADE_LABELS[grade] || grade);
      const sorted = [...recesses].sort((a, b) => timeToMins(a.start) - timeToMins(b.start));

      // Spacing check
      for (let i = 0; i < sorted.length - 1; i++) {
        const endA   = timeToMins(sorted[i].start) + Number(sorted[i].duration);
        const startB = timeToMins(sorted[i + 1].start);
        const gap    = startB - endA;
        if (gap < MIN_GAP) {
          warnings.push(
            `⚠ <strong>Recess spacing (${label}):</strong> ` +
            `${escHtml(sorted[i].name)} (${fmtTime12(sorted[i].start)}) and ` +
            `${escHtml(sorted[i + 1].name)} (${fmtTime12(sorted[i + 1].start)}) ` +
            `are only <strong>${gap} min</strong> apart — minimum is 60 min. ` +
            `Adjust recess times or lunch time to create more space.`
          );
        }
      }

      // Boundary: first recess must not start within the first 60 min of the day
      const first = sorted[0];
      if (!first.lunchAdjacent && timeToMins(first.start) < fbMins + 60) {
        warnings.push(
          `⚠ <strong>Recess too early (${label}):</strong> ` +
          `${escHtml(first.name)} starts at ${fmtTime12(first.start)}, which is within the first 60 min of the day. ` +
          `Move it to ${fmtTime12(minsToTime(fbMins + 60))} or later.`
        );
      }

      // Boundary: last recess must not end within the last 30 min of the day
      const last    = sorted[sorted.length - 1];
      const lastEnd = timeToMins(last.start) + Number(last.duration);
      if (!last.lunchAdjacent && lastEnd > disMins - 30) {
        warnings.push(
          `⚠ <strong>Recess too late (${label}):</strong> ` +
          `${escHtml(last.name)} ends at ${fmtTime12(minsToTime(lastEnd))}, which is within the last 30 min of the day. ` +
          `Move it earlier so it ends by ${fmtTime12(minsToTime(disMins - 30))}.`
        );
      }
    });
  }

  return warnings;
}


// ── Step 2: Staff Roster ─────────────────────────────────────────────────────
function renderStaff() {
  document.getElementById('view-staff').innerHTML = `
    <div class="view-header">
      <h1>Staff Roster</h1>
      <p class="view-subtitle">Add everyone who will appear on the schedule. Include classroom teachers, specials teachers (PE, Music, Library…), IAs, and support staff.</p>
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
      <button class="btn btn-outline" id="staff-back-btn">← Back to School Info</button>
      <button class="btn btn-primary" id="staff-next-btn">Save &amp; Continue to Specials →</button>
      <div class="save-status" id="staff-save-status"></div>
    </div>
  `;

  document.getElementById('add-staff-btn').addEventListener('click', () => showAddStaffForm());
  document.getElementById('staff-back-btn').addEventListener('click', () => { navigateTo('school'); renderSchoolInfo(); });
  document.getElementById('staff-next-btn').addEventListener('click', saveStaffAndContinue);
  wireStaffTable();
}

function renderStaffRow(s) {
  const isSpecials = s.role === 'specials_teacher';
  const primaryLabel = s.gradeAssignment ? (GRADE_LABELS[s.gradeAssignment] || s.gradeAssignment) : '—';
  const splitLabel   = s.splitGrade      ? (GRADE_LABELS[s.splitGrade]      || s.splitGrade)      : null;
  const gradeDisplay = isSpecials
    ? '—'
    : splitLabel ? `${primaryLabel} / ${splitLabel}` : primaryLabel;
  const splitBadge   = !isSpecials && splitLabel ? ' <span class="split-badge">split</span>' : '';
  const hoursDisplay = (s.startTime && s.endTime)
    ? `${fmtTime12(s.startTime)} – ${fmtTime12(s.endTime)}`
    : '—';
  return `
    <tr data-id="${s.id}">
      <td>${s.role === 'ia' ? `<span class="color-swatch" style="background:${s.color}"></span>` : ''}</td>
      <td class="staff-name">${escHtml(s.name)}</td>
      <td>${ROLE_LABELS[s.role] || s.role}</td>
      <td>${gradeDisplay}${splitBadge}</td>
      <td class="staff-hours">${isSpecials ? '—' : hoursDisplay}</td>
      <td class="staff-actions">
        <button class="btn btn-sm btn-outline edit-staff-btn" data-id="${s.id}">Edit</button>
        <button class="btn btn-sm btn-danger remove-staff-btn" data-id="${s.id}">Remove</button>
      </td>
    </tr>
  `;
}

function renderStaffTable() {
  if (SchedState.staff.length === 0) {
    return `<div class="empty-state"><div class="empty-icon">👤</div><p>No staff added yet. Click "+ Add Staff Member" to get started.</p></div>`;
  }

  const roleOrder = ['classroom_teacher','specials_teacher','ia','specialist','eld','sped','admin','other'];
  const byRole = {};
  SchedState.staff.forEach(s => {
    if (!byRole[s.role]) byRole[s.role] = [];
    byRole[s.role].push(s);
  });

  const sections = roleOrder.filter(r => byRole[r]?.length).map(role => {
    const rows = byRole[role].map(s => renderStaffRow(s)).join('');
    return `
      <div class="staff-role-group">
        <div class="staff-role-label">${ROLE_LABELS[role] || role}s</div>
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:32px"></th>
              <th>Name</th>
              <th>Role</th>
              <th>Grade</th>
              <th>Hours</th>
              <th style="width:160px"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  return sections;
}

function showAddStaffForm(existingId) {
  const existing = existingId ? SchedState.staff.find(s => s.id === existingId) : null;
  const defaultStart = SchedState.school.teacherContractStart || SchedState.school.firstBell    || '08:00';
  const defaultEnd   = SchedState.school.teacherContractEnd   || SchedState.school.dismissal    || '14:30';
  const grades       = gradesSorted();

  const gradeOpts = (selected, includeBlank, blankLabel) =>
    (includeBlank ? `<option value="">${blankLabel}</option>` : '') +
    grades.map(g => `<option value="${g}" ${selected === g ? 'selected' : ''}>${GRADE_LABELS[g] || g}</option>`).join('');

  const currentRole = existing?.role || 'classroom_teacher';
  const isSpecials  = currentRole === 'specials_teacher';
  const form = document.getElementById('add-staff-form');
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.innerHTML = `
    <div class="inline-form-grid">
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input type="text" class="input" id="sf-name" placeholder="e.g. Jordan Rivera" value="${escHtml(existing?.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="input" id="sf-role">
          ${Object.entries(ROLE_LABELS).map(([val, label]) =>
            `<option value="${val}" ${currentRole === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group sf-grade-field${isSpecials ? ' hidden' : ''}">
        <label class="form-label">
          <span class="field-tooltip">
            Primary Grade
            <span class="field-tooltip-icon" tabindex="0">?</span>
            <span class="field-tooltip-body">For split-grade teachers, the primary grade drives lunch, recess, and specials scheduling. The master schedule is built around this grade's block sequence.</span>
          </span>
        </label>
        <select class="input" id="sf-grade">
          ${gradeOpts(existing?.gradeAssignment || '', true, 'Building-wide')}
        </select>
      </div>
      <div class="form-group sf-split-field${isSpecials ? ' hidden' : ''}">
        <label class="form-label">Splits with Grade <span class="form-hint-sm">(optional)</span></label>
        <select class="input" id="sf-split-grade">
          ${gradeOpts(existing?.splitGrade || '', true, '— No split —')}
        </select>
        <div class="split-grade-hint${existing?.splitGrade ? '' : ' hidden'}" id="sf-split-hint">
          This teacher splits time between two grades. Their lunch, recess, and specials will follow the <strong>Primary Grade</strong> above.
        </div>
      </div>
      <div class="form-group sf-hours-field">
        <label class="form-label">Start Time</label>
        <input type="time" class="input" id="sf-start" value="${existing?.startTime || defaultStart}" />
      </div>
      <div class="form-group sf-hours-field">
        <label class="form-label">End Time</label>
        <input type="time" class="input" id="sf-end" value="${existing?.endTime || defaultEnd}" />
      </div>
      <div class="form-group form-group-color sf-color-field${existing?.role === 'ia' ? '' : ' hidden'}" style="flex: 0 0 100%">
        <label class="form-label">Color <span class="form-hint-sm">shown as a dot on IA schedule</span></label>
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

  document.getElementById('sf-name')?.focus();

  document.getElementById('sf-split-grade').addEventListener('change', function() {
    document.getElementById('sf-split-hint')?.classList.toggle('hidden', !this.value);
  });

  document.getElementById('sf-role').addEventListener('change', function() {
    const hideForSpecials = this.value === 'specials_teacher';
    const isIA = this.value === 'ia';
    document.querySelectorAll('.sf-grade-field, .sf-split-field').forEach(el => {
      el.classList.toggle('hidden', hideForSpecials);
    });
    document.querySelector('.sf-color-field')?.classList.toggle('hidden', !isIA);
  });

  document.getElementById('sf-cancel-btn').addEventListener('click', () => {
    form.classList.add('hidden');
    form.innerHTML = '';
  });

  document.getElementById('sf-save-btn').addEventListener('click', () => {
    const name = document.getElementById('sf-name').value.trim();
    if (!name) { document.getElementById('sf-name').focus(); return; }

    const splitGrade = document.getElementById('sf-split-grade').value;
    const member = {
      id:              existing?.id || uid(),
      name,
      role:            document.getElementById('sf-role').value,
      gradeAssignment: document.getElementById('sf-grade').value,
      splitGrade:      splitGrade || null,
      startTime:       document.getElementById('sf-start').value || defaultStart,
      endTime:         document.getElementById('sf-end').value   || defaultEnd,
      color:           document.getElementById('sf-role').value === 'ia'
                       ? (document.querySelector('.color-dot.selected')?.dataset.color || nextStaffColor())
                       : (existing?.color || '#94a3b8'),
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

function saveStaffAndContinue() {
  saveToLocal();
  updateSidebarStatus();
  navigateTo('specials');
  renderSpecialsView();
}

// ── Step 2b: Specials ─────────────────────────────────────────────────────────

function renderSpecialsView() {
  const specials = SchedState.school.specials && SchedState.school.specials.length
    ? SchedState.school.specials
    : JSON.parse(JSON.stringify(DEFAULT_SPECIALS));

  document.getElementById('view-specials').innerHTML = `
    <div class="view-header">
      <h1>Specials</h1>
      <p class="view-subtitle">Define the special subjects your students attend — PE, Music, Library, Art, etc. — and assign the teachers who lead them.</p>
    </div>

    <div class="setup-form">
      <div class="form-section">
        <h2 class="form-section-title">Special Subjects</h2>
        <p class="form-hint">Each special gets a color used on the master schedule. Assign one or more teachers who teach that subject.</p>
        <div id="specials-list">
          ${specials.map((sp, i) => renderSpecialRow(sp, i)).join('')}
        </div>
        <button class="btn btn-outline btn-sm mt-8" id="add-special-btn">+ Add Special</button>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Weekly Rotation Mode</h2>
        <p class="form-hint">Controls how a class cycles through specials across the week.</p>
        <div class="specials-rotation-opts">
          <label class="rotation-opt ${(SchedState.school.specialsRotationMode || 'intermittent') === 'intermittent' ? 'active' : ''}">
            <input type="radio" name="specials-rotation" value="intermittent"
                   ${(SchedState.school.specialsRotationMode || 'intermittent') === 'intermittent' ? 'checked' : ''} />
            <div class="rotation-opt-body">
              <div class="rotation-opt-title">Intermittent <span class="badge-default">Default</span></div>
              <div class="rotation-opt-desc">Cycle through all specials before repeating any. If you have Music, Library, and PE — a class gets each one before Music appears again.</div>
            </div>
          </label>
          <label class="rotation-opt ${SchedState.school.specialsRotationMode === 'sequential' ? 'active' : ''}">
            <input type="radio" name="specials-rotation" value="sequential"
                   ${SchedState.school.specialsRotationMode === 'sequential' ? 'checked' : ''} />
            <div class="rotation-opt-body">
              <div class="rotation-opt-title">Sequential</div>
              <div class="rotation-opt-desc">Complete all sessions of one special before moving to the next. Music × 2 days, then Library × 1 day, then PE × 1 day.</div>
            </div>
          </label>
          <label class="rotation-opt ${SchedState.school.specialsRotationMode === 'none' ? 'active' : ''}">
            <input type="radio" name="specials-rotation" value="none"
                   ${SchedState.school.specialsRotationMode === 'none' ? 'checked' : ''} />
            <div class="rotation-opt-body">
              <div class="rotation-opt-title">No Preference</div>
              <div class="rotation-opt-desc">Let the software place specials wherever they fit best. No rotation order is enforced — this gives the scheduler maximum flexibility to resolve conflicts and fill gaps.</div>
            </div>
          </label>
        </div>
      </div>
    </div>

    <div class="view-actions">
      <button class="btn btn-outline" id="specials-back-btn">← Back to Staff Roster</button>
      <button class="btn btn-primary" id="specials-next-btn">Save &amp; Continue to Block Types →</button>
    </div>
  `;

  wireSpRemove();

  document.getElementById('add-special-btn').addEventListener('click', () => {
    const idx = document.querySelectorAll('.special-row').length;
    const newSp = {
      id: 'sp_' + Date.now(),
      name: '',
      duration: 45,
      classesPerWeek: 1,
      teacherIds: [],
      color: SP_DEFAULT_COLORS[idx % SP_DEFAULT_COLORS.length],
    };
    const div = document.createElement('div');
    div.innerHTML = renderSpecialRow(newSp, idx).trim();
    document.getElementById('specials-list').appendChild(div.firstChild);
    wireSpRemove();
  });

  document.getElementById('specials-back-btn').addEventListener('click', () => {
    navigateTo('staff');
    renderStaff();
  });
  document.getElementById('specials-next-btn').addEventListener('click', saveSpecialsAndContinue);
}

function saveSpecialsAndContinue() {
  const rotationEl = document.querySelector('input[name="specials-rotation"]:checked');
  if (rotationEl) SchedState.school.specialsRotationMode = rotationEl.value;

  const rows = document.querySelectorAll('#specials-list .special-row');
  SchedState.school.specials = [...rows].map(row => {
    const existingId = row.dataset.spId;
    const checkedTeachers = [...row.querySelectorAll('.sp-teacher-cb:checked')].map(cb => cb.dataset.teacherId);
    return {
      id:             existingId || ('sp_' + Date.now()),
      name:           row.querySelector('.sp-name').value.trim(),
      duration:       Number(row.querySelector('.sp-duration').value) || 45,
      classesPerWeek: Number(row.querySelector('.sp-cpw').value) || 1,
      teacherIds:     checkedTeachers,
      color:          row.querySelector('.sp-color-input').value,
    };
  }).filter(sp => sp.name);
  saveToLocal();
  updateSidebarStatus();
  navigateTo('blocks');
  renderBlocks();
}

// ── Step 3: Block Types ───────────────────────────────────────────────────────
// ── Block Types page helpers ──────────────────────────────────────────────────

function collectBandsFromDOM() {
  const rows = document.querySelectorAll('.band-row');
  if (!rows.length) return;
  SchedState.school.gradeBands = [...rows].map(row => ({
    id:     row.dataset.bandId,
    name:   row.querySelector('.band-name-input').value.trim(),
    grades: [...row.querySelectorAll('.grade-chip-xs.active')].map(c => c.dataset.grade),
  }));
}

function collectReqFromDOM() {
  document.querySelectorAll('#req-tbody .req-row').forEach(row => {
    const btId = row.dataset.btId;
    const bt   = SchedState.blockTypes.find(b => b.id === btId);
    if (!bt) return;
    const nameEl  = row.querySelector('.req-name-input');
    const colorEl = row.querySelector('.req-color-input');
    if (nameEl)  bt.name  = nameEl.value.trim()  || bt.name;
    if (colorEl) bt.color = colorEl.value;
    const hasSubs = (bt.subBlocks || []).length > 0;
    if (!hasSubs) {
      bt.bandMinutes = bt.bandMinutes || {};
      row.querySelectorAll('.req-min-input').forEach(inp => {
        const val = parseInt(inp.value, 10);
        bt.bandMinutes[inp.dataset.bandId] = isNaN(val) ? 0 : val;
      });
    }
    // Sub-block minutes
    bt.subBandMinutes = bt.subBandMinutes || {};
    const subSection = document.querySelector(`#sub-section-${btId}`);
    if (subSection) {
      subSection.querySelectorAll('.sub-row').forEach(srow => {
        const subId = srow.dataset.subId;
        const sub   = (bt.subBlocks || []).find(s => s.id === subId);
        const snEl  = srow.querySelector('.sub-name-input');
        if (sub && snEl) sub.name = snEl.value.trim() || sub.name;
        if (!bt.subBandMinutes[subId]) bt.subBandMinutes[subId] = {};
        srow.querySelectorAll('.sub-min-input').forEach(inp => {
          const val = parseInt(inp.value, 10);
          bt.subBandMinutes[subId][inp.dataset.bandId] = isNaN(val) ? 0 : val;
        });
      });
    }
    // For blocks with sub-blocks, derive bandMinutes from sub sums.
    // Only update bandMinutes when the user has actually entered sub-block values
    // (subSum > 0). Leaving bandMinutes unchanged when all subs are 0 preserves
    // any legacy total already stored, so ELA isn't silently zeroed out just
    // because the sub-block rows haven't been filled in yet.
    if ((bt.subBlocks || []).length > 0) {
      bt.bandMinutes = bt.bandMinutes || {};
      (SchedState.school.gradeBands || []).forEach(band => {
        const subSum = (bt.subBlocks || []).reduce((sum, sub) =>
          sum + ((bt.subBandMinutes[sub.id] || {})[band.id] || 0), 0);
        if (subSum > 0) bt.bandMinutes[band.id] = subSum;
      });
    }
    // Split session settings (only for blocks without sub-blocks).
    // The split controls live in a sibling <tr id="req-split-row-{btId}">, not
    // inside the .req-row, so query by id rather than from row.
    if (!(bt.subBlocks || []).length) {
      bt.splitAllowed    = bt.splitAllowed    || {};
      bt.splitMinMinutes = bt.splitMinMinutes || {};
      const splitRow = document.getElementById(`req-split-row-${btId}`);
      if (splitRow) {
        splitRow.querySelectorAll('.split-allowed-input').forEach(inp => {
          bt.splitAllowed[inp.dataset.bandId] = inp.checked;
        });
        splitRow.querySelectorAll('.split-min-input').forEach(inp => {
          const val = parseInt(inp.value, 10);
          bt.splitMinMinutes[inp.dataset.bandId] = isNaN(val) ? 15 : Math.max(5, val);
        });
      }
    }
  });
}

function renderBandRow(band) {
  return `
    <div class="band-row" data-band-id="${band.id}">
      <input type="text" class="band-name-input input" placeholder="Band name (e.g. K-1)" value="${escHtml(band.name)}">
      <div class="band-grade-chips">
        ${gradesSorted().map(g => `<span class="grade-chip-xs ${band.grades.includes(g) ? 'active' : ''}" data-grade="${g}" data-band-id="${band.id}">${gradeChipLabel(g)}</span>`).join('')}
      </div>
      <button class="btn-icon remove-band-btn" data-band-id="${band.id}" title="Remove band">×</button>
    </div>
  `;
}

function renderSubTable(bt, bands) {
  const subs = bt.subBlocks || [];
  return `
    <div class="sub-block-section" id="sub-section-${bt.id}">
      <table class="sub-table">
        <thead><tr>
          <th class="sub-th-name">Sub-block</th>
          ${bands.map(b => `<th class="sub-th-min">${escHtml(b.name)}</th>`).join('')}
          <th></th>
        </tr></thead>
        <tbody>
          ${subs.map(sub => `
            <tr class="sub-row" data-sub-id="${sub.id}" data-parent-id="${bt.id}">
              <td><input type="text" class="sub-name-input" value="${escHtml(sub.name)}" placeholder="Sub-block name"></td>
              ${bands.map(b => `<td><input type="number" class="sub-min-input" data-sub-id="${sub.id}" data-band-id="${b.id}" data-parent-id="${bt.id}" min="0" max="300" step="5" value="${((bt.subBandMinutes || {})[sub.id] || {})[b.id] || 0}"></td>`).join('')}
              <td><button class="btn-icon del-sub-btn" data-parent-id="${bt.id}" data-sub-id="${sub.id}" title="Remove">×</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <button class="btn btn-sm btn-outline add-sub-btn" data-parent-id="${bt.id}">+ Add Sub-block</button>
    </div>
  `;
}

function renderReqRow(bt, bands) {
  const hasSubs = (bt.subBlocks || []).length > 0;
  const anySplitEnabled = !hasSubs && Object.values(bt.splitAllowed || {}).some(Boolean);
  return `
    <tr class="req-row" data-bt-id="${bt.id}">
      <td><input type="text" class="req-name-input" value="${escHtml(bt.name)}" placeholder="Block name"></td>
      <td class="req-td-color">
        <span class="req-color-swatch" style="background:${bt.color}"></span>
        <input type="color" class="req-color-input" value="${bt.color}">
      </td>
      ${bands.map(b => {
        if (hasSubs) {
          const total = (bt.subBlocks || []).reduce((sum, sub) =>
            sum + (((bt.subBandMinutes || {})[sub.id] || {})[b.id] || 0), 0);
          return `<td class="req-td-min req-td-calc"><span class="req-calc-total" data-bt-id="${bt.id}" data-band-id="${b.id}">${total}</span><span class="req-calc-hint">auto</span></td>`;
        }
        return `<td class="req-td-min"><input type="number" class="req-min-input" data-bt-id="${bt.id}" data-band-id="${b.id}" min="0" max="360" step="5" value="${(bt.bandMinutes || {})[b.id] || 0}"></td>`;
      }).join('')}
      <td class="req-td-actions">
        <button class="btn-sm req-sub-toggle" data-bt-id="${bt.id}">${hasSubs ? `Sub-blocks (${bt.subBlocks.length})` : 'Sub-blocks'}</button>
        ${!hasSubs ? `<button class="btn-sm req-split-toggle${anySplitEnabled ? ' req-split-active' : ''}" data-bt-id="${bt.id}" title="Configure split sessions">Split</button>` : ''}
        <button class="btn-icon req-delete-btn" data-bt-id="${bt.id}" title="Remove block">×</button>
      </td>
    </tr>
    <tr class="req-sub-row ${hasSubs ? '' : 'hidden'}" data-parent-id="${bt.id}" id="req-sub-row-${bt.id}">
      <td></td>
      <td></td>
      <td colspan="${bands.length + 1}" class="req-sub-td">${renderSubTable(bt, bands)}</td>
    </tr>
    ${!hasSubs ? `
    <tr class="req-split-row${anySplitEnabled ? '' : ' hidden'}" id="req-split-row-${bt.id}">
      <td colspan="2" class="req-split-label">
        ⚡ Split Sessions
        <span class="form-hint-sm">If no single gap fits, the algorithm places 2 chunks summing to the required minutes.</span>
      </td>
      ${bands.map(b => `
        <td class="req-split-td">
          <label class="split-check-label">
            <input type="checkbox" class="split-allowed-input" data-bt-id="${bt.id}" data-band-id="${b.id}"
                   ${(bt.splitAllowed || {})[b.id] ? 'checked' : ''}>
            Allow split
          </label>
          <div class="split-min-wrap${(bt.splitAllowed || {})[b.id] ? '' : ' hidden'}">
            <span class="form-hint-sm">Min:</span>
            <input type="number" class="split-min-input" data-bt-id="${bt.id}" data-band-id="${b.id}"
                   min="5" step="5" max="180" value="${(bt.splitMinMinutes || {})[b.id] || 15}">
            <span class="form-hint-sm">min</span>
          </div>
        </td>`).join('')}
      <td></td>
    </tr>` : ''}
  `;
}

function renderBlocks() {
  const s       = SchedState.school;
  const bands   = s.gradeBands || [];
  const reqBTs  = SchedState.blockTypes.filter(bt => bt.required && bt.id !== 'bt_spec');
  const otherBTs = SchedState.blockTypes.filter(bt => !bt.required);
  const configuredSpecials = s.specials && s.specials.length ? s.specials : [];
  const catOrder = ['instruction','sel','specials','intervention','behavior','transition','admin'];

  document.getElementById('view-blocks').innerHTML = `
    <div class="view-header">
      <h1>Block Types &amp; Requirements</h1>
      <p class="view-subtitle">Define grade bands and set required instructional minutes per block. These blocks will auto-fill into the Master Schedule.</p>
    </div>

    <div class="form-section">
      <h2 class="form-section-title">Grade Bands</h2>
      <p class="form-hint">Group grades that share the same instructional time requirements.</p>
      <div id="bands-list">
        ${bands.length ? bands.map(renderBandRow).join('') : '<p class="text-muted" style="margin:0 0 12px">No bands yet — add one to start.</p>'}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <button class="btn btn-outline btn-sm" id="add-band-btn">+ Add Band</button>
        ${bands.length ? '<button class="btn btn-primary btn-sm" id="refresh-req-btn">Update Requirements Table →</button>' : ''}
      </div>
    </div>

    <div class="form-section">
      <h2 class="form-section-title">Specials</h2>
      <p class="form-hint">Colors are used on the master schedule. Name and duration come from the Specials step — <a href="#" data-nav="specials" class="link-inline">edit there</a>.</p>
      ${configuredSpecials.length ? `
      <div class="specials-color-list">
        ${configuredSpecials.map((sp, i) => `
          <div class="specials-color-row" data-sp-id="${sp.id}">
            <input type="color" class="sp-color-input-bt" value="${sp.color || SP_DEFAULT_COLORS[i % SP_DEFAULT_COLORS.length]}" title="Block color">
            <span class="specials-color-name">${escHtml(sp.name)}</span>
            <span class="specials-color-detail">${sp.duration || 45} min · ${sp.classesPerWeek || 1}×/wk</span>
          </div>`).join('')}
      </div>` : `<p class="text-muted">No specials configured yet — <a href="#" data-nav="specials" class="link-inline">set them up in the Specials step</a>.</p>`}
    </div>

    <div class="form-section">
      <h2 class="form-section-title">Uniform Block Types</h2>
      <p class="form-hint">Blocks with one fixed duration for all grade levels. Set a school-wide time to auto-place the block at the same time for every grade.</p>
      <div id="add-block-form" class="inline-form hidden"></div>
      <div class="req-table-wrap">
        <table class="req-table">
          <thead><tr>
            <th class="req-th-block">Block</th>
            <th class="req-th-color">Color</th>
            <th class="req-th-band" style="width:110px">Min/Day<span class="req-th-hint">optional</span></th>
            <th class="req-th-band" style="min-width:160px">School-wide Time<span class="req-th-hint">all grades</span></th>
            <th class="req-th-actions" style="width:80px"></th>
          </tr></thead>
          <tbody>
            ${otherBTs.map(bt => {
              const hasUniform = bt.uniformStart && bt.uniformEnd;
              const uniformLabel = hasUniform ? `${fmtTime12(bt.uniformStart)} – ${fmtTime12(bt.uniformEnd)}` : '';
              const isTimeModeOrDefault = !bt.uniformMode || bt.uniformMode === 'time';
              return `
              <tr>
                <td class="req-td-block" style="display:table-cell;align-items:unset">
                  <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${bt.color};margin-right:6px;vertical-align:middle"></span>
                  ${escHtml(bt.name)}
                </td>
                <td class="req-td-color">
                  <div class="req-color-swatch" style="background:${bt.color}"></div>
                  <input type="color" class="req-color-input uniform-color-input" value="${bt.color}" data-bt-id="${bt.id}" />
                </td>
                <td class="req-td-min">
                  <input type="number" class="uniform-dur-input" value="${bt.defaultDuration || ''}"
                         placeholder="—" min="5" step="5" data-bt-id="${bt.id}" />
                </td>
                <td class="req-td-schoolwide">
                  <div class="schoolwide-config" id="sw-config-${bt.id}">
                    <div class="sw-mode-row">
                      <label class="sw-radio-label">
                        <input type="radio" name="sw-mode-${bt.id}" class="sw-mode-radio" value="time"
                               data-bt-id="${bt.id}" ${isTimeModeOrDefault ? 'checked' : ''}> Fixed
                      </label>
                      <span class="sw-time-inputs" id="sw-time-${bt.id}" ${!isTimeModeOrDefault ? 'style="display:none"' : ''}>
                        <input type="time" class="sw-start-input" value="${bt.uniformStart || ''}" data-bt-id="${bt.id}" />
                        <span class="sw-sep">–</span>
                        <input type="time" class="sw-end-input"   value="${bt.uniformEnd   || ''}" data-bt-id="${bt.id}" />
                      </span>
                      <label class="sw-radio-label" style="margin-left:8px">
                        <input type="radio" name="sw-mode-${bt.id}" class="sw-mode-radio" value="duration"
                               data-bt-id="${bt.id}" ${bt.uniformMode === 'duration' ? 'checked' : ''}> Auto
                      </label>
                      <span class="sw-dur-inputs" id="sw-dur-${bt.id}" ${bt.uniformMode !== 'duration' ? 'style="display:none"' : ''}>
                        <input type="number" class="sw-mins-input" value="${bt.uniformMinutes || ''}"
                               data-bt-id="${bt.id}" placeholder="min" min="5" step="5" style="width:56px" />
                        <button class="btn btn-sm btn-outline sw-find-btn" data-bt-id="${bt.id}">Find</button>
                      </span>
                    </div>
                    ${hasUniform || bt.uniformMode === 'duration' ? `<div class="sw-action-row"><button class="btn btn-sm btn-ghost sw-clear-btn" data-bt-id="${bt.id}">Clear</button></div>` : ''}
                  </div>
                </td>
                <td class="req-td-actions" style="display:table-cell;white-space:nowrap">
                  <button class="icon-btn edit-block-btn" data-id="${bt.id}" title="Edit">✏️</button>
                  <button class="icon-btn remove-block-btn" data-id="${bt.id}" title="Remove">×</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <button class="btn btn-outline btn-sm mt-8" id="add-block-btn">+ Add Block Type</button>
    </div>

    <div class="form-section">
      <h2 class="form-section-title">Instructional Time Requirements</h2>
      <p class="form-hint">Required daily minutes per block, per grade band. Click "Sub-blocks" to define timed components within a block.</p>
      ${bands.length === 0 ? '<p class="text-muted">Add grade bands above first.</p>' : `
      <div class="req-table-wrap">
        <table class="req-table">
          <thead><tr>
            <th class="req-th-block">Block</th>
            <th class="req-th-color">Color</th>
            ${bands.map(b => `<th class="req-th-band">${escHtml(b.name)}<span class="req-th-hint">min/day</span></th>`).join('')}
            <th class="req-th-actions"></th>
          </tr></thead>
          <tbody id="req-tbody">
            ${reqBTs.map(bt => renderReqRow(bt, bands)).join('')}
          </tbody>
        </table>
      </div>
      <button class="btn btn-outline btn-sm mt-8" id="add-req-btn">+ Add Required Block</button>
      `}
    </div>

    ${bands.length ? `
    <div class="form-section">
      <h2 class="form-section-title">Daily Minutes Budget</h2>
      <p class="form-hint">Required instructional minutes vs. time available after fixed blocks (morning meeting, lunch, recess).</p>
      <div id="budget-panel"></div>
    </div>` : ''}

    <div class="view-actions">
      <button class="btn btn-outline" id="blocks-back-btn">← Back to Specials</button>
      <button class="btn btn-primary" id="blocks-next-btn">Save &amp; Continue to Master Schedule →</button>
      <div class="save-status" id="blocks-save-status"></div>
    </div>
  `;

  wireBandsSection();
  wireReqTable();
  wireOtherBlocks();

  document.querySelectorAll('.sp-color-input-bt').forEach(input => {
    input.addEventListener('input', () => {
      const spId = input.closest('.specials-color-row').dataset.spId;
      const sp   = (SchedState.school.specials || []).find(s => s.id === spId);
      if (sp) { sp.color = input.value; saveToLocal(); }
    });
  });

  document.getElementById('blocks-back-btn').addEventListener('click', () => { navigateTo('specials'); renderSpecialsView(); });
  document.getElementById('blocks-next-btn').addEventListener('click', saveBlocksAndContinue);

  renderBudgetPanel();
}

// ── Minutes budget computation (shared by Block Types view, pre-entry gate, School Info) ──

// Returns array of { band, required, available, fixed } per grade band.
// `required` = sum of configured bandMinutes for all required blocks.
// `available` = school day length minus fixed blocks (morning meeting, lunch, recess).
// `fixed` = breakdown of what was subtracted.
function computeMinutesBudget() {
  const s     = SchedState.school;
  const bands = s.gradeBands || [];
  const fbMins  = timeToMins(s.firstBell || s.dayStart || '08:00');
  const disMins = timeToMins(s.dismissal  || s.dayEnd   || '14:30');
  const dayTotal = disMins - fbMins;

  // Morning meeting minutes
  const btMM = SchedState.blockTypes.find(bt => bt.id === 'bt_mm');
  let mmMins = 0;
  if (btMM?.uniformStart && btMM?.uniformEnd) {
    mmMins = timeToMins(btMM.uniformEnd) - timeToMins(btMM.uniformStart);
  } else {
    (s.morningMeetings || []).forEach(m => {
      if (m.start && m.end) mmMins += timeToMins(m.end) - timeToMins(m.start);
    });
  }

  const recessMap = typeof computeRecessTimes === 'function' ? computeRecessTimes(s) : {};

  return bands.map(band => {
    const repGrade = (band.grades || [])[0];

    // Lunch minutes for representative grade
    const lp = repGrade
      ? ((s.lunchPeriods || []).find(p => (p.grades || []).includes(repGrade))
      || (s.lunchPeriods || []).find(p => !(p.grades || []).length)
      || (s.lunchPeriods || [])[0])
      : (s.lunchPeriods || [])[0];
    const lunchMins = lp ? Number(lp.duration) : 0;

    // Recess minutes for representative grade
    const recessMins = repGrade
      ? (recessMap[repGrade] || []).reduce((sum, r) => sum + Number(r.duration), 0)
      : 0;

    const fixed     = mmMins + lunchMins + recessMins;
    const available = Math.max(0, dayTotal - fixed);

    // Required = sum of all required blocks' bandMinutes for this band
    const required = SchedState.blockTypes
      .filter(bt => bt.required)
      .reduce((sum, bt) => {
        if (bt.subBlocks && bt.subBlocks.length && bt.subBandMinutes) {
          const subSum = (bt.subBlocks || []).reduce((s2, sub) =>
            s2 + (((bt.subBandMinutes[sub.id] || {})[band.id]) || 0), 0);
          return sum + (subSum > 0 ? subSum : ((bt.bandMinutes || {})[band.id] || 0));
        }
        return sum + ((bt.bandMinutes || {})[band.id] || 0);
      }, 0);

    return { band, required, available, fixed, dayTotal, mmMins, lunchMins, recessMins };
  });
}

function renderBudgetPanel() {
  const panel = document.getElementById('budget-panel');
  if (!panel) return;
  const budget = computeMinutesBudget();
  if (!budget.length) { panel.innerHTML = ''; return; }

  panel.innerHTML = budget.map(({ band, required, available, mmMins, lunchMins, recessMins, dayTotal }) => {
    const over    = required - available;
    const pct     = available > 0 ? Math.round((required / available) * 100) : 0;
    const cls     = over > 0 ? 'budget-over' : (over > -15 ? 'budget-tight' : 'budget-ok');
    const label   = over > 0 ? `Over by ${over} min` : (over === 0 ? 'Exactly full' : `${-over} min free`);
    const barPct  = Math.min(pct, 100);
    const barOver = over > 0 ? Math.min(Math.round((over / available) * 100), 50) : 0;

    return `
      <div class="budget-band">
        <div class="budget-band-name">${escHtml(band.name)}</div>
        <div class="budget-bar-wrap">
          <div class="budget-bar-fill ${cls}" style="width:${barPct}%"></div>
          ${barOver ? `<div class="budget-bar-over" style="width:${barOver}%"></div>` : ''}
        </div>
        <div class="budget-nums">
          <span class="budget-req ${cls}">${required} min required</span>
          <span class="budget-avail">of ${available} min available
            <span class="budget-hint">(${dayTotal} day − ${mmMins} mtg − ${lunchMins} lunch − ${recessMins} recess)</span>
          </span>
          <span class="budget-label ${cls}">${label}</span>
        </div>
      </div>`;
  }).join('');
}

// ── Band section wiring ───────────────────────────────────────────────────────
function wireBandsSection() {
  document.querySelectorAll('.band-row .grade-chip-xs').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('active'));
  });

  document.querySelectorAll('.remove-band-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      collectBandsFromDOM();
      collectReqFromDOM();
      SchedState.school.gradeBands = (SchedState.school.gradeBands || []).filter(b => b.id !== btn.dataset.bandId);
      saveToLocal();
      renderBlocks();
    });
  });

  const addBtn = document.getElementById('add-band-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      collectBandsFromDOM();
      collectReqFromDOM();
      if (!SchedState.school.gradeBands) SchedState.school.gradeBands = [];
      SchedState.school.gradeBands.push({ id: uid(), name: '', grades: [] });
      saveToLocal();
      renderBlocks();
    });
  }

  const refreshBtn = document.getElementById('refresh-req-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      collectBandsFromDOM();
      collectReqFromDOM();
      saveToLocal();
      renderBlocks();
      // After re-render: scroll to table, flash it, and confirm via button text
      setTimeout(() => {
        const wrap = document.querySelector('.req-table-wrap');
        const btn  = document.getElementById('refresh-req-btn');
        if (wrap) {
          wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          wrap.classList.add('req-table-flash');
          setTimeout(() => wrap.classList.remove('req-table-flash'), 1200);
        }
        if (btn) {
          btn.textContent = '✓ Table Updated';
          btn.classList.add('btn-success-flash');
          setTimeout(() => {
            btn.textContent = 'Update Requirements Table →';
            btn.classList.remove('btn-success-flash');
          }, 2000);
        }
      }, 50);
    });
  }
}

// ── Requirements table wiring ─────────────────────────────────────────────────
function wireReqTable() {
  // Color swatch live update
  document.querySelectorAll('.req-color-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const swatch = inp.closest('.req-td-color')?.querySelector('.req-color-swatch');
      if (swatch) swatch.style.background = inp.value;
    });
  });

  // Sub-block minutes → live-update calculated totals + budget panel
  document.querySelectorAll('.sub-min-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const { parentId, bandId } = inp.dataset;
      const sum = [...document.querySelectorAll(`.sub-min-input[data-parent-id="${parentId}"][data-band-id="${bandId}"]`)]
        .reduce((s, el) => s + (parseInt(el.value, 10) || 0), 0);
      const el = document.querySelector(`.req-calc-total[data-bt-id="${parentId}"][data-band-id="${bandId}"]`);
      if (el) el.textContent = sum;
      collectReqFromDOM();
      renderBudgetPanel();
    });
  });

  // Required block minutes → live-update budget panel
  document.querySelectorAll('.req-min-input').forEach(inp => {
    inp.addEventListener('input', () => { collectReqFromDOM(); renderBudgetPanel(); });
  });

  // Toggle sub-block section
  document.querySelectorAll('.req-sub-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(`req-sub-row-${btn.dataset.btId}`);
      if (row) row.classList.toggle('hidden');
    });
  });

  // Toggle split session section
  document.querySelectorAll('.req-split-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = document.getElementById(`req-split-row-${btn.dataset.btId}`);
      if (row) row.classList.toggle('hidden');
    });
  });

  // Split checkbox → show/hide min input
  document.querySelectorAll('.split-allowed-input').forEach(inp => {
    inp.addEventListener('change', function() {
      const wrap = this.closest('.req-split-td')?.querySelector('.split-min-wrap');
      if (wrap) wrap.classList.toggle('hidden', !this.checked);
    });
  });

  // Delete required block
  document.querySelectorAll('.req-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      collectBandsFromDOM();
      collectReqFromDOM();
      SchedState.blockTypes = SchedState.blockTypes.filter(b => b.id !== btn.dataset.btId);
      saveToLocal();
      renderBlocks();
    });
  });

  // Add new required block
  const addReqBtn = document.getElementById('add-req-btn');
  if (addReqBtn) {
    addReqBtn.addEventListener('click', () => {
      collectBandsFromDOM();
      collectReqFromDOM();
      SchedState.blockTypes.push({
        id: uid(), name: 'New Block', color: '#6366f1', category: 'instruction',
        required: true, subBlocks: [], bandMinutes: {}, subBandMinutes: {},
      });
      saveToLocal();
      renderBlocks();
    });
  }

  // Add sub-block
  document.querySelectorAll('.add-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      collectBandsFromDOM();
      collectReqFromDOM();
      const parentId = btn.dataset.parentId;
      const bt = SchedState.blockTypes.find(b => b.id === parentId);
      if (!bt) return;
      if (!bt.subBlocks) bt.subBlocks = [];
      const subId = uid();
      bt.subBlocks.push({ id: subId, name: 'New Sub-block' });
      if (!bt.subBandMinutes) bt.subBandMinutes = {};
      bt.subBandMinutes[subId] = {};
      saveToLocal();
      renderBlocks();
    });
  });

  // Delete sub-block
  document.querySelectorAll('.del-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      collectBandsFromDOM();
      collectReqFromDOM();
      const { parentId, subId } = btn.dataset;
      const bt = SchedState.blockTypes.find(b => b.id === parentId);
      if (!bt) return;
      bt.subBlocks = (bt.subBlocks || []).filter(s => s.id !== subId);
      if (bt.subBandMinutes) delete bt.subBandMinutes[subId];
      saveToLocal();
      renderBlocks();
    });
  });
}

// ── Uniform blocks wiring ─────────────────────────────────────────────────────
function wireOtherBlocks() {
  document.querySelectorAll('.remove-block-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SchedState.blockTypes = SchedState.blockTypes.filter(b => b.id !== btn.dataset.id);
      saveToLocal();
      renderBlocks();
    });
  });
  document.querySelectorAll('.edit-block-btn').forEach(btn => {
    btn.addEventListener('click', () => showOtherBlockForm(btn.dataset.id));
  });
  const addBtn = document.getElementById('add-block-btn');
  if (addBtn) addBtn.addEventListener('click', () => showOtherBlockForm());

  // Inline duration editing
  document.querySelectorAll('.uniform-dur-input').forEach(inp => {
    inp.addEventListener('change', () => {
      const bt = SchedState.blockTypes.find(b => b.id === inp.dataset.btId);
      if (!bt) return;
      const val = parseInt(inp.value, 10);
      if (isNaN(val) || val < 5) { delete bt.defaultDuration; } else { bt.defaultDuration = val; }
      saveToLocal();
    });
  });

  // School-wide time mode radios
  document.querySelectorAll('.sw-mode-radio').forEach(radio => {
    radio.addEventListener('change', () => {
      const id = radio.dataset.btId;
      const isTime = radio.value === 'time';
      document.getElementById(`sw-time-${id}`)?.style.setProperty('display', isTime ? '' : 'none');
      document.getElementById(`sw-dur-${id}`)?.style.setProperty('display', isTime ? 'none' : '');
    });
  });


  // Clear school-wide time
  document.querySelectorAll('.sw-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const bt = SchedState.blockTypes.find(b => b.id === btn.dataset.btId);
      if (!bt) return;
      delete bt.uniformStart;
      delete bt.uniformEnd;
      delete bt.uniformMinutes;
      delete bt.uniformMode;
      preFillFixedBlocks();
      saveToLocal();
      renderBlocks();
    });
  });

  // Auto-find: scan master schedule for a common free window across all grades
  document.querySelectorAll('.sw-find-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.btId;
      const bt   = SchedState.blockTypes.find(b => b.id === id);
      if (!bt) return;
      const mins = parseInt(document.querySelector(`.sw-mins-input[data-bt-id="${id}"]`)?.value || '0', 10);
      if (!mins || mins < 5) { alert('Enter a duration first.'); return; }
      const result = _findUniformSlot(mins);
      if (!result) {
        alert('No common free window found across all grades for that duration. Try shortening the duration or clearing some blocks first.');
        return;
      }
      bt.uniformMode  = 'time';
      bt.uniformStart = result.start;
      bt.uniformEnd   = result.end;
      delete bt.uniformMinutes;
      preFillFixedBlocks();
      saveToLocal();
      renderBlocks();
    });
  });

  // Inline color editing
  document.querySelectorAll('.uniform-color-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const bt = SchedState.blockTypes.find(b => b.id === inp.dataset.btId);
      if (!bt) return;
      const swatch = inp.closest('tr')?.querySelector('.req-color-swatch');
      if (swatch) swatch.style.background = inp.value;
      const dot = inp.closest('tr')?.querySelector('td:first-child span');
      if (dot) dot.style.background = inp.value;
    });
    inp.addEventListener('change', () => {
      const bt = SchedState.blockTypes.find(b => b.id === inp.dataset.btId);
      if (!bt) return;
      bt.color = inp.value;
      saveToLocal();
    });
  });
}

function showOtherBlockForm(existingId) {
  const existing = existingId ? SchedState.blockTypes.find(b => b.id === existingId) : null;
  const form = document.getElementById('add-block-form');
  form.classList.remove('hidden');
  form.innerHTML = `
    <div class="inline-form-grid">
      <div class="form-group">
        <label class="form-label">Block Name</label>
        <input type="text" class="input" id="bf-name" placeholder="e.g. Advisory" value="${escHtml(existing?.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select class="input" id="bf-category">
          ${Object.entries(BLOCK_CATEGORIES).map(([val, label]) =>
            `<option value="${val}" ${(existing?.category || 'admin') === val ? 'selected' : ''}>${label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Duration (min)</label>
        <input type="number" class="input" id="bf-duration" placeholder="e.g. 30" min="5" step="5" value="${existing?.defaultDuration || ''}" />
      </div>
      <div class="form-group form-group-color">
        <label class="form-label">Color</label>
        <div class="color-palette" id="bf-color-palette">
          ${STAFF_COLOR_PALETTE.map(c => `
            <button type="button" class="color-dot ${(existing?.color || '#a855f7') === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></button>
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
  document.getElementById('bf-cancel-btn').addEventListener('click', () => { form.classList.add('hidden'); form.innerHTML = ''; });
  document.getElementById('bf-save-btn').addEventListener('click', () => {
    const name = document.getElementById('bf-name').value.trim();
    if (!name) { document.getElementById('bf-name').focus(); return; }
    const durVal = parseInt(document.getElementById('bf-duration').value, 10);
    const block = {
      id:       existing?.id || uid(),
      name,
      category: document.getElementById('bf-category').value,
      color:    document.querySelector('#bf-color-palette .color-dot.selected')?.dataset.color || '#a855f7',
      required: false,
      ...(durVal >= 5 ? { defaultDuration: durVal } : {}),
    };
    if (existing) {
      const idx = SchedState.blockTypes.findIndex(b => b.id === existingId);
      SchedState.blockTypes[idx] = Object.assign({}, existing, block);
    } else {
      SchedState.blockTypes.push(block);
    }
    form.classList.add('hidden');
    form.innerHTML = '';
    saveToLocal();
    renderBlocks();
  });
}

function collectUniformFromDOM() {
  SchedState.blockTypes.filter(bt => !bt.required).forEach(bt => {
    const modeEl = document.querySelector(`input[name="sw-mode-${bt.id}"]:checked`);
    if (!modeEl) return;
    const mode = modeEl.value;
    if (mode === 'time') {
      const start = document.querySelector(`.sw-start-input[data-bt-id="${bt.id}"]`)?.value;
      const end   = document.querySelector(`.sw-end-input[data-bt-id="${bt.id}"]`)?.value;
      if (start && end) {
        bt.uniformMode  = 'time';
        bt.uniformStart = start;
        bt.uniformEnd   = end;
        delete bt.uniformMinutes;
      }
    } else {
      const mins = parseInt(document.querySelector(`.sw-mins-input[data-bt-id="${bt.id}"]`)?.value || '0', 10);
      if (mins >= 5) {
        bt.uniformMode    = 'duration';
        bt.uniformMinutes = mins;
        bt.uniformStart   = '';
        bt.uniformEnd     = '';
      }
    }
    const dur = parseInt(document.querySelector(`.uniform-dur-input[data-bt-id="${bt.id}"]`)?.value || '0', 10);
    if (dur >= 5) bt.defaultDuration = dur;
  });
}

function saveBlocksAndContinue() {
  collectBandsFromDOM();
  collectReqFromDOM();
  collectUniformFromDOM();
  preFillFixedBlocks();
  saveToLocal();
  updateSidebarStatus();
  navigateTo('master');
  renderMasterSchedule();
  fillMissingRequirements();
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
          <div class="review-row"><span class="review-label">Arrival</span><span class="review-value">${fmtTime12(s.studentCampusStart || s.dayStart || '07:45')}</span></div>
          <div class="review-row"><span class="review-label">First Bell</span><span class="review-value">${fmtTime12(s.firstBell || '08:00')}</span></div>
          <div class="review-row"><span class="review-label">Dismissal</span><span class="review-value">${fmtTime12(s.dismissal || s.dayEnd || '14:30')}</span></div>
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
                    ${members.map(m => `<span class="review-staff-chip"${m.role === 'ia' ? ` style="border-left: 3px solid ${m.color}"` : ''}>${m.name}</span>`).join('')}
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

    <div class="view-actions">
      <button class="btn btn-outline" id="review-back-btn">← Back</button>
      <button class="btn btn-primary btn-lg" id="review-save-btn">Save Setup</button>
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
}

function finalSave() {
  saveToLocal();
  updateSidebarStatus();
  const btn = document.getElementById('review-save-btn');
  btn.textContent = 'Saved ✓';
  btn.disabled = true;
  if (typeof trackEvent === 'function') {
    trackEvent('schedule_setup_complete', { school: SchedState.school.name, staffCount: SchedState.staff.length });
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
