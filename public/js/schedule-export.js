// ── Export feature ──────────────────────────────────────────────────────────
// Extracted from schedule-grid.js (monolith split, see docs/monolith-split-plan.md).
// Loaded after schedule-class-view.js — shares its global scope (classic scripts,
// no build step). Read-only over SchedState; lowest-risk of the four extractions.

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

// Blend an exported grid to read like the app: for each given column, merge
// contiguous runs of the same value into one vertical cell (the label stays in
// the run's top row; continuation rows are blanked). So a 60-min Math block
// becomes one merged "Math" cell instead of 12 rows each saying "Math". Blanks
// the rows in place and returns the merge ranges for ws['!merges'].
function _blendColumnRuns(rows, cols, firstRow, lastRow) {
  const merges = [];
  cols.forEach(col => {
    let runStart = null, runVal = null;
    const close = endRow => {
      if (runVal != null && runVal !== '' && endRow > runStart) {
        merges.push({ s: { r: runStart, c: col }, e: { r: endRow, c: col } });
      }
    };
    for (let r = firstRow; r <= lastRow; r++) {
      const v = (rows[r] || [])[col];
      const nonEmpty = v != null && v !== '';
      if (nonEmpty && v === runVal) {
        rows[r][col] = ''; // continuation — blanked, covered by the merge
      } else {
        close(r - 1);
        runStart = r;
        runVal   = nonEmpty ? v : null;
      }
    }
    close(lastRow);
  });
  return merges;
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
    // Merge vertical runs per grade column (cols 1..N), rows 1..slots.length.
    const merges = _blendColumnRuns(rows, grades.map((_, i) => i + 1), 1, slots.length);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!merges'] = merges;
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
    // Merge vertical runs per day column (cols 2..N). The blank/class-name rows
    // have empty day cells, so runs never merge across classes.
    const merges = _blendColumnRuns(rows, days.map((_, i) => i + 2), 1, rows.length - 1);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!merges'] = merges;
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
