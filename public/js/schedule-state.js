// Central state for the Schedule Builder

// Default block types — only universal blocks schools always need.
// Schools add their own required instructional blocks via the Block Types tab.
const DEFAULT_BLOCK_TYPES = [
  // System block — required by the scheduling algorithm
  { id: 'bt_spec',  name: 'Specials',        color: '#f97316', category: 'specials',    required: true,
    subBlocks: [], bandMinutes: {}, subBandMinutes: {} },
  // Auto-placed fixed blocks (times set in School Info)
  { id: 'bt_mm',    name: 'Morning Meeting',  color: '#6366f1', category: 'instruction', required: false },
  { id: 'bt_lunch', name: 'Lunch',            color: '#84cc16', category: 'transition',  required: false },
  { id: 'bt_recess',name: 'Recess',           color: '#22d3ee', category: 'transition',  required: false },
  // Default uniform blocks
  { id: 'bt_arr',   name: 'Arrival Duty',     color: '#78716c', category: 'admin',       required: false },
  { id: 'bt_dis',   name: 'Dismissal Duty',   color: '#b45309', category: 'admin',       required: false },
];

const SchedState = {
  school: {
    name: '',
    district: '',
    year: '2026-2027',
    grades: [],

    // Grade bands for instructional requirements: [{ id, name, grades[] }]
    gradeBands: [],

    // Grade pairings — sync an instructional block/sub-block to the SAME start
    // time across a set of grades (independent of gradeBands). Same start time
    // across grades AND every day; each grade keeps its own duration.
    // [{ id, blockId, subId|null, grades[] }]
    blockPairings: [],

    // School day time boundaries
    teacherContractStart: '07:30',
    teacherContractEnd:   '15:00',
    studentCampusStart:   '07:45',  // breakfast / non-teacher supervision
    studentCampusEnd:     '15:15',  // after-school / non-teacher supervision
    firstBell:            '08:00',  // teacher instructional day begins
    dismissal:            '14:30',  // teacher instructional day ends

    // Morning / community meetings: [{ id, name, start, end }]
    morningMeetings: [],
    // Legacy single-meeting fields (kept for backward-compat with saved data)
    morningMeetingEnabled: false,
    morningMeetingStart:   '',
    morningMeetingEnd:     '',

    // Lunch periods: [{ id, start, duration (min), grades[] }]
    lunchPeriods: [],

    // Per-grade recess config: { gradeKey: [{ id, duration, lunchAdjacent, lunchSide }] }
    // lunchSide: 'before' | 'after' | null (null = software picks 'after')
    gradeRecesses: {},

    // Legacy — kept for backward-compat with saved data
    recessSlots: [],

    // Alternate schedule days: [{ day, lateStart, earlyRelease, altLunchRecess }]
    altDays: [],

    // Specials rotation: 'intermittent' (cycle all before repeating) | 'sequential' (block-by-block)
    specialsRotationMode: 'intermittent',

    // Legacy fields kept for backward-compat with saved data
    dayStart: '07:30',
    dayEnd: '14:30',
    earlyReleaseDays: [],
    earlyReleaseEnd: '12:30',
  },

  staff: [],
  // Each: { id, name, role, gradeAssignment, splitGrade, startTime, endTime, color }
  // role: 'classroom_teacher' | 'specials_teacher' | 'ia' | 'specialist' | 'eld' | 'sped' | 'admin' | 'other'

  blockTypes: DEFAULT_BLOCK_TYPES.map(bt => Object.assign({}, bt, { subBlocks: (bt.subBlocks || []).map(s => Object.assign({}, s)), bandMinutes: Object.assign({}, bt.bandMinutes || {}), subBandMinutes: Object.assign({}, bt.subBandMinutes || {}) })),

  // masterSchedule[day][grade][timeSlot] = blockTypeId | null
  // e.g. masterSchedule['Monday']['K']['07:30'] = 'bt_1'
  masterSchedule: {},

  // conflicts[day][grade][timeSlot] = [btId, ...] — blocks displaced by a manual placement
  // Auto-fill never creates conflicts; only drag/click from palette does.
  conflicts: {},

  // specialsSchedule[classId][day] = { subjectId, teacherId, startTime }
  // classId = classroom teacher's staff id; source of truth for class-level specials.
  specialsSchedule: {},

  // iaAllocations: [{ id, name, color, hoursPerWeek }]
  iaAllocations: [
    { id: 'ia_gened', name: 'Gen Ed',             color: '#3b82f6', hoursPerWeek: 0 },
    { id: 'ia_eld',   name: 'ELD',                color: '#f59e0b', hoursPerWeek: 0 },
    { id: 'ia_hdt',   name: 'High Dose Tutoring', color: '#10b981', hoursPerWeek: 0 },
    { id: 'ia_title', name: 'Title',              color: '#ec4899', hoursPerWeek: 0 },
  ],

  // iaCoverage: [{ id, blockId, subId|null, grades[], iasPerGrade, allowedAllocIds[] }]
  // The IA Assignment tab's coverage plan; drives the placement engine.
  iaCoverage: [],

  // iaSchedule[day][iaId][slot] = { allocId, grade, activity } | undefined
  iaSchedule: {},

  // duties: standalone IA duty blocks not tied to the building schedule
  // [{ id, name, location, startTime, endTime, days[], iaIds[], allocId }]
  duties: [],

  // ── Unified file passthrough ──
  _tools:   [],    // tools that have contributed to this file (e.g. ['schedule_builder','class_builder'])
  _clsData: null,  // Class Builder data — preserved on load, written back on save
};

// ── Palette for auto-assigning staff colors ──────────────────────────────────
const STAFF_COLOR_PALETTE = [
  '#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6',
  '#ec4899','#14b8a6','#f97316','#6366f1','#84cc16',
  '#06b6d4','#a855f7',
];

function nextStaffColor() {
  const used = SchedState.staff.map(s => s.color);
  return STAFF_COLOR_PALETTE.find(c => !used.includes(c)) || STAFF_COLOR_PALETTE[SchedState.staff.length % STAFF_COLOR_PALETTE.length];
}

// ── Navigation ───────────────────────────────────────────────────────────────
function navigateTo(view) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const navEl = document.querySelector(`[data-view="${view}"]`);
  const viewEl = document.getElementById(`view-${view}`);
  if (navEl) navEl.classList.add('active');
  if (viewEl) viewEl.classList.add('active');
  updateSidebarStatus();
}

// ── Sidebar status ───────────────────────────────────────────────────────────
function updateSidebarStatus() {
  const schoolDot  = document.querySelector('#status-school .status-dot');
  const schoolText = document.getElementById('status-school-text');
  const staffDot   = document.querySelector('#status-staff .status-dot');
  const staffText  = document.getElementById('status-staff-text');
  const blockDot   = document.querySelector('#status-blocks .status-dot');
  const blockText  = document.getElementById('status-blocks-text');

  if (SchedState.school.name) {
    schoolText.textContent = SchedState.school.name;
    schoolDot.classList.add('green');
  } else {
    schoolText.textContent = 'No school info yet';
    schoolDot.classList.remove('green');
  }

  const staffCount = SchedState.staff.length;
  if (staffCount > 0) {
    staffText.textContent = `${staffCount} staff member${staffCount !== 1 ? 's' : ''}`;
    staffDot.classList.add('green');
  } else {
    staffText.textContent = 'No staff added';
    staffDot.classList.remove('green');
  }

  const blockCount = SchedState.blockTypes.length;
  blockText.textContent = `${blockCount} block type${blockCount !== 1 ? 's' : ''}`;
  blockDot.classList.add('blue');

  const masterNav = document.getElementById('nav-master');
  if (masterNav) {
    const setupDone = (SchedState.school.grades || []).length > 0;
    masterNav.classList.toggle('nav-item-locked', !setupDone);
  }

  const specialsSchedNav = document.getElementById('nav-specials-sched');
  if (specialsSchedNav) {
    const hasSpecials = (SchedState.school.specials || []).length > 0;
    specialsSchedNav.classList.toggle('nav-item-locked', !hasSpecials);
  }

  const classSchedNav = document.getElementById('nav-class-sched');
  if (classSchedNav) {
    const hasMaster = Object.keys(SchedState.masterSchedule || {}).length > 0;
    classSchedNav.classList.toggle('nav-item-locked', !hasMaster);
  }

  const hasIAs = SchedState.staff.some(s => s.role === 'ia');
  const iaNav = document.getElementById('nav-ia') || document.querySelector('[data-view="ia"]');
  if (iaNav) iaNav.classList.toggle('nav-item-locked', !hasIAs);

  const iaAssignNav = document.getElementById('nav-ia-assign');
  if (iaAssignNav) iaAssignNav.classList.toggle('nav-item-locked', !hasIAs);

  const exportNav = document.getElementById('nav-export') || document.querySelector('[data-view="export"]');
  if (exportNav) {
    const hasMasterForExport = Object.keys(SchedState.masterSchedule || {}).length > 0;
    exportNav.classList.toggle('nav-item-locked', !hasMasterForExport);
  }
}

// Ensure bt_mm / bt_lunch / bt_recess are always in SchedState.blockTypes.
// Files saved before these were added to DEFAULT_BLOCK_TYPES won't have them,
// causing buildCell() to render those slots as empty white cells.
function ensureFixedBlockTypes() {
  const FIXED_IDS = ['bt_mm', 'bt_lunch', 'bt_recess'];
  FIXED_IDS.forEach(id => {
    if (!SchedState.blockTypes.find(bt => bt.id === id)) {
      const def = DEFAULT_BLOCK_TYPES.find(bt => bt.id === id);
      if (def) SchedState.blockTypes.push(Object.assign({}, def));
    }
  });
}

// If grade bands were deleted and re-created, their IDs change. Old bandMinutes
// keys (old IDs) no longer match current gradeBands, so blocks appear to have
// 0 minutes and are excluded from auto-populate. When there is exactly one
// orphaned value for a band slot that has no current data, remap it safely.
function migrateBandIds() {
  const bands = SchedState.school.gradeBands || [];
  if (!bands.length) return;
  const currentIds = new Set(bands.map(b => b.id));

  SchedState.blockTypes.forEach(bt => {
    if (!bt.bandMinutes) return;

    bands.forEach(band => {
      if ((bt.bandMinutes[band.id] || 0) > 0) return; // already has current data
      const orphans = Object.entries(bt.bandMinutes)
        .filter(([id, v]) => !currentIds.has(id) && v > 0);
      if (orphans.length === 1) bt.bandMinutes[band.id] = orphans[0][1];

      // Migrate sub-block minutes with the same pattern
      (bt.subBlocks || []).forEach(sub => {
        const subMin = (bt.subBandMinutes || {})[sub.id] || {};
        if ((subMin[band.id] || 0) > 0) return;
        const subOrphans = Object.entries(subMin)
          .filter(([id, v]) => !currentIds.has(id) && v > 0);
        if (subOrphans.length === 1) {
          bt.subBandMinutes = bt.subBandMinutes || {};
          bt.subBandMinutes[sub.id] = bt.subBandMinutes[sub.id] || {};
          bt.subBandMinutes[sub.id][band.id] = subOrphans[0][1];
        }
      });
    });
  });
}

// For blocks with sub-blocks (e.g. ELA), migrate legacy bandMinutes into
// subBandMinutes when subBandMinutes is empty. Files saved before sub-block
// minutes were configured will have bandMinutes (the old single total) but
// empty subBandMinutes. Without migration, the requirements table shows 0,
// and a subsequent save would overwrite bandMinutes with 0 — breaking auto-fill.
function migrateSubBlockMinutes() {
  const bands = SchedState.school.gradeBands || [];
  SchedState.blockTypes.forEach(bt => {
    if (!(bt.subBlocks || []).length) return;
    bt.subBandMinutes = bt.subBandMinutes || {};
    bt.bandMinutes    = bt.bandMinutes    || {};
    bands.forEach(band => {
      const legacyTotal = bt.bandMinutes[band.id] || 0;
      if (!legacyTotal) return;
      // Check if any sub-block already has minutes for this band
      const hasSubData = bt.subBlocks.some(sub =>
        ((bt.subBandMinutes[sub.id] || {})[band.id] || 0) > 0
      );
      if (hasSubData) return; // already configured — leave it alone
      // No sub-block data yet: put the legacy total into the first sub-block
      const first = bt.subBlocks[0];
      if (first) {
        bt.subBandMinutes[first.id] = bt.subBandMinutes[first.id] || {};
        bt.subBandMinutes[first.id][band.id] = legacyTotal;
      }
    });
  });
}

// ── Persistence: localStorage (immediate) ───────────────────────────────────
function saveToLocal() {
  const payload = {
    school:              SchedState.school,
    staff:               SchedState.staff,
    blockTypes:          SchedState.blockTypes,
    masterSchedule:      SchedState.masterSchedule,
    conflicts:           SchedState.conflicts,
    specialsSchedule:    SchedState.specialsSchedule,
    iaAllocations:       SchedState.iaAllocations,
    iaCoverage:          SchedState.iaCoverage,
    iaSchedule:          SchedState.iaSchedule,
    duties:              SchedState.duties,
    iaStalePurgeCount:   SchedState.iaStalePurgeCount || 0,
    _tools:              SchedState._tools,
    _clsData:            SchedState._clsData,
  };
  localStorage.setItem('cl_schedule_data', JSON.stringify(payload));
  if (SchedState.school.name) {
    localStorage.setItem('cl_schedule_name', SchedState.school.name + ' — ' + SchedState.school.year);
  }
  // Flag that there are unsaved file changes
  localStorage.removeItem('cl_schedule_downloaded');
  updateDownloadBadge();
}

// IA rework migration: files predating Grade Preferences carried a single Primary
// Grade (`gradeAssignment`) for IAs. Seed that as a one-grade preference so old
// files keep meaning. Idempotent — only fills when the new fields are absent.
function _normalizeIAStaff() {
  (SchedState.staff || []).forEach(s => {
    if (s.role !== 'ia') return;
    if (!Array.isArray(s.gradePreferences)) {
      s.gradePreferences = s.gradeAssignment ? [s.gradeAssignment] : [];
    }
    if (s.ownLunch === undefined) s.ownLunch = null;
    // Breaks default: 1 × 15 min per IA. Older files predate this — seed the default.
    if (s.breaks === undefined) s.breaks = { count: 1, duration: 15 };
  });
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem('cl_schedule_data');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.school) {
      Object.assign(SchedState.school, data.school);
      // Migrate legacy earlyReleaseDays → altDays
      if (!SchedState.school.altDays?.length && SchedState.school.earlyReleaseDays?.length) {
        SchedState.school.altDays = SchedState.school.earlyReleaseDays.map(day => ({
          day, lateStart: '', earlyRelease: SchedState.school.earlyReleaseEnd || '12:30', altLunchRecess: false,
        }));
      }
      if (!SchedState.school.lunchPeriods)   SchedState.school.lunchPeriods   = [];
      if (!SchedState.school.recessSlots)    SchedState.school.recessSlots    = [];
      if (!SchedState.school.altDays)        SchedState.school.altDays        = [];
      if (!SchedState.school.gradeRecesses)  SchedState.school.gradeRecesses  = {};
      if (!SchedState.school.gradeBands)     SchedState.school.gradeBands     = [];
      if (!SchedState.school.blockPairings)  SchedState.school.blockPairings  = [];
      // Migrate legacy single-meeting → morningMeetings array
      if (!SchedState.school.morningMeetings) {
        const s = SchedState.school;
        SchedState.school.morningMeetings = (s.morningMeetingEnabled && s.morningMeetingStart && s.morningMeetingEnd)
          ? [{ id: uid(), name: 'Morning Meeting', start: s.morningMeetingStart, end: s.morningMeetingEnd }]
          : [];
      }
    }
    if (data.staff) SchedState.staff = data.staff;
    _normalizeIAStaff();
    if (data.blockTypes) {
      // Migrate old block types (no 'required' field) to new schema
      const hasNewSchema = data.blockTypes.some(bt => 'required' in bt);
      if (hasNewSchema) {
        SchedState.blockTypes = data.blockTypes;
      } else {
        SchedState.blockTypes = DEFAULT_BLOCK_TYPES.map(bt => Object.assign({}, bt,
          { subBlocks: (bt.subBlocks || []).map(s => Object.assign({}, s)), bandMinutes: {}, subBandMinutes: {} }));
      }
      ensureFixedBlockTypes();
      migrateBandIds();
      migrateSubBlockMinutes();
    }
    if (data.masterSchedule)   SchedState.masterSchedule   = data.masterSchedule;
    if (data.conflicts)        SchedState.conflicts        = data.conflicts;
    if (data.specialsSchedule) SchedState.specialsSchedule = data.specialsSchedule;
    if (data.iaAllocations)    SchedState.iaAllocations    = data.iaAllocations;
    if (data.iaCoverage)       SchedState.iaCoverage       = data.iaCoverage;
    if (!SchedState.iaCoverage) SchedState.iaCoverage      = [];
    if (data.iaSchedule)       SchedState.iaSchedule       = data.iaSchedule;
    if (data.duties)           SchedState.duties           = data.duties;
    if (data.iaStalePurgeCount) SchedState.iaStalePurgeCount = data.iaStalePurgeCount;
    if (data._tools)           SchedState._tools           = data._tools;
    if (data._clsData)         SchedState._clsData         = data._clsData;
    // Defaults for fields added after initial release
    if (!SchedState.school.specialsRotationMode) SchedState.school.specialsRotationMode = 'intermittent';
    // NOTE: legacy s.morningMeetings is intentionally NOT migrated into bt_mm anymore.
    // Morning meetings are configured only as the bt_mm block (Block Types → school-wide
    // time). Any stale morningMeetings data stays inert — it neither places blocks nor
    // affects the minutes budget. Users re-enter meetings in the Blocks section.
    return true;
  } catch (e) {
    return false;
  }
}

// ── File-based persistence ────────────────────────────────────────────────────
// Schedule data never leaves the user's device unless they explicitly download it.
// Supabase is used only for authentication and product gating, not data storage.

function buildSchoolProfile() {
  return {
    schoolName: SchedState.school.name     || '',
    district:   SchedState.school.district || '',
    grades:     SchedState.school.grades   || [],
    staff: SchedState.staff.map(s => ({
      id:              s.id,
      name:            s.name,
      role:            s.role             || 'classroom_teacher',
      gradeAssignment: s.gradeAssignment  || '',
      splitGrade:      s.splitGrade       || null,
      startTime:       s.startTime        || '',
      endTime:         s.endTime          || '',
    })),
  };
}

function applySchoolProfile(sp) {
  if (!sp) return;
  if (sp.schoolName) SchedState.school.name     = sp.schoolName;
  if (sp.district)   SchedState.school.district = sp.district;
  if (sp.grades && sp.grades.length) SchedState.school.grades = sp.grades;
  if (sp.staff && sp.staff.length) {
    const fallbackColors = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6',
                            '#ec4899','#14b8a6','#f97316','#06b6d4','#a855f7'];
    SchedState.staff = sp.staff.map((s, i) => Object.assign({
      color:     fallbackColors[i % fallbackColors.length],
      startTime: SchedState.school.firstBell || '08:00',
      endTime:   SchedState.school.dismissal || '14:30',
    }, s));
  }
}

function _migrateToCohortLogic(raw) {
  if (raw._product === 'cohort_logic') return raw;

  if (raw._product === 'schedule_builder' || (!raw._product && raw.masterSchedule !== undefined)) {
    // Old .clsched → unified
    return {
      _version: 1,
      _product: 'cohort_logic',
      _tools:   ['schedule_builder'],
      school:     raw.school     || {},
      staff:      raw.staff      || [],
      blockTypes: raw.blockTypes || [],
      schedule: {
        masterSchedule:   raw.masterSchedule   || {},
        conflicts:        raw.conflicts        || {},
        specialsSchedule: raw.specialsSchedule || {},
        iaAllocations:    raw.iaAllocations    || [],
        iaCoverage:       raw.iaCoverage       || [],
        iaSchedule:       raw.iaSchedule       || {},
      },
      classes: null,
    };
  }

  if (raw._product === 'class_builder') {
    // Old .cohort → unified (school profile + classes data)
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
      schedule: { masterSchedule: {}, conflicts: {}, specialsSchedule: {}, iaAllocations: [], iaSchedule: {} },
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

  throw new Error('Unrecognized file format. Please use a .cohortlogic, .clsched, or .cohort file.');
}

function downloadScheduleFile() {
  const tools = Array.from(new Set(['schedule_builder', ...(SchedState._tools || [])]));
  const payload = {
    _version: 1,
    _product: 'cohort_logic',
    _tools:   tools,
    school:     SchedState.school,
    staff:      SchedState.staff,
    blockTypes: SchedState.blockTypes,
    schedule: {
      masterSchedule:   SchedState.masterSchedule,
      conflicts:        SchedState.conflicts,
      specialsSchedule: SchedState.specialsSchedule,
      iaAllocations:    SchedState.iaAllocations,
      iaCoverage:       SchedState.iaCoverage,
      iaSchedule:       SchedState.iaSchedule,
      duties:           SchedState.duties,
    },
    classes: SchedState._clsData || null,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const name = (SchedState.school.name || 'schedule').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const year = (SchedState.school.year || '').replace(/[^a-z0-9]/gi, '-');
  a.href     = url;
  a.download = `${name}${year ? '-' + year : ''}.cohortlogic`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  localStorage.setItem('cl_schedule_downloaded', '1');
  updateDownloadBadge();
}

function loadScheduleFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw  = JSON.parse(e.target.result);
        const data = _migrateToCohortLogic(raw);

        // When the file has no SB data (e.g. saved from CB only) treat as cross-product import:
        // apply school + staff but leave existing SB blockTypes and schedule intact.
        const hasSBData    = (data._tools || []).includes('schedule_builder');
        const crossProduct = !hasSBData;

        // Always apply shared fields
        if (data.school) Object.assign(SchedState.school, data.school);
        // Guard on LENGTH, not truthiness: `[]` is truthy, and a Class Builder file
        // always carries `staff: []` (CB has no staff concept). Without the length
        // check, loading a CB file WIPES an existing Schedule Builder staff roster —
        // real data loss on a workflow we actively promote ("this travels with your
        // saved file so it can be shared with Schedule Builder"). Same pattern the
        // blockTypes guard below already uses. NOTE: the parallel assignment in
        // loadFromLocal() intentionally does NOT have this check — there `[]` means
        // "this schedule really has no staff," and honoring it is correct.
        if (data.staff && data.staff.length) SchedState.staff = data.staff;
        _normalizeIAStaff();

        // Apply SB-specific data only when the file actually has SB content
        if (!crossProduct) {
          if (data.blockTypes && data.blockTypes.length > 0) {
            const hasNewSchema = data.blockTypes.some(bt => 'required' in bt);
            SchedState.blockTypes = hasNewSchema
              ? data.blockTypes
              : DEFAULT_BLOCK_TYPES.map(bt => Object.assign({}, bt,
                  { subBlocks: (bt.subBlocks||[]).map(s=>Object.assign({},s)), bandMinutes:{}, subBandMinutes:{} }));
            ensureFixedBlockTypes();
            migrateBandIds();
            migrateSubBlockMinutes();
          }
          if (data.schedule) {
            if (data.schedule.masterSchedule)   SchedState.masterSchedule   = data.schedule.masterSchedule;
            if (data.schedule.conflicts)        SchedState.conflicts        = data.schedule.conflicts;
            if (data.schedule.specialsSchedule) SchedState.specialsSchedule = data.schedule.specialsSchedule;
            if (data.schedule.iaAllocations)    SchedState.iaAllocations    = data.schedule.iaAllocations;
            if (data.schedule.iaCoverage)       SchedState.iaCoverage       = data.schedule.iaCoverage;
            if (data.schedule.iaSchedule)       SchedState.iaSchedule       = data.schedule.iaSchedule;
            if (data.schedule.duties)           SchedState.duties           = data.schedule.duties;
          }
        }

        // Preserve CB data and merge tool list
        SchedState._clsData = data.classes || SchedState._clsData || null;
        SchedState._tools   = Array.from(new Set([...(data._tools || []), ...(SchedState._tools || [])]));

        // Ensure required fields exist
        if (!SchedState.school.lunchPeriods)    SchedState.school.lunchPeriods    = [];
        if (!SchedState.school.gradeRecesses)   SchedState.school.gradeRecesses   = {};
        if (!SchedState.school.gradeBands)      SchedState.school.gradeBands      = [];
        if (!SchedState.school.blockPairings)   SchedState.school.blockPairings   = [];
        if (!SchedState.school.morningMeetings) SchedState.school.morningMeetings = [];
        if (!SchedState.school.altDays)         SchedState.school.altDays         = [];
        if (!SchedState.school.district)        SchedState.school.district        = '';
        if (!SchedState.specialsSchedule)       SchedState.specialsSchedule       = {};
        if (!SchedState.iaCoverage)             SchedState.iaCoverage             = [];

        saveToLocal();
        localStorage.setItem('cl_schedule_downloaded', '1');
        resolve({ crossProduct, schoolName: SchedState.school.name || '' });
      } catch (err) {
        reject(new Error(err.message || 'Could not read file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

// The sidebar download button used to carry this "you haven't saved a file yet"
// nag. That button moved to the Import/Export view, so the nag now rides the
// Import/Export nav item instead — schedule data lives only in THIS browser until
// the user downloads a file, so losing this warning would risk real data loss.
function updateDownloadBadge() {
  const nav = document.getElementById('nav-export');
  if (!nav) return;
  const downloaded = localStorage.getItem('cl_schedule_downloaded') === '1';
  const unsaved    = !downloaded && !!SchedState.school.name;
  nav.classList.toggle('nav-item-unsaved', unsaved);
  nav.title = unsaved
    ? 'Your schedule file hasn’t been downloaded yet — open Import/Export to save it'
    : '';
}

// ── Utility ──────────────────────────────────────────────────────────────────
function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

const GRADE_ORDER = { TK: -1, K: 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, '11': 11, '12': 12 };
const GRADE_LABELS = { TK: 'TK', K: 'Kindergarten', '1': '1st Grade', '2': '2nd Grade',
  '3': '3rd Grade', '4': '4th Grade', '5': '5th Grade', '6': '6th Grade',
  '7': '7th Grade', '8': '8th Grade', '9': '9th Grade', '10': '10th Grade',
  '11': '11th Grade', '12': '12th Grade' };

const ROLE_LABELS = {
  classroom_teacher: 'Classroom Teacher',
  specials_teacher:  'Specials Teacher',
  ia:                'Instructional Assistant',
  specialist:        'Specialist',
  eld:               'ELD Teacher',
  sped:              'SPED / ERC Teacher',
  admin:             'Administrator',
  other:             'Other',
};

const BLOCK_CATEGORIES = {
  instruction:  'Instruction',
  sel:          'Community & SEL',
  specials:     'Specials',
  intervention: 'Intervention & Support',
  behavior:     'Behavior Support',
  transition:   'Transitions & Routines',
  admin:        'Admin & Duty',
};

function gradesSorted() {
  return [...SchedState.school.grades].sort((a, b) => (GRADE_ORDER[a] ?? 99) - (GRADE_ORDER[b] ?? 99));
}
