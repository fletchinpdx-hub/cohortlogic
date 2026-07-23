// IA coverage must FOLLOW a block that moves on the Building Schedule.
// Regression: sliding a block only trimmed the vacated slot (stale cleanup), so the
// coverage's start looked right but its end never moved — leaving an open gap at the
// block's new end.
const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-grid.js';
const src = fs.readFileSync(FILE, 'utf8');
const i = src.indexOf('function _shiftIACoverageForMove');
const end = src.indexOf('\n}\n', i);
let SchedState;
eval(src.slice(i, end + 2));

let fail = 0; const ck = (l, c) => { console.log((c ? '✓ ' : '❌ FAIL ') + l); if (!c) fail++; };
const cov = (grade) => ({ targetType: 'grade', targetId: grade, allocId: 'gen', note: '' });
const slotsOf = (iaId) => Object.keys(SchedState.iaSchedule.Monday[iaId]).sort();

// 1) A 3-slot block for grade 1 slides down 5 minutes → coverage slides with it.
SchedState = { iaSchedule: { Monday: { A: {
  '10:00': cov('1'), '10:05': cov('1'), '10:10': cov('1'),
  '11:00': cov('2'),                       // unrelated coverage — must not move
} } } };
let moved = _shiftIACoverageForMove('Monday', '1', '1', ['10:00', '10:05', '10:10'], ['10:05', '10:10', '10:15']);
ck('all 3 covering slots moved', moved === 3);
ck('coverage now spans the block\'s new extent (10:05–10:15)',
  JSON.stringify(slotsOf('A')) === JSON.stringify(['10:05', '10:10', '10:15', '11:00']));
ck('vacated slot 10:00 is gone (no stale head)', !SchedState.iaSchedule.Monday.A['10:00']);
ck('no hole at the new end (10:15 covered)', !!SchedState.iaSchedule.Monday.A['10:15']);
ck('unrelated grade-2 coverage untouched', SchedState.iaSchedule.Monday.A['11:00'].targetId === '2');

// 2) Cross-grade move re-targets the coverage to the destination grade.
SchedState = { iaSchedule: { Monday: { A: { '09:00': cov('1'), '09:05': cov('1') } } } };
_shiftIACoverageForMove('Monday', '1', '4', ['09:00', '09:05'], ['09:00', '09:05']);
ck('coverage re-targets to the destination grade', SchedState.iaSchedule.Monday.A['09:00'].targetId === '4');

// 3) An unrelated assignment already at the destination is NOT clobbered.
SchedState = { iaSchedule: { Monday: { A: { '10:00': cov('1'), '10:05': cov('3') } } } };
_shiftIACoverageForMove('Monday', '1', '1', ['10:00'], ['10:05']);
ck('does not clobber an existing assignment at the destination',
  SchedState.iaSchedule.Monday.A['10:05'].targetId === '3');

// 4) A block pushed off the end of the day drops the overflow rather than crashing.
SchedState = { iaSchedule: { Monday: { A: { '14:20': cov('1'), '14:25': cov('1') } } } };
moved = _shiftIACoverageForMove('Monday', '1', '1', ['14:20', '14:25'], ['14:25', null]);
ck('overflow past the end of day is dropped safely', moved === 1 && !SchedState.iaSchedule.Monday.A['14:20']);

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS');
process.exit(fail ? 1 : 0);
