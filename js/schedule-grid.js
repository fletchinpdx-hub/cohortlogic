// ── Master Schedule Grid ──────────────────────────────────────────────────────

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Module-level so helpers can reference without passing args everywhere
let currentSlots  = [];
let currentGrades = [];

const gridUI = {
  activeDay:  'Monday',
  activeBtId: null,
};

// Rectangle drag state
const drag = {
  active:     false,
  hasMoved:   false,
  startGrade: null,
  startSlot:  null,
  endGrade:   null,
  endSlot:    null,
  paintValue: null,  // btId to write, or null (erase)
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

// ── Main render ───────────────────────────────────────────────────────────────

function renderMasterSchedule() {
  currentGrades = gradesSorted();

  if (!currentGrades.length) {
    document.getElementById('view-master').innerHTML = `
      <div class="view-header"><h1>Master Schedule</h1></div>
      <div class="empty-state">
        <div class="empty-icon">🏫</div>
        <p>Select grade levels in School Info before building the schedule.</p>
        <button class="btn btn-primary mt-16" onclick="navigateTo('school'); renderSchoolInfo();">Go to School Info</button>
      </div>
    `;
    return;
  }

  currentSlots = generateTimeSlots(SchedState.school.dayStart, SchedState.school.dayEnd);

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
            <div class="save-status" id="master-save-status"></div>
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

        <div class="grid-scroll-wrap" id="grid-scroll-wrap">
          <table class="sched-table" id="sched-table" cellspacing="0">
            <thead>
              <tr class="sched-head-row">
                <th class="th-time"></th>
                ${currentGrades.map(g => `<th class="th-grade">${GRADE_LABELS[g] || g}</th>`).join('')}
              </tr>
            </thead>
            <tbody id="sched-tbody">
              ${buildTbodyHtml()}
            </tbody>
          </table>
        </div>

        <div class="grid-footer">
          <button class="btn btn-outline" id="master-back-btn">← Back to Block Types</button>
          <button class="btn btn-primary btn-lg" id="master-next-btn">Save & Continue to Specials →</button>
          <div class="save-status" id="master-save-status2"></div>
        </div>
      </div>
    </div>
  `;

  wirePalette();
  wireGridPointer();
  wireDayTabs();

  document.getElementById('master-save-btn').addEventListener('click', saveMaster);
  document.getElementById('master-next-btn').addEventListener('click', saveMasterAndNext);
  document.getElementById('master-back-btn').addEventListener('click', () => { navigateTo('blocks'); renderBlocks(); });
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

  const grade = cell.dataset.grade;
  const slot  = cell.dataset.time;

  // Determine what value we're painting
  // If eraser (activeBtId null) or clicking an already-filled same-block cell → erase
  const existing = getBlock(gridUI.activeDay, grade, slot);
  const paintValue = (gridUI.activeBtId && existing === gridUI.activeBtId)
    ? null : gridUI.activeBtId;

  drag.active     = true;
  drag.hasMoved   = false;
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
  showDragPreview();
}

function onPointerUp(e) {
  if (!drag.active) return;
  drag.active = false;
  clearDragPreview();

  if (!drag.hasMoved) {
    // Single click — check for defaultDuration auto-fill
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
      showSaveStatus('master-save-status',
        `Copied to ${opt.dataset.target === 'ALL' ? 'all days' : opt.dataset.target} ✓`);
    });
  });

  setTimeout(() => {
    document.addEventListener('click', e => {
      if (!menu.contains(e.target) && e.target.id !== 'copy-day-btn') menu.remove();
    }, { once: true });
  }, 0);
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function saveMaster() {
  saveToLocal();
  showSaveStatus('master-save-status', 'Saving…');
  const result = await saveToSupabase();
  showSaveStatus('master-save-status', result.ok ? 'Saved ✓' : 'Saved locally');
  if (typeof trackEvent === 'function') trackEvent('master_schedule_saved');
}

async function saveMasterAndNext() {
  saveToLocal();
  showSaveStatus('master-save-status2', 'Saving…');
  const result = await saveToSupabase();
  showSaveStatus('master-save-status2', result.ok ? 'Saved ✓' : 'Saved locally');
  setTimeout(() => { navigateTo('specials'); renderSpecialsPlaceholder(); }, 500);
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
      <button class="btn btn-outline mt-16" onclick="navigateTo('master'); renderMasterSchedule();">← Back to Master Schedule</button>
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
      <button class="btn btn-outline mt-16" onclick="navigateTo('specials'); renderSpecialsPlaceholder();">← Back to Specials</button>
    </div>
  `;
}

function renderExportPlaceholder() {
  document.getElementById('view-export').innerHTML = `
    <div class="view-header">
      <h1>Export</h1>
      <p class="view-subtitle">Export your completed schedule to Excel, Google Sheets, or generate per-staff print views.</p>
    </div>
    <div class="coming-next-card">
      <div class="coming-next-icon">📤</div>
      <h2>Coming next</h2>
      <p>Once your master schedule, Specials, and IA sections are complete, you'll export the full building schedule with tabs matching your existing Numbers file structure.</p>
      <button class="btn btn-outline mt-16" onclick="navigateTo('master'); renderMasterSchedule();">← Back to Master Schedule</button>
    </div>
  `;
}
