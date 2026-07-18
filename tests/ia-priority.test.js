// Verifies coverage-plan ROW ORDER drives fill priority: with one IA and two
// coverage rows demanding it at the SAME time, the TOP row is staffed; reordering flips it.
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-ia.js';
const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minsToTime = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const _autoFillSlots = () => { const s = []; for (let m = timeToMins('08:00'); m < timeToMins('14:30'); m += 5) s.push(minsToTime(m)); return s; };
let SchedState;
const src = fs.readFileSync(FILE, 'utf8');
eval(src.slice(src.indexOf('const IA_DUTY_BLOCKS')));

const paint = (ms, grade, blockId, start, end) => DAYS.forEach(day => { ms[day] = ms[day] || {}; ms[day][grade] = ms[day][grade] || {}; for (let m = timeToMins(start); m < timeToMins(end); m += 5) ms[day][grade][minsToTime(m)] = blockId; });
let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const coversGrade = grade => DAYS.some(d => Object.values((SchedState.iaSchedule[d] || {}).A || {}).some(e => e.targetType === 'grade' && e.targetId === grade));

// g3 Math and g4 ELA both 10:00–10:30 (overlap); ONE IA can cover only one.
const ms = {}; paint(ms, '3', 'bt_math', '10:00', '10:30'); paint(ms, '4', 'bt_ela', '10:00', '10:30');
const build = order => ({
  masterSchedule: ms,
  staff: [{ id: 'A', role: 'ia', name: 'Ada', startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 }, ownLunch: null }],
  iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: order.map(g => ({ id: 'r' + g, blockId: g === '3' ? 'bt_math' : 'bt_ela', subId: null, grades: [g], iasPerGrade: 1, allowedAllocIds: ['gen'] })),
  iaSchedule: {},
});

// Order [3, 4] → grade 3 (top) covered, grade 4 short.
SchedState = build(['3', '4']); let rep = placeIAs();
ck('top row (g3) staffed', coversGrade('3'));
ck('bottom row (g4) NOT staffed → shortfall', !coversGrade('4') && rep.shortfalls.some(s => s.grade === '4'));

// Reorder to [4, 3] → grade 4 now covered, grade 3 short.
SchedState = build(['4', '3']); rep = placeIAs();
ck('after reorder, top row (g4) staffed', coversGrade('4'));
ck('after reorder, g3 NOT staffed → shortfall', !coversGrade('3') && rep.shortfalls.some(s => s.grade === '3'));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
