// Verifies the two personal-time steps (IA's lunch / breaks) are honored at THEIR
// position in the coverage plan: an IA whose only lunch slot collides with a coverage
// block gets lunch when the lunch step is ABOVE the coverage row, but is put on
// coverage (lunch unplaced) when the lunch step is BELOW it.
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-ia.js';
const src = fs.readFileSync(FILE, 'utf8');
const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minsToTime = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const generateTimeSlots = (s, e) => { const o = []; for (let m = timeToMins(s); m < timeToMins(e); m += 5) o.push(minsToTime(m)); return o; };
const getDismissalForDay = () => '14:30';
const getBtName = id => id;
const _autoFillSlots = () => generateTimeSlots('08:00', '14:30');
let SchedState;
eval(src.slice(src.indexOf('const IA_DUTY_BLOCKS')));

let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const paint = (ms, g, b, s, e) => DAYS.forEach(d => { ms[d] = ms[d] || {}; ms[d][g] = ms[d][g] || {}; for (let m = timeToMins(s); m < timeToMins(e); m += 5) ms[d][g][minsToTime(m)] = b; });

// One IA, whose only 30-min lunch window (10:00–10:30) is exactly the coverage block.
const build = coverage => {
  const ms = {}; paint(ms, '3', 'bt_math', '10:00', '10:30');
  return {
    school: { firstBell: '08:00', dismissal: '14:30' }, blockTypes: [{ id: 'bt_math', name: 'Math' }],
    masterSchedule: ms,
    staff: [{ id: 'A', role: 'ia', name: 'A', startTime: '08:00', endTime: '14:30', gradePreferences: [],
      ownLunch: { duration: 30, windowStart: '10:00', windowEnd: '10:30', allocId: null }, breaks: { count: 0 } }],
    iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
    iaCoverage: coverage, iaSchedule: {},
  };
};
const covRow = { id: 'c', blockId: 'bt_math', subId: null, scope: 'grade', grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] };
const has = (pred) => Object.values(SchedState.iaSchedule.Monday.A || {}).some(pred);

// Lunch step ABOVE coverage → IA gets lunch, coverage short.
SchedState = build([{ id: 'l', kind: 'ia_lunch' }, { id: 'b', kind: 'ia_breaks' }, covRow]);
let rep = build && placeIAs();
ck('lunch above coverage → IA gets own lunch', has(e => e.targetType === 'own_lunch'));
ck('lunch above coverage → coverage is short', rep.shortfalls.length > 0 && !has(e => e.targetType === 'grade'));

// Lunch step BELOW coverage → coverage wins, lunch unplaced.
SchedState = build([covRow, { id: 'l', kind: 'ia_lunch' }, { id: 'b', kind: 'ia_breaks' }]);
rep = placeIAs();
ck('coverage above lunch → IA covers the block', has(e => e.targetType === 'grade'));
ck('coverage above lunch → own lunch unplaced', rep.ownLunchUnplaced.length > 0 && !has(e => e.targetType === 'own_lunch'));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
