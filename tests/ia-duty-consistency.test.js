// Verifies duty (recess/lunch) is CONSISTENT across the week — the same aide keeps
// the same duty every day (no lunch-some-days / recess-other-days in one slot) — while
// DIFFERENT duties still spread across DIFFERENT aides (no aide hogs them all).
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

const paint = (ms, grade, blockId, start, end) => DAYS.forEach(day => {
  ms[day] = ms[day] || {}; ms[day][grade] = ms[day][grade] || {};
  for (let m = timeToMins(start); m < timeToMins(end); m += 5) ms[day][grade][minsToTime(m)] = blockId;
});
let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const ias = n => Array.from({ length: n }, (_, i) => ({ id: 'IA' + i, role: 'ia', name: 'IA' + i, startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } }));
// aides covering a given grade across the week
const aidesForGrade = grade => {
  const set = new Set();
  DAYS.forEach(d => Object.entries(SchedState.iaSchedule[d] || {}).forEach(([id, sl]) => {
    if (Object.values(sl).some(e => e.targetType === 'grade' && e.targetId === grade)) set.add(id);
  }));
  return set;
};

// 1) Single recess, need 1, 5 aides → SAME aide all 5 days (consistency).
let ms = {}; paint(ms, '3', 'bt_recess', '10:00', '10:15');
SchedState = { masterSchedule: ms, staff: ias(5), iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'sr', blockId: 'bt_recess', subId: '__recess_free', grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] }], iaSchedule: {} };
placeIAs();
ck('single recess → ONE consistent aide all week', aidesForGrade('3').size === 1);

// 2) Instructional block → one aide all week (unchanged).
ms = {}; paint(ms, '3', 'bt_math', '10:00', '10:30');
SchedState = { masterSchedule: ms, staff: ias(5), iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'm', blockId: 'bt_math', subId: null, grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] }], iaSchedule: {} };
placeIAs();
ck('instructional → ONE consistent aide all week', aidesForGrade('3').size === 1);

// 3) Staggered recesses across 5 grades + an aide who prefers EVERY grade: each grade's
//    recess is consistent (one aide all week) AND the duty spreads across many aides.
const G = ['K', '1', '2', '3', '4'];
ms = {}; G.forEach((g, i) => paint(ms, g, 'bt_recess', minsToTime(timeToMins('09:00') + i * 15), minsToTime(timeToMins('09:15') + i * 15)));
const mixed = [{ id: 'IA0', role: 'ia', name: 'IA0', startTime: '08:00', endTime: '14:30', gradePreferences: G.slice(), breaks: { count: 0 } },
  ...['IA1', 'IA2', 'IA3', 'IA4'].map(id => ({ id, role: 'ia', name: id, startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } }))];
SchedState = { masterSchedule: ms, staff: mixed, iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'sr', blockId: 'bt_recess', subId: '__recess_free', grades: G, iasPerGrade: 1, allowedAllocIds: ['gen'] }], iaSchedule: {} };
placeIAs();
ck('each grade recess is consistent all week', G.every(g => aidesForGrade(g).size === 1));
const allAides = new Set(G.flatMap(g => [...aidesForGrade(g)]));
ck('recess duty spreads across aides (not all on the all-grades aide)', allAides.size >= 4);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
