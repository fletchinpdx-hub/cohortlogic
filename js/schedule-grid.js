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
      `(${b.dayTotal} min day − ${b.mmMins} mtg − ${b.lunchMins} lunch − ${b.recessMins} recess). ` +
      `Over by <strong>${b.required - b.available} min</strong>.</li>`
    ).join('')}</ul></div>` +
    `<button class="btn-link setup-banner-link">Fix in Block Types →</button>`;

  const scrollWrap = document.getElementById('grid-scroll-wrap');
  if (scrollWrap) scrollWrap.before(banner);
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

  if (!items.length) return;

  const banner = document.createElement('div');
  banner.id = 'recess-spacing-banner';
  banner.className = 'setup-banner setup-banner-error';
  banner.innerHTML =
    `<div><strong>Recess placement issue:</strong>` +
    `<ul>${items.map(t => `<li>${t}</li>`).join('')}</ul></div>` +
    `<button class="btn-link setup-banner-link">Fix in School Info →</button>`;

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

  const seen   = new Set();
  const issues = [];

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
          DAYS.forEach(day => {
            const sched    = (SchedState.masterSchedule[day] || {})[grade] || {};
            const allSlots = _autoFillSlots(day);
            const placed   = allSlots.filter(sl => sched[sl] === unit.id).length;
            if (placed < unit.expected) {
              const key = `${grade}|${unit.id}`;
              if (!seen.has(key)) {
                seen.add(key);
                issues.push({ grade, label: unit.label });
              }
            }
          });
        });
      });
  });

  if (!issues.length) return;

  const banner = document.createElement('div');
  banner.id        = 'unplaced-blocks-banner';
  banner.className = 'setup-banner setup-banner-error';
  banner.innerHTML =
    `⚠ <strong>Required blocks couldn't be placed — not enough room:</strong> ` +
    issues.map(i => `${GRADE_LABELS[i.grade] || i.grade}: <strong>${escHtml(i.label)}</strong>`).join(', ') +
    `. Try clearing and re-filling the grade, or reduce time requirements in Block Types.`;

  const scrollWrap = document.getElementById('grid-scroll-wrap');
  if (scrollWrap) scrollWrap.before(banner);
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

        <div id="grade-summary-wrap" class="grade-summary-wrap"></div>

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
      const _iaAssigns = getIAsForBlock(day, grade, slot);
      if (_iaAssigns.length) {
        inner += '<span class="ia-block-ind">' + _iaAssigns.map(({ ia, alloc }) =>
          `<span class="ia-ind-dot" style="background:${alloc?.color || '#6b7280'}" title="${escHtml(ia.name + (alloc ? ' · ' + alloc.name : ''))}"></span>`
        ).join('') + '</span>';
      }
    }
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

    // Carousel model: find the best start time PER DAY (may differ across days)
    // so that all classes in the grade share one time slot on each given day.
    // Using per-day times (vs. one fixed time for all 5 days) avoids the gap where
    // a teacher claimed by an earlier grade on one day blocks the entire week.
    const gradeIdx = allGrades.indexOf(grade);
    const rotation = computeClassSpecialsRotation(classes, specials, gradeIdx);
    let gradeTimesPerDay = findGradeSpecialsTime(grade, classes, rotation, specials, isFree);
    if (!Object.keys(gradeTimesPerDay).length) {
      _clearRequirementsForGrade(grade);
      gradeTimesPerDay = findGradeSpecialsTime(grade, classes, rotation, specials, isFree);
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

    // Recovery pass: fill any cpw shortfall. Try the day's carousel time first,
    // then any open slot off-carousel.
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
function buildSpecialsCell(slot, grade, specInfo, isCont, isEnd) {
  const day       = gridUI.activeDay;
  const bt        = SchedState.blockTypes.find(b => b.id === 'bt_spec');
  const fallback  = bt?.color || '#f97316';
  const lockedCls = gridUI.lockedGrades.has(grade) ? ' grade-locked' : '';

  // Show a single full-width block whenever ALL classes are in specials,
  // OR whenever the masterSchedule slot is itself bt_spec — splitting when
  // both halves represent specials creates a misleading "Specials | Music" display.
  const _slotBtId     = getBlock(day, grade, slot);
  const allInSpecials = specInfo.all.length === specInfo.totalClasses ||
                        (_slotBtId && _slotBtId.startsWith('bt_spec'));

  if (allInSpecials) {
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

  // Mixed split: some classes have specials, others have a different block.
  // Each half is independently draggable.
  const entry   = specInfo.all[0];
  const sp      = (SchedState.school.specials || []).find(s => s.id === entry.subjectId);
  const color   = sp?.color || fallback;
  const borderTop    = isCont ? 'border-top:1px solid transparent;' : `border-top:2px solid ${color};`;
  const borderBottom = isEnd  ? `border-bottom:2px solid ${color};` : '';

  // Right half: the masterSchedule block the non-specials classes are doing
  const masterBtId  = getBlock(day, grade, slot);
  const masterBt    = masterBtId
    ? (SchedState.blockTypes.find(b => b.id === masterBtId) ||
       SchedState.blockTypes.find(b => masterBtId.startsWith(b.id + '|')))
    : null;
  const masterColor = masterBt?.color || '#94a3b8';
  const masterName  = masterBtId ? getBtName(masterBtId) : '';

  let leftInner = '', rightInner = '';
  if (specInfo.isStart) {
    leftInner  = `<span class="split-label" style="color:${color}">Specials</span>`;
    rightInner = `<span class="split-label" style="color:${masterColor}">${escHtml(masterName)}</span>`;
  }

  return `<td class="grid-cell split-cell${isCont ? ' cont' : ''}${lockedCls}" data-time="${slot}" data-grade="${grade}" style="${borderTop}${borderBottom}">` +
    `<div class="split-block-wrap">` +
    `<div class="split-half split-half-specials" style="background:${color}18;border-left:3px solid ${color};" data-spec-start="${entry.startTime}" data-spec-grade="${grade}">${leftInner}</div>` +
    `<div class="split-half split-half-regular" style="background:${masterColor}18;border-left:3px solid ${masterColor};">${rightInner}</div>` +
    `</div></td>`;
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
  _populateGradeData(grade, clearFirst, null);
  saveToLocal();
  rebuildTbody();
  showSpecialsCoverageBanner();
  showUnplacedBlocksBanner();
  renderGradeSummaryRow();
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
  showUnplacedBlocksBanner();
  renderGradeSummaryRow();
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
  showRecessSpacingWarning();
  showOverBudgetWarning();
  showMissingRequirementsWarning();
  showSpecialsConflictWarning();
  showConflictBanner();
  showUnplacedBlocksBanner();
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

function saveMaster() {
  saveToLocal();
  const btn = document.getElementById('master-save-btn');
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save'; }, 1500); }
  if (typeof trackEvent === 'function') trackEvent('master_schedule_saved');
}

function saveMasterAndNext() {
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
const iaMasterState = {
  active:    false,
  grade:     null,   // grade key of selected block
  btId:      null,   // block type id of selected block
  startSlot: null,   // first 5-min slot of selected block
  endSlot:   null,   // last 5-min slot of selected block
};

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
  const allocBar = `
    <div class="ia-budget-bar">
      <span class="ia-budget-bar-lbl">Budget:</span>
      ${allocs.map(a => {
        const usedPerDay = _allocWeeklyHrs[a.id] / 5;
        const target     = a.hoursPerDay || 0;
        const over       = target > 0 && usedPerDay > target;
        const usageTxt   = target > 0
          ? ` · ${usedPerDay.toFixed(1)}/${target}h/day`
          : (usedPerDay > 0 ? ` · ${usedPerDay.toFixed(1)}h/day` : '');
        const chipStyle  = over
          ? `background:#fee2e2;border:1px solid #fca5a5;color:#dc2626`
          : `background:${a.color}18;border:1px solid ${a.color}50;color:${a.color}`;
        return `<span class="ia-budget-chip" style="${chipStyle}">${escHtml(a.name)}${usageTxt}</span>`;
      }).join('')}
      <button class="ia-budget-manage-btn" id="ia-budget-manage-btn">${allocs.length ? '+ Manage' : '+ Add categories'}</button>
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
           <button class="btn btn-primary btn-sm ia-empty-go-btn" id="ia-empty-go-btn">← Go to Master Schedule</button>
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

  container.innerHTML = `
    <div class="ia-view-shell">
      <div class="ia-view-top-bar">
        <div>
          <h1 class="grid-title">IA Schedules</h1>
          <p class="grid-subtitle">View IA schedules here. To assign IAs, go to the Master Schedule and click a block.</p>
        </div>
        <div class="ia-view-top-actions">
          <button class="btn btn-primary btn-sm" id="ia-go-master-btn">← Assign in Master Schedule</button>
          <button class="btn btn-outline btn-sm" id="ia-summary-csv-btn">Download CSV</button>
          <button class="btn btn-outline btn-sm" id="ia-print-btn">Print</button>
        </div>
      </div>
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

      return `<td class="ia-cell filled${isCont ? ' cont' : ''}" data-ia="${ia.id}" data-slot="${slot}"
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
        <p class="form-hint">Downloads an Excel workbook with the following tabs:</p>
        <ul class="form-hint" style="margin:6px 0 12px 18px;line-height:1.7">
          <li><strong>Mon – Fri</strong> — master schedule grid, one tab per day</li>
          <li><strong>Class Schedules</strong> — each class's full week, with specific specials subjects filled in</li>
          <li><strong>Specials</strong> — each specials teacher's weekly assignment list</li>
          <li><strong>IA Schedule</strong> — each IA's daily assignments with grade, category, and note</li>
          <li><strong>School Info</strong> + <strong>Staff</strong> — reference tabs</li>
        </ul>
        <button class="btn btn-primary" id="export-xlsx-btn">Download Excel (.xlsx)</button>
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
  const days   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const slots  = generateTimeSlots(s.firstBell || s.dayStart || '08:00', s.dismissal || s.dayEnd || '14:30');
  const ss     = SchedState.specialsSchedule || {};
  const specials = s.specials || [];

  // Resolve block name including specials subject and morning-meeting name
  const cellLabel = (btId) => btId ? getBtName(btId) : '';

  // For a class on a given day+slot, returns the specific specials subject if applicable
  const classLabel = (clsId, grade, day, slot) => {
    const master = ((SchedState.masterSchedule || {})[day]?.[grade] || {})[slot];
    if (!master) return '';
    if (master === 'bt_spec' || master.startsWith('bt_spec|')) {
      const entry = ss[clsId]?.[day];
      if (entry) {
        const sp   = specials.find(x => x.id === entry.subjectId);
        const dur  = sp?.duration || 45;
        const dsl  = _autoFillSlots(day);
        const si   = dsl.indexOf(entry.startTime);
        const idx  = dsl.indexOf(slot);
        if (si >= 0 && idx >= si && idx < si + Math.ceil(dur / 5)) {
          return sp ? sp.name : 'Specials';
        }
      }
      return 'Specials';
    }
    return cellLabel(master);
  };

  const wb = XLSX.utils.book_new();

  // ── One tab per weekday (master schedule) ───────────────────────
  days.forEach(day => {
    const dayData = ((SchedState.masterSchedule || {})[day]) || {};
    const header  = ['Time', ...grades.map(g => GRADE_LABELS[g] || g)];
    const rows    = [header, ...slots.map(slot => [
      fmtTime12(slot),
      ...grades.map(g => {
        const id = (dayData[g] || {})[slot];
        return id ? cellLabel(id) : '';
      })
    ])];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 9 }, ...grades.map(() => ({ wch: 22 }))];
    XLSX.utils.book_append_sheet(wb, ws, day.slice(0, 3));
  });

  // ── Class Schedules tab ─────────────────────────────────────────
  const allClasses = grades.flatMap(g => getClassesForGrade(g));
  if (allClasses.length) {
    const hdr  = ['Class', 'Time', ...days.map(d => d.slice(0, 3))];
    const rows = [hdr];
    allClasses.forEach(cls => {
      const gradeLabel = GRADE_LABELS[cls.gradeAssignment] || cls.gradeAssignment || '';
      rows.push([cls.name ? `${cls.name} (${gradeLabel})` : gradeLabel]);
      slots.forEach(slot => {
        rows.push([
          '',
          fmtTime12(slot),
          ...days.map(day => classLabel(cls.id, cls.gradeAssignment, day, slot)),
        ]);
      });
      rows.push([]); // blank row between classes
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 9 }, ...days.map(() => ({ wch: 18 }))];
    XLSX.utils.book_append_sheet(wb, ws, 'Class Schedules');
  }

  // ── Specials tab ────────────────────────────────────────────────
  const specialTeacherIds = new Set(specials.flatMap(sp => sp.teacherIds || []));
  const specialTeachers   = (SchedState.staff || []).filter(t => specialTeacherIds.has(t.id));
  if (specialTeachers.length && Object.keys(ss).length) {
    const hdr  = ['Teacher', ...days.map(d => d.slice(0, 3))];
    const rows = [hdr];
    specialTeachers.forEach(t => {
      const row = [t.name];
      days.forEach(day => {
        const sessions = [];
        Object.entries(ss).forEach(([clsId, dayMap]) => {
          const entry = dayMap[day];
          if (!entry || entry.teacherId !== t.id) return;
          const sp    = specials.find(x => x.id === entry.subjectId);
          const cls   = (SchedState.staff || []).find(x => x.id === clsId);
          const gl    = cls?.gradeAssignment ? (GRADE_LABELS[cls.gradeAssignment] || cls.gradeAssignment) : '';
          const time  = fmtTime12(entry.startTime);
          sessions.push(`${sp?.name || 'Specials'} — ${gl} ${time}`);
        });
        row.push(sessions.join('\n') || '—');
      });
      rows.push(row);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 24 }, ...days.map(() => ({ wch: 30 }))];
    XLSX.utils.book_append_sheet(wb, ws, 'Specials');
  }

  // ── IA Schedule tab ─────────────────────────────────────────────
  const ias = (SchedState.staff || []).filter(x => x.role === 'ia');
  if (ias.length && SchedState.iaSchedule) {
    const hdr  = ['IA', 'Day', 'Time Block', 'Grade', 'Budget Category', 'Note'];
    const rows = [hdr];
    ias.forEach(ia => {
      days.forEach(day => {
        const dsl = _autoFillSlots(day);
        let prevAlloc = null, blockStart = null, blockGrade = null, blockNote = null;
        const flush = endSlot => {
          if (!prevAlloc || !blockStart) return;
          const alloc = (SchedState.iaAllocations || []).find(a => a.id === prevAlloc);
          const si    = dsl.indexOf(blockStart);
          const ei    = dsl.indexOf(endSlot);
          const mins  = Math.max((ei - si) * 5, 5);
          rows.push([
            ia.name,
            day.slice(0, 3),
            `${fmtTime12(blockStart)} – ${fmtTime12(endSlot)} (${mins} min)`,
            blockGrade ? (GRADE_LABELS[blockGrade] || blockGrade) : '',
            alloc?.name || '',
            blockNote || '',
          ]);
          prevAlloc = null; blockStart = null; blockGrade = null; blockNote = null;
        };
        dsl.forEach(slot => {
          const entry = (SchedState.iaSchedule[day] || {})[ia.id]?.[slot];
          if (!entry) { flush(slot); return; }
          const { allocId, targetId: grade, note } = entry;
          if (allocId !== prevAlloc || grade !== blockGrade) {
            flush(slot);
            prevAlloc = allocId; blockStart = slot; blockGrade = grade; blockNote = note;
          }
        });
        if (dsl.length) flush(dsl[dsl.length - 1]);
      });
    });
    if (rows.length > 1) {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = [{ wch: 20 }, { wch: 7 }, { wch: 28 }, { wch: 12 }, { wch: 22 }, { wch: 32 }];
      XLSX.utils.book_append_sheet(wb, ws, 'IA Schedule');
    }
  }

  // ── School Info tab ──────────────────────────────────────────────
  const recessMap = typeof computeRecessTimes === 'function' ? computeRecessTimes(s) : {};
  const infoRows  = [
    ['School Name',          s.name || ''],
    ['School Year',          s.year || ''],
    [],
    ['Teacher Contract',  (s.teacherContractStart || '') + ' – ' + (s.teacherContractEnd || '')],
    ['Arrival',           s.studentCampusStart || ''],
    ['First Bell',        s.firstBell  || ''],
    ['Dismissal',         s.dismissal  || ''],
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
function toggleIAMasterMode() {
  iaMasterState.active = !iaMasterState.active;
  const panel = document.getElementById('ia-block-panel');
  const btn   = document.getElementById('ia-mode-toggle-btn');
  if (!panel || !btn) return;
  if (iaMasterState.active) {
    panel.classList.remove('ia-panel-hidden');
    btn.textContent = '× Exit IA Mode';
    btn.classList.add('btn-active-ia');
  } else {
    panel.classList.add('ia-panel-hidden');
    btn.textContent = 'Assign IAs';
    btn.classList.remove('btn-active-ia');
    iaMasterState.grade = null;
    iaMasterState.startSlot = null;
    iaMasterState.endSlot = null;
    iaMasterState.btId = null;
    document.querySelectorAll('.grid-cell.ia-selected').forEach(c => c.classList.remove('ia-selected'));
    const body = document.getElementById('ia-panel-body');
    if (body) body.innerHTML = '<p class="ia-panel-hint">Click any filled block in the schedule to assign an IA.</p>';
  }
}

// Called when user clicks a filled block in IA mode — populates the right panel.
function openIABlockPanel(grade, slot) {
  const day   = gridUI.activeDay;
  const btId  = getBlock(day, grade, slot);
  if (!btId) return;
  const startSlot = findBlockStart(day, grade, slot);
  const slots     = getAllBlockSlots(day, grade, startSlot);
  const endSlot   = slots[slots.length - 1];

  // Highlight selected cells
  document.querySelectorAll('.grid-cell.ia-selected').forEach(c => c.classList.remove('ia-selected'));
  slots.forEach(s => {
    const cell = document.querySelector(`#sched-tbody td[data-grade="${grade}"][data-time="${s}"]`);
    if (cell) cell.classList.add('ia-selected');
  });

  iaMasterState.grade     = grade;
  iaMasterState.btId      = btId;
  iaMasterState.startSlot = startSlot;
  iaMasterState.endSlot   = endSlot;

  const panelBody = document.getElementById('ia-panel-body');
  if (!panelBody) return;
  panelBody.innerHTML = buildIABlockPanelHtml(day, grade, startSlot, endSlot, btId, slots);
  wireIABlockPanel(day, grade, startSlot, endSlot, btId, slots);
}

// Build the HTML for the IA assignment panel for a specific block.
function buildIABlockPanelHtml(day, grade, startSlot, endSlot, btId, slots) {
  const ias    = SchedState.staff.filter(s => s.role === 'ia');
  const allocs = SchedState.iaAllocations || [];
  const assignments = getIAsForBlock(day, grade, startSlot);

  // Block header info
  const btName = getBtName(btId);
  const bt     = SchedState.blockTypes.find(b => b.id === btId || btId.startsWith(b.id + '|'));
  const color  = bt?.color || getBtColor(btId) || '#6b7280';
  const gradeLabel = GRADE_LABELS[grade] || grade;
  const endMins    = timeToMins(endSlot) + 5;
  const duration   = endMins - timeToMins(startSlot);
  const timeStr    = `${fmtTime12(startSlot)} – ${fmtTime12(minsToTime(endMins))} · ${duration} min`;

  // Current assignments chips
  const assignChips = assignments.length
    ? assignments.map(({ ia, alloc }) => {
        const allocColor = alloc?.color || '#6b7280';
        const partial    = _getIAPartialTime(day, ia.id, startSlot, slots);
        const timeLabel  = partial
          ? `${fmtTime12(partial.start)} – ${fmtTime12(partial.end)}`
          : 'full block';
        return `<div class="ia-assign-chip">
          <span class="ia-assign-chip-dot" style="background:${allocColor}"></span>
          <div class="ia-assign-chip-info">
            <span class="ia-assign-chip-name">${escHtml(ia.name)}</span>
            <span class="ia-assign-chip-meta">${escHtml(alloc?.name || '')} · ${timeLabel}</span>
          </div>
          <button class="ia-assign-chip-remove" data-remove-ia="${ia.id}">×</button>
        </div>`;
      }).join('')
    : '<p class="ia-panel-no-assign">No IAs assigned yet.</p>';

  // IA picker buttons
  const iaPicker = ias.length
    ? ias.map(ia => `<button class="ia-picker-btn" data-pick-ia="${ia.id}">${escHtml(ia.name)}</button>`).join('')
    : '<p class="ia-panel-no-staff">No IAs on staff. Add IAs in Staff Roster.</p>';

  // Budget category picker
  const allocPicker = allocs.length
    ? allocs.map(a =>
        `<button class="ia-alloc-pick-btn" data-pick-alloc="${a.id}" style="border-color:${a.color}55;color:${a.color}">
          <span class="ia-alloc-pick-dot" style="background:${a.color}"></span>${escHtml(a.name)}
        </button>`).join('')
    : '<p class="ia-panel-no-alloc">No budget categories yet. Add them in IA Schedules.</p>';

  // Time selects for custom range
  const startOpts = slots.map(s => `<option value="${s}">${fmtTime12(s)}</option>`).join('');
  const endOpts   = slots.map((s, i) => {
    const sel = i === slots.length - 1 ? ' selected' : '';
    return `<option value="${s}"${sel}>${fmtTime12(minsToTime(timeToMins(s) + 5))}</option>`;
  }).join('');

  // Days of week — which days have the same block type at the same start time for this grade
  const baseBtId  = btId.split('|')[0];
  const DAY_SHORT = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'Th', Fri: 'F' };
  const availDays = DAYS.filter(d => {
    const slotBt = ((SchedState.masterSchedule[d] || {})[grade] || {})[startSlot];
    return slotBt && slotBt.split('|')[0] === baseBtId;
  });
  const dayChips = availDays.map(d =>
    `<button class="ia-day-chip active${d === day ? ' ia-day-today' : ''}" data-day-chip="${d}">${DAY_SHORT[d] || d.slice(0,2)}</button>`
  ).join('');

  return `
    <div class="ia-panel-block-hdr" style="border-left:3px solid ${color}">
      <div class="ia-panel-block-name" style="color:${color}">${escHtml(btName)}</div>
      <div class="ia-panel-block-grade">${escHtml(gradeLabel)}</div>
      <div class="ia-panel-block-time">${escHtml(timeStr)}</div>
    </div>

    <div class="ia-panel-section-lbl">Assigned IAs</div>
    <div class="ia-assign-chips" id="ia-assign-chips">${assignChips}</div>

    <div class="ia-panel-section-lbl">Add IA</div>
    <div class="ia-panel-add-form">
      <div class="ia-panel-field-lbl">Instructional Assistant</div>
      <div class="ia-picker-btns" id="ia-picker-btns">${iaPicker}</div>

      <div class="ia-panel-field-lbl">Budget Category</div>
      <div class="ia-alloc-pick-btns" id="ia-alloc-pick-btns">${allocPicker}</div>

      <div class="ia-panel-field-lbl">Time in Block</div>
      <div class="ia-time-mode-row">
        <label class="ia-time-radio-lbl"><input type="radio" name="ia-time-mode" value="full" checked> Full block</label>
        <label class="ia-time-radio-lbl"><input type="radio" name="ia-time-mode" value="custom"> Custom</label>
      </div>
      <div class="ia-custom-time-row ia-custom-hidden" id="ia-custom-time-row">
        <select id="ia-custom-start" class="ia-time-select">${startOpts}</select>
        <span class="ia-time-to">to</span>
        <select id="ia-custom-end" class="ia-time-select">${endOpts}</select>
      </div>

      <div class="ia-panel-field-lbl">Days</div>
      <div class="ia-day-chips-row" id="ia-day-chips-row">${dayChips}</div>

      <div class="ia-panel-field-lbl">Note <span class="ia-optional-lbl">(optional)</span></div>
      <textarea class="ia-assign-note-input" id="ia-assign-note" rows="2" placeholder="e.g. Push-in support, reading group"></textarea>

      <button class="btn btn-primary btn-sm ia-confirm-btn" id="ia-confirm-assign-btn" disabled>Assign</button>
    </div>`;
}

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

// Wire events for the IA block assignment panel.
function wireIABlockPanel(day, grade, startSlot, endSlot, btId, slots) {
  const selectedIAIds = new Set();
  let selectedAllocId = null;
  const confirmBtn    = document.getElementById('ia-confirm-assign-btn');

  // Pre-fill from existing assignments on this block
  const preExisting = getIAsForBlock(day, grade, startSlot);
  if (preExisting.length) {
    preExisting.forEach(({ ia, alloc }) => {
      selectedIAIds.add(ia.id);
      if (!selectedAllocId && alloc) selectedAllocId = alloc.id;
    });
  }

  function updateConfirm() {
    if (confirmBtn) confirmBtn.disabled = !(selectedIAIds.size > 0 && selectedAllocId);
  }

  // IA picker — multi-select toggle
  document.querySelectorAll('[data-pick-ia]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pickIa;
      if (selectedIAIds.has(id)) selectedIAIds.delete(id);
      else selectedIAIds.add(id);
      btn.classList.toggle('active', selectedIAIds.has(id));
      updateConfirm();
    });
  });

  // Budget picker
  document.querySelectorAll('[data-pick-alloc]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedAllocId = btn.dataset.pickAlloc;
      document.querySelectorAll('[data-pick-alloc]').forEach(b =>
        b.classList.toggle('active', b.dataset.pickAlloc === selectedAllocId));
      updateConfirm();
    });
  });

  // Reflect pre-existing selections in UI
  if (preExisting.length) {
    selectedIAIds.forEach(id => {
      document.querySelector(`[data-pick-ia="${id}"]`)?.classList.add('active');
    });
    if (selectedAllocId) {
      document.querySelectorAll('[data-pick-alloc]').forEach(b =>
        b.classList.toggle('active', b.dataset.pickAlloc === selectedAllocId));
    }
    const note = preExisting[0]?.entry?.note || '';
    const noteEl = document.getElementById('ia-assign-note');
    if (noteEl && note) noteEl.value = note;
    updateConfirm();
  }

  // Time mode toggle
  document.querySelectorAll('input[name="ia-time-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const customRow = document.getElementById('ia-custom-time-row');
      if (customRow) customRow.classList.toggle('ia-custom-hidden', radio.value !== 'custom');
    });
  });

  // Day chips — track selection, all pre-selected
  const baseBtId    = btId.split('|')[0];
  const selectedDays = new Set(
    DAYS.filter(d => {
      const slotBt = ((SchedState.masterSchedule[d] || {})[grade] || {})[startSlot];
      return slotBt && slotBt.split('|')[0] === baseBtId;
    })
  );
  document.querySelectorAll('[data-day-chip]').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.dayChip;
      if (selectedDays.has(d)) selectedDays.delete(d);
      else selectedDays.add(d);
      btn.classList.toggle('active', selectedDays.has(d));
    });
  });

  // Remove assignment
  document.querySelectorAll('[data-remove-ia]').forEach(btn => {
    btn.addEventListener('click', () => {
      removeBlockIAAssignment(day, btn.dataset.removeIa, grade, slots);
      openIABlockPanel(grade, startSlot);
    });
  });

  // Confirm assignment
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (!selectedIAIds.size || !selectedAllocId) return;
      const timeMode = document.querySelector('input[name="ia-time-mode"]:checked')?.value;
      const cs   = document.getElementById('ia-custom-start')?.value;
      const ce   = document.getElementById('ia-custom-end')?.value;
      const note = document.getElementById('ia-assign-note')?.value.trim() || '';

      Array.from(selectedIAIds).forEach(iaId => {
        Array.from(selectedDays).forEach(assignDay => {
          const daySlots = getAllBlockSlots(assignDay, grade, startSlot);
          if (!daySlots.length) return;
          let assignSlots = daySlots;
          if (timeMode === 'custom' && cs && ce) {
            const si = daySlots.indexOf(cs), ei = daySlots.indexOf(ce);
            if (si >= 0 && ei >= si) assignSlots = daySlots.slice(si, ei + 1);
          }
          commitIAAssignment(assignDay, grade, iaId, selectedAllocId, assignSlots, note);
        });
      });

      openIABlockPanel(grade, startSlot);
    });
  }
}

// Write IA assignment to state and refresh the cell indicator.
function commitIAAssignment(day, grade, iaId, allocId, assignSlots, note) {
  if (!SchedState.iaSchedule[day])       SchedState.iaSchedule[day] = {};
  if (!SchedState.iaSchedule[day][iaId]) SchedState.iaSchedule[day][iaId] = {};
  assignSlots.forEach(slot => {
    SchedState.iaSchedule[day][iaId][slot] = { allocId, targetType: 'grade', targetId: grade, note: note || '' };
  });
  refreshIAIndicator(day, grade, iaMasterState.startSlot);
  saveToLocal();
}

// Remove an IA's grade-level assignment from a block's slots.
function removeBlockIAAssignment(day, iaId, grade, blockSlots) {
  if (!SchedState.iaSchedule[day]?.[iaId]) return;
  blockSlots.forEach(slot => {
    const e = SchedState.iaSchedule[day][iaId][slot];
    if (e && e.targetType === 'grade' && e.targetId === grade) {
      delete SchedState.iaSchedule[day][iaId][slot];
    }
  });
  refreshIAIndicator(day, grade, iaMasterState.startSlot);
  saveToLocal();
}

// Update the IA indicator dots on a block's start cell in the DOM.
function refreshIAIndicator(day, grade, startSlot) {
  if (!startSlot || !grade) return;
  const cell = document.querySelector(`#sched-tbody td[data-grade="${grade}"][data-time="${startSlot}"]`);
  if (!cell) return;
  cell.querySelector('.ia-block-ind')?.remove();
  const assignments = getIAsForBlock(day, grade, startSlot);
  if (assignments.length) {
    const ind = document.createElement('span');
    ind.className = 'ia-block-ind';
    ind.innerHTML = assignments.map(({ ia, alloc }) =>
      `<span class="ia-ind-dot" style="background:${alloc?.color || '#6b7280'}" title="${escHtml(ia.name + (alloc ? ' · ' + alloc.name : ''))}"></span>`
    ).join('');
    cell.appendChild(ind);
  }
}

// ── Individual IA week-view grid ──────────────────────────────────────────────

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
      return `<td class="ia-ind-cell filled${isCont ? ' cont' : ''}" style="${styleStr}">${inner}</td>`;
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

  // Click a duty cell to edit that duty
  container.querySelector('.ia-ind-grid-wrap')?.addEventListener('click', e => {
    const cell = e.target.closest('.duty-cell');
    if (!cell) return;
    const dutyId = cell.dataset.dutyId;
    const duty   = (SchedState.duties || []).find(d => d.id === dutyId);
    if (duty) openDutyPanel(duty, iaSchedUI.focusedIAId);
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

  // Navigate to master schedule and activate IA mode
  function goToMasterWithIA() {
    navigateTo('master');
    renderMasterSchedule();
    if (!iaMasterState.active) toggleIAMasterMode();
  }
  document.getElementById('ia-go-master-btn')?.addEventListener('click', goToMasterWithIA);
  document.getElementById('ia-empty-go-btn')?.addEventListener('click', goToMasterWithIA);

  // Back / forward buttons
  document.getElementById('ia-back-btn')?.addEventListener('click', () => {
    navigateTo('class-sched'); renderClassSchedulesView();
  });
  document.getElementById('ia-next-btn')?.addEventListener('click', () => {
    navigateTo('export'); renderExportPlaceholder();
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
