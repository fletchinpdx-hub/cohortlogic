// ── IA Schedule feature ─────────────────────────────────────────────────────
// Extracted from schedule-grid.js (monolith split, see docs/monolith-split-plan.md).
// Loaded after schedule-grid.js — shares its global scope (classic scripts, no
// build step). IA assignment is automatic (Place IAs on the IA Assignment tab);
// this tab views + edits the result. The old master-grid "Assign IAs" mode was
// removed in the IA rework.

// ── IA Schedule ───────────────────────────────────────────────────────────────

const iaSchedUI = {
  activeAllocId: null,
  activeDay:     'Monday',
  targetType:    'grade',   // 'grade' | 'class'
  targetId:      null,      // grade key or classId
  viewMode:      'grid',    // 'grid' | 'all'
  focusedIAId:   null,
};
const iaDrag = { active: false, allocId: null, targetType: null, targetId: null };

// State for IA assignment mode in the master schedule
function getIAHoursUsed(allocId) {
  let count = 0;
  const ias = SchedState.iaSchedule || {};
  DAYS.forEach(day => {
    const dayMap = ias[day] || {};
    Object.values(dayMap).forEach(iaSlots => {
      Object.values(iaSlots).forEach(entry => {
        if (entry && entry.allocId === allocId) count++;
      });
    });
  });
  return count * 5 / 60;
}

function getIASummaryForIA(iaId) {
  const byAlloc = {};
  let total = 0;
  DAYS.forEach(day => {
    const iaSlots = (SchedState.iaSchedule[day] || {})[iaId] || {};
    Object.values(iaSlots).forEach(entry => {
      if (!entry?.allocId) return;
      byAlloc[entry.allocId] = (byAlloc[entry.allocId] || 0) + 5 / 60;
      total += 5 / 60;
    });
  });
  // Include standalone duty blocks
  (SchedState.duties || []).forEach(duty => {
    if (!(duty.iaIds || []).includes(iaId)) return;
    const durationMin = timeToMins(duty.endTime) - timeToMins(duty.startTime);
    if (durationMin <= 0) return;
    const hrs = durationMin / 60;
    (duty.days || []).forEach(() => {
      if (duty.allocId) byAlloc[duty.allocId] = (byAlloc[duty.allocId] || 0) + hrs;
      total += hrs;
    });
  });
  return { byAlloc, total };
}

function _migrateIASchedule() {
  DAYS.forEach(day => {
    Object.values(SchedState.iaSchedule[day] || {}).forEach(iaSlots => {
      Object.keys(iaSlots).forEach(slot => {
        const entry = iaSlots[slot];
        if (entry && entry.grade !== undefined && entry.targetType === undefined) {
          entry.targetType = 'grade';
          entry.targetId   = entry.grade || '';
          delete entry.grade;
          delete entry.activity;
        }
      });
    });
  });
}

// Detailed placement-issue list for the IA Schedule tab, from the last Place IAs
// run (SchedState._iaPlacementReport). Groups the raw report into readable lines.
// Session-only — the report isn't persisted, so it clears on reload/re-place.
function _iaPlacementIssuesHtml() {
  const rep = SchedState._iaPlacementReport;
  if (!rep) return '';
  const total = rep.shortfalls.length + rep.inconsistencies.length + rep.overBudget.length + rep.ownLunchUnplaced.length;
  if (!total) return '';

  const dayShort   = d => d.slice(0, 3);
  const blockLabel = (blockId, subId) => getBtName(subId ? blockId + '|' + subId : blockId);
  const gradeLabel = g => GRADE_LABELS[g] || g;
  const iaName     = id => (SchedState.staff.find(s => s.id === id) || {}).name || 'IA';
  const allocName  = id => (SchedState.iaAllocations.find(a => a.id === id) || {}).name || 'category';
  const sections = [];

  if (rep.shortfalls.length) {
    const g = {};
    rep.shortfalls.forEach(s => {
      const k = `${s.grade}|${s.blockId}|${s.subId || ''}`;
      g[k] = g[k] || { grade: s.grade, blockId: s.blockId, subId: s.subId, days: [], needed: s.needed, placed: s.placed };
      g[k].days.push(s.day); g[k].placed = Math.min(g[k].placed, s.placed);
    });
    const items = Object.values(g).map(x =>
      `<li><strong>${escHtml(gradeLabel(x.grade))} · ${escHtml(blockLabel(x.blockId, x.subId))}</strong> — short ${x.days.map(dayShort).join(', ')} (${x.needed} needed, ${x.placed} placed)</li>`).join('');
    sections.push(`<div class="ia-issues-sec"><div class="ia-issues-h">Coverage gaps — not enough available IAs</div><ul>${items}</ul></div>`);
  }
  if (rep.inconsistencies.length) {
    const items = rep.inconsistencies.map(i =>
      `<li><strong>${escHtml(gradeLabel(i.grade))} · ${escHtml(blockLabel(i.blockId, i.subId))}</strong> — covered by ${i.iasUsed} different IAs across the week (${i.need} wanted)</li>`).join('');
    sections.push(`<div class="ia-issues-sec"><div class="ia-issues-h">Different IAs on different days</div><ul>${items}</ul></div>`);
  }
  if (rep.overBudget.length) {
    const g = {};
    rep.overBudget.forEach(o => { g[o.allocId] = g[o.allocId] || { days: [], usedMin: 0, budgetMin: o.budgetMin }; g[o.allocId].days.push(o.day); g[o.allocId].usedMin = Math.max(g[o.allocId].usedMin, o.usedMin); });
    const items = Object.entries(g).map(([id, x]) =>
      `<li><strong>${escHtml(allocName(id))}</strong> over budget ${x.days.map(dayShort).join(', ')} (up to ${x.usedMin} min/day vs ${x.budgetMin} min budget)</li>`).join('');
    sections.push(`<div class="ia-issues-sec"><div class="ia-issues-h">Over budget</div><ul>${items}</ul></div>`);
  }
  if (rep.ownLunchUnplaced.length) {
    const g = {};
    rep.ownLunchUnplaced.forEach(o => { (g[o.iaId] = g[o.iaId] || []).push(o.day); });
    const items = Object.entries(g).map(([id, days]) =>
      `<li><strong>${escHtml(iaName(id))}</strong> — own lunch couldn't fit: ${days.map(dayShort).join(', ')}</li>`).join('');
    sections.push(`<div class="ia-issues-sec"><div class="ia-issues-h">Own lunch not placed</div><ul>${items}</ul></div>`);
  }

  return `<details class="ia-issues-panel" open>
      <summary class="ia-issues-summary">⚠ ${total} placement issue${total === 1 ? '' : 's'} to review</summary>
      <div class="ia-issues-body">${sections.join('')}</div>
    </details>`;
}

function renderIAScheduleView() {
  const container = document.getElementById('view-ia');
  if (!container) return;

  const ias = SchedState.staff.filter(s => s.role === 'ia');

  if (!ias.length) {
    container.innerHTML = `
      <div class="view-header"><h1>IA Schedules</h1></div>
      <div class="empty-state">
        <div class="empty-icon">🧑‍🏫</div>
        <p>No instructional assistants on staff yet. Add IAs in the Staff Roster to get started.</p>
        <button class="btn btn-primary mt-16" data-nav="staff">Go to Staff Roster →</button>
      </div>`;
    return;
  }

  if (!SchedState.iaSchedule) SchedState.iaSchedule = {};
  DAYS.forEach(day => {
    if (!SchedState.iaSchedule[day]) SchedState.iaSchedule[day] = {};
    ias.forEach(ia => {
      if (!SchedState.iaSchedule[day][ia.id]) SchedState.iaSchedule[day][ia.id] = {};
    });
  });
  _migrateIASchedule();

  if (!iaSchedUI.focusedIAId || !ias.find(ia => ia.id === iaSchedUI.focusedIAId)) {
    iaSchedUI.focusedIAId = ias[0]?.id || null;
  }
  if (!['individual', 'all'].includes(iaSchedUI.viewMode)) {
    iaSchedUI.viewMode = 'individual';
  }

  const allocs = SchedState.iaAllocations || [];

  // Precompute weekly hours per alloc across all IAs → convert to per-day average
  const _allocWeeklyHrs = {};
  allocs.forEach(a => {
    _allocWeeklyHrs[a.id] = ias.reduce((acc, ia) => acc + (getIASummaryForIA(ia.id).byAlloc[a.id] || 0), 0);
  });

  // ── Budget category management bar ─────────────────────────────────────────
  // The bar reads as a legend ("BUDGET: <coloured pills>"), so the action in it has
  // to look unmistakably like an action or it disappears — a real button (shared
  // .btn classes), a verb + noun label, and margin-left:auto so it keeps a fixed
  // home instead of drifting as the wrapping chip row grows. The chips are buttons
  // too: "Title · 2.8/12h/day" looks like data you can change, so clicking it opens
  // that category's editor rather than teaching users the row is inert.
  const allocBar = `
    <div class="ia-budget-bar">
      <span class="ia-budget-bar-lbl">Budget:</span>
      ${allocs.length ? allocs.map(a => {
        const usedPerDay = _allocWeeklyHrs[a.id] / 5;
        const target     = a.hoursPerDay || 0;
        const over       = target > 0 && usedPerDay > target;
        const usageTxt   = target > 0
          ? ` · ${usedPerDay.toFixed(1)}/${target}h/day`
          : (usedPerDay > 0 ? ` · ${usedPerDay.toFixed(1)}h/day` : '');
        const chipStyle  = over
          ? `background:#fee2e2;border:1px solid #fca5a5;color:#dc2626`
          : `background:${a.color}18;border:1px solid ${a.color}50;color:${a.color}`;
        return `<button type="button" class="ia-budget-chip" style="${chipStyle}" data-chip-alloc="${a.id}" title="${escHtml('Edit ' + a.name)}">${escHtml(a.name)}${usageTxt}</button>`;
      }).join('') : '<span class="ia-budget-empty-hint">No categories yet — add some to track how IA time is spent.</span>'}
      <button type="button" class="btn ${allocs.length ? 'btn-outline' : 'btn-primary'} btn-sm ia-budget-manage-btn" id="ia-budget-manage-btn">${allocs.length ? 'Edit categories' : '+ Add categories'}</button>
    </div>
    <div class="ia-budget-manage-panel hidden" id="ia-budget-manage-panel">
      <div id="ia-alloc-list">${buildIAPaletteHtml(allocs)}</div>
      <div class="ia-add-alloc-section">
        <button class="ia-add-alloc-btn" id="ia-add-alloc-btn">+ Add category</button>
      </div>
      <div id="ia-add-alloc-form" class="ia-add-alloc-form hidden">
        <input class="ia-alloc-input" id="ia-new-alloc-name" placeholder="e.g. ELD, SPED, HDT" maxlength="30" />
        <div class="ia-alloc-color-row">
          <label class="ia-alloc-color-label">Color</label>
          <input type="color" id="ia-new-alloc-color" value="#6366f1" class="ia-alloc-color-input" />
        </div>
        <div class="ia-alloc-color-row">
          <label class="ia-alloc-color-label">Hours / day</label>
          <input type="number" id="ia-new-alloc-hpd" class="ia-alloc-hpd-input" value="0" min="0" max="12" step="0.25" />
        </div>
        <div class="ia-alloc-form-btns">
          <button class="btn btn-primary btn-sm" id="ia-save-alloc-btn">Add</button>
          <button class="btn btn-outline btn-sm" id="ia-cancel-alloc-btn">Cancel</button>
        </div>
      </div>
    </div>`;

  // ── Sub-tabs ────────────────────────────────────────────────────────────────
  const subTabsHtml = `
    <div class="ia-view-sub-tabs">
      <button class="ia-view-sub-tab${iaSchedUI.viewMode === 'individual' ? ' active' : ''}" data-ia-subtab="individual">Individual IA</button>
      <button class="ia-view-sub-tab${iaSchedUI.viewMode === 'all' ? ' active' : ''}" data-ia-subtab="all">All IAs</button>
    </div>`;

  // ── Content ─────────────────────────────────────────────────────────────────
  let contentHtml;
  if (iaSchedUI.viewMode === 'individual') {
    const iaPicker = ias.map(ia =>
      `<button class="ia-view-picker-chip${ia.id === iaSchedUI.focusedIAId ? ' active' : ''}" data-ia-pick="${ia.id}">${escHtml(ia.name)}</button>`
    ).join('');
    const focusedIASummary = getIASummaryForIA(iaSchedUI.focusedIAId);
    const iaGridOrEmpty = focusedIASummary.total > 0
      ? buildIndividualIAGrid(iaSchedUI.focusedIAId)
      : `<div class="ia-empty-state">
           <div class="ia-empty-icon">📋</div>
           <p>No assignments yet for this IA.</p>
           <p class="ia-empty-sub">Go to the Master Schedule, click <strong>Assign IAs</strong>, then click any block to assign this IA to it.</p>
           <button class="btn btn-primary btn-sm ia-empty-go-btn" id="ia-empty-go-btn">Set up IA coverage →</button>
         </div>`;
    contentHtml = `
      <div class="ia-view-picker-row">
        ${iaPicker}
        <button class="btn btn-outline btn-sm ia-add-duty-btn" id="ia-add-duty-btn">+ Add duty</button>
      </div>
      <div class="ia-ind-grid-summary" id="ia-ind-summary"></div>
      <div class="grid-scroll-wrap ia-ind-grid-wrap" id="ia-ind-grid-wrap">
        ${iaGridOrEmpty}
      </div>`;
  } else {
    const dayTabsHtml = DAYS.map(day =>
      `<button class="ia-day-tab${day === iaSchedUI.activeDay ? ' active' : ''}" data-day="${day}">${day.slice(0,3)}</button>`
    ).join('');
    contentHtml = `
      <div class="ia-all-day-tabs">${dayTabsHtml}</div>
      <div class="grid-scroll-wrap ia-all-grid-wrap" id="ia-all-grid-wrap">
        ${buildIAGrid(iaSchedUI.activeDay, ias)}
      </div>`;
  }

  const stalePurgeCount = SchedState.iaStalePurgeCount || 0;
  if (stalePurgeCount > 0) SchedState.iaStalePurgeCount = 0;
  const staleBanner = stalePurgeCount > 0
    ? `<div class="setup-banner ia-stale-banner" id="ia-stale-banner">
        <strong>⚠ ${stalePurgeCount} IA assignment${stalePurgeCount !== 1 ? 's were' : ' was'} removed</strong>
        because the master schedule changed and those time slots no longer have a block.
        Please review IA schedules and re-assign as needed.
        <button class="btn-link ia-stale-dismiss-btn" style="margin-left:12px">Dismiss</button>
       </div>`
    : '';

  container.innerHTML = `
    <div class="ia-view-shell">
      <div class="ia-view-top-bar">
        <div>
          <h1 class="grid-title">IA Schedules</h1>
          <p class="grid-subtitle">Click any assignment to reassign, shorten, or delete it. Assignments are placed automatically — use <strong>Place IAs</strong> on the IA Assignment tab to (re)generate them.</p>
        </div>
        <div class="ia-view-top-actions">
          <button class="btn btn-primary btn-sm" id="ia-go-master-btn">Edit coverage plan →</button>
          <button class="btn btn-outline btn-sm" id="ia-summary-csv-btn">Download CSV</button>
          <button class="btn btn-outline btn-sm" id="ia-print-btn">Print</button>
        </div>
      </div>
      ${staleBanner}
      ${_iaPlacementIssuesHtml()}
      ${allocBar}
      ${subTabsHtml}
      <div class="ia-view-content">
        ${contentHtml}
      </div>
      <div class="grid-footer">
        <button class="btn btn-outline" id="ia-back-btn">← Back to Class Schedules</button>
        <button class="btn btn-primary btn-lg" id="ia-next-btn">Continue to Export →</button>
      </div>
    </div>`;

  wireIAViewEvents(container, ias);
  if (iaSchedUI.viewMode === 'individual') _renderIAIndSummary(iaSchedUI.focusedIAId);

  const dismissBtn = container.querySelector('.ia-stale-dismiss-btn');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      const banner = container.querySelector('#ia-stale-banner');
      if (banner) banner.remove();
    });
  }
}

function buildIAPaletteHtml(allocs) {
  if (!allocs.length) return '<p class="ia-alloc-empty-msg">No budget categories yet.</p>';
  return allocs.map(alloc => {
    const hpd = alloc.hoursPerDay != null ? alloc.hoursPerDay : 0;
    return `
      <div class="ia-alloc-item" data-alloc-id="${alloc.id}">
        <div class="ia-alloc-header">
          <span class="palette-dot" style="background:${alloc.color}"></span>
          <span class="ia-alloc-name">${escHtml(alloc.name)}</span>
          <span class="ia-alloc-hpd-badge">${hpd > 0 ? hpd + 'h/day' : '—'}</span>
          <button class="ia-alloc-edit-btn" data-edit-alloc="${alloc.id}" title="Edit">✏</button>
          <button class="ia-alloc-delete" data-delete-alloc="${alloc.id}" title="Remove">×</button>
        </div>
        <div class="ia-alloc-edit-form hidden" id="ia-edit-form-${alloc.id}">
          <input class="ia-alloc-input ia-edit-name-input" value="${escHtml(alloc.name)}" maxlength="30" placeholder="Name" data-alloc-id="${alloc.id}" />
          <div class="ia-alloc-color-row">
            <label class="ia-alloc-color-label">Color</label>
            <input type="color" class="ia-alloc-color-input ia-edit-color-input" value="${alloc.color}" data-alloc-id="${alloc.id}" />
          </div>
          <div class="ia-alloc-color-row">
            <label class="ia-alloc-color-label">Hours / day</label>
            <input type="number" class="ia-alloc-hpd-input ia-edit-hpd-input" value="${hpd}" min="0" max="12" step="0.25" data-alloc-id="${alloc.id}" />
          </div>
          <div class="ia-alloc-form-btns">
            <button class="btn btn-primary btn-sm ia-save-edit-btn" data-alloc-id="${alloc.id}">Save</button>
            <button class="btn btn-outline btn-sm ia-cancel-edit-btn" data-alloc-id="${alloc.id}">Cancel</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function buildIATargetPickerHtml() {
  const grades  = gradesSorted();
  const classes = SchedState.staff.filter(s => s.role === 'teacher');

  if (iaSchedUI.targetType === 'grade') {
    if (!grades.length) return '<div class="ia-target-empty">No grades set up yet.</div>';
    return '<div class="ia-target-pills-row">' +
      grades.map(grade => {
        const active = iaSchedUI.targetId === grade;
        return `<button class="ia-target-pill${active ? ' active' : ''}" data-target-id="${grade}">${GRADE_LABELS[grade] || grade}</button>`;
      }).join('') + '</div>';
  }

  if (!classes.length) return '<div class="ia-target-empty">No teachers in Staff Roster yet.</div>';
  const byGrade = {};
  classes.forEach(t => { (byGrade[t.grade || '_'] = byGrade[t.grade || '_'] || []).push(t); });

  const gradeGroups = grades.map(grade => {
    const tList = byGrade[grade];
    if (!tList?.length) return '';
    const pills = tList.map(t => {
      const active = iaSchedUI.targetId === t.id;
      const last   = t.name ? t.name.split(' ').slice(-1)[0] : t.name;
      return `<button class="ia-target-pill${active ? ' active' : ''}" data-target-id="${t.id}">${escHtml(last)}</button>`;
    }).join('');
    return `<div class="ia-target-grade-group">
      <div class="ia-target-grade-label">${GRADE_LABELS[grade] || grade}</div>
      <div class="ia-target-pills-row">${pills}</div>
    </div>`;
  }).join('');

  const ungroupedList = byGrade['_'] || [];
  const ungrouped = ungroupedList.map(t => {
    const active = iaSchedUI.targetId === t.id;
    const last   = t.name ? t.name.split(' ').slice(-1)[0] : t.name;
    return `<button class="ia-target-pill${active ? ' active' : ''}" data-target-id="${t.id}">${escHtml(last)}</button>`;
  }).join('');

  return gradeGroups + (ungrouped ? `<div class="ia-target-grade-group">
    <div class="ia-target-grade-label">Unassigned grade</div>
    <div class="ia-target-pills-row">${ungrouped}</div>
  </div>` : '');
}

function _iaTargetLabel(entry) {
  if (!entry) return '';
  if (entry.targetType === 'own_lunch') return 'Own lunch';   // engine-reserved IA break
  if (entry.targetType === 'grade') return GRADE_LABELS[entry.targetId] || entry.targetId || '';
  if (entry.targetType === 'class') {
    const t = SchedState.staff.find(s => s.id === entry.targetId);
    return t ? t.name.split(' ').slice(-1)[0] : '';
  }
  return '';
}

function buildIASummaryTableHtml(ias) {
  const allocs = SchedState.iaAllocations || [];
  if (!allocs.length) {
    return `<div class="ia-summary-empty">
      <p>No budget categories defined yet.</p>
      <p>Go back to the grid view and add categories in the left panel.</p>
    </div>`;
  }

  const summaries = ias.map(ia => ({ ia, s: getIASummaryForIA(ia.id) }));

  const headerCols = allocs.map(a =>
    `<th class="ia-sum-th" style="border-bottom:3px solid ${a.color}">${escHtml(a.name)}</th>`
  ).join('');

  const dataRows = summaries.map(({ ia, s }) => {
    const cells = allocs.map(alloc => {
      const hrs = s.byAlloc[alloc.id] || 0;
      if (!hrs) return '<td class="ia-sum-cell ia-sum-zero">—</td>';
      return `<td class="ia-sum-cell">
        <div class="ia-sum-badge" style="background:${alloc.color}18;border:1px solid ${alloc.color}50;color:${alloc.color}">
          ${hrs.toFixed(1)}h
        </div>
      </td>`;
    }).join('');
    return `<tr class="ia-sum-row">
      <td class="ia-sum-name">${escHtml(ia.name)}</td>
      ${cells}
      <td class="ia-sum-total">${s.total > 0 ? s.total.toFixed(1) + 'h' : '—'}</td>
    </tr>`;
  }).join('');

  const totalCells = allocs.map(alloc => {
    const t = summaries.reduce((acc, { s }) => acc + (s.byAlloc[alloc.id] || 0), 0);
    return `<td class="ia-sum-cell ia-sum-grand-cell">${t > 0 ? t.toFixed(1) + 'h' : '—'}</td>`;
  }).join('');
  const grandTotal = summaries.reduce((acc, { s }) => acc + s.total, 0);

  return `<table class="sched-table ia-summary-table" cellspacing="0" id="ia-summary-table">
    <thead>
      <tr class="sched-head-row">
        <th class="ia-sum-th ia-sum-th-name">IA Name</th>
        ${headerCols}
        <th class="ia-sum-th ia-sum-th-total">Weekly Total</th>
      </tr>
    </thead>
    <tbody>
      ${dataRows}
      <tr class="ia-sum-grand-row">
        <td class="ia-sum-name ia-sum-grand-label">All IAs</td>
        ${totalCells}
        <td class="ia-sum-total ia-sum-grand">${grandTotal > 0 ? grandTotal.toFixed(1) + 'h' : '—'}</td>
      </tr>
    </tbody>
  </table>`;
}

function exportIASummaryCSV() {
  const ias    = SchedState.staff.filter(s => s.role === 'ia');
  const allocs = SchedState.iaAllocations || [];
  const school = SchedState.school.name || 'School';
  const q      = v => `"${String(v).replace(/"/g, '""')}"`;

  const headers = ['IA Name', ...allocs.map(a => a.name), 'Weekly Total'];
  const rows    = ias.map(ia => {
    const s = getIASummaryForIA(ia.id);
    return [ia.name, ...allocs.map(a => (s.byAlloc[a.id] || 0).toFixed(1)), s.total.toFixed(1)];
  });
  const totRow = ['All IAs',
    ...allocs.map(a => ias.reduce((acc, ia) => acc + (getIASummaryForIA(ia.id).byAlloc[a.id] || 0), 0).toFixed(1)),
    ias.reduce((acc, ia) => acc + getIASummaryForIA(ia.id).total, 0).toFixed(1)];
  rows.push(totRow);

  const csv  = [headers, ...rows].map(r => r.map(q).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${school.replace(/\s+/g, '-')}-IA-Schedule.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildIAGrid(day, ias) {
  const allocs = SchedState.iaAllocations || [];

  // Extend slot range to include any duty start/end slots for this day
  const slotSet = new Set(_autoFillSlots(day));
  const dayDuties = (SchedState.duties || []).filter(d => (d.days || []).includes(day));
  dayDuties.forEach(duty => _dutySlotsFor(duty).forEach(s => slotSet.add(s)));
  const slots = [...slotSet].sort();

  // Pre-build duty map per IA for this day: dutyMap[iaId][slot] = duty
  const dutyMap = {};
  ias.forEach(ia => { dutyMap[ia.id] = {}; });
  dayDuties.forEach(duty => {
    _dutySlotsFor(duty).forEach(s => {
      (duty.iaIds || []).forEach(iaId => {
        if (dutyMap[iaId]) dutyMap[iaId][s] = duty;
      });
    });
  });

  const dayMap = (SchedState.iaSchedule || {})[day] || {};

  const headCols = ias.map(ia =>
    `<th class="th-ia-name" title="${escHtml(ia.name)}">${escHtml(ia.name)}</th>`
  ).join('');

  const rows = slots.map((slot, idx) => {
    const prevSlot = idx > 0 ? slots[idx - 1] : null;
    const nextSlot = idx < slots.length - 1 ? slots[idx + 1] : null;
    const mm       = parseInt(slot.split(':')[1]);
    const isMajor  = mm === 0;
    const showLbl  = isMajor || mm === 30;

    const cells = ias.map(ia => {
      // Duty block takes priority
      const duty = dutyMap[ia.id]?.[slot];
      if (duty) {
        const alloc  = allocs.find(a => a.id === duty.allocId);
        const color  = alloc?.color || '#6366f1';
        const prevDuty = prevSlot ? dutyMap[ia.id]?.[prevSlot] : null;
        const nextDuty = nextSlot ? dutyMap[ia.id]?.[nextSlot] : null;
        const isCont = prevDuty?.id === duty.id;
        const isEnd  = nextDuty?.id !== duty.id;
        const inner  = isCont ? '' : `
          <div class="ia-cell-label ia-duty-name">${escHtml(duty.name)}</div>
          ${duty.location ? `<div class="ia-cell-grade ia-duty-loc">${escHtml(duty.location)}</div>` : ''}`;
        const styleStr = [
          `background:${color}22`,
          `border-left:3px dashed ${color}`,
          `border-right:1px solid ${color}40`,
          isCont ? 'border-top:1px solid transparent' : `border-top:2px dashed ${color}`,
          isEnd  ? `border-bottom:2px dashed ${color}` : '',
        ].filter(Boolean).join(';');
        return `<td class="ia-cell filled duty-cell${isCont ? ' cont' : ''}" data-ia="${ia.id}" data-slot="${slot}"
                 data-duty-id="${escHtml(duty.id)}" style="${styleStr}"
                 title="${escHtml(duty.name + (duty.location ? ' · ' + duty.location : ''))}">${inner}</td>`;
      }

      const iaSlots   = dayMap[ia.id] || {};
      const entry     = iaSlots[slot];
      const prevEntry = prevSlot ? (iaSlots[prevSlot] || null) : null;
      const nextEntry = nextSlot ? (iaSlots[nextSlot] || null) : null;

      if (!entry) {
        return `<td class="ia-cell empty" data-ia="${ia.id}" data-slot="${slot}"></td>`;
      }

      const alloc  = allocs.find(a => a.id === entry.allocId);
      const color  = alloc?.color || '#6b7280';
      const isCont = prevEntry &&
        prevEntry.allocId    === entry.allocId &&
        prevEntry.targetType === entry.targetType &&
        prevEntry.targetId   === entry.targetId;
      const isEnd = !nextEntry ||
        nextEntry.allocId    !== entry.allocId ||
        nextEntry.targetType !== entry.targetType ||
        nextEntry.targetId   !== entry.targetId;

      const grade   = entry.targetType === 'grade' ? entry.targetId : null;
      const btId    = grade ? getBlock(day, grade, slot) : null;
      const btName  = btId ? getBtName(btId) : null;
      const targetLabel = _iaTargetLabel(entry);
      const note    = entry.note || '';

      const inner = isCont ? '' : `
        <div class="ia-cell-label">${escHtml(alloc?.name || '')}</div>
        ${targetLabel ? `<div class="ia-cell-grade">${escHtml(targetLabel)}</div>` : ''}
        ${btName ? `<div class="ia-cell-block">${escHtml(btName)}</div>` : ''}
        ${note ? `<div class="ia-cell-note">${escHtml(note)}</div>` : ''}`;
      const title = [alloc?.name, targetLabel, btName, note].filter(Boolean).join(' · ');

      const styleStr = [
        `background:${color}22`,
        `border-left:3px solid ${color}`,
        `border-right:1px solid ${color}40`,
        isCont ? 'border-top:1px solid transparent' : `border-top:2px solid ${color}80`,
        isEnd  ? `border-bottom:2px solid ${color}80` : '',
      ].filter(Boolean).join(';');

      return `<td class="ia-cell filled ia-assign-cell${isCont ? ' cont' : ''}" data-ia="${ia.id}" data-slot="${slot}" data-day="${day}"
               style="${styleStr}" title="${escHtml(title)}">${inner}</td>`;
    }).join('');

    return `<tr class="sched-row${isMajor ? ' row-hour' : ''}" data-slot="${slot}">
      <td class="td-time${showLbl ? '' : ' td-time-minor'}">${showLbl ? fmtTime(slot) : ''}</td>
      ${cells}
    </tr>`;
  }).join('');

  return `<table class="sched-table ia-sched-table" cellspacing="0" id="ia-sched-table">
    <thead><tr class="sched-head-row">
      <th class="th-time"></th>${headCols}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function wireIAScheduleEvents(container, ias) {
  // Summary mode handlers
  container.querySelector('#ia-back-to-grid-btn')?.addEventListener('click', () => {
    iaSchedUI.viewMode = 'grid';
    renderIAScheduleView();
  });
  container.querySelector('#ia-summary-csv-btn')?.addEventListener('click', exportIASummaryCSV);
  container.querySelector('#ia-summary-print-btn')?.addEventListener('click', () => {
    const table = container.querySelector('#ia-summary-table');
    if (table) printScheduleGrid('IA Schedule — All IAs Summary', SchedState.school.name || '', table);
  });

  if (iaSchedUI.viewMode === 'all') return;

  // Grid mode handlers
  container.querySelector('#ia-back-btn').addEventListener('click', () => {
    navigateTo('specials-sched'); renderSpecialsScheduleView();
  });
  container.querySelector('#ia-print-btn').addEventListener('click', () => {
    const table = container.querySelector('#ia-grid-wrap .sched-table');
    if (table) printScheduleGrid(`IA Schedule — ${iaSchedUI.activeDay}`, SchedState.school.name || '', table);
  });
  container.querySelector('#ia-view-all-btn').addEventListener('click', () => {
    iaSchedUI.viewMode = 'all';
    renderIAScheduleView();
  });

  // Budget eraser
  container.querySelector('#ia-eraser').addEventListener('click', () => {
    iaSchedUI.activeAllocId = null;
    _refreshBudgetSelection(container);
  });

  // Budget selection
  container.querySelectorAll('.ia-alloc-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.closest('.ia-alloc-delete')) return;
      const id = item.dataset.allocId;
      iaSchedUI.activeAllocId = (iaSchedUI.activeAllocId === id) ? null : id;
      _refreshBudgetSelection(container);
    });
  });

  // Delete budget category
  container.querySelectorAll('[data-delete-alloc]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.deleteAlloc;
      if (!confirm('Remove this budget category? Cells painted with it will be cleared.')) return;
      SchedState.iaAllocations = (SchedState.iaAllocations || []).filter(a => a.id !== id);
      DAYS.forEach(day => {
        Object.values(SchedState.iaSchedule[day] || {}).forEach(iaSlots => {
          Object.keys(iaSlots).forEach(slot => {
            if (iaSlots[slot]?.allocId === id) delete iaSlots[slot];
          });
        });
      });
      if (iaSchedUI.activeAllocId === id) iaSchedUI.activeAllocId = null;
      saveToLocal();
      renderIAScheduleView();
    });
  });

  // Add budget form
  container.querySelector('#ia-add-alloc-btn').addEventListener('click', () => {
    container.querySelector('#ia-add-alloc-form').classList.remove('hidden');
    container.querySelector('#ia-new-alloc-name').focus();
  });
  container.querySelector('#ia-cancel-alloc-btn').addEventListener('click', () => {
    container.querySelector('#ia-add-alloc-form').classList.add('hidden');
    container.querySelector('#ia-new-alloc-name').value = '';
  });
  container.querySelector('#ia-save-alloc-btn').addEventListener('click', () => {
    const nameEl = container.querySelector('#ia-new-alloc-name');
    const name   = nameEl.value.trim();
    const color  = container.querySelector('#ia-new-alloc-color').value;
    if (!name) { nameEl.focus(); return; }
    if (!SchedState.iaAllocations) SchedState.iaAllocations = [];
    SchedState.iaAllocations.push({ id: uid(), name, color });
    saveToLocal();
    renderIAScheduleView();
  });

  // Target type toggle (Grade / Class)
  container.querySelectorAll('.ia-target-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (iaSchedUI.targetType === btn.dataset.targetType) return;
      iaSchedUI.targetType = btn.dataset.targetType;
      iaSchedUI.targetId   = null;
      container.querySelectorAll('.ia-target-type-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.targetType === iaSchedUI.targetType));
      const hintEl = container.querySelector('.ia-target-hint');
      if (hintEl) hintEl.textContent = iaSchedUI.targetType === 'grade' ? 'IA supports the entire grade.' : 'IA supports one teacher\'s class.';
      const pickerEl = container.querySelector('#ia-target-picker');
      if (pickerEl) { pickerEl.innerHTML = buildIATargetPickerHtml(); _wireTargetPicker(container); }
    });
  });
  _wireTargetPicker(container);

  // Day tabs
  container.querySelectorAll('.ia-day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      iaSchedUI.activeDay = tab.dataset.day;
      renderIAScheduleView();
    });
  });

  // Paint
  const table = container.querySelector('#ia-sched-table');
  if (!table) return;

  table.addEventListener('mousedown', e => {
    const cell = e.target.closest('.ia-cell');
    if (!cell) return;
    e.preventDefault();
    iaDrag.active     = true;
    iaDrag.allocId    = iaSchedUI.activeAllocId;
    iaDrag.targetType = iaSchedUI.targetType;
    iaDrag.targetId   = iaSchedUI.targetId;
    _applyIACell(cell);
  });

  table.addEventListener('mousemove', e => {
    if (!iaDrag.active) return;
    const cell = e.target.closest('.ia-cell');
    if (cell) _applyIACell(cell);
  });

  table.addEventListener('mouseover', e => {
    const cell = e.target.closest('.ia-cell[data-ia]');
    if (cell && cell.dataset.ia !== iaSchedUI.focusedIAId) {
      iaSchedUI.focusedIAId = cell.dataset.ia;
      _refreshIAPanel();
    }
  });

  const stopIADrag = () => { iaDrag.active = false; };
  document.addEventListener('mouseup', stopIADrag);
  container.addEventListener('ia-view-destroyed', () => document.removeEventListener('mouseup', stopIADrag));
}

function _wireTargetPicker(container) {
  container.querySelectorAll('.ia-target-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      iaSchedUI.targetId = pill.dataset.targetId;
      container.querySelectorAll('.ia-target-pill').forEach(p =>
        p.classList.toggle('active', p.dataset.targetId === iaSchedUI.targetId));
    });
  });
}

function _refreshBudgetSelection(container) {
  const allocs = SchedState.iaAllocations || [];
  container.querySelector('#ia-eraser')?.classList.toggle('active', iaSchedUI.activeAllocId === null);
  container.querySelectorAll('.ia-alloc-item').forEach(item => {
    const id    = item.dataset.allocId;
    const alloc = allocs.find(a => a.id === id);
    const active = id === iaSchedUI.activeAllocId;
    item.classList.toggle('active', active);
    item.style.borderLeft = alloc && active ? `3px solid ${alloc.color}` : '3px solid transparent';
    item.style.background = alloc && active ? `${alloc.color}12` : '';
  });
}

function _applyIACell(cell) {
  const iaId = cell.dataset.ia;
  const slot = cell.dataset.slot;
  const day  = iaSchedUI.activeDay;

  if (!SchedState.iaSchedule[day])       SchedState.iaSchedule[day] = {};
  if (!SchedState.iaSchedule[day][iaId]) SchedState.iaSchedule[day][iaId] = {};

  const current = SchedState.iaSchedule[day][iaId][slot];

  if (iaDrag.allocId === null) {
    delete SchedState.iaSchedule[day][iaId][slot];
  } else if (!iaDrag.targetId) {
    return; // incomplete brush — no target selected
  } else if (current && (
    current.allocId    !== iaDrag.allocId ||
    current.targetType !== iaDrag.targetType ||
    current.targetId   !== iaDrag.targetId
  )) {
    return; // hard block — different brush
  } else {
    SchedState.iaSchedule[day][iaId][slot] = {
      allocId:    iaDrag.allocId,
      targetType: iaDrag.targetType,
      targetId:   iaDrag.targetId,
    };
  }

  iaSchedUI.focusedIAId = iaId;
  _updateIACellDOM(cell, day, iaId, slot, 0);
  _refreshIAPanel();
  saveToLocal();
}

function _updateIACellDOM(cell, day, iaId, slot, depth) {
  if (depth > 120) return;
  const allocs    = SchedState.iaAllocations || [];
  const entry     = (SchedState.iaSchedule[day]?.[iaId] || {})[slot];
  const table     = cell.closest('table');
  const allCells  = [...table.querySelectorAll(`td.ia-cell[data-ia="${iaId}"]`)];
  const slotIdx   = allCells.findIndex(c => c.dataset.slot === slot);
  const prevCell  = slotIdx > 0 ? allCells[slotIdx - 1] : null;
  const prevEntry = prevCell ? (SchedState.iaSchedule[day]?.[iaId]?.[prevCell.dataset.slot] || null) : null;

  if (!entry) {
    cell.className     = 'ia-cell empty';
    cell.style.cssText = '';
    cell.innerHTML     = '';
    cell.title         = '';
  } else {
    const alloc  = allocs.find(a => a.id === entry.allocId);
    const color  = alloc?.color || '#6b7280';
    const isCont = prevEntry &&
      prevEntry.allocId    === entry.allocId &&
      prevEntry.targetType === entry.targetType &&
      prevEntry.targetId   === entry.targetId;
    const targetLabel = _iaTargetLabel(entry);
    cell.className     = `ia-cell filled${isCont ? ' cont' : ''}`;
    cell.style.cssText = `background:${color}22;border-left:3px solid ${color};border-right:1px solid ${color}40`;
    cell.title         = [alloc?.name, targetLabel].filter(Boolean).join(' • ');
    cell.innerHTML     = isCont ? '' : `
      <div class="ia-cell-label">${escHtml(alloc?.name || '')}</div>
      ${targetLabel ? `<div class="ia-cell-grade">${escHtml(targetLabel)}</div>` : ''}`;
  }

  const nextCell = slotIdx >= 0 && slotIdx < allCells.length - 1 ? allCells[slotIdx + 1] : null;
  if (nextCell && SchedState.iaSchedule[day]?.[iaId]?.[nextCell.dataset.slot]) {
    _updateIACellDOM(nextCell, day, iaId, nextCell.dataset.slot, depth + 1);
  }
}

function _refreshIAPanel() {
  const ias = SchedState.staff.filter(s => s.role === 'ia');
  if (!iaSchedUI.focusedIAId || !ias.find(ia => ia.id === iaSchedUI.focusedIAId)) {
    iaSchedUI.focusedIAId = ias[0]?.id || null;
  }
  const ia = ias.find(s => s.id === iaSchedUI.focusedIAId);

  const nameEl    = document.getElementById('ia-mini-name');
  const contentEl = document.getElementById('ia-mini-summary-content');
  const totalEl   = document.getElementById('ia-mini-total');
  if (!contentEl) return;

  if (!ia) { contentEl.innerHTML = ''; return; }
  if (nameEl) nameEl.textContent = ia.name;

  const summary = getIASummaryForIA(ia.id);
  const allocs  = SchedState.iaAllocations || [];
  const rows    = allocs
    .filter(a => (summary.byAlloc[a.id] || 0) > 0)
    .map(a => `
      <div class="ia-mini-row">
        <span class="ia-mini-dot" style="background:${a.color}"></span>
        <span class="ia-mini-label">${escHtml(a.name)}</span>
        <span class="ia-mini-hours">${summary.byAlloc[a.id].toFixed(1)}h</span>
      </div>`).join('');

  contentEl.innerHTML = rows || '<div class="ia-mini-empty">No assignments yet.</div>';
  if (totalEl) totalEl.textContent = summary.total > 0 ? `${summary.total.toFixed(1)}h / week` : '';
}


// ── IA assignment edit / delete ──────────────────────────────────────────────

// The contiguous run of 5-min slots (same alloc + target) that form one visible
// IA assignment block, containing `slot`. Walks by time so it's independent of
// which slot list the grid rendered.
function _iaAssignmentRun(day, iaId, slot) {
  const map  = (SchedState.iaSchedule[day] || {})[iaId] || {};
  const base = map[slot];
  if (!base) return [];
  const same = e => e && e.allocId === base.allocId &&
    e.targetType === base.targetType && e.targetId === base.targetId;
  const run = [slot];
  for (let t = timeToMins(slot) - 5; same(map[minsToTime(t)]); t -= 5) run.unshift(minsToTime(t));
  for (let t = timeToMins(slot) + 5; same(map[minsToTime(t)]); t += 5) run.push(minsToTime(t));
  return run;
}

// Anchored popover to edit (budget category, note) or delete an IA assignment,
// opened by clicking an assignment cell in either IA Schedule sub-view.
function openIAAssignmentEditor(anchorCell, day, iaId, slot) {
  document.getElementById('ia-assign-editor')?.remove();
  const map   = (SchedState.iaSchedule[day] || {})[iaId] || {};
  const entry = map[slot];
  if (!entry) return;

  const run    = _iaAssignmentRun(day, iaId, slot);
  const ia     = (SchedState.staff || []).find(s => s.id === iaId);
  const ias    = (SchedState.staff || []).filter(s => s.role === 'ia');
  const allocs = SchedState.iaAllocations || [];
  const target = _iaTargetLabel(entry);
  const grade  = entry.targetType === 'grade' ? entry.targetId : null;
  const isOwnLunch = entry.targetType === 'own_lunch';
  const btId   = grade ? getBlock(day, grade, slot) : null;
  const btName = btId ? getBtName(btId) : '';
  const startSlot = run[0];
  const endMins   = timeToMins(run[run.length - 1]) + 5;
  const timeStr   = `${fmtTime12(startSlot)} – ${fmtTime12(minsToTime(endMins))} · ${endMins - timeToMins(startSlot)} min`;

  // For a grade assignment, the run can be shortened to part of its underlying
  // block. blockSlots = the full block that contains this assignment for the grade.
  const blockSlots = grade ? getAllBlockSlots(day, grade, findBlockStart(day, grade, slot)) : run;
  const blockEnds  = blockSlots.map(s => minsToTime(timeToMins(s) + 5));   // candidate END times

  const allocOpts = allocs.map(a =>
    `<option value="${escHtml(a.id)}"${a.id === entry.allocId ? ' selected' : ''}>${escHtml(a.name)}</option>`
  ).join('');
  const iaOpts = ias.map(x =>
    `<option value="${escHtml(x.id)}"${x.id === iaId ? ' selected' : ''}>${escHtml(x.name)}</option>`
  ).join('');
  const startOpts = blockSlots.map(s => `<option value="${s}"${s === startSlot ? ' selected' : ''}>${fmtTime12(s)}</option>`).join('');
  const endOpts   = blockEnds.map(s => `<option value="${s}"${timeToMins(s) === endMins ? ' selected' : ''}>${fmtTime12(s)}</option>`).join('');

  const panel = document.createElement('div');
  panel.id = 'ia-assign-editor';
  panel.className = 'override-panel';
  panel.innerHTML = `
    <div class="override-panel-header">
      <span class="override-panel-title">${escHtml(ia?.name || 'IA')} · ${escHtml(day.slice(0, 3))}</span>
      <button class="override-panel-close" id="iae-close">&#x2715;</button>
    </div>
    <div class="override-panel-body">
      <div class="ia-editor-meta">
        <div><strong>${escHtml(target || '(assignment)')}</strong>${btName ? ' · ' + escHtml(btName) : ''}</div>
        <div class="ia-editor-time">${escHtml(timeStr)}</div>
      </div>
      ${isOwnLunch ? '' : `
      <div class="override-field-row">
        <label class="override-label">IA</label>
        <select id="iae-ia" class="override-select">${iaOpts}</select>
      </div>
      <div class="override-field-row">
        <label class="override-label">Time within the block</label>
        <div class="ia-editor-range">
          <select id="iae-start" class="override-select">${startOpts}</select>
          <span class="ia-editor-dash">–</span>
          <select id="iae-end" class="override-select">${endOpts}</select>
        </div>
      </div>`}
      <div class="override-field-row">
        <label class="override-label">Budget category</label>
        <select id="iae-alloc" class="override-select">${allocOpts || '<option value="">(no categories)</option>'}</select>
      </div>
      <div class="override-field-row">
        <label class="override-label">Note</label>
        <textarea id="iae-note" class="override-select" rows="2" placeholder="Optional">${escHtml(entry.note || '')}</textarea>
      </div>
      <div class="override-actions">
        <button class="btn btn-primary btn-sm" id="iae-save">Save</button>
        <button class="btn btn-outline btn-sm" id="iae-cancel">Cancel</button>
        <button class="btn-link ia-editor-delete" id="iae-delete">Delete assignment</button>
      </div>
    </div>`;

  document.body.appendChild(panel);
  const rect = anchorCell.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let top  = rect.bottom + window.scrollY + 4;
  let left = rect.left   + window.scrollX;
  if (left + 300 > vw) left = Math.max(8, vw - 308);
  if (rect.bottom + 300 > vh) top = Math.max(8, rect.top + window.scrollY - 304);
  panel.style.top  = top  + 'px';
  panel.style.left = left + 'px';

  const close = () => panel.remove();
  document.getElementById('iae-close').addEventListener('click', close);
  document.getElementById('iae-cancel').addEventListener('click', close);

  document.getElementById('iae-save').addEventListener('click', () => {
    const newAlloc = document.getElementById('iae-alloc').value;
    const newNote  = document.getElementById('iae-note').value.trim();

    // Own lunch: only category/note editable in place.
    if (isOwnLunch) {
      run.forEach(s => { const e = map[s]; if (!e) return; if (newAlloc) e.allocId = newAlloc; if (newNote) e.note = newNote; else delete e.note; });
      saveToLocal(); renderIAScheduleView(); return;
    }

    const newIaId = document.getElementById('iae-ia').value;
    const sStart  = document.getElementById('iae-start').value;
    const sEnd    = document.getElementById('iae-end').value;
    if (timeToMins(sEnd) <= timeToMins(sStart)) { alert('End time must be after start time.'); return; }
    // target slots = block slots within [sStart, sEnd)
    const targetSlots = blockSlots.filter(s => timeToMins(s) >= timeToMins(sStart) && timeToMins(s) < timeToMins(sEnd));

    // Remove the OLD assignment first (so re-timing the same IA doesn't self-collide).
    run.forEach(s => { delete map[s]; });

    // No double-booking: the target IA must be free on the target slots.
    const targetMap = ((SchedState.iaSchedule[day] = SchedState.iaSchedule[day] || {})[newIaId] = (SchedState.iaSchedule[day] || {})[newIaId] || {});
    const clash = targetSlots.some(s => targetMap[s]);
    if (clash) {
      // put the old assignment back, then bail
      run.forEach(s => { map[s] = { allocId: entry.allocId, targetType: 'grade', targetId: grade, note: entry.note || '' }; });
      alert('That IA is already assigned somewhere during this time. Pick a different IA or time.');
      return;
    }
    const finalNote = newNote || '';
    targetSlots.forEach(s => { targetMap[s] = { allocId: newAlloc || entry.allocId || null, targetType: 'grade', targetId: grade, note: finalNote }; });
    saveToLocal();
    renderIAScheduleView();
  });

  document.getElementById('iae-delete').addEventListener('click', () => {
    if (!confirm('Delete this IA assignment? This removes it from the IA schedule.')) return;
    run.forEach(s => { delete map[s]; });
    saveToLocal();
    renderIAScheduleView();
  });
}


// ── IA assignment from master schedule ────────────────────────────────────────

// Returns IAs assigned to a grade block at the given start slot (grade-level assignments only).
function getIAsForBlock(day, grade, startSlot) {
  const ias = SchedState.staff.filter(s => s.role === 'ia');
  const dayMap = (SchedState.iaSchedule || {})[day] || {};
  const allocs = SchedState.iaAllocations || [];
  const results = [];
  ias.forEach(ia => {
    const entry = (dayMap[ia.id] || {})[startSlot];
    if (entry && entry.targetType === 'grade' && entry.targetId === grade) {
      const alloc = allocs.find(a => a.id === entry.allocId);
      results.push({ ia, alloc, entry });
    }
  });
  return results;
}

// Returns all 5-min slots in the block that contains startSlot.
function getAllBlockSlots(day, grade, startSlot) {
  const len = findBlockLength(day, grade, startSlot);
  const startIdx = currentSlots.indexOf(startSlot);
  return currentSlots.slice(startIdx, startIdx + len);
}

// Toggle IA assignment mode on/off in the master schedule.
// Returns partial time info if an IA is assigned to only part of the block, else null.
function _getIAPartialTime(day, iaId, startSlot, slots) {
  const iaSlots = ((SchedState.iaSchedule[day] || {})[iaId] || {});
  const assigned = slots.filter(s => {
    const e = iaSlots[s];
    return e && e.targetType === 'grade';
  });
  if (!assigned.length) return null;
  const first = assigned[0], last = assigned[assigned.length - 1];
  if (first === slots[0] && last === slots[slots.length - 1]) return null;
  return { start: first, end: minsToTime(timeToMins(last) + 5) };
}

function buildIndividualIAGrid(iaId) {
  const allSlotSet = new Set();
  DAYS.forEach(d => _autoFillSlots(d).forEach(s => allSlotSet.add(s)));

  // Include any 5-min slots covered by duties assigned to this IA
  const iaDuties = (SchedState.duties || []).filter(d => (d.iaIds || []).includes(iaId));
  iaDuties.forEach(duty => _dutySlotsFor(duty).forEach(s => allSlotSet.add(s)));

  const allSlots = [...allSlotSet].sort();

  // Pre-build duty map: dutyMap[day][slot] = duty (for this IA)
  const dutyMap = {};
  DAYS.forEach(day => {
    dutyMap[day] = {};
    iaDuties.forEach(duty => {
      if (!(duty.days || []).includes(day)) return;
      _dutySlotsFor(duty).forEach(s => { dutyMap[day][s] = duty; });
    });
  });

  const headCols = DAYS.map(d => `<th class="th-ia-day">${d.slice(0,3)}</th>`).join('');

  const rows = allSlots.map((slot, idx) => {
    const prevSlot  = idx > 0 ? allSlots[idx - 1] : null;
    const nextSlot  = idx < allSlots.length - 1 ? allSlots[idx + 1] : null;
    const mm        = parseInt(slot.split(':')[1]);
    const isMajor   = mm === 0;
    const showLbl   = mm % 15 === 0;

    const cells = DAYS.map(day => {
      // Duty block takes priority over grade-based assignment
      const duty = dutyMap[day][slot];
      if (duty) {
        const alloc    = (SchedState.iaAllocations || []).find(a => a.id === duty.allocId);
        const color    = alloc?.color || '#6366f1';
        const prevDuty = prevSlot ? dutyMap[day][prevSlot] : null;
        const nextDuty = nextSlot ? dutyMap[day][nextSlot] : null;
        const isCont   = prevDuty?.id === duty.id;
        const isEnd    = nextDuty?.id !== duty.id;
        const inner    = isCont ? '' : `
          <div class="ia-ind-cell-grade ia-duty-name">${escHtml(duty.name)}</div>
          ${duty.location ? `<div class="ia-ind-cell-block ia-duty-loc">${escHtml(duty.location)}</div>` : ''}
          ${alloc ? `<span class="ia-ind-alloc-dot" style="background:${alloc.color}" title="${escHtml(alloc.name)}"></span>` : ''}`;
        const styleStr = [
          `background:${color}18`,
          `border-left:3px dashed ${color}`,
          `border-right:1px solid ${color}40`,
          isCont ? 'border-top:1px solid transparent' : `border-top:2px dashed ${color}`,
          isEnd  ? `border-bottom:2px dashed ${color}` : '',
        ].filter(Boolean).join(';');
        return `<td class="ia-ind-cell filled duty-cell${isCont ? ' cont' : ''}" style="${styleStr}"
          data-duty-id="${escHtml(duty.id)}" title="${escHtml(duty.name + (duty.location ? ' · ' + duty.location : ''))}">${inner}</td>`;
      }

      const iaDay  = (SchedState.iaSchedule[day] || {})[iaId] || {};
      const entry  = iaDay[slot];
      if (!entry) return `<td class="ia-ind-cell empty"></td>`;

      const nextEntry = nextSlot ? (((SchedState.iaSchedule[day] || {})[iaId] || {})[nextSlot] || null) : null;

      const grade = entry.targetType === 'grade' ? entry.targetId : null;
      const btId  = grade ? getBlock(day, grade, slot) : null;
      const bt    = btId
        ? (SchedState.blockTypes.find(b => b.id === btId) ||
           SchedState.blockTypes.find(b => btId.startsWith(b.id + '|')))
        : null;
      const color = bt?.color || getBtColor(btId) || '#94a3b8';

      const prevEntry = prevSlot ? (((SchedState.iaSchedule[day] || {})[iaId] || {})[prevSlot] || null) : null;
      const isCont = prevEntry &&
        prevEntry.allocId  === entry.allocId &&
        prevEntry.targetId === entry.targetId;
      const isEnd = !nextEntry ||
        nextEntry.allocId  !== entry.allocId ||
        nextEntry.targetId !== entry.targetId;

      const alloc      = (SchedState.iaAllocations || []).find(a => a.id === entry.allocId);
      const gradeLabel = grade ? (GRADE_LABELS[grade] || grade) : '';
      const note       = entry.note || '';
      const inner      = isCont ? '' : `
        <div class="ia-ind-cell-grade">${escHtml(gradeLabel)}</div>
        ${bt ? `<div class="ia-ind-cell-block">${escHtml(bt.name)}</div>` : ''}
        ${alloc ? `<span class="ia-ind-alloc-dot" style="background:${alloc.color}" title="${escHtml(alloc.name)}"></span>` : ''}
        ${note ? `<div class="ia-ind-cell-note">${escHtml(note)}</div>` : ''}`;

      const styleStr = [
        `background:${color}18`,
        `border-left:3px solid ${color}`,
        `border-right:1px solid ${color}40`,
        isCont ? 'border-top:1px solid transparent' : `border-top:2px solid ${color}80`,
        isEnd  ? `border-bottom:2px solid ${color}80` : '',
      ].filter(Boolean).join(';');
      return `<td class="ia-ind-cell filled ia-assign-cell${isCont ? ' cont' : ''}" data-day="${day}" data-slot="${slot}" style="${styleStr}">${inner}</td>`;
    }).join('');

    return `<tr class="sched-row${isMajor ? ' row-hour' : ''}">
      <td class="td-time${showLbl ? '' : ' td-time-minor'}">${showLbl ? fmtTime(slot) : ''}</td>
      ${cells}
    </tr>`;
  }).join('');

  return `<table class="sched-table ia-ind-table" cellspacing="0">
    <thead><tr class="sched-head-row"><th class="th-time"></th>${headCols}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function _dutySlotsFor(duty) {
  const start = timeToMins(duty.startTime);
  const end   = timeToMins(duty.endTime);
  const slots = [];
  for (let m = start; m < end; m += 5) slots.push(minsToTime(m));
  return slots;
}

// ── Duty panel ────────────────────────────────────────────────────────────────

function openDutyPanel(duty, defaultIaId) {
  document.getElementById('duty-panel')?.remove();

  const isEdit = !!duty;
  const ias    = (SchedState.staff || []).filter(s => s.role === 'ia');
  const allocs = SchedState.iaAllocations || [];

  // Wide time range for duties (before/after school)
  const timeOpts = generateTimeSlots('06:00', '19:00').map(t => `<option value="${t}">${fmtTime12(t)}</option>`).join('');

  const selectedDays  = duty?.days  || DAYS.slice();
  const selectedIaIds = duty?.iaIds || (defaultIaId ? [defaultIaId] : []);

  const dayChecks = DAYS.map(d =>
    `<label class="duty-day-label"><input type="checkbox" name="duty-day" value="${d}"${selectedDays.includes(d) ? ' checked' : ''}> ${d.slice(0,3)}</label>`
  ).join('');

  const iaChecks = ias.map(ia =>
    `<label class="duty-ia-label"><input type="checkbox" name="duty-ia" value="${ia.id}"${selectedIaIds.includes(ia.id) ? ' checked' : ''}> ${escHtml(ia.name)}</label>`
  ).join('');

  const allocOptions = `<option value="">— None —</option>` +
    allocs.map(a => `<option value="${a.id}"${duty?.allocId === a.id ? ' selected' : ''}>${escHtml(a.name)}</option>`).join('');

  const panel = document.createElement('div');
  panel.id = 'duty-panel';
  panel.className = 'override-panel duty-panel';
  panel.innerHTML = `
    <div class="override-panel-header">
      <span class="override-panel-title">${isEdit ? 'Edit Duty' : 'Add Duty'}</span>
      <button class="override-panel-close" id="duty-panel-close">&#x2715;</button>
    </div>
    <div class="override-panel-body">
      <div class="override-field-row">
        <label class="override-label">Duty name</label>
        <input id="duty-name" class="override-select" type="text" placeholder="e.g. Morning Greeting" value="${escHtml(duty?.name || '')}">
      </div>
      <div class="override-field-row">
        <label class="override-label">Location <span class="override-label-opt">(optional)</span></label>
        <input id="duty-location" class="override-select" type="text" placeholder="e.g. Front Entrance" value="${escHtml(duty?.location || '')}">
      </div>
      <div class="override-field-row duty-time-row">
        <div class="duty-time-col">
          <label class="override-label">Start</label>
          <select id="duty-start" class="override-select">${timeOpts}</select>
        </div>
        <div class="duty-time-col">
          <label class="override-label">End</label>
          <select id="duty-end" class="override-select">${timeOpts}</select>
        </div>
      </div>
      <div class="override-field-row">
        <label class="override-label">Days</label>
        <div class="duty-day-checks">${dayChecks}</div>
      </div>
      <div class="override-field-row">
        <label class="override-label">Assign IAs</label>
        <div class="duty-ia-checks">${iaChecks}</div>
      </div>
      ${allocs.length ? `<div class="override-field-row">
        <label class="override-label">Budget category</label>
        <select id="duty-alloc" class="override-select">${allocOptions}</select>
      </div>` : ''}
      <div class="override-actions">
        <button class="btn btn-primary btn-sm" id="duty-save-btn">${isEdit ? 'Save changes' : 'Add duty'}</button>
        ${isEdit ? `<button class="btn btn-outline btn-sm ia-danger" id="duty-delete-btn">Delete</button>` : ''}
        <button class="btn btn-outline btn-sm" id="duty-cancel-btn">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Set default / current start + end times
  const startSel = document.getElementById('duty-start');
  const endSel   = document.getElementById('duty-end');
  if (duty?.startTime && startSel) startSel.value = duty.startTime;
  else if (startSel) startSel.value = SchedState.school.firstBell || SchedState.school.studentCampusStart || '07:45';
  if (duty?.endTime && endSel) endSel.value = duty.endTime;
  else if (endSel) endSel.value = SchedState.school.firstBell || '08:10';

  const close = () => panel.remove();
  document.getElementById('duty-panel-close').addEventListener('click', close);
  document.getElementById('duty-cancel-btn').addEventListener('click', close);

  document.getElementById('duty-delete-btn')?.addEventListener('click', () => {
    if (!confirm(`Delete "${duty.name}"?`)) return;
    SchedState.duties = (SchedState.duties || []).filter(d => d.id !== duty.id);
    saveToLocal();
    panel.remove();
    renderIAScheduleView();
  });

  document.getElementById('duty-save-btn').addEventListener('click', () => {
    const name     = document.getElementById('duty-name')?.value.trim();
    const location = document.getElementById('duty-location')?.value.trim() || '';
    const start    = document.getElementById('duty-start')?.value;
    const end      = document.getElementById('duty-end')?.value;
    const days     = [...document.querySelectorAll('#duty-panel input[name="duty-day"]:checked')].map(c => c.value);
    const iaIds    = [...document.querySelectorAll('#duty-panel input[name="duty-ia"]:checked')].map(c => c.value);
    const allocId  = document.getElementById('duty-alloc')?.value || null;

    if (!name) { document.getElementById('duty-name')?.focus(); return; }
    if (!start || !end || timeToMins(end) <= timeToMins(start)) {
      alert('End time must be after start time.'); return;
    }
    if (!days.length) { alert('Select at least one day.'); return; }
    if (!iaIds.length) { alert('Assign at least one IA.'); return; }

    if (!SchedState.duties) SchedState.duties = [];

    if (isEdit) {
      const existing = SchedState.duties.find(d => d.id === duty.id);
      if (existing) Object.assign(existing, { name, location, startTime: start, endTime: end, days, iaIds, allocId });
    } else {
      SchedState.duties.push({ id: uid(), name, location, startTime: start, endTime: end, days, iaIds, allocId });
    }

    saveToLocal();
    panel.remove();
    renderIAScheduleView();
  });
}

// Render the hours summary bar for the focused IA.
function _renderIAIndSummary(iaId) {
  const el = document.getElementById('ia-ind-summary');
  if (!el || !iaId) return;
  const summary = getIASummaryForIA(iaId);
  const allocs  = SchedState.iaAllocations || [];
  if (!summary.total) { el.innerHTML = ''; return; }
  const chips = allocs
    .filter(a => (summary.byAlloc[a.id] || 0) > 0)
    .map(a => {
      const usedPerDay = summary.byAlloc[a.id] / 5;
      const target     = a.hoursPerDay || 0;
      const over       = target > 0 && usedPerDay > target;
      const label      = target > 0
        ? `${escHtml(a.name)}: ${usedPerDay.toFixed(1)}/${target}h/day`
        : `${escHtml(a.name)}: ${usedPerDay.toFixed(1)}h/day`;
      const style = over
        ? `background:#fee2e2;border:1px solid #fca5a5;color:#dc2626`
        : `background:${a.color}18;border:1px solid ${a.color}50;color:${a.color}`;
      return `<span class="ia-sum-chip-sm" style="${style}">${label}</span>`;
    })
    .join('');
  const totalPerDay = summary.total / 5;
  el.innerHTML = `<div class="ia-ind-sum-row">${chips}<span class="ia-ind-sum-total">${totalPerDay.toFixed(1)}h / day</span></div>`;
}

// Wire events for the redesigned IA Schedules view.
function wireIAViewEvents(container, ias) {
  // Sub-tabs
  container.querySelectorAll('[data-ia-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      iaSchedUI.viewMode = btn.dataset.iaSubtab;
      renderIAScheduleView();
    });
  });

  // IA picker chips
  container.querySelectorAll('[data-ia-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      iaSchedUI.focusedIAId = btn.dataset.iaPick;
      renderIAScheduleView();
    });
  });

  // Add duty button
  document.getElementById('ia-add-duty-btn')?.addEventListener('click', () => {
    openDutyPanel(null, iaSchedUI.focusedIAId);
  });

  // Individual view: click a duty cell to edit the duty; click an assignment cell
  // to edit or delete that assignment.
  container.querySelector('.ia-ind-grid-wrap')?.addEventListener('click', e => {
    const dutyCell = e.target.closest('.duty-cell');
    if (dutyCell) {
      const duty = (SchedState.duties || []).find(d => d.id === dutyCell.dataset.dutyId);
      if (duty) openDutyPanel(duty, iaSchedUI.focusedIAId);
      return;
    }
    const cell = e.target.closest('.ia-assign-cell');
    if (cell?.dataset.slot) openIAAssignmentEditor(cell, cell.dataset.day, iaSchedUI.focusedIAId, cell.dataset.slot);
  });

  // All-IAs view: click an assignment cell to edit or delete it.
  container.querySelector('.ia-all-grid-wrap')?.addEventListener('click', e => {
    const cell = e.target.closest('.ia-assign-cell');
    if (cell?.dataset.ia && cell?.dataset.slot) {
      openIAAssignmentEditor(cell, cell.dataset.day || iaSchedUI.activeDay, cell.dataset.ia, cell.dataset.slot);
    }
  });

  // Day tabs (All IAs view)
  container.querySelectorAll('.ia-day-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      iaSchedUI.activeDay = btn.dataset.day;
      renderIAScheduleView();
    });
  });

  // Budget manage toggle
  document.getElementById('ia-budget-manage-btn')?.addEventListener('click', () => {
    document.getElementById('ia-budget-manage-panel')?.classList.toggle('hidden');
  });

  // Budget chip — open the panel straight onto that category's edit form.
  container.querySelectorAll('[data-chip-alloc]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('ia-budget-manage-panel')?.classList.remove('hidden');
      const form = document.getElementById('ia-edit-form-' + chip.dataset.chipAlloc);
      if (!form) return;
      form.classList.remove('hidden');
      // closest() rather than a [data-alloc-id="…"] selector — avoids escaping ids.
      form.closest('.ia-alloc-item')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      form.querySelector('.ia-edit-name-input')?.focus();
    });
  });

  // Add category form
  document.getElementById('ia-add-alloc-btn')?.addEventListener('click', () => {
    document.getElementById('ia-add-alloc-form')?.classList.remove('hidden');
  });
  document.getElementById('ia-cancel-alloc-btn')?.addEventListener('click', () => {
    document.getElementById('ia-add-alloc-form')?.classList.add('hidden');
  });
  document.getElementById('ia-save-alloc-btn')?.addEventListener('click', () => {
    const name  = document.getElementById('ia-new-alloc-name')?.value.trim();
    const color = document.getElementById('ia-new-alloc-color')?.value || '#6366f1';
    const hpd   = parseFloat(document.getElementById('ia-new-alloc-hpd')?.value) || 0;
    if (!name) return;
    const id = 'ia_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
    if (!SchedState.iaAllocations) SchedState.iaAllocations = [];
    SchedState.iaAllocations.push({ id, name, color, hoursPerDay: hpd });
    saveToLocal();
    renderIAScheduleView();
  });

  // Delete category
  container.querySelectorAll('[data-delete-alloc]').forEach(btn => {
    btn.addEventListener('click', () => {
      SchedState.iaAllocations = (SchedState.iaAllocations || []).filter(a => a.id !== btn.dataset.deleteAlloc);
      saveToLocal();
      renderIAScheduleView();
    });
  });

  // Edit category — toggle inline form
  container.querySelectorAll('[data-edit-alloc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('ia-edit-form-' + btn.dataset.editAlloc);
      if (form) form.classList.toggle('hidden');
    });
  });

  // Save inline edit
  container.querySelectorAll('.ia-save-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const aid  = btn.dataset.allocId;
      const form = document.getElementById('ia-edit-form-' + aid);
      if (!form) return;
      const name  = form.querySelector('.ia-edit-name-input')?.value.trim();
      const color = form.querySelector('.ia-edit-color-input')?.value || '#6366f1';
      const hpd   = parseFloat(form.querySelector('.ia-edit-hpd-input')?.value) || 0;
      if (!name) return;
      const alloc = (SchedState.iaAllocations || []).find(a => a.id === aid);
      if (alloc) { alloc.name = name; alloc.color = color; alloc.hoursPerDay = hpd; }
      saveToLocal();
      renderIAScheduleView();
    });
  });

  // Cancel inline edit
  container.querySelectorAll('.ia-cancel-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const form = document.getElementById('ia-edit-form-' + btn.dataset.allocId);
      if (form) form.classList.add('hidden');
    });
  });

  // Coverage is configured on the IA Assignment tab now (not the master grid).
  function goToIAConfig() { navigateTo('ia-assign'); renderIAAssignmentView(); }
  document.getElementById('ia-go-master-btn')?.addEventListener('click', goToIAConfig);
  document.getElementById('ia-empty-go-btn')?.addEventListener('click', goToIAConfig);

  // Back / forward buttons
  document.getElementById('ia-back-btn')?.addEventListener('click', () => {
    navigateTo('class-sched'); renderClassSchedulesView();
  });
  document.getElementById('ia-next-btn')?.addEventListener('click', () => {
    navigateTo('export'); renderImportExportView();
  });

  // CSV download (all IAs summary)
  document.getElementById('ia-summary-csv-btn')?.addEventListener('click', () => {
    if (typeof downloadIAScheduleCSV === 'function') downloadIAScheduleCSV();
  });

  // Print
  document.getElementById('ia-print-btn')?.addEventListener('click', () => {
    const table = container.querySelector('.ia-ind-table, .ia-sched-table');
    if (!table) return;
    const ia = ias.find(i => i.id === iaSchedUI.focusedIAId);
    printScheduleGrid(
      iaSchedUI.viewMode === 'individual' && ia ? `IA Schedule — ${ia.name}` : 'All IAs',
      SchedState.school.name || '', table
    );
  });
}

// ── IA Assignment tab (config: budget categories + coverage plan) ─────────────
// Both tables AUTO-SAVE on every edit — no Save button. This tab is the config
// surface the placement engine (Phase 3) reads. (Note: the IA Schedule tab's
// budget bar still edits the same iaAllocations for now; it's retired in Phase 4.)

// Blocks the coverage plan can target: required instructional blocks + their
// sub-blocks + lunch/recess/morning-meeting. Specials and arrival/dismissal duty
// are excluded (specials teachers cover specials; duties aren't grade blocks).
function _coverableBlockOptions() {
  const SKIP = new Set(['bt_spec', 'bt_arr', 'bt_dis']);
  const out = [];
  (SchedState.blockTypes || []).forEach(bt => {
    if (SKIP.has(bt.id)) return;
    if (bt.subBlocks && bt.subBlocks.length) {
      out.push({ value: bt.id, blockId: bt.id, subId: null, label: bt.name + ' (whole)' });
      bt.subBlocks.forEach(sb => out.push({
        value: bt.id + '|' + sb.id, blockId: bt.id, subId: sb.id, label: bt.name + ' – ' + sb.name,
      }));
    } else {
      out.push({ value: bt.id, blockId: bt.id, subId: null, label: bt.name });
    }
  });
  return out;
}

function _nextAllocColor() {
  const palette = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#6366f1'];
  const used = (SchedState.iaAllocations || []).map(a => a.color);
  return palette.find(c => !used.includes(c)) || palette[(SchedState.iaAllocations || []).length % palette.length];
}

function _iaAllocRow(a) {
  return `
    <tr data-alloc-id="${a.id}">
      <td><input type="text" class="input ia-alloc-name" value="${escHtml(a.name || '')}" placeholder="e.g. Title I" data-alloc-id="${a.id}"></td>
      <td class="req-td-color">
        <div class="req-color-swatch" style="background:${a.color || '#6366f1'}"></div>
        <input type="color" class="req-color-input ia-alloc-color" value="${a.color || '#6366f1'}" data-alloc-id="${a.id}">
      </td>
      <td><input type="number" class="input ia-alloc-hpd" min="0" step="0.25" value="${a.hoursPerDay != null ? a.hoursPerDay : ''}" placeholder="0" data-alloc-id="${a.id}" style="width:90px"></td>
      <td><button class="icon-btn ia-alloc-del" data-alloc-id="${a.id}" title="Remove">×</button></td>
    </tr>`;
}

function _iaCoverageRow(r, blockOpts, allocs, grades) {
  const curVal = r.subId ? `${r.blockId}|${r.subId}` : r.blockId;
  return `
    <tr data-cov-id="${r.id}">
      <td>
        <select class="input ia-cov-block" data-cov-id="${r.id}">
          ${blockOpts.map(o => `<option value="${o.value}" ${o.value === curVal ? 'selected' : ''}>${escHtml(o.label)}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="grade-pref-chips ia-cov-grades" data-cov-id="${r.id}">
          ${grades.map(g => `<button type="button" class="grade-chip grade-chip-xs ${(r.grades || []).includes(g) ? 'active' : ''}" data-grade="${g}">${gradeChipLabel(g)}</button>`).join('')}
        </div>
      </td>
      <td><input type="number" class="input ia-cov-count" min="1" step="1" value="${r.iasPerGrade || 1}" data-cov-id="${r.id}" style="width:70px"></td>
      <td>
        <div class="grade-pref-chips ia-cov-allocs" data-cov-id="${r.id}">
          ${allocs.length
            ? allocs.map(a => `<button type="button" class="alloc-chip ${(r.allowedAllocIds || []).includes(a.id) ? 'active' : ''}" data-alloc-id="${a.id}" style="--ac:${a.color || '#6366f1'}">${escHtml(a.name || '(unnamed)')}</button>`).join('')
            : '<span class="text-muted" style="font-size:11px">Add categories above</span>'}
        </div>
      </td>
      <td><button class="icon-btn ia-cov-del" data-cov-id="${r.id}" title="Remove">×</button></td>
    </tr>`;
}

function renderIAAssignmentView() {
  if (!SchedState.iaAllocations) SchedState.iaAllocations = [];
  if (!SchedState.iaCoverage)    SchedState.iaCoverage    = [];
  const allocs    = SchedState.iaAllocations;
  const coverage  = SchedState.iaCoverage;
  const grades    = gradesSorted();
  const blockOpts = _coverableBlockOptions();

  document.getElementById('view-ia-assign').innerHTML = `
    <div class="view-header">
      <h1>IA Assignment</h1>
      <p class="view-subtitle">Set your budget categories, then plan which blocks need IA coverage. Everything here saves automatically.</p>
    </div>

    <div class="setup-form">
      <div class="form-section">
        <h2 class="form-section-title">Budget Categories</h2>
        <p class="form-hint">Funding buckets and the IA hours per day each covers. The coverage plan below draws from these.</p>
        <div class="req-table-wrap">
          <table class="req-table">
            <thead><tr>
              <th class="req-th-block">Category</th>
              <th class="req-th-color">Color</th>
              <th class="req-th-band" style="width:130px">Hours / day</th>
              <th class="req-th-actions" style="width:60px"></th>
            </tr></thead>
            <tbody id="ia-alloc-tbody">
              ${allocs.length ? allocs.map(_iaAllocRow).join('') : '<tr><td colspan="4" class="text-muted" style="padding:12px">No categories yet.</td></tr>'}
            </tbody>
          </table>
        </div>
        <button class="btn btn-outline btn-sm mt-8" id="ia-add-alloc-row">+ Add category</button>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Coverage Plan</h2>
        <p class="form-hint">One row per block that needs an IA. Pick the block, the grades to cover, how many IAs each grade needs, and which budget categories may fund it.</p>
        ${blockOpts.length ? '' : '<p class="text-muted">Add block types first — the coverage plan draws its blocks from the Block Types tab, plus lunch and recess.</p>'}
        <div class="req-table-wrap">
          <table class="req-table">
            <thead><tr>
              <th style="min-width:170px">Block</th>
              <th style="min-width:150px">Grades covered</th>
              <th style="width:110px">IAs / grade</th>
              <th style="min-width:160px">Funded by</th>
              <th style="width:60px"></th>
            </tr></thead>
            <tbody id="ia-coverage-tbody">
              ${coverage.length
                ? coverage.map(r => _iaCoverageRow(r, blockOpts, allocs, grades)).join('')
                : '<tr><td colspan="5" class="text-muted" style="padding:12px">No coverage rows yet.</td></tr>'}
            </tbody>
          </table>
        </div>
        <button class="btn btn-outline btn-sm mt-8" id="ia-add-coverage-row"${blockOpts.length ? '' : ' disabled'}>+ Add block</button>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Place IAs</h2>
        <p class="form-hint">Assign your IAs across the coverage plan — honoring grade preferences, reserving each IA's own lunch, and balancing lunch/recess duty across the week. <strong>This replaces all current IA assignments.</strong></p>
        ${_masterBuilt() ? '' : '<p class="text-muted">Build the Master Schedule first — placement needs to know where each block lands.</p>'}
        <button class="btn btn-primary" id="ia-place-btn"${_masterBuilt() ? '' : ' disabled'}>Place IAs →</button>
        <div id="ia-place-report" class="ia-place-report"></div>
      </div>
    </div>

    <div class="view-actions">
      <button class="btn btn-outline" data-nav="blocks">← Back to Block Types</button>
      <button class="btn btn-primary" data-nav="master">Continue to Master Schedule →</button>
    </div>
  `;

  _wireIAAssignment();
  if (SchedState._iaPlacementReport) _renderPlacementReport(SchedState._iaPlacementReport);
}

function _masterBuilt() {
  const ms = SchedState.masterSchedule || {};
  return DAYS.some(d => Object.keys(ms[d] || {}).length > 0);
}

function _renderPlacementReport(rep) {
  const el = document.getElementById('ia-place-report');
  if (!el || !rep) return;
  const rows = [`<div class="ia-place-line ia-place-ok">✓ Placed ${(rep.placed / 60).toFixed(1)} IA hours across the week.</div>`];
  if (rep.shortfalls.length)      rows.push(`<div class="ia-place-line ia-place-warn">⚠ ${rep.shortfalls.length} coverage gap(s) — not enough available IAs for some blocks.</div>`);
  if (rep.inconsistencies.length) rows.push(`<div class="ia-place-line ia-place-warn">⚠ ${rep.inconsistencies.length} block(s) covered by different IAs on different days.</div>`);
  if (rep.overBudget.length)      rows.push(`<div class="ia-place-line ia-place-warn">⚠ ${rep.overBudget.length} category/day over its hours budget.</div>`);
  if (rep.ownLunchUnplaced.length) rows.push(`<div class="ia-place-line ia-place-warn">⚠ ${rep.ownLunchUnplaced.length} own-lunch reservation(s) couldn't fit their window.</div>`);
  rows.push(`<button class="btn btn-outline btn-sm mt-8" data-nav="ia">View on IA Schedule →</button>`);
  el.innerHTML = rows.join('');
}

function _wireIAAssignment() {
  const findAlloc = id => (SchedState.iaAllocations || []).find(a => a.id === id);
  const findCov   = id => (SchedState.iaCoverage || []).find(r => r.id === id);

  // ── Budget categories ──
  document.querySelectorAll('.ia-alloc-name').forEach(inp => {
    inp.addEventListener('input',  () => { const a = findAlloc(inp.dataset.allocId); if (a) { a.name = inp.value; saveToLocal(); } });
    // Re-render on blur so the coverage rows' "Funded by" chip labels update.
    inp.addEventListener('change', () => renderIAAssignmentView());
  });
  document.querySelectorAll('.ia-alloc-hpd').forEach(inp => inp.addEventListener('input', () => {
    const a = findAlloc(inp.dataset.allocId); if (a) { const v = parseFloat(inp.value); a.hoursPerDay = isNaN(v) ? 0 : v; saveToLocal(); }
  }));
  document.querySelectorAll('.ia-alloc-color').forEach(inp => {
    inp.addEventListener('input',  () => { const sw = inp.closest('td')?.querySelector('.req-color-swatch'); if (sw) sw.style.background = inp.value; });
    inp.addEventListener('change', () => { const a = findAlloc(inp.dataset.allocId); if (a) { a.color = inp.value; saveToLocal(); renderIAAssignmentView(); } });
  });
  document.querySelectorAll('.ia-alloc-del').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.allocId;
    SchedState.iaAllocations = (SchedState.iaAllocations || []).filter(a => a.id !== id);
    (SchedState.iaCoverage || []).forEach(r => { r.allowedAllocIds = (r.allowedAllocIds || []).filter(x => x !== id); });
    saveToLocal(); renderIAAssignmentView();
  }));
  document.getElementById('ia-add-alloc-row')?.addEventListener('click', () => {
    if (!SchedState.iaAllocations) SchedState.iaAllocations = [];
    SchedState.iaAllocations.push({ id: 'ia_' + uid(), name: '', color: _nextAllocColor(), hoursPerDay: 0 });
    saveToLocal(); renderIAAssignmentView();
  });

  // ── Coverage plan ──
  document.querySelectorAll('.ia-cov-block').forEach(sel => sel.addEventListener('change', () => {
    const r = findCov(sel.dataset.covId); if (!r) return;
    const [bid, sid] = sel.value.split('|'); r.blockId = bid; r.subId = sid || null; saveToLocal();
  }));
  document.querySelectorAll('.ia-cov-count').forEach(inp => inp.addEventListener('input', () => {
    const r = findCov(inp.dataset.covId); if (r) { const v = parseInt(inp.value, 10); r.iasPerGrade = (isNaN(v) || v < 1) ? 1 : v; saveToLocal(); }
  }));
  document.querySelectorAll('.ia-cov-grades .grade-chip-xs').forEach(chip => chip.addEventListener('click', () => {
    const wrap = chip.closest('.ia-cov-grades'); const r = findCov(wrap.dataset.covId); if (!r) return;
    chip.classList.toggle('active');
    r.grades = [...wrap.querySelectorAll('.grade-chip-xs.active')].map(c => c.dataset.grade);
    saveToLocal();
  }));
  document.querySelectorAll('.ia-cov-allocs .alloc-chip').forEach(chip => chip.addEventListener('click', () => {
    const wrap = chip.closest('.ia-cov-allocs'); const r = findCov(wrap.dataset.covId); if (!r) return;
    chip.classList.toggle('active');
    r.allowedAllocIds = [...wrap.querySelectorAll('.alloc-chip.active')].map(c => c.dataset.allocId);
    saveToLocal();
  }));
  document.querySelectorAll('.ia-cov-del').forEach(btn => btn.addEventListener('click', () => {
    SchedState.iaCoverage = (SchedState.iaCoverage || []).filter(r => r.id !== btn.dataset.covId);
    saveToLocal(); renderIAAssignmentView();
  }));
  document.getElementById('ia-add-coverage-row')?.addEventListener('click', () => {
    const opts = _coverableBlockOptions(); if (!opts.length) return;
    if (!SchedState.iaCoverage) SchedState.iaCoverage = [];
    SchedState.iaCoverage.push({
      id: uid(), blockId: opts[0].blockId, subId: opts[0].subId,
      grades: [], iasPerGrade: 1,
      allowedAllocIds: [],  // default: none funded — user turns categories on
    });
    saveToLocal(); renderIAAssignmentView();
  });

  // ── Place IAs (wipe + recompute, behind a confirm) ──
  document.getElementById('ia-place-btn')?.addEventListener('click', () => {
    if (!confirm('This will replace all current IA assignments, including any you\'ve edited by hand on the IA Schedule. Continue?')) return;
    const rep = placeIAs();
    saveToLocal();
    _renderPlacementReport(rep);
  });
}

// ── Phase 3: IA placement engine ──────────────────────────────────────────────
// placeIAs() assigns IAs across the coverage plan. Pure data mutation over
// SchedState.iaSchedule; DETERMINISTIC (no Math.random/Date) so re-runs match.
// Organized around weekly recurring requirements → cross-day consistency + weekly
// parity. Duties (SchedState.duties) live outside iaSchedule and are untouched.
const IA_DUTY_BLOCKS = new Set(['bt_lunch', 'bt_recess']);

function _iaSlotMatches(slotVal, blockId, subId) {
  if (!slotVal) return false;
  const bar  = slotVal.indexOf('|');
  const base = bar >= 0 ? slotVal.slice(0, bar) : slotVal;
  const sub  = bar >= 0 ? slotVal.slice(bar + 1) : null;
  if (base !== blockId) return false;
  return subId ? sub === subId : true;
}

// Contiguous slot-runs where grade G has the target block on `day`.
function _iaBlockOccurrences(day, grade, blockId, subId) {
  const slots  = _autoFillSlots(day);
  const gsched = (SchedState.masterSchedule[day] || {})[grade] || {};
  const runs = []; let cur = null;
  slots.forEach(sl => {
    if (_iaSlotMatches(gsched[sl], blockId, subId)) { if (!cur) { cur = []; runs.push(cur); } cur.push(sl); }
    else cur = null;
  });
  return runs;
}

function _iaInHours(ia, run) {
  if (!ia.startTime || !ia.endTime) return true;   // no hours set → always available
  return timeToMins(run[0]) >= timeToMins(ia.startTime)
      && timeToMins(run[run.length - 1]) + 5 <= timeToMins(ia.endTime);
}

function placeIAs() {
  const sched = SchedState.iaSchedule = {};                 // wipe coverage + own-lunch; duties untouched
  const ias   = (SchedState.staff || []).filter(s => s.role === 'ia');
  const allocs = SchedState.iaAllocations || [];
  const allocById = {}; allocs.forEach(a => { allocById[a.id] = a; });
  const staffOrder = {}; ias.forEach((ia, i) => { staffOrder[ia.id] = i; });
  const staffIdx = ia => staffOrder[ia.id];

  const report = { placed: 0, shortfalls: [], inconsistencies: [], overBudget: [], ownLunchUnplaced: [] };
  const totalMin = {}, dutyMin = {}, allocUsed = {};
  ias.forEach(ia => { totalMin[ia.id] = 0; dutyMin[ia.id] = { bt_lunch: 0, bt_recess: 0 }; });

  const ensure = (day, iaId) => { (sched[day] = sched[day] || {}); return (sched[day][iaId] = sched[day][iaId] || {}); };
  const free   = (day, iaId, run) => { const m = (sched[day] || {})[iaId] || {}; return run.every(sl => !m[sl]); };
  const charge = (allocId, day, mins) => { if (!allocId) return; (allocUsed[allocId] = allocUsed[allocId] || {}); allocUsed[allocId][day] = (allocUsed[allocId][day] || 0) + mins; };

  // ── Step 0: reserve own lunches (unavailable for coverage; not duty; budgeted if allocId) ──
  ias.forEach(ia => {
    const ol = ia.ownLunch;
    if (!ol || !(ol.duration >= 5)) return;
    const n = Math.ceil(ol.duration / 5);
    const winS = timeToMins(ol.windowStart || ia.startTime || '11:00');
    const winE = timeToMins(ol.windowEnd   || ia.endTime   || '13:00');
    const startsFor = day => {
      const slots = _autoFillSlots(day); const out = [];
      for (let i = 0; i + n <= slots.length; i++) {
        const run = slots.slice(i, i + n);
        if (timeToMins(run[0]) >= winS && timeToMins(run[n - 1]) + 5 <= winE && _iaInHours(ia, run) && free(day, ia.id, run)) out.push(run[0]);
      }
      return out;
    };
    const perDay = {}; DAYS.forEach(d => { perDay[d] = startsFor(d); });
    const common = (perDay[DAYS[0]] || []).find(st => DAYS.every(d => perDay[d].includes(st)));  // same time all days if possible
    DAYS.forEach(day => {
      const start = (common && perDay[day].includes(common)) ? common : perDay[day][0];
      if (!start) { report.ownLunchUnplaced.push({ iaId: ia.id, day }); return; }
      const slots = _autoFillSlots(day); const si = slots.indexOf(start);
      const map = ensure(day, ia.id);
      slots.slice(si, si + n).forEach(sl => { map[sl] = { targetType: 'own_lunch', allocId: ol.allocId || null }; });
      charge(ol.allocId, day, ol.duration);
    });
  });

  // ── Step 1: weekly requirements (one per coverage-row × grade with ≥1 occurrence) ──
  const reqs = [];
  (SchedState.iaCoverage || []).forEach(row => {
    (row.grades || []).forEach(grade => {
      const occ = [];
      DAYS.forEach(day => _iaBlockOccurrences(day, grade, row.blockId, row.subId).forEach(run => occ.push({ day, run })));
      if (!occ.length) return;
      reqs.push({
        blockId: row.blockId, subId: row.subId || null, grade,
        need: Math.max(1, row.iasPerGrade || 1),
        allowedAllocIds: row.allowedAllocIds || [],
        isDuty: IA_DUTY_BLOCKS.has(row.blockId), occ,
      });
    });
  });

  // ── Step 2: hardest-first (fewest hours-eligible IAs), deterministic tiebreaks ──
  reqs.forEach(r => {
    r._elig = ias.filter(ia => r.occ.some(o => _iaInHours(ia, o.run))).length;
    r._first = Math.min.apply(null, r.occ.map(o => timeToMins(o.run[0])));
  });
  reqs.sort((a, b) => a._elig - b._elig || a._first - b._first
    || String(a.grade).localeCompare(String(b.grade))
    || String(a.blockId + (a.subId || '')).localeCompare(String(b.blockId + (b.subId || ''))));

  // rank key (lower is better): [preference tier, duty-type minutes (duty only), total load]
  const rankKey = (ia, req) => [
    (ia.gradePreferences || []).includes(req.grade) ? 0 : 1,
    req.isDuty ? dutyMin[ia.id][req.blockId] : 0,
    totalMin[ia.id],
  ];
  const cmp = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);

  const chooseAlloc = (allowed, day) => {
    if (!allowed.length) return null;
    let best = allowed[0], bestRem = -Infinity;
    allowed.forEach(id => {
      const a = allocById[id]; if (!a) return;
      const rem = (a.hoursPerDay || 0) * 60 - ((allocUsed[id] || {})[day] || 0);
      if (rem > bestRem) { bestRem = rem; best = id; }
    });
    return best;
  };
  const assign = (day, ia, run, req) => {
    const allocId = chooseAlloc(req.allowedAllocIds, day);
    const map = ensure(day, ia.id);
    run.forEach(sl => { map[sl] = { allocId, targetType: 'grade', targetId: req.grade, note: '' }; });
    const mins = run.length * 5;
    totalMin[ia.id] += mins;
    if (req.isDuty) dutyMin[ia.id][req.blockId] += mins;
    charge(allocId, day, mins);
    report.placed += mins;
  };

  // ── Step 3: assign each requirement, reusing a consistent team across days ──
  reqs.forEach(req => {
    const daysCoverable = ia => req.occ.filter(o => _iaInHours(ia, o.run)).length;
    const pool = ias.filter(ia => daysCoverable(ia) > 0);
    // Team = up to `need` IAs, preferring (preference tier, most days coverable, parity, load).
    const team = pool.slice().sort((a, b) => {
      const ka = rankKey(a, req), kb = rankKey(b, req);
      return (ka[0] - kb[0]) || (daysCoverable(b) - daysCoverable(a)) || (ka[1] - kb[1]) || (ka[2] - kb[2]) || (staffIdx(a) - staffIdx(b));
    }).slice(0, req.need).map(ia => ia.id);

    const usedIAs = new Set();
    req.occ.forEach(({ day, run }) => {
      const assignedToday = [];
      team.forEach(id => {
        if (assignedToday.length >= req.need) return;
        const ia = ias.find(x => x.id === id);
        if (_iaInHours(ia, run) && free(day, id, run)) { assign(day, ia, run, req); assignedToday.push(id); usedIAs.add(id); }
      });
      while (assignedToday.length < req.need) {
        const cand = pool
          .filter(ia => !assignedToday.includes(ia.id) && _iaInHours(ia, run) && free(day, ia.id, run))
          .sort((a, b) => cmp(rankKey(a, req), rankKey(b, req)) || (staffIdx(a) - staffIdx(b)))[0];
        if (!cand) { report.shortfalls.push({ day, grade: req.grade, blockId: req.blockId, subId: req.subId, needed: req.need, placed: assignedToday.length }); break; }
        assign(day, cand, run, req); assignedToday.push(cand.id); usedIAs.add(cand.id);
      }
    });
    if (usedIAs.size > req.need) report.inconsistencies.push({ grade: req.grade, blockId: req.blockId, subId: req.subId, iasUsed: usedIAs.size, need: req.need });
  });

  // ── Step 4: over-budget warnings (soft; only when a budget is actually set) ──
  allocs.forEach(a => {
    const budget = (a.hoursPerDay || 0) * 60;
    if (budget <= 0) return;
    Object.entries(allocUsed[a.id] || {}).forEach(([day, used]) => { if (used > budget) report.overBudget.push({ allocId: a.id, day, usedMin: used, budgetMin: budget }); });
  });

  SchedState._iaPlacementReport = report;
  return report;
}
