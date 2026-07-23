// ── Export feature ──────────────────────────────────────────────────────────
// Extracted from schedule-grid.js (monolith split, see docs/monolith-split-plan.md).
// Loaded after schedule-class-view.js — shares its global scope (classic scripts,
// no build step). Read-only over SchedState; lowest-risk of the four extractions.

// The Import/Export view. This is the ONLY place import/export lives — the sidebar
// used to carry a download button plus "load file" links, which split the same job
// across two places and left users unsure which file was which.
//
// Deliberately ONE save format. There used to be a second, parallel system here: an
// exportJSON()/importJSON() pair that downloaded a raw SchedState dump as `.json`,
// alongside the sidebar's downloadScheduleFile() `.cohortlogic`. Two buttons, two
// incompatible shapes, same purpose — a direct cause of the "which file do I keep?"
// confusion. `.cohortlogic` won (it carries _version/_product/_tools and the Class
// Builder `classes` payload; the raw dump carried none of that). Dropping the .json
// DOWNLOAD is safe because loading still accepts .json: a raw SchedState dump has
// `masterSchedule` at top level and no `_product`, which _migrateToCohortLogic()
// treats as an old .clsched. So anyone holding an old .json can still open it.
function renderImportExportView() {
  document.getElementById('view-export').innerHTML = `
    <div class="view-header">
      <h1>Import &amp; Export</h1>
      <p class="view-subtitle">Save your work, pick up where you left off, and share the finished schedule.</p>
    </div>

    <div class="setup-form">

      <div class="form-section">
        <h2 class="form-section-title">Which file is which?</h2>
        <p class="form-hint">There are two files. One is your work. One is the finished product.</p>
        ${_fileFlowDiagram()}
        <div class="file-guide">
          <div class="file-guide-card file-guide-work">
            <div class="file-guide-head">
              <span class="file-guide-icon">📘</span>
              <span class="file-guide-title">Your schedule file<code class="file-ext">.cohortlogic</code></span>
            </div>
            <ul>
              <li><strong>This is your work.</strong> It is the only file you can open again and keep editing.</li>
              <li><strong>Download it every time you finish working.</strong> Until you do, your schedule only exists in this browser, on this computer.</li>
              <li><strong>Keep it somewhere safe</strong> — your school's Google Drive or OneDrive, not just the Downloads folder.</li>
              <li><strong>Email it to a colleague</strong> and they can open it and carry on exactly where you stopped.</li>
            </ul>
          </div>
          <div class="file-guide-card file-guide-share">
            <div class="file-guide-head">
              <span class="file-guide-icon">📗</span>
              <span class="file-guide-title">The Excel file<code class="file-ext">.xlsx</code></span>
            </div>
            <ul>
              <li><strong>This is the finished schedule</strong> — ready to read, print, and hand out.</li>
              <li><strong>Opens in Excel or Google Sheets.</strong> One tab per day, plus class, specials, and IA schedules.</li>
              <li><strong>Share it with staff</strong> or print it for a binder.</li>
              <li><strong>It is a one-way copy.</strong> You cannot load Excel back in — anything you change there will not come back here.</li>
            </ul>
          </div>
        </div>
        <p class="file-guide-rule"><strong>The short version:</strong> keep the <code>.cohortlogic</code> file — it is your original. Share the <code>.xlsx</code> — it is the printout.</p>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Your schedule file</h2>
        <p class="form-hint">Download to save your work. Load to open a file you — or a colleague — saved earlier.</p>
        <div class="ie-actions">
          <button class="btn btn-primary" id="ie-download-btn">↓ Download schedule file</button>
          <label class="btn btn-outline ie-label" for="load-sched-file">↑ Load a schedule file</label>
        </div>
        <p class="ie-note" id="ie-save-note"></p>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Import from Class Builder</h2>
        <p class="form-hint">Already built your classes in Class Builder? Load that file here to bring your school name, grades, and staff across, so you do not type them twice.</p>
        <label class="btn btn-outline ie-label" for="load-cohort-input">↑ Import a Class Builder file</label>
      </div>

      <div class="form-section">
        <h2 class="form-section-title">Export to Excel</h2>
        <p class="form-hint">Downloads an Excel workbook with the following tabs:</p>
        <ul class="form-hint" style="margin:6px 0 12px 18px;line-height:1.7">
          <li><strong>Mon – Fri</strong> — building schedule grid, one tab per day</li>
          <li><strong>Class Schedules</strong> — each class's full week, with specific specials subjects filled in</li>
          <li><strong>Specials</strong> — each specials teacher's weekly assignment list</li>
          <li><strong>IA Schedule</strong> — each IA's daily assignments with grade, category, and note</li>
          <li><strong>School Info</strong> + <strong>Staff</strong> — reference tabs</li>
        </ul>
        <button class="btn btn-primary" id="export-xlsx-btn">Download Excel (.xlsx)</button>
      </div>

    </div>

    <div class="view-actions">
      <button class="btn btn-outline" data-nav="master">← Back to Building Schedule</button>
    </div>
  `;

  document.getElementById('ie-download-btn').addEventListener('click', () => {
    if (!SchedState.school.name) {
      alert('Nothing to download yet — fill in School Info first.');
      return;
    }
    downloadScheduleFile();
    _renderSaveNote();
  });
  document.getElementById('export-xlsx-btn').addEventListener('click', exportXLSX);
  _renderSaveNote();
}

// Tells the user, in plain words, whether their work exists anywhere but this browser.
function _renderSaveNote() {
  const el = document.getElementById('ie-save-note');
  if (!el) return;
  const downloaded = localStorage.getItem('cl_schedule_downloaded') === '1';
  el.className   = 'ie-note ' + (downloaded ? 'ie-note-ok' : 'ie-note-warn');
  el.textContent = downloaded
    ? '✓ You have downloaded a schedule file. Download it again after you make changes, so your saved copy stays up to date.'
    : '⚠ You have not downloaded a schedule file yet. Right now your work only exists in this browser, on this computer — download it to keep it.';
}

// Simple picture of the two paths: the .cohortlogic file round-trips, the .xlsx
// is a dead end. Inline SVG (no script) so it is CSP-safe.
function _fileFlowDiagram() {
  return `
  <svg class="file-flow" viewBox="0 0 600 236" role="img" aria-labelledby="ffTitle ffDesc">
    <title id="ffTitle">How the two files are used</title>
    <desc id="ffDesc">Schedule Builder saves a .cohortlogic file that you can load back in to keep editing, and exports an .xlsx Excel file that is a one-way copy for printing and sharing.</desc>
    <defs>
      <marker id="ffArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="#64748B" />
      </marker>
    </defs>

    <rect x="200" y="8" width="200" height="46" rx="8" fill="#0a2240" />
    <text x="300" y="37" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">Schedule Builder</text>

    <path d="M255,58 L165,140" stroke="#64748B" stroke-width="1.5" fill="none"
          marker-start="url(#ffArrow)" marker-end="url(#ffArrow)" />
    <text x="128" y="104" text-anchor="middle" fill="#0ea5e9" font-size="11" font-weight="700">download</text>
    <text x="128" y="118" text-anchor="middle" fill="#0ea5e9" font-size="11" font-weight="700">&amp; load back in</text>

    <path d="M345,58 L435,140" stroke="#64748B" stroke-width="1.5" fill="none" marker-end="url(#ffArrow)" />
    <text x="474" y="110" text-anchor="middle" fill="#16a34a" font-size="11" font-weight="700">download only</text>

    <rect x="20" y="146" width="220" height="72" rx="8" fill="#e0f2fe" stroke="#0ea5e9" />
    <text x="130" y="172" text-anchor="middle" font-size="13" font-weight="700" fill="#075985">📘 Your schedule file</text>
    <text x="130" y="190" text-anchor="middle" font-size="12" font-weight="700" fill="#0ea5e9">.cohortlogic</text>
    <text x="130" y="207" text-anchor="middle" font-size="11" fill="#075985">Keep this one — reopen anytime</text>

    <rect x="360" y="146" width="220" height="72" rx="8" fill="#ecfdf5" stroke="#16a34a" />
    <text x="470" y="172" text-anchor="middle" font-size="13" font-weight="700" fill="#166534">📗 Excel file</text>
    <text x="470" y="190" text-anchor="middle" font-size="12" font-weight="700" fill="#16a34a">.xlsx</text>
    <text x="470" y="207" text-anchor="middle" font-size="11" fill="#166534">Print &amp; share — can't come back</text>
  </svg>`;
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

  // ── One tab per weekday (building schedule) ───────────────────────
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
