// Verifies the coverage plan's two recess variants route occurrences correctly:
// _iaBlockOccurrences must return ONLY lunch-connected recess runs for the lunch
// variant, and ONLY standalone runs for the free variant. Classification comes
// from _recessBlockInfo (stubbed here by start time, as schedule-grid.js provides
// it in the real bundle).
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-ia.js';

const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minsToTime = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const _autoFillSlots = () => { const s = []; for (let m = timeToMins('08:00'); m < timeToMins('14:30'); m += 5) s.push(minsToTime(m)); return s; };
let SchedState;

// Stub: a recess run starting >= 11:00 is the lunch-connected one; earlier runs are standalone.
const _recessBlockInfo = (day, grade, slot) => ({ lunchAdjacent: timeToMins(slot) >= timeToMins('11:00') });

const src = fs.readFileSync(FILE, 'utf8');
eval(src.slice(src.indexOf('const IA_DUTY_BLOCKS')));

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }

const ms = {};
DAYS.forEach(day => {
  ms[day] = { '3': {} };
  // standalone recess 10:00–10:15, lunch-connected recess 11:20–11:35
  for (let m = timeToMins('10:00'); m < timeToMins('10:15'); m += 5) ms[day]['3'][minsToTime(m)] = 'bt_recess';
  for (let m = timeToMins('11:20'); m < timeToMins('11:35'); m += 5) ms[day]['3'][minsToTime(m)] = 'bt_recess';
});
SchedState = { masterSchedule: ms };

// Sentinel string values (const doesn't leak out of eval; mirror schedule-ia.js).
const lunch = _iaBlockOccurrences('Monday', '3', 'bt_recess', '__recess_lunch');
const free  = _iaBlockOccurrences('Monday', '3', 'bt_recess', '__recess_free');
const all   = _iaBlockOccurrences('Monday', '3', 'bt_recess', null);

assert(lunch.length === 1 && lunch[0][0] === '11:20', `lunch variant should match only 11:20 run, got ${JSON.stringify(lunch)}`);
assert(free.length === 1 && free[0][0] === '10:00', `free variant should match only 10:00 run, got ${JSON.stringify(free)}`);
assert(all.length === 2, `null subId (legacy) should match ALL recess runs, got ${all.length}`);

console.log('ia-recess-variant: PASS');
