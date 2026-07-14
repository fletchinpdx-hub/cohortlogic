// ── Class Schedules view feature ────────────────────────────────────────────
// Extracted from schedule-grid.js (monolith split, see docs/monolith-split-plan.md).
// Loaded after schedule-specials-view.js — shares its global scope (classic
// scripts, no build step). printScheduleGrid (shared print utility used by
// core, IA, and the specials view too) intentionally stays in schedule-grid.js.

const classSchedUI = {
  selectedGrade:   null,
  selectedClassId: null,
  viewMode:        'single',   // 'single' | 'compare'
  compareDay:      'Monday',
};

function renderClassSchedulesView() {
  const container = document.getElementById('view-class-sched');
  if (!container) return;

  const grades = gradesSorted();
  if (!grades.length || !Object.keys(SchedState.masterSchedule || {}).length) {
    container.innerHTML = `
      <div class="view-header"><h1>Class Schedules</h1></div>
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <p>Build the master schedule first, then return here to view individual class schedules.</p>
        <button class="btn btn-primary mt-16" data-nav="master">Go to Master Schedule →</button>
      </div>`;
    return;
  }

  if (!classSchedUI.selectedGrade || !grades.includes(classSchedUI.selectedGrade)) {
    classSchedUI.selectedGrade = grades[0];
  }
  const grade   = classSchedUI.selectedGrade;
  const classes = getClassesForGrade(grade);

  if (classes.length && (!classSchedUI.selectedClassId || !classes.find(c => c.id === classSchedUI.selectedClassId))) {
    classSchedUI.selectedClassId = classes[0]?.id || null;
  }

  const gradePills = grades.map(g => {
    const label  = GRADE_LABELS[g] || g;
    const active = g === grade;
    return `<button class="cls-grade-pill${active ? ' active' : ''}" data-grade="${escHtml(g)}">${escHtml(label)}</button>`;
  }).join('');

  const modeToggle = `
    <div class="cls-mode-toggle">
      <button class="cls-mode-btn${classSchedUI.viewMode === 'single'  ? ' active' : ''}" data-mode="single">Single Class</button>
      <button class="cls-mode-btn${classSchedUI.viewMode === 'compare' ? ' active' : ''}" data-mode="compare">Compare Grade</button>
    </div>`;

  let contentHtml = '';
  if (classSchedUI.viewMode === 'single') {
    const classPills = classes.length
      ? classes.map(cls => {
          const active = cls.id === classSchedUI.selectedClassId;
          return `<button class="cls-class-pill${active ? ' active' : ''}" data-class-id="${escHtml(cls.id)}">${escHtml(cls.name)}</button>`;
        }).join('')
      : `<span class="cls-no-classes">No classroom teachers for this grade</span>`;

    const gridHtml = classes.length && classSchedUI.selectedClassId
      ? buildClassWeekGrid(classSchedUI.selectedClassId, grade)
      : `<div style="padding:32px 24px;color:var(--gray-400)">No classroom teachers assigned to this grade.</div>`;

    contentHtml = `
      <div class="cls-class-bar">${classPills}</div>
      <div class="grid-scroll-wrap">${gridHtml}</div>`;
  } else {
    const dayTabs = DAYS.map(d => {
      const active = d === classSchedUI.compareDay;
      return `<button class="cls-day-tab${active ? ' active' : ''}" data-day="${d}">${d.slice(0, 3)}</button>`;
    }).join('');

    const compareHtml = classes.length
      ? buildGradeCompareGrid(grade, classSchedUI.compareDay)
      : `<div style="padding:32px 24px;color:var(--gray-400)">No classroom teachers assigned to this grade.</div>`;

    contentHtml = `
      <div class="cls-day-bar">${dayTabs}</div>
      <div class="grid-scroll-wrap">${compareHtml}</div>`;
  }

  container.innerHTML = `
    <div class="master-shell">
      <div class="grid-side">
        <div class="grid-top-bar">
          <div>
            <h1 class="grid-title">Class Schedules</h1>
            <p class="grid-subtitle">Full weekly schedule by class</p>
          </div>
        </div>
        <div class="cls-controls">
          <div class="cls-grade-bar">${gradePills}</div>
          ${modeToggle}
        </div>
        ${contentHtml}
        <div class="grid-footer">
          <button class="btn btn-outline" id="class-sched-back-btn">← Back to Master Schedule</button>
          <button class="btn btn-outline" id="class-sched-print-btn">Print</button>
          <button class="btn btn-primary btn-lg" id="class-sched-next-btn">Continue to IA Schedules →</button>
        </div>
      </div>
    </div>`;

  container.querySelector('#class-sched-back-btn').addEventListener('click', () => {
    navigateTo('master'); renderMasterSchedule();
  });
  container.querySelector('#class-sched-next-btn').addEventListener('click', () => {
    navigateTo('ia'); renderIAScheduleView();
  });
  container.querySelector('#class-sched-print-btn').addEventListener('click', () => {
    const table = container.querySelector('.grid-scroll-wrap .sched-table');
    if (!table) return;
    const gradeLabel = GRADE_LABELS[classSchedUI.selectedGrade] || classSchedUI.selectedGrade || '';
    let title;
    if (classSchedUI.viewMode === 'compare') {
      title = `${gradeLabel} — ${classSchedUI.compareDay} — Class Comparison`;
    } else {
      const cls = SchedState.staff.find(s => s.id === classSchedUI.selectedClassId);
      title = `${gradeLabel}${cls ? ` — ${cls.name}` : ''} — Class Schedule`;
    }
    printScheduleGrid(title, SchedState.school.name || '', table);
  });
  container.querySelectorAll('.cls-grade-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      classSchedUI.selectedGrade   = btn.dataset.grade;
      classSchedUI.selectedClassId = null;
      renderClassSchedulesView();
    });
  });
  container.querySelectorAll('.cls-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      classSchedUI.viewMode = btn.dataset.mode;
      renderClassSchedulesView();
    });
  });
  container.querySelectorAll('.cls-class-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      classSchedUI.selectedClassId = btn.dataset.classId;
      renderClassSchedulesView();
    });
  });
  container.querySelectorAll('.cls-day-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      classSchedUI.compareDay = btn.dataset.day;
      renderClassSchedulesView();
    });
  });
}

// buildSpecialsTeacherGrid moved to schedule-specials-view.js
// ── Class Schedules view helpers ──────────────────────────────────────────────

// Returns display data for one slot in a class's schedule, or null if empty.
function getClassSlotEntry(slot, grade, day, classId) {
  const btId = SchedState.masterSchedule[day]?.[grade]?.[slot];
  if (!btId) return null;

  if (btId.startsWith('bt_spec')) {
    const ss = SchedState.specialsSchedule?.[classId]?.[day];
    const daySlots = _autoFillSlots(day);
    const slotIdx  = daySlots.indexOf(slot);

    // Does THIS class's special cover this slot? If so, render the real special.
    if (ss?.startTime) {
      const specials = SchedState.school.specials || [];
      const sp       = specials.find(s => s.id === ss.subjectId);
      const teacher  = SchedState.staff.find(t => t.id === ss.teacherId);
      const dur      = sp?.duration || 45;
      const startIdx = daySlots.indexOf(ss.startTime);
      if (startIdx >= 0 && slotIdx >= startIdx && slotIdx < startIdx + Math.ceil(dur / 5)) {
        return {
          btId, isSpecials: true,
          subjectName: sp?.name || 'Specials',
          teacherName: teacher ? teacher.name.split(' ')[0] : '',
          color:       sp?.color || '#f97316',
          duration:    dur, slotIdx, startIdx,
        };
      }
    }

    // The grade is on specials here, but THIS class's session is at a different
    // time (or not this day). Render a muted "specials period" placeholder — the
    // class isn't deleted, its own special shows at its own time. Points to that
    // time when known so the connection is obvious.
    const elsewhere = ss?.startTime && ss.startTime !== slot ? ss.startTime : null;
    return {
      btId, isSpecials: false, isSpecialsHole: true,
      displayName: elsewhere ? `Specials · at ${fmtTime12(elsewhere)}` : 'Specials period',
      color: '#94a3b8',
    };
  }

  const pid = btId.includes('|') ? btId.split('|')[0] : btId;
  const sub = btId.includes('|') ? btId.split('|')[1] : null;
  const bt  = SchedState.blockTypes.find(b => b.id === pid);
  if (!bt) return null;

  let displayName = bt.name;
  if (sub) {
    if (pid === 'bt_mm') {
      const mm = (SchedState.school.morningMeetings || []).find(m => m.id === sub);
      displayName = mm?.name || bt.name;
    } else if (pid !== 'bt_lunch' && pid !== 'bt_recess') {
      const sb = (bt.subBlocks || []).find(s => s.id === sub);
      displayName = sb ? `${bt.name} – ${sb.name}` : bt.name;
    }
  }

  return { btId, isSpecials: false, displayName, color: bt.color || '#6b7280' };
}

// Renders one td for the class schedule views.
function buildClassScheduleCell(slot, grade, day, classId, prevSlot, nextSlot) {
  const entry     = getClassSlotEntry(slot, grade, day, classId);
  const prevEntry = prevSlot ? getClassSlotEntry(prevSlot, grade, day, classId) : null;
  const nextEntry = nextSlot ? getClassSlotEntry(nextSlot, grade, day, classId) : null;

  if (!entry) return `<td class="grid-cell cls-gap" data-time="${slot}"></td>`;

  let isCont, isEnd;
  if (entry.isSpecials) {
    isCont = entry.slotIdx > entry.startIdx;
    isEnd  = entry.slotIdx === entry.startIdx + Math.ceil(entry.duration / 5) - 1;
  } else {
    isCont = !!(prevEntry && !prevEntry.isSpecials && prevEntry.btId === entry.btId);
    isEnd  = !(nextEntry && !nextEntry.isSpecials && nextEntry.btId === entry.btId);
  }

  const c            = entry.color;
  const borderTop    = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${c};`;
  const borderBottom = isEnd  ? `border-bottom:2px solid ${c};`     : '';
  const style        = `background:${c}18;border-left:3px solid ${c};${borderTop}${borderBottom}`;

  let inner = '';
  if (!isCont) {
    if (entry.isSpecials) {
      const endSlot = minsToTime(timeToMins(slot) + entry.duration);
      inner = `<span class="cell-label" style="color:${c}">${escHtml(entry.subjectName)}` +
        `<span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(endSlot)} · ${entry.duration} min</span>` +
        `<span class="cell-specials-subject">${escHtml(entry.teacherName)}</span>` +
        `<span class="cell-ia-name"></span>` +
        `</span>`;
    } else {
      const daySlots = _autoFillSlots(day);
      let dur = 5, j = daySlots.indexOf(slot) + 1;
      while (j < daySlots.length) {
        const ne = getClassSlotEntry(daySlots[j], grade, day, classId);
        if (ne && !ne.isSpecials && ne.btId === entry.btId) { dur += 5; j++; } else break;
      }
      const endSlot = minsToTime(timeToMins(slot) + dur);
      inner = `<span class="cell-label" style="color:${c}">${escHtml(entry.displayName)}` +
        `<span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(endSlot)} · ${dur} min</span>` +
        `</span>`;
    }
  }

  const holeCls = entry.isSpecialsHole ? ' cls-specials-hole' : '';
  return `<td class="grid-cell filled${isCont ? ' cont' : ''}${holeCls}" data-time="${slot}" style="${style}">${inner}</td>`;
}

// Week-at-a-glance for a single class (all 5 days, all block types).
function buildClassWeekGrid(classId, grade) {
  const sc       = SchedState.school;
  const cands    = [sc.firstBell, sc.studentCampusStart, sc.dayStart].filter(t => t && /^\d\d:\d\d/.test(t));
  const dayStart = cands.length ? cands.reduce((a, b) => a < b ? a : b) : '07:30';
  const dayEnd   = DAYS.reduce((mx, d) => { const dis = getDismissalForDay(d) || '14:30'; return dis > mx ? dis : mx; }, '14:30');
  const slots    = generateTimeSlots(dayStart, dayEnd);
  const headCols = DAYS.map(d => `<th class="th-grade">${d.slice(0, 3)}</th>`).join('');

  const rows = slots.map((slot, i) => {
    const [, m]    = slot.split(':').map(Number);
    const showLabel = m % 10 === 0;
    const isMajor   = m === 0;
    const prevSlot  = i > 0 ? slots[i - 1] : null;
    const nextSlot  = i < slots.length - 1 ? slots[i + 1] : null;
    const cells = DAYS.map(day => buildClassScheduleCell(slot, grade, day, classId, prevSlot, nextSlot)).join('');
    return `<tr class="sched-row${isMajor ? ' row-hour' : ''}" data-time="${slot}">
      <td class="td-time${showLabel ? '' : ' td-time-minor'}">${showLabel ? fmtTime(slot) : ''}</td>
      ${cells}
    </tr>`;
  }).join('');

  const cls        = SchedState.staff.find(s => s.id === classId);
  const gradeLabel = GRADE_LABELS[grade] || grade;
  const clsName    = cls?.name || '';
  return `<div class="cls-grid-heading">${escHtml(gradeLabel)}${clsName ? ` — ${escHtml(clsName)}` : ''}</div>
    <table class="sched-table" cellspacing="0">
      <thead><tr class="sched-head-row"><th class="th-time"></th>${headCols}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// Single-day comparison grid for all classes in a grade.
function buildGradeCompareGrid(grade, day) {
  const classes = getClassesForGrade(grade);
  if (!classes.length) return `<div style="padding:32px 24px;color:var(--gray-400)">No classroom teachers assigned to this grade.</div>`;

  const sc       = SchedState.school;
  const cands    = [sc.firstBell, sc.studentCampusStart, sc.dayStart].filter(t => t && /^\d\d:\d\d/.test(t));
  const dayStart = cands.length ? cands.reduce((a, b) => a < b ? a : b) : '07:30';
  const dayEnd   = getDismissalForDay(day) || '14:30';
  const slots    = generateTimeSlots(dayStart, dayEnd);
  const headCols = classes.map(cls => `<th class="th-grade cls-compare-th">${escHtml(cls.name)}</th>`).join('');

  const rows = slots.map((slot, i) => {
    const [, m]    = slot.split(':').map(Number);
    const showLabel = m % 10 === 0;
    const isMajor   = m === 0;
    const prevSlot  = i > 0 ? slots[i - 1] : null;
    const nextSlot  = i < slots.length - 1 ? slots[i + 1] : null;
    const cells = classes.map(cls => buildClassScheduleCell(slot, grade, day, cls.id, prevSlot, nextSlot)).join('');
    return `<tr class="sched-row${isMajor ? ' row-hour' : ''}" data-time="${slot}">
      <td class="td-time${showLabel ? '' : ' td-time-minor'}">${showLabel ? fmtTime(slot) : ''}</td>
      ${cells}
    </tr>`;
  }).join('');

  const gradeLabel = GRADE_LABELS[grade] || grade;
  return `<div class="cls-grid-heading">${escHtml(gradeLabel)} — ${escHtml(day)}</div>
    <table class="sched-table" cellspacing="0">
      <thead><tr class="sched-head-row"><th class="th-time"></th>${headCols}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

