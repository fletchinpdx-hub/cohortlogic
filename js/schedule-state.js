// Central state for the Building Schedule Builder
const SchedState = {
  scheduleId: localStorage.getItem('cl_schedule_id') || null,

  school: {
    name: '',
    year: '2026-2027',
    grades: [],

    // School day time boundaries
    teacherContractStart: '07:30',
    teacherContractEnd:   '15:00',
    studentCampusStart:   '07:45',  // breakfast / non-teacher supervision
    studentCampusEnd:     '15:15',  // after-school / non-teacher supervision
    firstBell:            '08:00',  // teacher instructional day begins
    dismissal:            '14:30',  // teacher instructional day ends

    // Morning meeting (optional)
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
  // Each: { id, name, role, gradeAssignment, color }
  // role: 'classroom_teacher' | 'ia' | 'specialist' | 'eld' | 'sped' | 'admin' | 'other'

  blockTypes: [
    { id: 'bt_1',  name: 'Morning Meeting',               color: '#6366f1', category: 'instruction' },
    { id: 'bt_2',  name: 'Literacy Block — Whole Group',  color: '#3b82f6', category: 'instruction' },
    { id: 'bt_3',  name: 'Literacy Block — Small Group',  color: '#60a5fa', category: 'instruction' },
    { id: 'bt_4',  name: 'Math — Core Instruction',       color: '#8b5cf6', category: 'instruction' },
    { id: 'bt_5',  name: 'Math — Small Group',            color: '#a78bfa', category: 'instruction' },
    { id: 'bt_6',  name: 'Science / Social Studies',      color: '#0ea5e9', category: 'instruction' },
    { id: 'bt_7',  name: 'Specials',                      color: '#f59e0b', category: 'specials'    },
    { id: 'bt_8',  name: 'ELD — Push In',                 color: '#10b981', category: 'intervention'},
    { id: 'bt_9',  name: 'ELD — Pull Out',                color: '#059669', category: 'intervention'},
    { id: 'bt_10', name: 'Intervention / High-Dose',      color: '#f97316', category: 'intervention'},
    { id: 'bt_11', name: 'CICO',                          color: '#ec4899', category: 'behavior'    },
    { id: 'bt_12', name: 'Rest & Return',                 color: '#64748b', category: 'behavior'    },
    { id: 'bt_13', name: 'Lunch',                         color: '#84cc16', category: 'transition'  },
    { id: 'bt_14', name: 'Recess',                        color: '#22d3ee', category: 'transition'  },
    { id: 'bt_15', name: 'Threshold Greetings',           color: '#fb923c', category: 'transition'  },
    { id: 'bt_16', name: 'Prep / Planning',               color: '#a855f7', category: 'admin'       },
    { id: 'bt_17', name: 'Arrival Duty',                  color: '#78716c', category: 'admin'       },
    { id: 'bt_18', name: 'Unassigned Time',               color: '#d1d5db', category: 'admin'       },
  ],

  // masterSchedule[day][grade][timeSlot] = blockTypeId | null
  // e.g. masterSchedule['Monday']['K']['07:30'] = 'bt_1'
  masterSchedule: {},
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
      if (!SchedState.school.lunchPeriods)  SchedState.school.lunchPeriods  = [];
      if (!SchedState.school.recessSlots)   SchedState.school.recessSlots   = [];
      if (!SchedState.school.altDays)       SchedState.school.altDays       = [];
      if (!SchedState.school.gradeRecesses) SchedState.school.gradeRecesses = {};
    }
    if (data.staff)          SchedState.staff = data.staff;
    if (data.blockTypes)     SchedState.blockTypes = data.blockTypes;
    if (data.masterSchedule) SchedState.masterSchedule = data.masterSchedule;
    return true;
  } catch (e) {
    return false;
  }
}

// ── Persistence: Supabase (cross-session) ────────────────────────────────────
function generateScheduleId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function saveToSupabase() {
  if (typeof SupabaseClient === 'undefined') return { ok: false, error: 'No Supabase client' };
  try {
    if (!SchedState.scheduleId) {
      SchedState.scheduleId = generateScheduleId();
      localStorage.setItem('cl_schedule_id', SchedState.scheduleId);
    }
    const payload = {
      id:          SchedState.scheduleId,
      school_name: SchedState.school.name,
      school_year: SchedState.school.year,
      data: {
        school:         SchedState.school,
        staff:          SchedState.staff,
        blockTypes:     SchedState.blockTypes,
        masterSchedule: SchedState.masterSchedule,
      },
      updated_at: new Date().toISOString(),
    };
    const { error } = await SupabaseClient.from('schedules').upsert(payload, { onConflict: 'id' });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: SchedState.scheduleId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function loadFromSupabase(id) {
  if (typeof SupabaseClient === 'undefined') return { ok: false, error: 'No Supabase client' };
  try {
    const { data, error } = await SupabaseClient.from('schedules').select('*').eq('id', id).single();
    if (error || !data) return { ok: false, error: error?.message || 'Not found' };
    const d = data.data;
    if (d.school)         Object.assign(SchedState.school, d.school);
    if (d.staff)          SchedState.staff = d.staff;
    if (d.blockTypes)     SchedState.blockTypes = d.blockTypes;
    if (d.masterSchedule) SchedState.masterSchedule = d.masterSchedule;
    SchedState.scheduleId = id;
    localStorage.setItem('cl_schedule_id', id);
    if (SchedState.school.name) {
      localStorage.setItem('cl_schedule_name', SchedState.school.name + ' — ' + SchedState.school.year);
    }
    saveToLocal();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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
  ia:                'Instructional Assistant',
  specialist:        'Specialist',
  eld:               'ELD Teacher',
  sped:              'SPED / ERC Teacher',
  admin:             'Administrator',
  other:             'Other',
};

const BLOCK_CATEGORIES = {
  instruction:  'Instruction',
  specials:     'Specials',
  intervention: 'Intervention & Support',
  behavior:     'Behavior Support',
  transition:   'Transitions & Routines',
  admin:        'Admin & Duty',
};

function gradesSorted() {
  return [...SchedState.school.grades].sort((a, b) => (GRADE_ORDER[a] ?? 99) - (GRADE_ORDER[b] ?? 99));
}
