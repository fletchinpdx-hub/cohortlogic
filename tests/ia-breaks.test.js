// Harness for the new engine behavior: kids-lunch priority + IA breaks.
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-ia.js';
const timeToMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minsToTime = x => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const _autoFillSlots = () => { const s = []; for (let m = timeToMins('08:00'); m < timeToMins('14:30'); m += 5) s.push(minsToTime(m)); return s; };
let SchedState;
eval(fs.readFileSync(FILE, 'utf8').slice(fs.readFileSync(FILE, 'utf8').indexOf('const IA_DUTY_BLOCKS')));

const paint = (ms, grade, blockId, start, end) => DAYS.forEach(day => { ms[day] = ms[day] || {}; ms[day][grade] = ms[day][grade] || {}; for (let m = timeToMins(start); m < timeToMins(end); m += 5) ms[day][grade][minsToTime(m)] = blockId; });

let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const entries = (day, id) => (SchedState.iaSchedule[day] || {})[id] || {};
const slotsOfType = (day, id, tt) => Object.entries(entries(day, id)).filter(([, e]) => e.targetType === tt).map(([s]) => s).sort();
const coversGradeAt = (day, id, grade, slot) => { const e = entries(day, id)[slot]; return e && e.targetType === 'grade' && e.targetId === grade; };

// ── Scenario 1: kids' lunch priority + own lunch fits around it ──
// One IA (L), full day. Kid lunch g3 11:00–11:30 must be staffed; L's own-lunch
// window 11:00–12:00 overlaps it → L covers the kid lunch, own lunch goes 11:30+.
const ms = {}; paint(ms, '3', 'bt_lunch', '11:00', '11:30');
SchedState = {
  masterSchedule: ms,
  staff: [{ id: 'L', role: 'ia', name: 'Lee', startTime: '08:00', endTime: '14:30', gradePreferences: [],
            ownLunch: { duration: 30, windowStart: '11:00', windowEnd: '12:00', allocId: 'gen' },
            breaks: { count: 1, duration: 15 } }],
  iaAllocations: [{ id: 'gen', name: 'Gen', hoursPerDay: 100 }],
  iaCoverage: [{ id: 'r', blockId: 'bt_lunch', subId: null, grades: ['3'], iasPerGrade: 1, allowedAllocIds: ['gen'] }],
  iaSchedule: {},
};
const rep = placeIAs();

const kidLunchSlots = []; for (let m = timeToMins('11:00'); m < timeToMins('11:30'); m += 5) kidLunchSlots.push(minsToTime(m));
ck('kids lunch staffed: L covers g3 lunch 11:00–11:30 all days', DAYS.every(d => kidLunchSlots.every(sl => coversGradeAt(d, 'L', '3', sl))));

const ownMon = slotsOfType('Monday', 'L', 'own_lunch');
ck('L own lunch placed (30 min = 6 slots)', ownMon.length === 6);
ck('L own lunch does NOT overlap the kid lunch (fits around it)', ownMon.every(s => timeToMins(s) >= timeToMins('11:30')));
ck('L own lunch inside its window (11:00–12:00)', ownMon.every(s => timeToMins(s) >= timeToMins('11:00') && timeToMins(s) + 5 <= timeToMins('12:00')));

// ── Scenario 2: breaks — default 1 × 15, never in first/last hour ──
const brk = slotsOfType('Monday', 'L', 'break');
ck('break placed (15 min = 3 slots)', brk.length === 3);
ck('break NOT in first hour (start ≥ 09:00 for an 08:00 start)', brk.every(s => timeToMins(s) >= timeToMins('09:00')));
ck('break NOT in last hour (end ≤ 13:30 for a 14:30 end)', brk.every(s => timeToMins(s) + 5 <= timeToMins('13:30')));

// ── Scenario 3: break count configurable (2 breaks) ──
SchedState = {
  masterSchedule: {},
  staff: [{ id: 'M', role: 'ia', name: 'Mo', startTime: '08:00', endTime: '14:30', gradePreferences: [], breaks: { count: 2, duration: 15 } }],
  iaAllocations: [], iaCoverage: [], iaSchedule: {},
};
placeIAs();
const brk2 = slotsOfType('Monday', 'M', 'break');
ck('2 breaks configured → 6 break slots (2 × 15 min)', brk2.length === 6);
// two distinct runs (a gap between them)
let runs = 0; brk2.forEach((s, i) => { if (i === 0 || timeToMins(s) - timeToMins(brk2[i - 1]) > 5) runs++; });
ck('the 2 breaks are separate runs (spread apart)', runs === 2);

// ── Scenario 4: count 0 → no breaks ──
SchedState = { masterSchedule: {}, staff: [{ id: 'N', role: 'ia', name: 'Ny', startTime: '08:00', endTime: '14:30', breaks: { count: 0 } }], iaAllocations: [], iaCoverage: [], iaSchedule: {} };
placeIAs();
ck('break count 0 → no break slots', slotsOfType('Monday', 'N', 'break').length === 0);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
