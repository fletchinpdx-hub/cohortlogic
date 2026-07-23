// Team selection must prefer an aide who is actually FREE every day of the block.
// Regression: selection only checked working HOURS, so an aide already booked on one
// day (by an earlier/higher-priority row) could be picked — forcing a substitute that
// day and reporting "different IAs on different days" — while an aide free all week
// sat unused.
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-ia.js';
const src = fs.readFileSync(FILE, 'utf8');
const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minsToTime = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const generateTimeSlots = (s, e) => { const o = []; for (let m = timeToMins(s); m < timeToMins(e); m += 5) o.push(minsToTime(m)); return o; };
const getDismissalForDay = () => '14:30';
const _autoFillSlots = () => generateTimeSlots('08:00', '14:30');
let SchedState;
const _recessBlockInfo = () => ({ lunchAdjacent: false });
eval(src.slice(src.indexOf('const IA_DUTY_BLOCKS')));

let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const put = (ms, day, grade, blockId, start, end) => {
  ms[day] = ms[day] || {}; ms[day][grade] = ms[day][grade] || {};
  for (let m = timeToMins(start); m < timeToMins(end); m += 5) ms[day][grade][minsToTime(m)] = blockId;
};

const ms = {};
// Grade 1 recess at 10:30 EVERY day (the block we want covered consistently).
DAYS.forEach(d => put(ms, d, '1', 'bt_recess', '10:30', '10:45'));
// Grade 3 math at the SAME time, but only on Wednesday. It's the higher-priority row,
// so it books whoever it picks on Wednesday at 10:30.
put(ms, 'Wednesday', '3', 'bt_math', '10:30', '10:45');

// A prefers grade 1 (so duty ranking favors A for the recess) but will be consumed by
// Wednesday's math. B has no preference but is free all five days.
const ias = [
  { id: 'A', role: 'ia', name: 'A', startTime: '08:00', endTime: '14:30', gradePreferences: ['1', '3'], breaks: { count: 0 } },
  { id: 'B', role: 'ia', name: 'B', startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } },
];
SchedState = {
  school: { firstBell: '08:00', dismissal: '14:30' },
  blockTypes: [{ id: 'bt_math', name: 'Math' }, { id: 'bt_recess', name: 'Recess' }],
  masterSchedule: ms, staff: ias,
  iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [
    { id: 'm', blockId: 'bt_math',   subId: null, scope: 'grade', grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] },
    { id: 'r', blockId: 'bt_recess', subId: '__recess_free', scope: 'grade', grades: ['1'], iasPerGrade: 1, allowedAllocIds: ['gen'] },
  ],
  iaSchedule: {},
};
const rep = placeIAs();

// Which aides cover grade-1 recess across the week?
const coverers = new Set();
DAYS.forEach(d => Object.entries(SchedState.iaSchedule[d] || {}).forEach(([id, sl]) => {
  if (Object.values(sl).some(e => e.targetType === 'grade' && e.targetId === '1')) coverers.add(id);
}));
const daysCovered = DAYS.filter(d => Object.values(SchedState.iaSchedule[d] || {})
  .some(sl => Object.values(sl).some(e => e.targetType === 'grade' && e.targetId === '1'))).length;

console.log('  grade-1 recess covered by:', [...coverers].join(','), '| days covered:', daysCovered);
ck('recess covered all 5 days', daysCovered === 5);
ck('ONE aide covers it all week (picks the aide free every day)', coverers.size === 1);
ck('no bogus "different IAs on different days" inconsistency', rep.inconsistencies.length === 0);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
