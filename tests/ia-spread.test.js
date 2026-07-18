// Verifies lunches/breaks SPREAD across the window (not clustered) so coverage is
// preserved — the bug the user reported (all lunches at the window start).
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
const ownSlots = (day, id) => Object.entries((SchedState.iaSchedule[day] || {})[id] || {}).filter(([, e]) => e.targetType === 'own_lunch').map(([s]) => s);

// 3 IAs, all lunch 30 min in window 10:30–13:30 (fits 3 non-overlapping). A recess
// at 10:30 needs 1 IA — with clustering (old), all lunch at 10:30 → recess missed.
const ms = {}; paint(ms, '3', 'bt_recess', '10:30', '10:45');
SchedState = {
  masterSchedule: ms,
  staff: ['A', 'B', 'C'].map(id => ({ id, role: 'ia', name: id, startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 },
    ownLunch: { duration: 30, windowStart: '10:30', windowEnd: '13:30', allocId: null } })),
  iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'r', blockId: 'bt_recess', subId: null, grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] }],
  iaSchedule: {},
};
const rep = placeIAs();

// how many IAs are on lunch simultaneously at each Monday slot?
const perSlot = {};
['A', 'B', 'C'].forEach(id => ownSlots('Monday', id).forEach(s => { perSlot[s] = (perSlot[s] || 0) + 1; }));
const maxSimul = Math.max(0, ...Object.values(perSlot));
const distinctStarts = new Set(['A', 'B', 'C'].map(id => ownSlots('Monday', id)[0]));

ck('3 lunches DO NOT all overlap (spread across the window)', maxSimul <= 1);
ck('the 3 lunches are at distinct start times', distinctStarts.size === 3);
ck('recess at 10:30 IS covered (an IA was free — not all on lunch)', rep.shortfalls.length === 0);

// each lunch still inside its window
let inWindow = true;
['A', 'B', 'C'].forEach(id => ownSlots('Monday', id).forEach(s => { if (timeToMins(s) < timeToMins('10:30') || timeToMins(s) + 5 > timeToMins('13:30')) inWindow = false; }));
ck('every lunch stays inside 10:30–13:30', inWindow);

// determinism
const snap = JSON.stringify(SchedState.iaSchedule);
placeIAs();
ck('deterministic (identical on re-run)', JSON.stringify(SchedState.iaSchedule) === snap);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
