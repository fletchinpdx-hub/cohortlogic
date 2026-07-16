// ── Master Schedule Grid ──────────────────────────────────────────────────────

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Module-level so helpers can reference without passing args everywhere
let currentSlots  = [];
let currentGrades = [];

const gridUI = {
  activeDay:     'Monday',
  activeBtId:    null,
  tool:          'move',    // 'move' | 'erase' | btId — which palette tool is selected.
                             // activeBtId mirrors this: null for move/erase, btId for paint.
                             // Kept as a separate field (rather than just null) so
                             // pointerdown can tell "no block selected because Move is
                             // active" apart from "no block selected because Erase is
                             // active" — those need different click behavior.
  visibleGrades: null,      // null = all; Set<grade> when filtered
  lockedGrades:  new Set(), // grades protected from any change
  undoStack:     [],        // array of masterSchedule snapshots
  warningsCollapsed: false, // collapsed state of the consolidated warnings panel
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
  // Fixed blocks (lunch/recess/morning meeting) own their slot — a manual paint or
  // move never overwrites them or splits them into a conflict half-cell.
  if (existing && existing !== btId && isFixedBlock(existing) && !isFixedBlock(btId)) return;
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
  showRecessSpacingWarning();
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
// Duration of the block's SOLID, contiguous extent from `slot` — used for the
// cell's time-range label. Stops at a conflict slot because those render as
// split cells, not as part of the solid block; counting through them made the
// label's end time overshoot the visible block (e.g. "· 20 min" on a block that
// only looks 10 min tall because the rest is a conflict zone).
function blockDuration(day, grade, slot) {
  const btId = getBlock(day, grade, slot);
  if (!btId) return 0;
  const start = currentSlots.indexOf(slot);
  if (start < 0) return 0;
  let count = 0;
  for (let i = start; i < currentSlots.length; i++) {
    const s = currentSlots[i];
    if (getBlock(day, grade, s) !== btId) break;
    if (getConflicts(day, grade, s).length) break;
    count++;
  }
  return count * 5;
}

// Given a bt_recess slot, returns { id, lunchAdjacent } for the matching recess in
// the grade's recess config, or null. Used to tell a movable free-floating recess
// from a hard-anchored lunch recess when the user tries to drag it.
function _recessBlockInfo(day, grade, slot) {
  const bt = getBlock(day, grade, slot);
  if (!bt || bt.split('|')[0] !== 'bt_recess') return null;
  if (typeof computeRecessTimes !== 'function') return null;
  const map       = computeRecessTimes(SchedState.school)[grade] || [];
  const startSlot = findBlockStart(day, grade, slot);
  const startMins = timeToMins(startSlot);
  const hit = map.find(r => {
    const st = timeToMins(r.start);
    return startMins >= st && startMins < st + Number(r.duration);
  }) || map.find(r => r.start === startSlot);
  return hit ? { id: hit.id, lunchAdjacent: !!hit.lunchAdjacent } : null;
}

// Drop of a free-floating recess: record a manual start-time override on its recess
// config so computeRecessTimes honors the new position on every future render.
function _commitRecessMove(destStartIdx) {
  const newStart = currentSlots[destStartIdx];
  const { grade, recessId } = drag.recessMove || {};
  const cfg = ((SchedState.school.gradeRecesses || {})[grade] || []).find(x => x.id === recessId);
  if (!newStart || !cfg) { rebuildTbody(); return; }
  pushUndoSnapshot();
  cfg.manualStart = newStart;
  preFillFixedBlocks();
  saveToLocal();
  rebuildTbody();
  showRecessSpacingWarning();
}

// Removes stale conflict data involving fixed blocks: any conflict that references a
// fixed block, or that sits under a fixed-block primary. Cleans up "PE | Recess"
// style splits left over from before fixed blocks were protected from drags.
function _purgeFixedBlockConflicts() {
  DAYS.forEach(day => {
    const dayC = SchedState.conflicts?.[day];
    if (!dayC) return;
    Object.keys(dayC).forEach(grade => {
      const gc = dayC[grade];
      Object.keys(gc).forEach(slot => {
        if (isFixedBlock(getBlock(day, grade, slot))) { delete gc[slot]; return; }
        const kept = (gc[slot] || []).filter(b => !isFixedBlock(b));
        if (kept.length) gc[slot] = kept; else delete gc[slot];
      });
    });
  });
}

// Shows a red banner if any lunch period falls outside the school day,
// since that causes lunch to be silently skipped in the grid.
// ── Consolidated warnings panel ───────────────────────────────────────────────
// Every schedule warning renders into ONE collapsible panel above the grid rather
// than stacking as separate full-width banners. Each show*Warning/Banner function
// builds its banner element as before, then calls _mountWarning() to place it here.

function _warningsHost() {
  const existing = document.getElementById('warnings-panel-body');
  if (existing) return existing;
  const anchor = document.getElementById('grid-scroll-wrap');
  if (!anchor) return null;
  const panel = document.createElement('div');
  panel.id = 'warnings-panel';
  panel.className = 'warnings-panel' + (gridUI.warningsCollapsed ? ' collapsed' : '');
  panel.innerHTML =
    `<button type="button" class="warnings-panel-header" id="warnings-panel-toggle" aria-expanded="${gridUI.warningsCollapsed ? 'false' : 'true'}">
       <span class="warnings-caret">▾</span>
       <span class="warnings-panel-count" id="warnings-panel-count"></span>
     </button>
     <div class="warnings-panel-body" id="warnings-panel-body"></div>`;
  anchor.before(panel);
  panel.querySelector('#warnings-panel-toggle').addEventListener('click', () => {
    gridUI.warningsCollapsed = panel.classList.toggle('collapsed');
    panel.querySelector('#warnings-panel-toggle')
      .setAttribute('aria-expanded', String(!gridUI.warningsCollapsed));
  });
  const body = panel.querySelector('#warnings-panel-body');
  // Removals (a warning clearing itself via existing.remove()) don't route through
  // _mountWarning, so watch the body and refresh the count/visibility on any change.
  new MutationObserver(() => _refreshWarningsPanel()).observe(body, { childList: true });
  return body;
}

function _refreshWarningsPanel() {
  const panel = document.getElementById('warnings-panel');
  if (!panel) return;
  const body  = document.getElementById('warnings-panel-body');
  const count = body ? body.querySelectorAll('.setup-banner').length : 0;
  if (count === 0) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const label = document.getElementById('warnings-panel-count');
  if (label) label.textContent = `${count} issue${count !== 1 ? 's' : ''} to review`;
}

// Place a warning banner into the consolidated panel (fallback: above the grid).
function _mountWarning(banner) {
  const host = _warningsHost();
  if (host) { host.appendChild(banner); _refreshWarningsPanel(); return; }
  const anchor = document.getElementById('grid-scroll-wrap');
  if (anchor) anchor.before(banner);
}

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
  _mountWarning(banner);
  banner.querySelector('.setup-banner-link').addEventListener('click', () => navigateTo('school'));
}

function showOverBudgetWarning() {
  const existing = document.getElementById('over-budget-banner');
  if (existing) existing.remove();
  if (typeof computeMinutesBudget !== 'function') return;

  const overBands = computeMinutesBudget().filter(b => b.required > b.available);
  if (!overBands.length) return;

  const banner = document.createElement('div');
  banner.id = 'over-budget-banner';
  banner.className = 'setup-banner setup-banner-error';
  banner.innerHTML =
    `<div><strong>Required minutes exceed available time — some blocks will be left out:</strong>` +
    `<ul>${overBands.map(b =>
      `<li><strong>${escHtml(b.band.name)}:</strong> ${b.required} min required but only ${b.available} min available ` +
      `(${b.dayTotal} min day − ${b.mmMins} mtg − ${b.lunchMins} lunch − ${b.recessMins} recess${b.specialsMins ? ` − ${b.specialsMins} specials` : ''}). ` +
      `Over by <strong>${b.required - b.available} min</strong>.</li>`
    ).join('')}</ul></div>` +
    `<button class="btn-link setup-banner-link">Fix in Block Types →</button>`;

  _mountWarning(banner);
  banner.querySelector('.setup-banner-link').addEventListener('click', () => {
    if (typeof navigateTo === 'function') navigateTo('blocks');
    if (typeof renderBlocks === 'function') renderBlocks();
  });
}

function showRecessSpacingWarning() {
  const existing = document.getElementById('recess-spacing-banner');
  if (existing) existing.remove();

  const s = SchedState.school;
  if (typeof computeRecessTimes !== 'function') return;
  const recessMap = computeRecessTimes(s);
  const MIN_GAP  = 60;
  const fbMins   = timeToMins(s.firstBell  || '08:00');
  const disMins  = timeToMins(s.dismissal  || '14:30');
  const toTime12 = m => { const h = Math.floor(m / 60), mn = m % 60, ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12; return `${h12}:${String(mn).padStart(2,'0')} ${ap}`; };

  const items = [];

  Object.entries(recessMap).forEach(([grade, recesses]) => {
    if (!recesses.length) return;
    const sorted = [...recesses].sort((a, b) => timeToMins(a.start) - timeToMins(b.start));

    // Spacing violations
    for (let i = 0; i < sorted.length - 1; i++) {
      const endOfFirst  = timeToMins(sorted[i].start) + Number(sorted[i].duration);
      const startOfNext = timeToMins(sorted[i + 1].start);
      const gap = startOfNext - endOfFirst;
      if (gap < MIN_GAP) {
        items.push(`<strong>${escHtml(GRADE_LABELS[grade] || grade)}:</strong> ` +
          `${escHtml(sorted[i].name)} (${fmtTime12(sorted[i].start)}) and ` +
          `${escHtml(sorted[i+1].name)} (${fmtTime12(sorted[i+1].start)}) ` +
          `are only <strong>${gap} min</strong> apart (min 60 min).`);
      }
    }

    // Boundary: first non-lunch-adjacent recess within first 60 min of day
    const firstFree = sorted.find(r => !r.lunchAdjacent);
    if (firstFree && timeToMins(firstFree.start) < fbMins + 60) {
      items.push(`<strong>${escHtml(GRADE_LABELS[grade] || grade)}:</strong> ` +
        `${escHtml(firstFree.name)} starts at ${fmtTime12(firstFree.start)} — first recess cannot begin ` +
        `within 60 min of first bell (${fmtTime12(s.firstBell || '08:00')}).`);
    }

    // Boundary: last non-lunch-adjacent recess too close to dismissal
    const lastFree = [...sorted].reverse().find(r => !r.lunchAdjacent);
    if (lastFree) {
      const lastEnd = timeToMins(lastFree.start) + Number(lastFree.duration);
      if (lastEnd > disMins - 30) {
        items.push(`<strong>${escHtml(GRADE_LABELS[grade] || grade)}:</strong> ` +
          `${escHtml(lastFree.name)} ends at ${toTime12(lastEnd)} — last recess must end ` +
          `at least 30 min before dismissal (${fmtTime12(s.dismissal || '14:30')}).`);
      }
    }
  });

  // Cross-grade overlaps with no permission (typically forced by shared lunch waves)
  if (typeof computeRecessOverlapViolations === 'function') {
    computeRecessOverlapViolations(s, recessMap).forEach(({ a, b }) => {
      items.push(
        `<strong>${escHtml(GRADE_LABELS[a.g] || a.g)} + ${escHtml(GRADE_LABELS[b.g] || b.g)}:</strong> ` +
        `${escHtml(a.name)} (${toTime12(a.start)}–${toTime12(a.end)}) overlaps ${escHtml(b.name)} ` +
        `(${toTime12(b.start)}–${toTime12(b.end)}) and these grades aren't allowed to overlap. ` +
        `Allow it under Recess → "May overlap with", or adjust the lunch waves.`);
    });
  }

  if (!items.length) return;

  const banner = document.createElement('div');
  banner.id = 'recess-spacing-banner';
  banner.className = 'setup-banner setup-banner-error';
  banner.innerHTML =
    `<div><strong>Recess placement issue:</strong>` +
    `<ul>${items.map(t => `<li>${t}</li>`).join('')}</ul></div>` +
    `<button class="btn-link setup-banner-link">Fix in School Info →</button>`;

  _mountWarning(banner);
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
  _mountWarning(banner);
  banner.querySelector('.setup-banner-link').addEventListener('click', () => {
    navigateTo('blocks'); renderBlocks();
  });
}

function renderGradeSummaryRow() {
  const wrap = document.getElementById('grade-summary-wrap');
  if (!wrap) return;

  const s     = SchedState.school;
  const bands = s.gradeBands || [];
  if (!bands.length || !gradesSorted().length) { wrap.innerHTML = ''; return; }

  const chips = gradesSorted().map(grade => {
    const band = bands.find(b => b.grades.includes(grade));
    if (!band) return '';

    const reqBTs = SchedState.blockTypes.filter(bt =>
      bt.required && bt.id !== 'bt_spec' && (bt.bandMinutes?.[band.id] > 0 ||
        (bt.subBlocks || []).some(sub => ((bt.subBandMinutes?.[sub.id] || {})[band.id] > 0)))
    );

    const missing = [];
    DAYS.forEach(day => {
      const sched    = (SchedState.masterSchedule[day] || {})[grade] || {};
      const allSlots = _autoFillSlots(day);
      reqBTs.forEach(req => {
        const configuredSubs = (req.subBlocks || []).filter(sub =>
          ((req.subBandMinutes || {})[sub.id] || {})[band.id] > 0
        );
        const units = configuredSubs.length
          ? configuredSubs.map(sub => ({
              id: `${req.id}|${sub.id}`,
              expected: Math.ceil(req.subBandMinutes[sub.id][band.id] / 5),
              label: sub.name,
            }))
          : [{ id: req.id, expected: Math.ceil((req.bandMinutes[band.id] || 0) / 5), label: req.name }];

        units.forEach(unit => {
          if (allSlots.filter(sl => sched[sl] === unit.id).length < unit.expected) {
            const key = `${grade}|${unit.id}`;
            if (!missing.some(m => m.key === key)) missing.push({ key, label: unit.label });
          }
        });
      });
    });

    const ok  = missing.length === 0;
    const cls = ok ? 'gs-chip-ok' : 'gs-chip-warn';
    const icon = ok ? '✓' : '⚠';
    const tip  = ok
      ? 'All required blocks placed'
      : 'Missing: ' + [...new Set(missing.map(m => m.label))].join(', ');

    return `<div class="gs-chip ${cls}" title="${escHtml(tip)}">
      <span class="gs-grade">${escHtml(GRADE_LABELS[grade] || grade)}</span>
      <span class="gs-icon">${icon}</span>
      ${!ok ? `<span class="gs-missing">${escHtml([...new Set(missing.map(m => m.label))].join(', '))}</span>` : ''}
    </div>`;
  }).join('');

  wrap.innerHTML = `<div class="gs-row">${chips}</div>`;
}

// Audits placed blocks vs. requirements and shows a banner for anything missing.
// Called after every auto-populate so silent failures surface immediately.
function showUnplacedBlocksBanner() {
  const existing = document.getElementById('unplaced-blocks-banner');
  if (existing) existing.remove();

  const s     = SchedState.school;
  const bands = s.gradeBands || [];
  if (!bands.length) return;

  // Separate full days from early-release alt days.
  // Shortfalls on alt days are expected (less instructional time) — show a
  // softer informational note rather than a hard error.
  const altDaySet = new Set((s.altDays || []).filter(ad => ad.earlyRelease).map(ad => ad.day));
  const fullDays  = DAYS.filter(d => !altDaySet.has(d));
  const altDays   = DAYS.filter(d => altDaySet.has(d));
  if (!fullDays.length) return;

  const fullSeen = new Set(), altSeen = new Set();
  const fullIssues = [], altIssues = [];

  gradesSorted().forEach(grade => {
    const band = bands.find(b => b.grades.includes(grade));
    if (!band) return;

    SchedState.blockTypes
      .filter(bt => bt.required && bt.id !== 'bt_spec')
      .forEach(req => {
        const configuredSubs = (req.subBlocks || []).filter(sub =>
          ((req.subBandMinutes || {})[sub.id] || {})[band.id] > 0
        );
        const units = configuredSubs.length
          ? configuredSubs.map(sub => ({
              id:       `${req.id}|${sub.id}`,
              expected: Math.ceil(req.subBandMinutes[sub.id][band.id] / 5),
              label:    `${req.name} – ${sub.name}`,
            }))
          : (req.bandMinutes?.[band.id] > 0
              ? [{ id: req.id, expected: Math.ceil(req.bandMinutes[band.id] / 5), label: req.name }]
              : []);

        units.forEach(unit => {
          const key = `${grade}|${unit.id}`;

          const missingOnFullDay = fullDays.some(day => {
            const sched    = (SchedState.masterSchedule[day] || {})[grade] || {};
            const allSlots = _autoFillSlots(day);
            return allSlots.filter(sl => sched[sl] === unit.id).length < unit.expected;
          });

          if (missingOnFullDay) {
            if (!fullSeen.has(key)) { fullSeen.add(key); fullIssues.push({ grade, label: unit.label }); }
            return;
          }

          if (altDays.length) {
            const missingOnAltDay = altDays.some(day => {
              const sched    = (SchedState.masterSchedule[day] || {})[grade] || {};
              const allSlots = _autoFillSlots(day);
              return allSlots.filter(sl => sched[sl] === unit.id).length < unit.expected;
            });
            if (missingOnAltDay && !altSeen.has(key)) {
              altSeen.add(key); altIssues.push({ grade, label: unit.label });
            }
          }
        });
      });
  });

  if (fullIssues.length) {
    const banner = document.createElement('div');
    banner.id        = 'unplaced-blocks-banner';
    banner.className = 'setup-banner setup-banner-error';
    banner.innerHTML =
      `⚠ <strong>Required blocks couldn't be placed — not enough room:</strong> ` +
      fullIssues.map(i => `${GRADE_LABELS[i.grade] || i.grade}: <strong>${escHtml(i.label)}</strong>`).join(', ') +
      `. Try clearing and re-filling the grade, or reduce time requirements in Block Types.`;
    _mountWarning(banner);
    return;
  }

  if (altIssues.length) {
    const altLabel = [...altDaySet].join(', ');
    const banner = document.createElement('div');
    banner.id        = 'unplaced-blocks-banner';
    banner.className = 'setup-banner';
    banner.innerHTML =
      `ℹ <strong>On early-release day${altDays.length !== 1 ? 's' : ''} (${escHtml(altLabel)}), some blocks were skipped — not enough time:</strong> ` +
      altIssues.map(i => `${GRADE_LABELS[i.grade] || i.grade}: <strong>${escHtml(i.label)}</strong>`).join(', ') +
      `. Full days are complete. This is normal for shortened days.`;
    _mountWarning(banner);
  }
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
        <div class="palette-hint">Select a type to paint, or use Move to drag blocks. Press Esc to switch back to Move.</div>

        <div class="palette-item palette-move ${gridUI.tool === 'move' ? 'active' : ''}" id="palette-move" title="Drag blocks to reposition them (default)">
          <span class="palette-tool-icon">&#9995;</span>
          <span class="palette-name">Move</span>
        </div>
        <div class="palette-item palette-eraser ${gridUI.tool === 'erase' ? 'active' : ''}" id="palette-eraser" title="Click or drag to clear blocks">
          <span class="palette-dot" style="background:#d1d5db;border:1px solid #9ca3af"></span>
          <span class="palette-name">Eraser</span>
        </div>

        ${buildPaletteGroups()}
      </div>

      <!-- Right side -->
      <div class="grid-side" id="grid-side">
        <div class="grid-top-bar">
          <div>
            <h1 class="grid-title">Master Schedule</h1>
            <p class="grid-subtitle">Broad blocks by grade — detail Specials and IA in the next steps.</p>
          </div>
          <div class="grid-top-actions">
            <button class="btn btn-outline btn-sm" id="undo-btn" title="Undo last change (⌘Z)" disabled>↩ Undo</button>
            <button class="btn btn-outline btn-sm" id="copy-day-btn">Copy day to…</button>
            <button class="btn btn-primary btn-sm" id="master-save-btn">Save</button>
            <button class="btn btn-outline btn-sm" id="ia-mode-toggle-btn">Assign IAs</button>
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
          <table class="sched-table" id="sched-table" cellspacing="0" style="min-width:${currentGrades.length * 120 + 54}px">
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
          <button class="btn btn-primary btn-lg" id="master-next-btn">Continue to Specials Schedule →</button>
        </div>
      </div>

      <div class="ia-block-panel ia-panel-hidden" id="ia-block-panel">
        <div class="ia-panel-hdr">
          <span class="ia-panel-hdr-title">IA Assignments</span>
          <button class="ia-panel-close" id="ia-panel-close-btn" title="Exit IA mode">×</button>
        </div>
        <div class="ia-panel-body" id="ia-panel-body">
          <p class="ia-panel-hint">Click any filled block in the schedule to assign an IA.</p>
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
  showRecessSpacingWarning();
  showOverBudgetWarning();
  showMissingRequirementsWarning();
  showConflictBanner();
  showSpecialsCoverageBanner();
  document.getElementById('copy-day-btn').addEventListener('click', showCopyDayMenu);

  document.getElementById('ia-mode-toggle-btn').addEventListener('click', toggleIAMasterMode);
  document.getElementById('ia-panel-close-btn').addEventListener('click', () => {
    if (iaMasterState.active) toggleIAMasterMode();
  });
  // Restore IA panel if mode was already active (e.g. after day switch triggers re-render)
  if (iaMasterState.active) {
    document.getElementById('ia-block-panel').classList.remove('ia-panel-hidden');
    const tb = document.getElementById('ia-mode-toggle-btn');
    if (tb) { tb.textContent = '× Exit IA Mode'; tb.classList.add('btn-active-ia'); }
  }
}

function buildTbodyHtml() {
  return currentSlots.map((slot, i) => buildRow(slot, currentSlots[i - 1] ?? null)).join('');
}

// ── Palette ───────────────────────────────────────────────────────────────────

function buildPaletteGroups() {
  const catOrder = ['instruction','specials','intervention','behavior','transition','admin'];
  // Auto-placed / config-driven blocks that aren't painted on the grid don't
  // belong in the paint palette: lunch & recess (School Info), morning meeting
  // (Block Types school-wide time), arrival duty (IA duties). Removing the last
  // block in a category also drops that now-empty category header.
  const PALETTE_EXCLUDE = new Set(['bt_lunch', 'bt_recess', 'bt_mm', 'bt_arr']);
  return catOrder.map(cat => {
    const blocks = SchedState.blockTypes.filter(b => b.category === cat && !PALETTE_EXCLUDE.has(b.id));
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

function selectGridTool(tool) {
  gridUI.tool       = tool;
  gridUI.activeBtId = (tool === 'move' || tool === 'erase') ? null : tool;
  syncPaletteHighlight();
}

function wirePalette() {
  document.getElementById('palette-move').addEventListener('click', () => selectGridTool('move'));
  document.getElementById('palette-eraser').addEventListener('click', () => selectGridTool('erase'));
  document.querySelectorAll('.palette-item[data-bt-id]').forEach(item => {
    item.addEventListener('click', () => selectGridTool(item.dataset.btId));
  });
}

function syncPaletteHighlight() {
  document.getElementById('palette-move')?.classList.toggle('active', gridUI.tool === 'move');
  document.getElementById('palette-eraser')?.classList.toggle('active', gridUI.tool === 'erase');
  document.querySelectorAll('.palette-item[data-bt-id]').forEach(item => {
    const id = item.dataset.btId;
    const parentId = id.includes('|') ? id.split('|')[0] : id;
    const bt  = SchedState.blockTypes.find(b => b.id === parentId);
    const on  = id === gridUI.activeBtId;
    item.classList.toggle('active', on);
    item.style.background = on && bt ? `${bt.color}22` : '';
  });
  // Grab cursor in Move tool; crosshair in Erase tool
  const wrap = document.getElementById('grid-scroll-wrap');
  if (wrap) {
    wrap.classList.toggle('no-tool', gridUI.tool === 'move');
    wrap.classList.toggle('erase-tool', gridUI.tool === 'erase');
  }
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

  // Specials routing (Option 3 model):
  //  • Carousel (whole grade at specials, or grade block is bt_spec) → unified
  //    "Specials" block via buildSpecialsCell.
  //  • Special-only (some classes pulled AND the grade has no competing instruction
  //    here) → small labeled specials block via buildSpecialsCell.
  //  • Off-carousel WITH competing instruction → the INSTRUCTION stays the primary
  //    block (rendered below, so the master grid reads as the grade's schedule) and
  //    just gets a small "N classes → Special" pull-out tag. No split, no void.
  // getSpecialsAtSlot returns null when no class is on a special, so normal cells
  // fall straight through.
  let _pullOut = null;
  {
    const specInfo = getSpecialsAtSlot(day, grade, slot);
    if (specInfo) {
      const _mBt     = getBlock(day, grade, slot);
      const carousel = specInfo.all.length === specInfo.totalClasses ||
                       (_mBt && _mBt.startsWith('bt_spec'));
      if (carousel || !_mBt) return buildSpecialsCell(slot, grade, specInfo, isCont, isEnd);
      _pullOut = specInfo;
    }
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
      const _iaAssigns = getIAsForBlock(day, grade, slot);
      if (_iaAssigns.length) {
        inner += '<span class="ia-block-ind">' + _iaAssigns.map(({ ia, alloc }) =>
          `<span class="ia-ind-dot" style="background:${alloc?.color || '#6b7280'}" title="${escHtml(ia.name + (alloc ? ' · ' + alloc.name : ''))}"></span>`
        ).join('') + '</span>';
      }
    }
    // Off-carousel pull-out tag: some classes are away at a special during this
    // instruction block. Show it once, at the special's start OR at an instruction
    // block that begins while the special is ongoing.
    if (_pullOut && (_pullOut.isStart || isStart)) inner += _buildPulloutTag(_pullOut);
  } else if (hasConflict && !isCont) {
    // Slot has conflict(s) but no primary block — show the conflict directly
    const conflictBtId = conflicts[0];
    const conflictColor = getBtColor(conflictBtId);
    style = `background:${conflictColor}18;border-left:3px solid ${conflictColor};outline:2px solid #ef4444;outline-offset:-2px;`;
    inner = `<span class="split-label" style="color:${conflictColor}">⚠ ${getBtName(conflictBtId)}</span>`;
  }

  const conflictCls  = hasConflict ? ' cell-has-conflict' : '';
  const resizeHandle = (bt && isEnd && !lockedCls && !isFixedBlock(btId))
    ? '<div class="resize-handle" title="Drag to resize"></div>' : '';
  return `<td class="grid-cell${bt ? ' filled' : ''}${isCont ? ' cont' : ''}${lockedCls}${conflictCls}"
              data-time="${slot}" data-grade="${grade}"
              style="${style}">${inner}${resizeHandle}</td>`;
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
  wrap.addEventListener('contextmenu', onContextMenu);

  // Cmd/Ctrl+Z — undo; Escape — back to Move tool (registered once for the page)
  if (!_gridKeydownWired) {
    _gridKeydownWired = true;
    document.addEventListener('keydown', e => {
      if (!document.getElementById('view-master')?.classList.contains('active')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        undoLastMove();
      } else if (e.key === 'Escape' && gridUI.tool !== 'move') {
        selectGridTool('move');
      }
    });
  }
}

function onPointerDown(e) {
  if (iaMasterState.active) {
    const filled = e.target.closest('.grid-cell.filled');
    if (!filled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    openIABlockPanel(filled.dataset.grade, filled.dataset.time);
    return;
  }

  // Resize handle — drag the bottom edge of a block to extend or shrink it
  if (!gridUI.activeBtId) {
    const resizeHandle = e.target.closest('.resize-handle');
    if (resizeHandle) {
      const cell = resizeHandle.closest('.grid-cell');
      if (!cell) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const grade    = cell.dataset.grade;
      const slot     = cell.dataset.time;
      const day      = gridUI.activeDay;
      const btId     = getBlock(day, grade, slot);
      if (!btId) return;
      const blockStart = findBlockStart(day, grade, slot);
      const blockLen   = findBlockLength(day, grade, blockStart);
      const startIdx   = currentSlots.indexOf(blockStart);
      drag.active         = true;
      drag.hasMoved       = false;
      drag.mode           = 'resize';
      drag.startGrade     = grade;
      drag.startSlot      = blockStart;
      drag.endGrade       = grade;
      drag.endSlot        = slot;
      drag.moveValue      = btId;
      drag.moveSlots      = currentSlots.slice(startIdx, startIdx + blockLen);
      drag.moveGrade      = grade;
      drag.resizeOrigEnd  = currentSlots[startIdx + blockLen - 1];
      return;
    }
  }

  // Specials-half drag — click on the left half of a mixed split cell
  if (!gridUI.activeBtId) {
    const specHalf = e.target.closest('.split-half-specials');
    if (specHalf) {
      const cell = specHalf.closest('.grid-cell');
      if (!cell) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const grade    = cell.dataset.grade;
      const slot     = cell.dataset.time;
      const day      = gridUI.activeDay;
      const specInfo = getSpecialsAtSlot(day, grade, slot);
      if (!specInfo?.all?.length) return;
      const startSlot = specInfo.all[0].startTime;
      const duration  = specInfo.all[0].duration;
      const daySlots  = _autoFillSlots(day);
      const startIdx  = daySlots.indexOf(startSlot);
      const numSlots  = Math.ceil(duration / 5);
      drag.active       = true;
      drag.hasMoved     = false;
      drag.mode         = 'move-specials';
      drag.startGrade   = grade;
      drag.startSlot    = startSlot;
      drag.endGrade     = grade;
      drag.endSlot      = slot;
      drag.moveSlots    = daySlots.slice(startIdx, startIdx + numSlots);
      drag.moveGrade    = grade;
      drag.specInfoSnap = specInfo.all.map(en => ({
        clsId:     en.cls.id,
        subjectId: en.subjectId,
        teacherId: en.teacherId,
        startTime: en.startTime,
        duration:  en.duration,
      }));
      return;
    }
  }

  const cell = e.target.closest('.grid-cell');
  if (!cell) return;
  e.preventDefault();
  e.currentTarget.setPointerCapture(e.pointerId);

  const grade    = cell.dataset.grade;
  const slot     = cell.dataset.time;
  const existing = getBlock(gridUI.activeDay, grade, slot);

  // Move mode: Move tool selected + clicking a filled block. (Previously this
  // fired whenever no paint color was active, which meant the Eraser tool — also
  // "no color" — hijacked clicks into picking the block up to drag instead of
  // erasing it; a plain click then did nothing at all. Gating on the tool
  // explicitly fixes both: Move drags, Erase actually erases on click.)
  if (gridUI.tool === 'move' && existing) {
    // Conflict split cell: the LEFT half is the primary block, the RIGHT half is
    // the displaced (conflict) block. Clicking the right half picks up the
    // conflict block so either side of a shared slot can be moved.
    const slotConflicts = getConflicts(gridUI.activeDay, grade, slot);
    const half = e.target.closest('.split-half');
    if (slotConflicts.length && half && half.parentElement &&
        [...half.parentElement.children].indexOf(half) === 1) {
      const cbtId = slotConflicts[0];
      let startIdx = currentSlots.indexOf(slot);
      let endIdx   = startIdx;
      while (startIdx > 0 &&
             getConflicts(gridUI.activeDay, grade, currentSlots[startIdx - 1]).includes(cbtId)) startIdx--;
      while (endIdx < currentSlots.length - 1 &&
             getConflicts(gridUI.activeDay, grade, currentSlots[endIdx + 1]).includes(cbtId)) endIdx++;
      drag.active           = true;
      drag.hasMoved         = false;
      drag.mode             = 'move';
      drag.startGrade       = grade;
      drag.startSlot        = slot;
      drag.endGrade         = grade;
      drag.endSlot          = slot;
      drag.moveValue        = cbtId;
      drag.moveSlots        = currentSlots.slice(startIdx, endIdx + 1);
      drag.moveGrade        = grade;
      drag.moveFromConflict = true;
      drag.recessMove       = null;
      return;
    }

    // Fixed blocks: hard-time ones (lunch, morning meeting, lunch-anchored recess)
    // are set in School Info and can't be dragged. A FREE-FLOATING recess can be
    // moved — the drop records a manual start override so it sticks.
    let recessMove = null;
    if (isFixedBlock(existing)) {
      const rInfo = _recessBlockInfo(gridUI.activeDay, grade, slot);
      if (!rInfo || rInfo.lunchAdjacent) return; // hard-time — not movable
      recessMove = { grade, recessId: rInfo.id };
    }

    const blockStart = findBlockStart(gridUI.activeDay, grade, slot);
    const blockLen   = findBlockLength(gridUI.activeDay, grade, blockStart);
    const startIdx   = currentSlots.indexOf(blockStart);
    drag.active           = true;
    drag.hasMoved         = false;
    drag.mode             = 'move';
    drag.startGrade       = grade;
    drag.startSlot        = blockStart;
    drag.endGrade         = grade;
    drag.endSlot          = blockStart;
    drag.moveValue        = existing;
    drag.moveSlots        = currentSlots.slice(startIdx, startIdx + blockLen);
    drag.moveGrade        = grade;
    drag.moveFromConflict = false;
    drag.recessMove       = recessMove;
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

  // Resize mode: constrain to same grade, clamp to block start or beyond
  if (drag.mode === 'resize') {
    if (grade !== drag.moveGrade) return;
    const startIdx   = currentSlots.indexOf(drag.startSlot);
    const hoverIdx   = currentSlots.indexOf(slot);
    const clampedIdx = Math.max(hoverIdx, startIdx);
    const clampedSlot = currentSlots[clampedIdx];
    if (clampedSlot === drag.endSlot) return;
    drag.hasMoved = true;
    drag.endSlot  = clampedSlot;
    drag.endGrade = grade;
    document.querySelectorAll('.grid-cell.resize-preview')
      .forEach(c => c.classList.remove('resize-preview'));
    for (let i = startIdx; i <= clampedIdx; i++) {
      document.querySelector(`td[data-grade="${drag.moveGrade}"][data-time="${currentSlots[i]}"]`)
        ?.classList.add('resize-preview');
    }
    return;
  }

  if (grade === drag.endGrade && slot === drag.endSlot) return;

  drag.hasMoved = true;
  drag.endGrade = grade;
  drag.endSlot  = slot;

  if (drag.mode === 'move') {
    showMovePreview();
  } else if (drag.mode === 'move-specials') {
    // Light highlight on the target row while dragging specials
    document.querySelectorAll('.grid-cell.specials-drag-target')
      .forEach(c => c.classList.remove('specials-drag-target'));
    document.querySelectorAll(`.grid-cell[data-time="${drag.endSlot}"]`)
      .forEach(c => c.classList.add('specials-drag-target'));
  } else {
    showDragPreview();
  }
}

function onPointerUp(e) {
  if (!drag.active) return;
  drag.active = false;
  clearDragPreview();
  clearMovePreview();

  document.querySelectorAll('.grid-cell.specials-drag-target')
    .forEach(c => c.classList.remove('specials-drag-target'));

  if (drag.mode === 'move') {
    if (drag.hasMoved) commitMove();
    // no-move click on a block: do nothing (don't delete it)
  } else if (drag.mode === 'move-specials') {
    if (drag.hasMoved) commitSpecialsMove();
  } else if (drag.mode === 'resize') {
    document.querySelectorAll('.grid-cell.resize-preview')
      .forEach(c => c.classList.remove('resize-preview'));
    if (drag.hasMoved) commitResize();
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

// ── Block resize ─────────────────────────────────────────────────────────────

function commitResize() {
  pushUndoSnapshot();
  const day        = gridUI.activeDay;
  const grade      = drag.moveGrade;
  const btId       = drag.moveValue;
  const blockStart = drag.startSlot;
  const origEnd    = drag.resizeOrigEnd;
  const newEnd     = drag.endSlot;

  const origEndIdx = currentSlots.indexOf(origEnd);
  const newEndIdx  = currentSlots.indexOf(newEnd);
  if (newEndIdx === origEndIdx) return;

  if (newEndIdx > origEndIdx) {
    // Extending: paint additional slots
    for (let i = origEndIdx + 1; i <= newEndIdx; i++) {
      placeBlock(day, grade, currentSlots[i], btId);
    }
  } else {
    // Shrinking: clear trailing slots (restore conflict if one was displaced)
    for (let i = newEndIdx + 1; i <= origEndIdx; i++) {
      const sl = currentSlots[i];
      const displaced = (SchedState.conflicts[day]?.[grade]?.[sl] || [])[0] || null;
      setBlock(day, grade, sl, displaced);
      if (displaced && SchedState.conflicts[day]?.[grade]?.[sl]) {
        SchedState.conflicts[day][grade][sl] = SchedState.conflicts[day][grade][sl].slice(1);
        if (!SchedState.conflicts[day][grade][sl].length) delete SchedState.conflicts[day][grade][sl];
      }
    }
  }

  showConflictBanner();
  rebuildTbody();
  saveToLocal();
}

// ── Right-click context menu ──────────────────────────────────────────────────

function onContextMenu(e) {
  const cell = e.target.closest('.grid-cell.filled');
  if (!cell || e.target.closest('.split-half-specials')) return;
  e.preventDefault();
  const grade = cell.dataset.grade;
  const slot  = cell.dataset.time;
  const btId  = getBlock(gridUI.activeDay, grade, slot);
  if (!btId) return;
  showBlockContextMenu(e.clientX, e.clientY, grade, slot, btId);
}

function showBlockContextMenu(x, y, grade, slot, btId) {
  dismissContextMenu();
  const day      = gridUI.activeDay;
  const name     = getBtName(btId);
  const isFixed  = isFixedBlock(btId);
  const isLocked = gridUI.lockedGrades?.has(grade);

  const blockItems = (SchedState.blockTypes || [])
    .filter(b => !b.id.includes('|') && b.id !== btId && b.id !== 'bt_spec')
    .map(b => `<li class="ctx-item" data-ctx-replace="${escHtml(b.id)}">
        <span class="ctx-dot" style="background:${escHtml(b.color || '#ccc')}"></span>${escHtml(b.name)}
      </li>`)
    .join('');

  const lockLabel = isLocked ? 'Unlock grade' : 'Lock grade';

  const menu = document.createElement('div');
  menu.id = 'block-ctx-menu';
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <div class="ctx-header">${escHtml(name)}</div>
    ${!isFixed && blockItems ? `<ul class="ctx-list">${blockItems}</ul><div class="ctx-sep"></div>` : ''}
    <ul class="ctx-list">
      ${!isFixed ? `<li class="ctx-item ctx-danger" data-ctx-clear>Clear block</li>` : ''}
      <li class="ctx-item" data-ctx-lock>${escHtml(lockLabel)}</li>
    </ul>
  `;

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.min(x, vw - rect.width  - 8) + 'px';
  menu.style.top  = Math.min(y, vh - rect.height - 8) + 'px';

  menu.addEventListener('click', e2 => {
    const item = e2.target.closest('[data-ctx-replace],[data-ctx-clear],[data-ctx-lock]');
    if (!item) return;
    dismissContextMenu();

    if (item.hasAttribute('data-ctx-replace')) {
      const newBtId = item.dataset.ctxReplace;
      pushUndoSnapshot();
      const blockStart = findBlockStart(day, grade, slot);
      const blockLen   = findBlockLength(day, grade, blockStart);
      const startIdx   = currentSlots.indexOf(blockStart);
      for (let i = 0; i < blockLen; i++) placeBlock(day, grade, currentSlots[startIdx + i], newBtId);
      showConflictBanner();
      rebuildTbody();
      saveToLocal();
    } else if (item.hasAttribute('data-ctx-clear')) {
      pushUndoSnapshot();
      const blockStart = findBlockStart(day, grade, slot);
      const blockLen   = findBlockLength(day, grade, blockStart);
      const startIdx   = currentSlots.indexOf(blockStart);
      for (let i = 0; i < blockLen; i++) placeBlock(day, grade, currentSlots[startIdx + i], null);
      showConflictBanner();
      rebuildTbody();
      saveToLocal();
    } else if (item.hasAttribute('data-ctx-lock')) {
      if (!gridUI.lockedGrades) gridUI.lockedGrades = new Set();
      if (isLocked) gridUI.lockedGrades.delete(grade);
      else gridUI.lockedGrades.add(grade);
      rebuildTbody();
    }
  });

  setTimeout(() => {
    document.addEventListener('click', dismissContextMenu, { once: true });
    document.addEventListener('contextmenu', dismissContextMenu, { once: true });
  }, 0);
}

function dismissContextMenu() {
  document.getElementById('block-ctx-menu')?.remove();
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
  const day          = gridUI.activeDay;
  const srcGrade     = drag.moveGrade;
  const destGrade    = drag.endGrade;
  const destStartIdx = currentSlots.indexOf(drag.endSlot);
  const len          = drag.moveSlots.length;

  // Free-floating recess move → record a manual time override (handled separately).
  if (drag.recessMove) { _commitRecessMove(destStartIdx); return; }

  // Protect fixed blocks: a normal move can't land on top of lunch/recess/MM.
  // Reject the whole drop (snap back) so neither block is split into half-cells.
  // (Same-value overlap and conflict-sourced moves are exempt.)
  if (!drag.moveFromConflict) {
    for (let i = 0; i < len; i++) {
      const s = currentSlots[destStartIdx + i];
      if (!s) continue;
      const ex = getBlock(day, destGrade, s);
      if (ex && ex !== drag.moveValue && isFixedBlock(ex)) { rebuildTbody(); return; }
    }
  }

  pushUndoSnapshot();

  // Erase source. A conflict-sourced move (right half of a split cell) removes the
  // block from the conflicts list and leaves the primary block untouched. A normal
  // move restores any displaced conflict into the vacated slot instead of deleting it.
  if (drag.moveFromConflict) {
    if (!gridUI.lockedGrades.has(srcGrade)) {
      drag.moveSlots.forEach(s => {
        const rest = getConflicts(day, srcGrade, s).filter(b => b !== drag.moveValue);
        if (rest.length) SchedState.conflicts[day][srcGrade][s] = rest;
        else clearConflict(day, srcGrade, s);
      });
    }
  } else {
    drag.moveSlots.forEach(s => {
      const slotConflicts = getConflicts(day, srcGrade, s);
      if (slotConflicts.length > 0) {
        SchedState.masterSchedule[day][srcGrade][s] = slotConflicts[0];
        clearConflict(day, srcGrade, s);
      } else {
        setBlock(day, srcGrade, s, null);
      }
    });
  }

  // Write destination — use placeBlock so anything already there becomes a conflict
  for (let i = 0; i < len; i++) {
    const destIdx = destStartIdx + i;
    if (destIdx >= currentSlots.length) break;
    placeBlock(day, destGrade, currentSlots[destIdx], drag.moveValue);
  }

  // Sync specialsSchedule when a bt_spec block was moved
  if (drag.moveValue && drag.moveValue.startsWith('bt_spec|')) {
    const oldStart = drag.moveSlots[0];
    const newStart = currentSlots[destStartIdx];
    if (oldStart !== newStart) {
      const snap = [];
      getClassesForGrade(srcGrade).forEach(cls => {
        const entry = (SchedState.specialsSchedule[cls.id] || {})[day];
        if (entry && entry.startTime === oldStart) {
          SchedState.specialsSchedule[cls.id][day].startTime = newStart;
          const sp = (SchedState.school.specials || []).find(s => s.id === entry.subjectId);
          snap.push({ subjectId: entry.subjectId, teacherId: entry.teacherId, duration: sp?.duration || 45 });
        }
      });
      _checkAndSurfaceSpecialsConflicts(day, srcGrade, newStart, snap);
    }
  }

  showConflictBanner();
  rebuildTbody();
}

function commitSpecialsMove() {
  pushUndoSnapshot();
  const day   = gridUI.activeDay;
  const grade = drag.moveGrade;
  const snap  = drag.specInfoSnap || [];
  const oldStart = drag.startSlot;
  const newStart = drag.endSlot;
  if (oldStart === newStart) return;

  snap.forEach(en => {
    const dayMap = SchedState.specialsSchedule[en.clsId];
    if (dayMap && dayMap[day]) {
      dayMap[day].startTime = newStart;
    }
  });

  _checkAndSurfaceSpecialsConflicts(day, grade, newStart, snap);
  saveToLocal();
  rebuildTbody();
}

function _checkAndSurfaceSpecialsConflicts(day, grade, newStart, snap) {
  if (!snap || !snap.length) return;
  const ss       = SchedState.specialsSchedule || {};
  const daySlots = _autoFillSlots(day);
  const warnings = new Set();

  snap.forEach(en => {
    if (!en.teacherId) return;
    const numSlots   = Math.ceil((en.duration || 45) / 5);
    const startIdx   = daySlots.indexOf(newStart);
    if (startIdx < 0) return;
    const newSlotSet = new Set(daySlots.slice(startIdx, startIdx + numSlots));

    Object.entries(ss).forEach(([clsId, dayMap]) => {
      const otherEntry = dayMap[day];
      if (!otherEntry || otherEntry.teacherId !== en.teacherId) return;
      const otherCls = (SchedState.staff || []).find(s => s.id === clsId && s.role === 'classroom_teacher');
      if (!otherCls) return;
      const otherGrade = otherCls.gradeAssignment;
      if (otherGrade === grade) return; // same grade, skip

      const otherSp       = (SchedState.school.specials || []).find(s => s.id === otherEntry.subjectId);
      const otherDuration = otherSp?.duration || 45;
      const otherIdx      = daySlots.indexOf(otherEntry.startTime);
      if (otherIdx < 0) return;
      const otherSlots = daySlots.slice(otherIdx, otherIdx + Math.ceil(otherDuration / 5));
      if (otherSlots.some(s => newSlotSet.has(s))) {
        const teacher    = (SchedState.staff || []).find(t => t.id === en.teacherId);
        const gradeLabel = GRADE_LABELS[otherGrade] || otherGrade || '';
        warnings.add(`${teacher?.name || 'Teacher'} is already teaching${gradeLabel ? ' ' + gradeLabel : ''} at ${fmtTime12(newStart)}`);
      }
    });
  });

  const existing = document.getElementById('specials-move-warning');
  if (existing) existing.remove();
  if (!warnings.size) return;

  const banner = document.createElement('div');
  banner.id        = 'specials-move-warning';
  banner.className = 'conflict-banner';
  banner.innerHTML = '&#9888; Specials conflict: ' + [...warnings].join(' · ') +
    ' <button id="specials-warning-dismiss" class="conflict-banner-dismiss">&#x2715;</button>';
  const wrap = document.querySelector('#view-master .grid-top') || document.getElementById('view-master');
  if (wrap) wrap.insertAdjacentElement('afterbegin', banner);
  document.getElementById('specials-warning-dismiss')?.addEventListener('click', () => banner.remove());
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

  _mountWarning(banner);
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

  _mountWarning(banner);
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

  _mountWarning(banner);

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
  // Instructional placement starts at FIRST BELL — matching computeMinutesBudget.
  // studentCampusStart (arrival) is earlier, but that window is arrival/duty time,
  // not instruction; including it made the grid disagree with the budget panel and
  // placed instructional blocks before the bell. (See CLAUDE.md: "Instructional
  // budget uses firstBell; IA budget uses arrival.")
  const fb  = sc.firstBell || sc.dayStart || sc.studentCampusStart || '07:30';
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

  const mode    = SchedState.school.specialsRotationMode || 'intermittent';
  const numDays = 5;

  // Track per-day, per-subject count so we never exceed teacher capacity.
  const daySpCount = {};
  specials.forEach(sp => {
    daySpCount[sp.id] = {};
    DAYS.forEach(d => { daySpCount[sp.id][d] = 0; });
  });

  if (mode === 'none') {
    // No preference: place each special for each class on the first available day.
    // Stagger start day by class index so teacher load spreads naturally.
    classes.forEach((cls, c) => {
      result[cls.id] = {};
      specials.forEach(sp => {
        const sessions = Math.min(sp.classesPerWeek || 1, 5);
        const cap      = Math.max((sp.teacherIds || []).length, 1);
        let placed = 0;
        for (let di = 0; di < numDays && placed < sessions; di++) {
          const d = DAYS[(c + di) % numDays];
          if (result[cls.id][d] === undefined && daySpCount[sp.id][d] < cap) {
            result[cls.id][d] = sp.id;
            daySpCount[sp.id][d]++;
            placed++;
          }
        }
      });
    });
    return result;
  }

  let sessionSeq;
  if (mode === 'sequential') {
    sessionSeq = specials.flatMap(sp =>
      Array.from({ length: Math.min(sp.classesPerWeek || 1, 5) }, () => sp.id)
    );
  } else {
    sessionSeq = _buildIntermittentSeq(specials);
  }

  const S = sessionSeq.length;

  // Spread step: space sessions of the same subject across non-consecutive days.
  // e.g. S=2, numDays=5 → step=2 → class 0 gets Mon+Wed instead of Mon+Tue.
  const step = S > 0 ? Math.max(Math.floor(numDays / S), 1) : 1;

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

      // Every subject needs enough DISTINCT free teachers to cover every class
      // rotated onto it this day — not just one. Checking for "any one teacher
      // free" let a slot look valid when only some classes could actually be
      // staffed, producing silent per-class coverage gaps downstream.
      if (isFreeTeacher) {
        for (const spId of subjectsOnDay) {
          const sp         = specials.find(s => s.id === spId);
          const teacherIds = sp?.teacherIds || [];
          if (!teacherIds.length) continue; // no teachers configured — not a capacity blocker here
          const dur        = sp?.duration || 45;
          const needed     = classes.filter(cls => rotation[cls.id]?.[day] === spId).length;
          const freeCount  = teacherIds.filter(tid => isFreeTeacher(tid, day, candidateStart, dur)).length;
          if (freeCount < needed) { ok = false; break; }
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
//
// NOT run on every render: a full rebuild wipes manual specials moves the user
// made on the master grid. Unforced calls skip the rebuild while every class
// already has a specials entry; a rebuild happens when specialsSchedule is empty
// (fresh schedule, or cleared by a Specials-tab config save) or a new class
// appears. Pass force=true to rebuild unconditionally.
function buildSpecialsSchedule(force = false) {
  const specials = SchedState.school.specials || [];

  if (!force && specials.length) {
    const ss = SchedState.specialsSchedule || {};
    const classIds = (SchedState.staff || [])
      .filter(t => t.role === 'classroom_teacher').map(t => t.id);
    if (Object.keys(ss).length && !classIds.some(id => !ss[id])) return;
  }

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

  // Give specials FIRST PICK of the day. Clear every grade's instructional blocks
  // before placing specials, so findGradeFixedTime can lock a clean, consistent
  // time slot instead of squeezing specials into whatever gaps instruction left
  // (which forced the scattered per-day fallback). Callers re-flow instruction
  // around the placed specials afterward: autoPopulateIfEmpty / fillMissing-
  // Requirements / saveSpecialsAndContinue all run _populateGradeData for every
  // grade. Because this only runs on a genuine rebuild (empty specialsSchedule or
  // force), it never wipes instruction on ordinary renders (those skip above).
  gradesSorted().forEach(grade => _clearRequirementsForGrade(grade));

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

  // Place HARDEST grades first: a grade with more classes needs more specials
  // teachers free at the same instant, so it has the fewest workable shared-times.
  // Letting it claim its carousel slot before easier grades consume teacher
  // availability yields tighter consolidation. (gradeIdx below still uses the
  // stable grade order so rotation offsets don't shift with placement order.)
  const placementOrder = [...allGrades].sort((a, b) =>
    getClassesForGrade(b).length - getClassesForGrade(a).length);

  // Two phase: run every grade's carousel placement first (Phase 1), THEN every
  // grade's straggler recovery (Phase 2). Recovery scatters off-carousel, so
  // deferring it keeps recovery from stealing a clean shared-time slot that a
  // later grade's carousel still needs.
  const recoveryQueue = [];

  placementOrder.forEach(grade => {
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

    // Carousel model. FIRST try one FIXED time that works on every day, so the
    // grade's specials land at the SAME clock-time all week (what schools expect
    // and want to read at a glance). Only if no single time works across the week
    // do we fall back to per-day times (which can differ Mon vs Tue). Hardest
    // grades run first (placementOrder), so the tightest grade claims its fixed
    // time before easier grades consume teacher availability.
    const gradeIdx = allGrades.indexOf(grade);
    const rotation = computeClassSpecialsRotation(classes, specials, gradeIdx);
    const fixedToPerDay = () => {
      const ft = findGradeFixedTime(grade, classes, rotation, specials, isFree);
      if (!ft) return null;
      const map = {};
      DAYS.forEach(day => { if (classes.some(cls => rotation[cls.id]?.[day])) map[day] = ft; });
      return map;
    };
    let gradeTimesPerDay = fixedToPerDay()
      || findGradeSpecialsTime(grade, classes, rotation, specials, isFree);
    if (!Object.keys(gradeTimesPerDay).length) {
      _clearRequirementsForGrade(grade);
      gradeTimesPerDay = fixedToPerDay()
        || findGradeSpecialsTime(grade, classes, rotation, specials, isFree);
    }
    if (!Object.keys(gradeTimesPerDay).length) {
      // No carousel slot available on any day — schedule each class/session individually.
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
              // Per-class only (see the recovery pass note): no grade-wide reserve,
              // so instruction fills the slot for the other classes and the master
              // grid renders a partial-specials split via getSpecialsAtSlot.
              SchedState.specialsSchedule[cls.id][day] = { subjectId: sp.id, teacherId: tid, startTime: daySlots[i] };
              book(tid, day, daySlots[i], dur);
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

    // Initialise specialsSchedule with per-day time + rotation subject for every class/day.
    classes.forEach(cls => {
      SchedState.specialsSchedule[cls.id] = {};
      DAYS.forEach(day => {
        const spId    = rotation[cls.id]?.[day];
        const dayTime = gradeTimesPerDay[day];
        if (!spId || !dayTime) return;
        SchedState.specialsSchedule[cls.id][day] = { subjectId: spId, startTime: dayTime, teacherId: null };
      });
    });

    // Assign teachers: for each day+special, least-busy-free from the pool.
    DAYS.forEach(day => {
      const dayTime = gradeTimesPerDay[day];
      if (!dayTime) return;
      specials.forEach(sp => {
        const dur  = sp.duration || 45;
        const pool = sp.teacherIds || [];
        classes.filter(cls => rotation[cls.id]?.[day] === sp.id).forEach(cls => {
          const tid = leastBusyFree(pool, day, dayTime, dur);
          if (tid) {
            SchedState.specialsSchedule[cls.id][day].teacherId = tid;
            book(tid, day, dayTime, dur);
          }
        });
      });
    });

    // Write generic bt_spec to masterSchedule using per-day start times.
    const maxDur   = Math.max(...specials.map(sp => sp.duration || 45));
    const numSlots = Math.ceil(maxDur / 5);
    DAYS.forEach(day => {
      const dayTime = gradeTimesPerDay[day];
      if (!dayTime) return;
      if (!classes.some(cls => SchedState.specialsSchedule[cls.id]?.[day]?.subjectId)) return;
      const daySlots = _autoFillSlots(day);
      const startIdx = daySlots.indexOf(dayTime);
      if (startIdx < 0) return;
      if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day]        = {};
      if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
      const sched = SchedState.masterSchedule[day][grade];
      for (let j = 0; j < numSlots && startIdx + j < daySlots.length; j++) {
        sched[daySlots[startIdx + j]] = 'bt_spec';
      }
    });

    // Straggler recovery for this grade is deferred to Phase 2 (after every
    // grade's carousel is placed), so recovery's off-carousel scatter can't steal
    // a clean shared-time slot a later grade's carousel still needs.
    recoveryQueue.push({ grade, classes, gradeTimesPerDay });
  });

  // ── Phase 2: straggler recovery ────────────────────────────────────────────
  // For each grade (hardest first), fill any class/subject still short of its
  // classes-per-week. Prefer the grade's own carousel time on another day; only
  // then fall back to any open off-carousel slot.
  recoveryQueue.forEach(({ grade, classes, gradeTimesPerDay }) => {
    classes.forEach(cls => {
      const ss = SchedState.specialsSchedule[cls.id];
      if (!ss) return;
      specials.forEach(sp => {
        const needed = Math.min(sp.classesPerWeek || 1, 5);
        const placed = DAYS.filter(d => ss[d]?.subjectId === sp.id && ss[d]?.teacherId).length;
        if (placed >= needed) return;

        const dur   = sp.duration || 45;
        const numSl = Math.ceil(dur / 5);
        const pool  = sp.teacherIds || [];
        let fill    = needed - placed;

        // Pass 1: try to place at the carousel time for that day.
        for (const day of DAYS) {
          if (fill <= 0) break;
          if (ss[day]?.teacherId) continue;
          if (ss[day]?.subjectId && ss[day].subjectId !== sp.id) continue;
          const dayTime    = gradeTimesPerDay[day];
          if (!dayTime) continue;
          const daySlots   = _autoFillSlots(day);
          const si         = daySlots.indexOf(dayTime);
          if (si < 0) continue;
          const gradeSched = SchedState.masterSchedule[day]?.[grade] || {};
          let ok = true;
          for (let j = 0; j < numSl; j++) {
            const sv = gradeSched[daySlots[si + j]];
            if (sv && sv !== 'bt_spec') { ok = false; break; }
          }
          if (!ok) continue;
          const tid = leastBusyFree(pool, day, dayTime, dur);
          if (!tid) continue;
          ss[day] = { subjectId: sp.id, teacherId: tid, startTime: dayTime };
          book(tid, day, dayTime, dur);
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
            // Off-carousel: record the special PER-CLASS only. Do NOT reserve the
            // grade-wide master slot — only THIS class is on a special here; the
            // other classes keep the instruction that _populateGradeData fills into
            // this (still-empty) slot afterward. The master grid recombines the two
            // via getSpecialsAtSlot (a partial-specials split), and the class view
            // shows each class's real block (its special, or the instruction).
            ss[day] = { subjectId: sp.id, teacherId: tid, startTime: daySlots[i] };
            book(tid, day, daySlots[i], dur);
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

  if (!matching.length) {
    // No class-level specials entries cover this slot, but masterSchedule still
    // has bt_spec — synthesize a display entry so it renders as "Specials"
    // rather than falling back to a raw subject-name block.
    const masterBtId = SchedState.masterSchedule[day]?.[grade]?.[slot];
    if (!masterBtId || !masterBtId.startsWith('bt_spec|')) return null;
    const subId = masterBtId.split('|')[1];
    const sp    = specials.find(s => s.id === subId);
    if (!sp) return null;
    let startIdx = slotIdx;
    while (startIdx > 0 && SchedState.masterSchedule[day]?.[grade]?.[daySlots[startIdx - 1]] === masterBtId) startIdx--;
    return {
      all:          [{ subjectId: subId, teacherId: null, startTime: daySlots[startIdx],
                       cls: { id: `_grade_${grade}` }, isStart: slotIdx === startIdx,
                       duration: sp.duration || 45 }],
      isStart:      slotIdx === startIdx,
      isUnified:    true,
      totalClasses: 1,
    };
  }

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
// Renders a specials cell on the master grid. Only TWO shapes reach here (see the
// routing in buildCell):
//   1. Carousel — the whole grade is at specials → one unified "Specials" block.
//   2. Special-only — some classes are pulled to a special AND the grade has no
//      competing instruction at this slot → a small labeled specials block for the
//      contiguous special-only run, so it never reads as an empty void.
// Off-carousel windows that DO overlap instruction never come here: buildCell keeps
// the instruction as the primary block and adds a "N classes → Special" pull-out tag.
function buildSpecialsCell(slot, grade, specInfo, isCont, isEnd) {
  const day       = gridUI.activeDay;
  const bt        = SchedState.blockTypes.find(b => b.id === 'bt_spec');
  const color     = bt?.color || '#f97316';
  const lockedCls = gridUI.lockedGrades.has(grade) ? ' grade-locked' : '';
  const specials  = SchedState.school.specials || [];

  const _slotBtId     = getBlock(day, grade, slot);
  const allInSpecials = specInfo.all.length === specInfo.totalClasses ||
                        (_slotBtId && _slotBtId.startsWith('bt_spec'));

  // ── 1. Carousel: whole grade at specials, one unified block ──
  // Master Schedule shows ALL specials in the uniform bt_spec color (the subject
  // name still appears in the label). Per-subject colors live in the Specials
  // Schedule and Class Schedule views, which use their own renderers.
  if (allInSpecials) {
    const entry   = specInfo.all[0];
    const sp      = specials.find(s => s.id === entry.subjectId);
    const teacher = SchedState.staff.find(t => t.id === entry.teacherId);
    const borderTop    = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${color};`;
    const borderBottom = isEnd  ? `border-bottom:2px solid ${color};` : '';
    let inner = '';
    if (specInfo.isStart) {
      const mins    = entry.duration;
      const endSlot = minsToTime(timeToMins(slot) + mins);
      const subLine = specInfo.isUnified && sp
        ? `<span class="cell-specials-subject">${escHtml(sp.name)}${teacher ? ' · ' + escHtml(teacher.name.split(' ')[0]) : ''}</span>`
        : '';
      inner = `<span class="cell-label" style="color:${color}">Specials` +
        `<span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(endSlot)} · ${mins} min</span>` +
        `${subLine}</span>`;
    }
    const style = `background:${color}18;border-left:3px solid ${color};${borderTop}${borderBottom}`;
    return `<td class="grid-cell filled${isCont ? ' cont' : ''}${lockedCls}" data-time="${slot}" data-grade="${grade}" style="${style}">${inner}</td>`;
  }

  // ── 2. Special-only: pulled classes are the ONLY thing scheduled here ──
  // Label the contiguous special-only RUN (a special may overlap instruction for
  // part of its length and be special-only for the rest — the label anchors at the
  // first slot of the special-only stretch, not the special's global start).
  const entry    = specInfo.all[0];
  const daySlots = _autoFillSlots(day);
  const slotIdx  = daySlots.indexOf(slot);
  const startIdx = daySlots.indexOf(entry.startTime);
  const specEnd  = startIdx + Math.ceil((entry.duration || 45) / 5) - 1;
  const isSpecOnly = i => i >= startIdx && i <= specEnd && !getBlock(day, grade, daySlots[i]);
  const runStart = !isSpecOnly(slotIdx - 1);
  const runEnd   = !isSpecOnly(slotIdx + 1);
  const bTop     = runStart ? `border-top:2px solid ${color};` : 'border-top:1px solid transparent;';
  const bBot     = runEnd   ? `border-bottom:2px solid ${color};` : '';
  let inner = '';
  if (runStart) {
    let e = slotIdx;
    while (isSpecOnly(e + 1)) e++;
    const runEndSlot = minsToTime(timeToMins(daySlots[e]) + 5);
    const n          = specInfo.all.length;
    const subjIds    = [...new Set(specInfo.all.map(x => x.subjectId))];
    const nm         = subjIds.length === 1 ? (specials.find(s => s.id === subjIds[0])?.name || 'Specials') : 'Specials';
    inner = `<span class="cell-label" style="color:${color}">${escHtml(nm)}` +
      `<span class="cell-time">${fmtTime12(slot)} – ${fmtTime12(runEndSlot)}</span>` +
      `<span class="cell-specials-subject">${n} ${n === 1 ? 'class' : 'classes'} out</span></span>`;
  }
  const style = `background:${color}18;border-left:3px solid ${color};${bTop}${bBot}`;
  return `<td class="grid-cell filled${runStart ? '' : ' cont'}${lockedCls}" data-time="${slot}" data-grade="${grade}" style="${style}">${inner}</td>`;
}

// Small "N classes → Special" pill appended to an instruction block when some of the
// grade's classes are away at an off-carousel special during that block.
function _buildPulloutTag(specInfo) {
  const specColor = (SchedState.blockTypes.find(b => b.id === 'bt_spec')?.color) || '#f97316';
  const specials  = SchedState.school.specials || [];
  const subjIds   = [...new Set(specInfo.all.map(e => e.subjectId))];
  const n         = specInfo.all.length;
  const nm        = subjIds.length === 1 ? (specials.find(s => s.id === subjIds[0])?.name || 'Specials') : 'Specials';
  return `<span class="cell-pullout-tag" title="${escHtml(`${n} ${n === 1 ? 'class' : 'classes'} pulled to ${nm}`)}" ` +
    `style="background:${specColor}1f;color:${specColor};">${n} ${n === 1 ? 'class' : 'classes'} → ${escHtml(nm)}</span>`;
}

// Core placement logic — pure data mutation, no DOM or storage side effects.
// clearFirst=true  → wipe existing requirement slots before placing (grade-header click).
// clearFirst=false → only place blocks that have ZERO slots placed; skip any
//                    block that exists even partially to prevent double-placement.
// onlyDay — if provided, only process that specific day (used by switchDay for efficiency).
// Find two non-overlapping contiguous free runs that together hold totalSlots,
// each at least minSlots long. Returns [{startIdx, len}, {startIdx, len}] or null.
function _findSplitPlacements(allSlots, occupied, totalSlots, minSlots) {
  if (totalSlots < minSlots * 2) return null;
  const runs = [];
  let runStart = -1, runLen = 0;
  for (let i = 0; i < allSlots.length; i++) {
    if (!occupied.has(allSlots[i])) {
      if (runStart === -1) { runStart = i; runLen = 1; } else runLen++;
    } else {
      if (runStart !== -1 && runLen >= minSlots) runs.push({ start: runStart, len: runLen });
      runStart = -1; runLen = 0;
    }
  }
  if (runStart !== -1 && runLen >= minSlots) runs.push({ start: runStart, len: runLen });
  if (runs.length < 2) return null;
  for (let i = 0; i < runs.length - 1; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const r1 = runs[i], r2 = runs[j];
      const chunk1 = Math.min(r1.len, totalSlots - minSlots);
      const chunk2 = totalSlots - chunk1;
      if (chunk1 >= minSlots && chunk2 <= r2.len) {
        return [{ startIdx: r1.start, len: chunk1 }, { startIdx: r2.start, len: chunk2 }];
      }
    }
  }
  return null;
}

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
        if (pid === 'bt_spec') return;    // specials handled by buildSpecialsSchedule
        if (isFixedBlock(sv)) return;     // lunch/recess/mm placed by preFillFixedBlocks
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
      if (isFixedBlock(req.id)) return; // preFillFixedBlocks handles these at a fixed time

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
        // Fill-gaps pass: leave any block that ALREADY has slots exactly where it
        // is. Re-placing a partially-placed block used to clear its remnant and
        // re-lay it — which, on a tight day, fell through to the split fallback and
        // cut the block into two pieces (a manual move could trigger this on the
        // next render). Only completely-missing blocks are placed fresh below; the
        // unplaced-blocks banner flags anything left short, and the grade-header
        // "auto-fill" (clearFirst=true) is the explicit way to re-lay a grade.
        const existingCount = allSlots.filter(sl => sched[sl] === unit.id).length;
        if (existingCount > 0) return;
      }
      // Try single contiguous placement
      let placed = false;
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
          placed = true;
          break;
        }
      }

      // Split fallback: only for top-level blocks (not sub-blocks), when configured per band
      if (!placed && !unit.id.includes('|')) {
        const parentBt = SchedState.blockTypes.find(b => b.id === unit.id);
        if (parentBt?.splitAllowed?.[band.id]) {
          const minSlots = Math.ceil(((parentBt.splitMinMinutes || {})[band.id] || 15) / 5);
          const split = _findSplitPlacements(allSlots, occupied, unit.slots, minSlots);
          if (split) {
            split.forEach(chunk => {
              for (let j = 0; j < chunk.len; j++) {
                sched[allSlots[chunk.startIdx + j]] = unit.id;
                occupied.add(allSlots[chunk.startIdx + j]);
              }
            });
          }
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
  // Clear this grade first (if requested) so paired blocks re-sync to the shared
  // time before instruction fills the gaps around them.
  if (clearFirst) _clearRequirementsForGrade(grade);
  placePairedBlocks();
  _populateGradeData(grade, false, null);
  saveToLocal();
  rebuildTbody();
  showSpecialsCoverageBanner();
  showUnplacedBlocksBanner();
  showPairingWarning();
  renderGradeSummaryRow();
}

// ── Grade pairings: synchronized instructional blocks ─────────────────────────
// A pairing forces one block/sub-block to start at the SAME time across a set of
// grades, every day (independent of grade bands). Placed AFTER specials + fixed
// blocks and BEFORE instruction fill, so specials keep priority and instruction
// flows around the synchronized windows.

// Active grades for a pairing: in the school, in a band, with >0 minutes for the
// unit. Returns [{ grade, slots }] (slots = the grade's own duration; may differ).
function _pairingActiveInfo(p) {
  const bands = SchedState.school.gradeBands || [];
  const schoolGrades = new Set(gradesSorted());
  const req = SchedState.blockTypes.find(bt => bt.id === p.blockId);
  if (!req) return [];
  const info = [];
  (p.grades || []).forEach(g => {
    if (!schoolGrades.has(g)) return;
    const band = bands.find(b => b.grades.includes(g));
    if (!band) return;
    const mins = p.subId
      ? (((req.subBandMinutes || {})[p.subId] || {})[band.id] || 0)
      : ((req.bandMinutes || {})[band.id] || 0);
    if (mins > 0) info.push({ grade: g, slots: Math.ceil(mins / 5) });
  });
  return info;
}

// If the pairing is "aligned" — on every day, every active grade has the unit
// present (≥ its slot count) and starting at the SAME time — return the shared
// start times as { day: 'HH:MM' }; otherwise null. (The start times are needed
// for the same-unit non-overlap math, not just a yes/no.)
function _pairingCurrentTimes(unitId, info) {
  const times = {};
  for (const day of DAYS) {
    const daySlots = _autoFillSlots(day);
    let common = null;
    for (const { grade, slots } of info) {
      const sched = SchedState.masterSchedule[day]?.[grade] || {};
      const start = daySlots.find(sl => sched[sl] === unitId);
      if (!start) return null;
      if (daySlots.filter(sl => sched[sl] === unitId).length < slots) return null;
      if (common === null) common = start;
      else if (start !== common) return null;
    }
    times[day] = common;
  }
  return times;
}

function _pairingSatisfied(unitId, info) {
  return !!_pairingCurrentTimes(unitId, info);
}

// Find a start time that fits EVERY active grade's block (avoiding fixed blocks &
// specials — those slots are occupied; empty/instruction slots are fine because
// this runs on a fresh build where instruction was cleared by buildSpecialsSchedule).
// Prefer ONE fixed time across all days; fall back to per-day. Returns { day: 'HH:MM' } or {}.
// avoidByDay: { day: [{ s, e }] } — minute-windows already claimed by OTHER
// pairings of the SAME unit this pass. A candidate time is rejected if this
// pairing's window [T, T + maxSlots*5) overlaps any of them, so two groups doing
// the same block (e.g. two WIN groups) never land at the same time.
function _findPairingTimes(unitId, info, avoidByDay = {}) {
  const maxSlots = Math.max(...info.map(i => i.slots));
  const fits = (grade, slotsN, day, startIdx, daySlots) => {
    if (startIdx < 0 || startIdx + slotsN > daySlots.length) return false;
    const sched = SchedState.masterSchedule[day]?.[grade] || {};
    for (let j = 0; j < slotsN; j++) {
      const v = sched[daySlots[startIdx + j]];
      if (v && v !== unitId) return false; // occupied by a different block
    }
    return true;
  };
  // The pairing occupies [T, T + maxSlots*5) on a day (longest grade's block);
  // that window must not overlap a same-unit window already claimed.
  const clearOfSameUnit = (day, T) => {
    const s = timeToMins(T), e = s + maxSlots * 5;
    return !(avoidByDay[day] || []).some(w => s < w.e && w.s < e);
  };
  const ref = _autoFillSlots('Monday');
  for (let i = 0; i < ref.length; i++) {
    const T = ref[i];
    let ok = true;
    for (const day of DAYS) {
      const daySlots = _autoFillSlots(day);
      const idx = daySlots.indexOf(T);
      if (!clearOfSameUnit(day, T)) { ok = false; break; }
      for (const { grade, slots } of info) {
        if (!fits(grade, slots, day, idx, daySlots)) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) { const m = {}; DAYS.forEach(d => m[d] = T); return m; }
  }
  const perDay = {}; let any = false;
  DAYS.forEach(day => {
    const daySlots = _autoFillSlots(day);
    for (let i = 0; i < daySlots.length; i++) {
      const T = daySlots[i];
      if (!clearOfSameUnit(day, T)) continue;
      let ok = true;
      for (const { grade, slots } of info) {
        if (!fits(grade, slots, day, i, daySlots)) { ok = false; break; }
      }
      if (ok) { perDay[day] = T; any = true; break; }
    }
  });
  return any ? perDay : {};
}

function _placePairingUnit(day, grade, unitId, start, slotsN) {
  if (gridUI.lockedGrades.has(grade)) return;
  if (!SchedState.masterSchedule[day])        SchedState.masterSchedule[day] = {};
  if (!SchedState.masterSchedule[day][grade]) SchedState.masterSchedule[day][grade] = {};
  const sched    = SchedState.masterSchedule[day][grade];
  const daySlots = _autoFillSlots(day);
  daySlots.forEach(sl => { if (sched[sl] === unitId) delete sched[sl]; }); // drop any scattered copies
  const si = daySlots.indexOf(start);
  if (si < 0) return;
  for (let j = 0; j < slotsN && si + j < daySlots.length; j++) sched[daySlots[si + j]] = unitId;
}

// Place all synchronized blocks. Idempotent: a pairing already aligned AND not
// colliding with another same-unit group is left as-is; otherwise it's (re)placed
// at a shared time. Two pairings of the SAME unit (e.g. WIN for 2/3 and WIN for
// 4/5) are kept in fully non-overlapping windows — a shared intervention
// specialist can't cover both at once. Anything that can't fit is left for
// showPairingWarning to flag.
function placePairedBlocks() {
  const pairings = SchedState.school.blockPairings || [];
  if (!pairings.length) return;
  const gradeRank = g => (GRADE_ORDER[g] !== undefined ? GRADE_ORDER[g] : 99);

  // Precompute; drop pairings with <2 active grades.
  const items = pairings.map((p, idx) => {
    const info = _pairingActiveInfo(p);
    if (info.length < 2) return null;
    return {
      idx, info,
      unitId:   p.subId ? `${p.blockId}|${p.subId}` : p.blockId,
      maxSlots: Math.max(...info.map(i => i.slots)),
      minRank:  Math.min(...info.map(i => gradeRank(i.grade))),
    };
  }).filter(Boolean);

  // Deterministic order so staggering is stable across renders: lower grades
  // claim earlier slots within a unit, then config order.
  items.sort((a, b) => a.minRank - b.minRank || a.idx - b.idx);

  // Windows claimed so far, per unit: { unitId: { day: [{ s, e }] } }.
  const claimed = {};
  const record = (unitId, times, maxSlots) => {
    const byDay = (claimed[unitId] = claimed[unitId] || {});
    DAYS.forEach(day => {
      const T = times[day];
      if (!T) return;
      const s = timeToMins(T);
      (byDay[day] = byDay[day] || []).push({ s, e: s + maxSlots * 5 });
    });
  };
  const conflicts = (times, maxSlots, avoidByDay) => DAYS.some(day => {
    const T = times[day];
    if (!T) return false;
    const s = timeToMins(T), e = s + maxSlots * 5;
    return (avoidByDay[day] || []).some(w => s < w.e && w.s < e);
  });

  items.forEach(({ info, unitId, maxSlots }) => {
    const avoidByDay = claimed[unitId] || {};
    // Keep an already-aligned, non-colliding placement as-is (idempotent).
    const cur = _pairingCurrentTimes(unitId, info);
    if (cur && !conflicts(cur, maxSlots, avoidByDay)) { record(unitId, cur, maxSlots); return; }
    // (Re)place at a shared time that avoids earlier same-unit windows.
    const times = _findPairingTimes(unitId, info, avoidByDay);
    if (!Object.keys(times).length) return; // showPairingWarning flags it
    info.forEach(({ grade, slots }) => {
      DAYS.forEach(day => { if (times[day]) _placePairingUnit(day, grade, unitId, times[day], slots); });
    });
    record(unitId, times, maxSlots);
  });
}

function showPairingWarning() {
  const existing = document.getElementById('pairing-banner');
  if (existing) existing.remove();
  const pairings = SchedState.school.blockPairings || [];
  const issues = [];
  const placedByUnit = {}; // unitId -> [{ name, label, times, maxSlots }]

  pairings.forEach(p => {
    const info = _pairingActiveInfo(p);
    if (info.length < 2) return;
    const unitId = p.subId ? `${p.blockId}|${p.subId}` : p.blockId;
    const label  = info.map(i => GRADE_LABELS[i.grade] || i.grade).join(', ');
    const times  = _pairingCurrentTimes(unitId, info);
    if (!times) {
      issues.push(`<strong>${escHtml(getBtName(unitId))}</strong> (${escHtml(label)}) — couldn't be placed at one shared time for all grades`);
      return;
    }
    (placedByUnit[unitId] = placedByUnit[unitId] || []).push({
      name: getBtName(unitId), label, times, maxSlots: Math.max(...info.map(i => i.slots)),
    });
  });

  // Same-unit non-overlap rule: two groups doing the same block must not share time.
  Object.values(placedByUnit).forEach(list => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const overlaps = DAYS.some(day => {
          const ta = a.times[day], tb = b.times[day];
          if (!ta || !tb) return false;
          const as = timeToMins(ta), ae = as + a.maxSlots * 5;
          const bs = timeToMins(tb), be = bs + b.maxSlots * 5;
          return as < be && bs < ae;
        });
        if (overlaps) {
          issues.push(`<strong>${escHtml(a.name)}</strong> — ${escHtml(a.label)} and ${escHtml(b.label)} are scheduled at the same time (paired groups for the same block must not overlap)`);
        }
      }
    }
  });

  if (!issues.length) return;
  const banner = document.createElement('div');
  banner.id = 'pairing-banner';
  banner.className = 'setup-banner setup-banner-error';
  banner.innerHTML = `⚠ <strong>Synchronized blocks:</strong>` +
    `<ul style="margin:4px 0 0 16px;padding:0">${issues.map(t => `<li>${t}</li>`).join('')}</ul>` +
    `<div style="font-size:12px;margin-top:4px">Free up space (lunch/recess/specials) or reduce minutes so each group can get its own time.</div>`;
  _mountWarning(banner);
}

// Called from renderMasterSchedule. Runs _populateGradeData for every grade so that:
// • Empty grades get filled on first entry.
// • Grades whose early-release-day blocks were placed at full-day range (old files)
//   get re-placed in the visible morning window (the new skip condition detects that
//   existingCount within the short allSlots is 0 and re-places the block).
// • Blocks displaced by lunch/recess overwriting get re-placed in free space.
// _populateGradeData with clearFirst=false is a no-op for blocks already fully placed
// within the day's slot range, so this is safe to run on every render.
// Canonical placement order for a full (all-grades, all-days) pass. The order is
// load-bearing: specials first (they clear instruction on rebuild and get first
// pick), then fixed blocks, then synchronized pairings, then instruction fills the
// gaps (clearFirst=false leaves fully-placed blocks — including manual moves — as
// is). Keep this the ONE place the sequence lives so a new step (like pairings)
// can't be added to some paths and forgotten in others. switchDay/autoPopulateGrade
// use scoped variants (single day / single grade) and intentionally differ.
function rebuildPlacement() {
  buildSpecialsSchedule();
  preFillFixedBlocks();
  placePairedBlocks();
  gradesSorted().forEach(grade => _populateGradeData(grade, false, null));
}

function autoPopulateIfEmpty() {
  rebuildPlacement();
  _purgeFixedBlockConflicts();
  _cleanupStaleIAAssignments();
  saveToLocal();
  rebuildTbody();
  showSpecialsConflictWarning();
  showUnplacedBlocksBanner();
  showPairingWarning();
  renderGradeSummaryRow();
}

// Called after Block Types is saved: fills any required blocks that aren't
// placed yet without touching blocks that already exist.
function fillMissingRequirements() {
  rebuildPlacement();
  _cleanupStaleIAAssignments();
  saveToLocal();
  rebuildTbody();
  showLunchOutOfHoursWarning();
  showRecessSpacingWarning();
  showOverBudgetWarning();
  showMissingRequirementsWarning();
  showSpecialsConflictWarning();
  showConflictBanner();
  showUnplacedBlocksBanner();
  showPairingWarning();
  renderGradeSummaryRow();
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
  placePairedBlocks();
  gradesSorted().forEach(grade => _populateGradeData(grade, false, day));
  saveToLocal();
  document.querySelectorAll('.day-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.day === day));
  rebuildTbody();
  if (iaMasterState.active) {
    iaMasterState.grade = null; iaMasterState.startSlot = null;
    document.querySelectorAll('.grid-cell.ia-selected').forEach(c => c.classList.remove('ia-selected'));
    const pb = document.getElementById('ia-panel-body');
    if (pb) pb.innerHTML = '<p class="ia-panel-hint">Click any filled block in the schedule to assign an IA.</p>';
  }
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

// Removes iaSchedule entries whose underlying master-schedule block no longer exists.
// Called whenever the master schedule is saved or auto-filled.
// Accumulates removed count in SchedState.iaStalePurgeCount for the IA tab banner.
function _cleanupStaleIAAssignments() {
  const ia = SchedState.iaSchedule || {};
  let removed = 0;

  DAYS.forEach(day => {
    const dayMap = ia[day] || {};
    Object.keys(dayMap).forEach(iaId => {
      const slots = dayMap[iaId];
      Object.keys(slots).forEach(slot => {
        const entry = slots[slot];
        if (!entry) return;

        let gradeToCheck = null;
        if (entry.targetType === 'grade') {
          gradeToCheck = entry.targetId;
        } else if (entry.targetType === 'class') {
          const teacher = (SchedState.staff || []).find(s => s.id === entry.targetId);
          gradeToCheck = teacher?.gradeAssignment || null;
        }

        if (gradeToCheck) {
          const masterSlot = (SchedState.masterSchedule[day] || {})[gradeToCheck]?.[slot];
          if (!masterSlot) {
            delete slots[slot];
            removed++;
          }
        }
      });
    });
  });

  if (removed > 0) {
    SchedState.iaStalePurgeCount = (SchedState.iaStalePurgeCount || 0) + removed;
    saveToLocal();
  }
}

function saveMaster() {
  _cleanupStaleIAAssignments();
  saveToLocal();
  const btn = document.getElementById('master-save-btn');
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save'; }, 1500); }
  if (typeof trackEvent === 'function') trackEvent('master_schedule_saved');
}

function saveMasterAndNext() {
  _cleanupStaleIAAssignments();
  saveToLocal();
  navigateTo('specials-sched');
  renderSpecialsScheduleView();
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

// IA Schedule view moved to schedule-ia.js
// Export (renderExportPlaceholder, exportJSON, _blendColumnRuns, exportXLSX) moved to schedule-export.js

// Specials coverage validation (getSpecialsCoverageReport, showSpecialsCoverageBanner) moved to schedule-specials-view.js
// Specials Schedule View banner + specialsSchedUI moved to schedule-specials-view.js (classSchedUI stays — extraction 3)
// classSchedUI moved to schedule-class-view.js

// renderSpecialsScheduleView moved to schedule-specials-view.js
// Specials individual override moved to schedule-specials-view.js

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

// Class Schedules view (renderClassSchedulesView + helpers) moved to schedule-class-view.js
// IA assignment (from master schedule) + Individual IA grid + Duty panel moved to schedule-ia.js
