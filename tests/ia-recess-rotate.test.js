// Verifies duty blocks (recess/lunch) ROTATE across aides day-to-day, while
// instructional blocks keep ONE consistent aide all week.
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-ia.js';
const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minsToTime = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const _autoFillSlots = () => { const s = []; for (let m = timeToMins('08:00'); m < timeToMins('14:30'); m += 5) s.push(minsToTime(m)); return s; };
let SchedState;
const _recessBlockInfo = () => ({ lunchAdjacent: false });
eval(fs.readFileSync(FILE, 'utf8').slice(fs.readFileSync(FILE, 'utf8').indexOf('const IA_DUTY_BLOCKS')));

const paint = (ms, grade, blockId, start, end) => DAYS.forEach(day => {
  ms[day] = ms[day] || {}; ms[day][grade] = ms[day][grade] || {};
  for (let m = timeToMins(start); m < timeToMins(end); m += 5) ms[day][grade][minsToTime(m)] = blockId;
});
let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const ias = n => Array.from({ length: n }, (_, i) => ({ id: 'IA' + i, role: 'ia', name: 'IA' + i, startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } }));
const coverBy = (blockId) => {
  const perDay = {};
  DAYS.forEach(d => {
    const map = SchedState.iaSchedule[d] || {};
    Object.entries(map).forEach(([id, slots]) => {
      if (Object.values(slots).some(e => e.targetType === 'grade')) perDay[d] = (perDay[d] || []).concat(id);
    });
  });
  return perDay;
};

// 1) Single recess, need 1, 5 aides → should rotate to a DIFFERENT aide each day.
let ms = {}; paint(ms, '3', 'bt_recess', '10:00', '10:15');
SchedState = { masterSchedule: ms, staff: ias(5), iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'sr', blockId: 'bt_recess', subId: '__recess_free', grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] }], iaSchedule: {} };
placeIAs();
let byDay = coverBy('bt_recess');
let distinct = new Set(Object.values(byDay).flat());
ck('recess covered all 5 days', Object.keys(byDay).length === 5);
ck('recess ROTATES across aides (5 distinct over the week)', distinct.size === 5);

// 2) Instructional block, need 1, 5 aides → should stay the SAME aide all week.
ms = {}; paint(ms, '3', 'bt_math', '10:00', '10:30');
SchedState = { masterSchedule: ms, staff: ias(5), iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'm', blockId: 'bt_math', subId: null, grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] }], iaSchedule: {} };
placeIAs();
byDay = coverBy('bt_math');
distinct = new Set(Object.values(byDay).flat());
ck('instructional block stays with ONE consistent aide all week', distinct.size === 1 && Object.keys(byDay).length === 5);

// 3) Staggered recesses on the SAME day + one aide who prefers EVERY grade must not
//    soak up all the duty — within-day duty load spreads it across aides.
ms = {}; ['K', '1', '2', '3', '4'].forEach((g, i) => paint(ms, g, 'bt_recess', minsToTime(timeToMins('09:00') + i * 15), minsToTime(timeToMins('09:15') + i * 15)));
const mixed = [
  { id: 'IA0', role: 'ia', name: 'IA0', startTime: '08:00', endTime: '14:30', gradePreferences: ['K', '1', '2', '3', '4'], breaks: { count: 0 } }, // prefers all
  { id: 'IA1', role: 'ia', name: 'IA1', startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } },
  { id: 'IA2', role: 'ia', name: 'IA2', startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } },
  { id: 'IA3', role: 'ia', name: 'IA3', startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } },
  { id: 'IA4', role: 'ia', name: 'IA4', startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } },
];
SchedState = { masterSchedule: ms, staff: mixed, iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'sr', blockId: 'bt_recess', subId: '__recess_free', grades: ['K', '1', '2', '3', '4'], iasPerGrade: 1, allowedAllocIds: ['gen'] }], iaSchedule: {} };
placeIAs();
const monDistinct = new Set(Object.entries(SchedState.iaSchedule.Monday || {}).filter(([id, sl]) => Object.values(sl).some(e => e.targetType === 'grade')).map(([id]) => id));
ck('staggered recess spreads within the day (not all on the all-grades aide)', monDistinct.size >= 4);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
