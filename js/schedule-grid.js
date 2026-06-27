// ── Master Schedule Grid ──────────────────────────────────────────────────────

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Module-level so helpers can reference without passing args everywhere
let currentSlots  = [];
let currentGrades = [];

const gridUI = {
  activeDay:  'Monday',
  activeBtId: null,
};

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

// ── Block state ───────────────────────────────────────────────────────────────

function getBlock(day, grade, slot) {
  return SchedState.masterSchedule?.[day]?.[grade]?.[slot] ?? null;
}

function setBlock(day, grade, slot, btId) {
  if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day] = {};
  if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
  if (btId === null) {
    delete SchedState.masterSchedule[day][grade][slot];
  } else {
    SchedState.masterSchedule[day][grade][slot] = btId;
  }
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

function showMissingRequirementsWarning() {
  const bands = SchedState.school.gradeBands || [];
  const missing = SchedState.blockTypes.filter(bt => {
    if (!bt.required) return false;
    if (!bands.length) return false;
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
  currentGrades = gradesSorted();

  // Always sync lunch/recess/morning-meeting blocks from School Info settings
  // before rendering, so loading saved data doesn't lose these fixed blocks.
  if (currentGrades.length) preFillFixedBlocks();

  if (!currentGrades.length) {
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
  const dis = sc.dismissal || sc.studentCampusEnd || sc.dayEnd || '14:30';
  currentSlots = generateTimeSlots(fb, dis);

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

        ${setupWarning}

        <div class="grid-scroll-wrap" id="grid-scroll-wrap">
          <table class="sched-table" id="sched-table" cellspacing="0">
            <thead>
              <tr class="sched-head-row">
                <th class="th-time"></th>
                ${currentGrades.map(g => `<th class="th-grade th-grade-fill" data-grade="${g}" title="Click to auto-fill required blocks for this grade">${GRADE_LABELS[g] || g}<span class="th-fill-hint">auto-fill</span></th>`).join('')}
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
  showMissingRequirementsWarning();
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
      ${blocks.map(bt => `
        <div class="palette-item ${gridUI.activeBtId === bt.id ? 'active' : ''}"
             data-bt-id="${bt.id}"
             style="${gridUI.activeBtId === bt.id ? `background:${bt.color}22` : ''}">
          <span class="palette-dot" style="background:${bt.color}"></span>
          <span class="palette-name">${bt.name}</span>
          ${bt.defaultDuration ? `<span class="palette-dur">${bt.defaultDuration}m</span>` : ''}
        </div>
      `).join('')}
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
    const bt  = SchedState.blockTypes.find(b => b.id === item.dataset.btId);
    const on  = item.dataset.btId === gridUI.activeBtId;
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

function buildCell(slot, grade, prevSlot) {
  const day    = gridUI.activeDay;
  const btId   = getBlock(day, grade, slot);
  const bt     = btId ? SchedState.blockTypes.find(b => b.id === btId) : null;
  const prevId = prevSlot ? getBlock(day, grade, prevSlot) : null;
  const isCont  = !!(btId && btId === prevId);
  const isStart = !!(btId && !isCont);

  let style = '';
  let inner = '';

  if (bt) {
    style = `background:${bt.color}18;border-left:3px solid ${bt.color};`
          + (isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${bt.color};`);
    if (isStart) {
      const mins = blockDuration(day, grade, slot);
      const durLabel = mins >= 10 ? ` · ${mins} min` : '';
      inner = `<span class="cell-label" style="color:${bt.color}">${bt.name}${durLabel}</span>`;
    }
  }

  return `<td class="grid-cell${bt ? ' filled' : ''}${isCont ? ' cont' : ''}"
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

// Single click: auto-fill duration or toggle single cell
function commitClick() {
  const { activeDay } = gridUI;
  const { startGrade, startSlot, paintValue } = drag;

  if (paintValue !== null) {
    const bt = SchedState.blockTypes.find(b => b.id === paintValue);
    const dur = bt?.defaultDuration;
    if (dur && dur >= 5) {
      const startIdx = currentSlots.indexOf(startSlot);
      const numSlots = Math.round(dur / 5);
      for (let i = 0; i < numSlots && startIdx + i < currentSlots.length; i++) {
        setBlock(activeDay, startGrade, currentSlots[startIdx + i], paintValue);
      }
      rebuildTbody();
      return;
    }
  }
  // No duration or eraser: toggle the single cell
  setBlock(activeDay, startGrade, startSlot, paintValue);
  refreshColumnAround(startGrade, startSlot);
}

// Drag: fill the entire grade × time rectangle
function commitRect() {
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
      setBlock(activeDay, currentGrades[g], currentSlots[s], paintValue);
    }
  }
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
  const bt = SchedState.blockTypes.find(b => b.id === drag.moveValue);
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
  const day          = gridUI.activeDay;
  const srcGrade     = drag.moveGrade;
  const destGrade    = drag.endGrade;
  const destStartIdx = currentSlots.indexOf(drag.endSlot);
  const len          = drag.moveSlots.length;

  // Erase source
  drag.moveSlots.forEach(s => setBlock(day, srcGrade, s, null));

  // Write destination
  for (let i = 0; i < len; i++) {
    const destIdx = destStartIdx + i;
    if (destIdx >= currentSlots.length) break;
    setBlock(day, destGrade, currentSlots[destIdx], drag.moveValue);
  }

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

    const day    = gridUI.activeDay;
    const btId   = getBlock(day, grade, s);
    const bt     = btId ? SchedState.blockTypes.find(b => b.id === btId) : null;
    const prevId = prevSlot ? getBlock(day, grade, prevSlot) : null;
    const isCont  = !!(btId && btId === prevId);
    const isStart = !!(btId && !isCont);

    cell.className = `grid-cell${bt ? ' filled' : ''}${isCont ? ' cont' : ''}`;
    if (bt) {
      cell.style.cssText = `background:${bt.color}18;border-left:3px solid ${bt.color};`
        + (isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${bt.color};`);
      if (isStart) {
        const mins = blockDuration(day, grade, s);
        const durLabel = mins >= 10 ? ` · ${mins} min` : '';
        cell.innerHTML = `<span class="cell-label" style="color:${bt.color}">${bt.name}${durLabel}</span>`;
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

// ── Grade header auto-fill ────────────────────────────────────────────────────

function wireGradeHeaders() {
  document.querySelectorAll('.th-grade-fill').forEach(th => {
    th.addEventListener('click', () => autoPopulateGrade(th.dataset.grade, false, true));
  });
}

// Priority order for auto-placing blocks (lower = placed first)
const AUTO_FILL_PRIORITY = {
  bt_cm: 1, bt_ela: 2, bt_math: 3, bt_win: 4, bt_eld: 5, bt_ssh: 6, bt_spec: 7,
};

// clearFirst=true: wipe existing requirement slots before re-placing (used by
// the grade-header click so a manual auto-fill always produces a clean result).
// clearFirst=false (default): only fill gaps, never overwrite existing blocks.
function autoPopulateGrade(grade, silent = false, clearFirst = false) {
  const s     = SchedState.school;
  const bands = s.gradeBands || [];
  const band  = bands.find(b => b.grades.includes(grade));
  if (!band) {
    if (!silent) alert(`${GRADE_LABELS[grade] || grade} is not assigned to a grade band.\nSet up grade bands in Block Types first.`);
    return;
  }

  const requirements = SchedState.blockTypes
    .filter(bt => bt.required && bt.bandMinutes && bt.bandMinutes[band.id] > 0)
    .sort((a, b) => (AUTO_FILL_PRIORITY[a.id] || 99) - (AUTO_FILL_PRIORITY[b.id] || 99));

  if (!requirements.length) {
    if (!silent) alert(`No time requirements are set for the "${band.name}" band.\nConfigure minutes in Block Types first.`);
    return;
  }

  const reqIds   = new Set(requirements.map(r => r.id));
  const fixedIds = new Set(['bt_mm', 'bt_lunch', 'bt_recess']);
  const fb  = s.firstBell  || s.dayStart  || '08:00';
  const dis = s.dismissal  || s.dayEnd    || '14:30';
  const allSlots = generateTimeSlots(fb, dis);

  DAYS.forEach(day => {
    if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day] = {};
    if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
    const sched = SchedState.masterSchedule[day][grade];

    // When called explicitly (grade-header click), clear existing requirement
    // slots so we always get one clean contiguous block per requirement.
    if (clearFirst) {
      allSlots.forEach(slot => { if (reqIds.has(sched[slot])) delete sched[slot]; });
    }

    const occupied = new Set(allSlots.filter(slot => sched[slot]));

    requirements.forEach(req => {
      const slotsNeeded = Math.ceil(req.bandMinutes[band.id] / 5);
      if (!clearFirst) {
        const alreadyPlaced = allSlots.filter(s => sched[s] === req.id).length;
        if (alreadyPlaced >= slotsNeeded) return;
      }
      for (let i = 0; i <= allSlots.length - slotsNeeded; i++) {
        let canPlace = true;
        for (let j = 0; j < slotsNeeded; j++) {
          if (occupied.has(allSlots[i + j])) { canPlace = false; break; }
        }
        if (canPlace) {
          for (let j = 0; j < slotsNeeded; j++) {
            sched[allSlots[i + j]] = req.id;
            occupied.add(allSlots[i + j]);
          }
          break;
        }
      }
    });
  });

  saveToLocal();
  rebuildTbody();
}

function autoPopulateIfEmpty() {
  const fixedIds = new Set(['bt_mm', 'bt_lunch', 'bt_recess']);
  // Check if any instructional block exists across all days/grades
  const hasInstructional = Object.values(SchedState.masterSchedule).some(dayData =>
    Object.values(dayData).some(gradeData =>
      Object.values(gradeData).some(btId => btId && !fixedIds.has(btId))
    )
  );
  if (hasInstructional) return;
  // No instructional blocks yet — auto-fill all grades silently (no alerts)
  gradesSorted().forEach(grade => autoPopulateGrade(grade, true));
}

function switchDay(day) {
  gridUI.activeDay = day;
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
