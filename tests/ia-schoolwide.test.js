// Verifies SCHOOL-WIDE coverage: a uniform duty (e.g. dismissal) placed in every
// grade is staffed by a fixed COUNT of aides — not multiplied per grade — and the
// assignment carries targetType 'block' (no grade). A per-grade row still multiplies.
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
const G = ['K', '1', '2', '3', '4', '5'];
const paintAll = (ms, btId, s, e) => DAYS.forEach(d => { ms[d] = ms[d] || {}; G.forEach(g => { ms[d][g] = ms[d][g] || {}; for (let m = timeToMins(s); m < timeToMins(e); m += 5) ms[d][g][minsToTime(m)] = btId; }); });
const ias = n => Array.from({ length: n }, (_, i) => ({ id: 'IA' + i, role: 'ia', name: 'IA' + i, startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 0 } }));
const base = (coverage) => ({
  school: { firstBell: '08:00', dismissal: '14:30' },
  blockTypes: [{ id: 'bt_dis', name: 'Dismissal', uniformStart: '14:10', uniformEnd: '14:30' }],
  masterSchedule: (() => { const ms = {}; paintAll(ms, 'bt_dis', '14:10', '14:30'); return ms; })(),
  staff: ias(6), iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: coverage, iaSchedule: {},
});
const dismissalIAsMon = () => {
  const mon = SchedState.iaSchedule.Monday || {}; const set = new Set(); const types = new Set();
  Object.entries(mon).forEach(([id, sl]) => Object.values(sl).forEach(e => { if (e.targetType === 'block' || (e.targetType === 'grade' && SchedState.masterSchedule.Monday[e.targetId])) { set.add(id); types.add(e.targetType); } }));
  return { count: set.size, types: [...types] };
};

// School-wide: 3 IAs total on dismissal, targetType 'block'.
SchedState = base([{ id: 'd', blockId: 'bt_dis', subId: null, scope: 'school', grades: [], iasPerGrade: 3, allowedAllocIds: ['gen'] }]);
let rep = placeIAs();
let r = dismissalIAsMon();
ck('school-wide dismissal → exactly 3 aides (not 3×6)', r.count === 3);
ck('school-wide assignment uses targetType "block"', r.types.length === 1 && r.types[0] === 'block');
ck('no shortfall', rep.shortfalls.length === 0);

// Per-grade control: same block, scope grade, 1/grade × 6 grades = 6 assignments.
SchedState = base([{ id: 'd', blockId: 'bt_dis', subId: null, scope: 'grade', grades: G, iasPerGrade: 1, allowedAllocIds: ['gen'] }]);
placeIAs();
const monG = SchedState.iaSchedule.Monday || {};
let gradeCount = 0;
Object.values(monG).forEach(sl => { if (Object.values(sl).some(e => e.targetType === 'grade')) gradeCount++; });
ck('per-grade dismissal → 6 aides (one per grade)', gradeCount === 6);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
