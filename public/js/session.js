// ── Save / Restore Session ──
// Unified .cohortlogic format shared with Schedule Builder.

const SESSION_VERSION = 3;

// ── Save ──
// Two entry points by design. The Import/Export tab is the canonical, documented
// home for file handling; the Results toolbar keeps its own buttons as contextual
// shortcuts (different ids, same functions) so exporting right after generating
// doesn't cost a tab jump. Both save paths run saveSession(), so the "have you
// saved?" flag is set no matter which button the user reaches for.
document.getElementById('save-session-btn').addEventListener('click', saveSession);
document.getElementById('ie-save-session-btn').addEventListener('click', saveSession);

// Export shortcuts on the Import/Export tab — exportByGrade/exportByTeacher are
// defined in results.js, which loads before this file.
document.getElementById('ie-export-by-grade-btn').addEventListener('click', () => exportByGrade());
document.getElementById('ie-export-by-teacher-btn').addEventListener('click', () => exportByTeacher());

function buildCBStaff() {
  const staff = [];
  Object.entries(AppState.gradeConfig || {}).forEach(([grade, cfg]) => {
    (cfg.teachers || []).forEach(name => {
      if (name) staff.push({
        id:              'teacher_' + name.toLowerCase().replace(/\s+/g, '_'),
        name,
        role:            'classroom_teacher',
        gradeAssignment: grade,
        splitGrade:      null,
        startTime:       '',
        endTime:         '',
        color:           '',
      });
    });
  });
  (AppState.splitClasses || []).forEach(sc => {
    if (sc.teacher) staff.push({
      id:              sc.id,
      name:            sc.teacher,
      role:            'classroom_teacher',
      gradeAssignment: sc.grades[0] || '',
      splitGrade:      sc.grades[1] || null,
      startTime:       '',
      endTime:         '',
      color:           '',
    });
  });
  return staff;
}

function saveSession() {
  if (typeof cbFull === 'function' && !cbFull()) return showUpgradeModal('save', 'Saving is a paid feature',
    'Saving a .cohortlogic file so you can reopen your work later unlocks with a paid plan. On the free trial your roster, rules, and classes live in this browser tab only.');
  const staff = buildCBStaff();
  const gradeConfig = {};
  Object.entries(AppState.gradeConfig || {}).forEach(([g, cfg]) => {
    gradeConfig[g] = { classCount: cfg.classCount || (cfg.teachers || []).length || 1 };
  });
  const tools = Array.from(new Set(['class_builder', ...(AppState._schedTools || [])]));
  const payload = {
    _version: 1,
    _product: 'cohort_logic',
    _tools:   tools,
    school: {
      name:     AppState.schoolName || '',
      district: AppState.district   || '',
      grades:   Object.keys(AppState.gradeConfig || {}),
    },
    staff,
    blockTypes: AppState._schedBlockTypes || [],
    schedule:   AppState._schedData || {
      masterSchedule: {}, conflicts: {}, specialsSchedule: {},
      iaAllocations: [], iaSchedule: {},
    },
    classes: {
      rawHeaders:      AppState.rawHeaders      || [],
      rawRows:         AppState.rawRows         || [],
      columnMap:       AppState.columnMap       || {},
      competencies:    AppState.competencies    || [],
      students:        AppState.students        || [],
      gradeConfig,
      splitClasses:    AppState.splitClasses    || [],
      separations:     AppState.separations     || [],
      togethers:       AppState.togethers       || [],
      keepWithTeacher: AppState.keepWithTeacher || [],
      displayMode:     AppState.displayMode     || 'name',
      results:         AppState.results         || {},
      splitResults:    AppState.splitResults    || [],
    },
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  const ts   = new Date().toISOString().replace('T','-').slice(0,16).replace(':','-');
  const name = (AppState.schoolName || 'cohort').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  a.download = `${name}-${ts}.cohortlogic`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (typeof trackEvent === 'function') trackEvent('session_saved');
  try { localStorage.setItem(CB_SAVED_KEY, '1'); } catch (e) { /* private mode */ }
  renderCBSaveNote();
}

// ── "Have you actually saved?" note ──
// This matters more in Class Builder than in Schedule Builder. SB caches to
// localStorage, so closing the tab is survivable. Class Builder persists
// NOTHING — the roster, rules, and generated classes live in AppState, in
// memory, only. Close the tab without downloading a .cohortlogic and the work
// is gone with no recovery. The flag tracks downloads only: loading a file
// doesn't set it, because changes made since that load are still unsaved.
const CB_SAVED_KEY = 'cl_cb_session_downloaded';

function renderCBSaveNote() {
  const el = document.getElementById('ie-save-note');
  if (!el) return;
  let saved = false;
  try { saved = localStorage.getItem(CB_SAVED_KEY) === '1'; } catch (e) { /* private mode */ }
  el.className   = 'ie-note ' + (saved ? 'ie-note-ok' : 'ie-note-warn');
  el.textContent = saved
    ? '✓ You have saved a session file. Save again after you make changes, so your saved copy stays up to date.'
    : '⚠ You have not saved a session file yet. Class Builder does not keep your work — right now your roster, rules, and classes only exist in this browser tab. Save a file to keep them.';
}

// ── Restore ──
document.getElementById('restore-session-btn').addEventListener('click', () => {
  document.getElementById('restore-file-input').click();
});

document.getElementById('restore-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  loadCohortFile(file);
});

// Drag & drop on the restore drop zone
const restoreZone = document.getElementById('restore-drop-zone');
restoreZone.addEventListener('dragover', e => { e.preventDefault(); restoreZone.classList.add('drag-over'); });
restoreZone.addEventListener('dragleave', () => restoreZone.classList.remove('drag-over'));
restoreZone.addEventListener('drop', e => {
  e.preventDefault();
  restoreZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadCohortFile(file);
});

// Static markup + scripts at end of body, so the note element already exists.
renderCBSaveNote();

function _migrateToCohortLogicCB(raw) {
  if (raw._product === 'cohort_logic') return raw;

  if (raw._product === 'class_builder' || (!raw._product && raw._version)) {
    // Old .cohort file → unified
    const sp = raw.schoolProfile || {};
    const staff = (sp.staff || []).map(s => Object.assign({ startTime: '', endTime: '', color: '' }, s));
    const gradeConfig = {};
    Object.entries(raw.gradeConfig || {}).forEach(([g, cfg]) => {
      gradeConfig[g] = { classCount: cfg.classCount || (cfg.teachers || []).length || 1 };
    });
    return {
      _version: 1,
      _product: 'cohort_logic',
      _tools:   ['class_builder'],
      school: {
        name:     sp.schoolName || raw.schoolName || '',
        district: sp.district   || raw.district   || '',
        grades:   sp.grades     || Object.keys(raw.gradeConfig || {}),
      },
      staff,
      blockTypes: [],
      schedule:   null,
      classes: {
        rawHeaders:      raw.rawHeaders      || [],
        rawRows:         raw.rawRows         || [],
        columnMap:       raw.columnMap       || {},
        competencies:    raw.competencies    || [],
        students:        raw.students        || [],
        gradeConfig,
        splitClasses:    raw.splitClasses    || [],
        separations:     raw.separations     || [],
        togethers:       raw.togethers       || [],
        keepWithTeacher: raw.keepWithTeacher || [],
        displayMode:     raw.displayMode     || 'name',
        results:         raw.results         || {},
        splitResults:    raw.splitResults    || [],
      },
    };
  }

  if (raw._product === 'schedule_builder') {
    // Old .clsched file — cross-product import (school profile only for CB)
    const sp    = raw.schoolProfile || {};
    const staff = raw.staff || (sp.staff || []).map(s => Object.assign({ startTime: '', endTime: '', color: '' }, s));
    return {
      _version: 1,
      _product: 'cohort_logic',
      _tools:   ['schedule_builder'],
      school: {
        name:     (raw.school && raw.school.name)     || sp.schoolName || '',
        district: (raw.school && raw.school.district) || sp.district   || '',
        grades:   (raw.school && raw.school.grades)   || sp.grades     || [],
      },
      staff,
      blockTypes: raw.blockTypes || [],
      schedule: {
        masterSchedule:   raw.masterSchedule   || {},
        conflicts:        raw.conflicts        || {},
        specialsSchedule: raw.specialsSchedule || {},
        iaAllocations:    raw.iaAllocations    || [],
        iaSchedule:       raw.iaSchedule       || {},
      },
      classes: null,
    };
  }

  throw new Error('Unrecognized file format. Please use a .cohortlogic, .cohort, or .clsched file.');
}

function loadCohortFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const raw = JSON.parse(ev.target.result);
      if (!raw._version && !raw._product) throw new Error('Not a valid Cohort Logic file.');
      const data = _migrateToCohortLogicCB(raw);

      const hasCBData    = (data._tools || []).includes('class_builder');
      const crossProduct = !hasCBData;

      // Always apply shared fields (school name, district, staff → gradeConfig + splitClasses)
      if (data.school) {
        if (data.school.name)     AppState.schoolName = data.school.name;
        if (data.school.district) AppState.district   = data.school.district;
      }
      AppState.gradeConfig  = {};
      AppState.splitClasses = [];
      applyStaffToCB(data.staff || [], (data.school || {}).grades || []);

      if (hasCBData && data.classes) {
        // Full restore — apply all class fields (gradeConfig + splitClasses already built from staff)
        const cls = data.classes;
        const RESTORE_FIELDS = [
          'rawHeaders', 'rawRows', 'columnMap', 'competencies',
          'students', 'separations', 'togethers', 'keepWithTeacher',
          'displayMode', 'results', 'splitResults',
        ];
        RESTORE_FIELDS.forEach(k => { if (cls[k] !== undefined) AppState[k] = cls[k]; });
      }

      // Store SB passthrough data so it survives a save-from-CB round-trip
      AppState._schedTools      = Array.from(new Set([...(data._tools || []), ...(AppState._schedTools || [])]));
      AppState._schedBlockTypes = data.blockTypes || AppState._schedBlockTypes || [];
      AppState._schedData       = data.schedule   || AppState._schedData || null;

      // Refresh UI
      if (typeof syncSchoolProfileInputs === 'function') syncSchoolProfileInputs();
      updateSidebarStatus();
      if (AppState.rawHeaders.length) renderFieldMapping();
      if (AppState.students.length) {
        renderStudents();
        buildGradeConfig();
      }
      if (AppState.results && Object.keys(AppState.results).length) {
        renderResults();
        navigateTo('results');
      } else if (AppState.students.length) {
        navigateTo('classes');
      } else if (crossProduct) {
        alert(`School profile imported!\nSchool: ${(data.school && data.school.name) || '(unnamed)'}\n\nTeachers and grades have been applied to Class Setup.`);
      }

      if (typeof trackEvent === 'function') trackEvent('session_restored');
    } catch (err) {
      alert('Could not restore session: ' + err.message);
      if (typeof logError === 'function') logError('class_builder', 'session_restore_failed', err.message);
    }
  };
  reader.readAsText(file);
}
