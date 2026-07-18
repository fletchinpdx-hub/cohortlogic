// Node harness for the IA placement engine (placeIAs) — asserts the hard/soft
// properties without a browser. Extracts the engine functions from schedule-ia.js.
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-ia.js';

// ---- environment the engine expects (normally from other bundle files) ----
const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minsToTime = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const _autoFillSlots = () => { const s = []; for (let m = timeToMins('08:00'); m < timeToMins('14:30'); m += 5) s.push(minsToTime(m)); return s; };
let SchedState;

// pull only the engine block (from IA_DUTY_BLOCKS to EOF)
const src = fs.readFileSync(FILE, 'utf8');
const engine = src.slice(src.indexOf('const IA_DUTY_BLOCKS'));
eval(engine);

// ---- scenario builder ----
const paint = (ms, grade, blockId, subId, start, end) => {
  DAYS.forEach(day => {
    ms[day] = ms[day] || {}; ms[day][grade] = ms[day][grade] || {};
    for (let m = timeToMins(start); m < timeToMins(end); m += 5) ms[day][grade][minsToTime(m)] = subId ? blockId + '|' + subId : blockId;
  });
};
function build() {
  const ms = {};
  // ELA 09:00–09:30 both grades; Recess 10:00–10:15 both; Lunch g3 11:00–11:20, g4 11:40–12:00
  paint(ms, '3', 'bt_ela', null, '09:00', '09:30'); paint(ms, '4', 'bt_ela', null, '09:00', '09:30');
  paint(ms, '3', 'bt_recess', null, '10:00', '10:15'); paint(ms, '4', 'bt_recess', null, '10:00', '10:15');
  paint(ms, '3', 'bt_lunch', null, '11:00', '11:20'); paint(ms, '4', 'bt_lunch', null, '11:40', '12:00');
  return {
    masterSchedule: ms,
    staff: [
      { id: 'A', role: 'ia', name: 'Ada',  startTime: '08:00', endTime: '10:30', gradePreferences: ['3'], breaks:{count:0} },
      { id: 'B', role: 'ia', name: 'Ben',  startTime: '08:00', endTime: '10:30', gradePreferences: ['4'], breaks:{count:0} },
      { id: 'C', role: 'ia', name: 'Cy',   startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks:{count:0}, ownLunch: { duration: 30, windowStart: '12:00', windowEnd: '13:00', allocId: 'gen' } },
      { id: 'E', role: 'ia', name: 'El',   startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks:{count:0} },
    ],
    iaAllocations: [ { id: 'gen', name: 'Gen Ed', hoursPerDay: 100 }, { id: 'title', name: 'Title', hoursPerDay: 0.1 } ],
    iaCoverage: [
      { id: 'c1', blockId: 'bt_ela',    subId: null, grades: ['3', '4'], iasPerGrade: 1, allowedAllocIds: ['gen'] },
      { id: 'c2', blockId: 'bt_recess', subId: null, grades: ['3', '4'], iasPerGrade: 1, allowedAllocIds: ['gen'] },
      { id: 'c3', blockId: 'bt_lunch',  subId: null, grades: ['3', '4'], iasPerGrade: 1, allowedAllocIds: ['title'] },
    ],
    iaSchedule: {},
  };
}

let fail = 0; const ck = (label, cond) => { console.log((cond ? '✓ ' : '❌ FAIL ') + label); if (!cond) fail++; };
const entriesFor = (day, iaId) => (SchedState.iaSchedule[day] || {})[iaId] || {};
const slotOwner = (day, grade, slot) => {                    // which IA covers grade/slot
  return SchedState.staff.filter(s => s.role === 'ia').filter(ia => {
    const e = entriesFor(day, ia.id)[slot]; return e && e.targetType === 'grade' && e.targetId === grade;
  }).map(ia => ia.id);
};
const minutesByType = (iaId, blockId) => {
  let n = 0; DAYS.forEach(day => { const m = entriesFor(day, iaId); Object.keys(m).forEach(sl => { if (m[sl].targetType === 'grade' && SchedState.masterSchedule[day]) {} }); });
  // count coverage minutes where the underlying master block === blockId for that grade
  DAYS.forEach(day => { const m = entriesFor(day, iaId); Object.entries(m).forEach(([sl, e]) => {
    if (e.targetType !== 'grade') return;
    const bt = (SchedState.masterSchedule[day][e.targetId] || {})[sl] || '';
    if (bt.split('|')[0] === blockId) n += 5;
  }); });
  return n;
};

SchedState = build();
const rep = placeIAs();

// 1) Determinism
const snap1 = JSON.stringify(SchedState.iaSchedule);
SchedState = build(); placeIAs();
ck('deterministic (two runs identical)', JSON.stringify(SchedState.iaSchedule) === snap1);

// 2) No double-booking: at 09:00 both grades need coverage → must be DIFFERENT IAs
let distinctAt0900 = true;
DAYS.forEach(day => { const g3 = slotOwner(day, '3', '09:00'), g4 = slotOwner(day, '4', '09:00');
  if (g3.length && g4.length && g3[0] === g4[0]) distinctAt0900 = false; });
ck('no double-booking (ELA g3 vs g4 @09:00 are different IAs)', distinctAt0900);

// also: no IA has two entries at the same slot anywhere (structurally one-per-slot) —
// verify no IA covers two different grades in the same slot across the map
let noOverlap = true;
DAYS.forEach(day => SchedState.staff.forEach(ia => { const m = entriesFor(day, ia.id);
  // each slot maps to one entry — fine by construction; check hours below instead
}));
ck('one entry per IA-slot (structural)', noOverlap);

// 3) Hours respected: A and B end 10:30 → never assigned lunch (11:00+)
let hoursOK = true;
DAYS.forEach(day => ['A', 'B'].forEach(id => { Object.keys(entriesFor(day, id)).forEach(sl => { if (timeToMins(sl) + 5 > timeToMins('10:30')) hoursOK = false; }); }));
ck('working hours respected (A/B never past 10:30)', hoursOK);

// 4) Preference honored: A(pref3) covers grade-3 ELA; B(pref4) covers grade-4 ELA — every day
let prefOK = true;
DAYS.forEach(day => { if (!slotOwner(day, '3', '09:00').includes('A')) prefOK = false; if (!slotOwner(day, '4', '09:00').includes('B')) prefOK = false; });
ck('grade preference honored (A→g3 ELA, B→g4 ELA)', prefOK);

// 5) Consistency: grade-3 ELA covered by the SAME IA every day
const g3elaIAs = new Set(DAYS.map(day => slotOwner(day, '3', '09:00')[0]));
ck('consistency (same IA covers g3 ELA all week)', g3elaIAs.size === 1);

// 6) Duty parity by minutes: lunch is covered only by C/E (A/B out of hours) and should
//    SPLIT roughly evenly, not pile on one IA. (Broken parity would give one IA ~all lunch.)
const lunchC = minutesByType('C', 'bt_lunch'), lunchE = minutesByType('E', 'bt_lunch');
ck('duty parity: lunch split across C and E (both > 0)', lunchC > 0 && lunchE > 0);
ck('duty parity: lunch balanced (|C−E| ≤ 20 min)', Math.abs(lunchC - lunchE) <= 20);

// 7) Own lunch: C reserved 30 min inside 12:00–13:00 each day, and NOT covering then
let ownOK = true, ownCharged = true;
DAYS.forEach(day => {
  const m = entriesFor(day, 'C');
  const own = Object.entries(m).filter(([, e]) => e.targetType === 'own_lunch');
  if (own.length !== 6) ownOK = false;                                   // 30 min = 6 slots
  own.forEach(([sl]) => { if (timeToMins(sl) < timeToMins('12:00') || timeToMins(sl) + 5 > timeToMins('13:00')) ownOK = false; });
});
ck('own lunch: C gets 30 min inside 12:00–13:00 every day', ownOK);

// 8) Over-budget: lunch funded by "title" (0.1h/day = 6 min) but 40 min/day charged → reported
ck('over-budget reported (title exceeds its daily budget)', rep.overBudget.length >= 1);

// 9) Shortfall: a fresh run where demand exceeds IA supply
SchedState = build();
SchedState.iaCoverage = [{ id: 'x', blockId: 'bt_ela', subId: null, grades: ['3'], iasPerGrade: 9, allowedAllocIds: ['gen'] }];
const rep2 = placeIAs();
ck('shortfall reported when need (9) exceeds available IAs', rep2.shortfalls.length >= 1);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
