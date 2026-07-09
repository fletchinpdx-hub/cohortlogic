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
          <button class="btn btn-outline" id="master-print-btn">Print</button>
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
  document.getElementById('master-print-btn').addEventListener('click', () => {
    const table = document.getElementById('sched-table');
    if (table) printScheduleGrid(`Master Schedule — ${gridUI.activeDay}`, SchedState.school.name || '', table);
  });

  // Auto-populate all grades on first entry if no instructional blocks are placed yet
  autoPopulateIfEmpty();
  showLunchOutOfHoursWarning();
  showMissingRequirementsWarning();
  showConflictBanner();
  showSpecialsCoverageBanner();
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
              ${specials.map((sp, i) => {
                const spColor = sp.color || SP_DEFAULT_COLORS[i % SP_DEFAULT_COLORS.length] || bt.color;
                const cid = `bt_spec|${sp.id}`;
                return `
                  <div class="palette-item palette-sub-item ${gridUI.activeBtId === cid ? 'active' : ''}"
                       data-bt-id="${cid}"
                       style="${gridUI.activeBtId === cid ? `background:${spColor}22` : ''}">
                    <span class="palette-dot" style="background:${spColor}"></span>
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

function getBtColor(btId) {
  if (!btId) return '#94a3b8';
  const pid = btId.includes('|') ? btId.split('|')[0] : btId;
  const sub = btId.includes('|') ? btId.split('|')[1] : null;
  if (pid === 'bt_spec' && sub) {
    const sp = (SchedState.school.specials || []).find(s => s.id === sub);
    if (sp?.color) return sp.color;
  }
  const bt = SchedState.blockTypes.find(b => b.id === pid);
  return bt?.color || '#94a3b8';
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
  const nextSlotIdx = currentSlots.indexOf(slot) + 1;
  const nextId = nextSlotIdx < currentSlots.length ? getBlock(day, grade, currentSlots[nextSlotIdx]) : null;
  const isEnd  = !!(btId && btId !== nextId);

  const conflicts   = getConflicts(day, grade, slot);
  const hasConflict = conflicts.length > 0;
  const lockedCls   = gridUI.lockedGrades.has(grade) ? ' grade-locked' : '';

  // Conflicts come first — overrides specials delegation so split cell is always visible
  if (hasConflict && btId) {
    const primaryColor  = getBtColor(btId);
    const primaryName   = getBtName(btId);
    const conflictBtId  = conflicts[0];
    const conflictColor = getBtColor(conflictBtId);
    const conflictName  = getBtName(conflictBtId);
    // Show labels at: (a) primary block start, OR (b) first slot the conflict appears
    const prevConflicts     = prevSlot ? getConflicts(day, grade, prevSlot) : [];
    const isConflictStart   = !prevConflicts.includes(conflictBtId);
    const showLabels        = isStart || isConflictStart;
    const borderTop    = isCont ? 'border-top:1px solid transparent;' : 'border-top:2px solid #ef4444;';
    const borderBottom = isEnd  ? 'border-bottom:2px solid #ef4444;' : '';
    let leftInner = '', rightInner = '';
    if (showLabels) {
      leftInner  = `<span class="split-label" style="color:${primaryColor}">${primaryName}</span>`;
      rightInner = `<span class="split-label" style="color:${conflictColor}">${conflictName}</span>`;
    }
    return `<td class="grid-cell split-cell filled cell-has-conflict${isCont ? ' cont' : ''}${lockedCls}" data-time="${slot}" data-grade="${grade}" style="${borderTop}${borderBottom}">` +
      `<div class="split-block-wrap">` +
      `<div class="split-half" style="background:${primaryColor}30;border-left:3px solid ${primaryColor};">${leftInner}</div>` +
      `<div class="split-half" style="background:${conflictColor}30;border-left:3px solid ${conflictColor};">${rightInner}</div>` +
      `</div></td>`;
  }

  // For specials slots, delegate to class-level rendering
  if (btId && btId.startsWith('bt_spec')) {
    const specInfo = getSpecialsAtSlot(day, grade, slot);
    if (specInfo) return buildSpecialsCell(slot, grade, specInfo, isCont, isEnd);
  }

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
        // Named special — fall back to subject name from school.specials.
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

  if (bt) {
    const borderTop    = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${bt.color};`;
    const borderBottom = isEnd  ? `border-bottom:2px solid ${bt.color};` : '';
    style = `background:${bt.color}18;border-left:3px solid ${bt.color};${borderTop}${borderBottom}`;
    if (isStart) {
      const mins = blockDuration(day, grade, slot);
      const timeRange = mins >= 10
        ? `<span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(minsToTime(timeToMins(slot) + mins))} · ${mins} min</span>`
        : '';
      inner = `<span class="cell-label" style="color:${bt.color}">${displayName}${timeRange}</span>`;
    }
  } else if (hasConflict && !isCont) {
    // Slot has conflict(s) but no primary block — show the conflict directly
    const conflictBtId = conflicts[0];
    const conflictColor = getBtColor(conflictBtId);
    style = `background:${conflictColor}18;border-left:3px solid ${conflictColor};outline:2px solid #ef4444;outline-offset:-2px;`;
    inner = `<span class="split-label" style="color:${conflictColor}">⚠ ${getBtName(conflictBtId)}</span>`;
  }

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

  // Erase source: if a slot has a displaced conflict, restore that block instead of deleting it
  drag.moveSlots.forEach(s => {
    const slotConflicts = getConflicts(day, srcGrade, s);
    if (slotConflicts.length > 0) {
      SchedState.masterSchedule[day][srcGrade][s] = slotConflicts[0];
      clearConflict(day, srcGrade, s);
    } else {
      setBlock(day, srcGrade, s, null);
    }
  });

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

  const ss = SchedState.specialsSchedule || {};
  if (!Object.keys(ss).length) return;

  // Detect teacher double-booking: same teacher, same day, same startTime
  const teacherSlots = {};
  Object.entries(ss).forEach(([classId, days]) => {
    Object.entries(days).forEach(([day, entry]) => {
      if (!entry.teacherId) return;
      const key = `${entry.teacherId}:${day}:${entry.startTime}`;
      if (!teacherSlots[key]) teacherSlots[key] = [];
      teacherSlots[key].push(classId);
    });
  });

  const conflicts = [];
  Object.entries(teacherSlots).forEach(([key, classIds]) => {
    if (classIds.length <= 1) return;
    const [tid, day, startTime] = key.split(':');
    const teacher = SchedState.staff.find(t => t.id === tid);
    conflicts.push({ teacherName: teacher?.name || 'Unknown teacher', day, startTime, count: classIds.length });
  });

  if (!conflicts.length) return;

  const banner = document.createElement('div');
  banner.id = 'specials-conflict-banner';
  banner.className = 'setup-banner setup-banner-error';
  const list = conflicts.map(c =>
    `<li><strong>${escHtml(c.teacherName)}</strong> on ${c.day} at ${fmtTime12(c.startTime)} — double-booked for ${c.count} classes</li>`
  ).join('');
  banner.innerHTML = `⚠ Specials teacher conflict — same teacher scheduled for multiple classes at the same time:<ul style="margin:6px 0 0 16px;padding:0">${list}</ul>`;

  const topBar = document.querySelector('.grid-top-bar');
  if (topBar) topBar.insertAdjacentElement('afterend', banner);
}

// ── Specials missing warning ──────────────────────────────────────────────────

function showSpecialsMissingWarning(failedGrades) {
  const existing = document.getElementById('specials-missing-banner');
  if (existing) existing.remove();
  if (!failedGrades.length) return;

  const banner = document.createElement('div');
  banner.id = 'specials-missing-banner';
  banner.className = 'setup-banner setup-banner-error';
  const gradeList = failedGrades.map(g => `<li><strong>${escHtml(g)}</strong> — no free slot found where all specials teachers are available. Check whether fixed blocks (recess, lunch) are fragmenting the day, or if teachers are fully booked by other grades.</li>`).join('');
  banner.innerHTML = `⚠ Specials could not be scheduled for ${failedGrades.length === 1 ? 'one grade' : failedGrades.length + ' grades'}:<ul style="margin:6px 0 0 16px;padding:0">${gradeList}</ul>`;

  const topBar = document.querySelector('.grid-top-bar');
  if (topBar) topBar.insertAdjacentElement('afterend', banner);
}

// ── Conflict banner (persistent, driven by SchedState.conflicts) ──────────────

function showConflictBanner() {
  const existing = document.getElementById('conflict-banner');
  if (existing) existing.remove();

  // Group conflicts by (day, grade, primary, displaced) → collect all slots, then show as a time range
  const conflictMap = new Map();
  DAYS.forEach(day => {
    const dayConflicts = SchedState.conflicts[day];
    if (!dayConflicts) return;
    Object.entries(dayConflicts).forEach(([grade, slots]) => {
      Object.entries(slots).forEach(([slot, displaced]) => {
        if (!displaced.length) return;
        const primary = getBlock(day, grade, slot);
        const key = `${day}|${grade}|${primary}|${displaced.join(',')}`;
        if (!conflictMap.has(key)) {
          conflictMap.set(key, {
            day, grade,
            primary:  primary ? getBtName(primary) : '(empty)',
            displaced: displaced.map(getBtName).join(', '),
            slots: [],
          });
        }
        conflictMap.get(key).slots.push(slot);
      });
    });
  });

  if (!conflictMap.size) return;

  const groups = [...conflictMap.values()];

  const banner = document.createElement('div');
  banner.id        = 'conflict-banner';
  banner.className = 'setup-banner setup-banner-error';

  const list = groups.map(g => {
    const sorted   = g.slots.slice().sort();
    const start    = sorted[0];
    const endStart = sorted[sorted.length - 1];
    const endTime  = minsToTime(timeToMins(endStart) + 5);
    const timeStr  = start === endStart
      ? `at ${fmtTime12(start)}`
      : `${fmtTime12(start)} – ${fmtTime12(endTime)}`;
    return `<li><strong>${GRADE_LABELS[g.grade] || g.grade}</strong> ${g.day} ${timeStr}: ` +
      `<em>${g.primary}</em> over <em>${g.displaced}</em></li>`;
  }).join('');

  banner.innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">` +
    `<div><strong>⚠ Double-booked time slots (${groups.length}):</strong><ul style="margin:4px 0 0 16px;padding:0">${list}</ul></div>` +
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

  // Grade filter — "All" chip (clone-replace to prevent listener accumulation across rebuildTable calls)
  const allBtn = document.getElementById('gf-all');
  if (allBtn) {
    const freshAll = allBtn.cloneNode(true);
    allBtn.replaceWith(freshAll);
    freshAll.addEventListener('click', () => { gridUI.visibleGrades = null; rebuildTable(); });
  }

  // Grade filter — individual chips
  document.querySelectorAll('.gf-chip[data-gf-grade]').forEach(chip => {
    const fresh = chip.cloneNode(true);
    chip.replaceWith(fresh);
    fresh.addEventListener('click', () => {
      const g = fresh.dataset.gfGrade;
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

// ── Class-level specials scheduling (v52+) ────────────────────────────────────

// Returns classroom teachers assigned to a specific grade (primary grade).
function getClassesForGrade(grade) {
  return SchedState.staff.filter(s =>
    s.role === 'classroom_teacher' && s.gradeAssignment === grade
  );
}

// Returns { classId: { day: subjectId } }.
// Round-robin rotation: class c gets subjectSeq[s] on day (s + c) % numDays,
// guaranteeing no two classes share the same subject on the same day (up to 5 classes).
// Build a session sequence interleaved so no special repeats before all others have been seen.
// Example: Music×2, Library×1, PE×1 → [Music, Library, PE, Music]
function _buildIntermittentSeq(specials) {
  const subjectIds = specials.map(sp => sp.id);
  const remaining  = {};
  specials.forEach(sp => { remaining[sp.id] = Math.min(sp.classesPerWeek || 1, 5); });
  const result = [];
  let totalLeft = Object.values(remaining).reduce((a, b) => a + b, 0);
  while (totalLeft > 0) {
    let placed = false;
    for (const spId of subjectIds) {
      if (remaining[spId] > 0) {
        result.push(spId);
        remaining[spId]--;
        totalLeft--;
        placed = true;
      }
    }
    if (!placed) break;
  }
  return result;
}

function computeClassSpecialsRotation(classes, specials, gradeOffset = 0) {
  const result = {};
  if (!classes.length || !specials.length) return result;

  const mode = SchedState.school.specialsRotationMode || 'intermittent';

  let sessionSeq;
  if (mode === 'sequential') {
    sessionSeq = specials.flatMap(sp =>
      Array.from({ length: Math.min(sp.classesPerWeek || 1, 5) }, () => sp.id)
    );
  } else {
    sessionSeq = _buildIntermittentSeq(specials);
  }

  const S       = sessionSeq.length;
  const numDays = 5; // always spread across all 5 days so overflow sessions have room

  // Spread step: space sessions of the same subject across non-consecutive days.
  // e.g. S=2, numDays=5 → step=2 → class 0 gets Mon+Wed instead of Mon+Tue.
  const step = S > 0 ? Math.max(Math.floor(numDays / S), 1) : 1;

  // Track per-day, per-subject count so we never exceed teacher capacity.
  const daySpCount = {};
  specials.forEach(sp => {
    daySpCount[sp.id] = {};
    DAYS.forEach(d => { daySpCount[sp.id][d] = 0; });
  });

  classes.forEach((cls, c) => {
    result[cls.id] = {};
    for (let s = 0; s < S && s < 5; s++) {
      const spId = sessionSeq[s];
      const sp   = specials.find(p => p.id === spId);
      const cap  = Math.max((sp?.teacherIds || []).length, 1);

      let dayIdx = (s * step + c + gradeOffset) % numDays;
      let tries  = 0;
      while (tries < numDays) {
        const d = DAYS[dayIdx];
        if (result[cls.id][d] === undefined && daySpCount[spId][d] < cap) break;
        dayIdx = (dayIdx + 1) % numDays;
        tries++;
      }
      const day = DAYS[dayIdx];
      if (result[cls.id][day] === undefined && daySpCount[spId][day] < cap) {
        result[cls.id][day] = spId;
        daySpCount[spId][day]++;
      }
    }
  });

  return result;
}

// Find a common start time for all classes in a grade on each specials day.
// Returns { day: 'HH:MM' }.
// isFreeTeacher(tid, day, startTime, durationMin) is optional — when provided,
// candidate slots are rejected if any required teacher is already booked.
function findGradeSpecialsTime(grade, classes, rotation, specials, isFreeTeacher) {
  const result = {};
  if (!classes.length) return result;

  DAYS.forEach(day => {
    const hasSpecials = classes.some(cls => rotation[cls.id]?.[day]);
    if (!hasSpecials) return;

    const subjectsOnDay = new Set(
      classes.map(cls => rotation[cls.id]?.[day]).filter(Boolean)
    );
    const maxDur = Math.max(...[...subjectsOnDay].map(spId => {
      const sp = specials.find(s => s.id === spId);
      return sp?.duration || 45;
    }));
    const numSlots = Math.ceil(maxDur / 5);
    const daySlots = _autoFillSlots(day);
    const sched    = SchedState.masterSchedule[day]?.[grade] || {};

    for (let i = 0; i <= daySlots.length - numSlots; i++) {
      const candidateStart = daySlots[i];
      let ok = true;

      // Grade's own schedule must be clear
      for (let j = 0; j < numSlots; j++) {
        const sl = daySlots[i + j];
        if (sched[sl] && !sched[sl].startsWith('bt_spec')) { ok = false; break; }
      }
      if (!ok) continue;

      // Every subject's teacher must be free for the full block duration
      if (isFreeTeacher) {
        for (const spId of subjectsOnDay) {
          const sp         = specials.find(s => s.id === spId);
          const teacherIds = sp?.teacherIds || [];
          const dur        = sp?.duration || 45;
          if (teacherIds.length > 0 && !teacherIds.some(tid => isFreeTeacher(tid, day, candidateStart, dur))) {
            ok = false;
            break;
          }
        }
      }

      if (ok) { result[day] = candidateStart; break; }
    }
  });

  return result;
}

// Clears all requirement-driven blocks (ELA, Math, WIN, etc.) for a grade across all days.
// Called when buildSpecialsSchedule can't find a free slot because the schedule was
// populated before specials were configured. After clearing, specials can claim a slot,
// and _populateGradeData will re-fill around them on the next pass.
function _clearRequirementsForGrade(grade) {
  DAYS.forEach(day => {
    const sched = SchedState.masterSchedule[day]?.[grade];
    if (!sched) return;
    Object.keys(sched).forEach(slot => {
      const sv = sched[slot];
      if (!sv || isFixedBlock(sv) || sv.startsWith('bt_spec')) return;
      delete sched[slot];
    });
  });
}

// Find a single daily start time (fixed across all 5 days) for the carousel model:
//   - grade's master schedule is clear at that time on every day
//   - enough teachers free per special on every day to cover all classes needing it
// Returns a 'HH:MM' string or null.
function findGradeFixedTime(grade, classes, rotation, specials, isFreeTeacher) {
  if (!classes.length || !specials.length) return null;
  const maxDur   = Math.max(...specials.map(sp => sp.duration || 45));
  const numSl    = Math.ceil(maxDur / 5);
  const refSlots = _autoFillSlots('Monday');

  for (let i = 0; i <= refSlots.length - numSl; i++) {
    const candidateStart = refSlots[i];
    let ok = true;

    for (const day of DAYS) {
      if (!ok) break;
      const slots = _autoFillSlots(day);
      const si    = slots.indexOf(candidateStart);
      if (si < 0) { ok = false; break; }

      const sched = SchedState.masterSchedule[day]?.[grade] || {};
      for (let j = 0; j < numSl; j++) {
        const sl = slots[si + j];
        if (!sl) { ok = false; break; }
        const sv = sched[sl];
        if (sv && !sv.startsWith('bt_spec')) { ok = false; break; }
      }
      if (!ok || !isFreeTeacher) continue;

      // Verify enough teachers are free for each special on this day.
      for (const sp of specials) {
        const needed    = classes.filter(cls => rotation[cls.id]?.[day] === sp.id).length;
        if (!needed) continue;
        const freeCount = (sp.teacherIds || []).filter(tid =>
          isFreeTeacher(tid, day, candidateStart, sp.duration || 45)
        ).length;
        if (freeCount < needed) { ok = false; break; }
      }
    }

    if (ok) return candidateStart;
  }
  return null;
}

// Rebuilds SchedState.specialsSchedule from scratch for all grades, then writes
// grade-level bt_spec blocks back into masterSchedule for auto-populate awareness.
function buildSpecialsSchedule() {
  const specials = SchedState.school.specials || [];

  // Clear all bt_spec from masterSchedule
  DAYS.forEach(day => {
    gradesSorted().forEach(grade => {
      const sched = SchedState.masterSchedule[day]?.[grade];
      if (!sched) return;
      Object.keys(sched).forEach(slot => {
        const v = sched[slot];
        if (v === 'bt_spec' || (v && v.startsWith('bt_spec|'))) delete sched[slot];
      });
    });
  });

  SchedState.specialsSchedule = {};
  if (!specials.length) return;

  const booked = {};
  // Mark every 5-min slot the teacher is occupied (not just the start) so
  // overlapping blocks across grades are correctly detected as conflicts.
  const book = (tid, day, startTime, durationMin) => {
    if (!tid) return;
    if (!booked[tid])      booked[tid]      = {};
    if (!booked[tid][day]) booked[tid][day] = new Set();
    const allSlots = _autoFillSlots(day);
    const si = allSlots.indexOf(startTime);
    if (si < 0) return;
    const n = Math.ceil((durationMin || 45) / 5);
    for (let j = 0; j < n && si + j < allSlots.length; j++) {
      booked[tid][day].add(allSlots[si + j]);
    }
  };
  const isFree = (tid, day, startTime, durationMin) => {
    if (!tid || !booked[tid]?.[day]) return true;
    const allSlots = _autoFillSlots(day);
    const si = allSlots.indexOf(startTime);
    if (si < 0) return true;
    const n = Math.ceil((durationMin || 45) / 5);
    for (let j = 0; j < n && si + j < allSlots.length; j++) {
      if (booked[tid][day].has(allSlots[si + j])) return false;
    }
    return true;
  };
  const busyCount = tid => {
    const db = booked[tid];
    if (!db) return 0;
    return Object.values(db).reduce((s, slots) => s + slots.size, 0);
  };
  // Pick the free teacher with the fewest total booked slots so load spreads evenly.
  const leastBusyFree = (teachers, day, start, dur) =>
    teachers.filter(t => isFree(t, day, start, dur))
            .sort((a, b) => busyCount(a) - busyCount(b))[0] || null;

  const failedGrades = [];
  const allGrades = gradesSorted();
  allGrades.forEach(grade => {
    const classes = getClassesForGrade(grade);

    if (!classes.length) {
      // No classroom teachers for this grade — use a simple grade-level placement
      // (one subject per day, sequentially) so specials still appear on the schedule.
      const subjectSeq = [];
      specials.forEach(sp => {
        const cpw = Math.min(sp.classesPerWeek || 1, 5);
        for (let i = 0; i < cpw; i++) subjectSeq.push(sp.id);
      });
      const synthId = `_grade_${grade}`;
      const syntheticRotation = { [synthId]: {} };
      subjectSeq.slice(0, 5).forEach((spId, i) => { syntheticRotation[synthId][DAYS[i]] = spId; });
      let gradeTime = findGradeSpecialsTime(grade, [{ id: synthId }], syntheticRotation, specials, isFree);
      // If the schedule is full (populated before specials were configured), clear requirement
      // blocks so specials can claim a slot; _populateGradeData will re-fill around them.
      if (!Object.keys(gradeTime).length) {
        _clearRequirementsForGrade(grade);
        gradeTime = findGradeSpecialsTime(grade, [{ id: synthId }], syntheticRotation, specials, isFree);
      }
      if (!Object.keys(gradeTime).length) { failedGrades.push(grade); return; }

      DAYS.forEach(day => {
        const startTime = gradeTime[day];
        if (!startTime) return;
        const spId = syntheticRotation[synthId][day];
        if (!spId) return;
        const sp       = specials.find(s => s.id === spId);
        const dur      = sp?.duration || 45;
        const numSlots = Math.ceil(dur / 5);
        const daySlots = _autoFillSlots(day);
        const startIdx = daySlots.indexOf(startTime);
        if (startIdx < 0) return;
        // Book the teacher so later grades don't conflict
        const tid = leastBusyFree(sp?.teacherIds || [], day, startTime, dur);
        if (tid) book(tid, day, startTime, dur);
        if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day]        = {};
        if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
        const sched = SchedState.masterSchedule[day][grade];
        const btId  = `bt_spec|${spId}`;
        for (let j = 0; j < numSlots && startIdx + j < daySlots.length; j++) {
          sched[daySlots[startIdx + j]] = btId;
        }
      });
      return;
    }

    // Carousel model: find ONE fixed time valid across all 5 days where all specials
    // teachers are free simultaneously. If not found, clear instruction blocks and retry.
    const gradeIdx = allGrades.indexOf(grade);
    const rotation = computeClassSpecialsRotation(classes, specials, gradeIdx);
    let fixedTime  = findGradeFixedTime(grade, classes, rotation, specials, isFree);
    if (!fixedTime) {
      _clearRequirementsForGrade(grade);
      fixedTime = findGradeFixedTime(grade, classes, rotation, specials, isFree);
    }
    if (!fixedTime) {
      // No carousel slot available — schedule each class/session individually instead.
      // Each class finds its own best open slot per day without requiring a common time.
      classes.forEach(cls => { SchedState.specialsSchedule[cls.id] = {}; });
      let anyFallbackPlaced = false;
      const fbRotation = computeClassSpecialsRotation(classes, specials, gradeIdx);

      classes.forEach(cls => {
        specials.forEach(sp => {
          const needed    = Math.min(sp.classesPerWeek || 1, 5);
          const dur       = sp.duration || 45;
          const numSl     = Math.ceil(dur / 5);
          const pool      = sp.teacherIds || [];
          let fill        = needed;
          const rotDays   = DAYS.filter(d => fbRotation[cls.id]?.[d] === sp.id);
          const otherDays = DAYS.filter(d => !rotDays.includes(d));

          for (const day of [...rotDays, ...otherDays]) {
            if (fill <= 0) break;
            if (SchedState.specialsSchedule[cls.id][day]?.teacherId) continue;
            const daySlots   = _autoFillSlots(day);
            const gradeSched = SchedState.masterSchedule[day]?.[grade] || {};
            for (let i = 0; i <= daySlots.length - numSl; i++) {
              let ok = true;
              for (let j = 0; j < numSl; j++) {
                if (gradeSched[daySlots[i + j]]) { ok = false; break; }
              }
              if (!ok) continue;
              const tid = leastBusyFree(pool, day, daySlots[i], dur);
              if (!tid) continue;
              SchedState.specialsSchedule[cls.id][day] = { subjectId: sp.id, teacherId: tid, startTime: daySlots[i] };
              book(tid, day, daySlots[i], dur);
              if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day]        = {};
              if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
              const gSched = SchedState.masterSchedule[day][grade];
              for (let j = 0; j < numSl && i + j < daySlots.length; j++) {
                gSched[daySlots[i + j]] = `bt_spec|${sp.id}`;
              }
              anyFallbackPlaced = true;
              fill--;
              break;
            }
          }
        });
      });

      if (!anyFallbackPlaced) failedGrades.push(grade);
      return;
    }

    // Initialise specialsSchedule with fixed time + rotation subject for every class/day.
    classes.forEach(cls => {
      SchedState.specialsSchedule[cls.id] = {};
      DAYS.forEach(day => {
        const spId = rotation[cls.id]?.[day];
        if (!spId) return;
        SchedState.specialsSchedule[cls.id][day] = { subjectId: spId, startTime: fixedTime, teacherId: null };
      });
    });

    // Assign teachers: for each day+special, least-busy-free from the pool.
    // Multiple classes may share the same special simultaneously (carousel) — each
    // gets its own teacher drawn from the pool in load-balanced order.
    DAYS.forEach(day => {
      specials.forEach(sp => {
        const dur  = sp.duration || 45;
        const pool = sp.teacherIds || [];
        classes.filter(cls => rotation[cls.id]?.[day] === sp.id).forEach(cls => {
          const tid = leastBusyFree(pool, day, fixedTime, dur);
          if (tid) {
            SchedState.specialsSchedule[cls.id][day].teacherId = tid;
            book(tid, day, fixedTime, dur);
          }
        });
      });
    });

    // Write generic bt_spec to masterSchedule at fixedTime on every day that has sessions,
    // so auto-populate treats those slots as occupied. Generic 'bt_spec' (no subject suffix)
    // is used because multiple subjects run simultaneously in the carousel.
    const maxDur   = Math.max(...specials.map(sp => sp.duration || 45));
    const numSlots = Math.ceil(maxDur / 5);
    DAYS.forEach(day => {
      if (!classes.some(cls => SchedState.specialsSchedule[cls.id]?.[day]?.subjectId)) return;
      const daySlots = _autoFillSlots(day);
      const startIdx = daySlots.indexOf(fixedTime);
      if (startIdx < 0) return;
      if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day]        = {};
      if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
      const sched = SchedState.masterSchedule[day][grade];
      for (let j = 0; j < numSlots && startIdx + j < daySlots.length; j++) {
        sched[daySlots[startIdx + j]] = 'bt_spec';
      }
    });

    // Recovery pass: some classes may still be short of cpw if teacher capacity was
    // exceeded during the main booking. Try the carousel fixed time first on any
    // unscheduled day, then fall back to any open slot in the grade's schedule.
    classes.forEach(cls => {
      const ss = SchedState.specialsSchedule[cls.id];
      specials.forEach(sp => {
        const needed = Math.min(sp.classesPerWeek || 1, 5);
        const placed = DAYS.filter(d => ss[d]?.subjectId === sp.id && ss[d]?.teacherId).length;
        if (placed >= needed) return;

        const dur   = sp.duration || 45;
        const numSl = Math.ceil(dur / 5);
        const pool  = sp.teacherIds || [];
        let fill    = needed - placed;

        // Pass 1: try to place at the carousel fixed time on an unscheduled day.
        for (const day of DAYS) {
          if (fill <= 0) break;
          if (ss[day]?.teacherId) continue;
          if (ss[day]?.subjectId && ss[day].subjectId !== sp.id) continue;
          const daySlots   = _autoFillSlots(day);
          const si         = daySlots.indexOf(fixedTime);
          if (si < 0) continue;
          const gradeSched = SchedState.masterSchedule[day]?.[grade] || {};
          let ok = true;
          for (let j = 0; j < numSl; j++) {
            const sv = gradeSched[daySlots[si + j]];
            if (sv && sv !== 'bt_spec') { ok = false; break; }
          }
          if (!ok) continue;
          const tid = leastBusyFree(pool, day, fixedTime, dur);
          if (!tid) continue;
          ss[day] = { subjectId: sp.id, teacherId: tid, startTime: fixedTime };
          book(tid, day, fixedTime, dur);
          fill--;
        }

        // Pass 2: if still short, find any open slot in the grade schedule (off-carousel).
        for (const day of DAYS) {
          if (fill <= 0) break;
          if (ss[day]?.teacherId) continue;
          if (ss[day]?.subjectId && ss[day].subjectId !== sp.id) continue;
          const daySlots   = _autoFillSlots(day);
          const gradeSched = SchedState.masterSchedule[day]?.[grade] || {};
          for (let i = 0; i <= daySlots.length - numSl; i++) {
            let ok = true;
            for (let j = 0; j < numSl; j++) {
              const sv = gradeSched[daySlots[i + j]];
              if (sv) { ok = false; break; }
            }
            if (!ok) continue;
            const tid = leastBusyFree(pool, day, daySlots[i], dur);
            if (!tid) continue;
            ss[day] = { subjectId: sp.id, teacherId: tid, startTime: daySlots[i] };
            book(tid, day, daySlots[i], dur);
            if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day]        = {};
            if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
            const gSched = SchedState.masterSchedule[day][grade];
            for (let j = 0; j < numSl && i + j < daySlots.length; j++) {
              gSched[daySlots[i + j]] = `bt_spec|${sp.id}`;
            }
            fill--;
            break;
          }
        }
      });
    });
  });

  showSpecialsMissingWarning(failedGrades);
}

// Returns specials info for a grade at a given slot, or null if no specials.
// { all: [...entries], isStart, isUnified, totalClasses }
function getSpecialsAtSlot(day, grade, slot) {
  const ss      = SchedState.specialsSchedule || {};
  const classes = getClassesForGrade(grade);

  // Grades with no classroom teachers use a synthetic single-class placement.
  // Build a stub entry from masterSchedule so the cell still renders richly.
  if (!classes.length) {
    const btId = SchedState.masterSchedule[day]?.[grade]?.[slot];
    if (!btId || !btId.startsWith('bt_spec|')) return null;
    const subId   = btId.split('|')[1];
    const specials = SchedState.school.specials || [];
    const sp       = specials.find(s => s.id === subId);
    if (!sp) return null;
    const daySlots  = _autoFillSlots(day);
    const slotIdx   = daySlots.indexOf(slot);
    const numSlots  = Math.ceil((sp.duration || 45) / 5);
    // Find the start of this block by scanning backwards
    let startIdx = slotIdx;
    while (startIdx > 0 && SchedState.masterSchedule[day]?.[grade]?.[daySlots[startIdx - 1]] === btId) startIdx--;
    return {
      all:          [{ subjectId: subId, teacherId: null, startTime: daySlots[startIdx],
                       cls: { id: `_grade_${grade}` }, isStart: slotIdx === startIdx,
                       duration: sp.duration || 45 }],
      isStart:      slotIdx === startIdx,
      isUnified:    true,
      totalClasses: 1,
    };
  }

  const specials  = SchedState.school.specials || [];
  const daySlots  = _autoFillSlots(day);
  const slotIdx   = daySlots.indexOf(slot);
  if (slotIdx < 0) return null;

  const matching = [];
  classes.forEach(cls => {
    const entry = ss[cls.id]?.[day];
    if (!entry?.startTime) return;
    const sp       = specials.find(s => s.id === entry.subjectId);
    const numSlots = Math.ceil((sp?.duration || 45) / 5);
    const startIdx = daySlots.indexOf(entry.startTime);
    if (startIdx >= 0 && slotIdx >= startIdx && slotIdx < startIdx + numSlots) {
      matching.push({ ...entry, cls, isStart: slotIdx === startIdx, duration: sp?.duration || 45 });
    }
  });

  if (!matching.length) return null;
  return {
    all:          matching,
    isStart:      matching[0].isStart,
    // Unified only when every class is present AND all on the same subject.
    // Carousel (all classes, different subjects) intentionally returns false.
    isUnified:    matching.length === classes.length &&
                  matching.every(e => e.subjectId === matching[0].subjectId),
    totalClasses: classes.length,
  };
}

// Renders a grid cell for a specials time slot (unified or split).
function buildSpecialsCell(slot, grade, specInfo, isCont, isEnd) {
  const bt        = SchedState.blockTypes.find(b => b.id === 'bt_spec');
  const fallback  = bt?.color || '#f97316';
  const lockedCls = gridUI.lockedGrades.has(grade) ? ' grade-locked' : '';

  if (specInfo.isUnified) {
    const entry   = specInfo.all[0];
    const sp      = (SchedState.school.specials || []).find(s => s.id === entry.subjectId);
    const color   = sp?.color || fallback;
    const teacher = SchedState.staff.find(t => t.id === entry.teacherId);
    const borderTop    = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${color};`;
    const borderBottom = isEnd  ? `border-bottom:2px solid ${color};` : '';
    let inner = '';
    if (specInfo.isStart) {
      const mins    = entry.duration;
      const endSlot = minsToTime(timeToMins(slot) + mins);
      const subLine = sp
        ? `<span class="cell-specials-subject">${escHtml(sp.name)}${teacher ? ' · ' + escHtml(teacher.name.split(' ')[0]) : ''}</span>`
        : '';
      inner = `<span class="cell-label" style="color:${color}">Specials` +
        `<span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(endSlot)} · ${mins} min</span>` +
        `${subLine}</span>`;
    }
    const style = `background:${color}18;border-left:3px solid ${color};${borderTop}${borderBottom}`;
    return `<td class="grid-cell filled${isCont ? ' cont' : ''}${lockedCls}" data-time="${slot}" data-grade="${grade}" style="${style}">${inner}</td>`;
  }

  // Split: some classes have specials, others do not at this time
  const entry   = specInfo.all[0];
  const sp      = (SchedState.school.specials || []).find(s => s.id === entry.subjectId);
  const color   = sp?.color || fallback;
  const teacher = SchedState.staff.find(t => t.id === entry.teacherId);
  const borderTop    = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${color};`;
  const borderBottom = isEnd  ? `border-bottom:2px solid ${color};` : '';
  let leftInner = '', rightInner = '';
  if (specInfo.isStart) {
    leftInner  = `<span class="split-label" style="color:${color}">Specials</span>`;
    rightInner = `<span class="split-label" style="color:#64748b">${specInfo.all.length} of ${specInfo.totalClasses} classes</span>`;
  }
  return `<td class="grid-cell split-cell${isCont ? ' cont' : ''}${lockedCls}" data-time="${slot}" data-grade="${grade}" style="${borderTop}${borderBottom}">` +
    `<div class="split-block-wrap">` +
    `<div class="split-half split-half-specials" style="background:${color}18;border-left:3px solid ${color};">${leftInner}</div>` +
    `<div class="split-half split-half-regular" style="background:#f1f5f9;border-left:3px solid #94a3b8;">${rightInner}</div>` +
    `</div></td>`;
}

// Core placement logic — pure data mutation, no DOM or storage side effects.
// clearFirst=true  → wipe existing requirement slots before placing (grade-header click).
// clearFirst=false → only place blocks that have ZERO slots placed; skip any
//                    block that exists even partially to prevent double-placement.
// onlyDay — if provided, only process that specific day (used by switchDay for efficiency).
function _populateGradeData(grade, clearFirst, onlyDay) {
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
        if (pid === 'bt_spec') return; // specials handled by buildSpecialsSchedule
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
        // buildSpecialsSchedule already placed bt_spec for configured specials subjects.
        // Fall back to generic bt_spec block only when no specials subjects are configured.
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
  buildSpecialsSchedule();
  _populateGradeData(grade, clearFirst, null);
  saveToLocal();
  rebuildTbody();
  showSpecialsCoverageBanner();
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
  buildSpecialsSchedule();
  preFillFixedBlocks();
  gradesSorted().forEach(grade => _populateGradeData(grade, false, null));
  saveToLocal();
  rebuildTbody();
  showSpecialsConflictWarning();
}

// Called after Block Types is saved: fills any required blocks that aren't
// placed yet without touching blocks that already exist.
function fillMissingRequirements() {
  buildSpecialsSchedule();
  preFillFixedBlocks();
  gradesSorted().forEach(grade => _populateGradeData(grade, false, null));
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
  buildSpecialsSchedule();
  gradesSorted().forEach(grade => _populateGradeData(grade, false, day));
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

function renderIAScheduleView() {
  const container = document.getElementById('view-ia');
  if (!container) return;

  const ias = SchedState.staff.filter(s => s.role === 'ia');

  if (!ias.length) {
    container.innerHTML = `
      <div class="view-header"><h1>IA Schedule</h1></div>
      <div class="empty-state">
        <div class="empty-icon">🧑‍🏫</div>
        <p>No instructional assistants on staff yet. Add IAs in the Staff Roster to get started.</p>
        <button class="btn btn-primary mt-16" data-nav="staff">Go to Staff Roster →</button>
      </div>`;
    container.querySelector('[data-nav]')?.addEventListener('click', () => { navigateTo('staff'); renderStaff(); });
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

  const allocs = SchedState.iaAllocations || [];

  // ── Summary (All IAs) mode ──────────────────────────────────────────────────
  if (iaSchedUI.viewMode === 'all') {
    container.innerHTML = `
      <div class="ia-summary-shell">
        <div class="ia-summary-top-bar">
          <div>
            <h1 class="grid-title">All IAs — Weekly Summary</h1>
            <p class="grid-subtitle">Hours by budget category for each instructional assistant.</p>
          </div>
          <div class="ia-summary-actions">
            <button class="btn btn-outline btn-sm" id="ia-summary-csv-btn">Download CSV</button>
            <button class="btn btn-outline btn-sm" id="ia-summary-print-btn">Print</button>
            <button class="btn btn-outline btn-sm" id="ia-back-to-grid-btn">← Back to Grid</button>
          </div>
        </div>
        <div class="grid-scroll-wrap" id="ia-summary-wrap">
          ${buildIASummaryTableHtml(ias)}
        </div>
      </div>`;
    wireIAScheduleEvents(container, ias);
    return;
  }

  // ── Grid mode ───────────────────────────────────────────────────────────────
  const dayTabsHtml = DAYS.map(day =>
    `<button class="ia-day-tab${day === iaSchedUI.activeDay ? ' active' : ''}" data-day="${day}">${day.slice(0,3)}</button>`
  ).join('');

  const focusedIA = ias.find(ia => ia.id === iaSchedUI.focusedIAId);

  container.innerHTML = `
    <div class="master-shell">
      <div class="palette-panel ia-palette-panel" id="ia-palette-panel">

        <div class="ia-panel-section">
          <div class="ia-section-label">Budget Category</div>
          <div class="palette-item palette-eraser${iaSchedUI.activeAllocId === null ? ' active' : ''}" id="ia-eraser">
            <span class="palette-dot" style="background:#d1d5db;border:1px solid #9ca3af"></span>
            <span class="palette-name">Eraser</span>
          </div>
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
            <div class="ia-alloc-form-btns">
              <button class="btn btn-primary btn-sm" id="ia-save-alloc-btn">Add</button>
              <button class="btn btn-outline btn-sm" id="ia-cancel-alloc-btn">Cancel</button>
            </div>
          </div>
        </div>

        <div class="ia-panel-section">
          <div class="ia-section-label">Assign to</div>
          <div class="ia-target-type-toggle">
            <button class="ia-target-type-btn${iaSchedUI.targetType === 'grade' ? ' active' : ''}" data-target-type="grade">Whole Grade</button>
            <button class="ia-target-type-btn${iaSchedUI.targetType === 'class' ? ' active' : ''}" data-target-type="class">One Class</button>
          </div>
          <div class="ia-target-hint">${iaSchedUI.targetType === 'grade' ? 'IA supports the entire grade.' : 'IA supports one teacher\'s class.'}</div>
          <div class="ia-target-picker" id="ia-target-picker">
            ${buildIATargetPickerHtml()}
          </div>
        </div>

        <div class="ia-panel-section ia-mini-summary-section">
          <div class="ia-section-label">This IA — <span id="ia-mini-name">${escHtml(focusedIA?.name || '')}</span></div>
          <div id="ia-mini-summary-content"></div>
          <div id="ia-mini-total" class="ia-mini-total-row"></div>
        </div>

      </div>

      <div class="grid-side">
        <div class="grid-top-bar">
          <div>
            <h1 class="grid-title">IA Schedule</h1>
            <p class="grid-subtitle">Select a budget category and assign to a grade or class, then paint.</p>
          </div>
          <div class="ia-top-bar-right">
            <div class="ia-day-tabs">${dayTabsHtml}</div>
            <button class="btn btn-outline btn-sm ia-all-btn" id="ia-view-all-btn">All IAs →</button>
          </div>
        </div>

        <div class="grid-scroll-wrap" id="ia-grid-wrap">
          ${buildIAGrid(iaSchedUI.activeDay, ias)}
        </div>

        <div class="grid-footer">
          <button class="btn btn-outline" id="ia-back-btn">← Back to Specials Schedule</button>
          <button class="btn btn-outline" id="ia-print-btn">Print</button>
        </div>
      </div>
    </div>`;

  _refreshIAPanel();
  wireIAScheduleEvents(container, ias);
}

function buildIAPaletteHtml(allocs) {
  return allocs.map(alloc => {
    const active = alloc.id === iaSchedUI.activeAllocId;
    const border = active ? `border-left:3px solid ${alloc.color};background:${alloc.color}12` : 'border-left:3px solid transparent';
    return `
      <div class="ia-alloc-item${active ? ' active' : ''}" data-alloc-id="${alloc.id}" style="${border}">
        <div class="ia-alloc-header">
          <span class="palette-dot" style="background:${alloc.color}"></span>
          <span class="ia-alloc-name">${escHtml(alloc.name)}</span>
          <button class="ia-alloc-delete" data-delete-alloc="${alloc.id}" title="Remove">×</button>
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
  const slots  = _autoFillSlots(day);
  const dayMap = (SchedState.iaSchedule || {})[day] || {};
  const allocs = SchedState.iaAllocations || [];

  const headCols = ias.map(ia =>
    `<th class="th-ia-name" title="${escHtml(ia.name)}">${escHtml(ia.name)}</th>`
  ).join('');

  const rows = slots.map((slot, idx) => {
    const prevSlot = idx > 0 ? slots[idx - 1] : null;
    const mm       = parseInt(slot.split(':')[1]);
    const isMajor  = mm === 0;
    const showLbl  = isMajor || mm === 30;

    const cells = ias.map(ia => {
      const iaSlots   = dayMap[ia.id] || {};
      const entry     = iaSlots[slot];
      const prevEntry = prevSlot ? (iaSlots[prevSlot] || null) : null;

      if (!entry) {
        return `<td class="ia-cell empty" data-ia="${ia.id}" data-slot="${slot}"></td>`;
      }

      const alloc  = allocs.find(a => a.id === entry.allocId);
      const color  = alloc?.color || '#6b7280';
      const isCont = prevEntry &&
        prevEntry.allocId    === entry.allocId &&
        prevEntry.targetType === entry.targetType &&
        prevEntry.targetId   === entry.targetId;
      const targetLabel = _iaTargetLabel(entry);
      const inner = isCont ? '' : `
        <div class="ia-cell-label">${escHtml(alloc?.name || '')}</div>
        ${targetLabel ? `<div class="ia-cell-grade">${escHtml(targetLabel)}</div>` : ''}`;
      const title = [alloc?.name, targetLabel].filter(Boolean).join(' • ');

      return `<td class="ia-cell filled${isCont ? ' cont' : ''}" data-ia="${ia.id}" data-slot="${slot}"
               style="background:${color}22;border-left:3px solid ${color};border-right:1px solid ${color}40"
               title="${escHtml(title)}">${inner}</td>`;
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

  const topBar = document.querySelector('.grid-top-bar');
  if (topBar) topBar.insertAdjacentElement('afterend', banner);
}

// ── Specials Schedule View ────────────────────────────────────────────────────

const specialsSchedUI = { selectedTeacherId: null };

const classSchedUI = {
  selectedGrade:   null,
  selectedClassId: null,
  viewMode:        'single',   // 'single' | 'compare'
  compareDay:      'Monday',
};

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
    container.querySelector('[data-nav]')?.addEventListener('click', () => { navigateTo('specials'); renderSpecialsView(); });
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

    coverageHtml = `
      <div class="coverage-panel">
        <div class="coverage-panel-header">
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
          <button class="btn btn-outline" id="specials-sched-back-btn">← Back to Master Schedule</button>
          <button class="btn btn-outline" id="specials-sched-print-btn">Print</button>
        </div>
      </div>
    </div>`;

  container.querySelector('#specials-sched-back-btn').addEventListener('click', () => {
    navigateTo('master'); renderMasterSchedule();
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
}

function printScheduleGrid(title, subtitle, tableEl) {
  const cssHref     = document.querySelector('link[href*="schedule.css"]')?.href || '/css/schedule.css';
  const baseHref    = document.querySelector('link[href*="styles.css"]')?.href   || '/css/styles.css';
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <link rel="stylesheet" href="${baseHref}">
    <link rel="stylesheet" href="${cssHref}">
    <style>
      @page { size: landscape; margin: 0.5in; }
      body { margin: 0; padding: 16px 20px; background: #fff; }
      .print-header { margin-bottom: 10px; }
      .print-title { font-size: 16px; font-weight: 700; color: #1e293b; }
      .print-subtitle { font-size: 12px; color: #64748b; margin-top: 2px; }
      .sched-table { width: 100%; font-size: 10px; }
      .sched-table .th-time, .sched-table .td-time { font-size: 9px; }
    </style>
  </head><body>
    <div class="print-header">
      <div class="print-title">${title}</div>
      ${subtitle ? `<div class="print-subtitle">${subtitle}</div>` : ''}
    </div>
    ${tableEl.outerHTML}
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 600);
}

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
    container.querySelector('[data-nav]')?.addEventListener('click', () => { navigateTo('master'); renderMasterSchedule(); });
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
        </div>
      </div>
    </div>`;

  container.querySelector('#class-sched-back-btn').addEventListener('click', () => {
    navigateTo('master'); renderMasterSchedule();
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
      Auto-fill the master schedule to generate specials assignments.
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

      return `<td class="grid-cell filled${isCont ? ' cont' : ''}" data-time="${slot}" style="${style}">${inner}</td>`;
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

// ── Class Schedules view helpers ──────────────────────────────────────────────

// Returns display data for one slot in a class's schedule, or null if empty.
function getClassSlotEntry(slot, grade, day, classId) {
  const btId = SchedState.masterSchedule[day]?.[grade]?.[slot];
  if (!btId) return null;

  if (btId.startsWith('bt_spec')) {
    const ss = SchedState.specialsSchedule?.[classId]?.[day];
    if (!ss?.startTime) return null;
    const specials = SchedState.school.specials || [];
    const sp       = specials.find(s => s.id === ss.subjectId);
    const teacher  = SchedState.staff.find(t => t.id === ss.teacherId);
    const dur      = sp?.duration || 45;
    const daySlots = _autoFillSlots(day);
    const slotIdx  = daySlots.indexOf(slot);
    const startIdx = daySlots.indexOf(ss.startTime);
    if (startIdx < 0 || slotIdx < startIdx || slotIdx >= startIdx + Math.ceil(dur / 5)) return null;
    return {
      btId,
      isSpecials:  true,
      subjectName: sp?.name || 'Specials',
      teacherName: teacher ? teacher.name.split(' ')[0] : '',
      color:       sp?.color || '#f97316',
      duration:    dur,
      slotIdx,
      startIdx,
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

  return `<td class="grid-cell filled${isCont ? ' cont' : ''}" data-time="${slot}" style="${style}">${inner}</td>`;
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
