// Central state for the Building Schedule Builder

// Default block types — matches PDF instructional requirements pattern
const DEFAULT_BLOCK_TYPES = [
  // Required instructional blocks (show in requirements table)
  { id: 'bt_ela',    name: 'ELA / Literacy',          color: '#3b82f6', category: 'instruction',  required: true,
    subBlocks: [
      { id: 'sub_comp', name: 'Comprehension' },
      { id: 'sub_fs',   name: 'Foundational Skills' },
      { id: 'sub_dg',   name: 'Differentiated Groups' },
      { id: 'sub_wr',   name: 'Writing' },
    ], bandMinutes: {}, subBandMinutes: {} },
  { id: 'bt_math',  name: 'Math',                      color: '#8b5cf6', category: 'instruction',  required: true,
    subBlocks: [], bandMinutes: {}, subBandMinutes: {} },
  { id: 'bt_cm',    name: 'Community Meeting / SEL',   color: '#06b6d4', category: 'sel',          required: true,
    subBlocks: [], bandMinutes: {}, subBandMinutes: {} },
  { id: 'bt_win',   name: 'WIN — What I Need',         color: '#10b981', category: 'intervention', required: true,
    subBlocks: [], bandMinutes: {}, subBandMinutes: {} },
  { id: 'bt_eld',   name: 'ELD / SLD',                 color: '#f59e0b', category: 'intervention', required: true,
    subBlocks: [], bandMinutes: {}, subBandMinutes: {} },
  { id: 'bt_ssh',   name: 'Science / SS / Health',     color: '#0ea5e9', category: 'instruction',  required: true,
    subBlocks: [], bandMinutes: {}, subBandMinutes: {} },
  { id: 'bt_spec',  name: 'Specials',                  color: '#f97316', category: 'specials',     required: true,
    subBlocks: [], bandMinutes: {}, subBandMinutes: {} },
  // Auto-placed fixed blocks (placed from School Info settings)
  { id: 'bt_mm',    name: 'Morning Meeting',            color: '#6366f1', category: 'instruction',  required: false },
  { id: 'bt_lunch', name: 'Lunch',                     color: '#84cc16', category: 'transition',   required: false },
  { id: 'bt_recess',name: 'Recess',                    color: '#22d3ee', category: 'transition',   required: false },
  // Other palette blocks
  { id: 'bt_sdi',   name: 'SDI',                       color: '#ec4899', category: 'intervention', required: false },
  { id: 'bt_cico',  name: 'CICO',                      color: '#e879f9', category: 'behavior',     required: false },
  { id: 'bt_rrr',   name: 'Rest & Return',             color: '#64748b', category: 'behavior',     required: false },
  { id: 'bt_thresh',name: 'Threshold Greetings',       color: '#fb923c', category: 'transition',   required: false },
  { id: 'bt_prep',  name: 'Prep / Planning',           color: '#a855f7', category: 'admin',        required: false },
  { id: 'bt_arr',   name: 'Arrival Duty',              color: '#78716c', category: 'admin',        required: false },
  { id: 'bt_un',    name: 'Unassigned Time',           color: '#d1d5db', category: 'admin',        required: false },
];

const SchedState = {
  school: {
    name: '',
    district: '',
    year: '2026-2027',
    grades: [],

    // Grade bands for instructional requirements: [{ id, name, grades[] }]
    gradeBands: [],

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
    school:         SchedState.school,
    staff:          SchedState.staff,
    blockTypes:     SchedState.blockTypes,
    masterSchedule: SchedState.masterSchedule,
  };
  localStorage.setItem('cl_schedule_data', JSON.stringify(payload));
  if (SchedState.school.name) {
    localStorage.setItem('cl_schedule_name', SchedState.school.name + ' — ' + SchedState.school.year);
  }
  // Flag that there are unsaved file changes
  localStorage.removeItem('cl_schedule_downloaded');
  updateDownloadBadge();
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
      // Migrate legacy single-meeting → morningMeetings array
      if (!SchedState.school.morningMeetings) {
        const s = SchedState.school;
        SchedState.school.morningMeetings = (s.morningMeetingEnabled && s.morningMeetingStart && s.morningMeetingEnd)
          ? [{ id: uid(), name: 'Morning Meeting', start: s.morningMeetingStart, end: s.morningMeetingEnd }]
          : [];
      }
    }
    if (data.staff) SchedState.staff = data.staff;
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
    if (data.masterSchedule) SchedState.masterSchedule = data.masterSchedule;
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

function downloadScheduleFile() {
  const payload = {
    _version: 3,
    _product: 'schedule_builder',
    schoolProfile:    buildSchoolProfile(),
    school:           SchedState.school,
    staff:            SchedState.staff,
    blockTypes:       SchedState.blockTypes,
    masterSchedule:   SchedState.masterSchedule,
    conflicts:        SchedState.conflicts,
    specialsSchedule: SchedState.specialsSchedule,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const name = (SchedState.school.name || 'schedule').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const year = (SchedState.school.year || '').replace(/[^a-z0-9]/gi, '-');
  a.href     = url;
  a.download = `${name}${year ? '-' + year : ''}.clsched`;
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
        const data = JSON.parse(e.target.result);

        // Cross-product import: Class Builder .cohort file
        if (data._product === 'class_builder') {
          if (!data.schoolProfile) throw new Error('No school profile found in this Class Builder file.');
          applySchoolProfile(data.schoolProfile);
          saveToLocal();
          resolve({ crossProduct: true, schoolName: data.schoolProfile.schoolName || '' });
          return;
        }

        // Native .clsched file (v1 or v2)
        if (data.schoolProfile) applySchoolProfile(data.schoolProfile);
        if (data.school)         Object.assign(SchedState.school, data.school);
        if (data.staff)          SchedState.staff = data.staff;
        if (data.conflicts)      SchedState.conflicts = data.conflicts;
        if (data.masterSchedule) SchedState.masterSchedule = data.masterSchedule;
        if (data.blockTypes) {
          const hasNewSchema = data.blockTypes.some(bt => 'required' in bt);
          SchedState.blockTypes = hasNewSchema
            ? data.blockTypes
            : DEFAULT_BLOCK_TYPES.map(bt => Object.assign({}, bt,
                { subBlocks: (bt.subBlocks||[]).map(s=>Object.assign({},s)), bandMinutes:{}, subBandMinutes:{} }));
          ensureFixedBlockTypes();
          migrateBandIds();
          migrateSubBlockMinutes();
        }
        if (data.specialsSchedule) SchedState.specialsSchedule = data.specialsSchedule;
        // Ensure required arrays/fields exist
        if (!SchedState.school.lunchPeriods)    SchedState.school.lunchPeriods    = [];
        if (!SchedState.school.gradeRecesses)   SchedState.school.gradeRecesses   = {};
        if (!SchedState.school.gradeBands)      SchedState.school.gradeBands      = [];
        if (!SchedState.school.morningMeetings) SchedState.school.morningMeetings = [];
        if (!SchedState.school.altDays)         SchedState.school.altDays         = [];
        if (!SchedState.school.district)        SchedState.school.district        = '';
        if (!SchedState.specialsSchedule)       SchedState.specialsSchedule       = {};
        saveToLocal();
        localStorage.setItem('cl_schedule_downloaded', '1');
        resolve({ crossProduct: false });
      } catch (err) {
        reject(new Error(err.message || 'Could not read file.'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

function updateDownloadBadge() {
  const btn = document.getElementById('download-sched-btn');
  if (!btn) return;
  const downloaded = localStorage.getItem('cl_schedule_downloaded') === '1';
  btn.classList.toggle('btn-download-unsaved', !downloaded);
  btn.title = downloaded
    ? 'Download a copy of your schedule file'
    : 'Unsaved changes — download your schedule file to save permanently';
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
