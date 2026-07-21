// Verifies IA own lunch (and breaks) land at the SAME clock time every day. Sets up a
// per-day conflict that, under the old logic, scattered lunch to different times across
// the week; now it's placed at one consistent time (a day it truly can't fit is
// reported unplaced instead of moved).
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
eval(src.slice(src.indexOf('const IA_DUTY_BLOCKS')));

let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const paintDay = (ms, day, grade, blockId, start, end) => {
  ms[day] = ms[day] || {}; ms[day][grade] = ms[day][grade] || {};
  for (let m = timeToMins(start); m < timeToMins(end); m += 5) ms[day][grade][minsToTime(m)] = blockId;
};

// grade-3 math blocks Mon@11:00 and Tue@11:30 → covered first by the lone IA, so those
// slots are busy on those days, forcing lunch off 11:00 (Mon) and off 11:05 (Tue).
const ms = {};
paintDay(ms, 'Monday', '3', 'bt_math', '11:00', '11:05');
paintDay(ms, 'Tuesday', '3', 'bt_math', '11:30', '11:35');
SchedState = {
  school: { firstBell: '08:00', dismissal: '14:30' }, blockTypes: [{ id: 'bt_math', name: 'Math' }],
  masterSchedule: ms,
  staff: [{ id: 'A', role: 'ia', name: 'A', startTime: '08:00', endTime: '14:30', gradePreferences: [],
    ownLunch: { duration: 30, windowStart: '11:00', windowEnd: '11:35', allocId: null }, breaks: { count: 0 } }],
  iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  // coverage ABOVE the lunch step so math is placed first and contends for the window.
  iaCoverage: [
    { id: 'm', blockId: 'bt_math', subId: null, scope: 'grade', grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] },
    { id: 'l', kind: 'ia_lunch' },
    { id: 'b', kind: 'ia_breaks' },
  ],
  iaSchedule: {},
};
const rep = placeIAs();

// Collect the start slot of the own-lunch block on each day it was placed.
const lunchStarts = {};
DAYS.forEach(d => {
  const map = SchedState.iaSchedule[d] || {}; const A = map.A || {};
  const slots = Object.keys(A).filter(s => A[s].targetType === 'own_lunch').sort();
  if (slots.length) lunchStarts[d] = slots[0];
});
const distinct = new Set(Object.values(lunchStarts));
console.log('  lunch start per day:', JSON.stringify(lunchStarts));
ck('own lunch is at the SAME time every day it is placed', distinct.size === 1);
ck('lunch placed on at least 4 of 5 days', Object.keys(lunchStarts).length >= 4);
ck('the day it could not fit is reported (not scattered)', rep.ownLunchUnplaced.length === 5 - Object.keys(lunchStarts).length && rep.ownLunchUnplaced.length >= 1);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
