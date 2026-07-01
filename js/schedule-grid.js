// ── Master Schedule Grid ──────────────────────────────────────────────────────

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Module-level so helpers can reference without passing args everywhere
let currentSlots  = [];
let currentGrades = [];

const gridUI = {
  activeDay:     'Monday',
  activeBtId:    null,
  visibleGrades: null,      // null = all; Set<grade> when filtered
  lockedGrades:  new Set(), // grades protected from any change
  undoStack:     [],        // array of masterSchedule snapshots
};

let _gridKeydownWired = false;

// Drag / paint state
const drag = {
  active:     false,
  hasMoved:   false,
  mode:       'paint',  // 'paint' | 'move'
  startGrade: null,
  startSlot:  null,
  endGrade:   null,
  endSlot:    null,
  paintValue: null,     // btId to write, or null (erase)
  // Move-mode fields:
  moveValue:  null,     // btId being moved
  moveSlots:  [],       // original slots of the block being picked up
  moveGrade:  null,     // original grade
};

// ── Time helpers ──────────────────────────────────────────────────────────────

function generateTimeSlots(start, end) {
  const slots = [];
  const [sh, sm] = (start || '07:30').split(':').map(Number);
  const [eh, em] = (end   || '14:30').split(':').map(Number);
  let h = sh, m = sm;
  const endTotal = eh * 60 + em;
  while (h * 60 + m < endTotal) {
    slots.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
    m += 5;
    if (m >= 60) { h++; m -= 60; }
  }
  return slots;
}

function fmtTime(slot) {
  const [h, m] = slot.split(':').map(Number);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')}`;
}

function fmtTime12(slot) {
  const [h, m] = slot.split(':').map(Number);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}

// ── Duration lookup (for click-to-place default size) ─────────────────────────

function getConfiguredDuration(btId, grade) {
  const parentId = btId.includes('|') ? btId.split('|')[0] : btId;
  const subId    = btId.includes('|') ? btId.split('|')[1] : null;

  // Named special: look up from school.specials
  if (parentId === 'bt_spec' && subId) {
    const sp = (SchedState.school.specials || []).find(s => s.id === subId);
    return sp?.duration || null;
  }

  const bt = SchedState.blockTypes.find(b => b.id === parentId);
  if (!bt) return null;

  // Non-required (uniform) blocks: use defaultDuration
  if (!bt.required) return bt.defaultDuration || null;

  // Required blocks: resolve grade's band
  const bands = SchedState.school.gradeBands || [];
  const band  = bands.find(b => (b.grades || []).includes(grade));
  if (!band) return null;

  // Sub-block of a required block
  if (subId) return bt.subBandMinutes?.[subId]?.[band.id] || null;

  // Full required block
  return bt.bandMinutes?.[band.id] || null;
}

// ── Block state ───────────────────────────────────────────────────────────────

function getBlock(day, grade, slot) {
  return SchedState.masterSchedule?.[day]?.[grade]?.[slot] ?? null;
}

function setBlock(day, grade, slot, btId) {
  if (gridUI.lockedGrades.has(grade)) return;
  if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day] = {};
  if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
  if (btId === null) {
    delete SchedState.masterSchedule[day][grade][slot];
    clearConflict(day, grade, slot);
  } else {
    SchedState.masterSchedule[day][grade][slot] = btId;
  }
}

// ── Conflict helpers ──────────────────────────────────────────────────────────

function getConflicts(day, grade, slot) {
  return SchedState.conflicts?.[day]?.[grade]?.[slot] || [];
}

function addConflict(day, grade, slot, btId) {
  if (!SchedState.conflicts[day])        SchedState.conflicts[day] = {};
  if (!SchedState.conflicts[day][grade]) SchedState.conflicts[day][grade] = {};
  if (!SchedState.conflicts[day][grade][slot]) SchedState.conflicts[day][grade][slot] = [];
  if (!SchedState.conflicts[day][grade][slot].includes(btId)) {
    SchedState.conflicts[day][grade][slot].push(btId);
  }
}

function clearConflict(day, grade, slot) {
  if (SchedState.conflicts?.[day]?.[grade]) delete SchedState.conflicts[day][grade][slot];
}

function clearGradeConflicts(grade) {
  DAYS.forEach(day => {
    if (SchedState.conflicts?.[day]) delete SchedState.conflicts[day][grade];
  });
}

// Manual placement: preserve displaced block as a conflict instead of silently deleting it.
// Auto-fill uses setBlock() directly (no conflicts created).
function placeBlock(day, grade, slot, btId) {
  if (gridUI.lockedGrades.has(grade)) return;
  if (btId === null) { setBlock(day, grade, slot, null); return; }
  const existing = getBlock(day, grade, slot);
  if (existing && existing !== btId) addConflict(day, grade, slot, existing);
  setBlock(day, grade, slot, btId);
}

// ── Undo ─────────────────────────────────────────────────────────────────────

function pushUndoSnapshot() {
  gridUI.undoStack.push({
    schedule:  JSON.parse(JSON.stringify(SchedState.masterSchedule)),
    conflicts: JSON.parse(JSON.stringify(SchedState.conflicts)),
  });
  if (gridUI.undoStack.length > 50) gridUI.undoStack.shift();
  const btn = document.getElementById('undo-btn');
  if (btn) btn.disabled = false;
}

function undoLastMove() {
  const prev = gridUI.undoStack.pop();
  if (!prev) return;
  SchedState.masterSchedule = prev.schedule;
  SchedState.conflicts       = prev.conflicts;
  saveToLocal();
  rebuildTbody();
  showSpecialsConflictWarning();
  showConflictBanner();
  const btn = document.getElementById('undo-btn');
  if (btn) btn.disabled = gridUI.undoStack.length === 0;
}

// ── Grade header cell builder (used by both initial render and rebuildTable) ──

function buildGradeHeaderCell(g) {
  const locked = gridUI.lockedGrades.has(g);
  return `<th class="th-grade${locked ? ' grade-locked' : ''}" data-grade="${g}">
    <span class="th-grade-fill" data-grade="${g}" title="Click to auto-fill required blocks for this grade">
      ${GRADE_LABELS[g] || g}
      <span class="th-fill-hint">${locked ? 'locked' : 'auto-fill'}</span>
    </span>
    <button class="grade-lock-btn${locked ? ' locked' : ''}" data-grade="${g}" title="${locked ? 'Unlock grade' : 'Lock grade'}">
      ${locked ? '🔒' : '🔓'}
    </button>
  </th>`;
}

// Rebuild thead + tbody when grade filter or lock state changes.
function rebuildTable() {
  const allGrades = gradesSorted();
  currentGrades = gridUI.visibleGrades
    ? allGrades.filter(g => gridUI.visibleGrades.has(g))
    : allGrades;
  if (!currentGrades.length) currentGrades = allGrades;

  // Update grade filter chip active states
  const filterAll = document.getElementById('gf-all');
  if (filterAll) filterAll.classList.toggle('active', !gridUI.visibleGrades);
  document.querySelectorAll('.gf-chip[data-gf-grade]').forEach(chip => {
    chip.classList.toggle('active', !gridUI.visibleGrades || gridUI.visibleGrades.has(chip.dataset.gfGrade));
  });

  const headRow = document.querySelector('#sched-table thead tr');
  if (headRow) {
    headRow.innerHTML = '<th class="th-time"></th>' + currentGrades.map(buildGradeHeaderCell).join('');
  }
  document.getElementById('sched-tbody').innerHTML = buildTbodyHtml();
  wireGradeHeaders();
  wireGridPointer();
}

// How many consecutive same-type slots starting at this one (in same grade/day)?
function blockDuration(day, grade, slot) {
  const btId = getBlock(day, grade, slot);
  if (!btId) return 0;
  const start = currentSlots.indexOf(slot);
  if (start < 0) return 0;
  let count = 0;
  for (let i = start; i < currentSlots.length; i++) {
    if (getBlock(day, grade, currentSlots[i]) === btId) count++;
    else break;
  }
  return count * 5;
}

// Shows a red banner if any lunch period falls outside the school day,
// since that causes lunch to be silently skipped in the grid.
function showLunchOutOfHoursWarning() {
  const existing = document.getElementById('lunch-ooh-banner');
  if (existing) existing.remove();

  const sc = SchedState.school;
  const fbMins  = timeToMins(sc.firstBell || sc.dayStart || '08:00');
  const disMins = timeToMins(sc.dismissal || sc.dayEnd || '14:30');
  const bad = (sc.lunchPeriods || []).filter(lp => {
    if (!lp.start) return false;
    const s = timeToMins(lp.start);
    return s < fbMins || s >= disMins;
  });
  if (!bad.length) return;

  const banner = document.createElement('div');
  banner.id = 'lunch-ooh-banner';
  banner.className = 'setup-banner setup-banner-error';
  banner.innerHTML = `
    <div>
      <strong>Lunch time error:</strong>
      <ul>${bad.map(lp =>
        `<li>Lunch at <strong>${fmtTime12(lp.start)}</strong> is outside the school day
         (${fmtTime12(sc.firstBell || '08:00')}–${fmtTime12(sc.dismissal || '14:30')}).
         Check for AM/PM mistakes.</li>`
      ).join('')}</ul>
    </div>
    <button class="btn-link setup-banner-link">Fix in School Info →</button>
  `;
  const scrollWrap = document.getElementById('grid-scroll-wrap');
  if (scrollWrap) scrollWrap.before(banner);
  banner.querySelector('.setup-banner-link').addEventListener('click', () => navigateTo('school'));
}

function showMissingRequirementsWarning() {
  const bands = SchedState.school.gradeBands || [];
  const missing = SchedState.blockTypes.filter(bt => {
    if (!bt.required) return false;
    if (!bands.length) return false;
    if ((bt.subBlocks || []).length) {
      return bands.every(band =>
        (bt.subBlocks || []).every(sub =>
          !((bt.subBandMinutes || {})[sub.id] || {})[band.id]
        )
      );
    }
    return bands.every(band => !bt.bandMinutes || !(bt.bandMinutes[band.id] > 0));
  });
  const existing = document.getElementById('req-missing-banner');
  if (existing) existing.remove();
  if (!missing.length) return;
  const banner = document.createElement('div');
  banner.id = 'req-missing-banner';
  banner.className = 'setup-banner';
  banner.innerHTML = `
    ⚠ These required blocks have <strong>0 minutes</strong> configured and won't be auto-filled:
    <strong>${missing.map(bt => bt.name).join(', ')}</strong>.
    <button class="btn-link setup-banner-link" data-nav="blocks">Go to Block Types to set minutes →</button>
  `;
  const scrollWrap = document.getElementById('grid-scroll-wrap');
  if (scrollWrap) scrollWrap.before(banner);
  banner.querySelector('.setup-banner-link').addEventListener('click', () => {
    navigateTo('blocks'); renderBlocks();
  });
}

// ── Main render ───────────────────────────────────────────────────────────────

function renderMasterSchedule() {
  const allGrades = gradesSorted();
  currentGrades = gridUI.visibleGrades
    ? allGrades.filter(g => gridUI.visibleGrades.has(g))
    : allGrades;
  if (!currentGrades.length) currentGrades = allGrades;

  // Always sync lunch/recess/morning-meeting blocks from School Info settings
  // before rendering, so loading saved data doesn't lose these fixed blocks.
  if (allGrades.length) preFillFixedBlocks();

  if (!allGrades.length) {
    document.getElementById('view-master').innerHTML = `
      <div class="view-header"><h1>Master Schedule</h1></div>
      <div class="empty-state">
        <div class="empty-icon">🏫</div>
        <p>Select grade levels in School Info before building the schedule.</p>
        <button class="btn btn-primary mt-16" data-nav="school">Go to School Info</button>
      </div>
    `;
    return;
  }

  // Start from the earliest of firstBell / studentCampusStart so the grid
  // reflects the full school day even if firstBell hasn't been explicitly saved.
  const sc = SchedState.school;
  const candidates = [sc.firstBell, sc.studentCampusStart, sc.dayStart].filter(t => t && /^\d\d:\d\d/.test(t));
  const fb  = candidates.length ? candidates.reduce((a, b) => a < b ? a : b) : '07:30';
  currentSlots = generateTimeSlots(fb, getDismissalForDay(gridUI.activeDay));

  const lunchPeriods  = sc.lunchPeriods || [];
  const hasLunch   = currentGrades.some(g =>
    lunchPeriods.find(p => p.grades.includes(g) || !p.grades.length) );
  const hasRecess  = Object.keys(sc.gradeRecesses || {}).length > 0;
  const setupWarning = (!hasLunch || !hasRecess)
    ? `<div class="setup-banner">
        ${!hasLunch  ? '⚠ No lunch periods are configured.' : ''}
        ${!hasRecess ? '⚠ No recess is configured.' : ''}
        <button class="btn-link setup-banner-link" data-nav="school">
          Go to School Info to set up lunch &amp; recess →
        </button>
       </div>` : '';

  document.getElementById('view-master').innerHTML = `
    <div class="master-shell">

      <!-- Palette -->
      <div class="palette-panel" id="palette-panel">
        <div class="palette-header">Block Types</div>
        <div class="palette-hint">Select a type, then click or drag on the grid.</div>

        <div class="palette-item palette-eraser ${gridUI.activeBtId === null ? 'active' : ''}" id="palette-eraser">
          <span class="palette-dot" style="background:#d1d5db;border:1px solid #9ca3af"></span>
          <span class="palette-name">Eraser</span>
        </div>

        ${buildPaletteGroups()}
      </div>

      <!-- Right side -->
      <div class="grid-side">
        <div class="grid-top-bar">
          <div>
            <h1 class="grid-title">Master Schedule</h1>
            <p class="grid-subtitle">Broad blocks by grade — detail Specials and IA in the next steps.</p>
          </div>
          <div class="grid-top-actions">
            <button class="btn btn-outline btn-sm" id="undo-btn" title="Undo last change (⌘Z)" disabled>↩ Undo</button>
            <button class="btn btn-outline btn-sm" id="copy-day-btn">Copy day to…</button>
            <button class="btn btn-primary btn-sm" id="master-save-btn">Save</button>
          </div>
        </div>

        <div class="day-tabs-bar">
          ${DAYS.map(d => `
            <button class="day-tab ${d === gridUI.activeDay ? 'active' : ''}" data-day="${d}">
              ${d.slice(0,3)}
              ${(SchedState.school.earlyReleaseDays || []).includes(d)
                ? '<span class="alt-badge">Alt</span>' : ''}
            </button>
          `).join('')}
          <div class="day-tabs-hint">
            ${(SchedState.school.earlyReleaseDays || []).length
              ? `Alt days end at ${SchedState.school.earlyReleaseEnd}` : ''}
          </div>
        </div>

        <div class="grade-filter-bar" id="grade-filter-bar">
          <span class="gf-label">Grades:</span>
          <button id="gf-all" class="gf-chip${!gridUI.visibleGrades ? ' active' : ''}">All</button>
          ${allGrades.map(g => `
            <button class="gf-chip${(!gridUI.visibleGrades || gridUI.visibleGrades.has(g)) ? ' active' : ''}" data-gf-grade="${g}">
              ${GRADE_LABELS[g] || g}
            </button>
          `).join('')}
        </div>

        ${setupWarning}

        <div class="grid-scroll-wrap" id="grid-scroll-wrap">
          <table class="sched-table" id="sched-table" cellspacing="0">
            <thead>
              <tr class="sched-head-row">
                <th class="th-time"></th>
                ${currentGrades.map(buildGradeHeaderCell).join('')}
              </tr>
            </thead>
            <tbody id="sched-tbody">
              ${buildTbodyHtml()}
            </tbody>
          </table>
        </div>

        <div class="grid-footer">
          <button class="btn btn-outline" id="master-back-btn">← Back to Block Types</button>
          <button class="btn btn-primary btn-lg" id="master-next-btn">Continue to Staff Roster →</button>
        </div>
      </div>
    </div>
  `;

  wirePalette();
  syncPaletteHighlight();
  wireGridPointer();
  wireDayTabs();
  wireGradeHeaders();

  document.getElementById('master-save-btn').addEventListener('click', saveMaster);
  document.getElementById('master-next-btn').addEventListener('click', saveMasterAndNext);
  document.getElementById('master-back-btn').addEventListener('click', () => { navigateTo('blocks'); renderBlocks(); });

  // Auto-populate all grades on first entry if no instructional blocks are placed yet
  autoPopulateIfEmpty();
  showLunchOutOfHoursWarning();
  showMissingRequirementsWarning();
  showConflictBanner();
  document.getElementById('copy-day-btn').addEventListener('click', showCopyDayMenu);
}

function buildTbodyHtml() {
  return currentSlots.map((slot, i) => buildRow(slot, currentSlots[i - 1] ?? null)).join('');
}

// ── Palette ───────────────────────────────────────────────────────────────────

function buildPaletteGroups() {
  const catOrder = ['instruction','specials','intervention','behavior','transition','admin'];
  return catOrder.map(cat => {
    const blocks = SchedState.blockTypes.filter(b => b.category === cat);
    if (!blocks.length) return '';
    return `
      <div class="palette-cat-label">${BLOCK_CATEGORIES[cat] || cat}</div>
      ${blocks.map(bt => {
        // bt_spec: expand with individual specials from School Info instead of subBlocks
        if (bt.id === 'bt_spec') {
          const specials = SchedState.school.specials || [];
          if (specials.length) {
            return `
              <div class="palette-parent-label" style="color:${bt.color}">
                <span class="palette-dot" style="background:${bt.color}"></span>
                ${bt.name}
              </div>
              ${specials.map(sp => {
                const cid = `bt_spec|${sp.id}`;
                return `
                  <div class="palette-item palette-sub-item ${gridUI.activeBtId === cid ? 'active' : ''}"
                       data-bt-id="${cid}"
                       style="${gridUI.activeBtId === cid ? `background:${bt.color}22` : ''}">
                    <span class="palette-dot" style="background:${bt.color};opacity:0.75"></span>
                    <span class="palette-name">${sp.name}</span>
                    ${sp.duration ? `<span class="palette-dur">${sp.duration}m</span>` : ''}
                  </div>`;
              }).join('')}`;
          }
        }
        const subs = bt.subBlocks || [];
        if (subs.length) {
          return `
            <div class="palette-parent-label" style="color:${bt.color}">
              <span class="palette-dot" style="background:${bt.color}"></span>
              ${bt.name}
            </div>
            ${subs.map(sub => {
              const cid = `${bt.id}|${sub.id}`;
              return `
                <div class="palette-item palette-sub-item ${gridUI.activeBtId === cid ? 'active' : ''}"
                     data-bt-id="${cid}"
                     style="${gridUI.activeBtId === cid ? `background:${bt.color}22` : ''}">
                  <span class="palette-dot" style="background:${bt.color};opacity:0.75"></span>
                  <span class="palette-name">${sub.name}</span>
                </div>`;
            }).join('')}`;
        }
        return `
          <div class="palette-item ${gridUI.activeBtId === bt.id ? 'active' : ''}"
               data-bt-id="${bt.id}"
               style="${gridUI.activeBtId === bt.id ? `background:${bt.color}22` : ''}">
            <span class="palette-dot" style="background:${bt.color}"></span>
            <span class="palette-name">${bt.name}</span>
            ${bt.defaultDuration ? `<span class="palette-dur">${bt.defaultDuration}m</span>` : ''}
          </div>`;
      }).join('')}
    `;
  }).join('');
}

function wirePalette() {
  document.getElementById('palette-eraser').addEventListener('click', () => {
    gridUI.activeBtId = null;
    syncPaletteHighlight();
  });
  document.querySelectorAll('.palette-item[data-bt-id]').forEach(item => {
    item.addEventListener('click', () => {
      gridUI.activeBtId = item.dataset.btId;
      syncPaletteHighlight();
    });
  });
}

function syncPaletteHighlight() {
  document.getElementById('palette-eraser').classList.toggle('active', gridUI.activeBtId === null);
  document.querySelectorAll('.palette-item[data-bt-id]').forEach(item => {
    const id = item.dataset.btId;
    const parentId = id.includes('|') ? id.split('|')[0] : id;
    const bt  = SchedState.blockTypes.find(b => b.id === parentId);
    const on  = id === gridUI.activeBtId;
    item.classList.toggle('active', on);
    item.style.background = on && bt ? `${bt.color}22` : '';
  });
  // Show grab cursor on filled cells when no block type is selected (move mode)
  const wrap = document.getElementById('grid-scroll-wrap');
  if (wrap) wrap.classList.toggle('no-tool', gridUI.activeBtId === null);
}

// ── Grid row/cell builders ────────────────────────────────────────────────────

function buildRow(slot, prevSlot) {
  const [, m] = slot.split(':').map(Number);
  const showLabel = m % 15 === 0;
  const isMajor   = m === 0;
  return `
    <tr class="sched-row${isMajor ? ' row-hour' : ''}" data-time="${slot}">
      <td class="td-time${showLabel ? '' : ' td-time-minor'}">${showLabel ? fmtTime(slot) : ''}</td>
      ${currentGrades.map(g => buildCell(slot, g, prevSlot)).join('')}
    </tr>
  `;
}

function getBtName(btId) {
  const pid = btId.includes('|') ? btId.split('|')[0] : btId;
  const sub = btId.includes('|') ? btId.split('|')[1] : null;
  if (pid === 'bt_mm') {
    const m = (SchedState.school.morningMeetings || []).find(m => m.id === sub);
    return m?.name || 'Morning Meeting';
  }
  if (pid === 'bt_spec') {
    const sp = (SchedState.school.specials || []).find(s => s.id === sub);
    return sp?.name || 'Specials';
  }
  const bt = SchedState.blockTypes.find(b => b.id === pid);
  if (bt && sub) {
    const s = (bt.subBlocks || []).find(s => s.id === sub);
    return s ? `${bt.name} – ${s.name}` : bt.name;
  }
  return bt?.name || btId;
}

function buildCell(slot, grade, prevSlot) {
  const day    = gridUI.activeDay;
  const btId   = getBlock(day, grade, slot);
  const prevId = prevSlot ? getBlock(day, grade, prevSlot) : null;
  const isCont  = !!(btId && btId === prevId);
  const isStart = !!(btId && !isCont);

  let bt = null, displayName = '', style = '', inner = '';

  if (btId) {
    if (btId.includes('|')) {
      const [parentId, subId] = btId.split('|');
      bt = SchedState.blockTypes.find(b => b.id === parentId) || null;
      if (parentId === 'bt_mm') {
        // Named morning meeting — look up the name from School Info.
        const meeting = (SchedState.school.morningMeetings || []).find(m => m.id === subId);
        displayName = meeting?.name || (bt ? bt.name : 'Morning Meeting');
      } else if (parentId === 'bt_spec') {
        // Named special — look up the name from school.specials.
        const sp = (SchedState.school.specials || []).find(s => s.id === subId);
        displayName = sp?.name || (bt ? bt.name : 'Special');
      } else {
        const sub = bt ? (bt.subBlocks || []).find(s => s.id === subId) : null;
        displayName = sub ? `${bt.name} - ${sub.name}` : (bt ? bt.name : '');
      }
    } else {
      bt = SchedState.blockTypes.find(b => b.id === btId) || null;
      displayName = bt ? bt.name : '';
    }
  }

  const conflicts = getConflicts(day, grade, slot);
  const hasConflict = conflicts.length > 0;

  if (bt) {
    const borderTop = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${bt.color};`;
    const conflictBorder = hasConflict ? 'outline:2px solid #ef4444;outline-offset:-2px;' : '';
    style = `background:${bt.color}18;border-left:3px solid ${bt.color};${borderTop}${conflictBorder}`;
    if (isStart) {
      const mins = blockDuration(day, grade, slot);
      const timeRange = mins >= 10
        ? `<span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(minsToTime(timeToMins(slot) + mins))} · ${mins} min</span>`
        : '';
      const conflictTag = hasConflict
        ? `<span class="cell-conflict-badge">⚠ also: ${conflicts.map(getBtName).join(', ')}</span>`
        : '';
      inner = `<span class="cell-label" style="color:${bt.color}">${displayName}${timeRange}${conflictTag}</span>`;
    }
  } else if (hasConflict && !isCont) {
    // Slot has conflict(s) but no primary block — show the conflicts directly
    const names = conflicts.map(getBtName).join(' + ');
    style = 'outline:2px solid #ef4444;outline-offset:-2px;background:#fef2f2;';
    inner = `<span class="cell-conflict-badge">⚠ ${names}</span>`;
  }

  const lockedCls = gridUI.lockedGrades.has(grade) ? ' grade-locked' : '';
  const conflictCls = hasConflict ? ' cell-has-conflict' : '';
  return `<td class="grid-cell${bt ? ' filled' : ''}${isCont ? ' cont' : ''}${lockedCls}${conflictCls}"
              data-time="${slot}" data-grade="${grade}"
              style="${style}">${inner}</td>`;
}

// ── Pointer-based interaction (rectangle drag) ────────────────────────────────

function wireGridPointer() {
  const wrap = document.getElementById('grid-scroll-wrap');
  if (!wrap) return;

  // Use pointer events so capture works cross-browser
  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointermove', onPointerMove);
  wrap.addEventListener('pointerup',   onPointerUp);
  wrap.addEventListener('pointercancel', onPointerUp);

  // Cmd/Ctrl+Z — undo (registered once for the lifetime of the page)
  if (!_gridKeydownWired) {
    _gridKeydownWired = true;
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
        if (document.getElementById('view-master')?.classList.contains('active')) {
          e.preventDefault();
          undoLastMove();
        }
      }
    });
  }
}

function onPointerDown(e) {
  const cell = e.target.closest('.grid-cell');
  if (!cell) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);

  const grade    = cell.dataset.grade;
  const slot     = cell.dataset.time;
  const existing = getBlock(gridUI.activeDay, grade, slot);

  // Move mode: no active paint tool + clicking a filled block
  if (!gridUI.activeBtId && existing) {
    const blockStart = findBlockStart(gridUI.activeDay, grade, slot);
    const blockLen   = findBlockLength(gridUI.activeDay, grade, blockStart);
    const startIdx   = currentSlots.indexOf(blockStart);
    drag.active     = true;
    drag.hasMoved   = false;
    drag.mode       = 'move';
    drag.startGrade = grade;
    drag.startSlot  = slot;
    drag.endGrade   = grade;
    drag.endSlot    = slot;
    drag.moveValue  = existing;
    drag.moveSlots  = currentSlots.slice(startIdx, startIdx + blockLen);
    drag.moveGrade  = grade;
    return;
  }

  // Paint mode (including eraser)
  const paintValue = (gridUI.activeBtId && existing === gridUI.activeBtId)
    ? null : gridUI.activeBtId;

  drag.active     = true;
  drag.hasMoved   = false;
  drag.mode       = 'paint';
  drag.startGrade = grade;
  drag.startSlot  = slot;
  drag.endGrade   = grade;
  drag.endSlot    = slot;
  drag.paintValue = paintValue;
}

function onPointerMove(e) {
  if (!drag.active) return;
  const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.grid-cell');
  if (!cell) return;

  const grade = cell.dataset.grade;
  const slot  = cell.dataset.time;
  if (grade === drag.endGrade && slot === drag.endSlot) return;

  drag.hasMoved = true;
  drag.endGrade = grade;
  drag.endSlot  = slot;

  if (drag.mode === 'move') {
    showMovePreview();
  } else {
    showDragPreview();
  }
}

function onPointerUp(e) {
  if (!drag.active) return;
  drag.active = false;
  clearDragPreview();
  clearMovePreview();

  if (drag.mode === 'move') {
    if (drag.hasMoved) commitMove();
    // no-move click on a block: do nothing (don't delete it)
  } else if (!drag.hasMoved) {
    commitClick();
  } else {
    commitRect();
  }

  saveToLocal();
}

// Single click: auto-fill configured duration, preserve displaced blocks as conflicts
function commitClick() {
  pushUndoSnapshot();
  const { activeDay } = gridUI;
  const { startGrade, startSlot, paintValue } = drag;

  if (paintValue !== null) {
    const dur = getConfiguredDuration(paintValue, startGrade);
    if (dur && dur >= 5) {
      const startIdx = currentSlots.indexOf(startSlot);
      const numSlots = Math.round(dur / 5);
      for (let i = 0; i < numSlots && startIdx + i < currentSlots.length; i++) {
        placeBlock(activeDay, startGrade, currentSlots[startIdx + i], paintValue);
      }
      showConflictBanner();
      rebuildTbody();
      return;
    }
  }
  placeBlock(activeDay, startGrade, startSlot, paintValue);
  showConflictBanner();
  refreshColumnAround(startGrade, startSlot);
}

// Drag: fill the entire grade × time rectangle
function commitRect() {
  pushUndoSnapshot();
  const { activeDay } = gridUI;
  const { startGrade, startSlot, endGrade, endSlot, paintValue } = drag;

  const g1 = currentGrades.indexOf(startGrade);
  const g2 = currentGrades.indexOf(endGrade);
  const s1 = currentSlots.indexOf(startSlot);
  const s2 = currentSlots.indexOf(endSlot);

  const minG = Math.min(g1, g2), maxG = Math.max(g1, g2);
  const minS = Math.min(s1, s2), maxS = Math.max(s1, s2);

  for (let g = minG; g <= maxG; g++) {
    for (let s = minS; s <= maxS; s++) {
      placeBlock(activeDay, currentGrades[g], currentSlots[s], paintValue);
    }
  }
  showConflictBanner();
  rebuildTbody();
}

// ── Drag preview (highlight rect while dragging) ──────────────────────────────

function showDragPreview() {
  clearDragPreview();

  const g1 = currentGrades.indexOf(drag.startGrade);
  const g2 = currentGrades.indexOf(drag.endGrade);
  const s1 = currentSlots.indexOf(drag.startSlot);
  const s2 = currentSlots.indexOf(drag.endSlot);
  const minG = Math.min(g1, g2), maxG = Math.max(g1, g2);
  const minS = Math.min(s1, s2), maxS = Math.max(s1, s2);

  const bt = drag.paintValue ? SchedState.blockTypes.find(b => b.id === drag.paintValue) : null;
  const previewColor = bt ? bt.color : '#ef4444';

  for (let g = minG; g <= maxG; g++) {
    for (let s = minS; s <= maxS; s++) {
      const cell = document.querySelector(
        `.grid-cell[data-grade="${currentGrades[g]}"][data-time="${currentSlots[s]}"]`);
      if (cell) {
        cell.classList.add('drag-preview');
        cell.style.setProperty('--preview-color', previewColor);
      }
    }
  }
}

function clearDragPreview() {
  document.querySelectorAll('.drag-preview').forEach(c => {
    c.classList.remove('drag-preview');
    c.style.removeProperty('--preview-color');
  });
}

// ── Block-find helpers for move mode ─────────────────────────────────────────

function findBlockStart(day, grade, slot) {
  const btId = getBlock(day, grade, slot);
  if (!btId) return slot;
  let idx = currentSlots.indexOf(slot);
  while (idx > 0 && getBlock(day, grade, currentSlots[idx - 1]) === btId) idx--;
  return currentSlots[idx];
}

function findBlockLength(day, grade, startSlot) {
  const btId = getBlock(day, grade, startSlot);
  if (!btId) return 0;
  let idx = currentSlots.indexOf(startSlot);
  let len = 0;
  while (idx + len < currentSlots.length && getBlock(day, grade, currentSlots[idx + len]) === btId) len++;
  return len;
}

function showMovePreview() {
  clearMovePreview();
  const parentId = drag.moveValue?.includes('|') ? drag.moveValue.split('|')[0] : drag.moveValue;
  const bt = SchedState.blockTypes.find(b => b.id === parentId);
  const color = bt ? bt.color : '#94a3b8';
  // Highlight where block will land
  const targetStartIdx = currentSlots.indexOf(drag.endSlot);
  const len = drag.moveSlots.length;
  for (let i = 0; i < len; i++) {
    const s = targetStartIdx + i;
    if (s >= currentSlots.length) break;
    const cell = document.querySelector(
      `.grid-cell[data-grade="${drag.endGrade}"][data-time="${currentSlots[s]}"]`);
    if (cell) {
      cell.classList.add('move-preview');
      cell.style.setProperty('--preview-color', color);
    }
  }
}

function clearMovePreview() {
  document.querySelectorAll('.move-preview').forEach(c => {
    c.classList.remove('move-preview');
    c.style.removeProperty('--preview-color');
  });
}

function commitMove() {
  pushUndoSnapshot();
  const day          = gridUI.activeDay;
  const srcGrade     = drag.moveGrade;
  const destGrade    = drag.endGrade;
  const destStartIdx = currentSlots.indexOf(drag.endSlot);
  const len          = drag.moveSlots.length;

  // Erase source (also clears conflicts at those slots)
  drag.moveSlots.forEach(s => setBlock(day, srcGrade, s, null));

  // Write destination — use placeBlock so anything already there becomes a conflict
  for (let i = 0; i < len; i++) {
    const destIdx = destStartIdx + i;
    if (destIdx >= currentSlots.length) break;
    placeBlock(day, destGrade, currentSlots[destIdx], drag.moveValue);
  }

  showConflictBanner();
  rebuildTbody();
}

// ── DOM refresh helpers ───────────────────────────────────────────────────────

function rebuildTbody() {
  document.getElementById('sched-tbody').innerHTML = buildTbodyHtml();
  wireGridPointer();
}

// Cheaply refresh cells around a changed slot (for single-cell toggles)
function refreshColumnAround(grade, slot) {
  const tbody = document.getElementById('sched-tbody');
  if (!tbody) return;
  const idx = currentSlots.indexOf(slot);
  // Refresh this slot and the one below (continuation may change)
  [idx, idx + 1].forEach(i => {
    if (i < 0 || i >= currentSlots.length) return;
    const s = currentSlots[i];
    const cell = tbody.querySelector(`td[data-grade="${grade}"][data-time="${s}"]`);
    if (!cell) return;
    const prevSlot = i > 0 ? currentSlots[i - 1] : null;

    const day   = gridUI.activeDay;
    const btId  = getBlock(day, grade, s);
    const prevId = prevSlot ? getBlock(day, grade, prevSlot) : null;
    const isCont  = !!(btId && btId === prevId);
    const isStart = !!(btId && !isCont);

    let bt = null, displayName = '';
    if (btId) {
      if (btId.includes('|')) {
        const [pid, sid] = btId.split('|');
        bt = SchedState.blockTypes.find(b => b.id === pid) || null;
        if (pid === 'bt_mm') {
          const meeting = (SchedState.school.morningMeetings || []).find(m => m.id === sid);
          displayName = meeting?.name || (bt ? bt.name : 'Morning Meeting');
        } else if (pid === 'bt_spec') {
          const sp = (SchedState.school.specials || []).find(sp => sp.id === sid);
          displayName = sp?.name || (bt ? bt.name : 'Special');
        } else {
          const sub = bt ? (bt.subBlocks || []).find(s => s.id === sid) : null;
          displayName = sub ? `${bt.name} - ${sub.name}` : (bt ? bt.name : '');
        }
      } else {
        bt = SchedState.blockTypes.find(b => b.id === btId) || null;
        displayName = bt ? bt.name : '';
      }
    }

    cell.className = `grid-cell${bt ? ' filled' : ''}${isCont ? ' cont' : ''}${gridUI.lockedGrades.has(grade) ? ' grade-locked' : ''}`;
    if (bt) {
      cell.style.cssText = `background:${bt.color}18;border-left:3px solid ${bt.color};`
        + (isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${bt.color};`);
      if (isStart) {
        const mins = blockDuration(day, grade, s);
        const timeRange = mins >= 10
          ? `<span class="cell-time">${fmtTime12(s)} – ${fmtTime12(minsToTime(timeToMins(s) + mins))} · ${mins} min</span>`
          : '';
        cell.innerHTML = `<span class="cell-label" style="color:${bt.color}">${displayName}${timeRange}</span>`;
      } else {
        cell.innerHTML = '';
      }
    } else {
      cell.style.cssText = '';
      cell.innerHTML = '';
    }
  });
}

// ── Day tabs ──────────────────────────────────────────────────────────────────

function wireDayTabs() {
  document.querySelectorAll('.day-tab').forEach(tab => {
    tab.addEventListener('click', () => switchDay(tab.dataset.day));
  });
}

// ── Specials FTE conflict warning ────────────────────────────────────────────────

function showSpecialsConflictWarning() {
  const existingBanner = document.getElementById('specials-conflict-banner');
  if (existingBanner) existingBanner.remove();

  const specials = SchedState.school.specials || [];
  if (!specials.length) return;

  const seen = new Set();
  const conflicts = [];

  DAYS.forEach(day => {
    _autoFillSlots(day).forEach(slot => {
      const bySpec = {};
      gradesSorted().forEach(grade => {
        const btId = SchedState.masterSchedule[day]?.[grade]?.[slot];
        if (!btId?.startsWith('bt_spec|')) return;
        const spId = btId.split('|')[1];
        bySpec[spId] = (bySpec[spId] || 0) + 1;
      });
      Object.entries(bySpec).forEach(([spId, count]) => {
        const sp  = specials.find(s => s.id === spId);
        const max = Math.max(1, Math.floor(sp?.teacherCount || 1));
        if (count > max) {
          const key = `${spId}:${day}`;
          if (!seen.has(key)) {
            seen.add(key);
            conflicts.push({ name: sp?.name || spId, day, slot, count, max });
          }
        }
      });
    });
  });

  if (!conflicts.length) return;

  const banner = document.createElement('div');
  banner.id = 'specials-conflict-banner';
  banner.className = 'setup-banner setup-banner-error';
  const list = conflicts.map(c =>
    `<li><strong>${c.name}</strong> on ${c.day} at ${fmtTime12(c.slot)} — ${c.count} classes, only ${c.max} teacher${c.max !== 1 ? 's' : ''}</li>`
  ).join('');
  banner.innerHTML = `⚠ Specials teacher conflict — same teacher scheduled for multiple classes at the same time:<ul style="margin:6px 0 0 16px;padding:0">${list}</ul>`;

  const topBar = document.querySelector('.grid-top-bar');
  if (topBar) topBar.insertAdjacentElement('afterend', banner);
}

// ── Conflict banner (persistent, driven by SchedState.conflicts) ──────────────

function showConflictBanner() {
  const existing = document.getElementById('conflict-banner');
  if (existing) existing.remove();

  // Collect all conflicts across all days
  const items = [];
  DAYS.forEach(day => {
    const dayConflicts = SchedState.conflicts[day];
    if (!dayConflicts) return;
    Object.entries(dayConflicts).forEach(([grade, slots]) => {
      Object.entries(slots).forEach(([slot, displaced]) => {
        if (!displaced.length) return;
        const primary = getBlock(day, grade, slot);
        items.push({
          day, grade, slot,
          primary: primary ? getBtName(primary) : '(empty)',
          displaced: displaced.map(getBtName),
        });
      });
    });
  });

  if (!items.length) return;

  const banner = document.createElement('div');
  banner.id        = 'conflict-banner';
  banner.className = 'setup-banner setup-banner-error';

  const list = items.map(it =>
    `<li><strong>${GRADE_LABELS[it.grade] || it.grade}</strong> ${it.day} at ${fmtTime12(it.slot)}: ` +
    `<em>${it.primary}</em> over <em>${it.displaced.join(', ')}</em></li>`
  ).join('');

  banner.innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">` +
    `<div><strong>⚠ Double-booked time slots (${items.length}):</strong><ul style="margin:4px 0 0 16px;padding:0">${list}</ul></div>` +
    `<button id="conflict-banner-dismiss" style="background:none;border:none;cursor:pointer;font-size:16px;flex-shrink:0">×</button>` +
    `</div>`;

  const topBar = document.querySelector('.grid-top-bar');
  if (topBar) topBar.insertAdjacentElement('afterend', banner);

  document.getElementById('conflict-banner-dismiss').addEventListener('click', () => banner.remove());
}

// ── Grade header auto-fill ────────────────────────────────────────────────────

function wireGradeHeaders() {
  // Auto-fill on grade label click
  document.querySelectorAll('.th-grade-fill').forEach(span => {
    span.addEventListener('click', () => autoPopulateGrade(span.dataset.grade, false, true));
  });

  // Lock / unlock grade
  document.querySelectorAll('.grade-lock-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const g = btn.dataset.grade;
      if (gridUI.lockedGrades.has(g)) gridUI.lockedGrades.delete(g);
      else gridUI.lockedGrades.add(g);
      rebuildTable();
    });
  });

  // Grade filter — "All" chip
  document.getElementById('gf-all')?.addEventListener('click', () => {
    gridUI.visibleGrades = null;
    rebuildTable();
  });

  // Grade filter — individual chips
  document.querySelectorAll('.gf-chip[data-gf-grade]').forEach(chip => {
    chip.addEventListener('click', () => {
      const g = chip.dataset.gfGrade;
      const all = gradesSorted();
      if (!gridUI.visibleGrades) {
        // Start a filtered view with just this grade
        gridUI.visibleGrades = new Set([g]);
      } else {
        if (gridUI.visibleGrades.has(g)) gridUI.visibleGrades.delete(g);
        else gridUI.visibleGrades.add(g);
        // Reset to "all" if nothing or everything is selected
        if (gridUI.visibleGrades.size === 0 || gridUI.visibleGrades.size === all.length) {
          gridUI.visibleGrades = null;
        }
      }
      rebuildTable();
    });
  });

  // Undo button
  document.getElementById('undo-btn')?.addEventListener('click', undoLastMove);
}

// Priority order for auto-placing blocks (lower = placed first)
const AUTO_FILL_PRIORITY = {
  bt_cm: 1, bt_spec: 2, bt_ela: 3, bt_math: 4, bt_win: 5, bt_eld: 6, bt_ssh: 7,
};

// Returns the slot range that matches renderMasterSchedule exactly.
// Returns the slot array for a given day, respecting early-release dismissal.
// Pass a day string to get day-specific slots; omit for the regular school day.
function _autoFillSlots(day) {
  const sc = SchedState.school;
  const candidates = [sc.firstBell, sc.studentCampusStart, sc.dayStart]
    .filter(t => t && /^\d\d:\d\d/.test(t));
  const fb  = candidates.length ? candidates.reduce((a, b) => a < b ? a : b) : '07:30';
  const dis = day ? getDismissalForDay(day) : (sc.dismissal || sc.studentCampusEnd || sc.dayEnd || '14:30');
  return generateTimeSlots(fb, dis);
}

// Assigns each grade a specific special on specific days, respecting teacher FTE capacity.
// Returns { [grade]: { [day]: spId } } — only days where a grade has a special are populated.
function computeSpecialsRotation(grades, specials) {
  if (!specials || !specials.length || !grades.length) return {};
  const DAYS_LIST = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  const rotation = {};
  grades.forEach(g => { rotation[g] = {}; });

  specials.forEach((sp, si) => {
    const cpw = Math.max(1, sp.classesPerWeek || 1);
    const duration = sp.duration || 45;
    // How many back-to-back classes can this teacher do per day (based on hours)?
    const classesPerTeacherPerDay = Math.max(1, Math.floor((sp.teacherHoursPerDay || 6.5) * 60 / duration));
    // FTE < 1 = part-time but still one-at-a-time; use their hours to cap daily capacity.
    const maxPerDay = Math.max(1, Math.round(classesPerTeacherPerDay * Math.max(sp.teacherCount || 1, 0.5)));

    const dayCount = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0 };
    // Stagger starting day by special index so PE, Music, Library don't all pile on Monday.
    let cursor = si % 5;

    grades.forEach(grade => {
      let sessionsLeft = cpw;
      let attempts = 0;
      while (sessionsLeft > 0 && attempts < 25) {
        attempts++;
        const day = DAYS_LIST[cursor % 5];
        // Grade already has any special this day → skip.
        if (rotation[grade][day]) { cursor++; continue; }
        // Teacher at capacity for this day → skip.
        if (dayCount[day] >= maxPerDay) { cursor++; continue; }
        rotation[grade][day] = sp.id;
        dayCount[day]++;
        sessionsLeft--;
        cursor++;
      }
    });
  });

  return rotation;
}

// Assigns conflict-free start times per (grade, day) using a per-subject sequential cursor.
// For each day, grades sharing the same subject (same teacher) are placed sequentially —
// the cursor advances after each grade so the teacher is never double-booked.
// Grades on different days or with different subjects are fully independent.
// Returns { [grade]: { [day]: "HH:MM" } }.
function computeSpecialsPlacement(grades, specials, rotation) {
  if (!specials.length) return {};

  const result = {};
  grades.forEach(g => { result[g] = {}; });

  DAYS.forEach(day => {
    const daySlotArr = _autoFillSlots(day);
    if (!daySlotArr.length) return;

    // Group grades by which subject they have on this day.
    const bySubject = {};
    grades.forEach(g => {
      const spId = rotation[g]?.[day];
      if (spId) {
        if (!bySubject[spId]) bySubject[spId] = [];
        bySubject[spId].push(g);
      }
    });

    // For each subject on this day, assign grades sequentially (one class at a time for
    // the teacher). Different subjects use independent cursors (different teachers).
    Object.entries(bySubject).forEach(([spId, gradeList]) => {
      const sp = specials.find(s => s.id === spId);
      const numSlots = Math.ceil((sp?.duration || 45) / 5);

      let cursor = 0;
      gradeList.forEach(grade => {
        for (let i = cursor; i <= daySlotArr.length - numSlots; i++) {
          const sched = SchedState.masterSchedule[day]?.[grade] || {};
          let valid = true;
          for (let j = 0; j < numSlots; j++) {
            const sl = daySlotArr[i + j];
            if (sched[sl] && !sched[sl].startsWith('bt_spec')) { valid = false; break; }
          }
          if (valid) {
            result[grade][day] = daySlotArr[i];
            cursor = i + numSlots;
            break;
          }
        }
      });
    });
  });

  return result;
}

// Places specials for a grade using per-day start times from computeSpecialsPlacement.
// Each specials day can have a different start time — eliminates cross-day constraints
// and guarantees conflict-free placement by construction.
function _placeSpecialsForGrade(grade, specialsRotation, clearFirst, placement) {
  const s = SchedState.school;
  const specials = s.specials || [];
  if (!specials.length || !specialsRotation?.[grade]) return;

  const specialsDays = DAYS.filter(d => specialsRotation[grade][d]);
  if (!specialsDays.length) return;

  if (!clearFirst) {
    // Already placed at the correct per-day slot on every specials day → nothing to do.
    const allPlaced = specialsDays.every(day => {
      const startSlot = placement?.[grade]?.[day];
      if (!startSlot) return false;
      const sched = SchedState.masterSchedule[day]?.[grade] || {};
      const spId  = specialsRotation[grade][day];
      const btId  = `bt_spec|${spId}`;
      return sched[startSlot] === btId;
    });
    if (allPlaced) return;
  }

  // Clear existing specials for this grade on all days.
  DAYS.forEach(day => {
    const sched = SchedState.masterSchedule[day]?.[grade];
    if (!sched) return;
    Object.keys(sched).forEach(slot => {
      const sv = sched[slot];
      if (sv === 'bt_spec' || sv?.startsWith('bt_spec|')) delete sched[slot];
    });
  });

  // Place bt_spec|spId on each specials day at its day-specific start slot.
  specialsDays.forEach(day => {
    const startSlot = placement?.[grade]?.[day];
    if (!startSlot) return;

    if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day] = {};
    if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
    const sched = SchedState.masterSchedule[day][grade];
    const spId  = specialsRotation[grade][day];
    const sp    = specials.find(sp => sp.id === spId);
    const numSlots = Math.ceil((sp?.duration || 45) / 5);
    const dayArr   = _autoFillSlots(day);
    const startIdx = dayArr.indexOf(startSlot);
    if (startIdx < 0) return;
    const btId = `bt_spec|${spId}`;
    for (let j = 0; j < numSlots && startIdx + j < dayArr.length; j++) {
      sched[dayArr[startIdx + j]] = btId;
    }
  });
}

// Core placement logic — pure data mutation, no DOM or storage side effects.
// clearFirst=true  → wipe existing requirement slots before placing (grade-header click).
// clearFirst=false → only place blocks that have ZERO slots placed; skip any
//                    block that exists even partially to prevent double-placement.
// onlyDay — if provided, only process that specific day (used by switchDay for efficiency).
function _populateGradeData(grade, clearFirst, onlyDay, specialsRotation, specialsPlacement) {
  const s    = SchedState.school;
  const band = (s.gradeBands || []).find(b => b.grades.includes(grade));
  if (!band) return;

  const requirements = SchedState.blockTypes
    .filter(bt => bt.required && bt.bandMinutes && bt.bandMinutes[band.id] > 0)
    .sort((a, b) => (AUTO_FILL_PRIORITY[a.id] || 99) - (AUTO_FILL_PRIORITY[b.id] || 99));
  if (!requirements.length) return;

  const reqIds = new Set();
  requirements.forEach(r => {
    reqIds.add(r.id);
    (r.subBlocks || []).forEach(sub => reqIds.add(`${r.id}|${sub.id}`));
  });

  // Specials require a common start time across all specials days for this grade.
  // Run holistically before the per-day loop; skip on single-day refreshes.
  if (!onlyDay) {
    _placeSpecialsForGrade(grade, specialsRotation, clearFirst, specialsPlacement);
  }

  const daysToProcess = onlyDay ? [onlyDay] : DAYS;
  daysToProcess.forEach(day => {
    const allSlots = _autoFillSlots(day);
    if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day] = {};
    if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
    const sched = SchedState.masterSchedule[day][grade];

    if (clearFirst) {
      allSlots.forEach(slot => {
        const sv = sched[slot];
        if (!sv) return;
        const pid = sv.includes('|') ? sv.split('|')[0] : sv;
        if (pid === 'bt_spec') return; // handled by _placeSpecialsForGrade
        if (reqIds.has(sv) || requirements.some(r => r.id === pid)) {
          delete sched[slot];
          clearConflict(day, grade, slot);
        }
      });
    }

    const occupied = new Set(allSlots.filter(slot => sched[slot]));

    // Collect all units across every requirement, running upgrade checks first.
    // Then sort largest-first (first-fit-decreasing heuristic) so big blocks
    // claim contiguous space before small blocks, minimising fragmentation.
    const allUnits = [];
    requirements.forEach(req => {
      if (req.id === 'bt_spec') {
        // If specials are configured, _placeSpecialsForGrade handled placement already.
        // Fall back to generic bt_spec only when school.specials isn't set up yet.
        if (!(s.specials || []).length) {
          allUnits.push({ id: 'bt_spec', slots: Math.ceil(req.bandMinutes[band.id] / 5) });
        }
        return;
      }

      const configuredSubs = (req.subBlocks || []).filter(sub =>
        ((req.subBandMinutes || {})[sub.id] || {})[band.id] > 0
      );
      const units = configuredSubs.length
        ? configuredSubs.map(sub => ({
            id:    `${req.id}|${sub.id}`,
            slots: Math.ceil(req.subBandMinutes[sub.id][band.id] / 5),
          }))
        : [{ id: req.id, slots: Math.ceil(req.bandMinutes[band.id] / 5) }];

      // Upgrade check: clear old single-block (bt_ela) when sub-blocks are now configured.
      if (!clearFirst && configuredSubs.length > 0) {
        const hasOldParent = allSlots.some(sl => sched[sl] === req.id);
        const hasAnySub    = units.some(u => allSlots.some(sl => sched[sl] === u.id));
        if (hasOldParent && !hasAnySub) {
          allSlots.forEach(sl => {
            if (sched[sl] === req.id) { delete sched[sl]; occupied.delete(sl); }
          });
        }
      }

      units.forEach(u => allUnits.push(u));
    });

    // Largest blocks first → fewest unplaced blocks when space is tight.
    allUnits.sort((a, b) => b.slots - a.slots);

    allUnits.forEach(unit => {
      if (!clearFirst) {
        const existingCount = allSlots.filter(sl => sched[sl] === unit.id).length;
        if (existingCount >= unit.slots) return;  // fully placed — skip
        if (existingCount > 0) {
          // Displaced or under-represented — clear remnant and re-place whole block.
          allSlots.forEach(sl => {
            if (sched[sl] === unit.id) { delete sched[sl]; occupied.delete(sl); }
          });
        }
      }
      for (let i = 0; i <= allSlots.length - unit.slots; i++) {
        let ok = true;
        for (let j = 0; j < unit.slots; j++) {
          if (occupied.has(allSlots[i + j])) { ok = false; break; }
        }
        if (ok) {
          for (let j = 0; j < unit.slots; j++) {
            sched[allSlots[i + j]] = unit.id;
            occupied.add(allSlots[i + j]);
          }
          break;
        }
      }
    });
  });
}

// Grade-header click: clear and re-place all requirements cleanly for one grade.
function autoPopulateGrade(grade, silent = false, clearFirst = false) {
  if (gridUI.lockedGrades.has(grade)) {
    if (!silent) alert(`${GRADE_LABELS[grade] || grade} is locked. Click the 🔒 in the column header to unlock it first.`);
    return;
  }
  const s    = SchedState.school;
  const band = (s.gradeBands || []).find(b => b.grades.includes(grade));
  if (!band) {
    if (!silent) alert(`${GRADE_LABELS[grade] || grade} is not assigned to a grade band.\nSet up grade bands in Block Types first.`);
    return;
  }
  const hasReqs = SchedState.blockTypes.some(bt => bt.required && bt.bandMinutes && bt.bandMinutes[band.id] > 0);
  if (!hasReqs) {
    if (!silent) alert(`No time requirements are set for the "${band.name}" band.\nConfigure minutes in Block Types first.`);
    return;
  }
  pushUndoSnapshot();
  const grades = gradesSorted();
  const specials = s.specials || [];
  const rotation  = computeSpecialsRotation(grades, specials);
  const placement = computeSpecialsPlacement(grades, specials, rotation);
  _populateGradeData(grade, clearFirst, null, rotation, placement);
  saveToLocal();
  rebuildTbody();
}

// Called from renderMasterSchedule. Runs _populateGradeData for every grade so that:
// • Empty grades get filled on first entry.
// • Grades whose early-release-day blocks were placed at full-day range (old files)
//   get re-placed in the visible morning window (the new skip condition detects that
//   existingCount within the short allSlots is 0 and re-places the block).
// • Blocks displaced by lunch/recess overwriting get re-placed in free space.
// _populateGradeData with clearFirst=false is a no-op for blocks already fully placed
// within the day's slot range, so this is safe to run on every render.
function autoPopulateIfEmpty() {
  const grades = gradesSorted();
  const specials = SchedState.school.specials || [];
  const rotation  = computeSpecialsRotation(grades, specials);
  const placement = computeSpecialsPlacement(grades, specials, rotation);
  grades.forEach(grade => _populateGradeData(grade, false, null, rotation, placement));
  saveToLocal();
  rebuildTbody();
  showSpecialsConflictWarning();
}

// Called after Block Types is saved: fills any required blocks that aren't
// placed yet without touching blocks that already exist.
function fillMissingRequirements() {
  const grades = gradesSorted();
  const specials = SchedState.school.specials || [];
  const rotation  = computeSpecialsRotation(grades, specials);
  const placement = computeSpecialsPlacement(grades, specials, rotation);
  grades.forEach(grade => _populateGradeData(grade, false, null, rotation, placement));
  saveToLocal();
  rebuildTbody();
  showLunchOutOfHoursWarning();
  showMissingRequirementsWarning();
  showSpecialsConflictWarning();
  showConflictBanner();
}

// Returns the dismissal time for a specific day, respecting early-release settings.
function getDismissalForDay(day) {
  const sc = SchedState.school;
  const altDay = (sc.altDays || []).find(ad => ad.day === day && ad.earlyRelease);
  return (altDay && altDay.earlyRelease) || sc.dismissal || sc.studentCampusEnd || sc.dayEnd || '14:30';
}

// Recompute currentSlots for the given day and update the grid.
function switchDay(day) {
  gridUI.activeDay = day;
  const sc = SchedState.school;
  const candidates = [sc.firstBell, sc.studentCampusStart, sc.dayStart]
    .filter(t => t && /^\d\d:\d\d/.test(t));
  const fb = candidates.length ? candidates.reduce((a, b) => a < b ? a : b) : '07:30';
  currentSlots = generateTimeSlots(fb, getDismissalForDay(day));
  // Re-populate grades for this specific day using the updated currentSlots dismissal.
  // This handles alt days where saved blocks may fall outside the shortened slot range.
  const grades = gradesSorted();
  const specials = SchedState.school.specials || [];
  const rotation  = computeSpecialsRotation(grades, specials);
  const placement = computeSpecialsPlacement(grades, specials, rotation);
  grades.forEach(grade => _populateGradeData(grade, false, day, rotation, placement));
  saveToLocal();
  document.querySelectorAll('.day-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.day === day));
  rebuildTbody();
}

// ── Copy day ──────────────────────────────────────────────────────────────────

function showCopyDayMenu() {
  const existing = document.getElementById('copy-day-menu');
  if (existing) { existing.remove(); return; }

  const btn     = document.getElementById('copy-day-btn');
  const targets = DAYS.filter(d => d !== gridUI.activeDay);

  const menu = document.createElement('div');
  menu.id        = 'copy-day-menu';
  menu.className = 'copy-day-menu';
  menu.innerHTML = `
    <div class="copy-day-title">Copy <strong>${gridUI.activeDay}</strong> to:</div>
    ${targets.map(d => `<button class="copy-day-option" data-target="${d}">${d}</button>`).join('')}
    <button class="copy-day-option copy-all" data-target="ALL">All other days</button>
  `;
  btn.insertAdjacentElement('afterend', menu);

  menu.querySelectorAll('.copy-day-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const src   = gridUI.activeDay;
      const dests = opt.dataset.target === 'ALL' ? targets : [opt.dataset.target];
      dests.forEach(dest => {
        SchedState.masterSchedule[dest] = JSON.parse(
          JSON.stringify(SchedState.masterSchedule[src] || {}));
      });
      menu.remove();
      saveToLocal();
      const dest = opt.dataset.target === 'ALL' ? 'all days' : opt.dataset.target;
      const saveBtn = document.getElementById('master-save-btn');
      if (saveBtn) { saveBtn.textContent = `Copied to ${dest} ✓`; setTimeout(() => { saveBtn.textContent = 'Save'; }, 1800); }
    });
  });

  setTimeout(() => {
    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && e.target.id !== 'copy-day-btn') menu.remove();
    }, { once: true });
  }, 0);
}

// ── Save ──────────────────────────────────────────────────────────────────────

function saveMaster() {
  saveToLocal();
  const btn = document.getElementById('master-save-btn');
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save'; }, 1500); }
  if (typeof trackEvent === 'function') trackEvent('master_schedule_saved');
}

function saveMasterAndNext() {
  saveToLocal();
  navigateTo('staff');
  renderStaff();
}

// ── Placeholder views ─────────────────────────────────────────────────────────

function renderSpecialsPlaceholder() {
  document.getElementById('view-specials').innerHTML = `
    <div class="view-header">
      <h1>Specials</h1>
      <p class="view-subtitle">Break your Specials block into PE, Music, Library, and any other specials — assign them to grades and time windows.</p>
    </div>
    <div class="coming-next-card">
      <div class="coming-next-icon">🎨</div>
      <h2>Coming next</h2>
      <p>Here you'll define the Specials rotation — which grades go where, when, and with which teacher. This step pulls directly from the broad Specials blocks you placed in the master schedule.</p>
      <button class="btn btn-outline mt-16" data-nav="master">← Back to Master Schedule</button>
    </div>
  `;
}

function renderIAPlaceholder() {
  document.getElementById('view-ia').innerHTML = `
    <div class="view-header">
      <h1>IA Schedule</h1>
      <p class="view-subtitle">Assign Instructional Assistants to time blocks, grades, and program types. Track minutes across Gen Ed, Title, ELD, and intervention.</p>
    </div>
    <div class="coming-next-card">
      <div class="coming-next-icon">🧑‍🏫</div>
      <h2>Coming next</h2>
      <p>After Specials are detailed, you'll build the IA schedule here — with automatic coverage gap detection and minute tracking by program type.</p>
      <button class="btn btn-outline mt-16" data-nav="specials">← Back to Specials</button>
    </div>
  `;
}

function renderExportPlaceholder() {
  document.getElementById('view-export').innerHTML = `
    <div class="view-header">
      <h1>Save &amp; Export</h1>
      <p class="view-subtitle">Download your schedule as a backup file, restore from a previous file, or export to Excel.</p>
    </div>

    <div class="setup-form">

      <div class="form-section">
        <h2 class="form-section-title">Settings File</h2>
        <p class="form-hint">Download your entire schedule — school info, staff, blocks, and the master schedule grid — as a .json file. Load it later to pick up exactly where you left off.</p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-primary" id="export-json-btn">Download settings (.json)</button>
          <label class="btn btn-outline" style="cursor:pointer;display:inline-flex;align-items:center">
            Load from file
            <input type="file" accept=".json" id="import-json-input" style="display:none" />
          </label>
        </div>
        <div id="import-status" style="font-size:13px;margin-top:10px"></div>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Export to Spreadsheet</h2>
        <p class="form-hint">Download the master schedule as an Excel workbook. Each weekday gets its own tab, plus tabs for School Info and Staff.</p>
        <button class="btn btn-primary" id="export-xlsx-btn" style="margin-top:12px">Download Excel (.xlsx)</button>
      </div>

    </div>

    <div class="view-actions">
      <button class="btn btn-outline" data-nav="master">← Back to Master Schedule</button>
    </div>
  `;

  document.getElementById('export-json-btn').addEventListener('click', exportJSON);
  document.getElementById('import-json-input').addEventListener('change', importJSON);
  document.getElementById('export-xlsx-btn').addEventListener('click', exportXLSX);
}

function exportJSON() {
  const s = SchedState.school;
  const filename = ((s.name || 'schedule').replace(/\s+/g, '_') + '_' + (s.year || '') + '.json').replace(/[^a-zA-Z0-9_.-]/g, '_');
  const blob = new Blob([JSON.stringify(SchedState, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('import-status');
  status.style.color = '';
  status.textContent = 'Loading…';
  try {
    const data = JSON.parse(await file.text());
    if (!data.school || !Array.isArray(data.staff)) throw new Error('Unrecognized file — make sure you selected a Schedule Builder .json file.');
    // Restore state
    Object.assign(SchedState, data);
    // Guard new fields that old files may not have
    SchedState.school.gradeRecesses  = SchedState.school.gradeRecesses  || {};
    SchedState.school.lunchPeriods   = SchedState.school.lunchPeriods   || [];
    SchedState.school.altDays        = SchedState.school.altDays        || [];
    saveToLocal();
    updateSidebarStatus();
    status.style.color = 'var(--green)';
    status.textContent = `Loaded "${data.school.name || 'schedule'}" (${data.school.year || ''}) — navigate to any section to review.`;
  } catch (err) {
    status.style.color = '#ef4444';
    status.textContent = 'Error: ' + err.message;
  }
  e.target.value = '';
}

function exportXLSX() {
  const s      = SchedState.school;
  const grades = gradesSorted();
  const DAYS   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const slots  = generateTimeSlots(s.firstBell || s.dayStart || '08:00', s.dismissal || s.dayEnd || '14:30');

  const blockName = id => {
    const bt = (SchedState.blockTypes || []).find(b => b.id === id);
    return bt ? bt.name : '';
  };

  const wb = XLSX.utils.book_new();

  // ── One tab per weekday ──────────────────────────────────────────
  DAYS.forEach(day => {
    const dayData = ((SchedState.masterSchedule || {})[day]) || {};
    const header  = ['Time', ...grades.map(g => GRADE_LABELS[g] || g)];
    const rows    = [header, ...slots.map(slot => [
      slot,
      ...grades.map(g => {
        const id = (dayData[g] || {})[slot];
        return id ? blockName(id) : '';
      })
    ])];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 7 }, ...grades.map(() => ({ wch: 22 }))];
    XLSX.utils.book_append_sheet(wb, ws, day.slice(0, 3));
  });

  // ── School Info tab ──────────────────────────────────────────────
  const recessMap = typeof computeRecessTimes === 'function' ? computeRecessTimes(s) : {};
  const infoRows  = [
    ['School Name',          s.name || ''],
    ['School Year',          s.year || ''],
    [],
    ['Teacher Contract',     (s.teacherContractStart || '') + ' – ' + (s.teacherContractEnd || '')],
    ['Student Campus Hours', (s.studentCampusStart   || '') + ' – ' + (s.studentCampusEnd   || '')],
    ['First Bell',           s.firstBell  || ''],
    ['Dismissal',            s.dismissal  || ''],
    [],
    ['Morning Meeting',      s.morningMeetingEnabled ? 'Yes' : 'No'],
    ...(s.morningMeetingEnabled ? [
      ['  Start', s.morningMeetingStart || ''],
      ['  End',   s.morningMeetingEnd   || ''],
    ] : []),
    [],
    ['Lunch Periods'],
    ...(s.lunchPeriods || []).map(lp => [
      '  ' + lp.start + ' (' + lp.duration + ' min)',
      'Grades: ' + (lp.grades || []).join(', '),
    ]),
    [],
    ['Recess Schedule'],
    ...grades.flatMap(g => {
      const rs = recessMap[g] || [];
      return rs.map(r => ['  ' + (GRADE_LABELS[g] || g) + ' — ' + r.name, r.start + ' (' + r.duration + ' min)']);
    }),
    [],
    ['Alternate Days'],
    ...(s.altDays || []).map(ad => [
      '  ' + ad.day,
      [ad.lateStart ? 'Late start ' + ad.lateStart : '', ad.earlyRelease ? 'Early release ' + ad.earlyRelease : ''].filter(Boolean).join(', ') || '—',
    ]),
  ];
  const wsInfo  = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo['!cols'] = [{ wch: 28 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wsInfo, 'School Info');

  // ── Staff tab ────────────────────────────────────────────────────
  const staffRows = [
    ['Name', 'Role', 'Grade Assignment'],
    ...(SchedState.staff || []).map(st => [
      st.name,
      ROLE_LABELS[st.role] || st.role || '',
      st.gradeAssignment ? (GRADE_LABELS[st.gradeAssignment] || st.gradeAssignment) : '',
    ]),
  ];
  const wsStaff  = XLSX.utils.aoa_to_sheet(staffRows);
  wsStaff['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsStaff, 'Staff');

  const fname = ((s.name || 'schedule').replace(/\s+/g, '_') + '_' + (s.year || '') + '_schedule.xlsx').replace(/[^a-zA-Z0-9_.-]/g, '_');
  XLSX.writeFile(wb, fname);
}
