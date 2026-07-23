// ── Specials Schedule view feature ──────────────────────────────────────────
// Extracted from schedule-grid.js (monolith split, see docs/monolith-split-plan.md).
// Loaded after schedule-grid.js — shares its global scope (classic scripts, no
// build step). The specials SCHEDULING ALGORITHM (buildSpecialsSchedule,
// findGradeFixedTime, rotation, getSpecialsAtSlot, buildSpecialsCell) stays in
// core — this file is the view/UI layer only. printScheduleGrid is a shared
// print utility used by multiple views (master grid, IA, class schedules) and
// intentionally stays in core rather than living in any one feature file.

// ── Specials coverage validation ──────────────────────────────────────────────

// Returns per-class coverage info: actual placed sessions vs. required cpw per special.
function getSpecialsCoverageReport() {
  const specials = SchedState.school.specials || [];
  if (!specials.length) return { classes: [], hasIssues: false };

  const ss = SchedState.specialsSchedule || {};
  const classReports = [];

  gradesSorted().forEach(grade => {
    const classes = getClassesForGrade(grade);
    if (!classes.length) return;

    classes.forEach(cls => {
      const actual  = ss[cls.id] || {};
      const missing = [];
      let expectedTotal = 0;
      let actualTotal   = 0;

      specials.forEach(sp => {
        const needed = Math.min(sp.classesPerWeek || 1, 5);
        const placed = DAYS.filter(d => actual[d]?.subjectId === sp.id && actual[d]?.teacherId).length;
        expectedTotal += needed;
        actualTotal   += placed;
        if (placed < needed) {
          missing.push({
            subjectId: sp.id,
            subjectName: sp.name,
            color: sp.color || '#f97316',
            needed, placed,
            short: needed - placed,
          });
        }
      });

      classReports.push({
        grade, gradeLabel: GRADE_LABELS[grade] || grade,
        classId: cls.id, className: cls.name,
        expectedCount: expectedTotal,
        actualCount:   actualTotal,
        missing,
        complete: missing.length === 0,
      });
    });
  });

  return { classes: classReports, hasIssues: classReports.some(r => !r.complete) };
}

function showSpecialsCoverageBanner() {
  const existing = document.getElementById('specials-coverage-banner');
  if (existing) existing.remove();

  const { classes, hasIssues } = getSpecialsCoverageReport();
  if (!hasIssues) return;

  const incomplete = classes.filter(r => !r.complete);
  const byGrade = {};
  incomplete.forEach(r => {
    if (!byGrade[r.grade]) byGrade[r.grade] = { gradeLabel: r.gradeLabel, classes: [] };
    byGrade[r.grade].classes.push(r);
  });

  const list = Object.values(byGrade).map(g => {
    const items = g.classes.map(c => {
      const missing = c.missing.map(m =>
        `${m.subjectName} (${m.placed}/${m.needed})`
      ).join(', ');
      return `${escHtml(c.className)} — missing ${escHtml(missing)}`;
    }).join('; ');
    return `<li><strong>${escHtml(g.gradeLabel)}:</strong> ${items}</li>`;
  }).join('');

  const banner = document.createElement('div');
  banner.id = 'specials-coverage-banner';
  banner.className = 'setup-banner setup-banner-error';
  banner.innerHTML =
    `<div><strong>⚠ Incomplete specials coverage (${incomplete.length} class${incomplete.length !== 1 ? 'es' : ''}):</strong> ` +
    `Some classes are missing specials sessions — a teacher was already booked or no free slot could be found on that day.` +
    `<ul style="margin:4px 0 0 16px;padding:0">${list}</ul>` +
    `<div style="font-size:12px;color:#991b1b;margin-top:4px">` +
    `Try freeing up schedule space around the specials block, or check teacher availability in the Specials tab.` +
    `</div></div>`;

  _mountWarning(banner);
}


// ── Specials Schedule View ────────────────────────────────────────────────────

const specialsSchedUI = { selectedTeacherId: null, coverageCollapsed: false };

function renderSpecialsScheduleView() {
  const container = document.getElementById('view-specials-sched');
  if (!container) return;

  const specials  = SchedState.school.specials || [];
  const teacherIds = [...new Set(specials.flatMap(sp => sp.teacherIds || []))];
  const teachers  = teacherIds.map(id => SchedState.staff.find(s => s.id === id)).filter(Boolean);

  if (!specials.length || !teachers.length) {
    container.innerHTML = `
      <div class="view-header"><h1>Specials Schedule</h1></div>
      <div class="empty-state">
        <div class="empty-icon">🎨</div>
        <p>${!specials.length ? 'No specials configured yet.' : 'No teachers assigned to specials yet.'} Set up specials and assign teachers in the Specials tab.</p>
        <button class="btn btn-primary mt-16" data-nav="specials">Go to Specials Setup →</button>
      </div>`;
    return;
  }

  if (!specialsSchedUI.selectedTeacherId || !teachers.find(t => t.id === specialsSchedUI.selectedTeacherId)) {
    specialsSchedUI.selectedTeacherId = teachers[0].id;
  }

  const teacherSubjects = specials.filter(sp => (sp.teacherIds || []).includes(specialsSchedUI.selectedTeacherId));
  const { classes: coverageClasses, hasIssues } = getSpecialsCoverageReport();
  const incomplete = coverageClasses.filter(r => !r.complete);

  let coverageHtml = '';
  if (coverageClasses.length) {
    const total    = coverageClasses.length;
    const complete = coverageClasses.filter(r => r.complete).length;
    const statusClass = hasIssues ? 'coverage-status-warn' : 'coverage-status-ok';
    const statusLabel = hasIssues
      ? `${incomplete.length} of ${total} class${total !== 1 ? 'es' : ''} incomplete`
      : `All ${total} class${total !== 1 ? 'es' : ''} fully scheduled ✓`;

    let detailRows = '';
    if (hasIssues) {
      // Group by grade for the detail table
      const gradesSeen = [...new Set(coverageClasses.map(c => c.grade))];
      detailRows = gradesSeen.map(grade => {
        const gradeClasses = coverageClasses.filter(c => c.grade === grade);
        return gradeClasses.map((c, i) => `
          <tr>
            ${i === 0 ? `<td class="cov-grade" rowspan="${gradeClasses.length}">${escHtml(c.gradeLabel)}</td>` : ''}
            <td class="cov-class">${escHtml(c.className)}</td>
            <td class="cov-status">
              ${c.complete
                ? '<span class="cov-ok">✓</span>'
                : `<span class="cov-warn">⚠ Missing: ${c.missing.map(m =>
                    `<span style="color:${m.color}">${escHtml(m.subjectName)}</span> ${m.placed}/${m.needed}`
                  ).join(', ')}</span>`}
            </td>
          </tr>`).join('');
      }).join('');
    }

    // Only the detail table is collapsible, so the panel is only interactive when
    // there are issues (and thus a detail table to hide).
    const collapsible = hasIssues;
    const collapsed   = collapsible && specialsSchedUI.coverageCollapsed;
    coverageHtml = `
      <div class="coverage-panel${collapsible ? ' collapsible' : ''}${collapsed ? ' collapsed' : ''}">
        <div class="coverage-panel-header"${collapsible ? ' id="coverage-toggle" role="button" tabindex="0" aria-expanded="' + (!collapsed) + '"' : ''}>
          ${collapsible ? '<span class="coverage-caret">▾</span>' : ''}
          <span class="coverage-panel-title">Coverage</span>
          <span class="coverage-status ${statusClass}">${statusLabel}</span>
          ${hasIssues ? `<span class="coverage-hint">Check teacher availability or free up schedule space</span>` : ''}
        </div>
        ${hasIssues ? `
          <div class="coverage-detail">
            <table class="cov-table">
              <thead><tr><th>Grade</th><th>Class</th><th>Status</th></tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </div>` : ''}
      </div>`;
  }

  container.innerHTML = `
    <div class="master-shell">
      <div class="grid-side">
        <div class="grid-top-bar">
          <div>
            <h1 class="grid-title">Specials Schedule</h1>
            <p class="grid-subtitle">Week-at-a-glance by specials teacher</p>
          </div>
        </div>

        ${coverageHtml}

        <div class="specials-teacher-bar">
          ${teachers.map(t => {
            const tSubjs = specials.filter(sp => (sp.teacherIds || []).includes(t.id));
            const color  = tSubjs[0]?.color || '#f97316';
            const active = t.id === specialsSchedUI.selectedTeacherId;
            return `<button class="teacher-chip${active ? ' active' : ''}" data-teacher-id="${t.id}"
              style="${active ? `background:${color}18;border-color:${color};color:${color}` : ''}">
              <span class="teacher-chip-dot" style="background:${color}"></span>
              ${escHtml(t.name)}
            </button>`;
          }).join('')}
        </div>

        ${teacherSubjects.length ? `
          <div class="specials-teacher-meta">
            Teaches:
            ${teacherSubjects.map(sp =>
              `<span class="specials-subject-tag" style="color:${sp.color};background:${sp.color}18;border-color:${sp.color}40">${escHtml(sp.name)}</span>`
            ).join('')}
          </div>` : ''}

        <div class="grid-scroll-wrap">
          ${buildSpecialsTeacherGrid(specialsSchedUI.selectedTeacherId)}
        </div>

        <div class="grid-footer">
          <button class="btn btn-outline" id="specials-sched-back-btn">← Back to Building Schedule</button>
          <button class="btn btn-outline" id="specials-sched-print-btn">Print</button>
          <button class="btn btn-primary btn-lg" id="specials-sched-next-btn">Continue to Class Schedules →</button>
        </div>
      </div>
    </div>`;

  container.querySelector('#specials-sched-back-btn').addEventListener('click', () => {
    navigateTo('master'); renderMasterSchedule();
  });
  container.querySelector('#specials-sched-next-btn').addEventListener('click', () => {
    navigateTo('class-sched'); renderClassSchedulesView();
  });
  container.querySelector('#specials-sched-print-btn').addEventListener('click', () => {
    const teacher = SchedState.staff.find(t => t.id === specialsSchedUI.selectedTeacherId);
    const table   = container.querySelector('.grid-scroll-wrap .sched-table');
    if (table) printScheduleGrid(
      `${teacher?.name || 'Specials'} — Weekly Schedule`,
      SchedState.school.name || '',
      table
    );
  });
  container.querySelectorAll('.teacher-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      specialsSchedUI.selectedTeacherId = chip.dataset.teacherId;
      renderSpecialsScheduleView();
    });
  });

  // Collapse/expand the coverage detail table
  const coverageToggle = container.querySelector('#coverage-toggle');
  if (coverageToggle) {
    const toggle = () => {
      specialsSchedUI.coverageCollapsed = !specialsSchedUI.coverageCollapsed;
      container.querySelector('.coverage-panel')
        ?.classList.toggle('collapsed', specialsSchedUI.coverageCollapsed);
      coverageToggle.setAttribute('aria-expanded', String(!specialsSchedUI.coverageCollapsed));
    };
    coverageToggle.addEventListener('click', toggle);
    coverageToggle.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }

  // Click a filled cell to open the specials override panel
  container.querySelector('.grid-scroll-wrap')?.addEventListener('click', e => {
    const cell  = e.target.closest('.grid-cell.filled');
    if (!cell) return;
    const clsId = cell.dataset.clsId;
    const day   = cell.dataset.day;
    if (!clsId || !day) return;
    const entry = (SchedState.specialsSchedule[clsId] || {})[day];
    if (!entry) return;
    openSpecialsOverridePanel(cell, clsId, day, entry);
  });
}


// IA assignment edit / delete moved to schedule-ia.js
// ── Specials individual override ─────────────────────────────────────────────

function openSpecialsOverridePanel(anchorCell, clsId, day, entry) {
  document.getElementById('specials-override-panel')?.remove();

  const specials = SchedState.school.specials || [];
  const sp  = specials.find(s => s.id === entry.subjectId);
  const cls = (SchedState.staff || []).find(s => s.id === clsId);
  const gradeLabel = GRADE_LABELS[cls?.gradeAssignment] || cls?.gradeAssignment || '';

  const teacherOptions = (sp?.teacherIds || []).map(tid => {
    const t = (SchedState.staff || []).find(s => s.id === tid);
    return t ? `<option value="${escHtml(tid)}"${tid === entry.teacherId ? ' selected' : ''}>${escHtml(t.name)}</option>` : '';
  }).join('');

  const dayOptions = DAYS.map(d =>
    `<option value="${d}"${d === day ? ' selected' : ''}>${d}</option>`
  ).join('');

  const sc = SchedState.school;
  const schoolSlots = generateTimeSlots(
    sc.firstBell || sc.studentCampusStart || sc.dayStart || '08:00',
    sc.dismissal || sc.lastBell || sc.dayEnd || '14:30'
  );
  const timeOptions = schoolSlots.map(s =>
    `<option value="${s}"${s === entry.startTime ? ' selected' : ''}>${fmtTime12(s)}</option>`
  ).join('');

  const panel = document.createElement('div');
  panel.id = 'specials-override-panel';
  panel.className = 'override-panel';
  panel.innerHTML = `
    <div class="override-panel-header">
      <span class="override-panel-title">Edit ${escHtml(sp?.name || 'Specials')} · ${escHtml(cls?.name || gradeLabel)}</span>
      <button class="override-panel-close" id="sp-override-close">&#x2715;</button>
    </div>
    <div class="override-panel-body">
      <div class="override-field-row">
        <label class="override-label">Day</label>
        <select id="sp-override-day" class="override-select">${dayOptions}</select>
      </div>
      <div class="override-field-row">
        <label class="override-label">Start time</label>
        <select id="sp-override-time" class="override-select">${timeOptions}</select>
      </div>
      ${teacherOptions ? `<div class="override-field-row">
        <label class="override-label">Teacher</label>
        <select id="sp-override-teacher" class="override-select"><option value="">— same teacher —</option>${teacherOptions}</select>
      </div>` : ''}
      <div class="override-actions">
        <button class="btn btn-primary btn-sm" id="sp-override-save">Save</button>
        <button class="btn btn-outline btn-sm" id="sp-override-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  const rect = anchorCell.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let top  = rect.bottom + window.scrollY + 4;
  let left = rect.left  + window.scrollX;
  // After append, getBoundingClientRect won't reflect final size — use rough estimate
  if (left + 300 > vw) left = Math.max(8, vw - 308);
  if (rect.bottom + 260 > vh) top = rect.top + window.scrollY - 264;
  panel.style.top  = top  + 'px';
  panel.style.left = left + 'px';

  document.getElementById('sp-override-close')?.addEventListener('click', () => panel.remove());
  document.getElementById('sp-override-cancel')?.addEventListener('click', () => panel.remove());
  document.getElementById('sp-override-save')?.addEventListener('click', () => {
    const newDay     = document.getElementById('sp-override-day').value;
    const newTime    = document.getElementById('sp-override-time').value;
    const newTeacher = document.getElementById('sp-override-teacher')?.value || entry.teacherId;
    panel.remove();
    applySpecialsOverride(clsId, day, newDay, newTime, newTeacher || entry.teacherId);
  });
}

function applySpecialsOverride(clsId, oldDay, newDay, newStartTime, newTeacherId) {
  pushUndoSnapshot();
  const oldEntry = (SchedState.specialsSchedule[clsId] || {})[oldDay];
  if (!oldEntry) return;

  const specials  = SchedState.school.specials || [];
  const sp        = specials.find(s => s.id === oldEntry.subjectId);
  const dur       = sp?.duration || 45;
  const subjectId = oldEntry.subjectId;
  const numSlots  = Math.ceil(dur / 5);

  const cls   = (SchedState.staff || []).find(s => s.id === clsId && s.role === 'classroom_teacher');
  const grade = cls?.gradeAssignment;
  if (!grade) return;

  // Update specialsSchedule
  delete SchedState.specialsSchedule[clsId][oldDay];
  if (!SchedState.specialsSchedule[clsId]) SchedState.specialsSchedule[clsId] = {};
  SchedState.specialsSchedule[clsId][newDay] = { subjectId, teacherId: newTeacherId, startTime: newStartTime };

  // Sync masterSchedule — old day: only clear bt_spec slots if no other class in grade still has specials there
  const gradeClasses  = getClassesForGrade(grade);
  const oldDaySlots   = _autoFillSlots(oldDay);
  const oldStartIdx   = oldDaySlots.indexOf(oldEntry.startTime);
  if (oldStartIdx >= 0 && SchedState.masterSchedule[oldDay]?.[grade]) {
    for (let i = 0; i < numSlots && oldStartIdx + i < oldDaySlots.length; i++) {
      const sl = oldDaySlots[oldStartIdx + i];
      const othersHere = gradeClasses.filter(c =>
        c.id !== clsId &&
        (SchedState.specialsSchedule[c.id] || {})[oldDay]?.startTime === oldEntry.startTime
      );
      if (!othersHere.length) {
        const sv = SchedState.masterSchedule[oldDay][grade][sl];
        if (sv === 'bt_spec' || (sv && sv.startsWith('bt_spec|'))) {
          delete SchedState.masterSchedule[oldDay][grade][sl];
        }
      }
    }
  }

  // Sync masterSchedule — new day: write bt_spec
  if (!SchedState.masterSchedule[newDay]) SchedState.masterSchedule[newDay] = {};
  if (!SchedState.masterSchedule[newDay][grade]) SchedState.masterSchedule[newDay][grade] = {};
  const newDaySlots = _autoFillSlots(newDay);
  const newStartIdx = newDaySlots.indexOf(newStartTime);
  if (newStartIdx >= 0) {
    for (let i = 0; i < numSlots && newStartIdx + i < newDaySlots.length; i++) {
      placeBlock(newDay, grade, newDaySlots[newStartIdx + i], 'bt_spec');
    }
  }

  _checkAndSurfaceSpecialsConflicts(newDay, grade, newStartTime,
    [{ subjectId, teacherId: newTeacherId, duration: dur }]);
  showConflictBanner();
  saveToLocal();
  renderSpecialsScheduleView();
}

function buildSpecialsTeacherGrid(teacherId) {
  const sc      = SchedState.school;
  const specials = sc.specials || [];
  const ss      = SchedState.specialsSchedule || {};

  // slotMap[day][slot] = { grade, gradeLabel, classLabel, subjectId, subjectName, color, isStart, duration, startTime }
  const slotMap = {};
  DAYS.forEach(day => { slotMap[day] = {}; });

  // 1. From specialsSchedule (grades WITH classroom teachers)
  Object.entries(ss).forEach(([classId, days]) => {
    const staff = SchedState.staff.find(s => s.id === classId);
    const grade = staff?.gradeAssignment;
    DAYS.forEach(day => {
      const entry = days[day];
      if (!entry || entry.teacherId !== teacherId) return;
      const sp  = specials.find(s => s.id === entry.subjectId);
      const dur = sp?.duration || 45;
      const color = sp?.color || '#f97316';
      const numSlots = Math.ceil(dur / 5);
      const daySlots = _autoFillSlots(day);
      const startIdx = daySlots.indexOf(entry.startTime);
      if (startIdx < 0) return;
      for (let j = 0; j < numSlots && startIdx + j < daySlots.length; j++) {
        const sl = daySlots[startIdx + j];
        if (!slotMap[day][sl]) {
          slotMap[day][sl] = {
            grade,
            gradeLabel: GRADE_LABELS[grade] || grade,
            classLabel: staff?.name || '',
            classId,
            subjectId:   entry.subjectId,
            subjectName: sp?.name || 'Specials',
            color,
            isStart:   j === 0,
            duration:  dur,
            startTime: entry.startTime,
          };
        }
      }
    });
  });

  // 2. From masterSchedule (grades WITHOUT classroom teachers)
  gradesSorted().forEach(grade => {
    if (getClassesForGrade(grade).length > 0) return;
    DAYS.forEach(day => {
      const sched    = SchedState.masterSchedule[day]?.[grade];
      if (!sched) return;
      const daySlots = _autoFillSlots(day);
      daySlots.forEach((sl, idx) => {
        const v = sched[sl];
        if (!v || !v.startsWith('bt_spec|')) return;
        const spId = v.split('|')[1];
        const sp   = specials.find(s => s.id === spId);
        if (!(sp?.teacherIds || []).includes(teacherId)) return;
        const prevSl = idx > 0 ? daySlots[idx - 1] : null;
        const isStart = !prevSl || sched[prevSl] !== v;
        let startTime = sl;
        if (!isStart && prevSl && slotMap[day][prevSl]) startTime = slotMap[day][prevSl].startTime;
        slotMap[day][sl] = {
          grade,
          gradeLabel:  GRADE_LABELS[grade] || grade,
          classLabel:  '',
          subjectId:   spId,
          subjectName: sp?.name || 'Specials',
          color:       sp?.color || '#f97316',
          isStart,
          duration:    sp?.duration || 45,
          startTime,
        };
      });
    });
  });

  // Determine visible time range — specials block extents ± 15 min padding
  const cands = [sc.firstBell, sc.studentCampusStart, sc.dayStart].filter(t => t && /^\d\d:\d\d/.test(t));
  const fb    = cands.length ? cands.reduce((a, b) => a < b ? a : b) : '07:30';
  let minMins = Infinity, maxMins = 0, hasAny = false;
  DAYS.forEach(day => {
    Object.entries(slotMap[day]).forEach(([sl, entry]) => {
      hasAny = true;
      const m = timeToMins(sl);
      if (m < minMins) minMins = m;
      const endM = entry.isStart ? m + entry.duration : m + 5;
      if (endM > maxMins) maxMins = endM;
    });
  });

  if (!hasAny) {
    return `<div style="padding:48px 24px;text-align:center;color:#64748b">
      No classes scheduled for this teacher yet.<br>
      Auto-fill the building schedule to generate specials assignments.
    </div>`;
  }

  const displayStart = minsToTime(Math.max(minMins - 15, timeToMins(fb)));
  const displayEnd   = minsToTime(maxMins + 15);
  const slots = generateTimeSlots(displayStart, displayEnd);

  const headCols = DAYS.map(d => `<th class="th-grade">${d.slice(0, 3)}</th>`).join('');

  const rows = slots.map((slot, i) => {
    const [, m] = slot.split(':').map(Number);
    const showLabel = m % 10 === 0;
    const isMajor   = m === 0;

    const cells = DAYS.map(day => {
      const entry = slotMap[day][slot];
      if (!entry) return `<td class="grid-cell" data-time="${slot}"></td>`;

      const prevSlot  = i > 0 ? slots[i - 1] : null;
      const prevEntry = prevSlot ? slotMap[day][prevSlot] : null;
      const isCont    = !!(prevEntry && prevEntry.subjectId === entry.subjectId && prevEntry.grade === entry.grade && prevEntry.startTime === entry.startTime);
      const nextSlot  = i < slots.length - 1 ? slots[i + 1] : null;
      const nextEntry = nextSlot ? slotMap[day][nextSlot] : null;
      const isEnd     = !(nextEntry && nextEntry.subjectId === entry.subjectId && nextEntry.grade === entry.grade && nextEntry.startTime === entry.startTime);
      const c = entry.color;
      const borderTop    = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${c};`;
      const borderBottom = isEnd  ? `border-bottom:2px solid ${c};`     : '';
      const style = `background:${c}18;border-left:3px solid ${c};${borderTop}${borderBottom}`;

      let inner = '';
      if (!isCont) {
        const endSlot = minsToTime(timeToMins(slot) + entry.duration);
        const classLine = entry.classLabel
          ? `${escHtml(entry.gradeLabel)} · ${escHtml(entry.classLabel)}`
          : escHtml(entry.gradeLabel);
        inner = `<span class="cell-label" style="color:${c}">
          ${escHtml(entry.subjectName)}
          <span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(endSlot)} · ${entry.duration} min</span>
          <span class="cell-specials-subject">${classLine}</span>
        </span>`;
      }

      return `<td class="grid-cell filled${isCont ? ' cont' : ''}"
          data-time="${slot}" data-day="${day}"
          data-cls-id="${entry.classId || ''}"
          data-start-time="${entry.startTime}"
          data-subject-id="${entry.subjectId || ''}"
          style="${style}">${inner}</td>`;
    }).join('');

    return `<tr class="sched-row${isMajor ? ' row-hour' : ''}" data-time="${slot}">
      <td class="td-time${showLabel ? '' : ' td-time-minor'}">${showLabel ? fmtTime(slot) : ''}</td>
      ${cells}
    </tr>`;
  }).join('');

  return `<table class="sched-table" cellspacing="0">
    <thead><tr class="sched-head-row">
      <th class="th-time"></th>${headCols}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

