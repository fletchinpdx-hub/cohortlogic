// Node harness for loadScheduleFromFile()'s cross-product import rules.
//
// WHY THIS EXISTS — a real data-loss bug found by QA on 2026-07-23:
//   `if (data.staff) SchedState.staff = data.staff;`
// `[]` is TRUTHY in JS, and a Class Builder .cohortlogic file always carries
// `staff: []` (CB has no staff concept). So loading a CB file into Schedule
// Builder replaced a populated staff roster with an empty array — silently
// destroying names, roles, hours, and IA config on a workflow we actively
// promote ("this travels with your saved file so it can be shared with
// Schedule Builder"). Verified live: seeded SB with 1 teacher, loaded a real
// CB file, roster became [] and persisted to localStorage.
//
// The guard is now `data.staff && data.staff.length`. These tests pin BOTH
// directions so a future refactor can't quietly reintroduce it:
//   - an empty staff array must NOT clobber an existing roster
//   - a populated staff array must STILL import (don't over-correct)
//
// Run: node tests/cross-product-load.test.js   (exits 1 on any failure)

const fs = require('fs');
const FILE = '/Users/michaelfletcher/dev/cohortlogic/public/js/schedule-state.js';

// ── Pull just loadScheduleFromFile out of the bundle file ─────────────────────
const src = fs.readFileSync(FILE, 'utf8');
const start = src.indexOf('function loadScheduleFromFile');
if (start === -1) {
  console.error('✗ could not find loadScheduleFromFile in schedule-state.js — did it move or get renamed?');
  process.exit(1);
}
// End at the next top-level function declaration after it.
const rest = src.slice(start + 1);
const nextFn = rest.indexOf('\nfunction ');
const fnSrc = nextFn === -1 ? src.slice(start) : src.slice(start, start + 1 + nextFn);

// ── Environment the function expects (normally other files in the bundle) ─────
let SchedState;
const _migrateToCohortLogic = raw => raw;   // files here are already unified shape
const _normalizeIAStaff = () => {};
const DEFAULT_BLOCK_TYPES = [];
const ensureFixedBlockTypes = () => {};
const migrateBandIds = () => {};
const migrateSubBlockMinutes = () => {};
const saveToLocal = () => {};
const localStorage = { setItem() {}, getItem() { return null; } };

// Minimal FileReader that immediately delivers the text it was constructed over.
class FileReader {
  readAsText(file) { this.onload({ target: { result: file._text } }); }
}
const fakeFile = obj => ({ _text: JSON.stringify(obj) });

eval(fnSrc);

// ── Fixtures ──────────────────────────────────────────────────────────────────
// A populated Schedule Builder: real roster + a real master schedule.
function seededSB() {
  return {
    school: { name: 'SB Original School', grades: ['1', '2'] },
    staff: [
      { id: 'sb_t1', name: 'SB Teacher One', role: 'classroom_teacher', gradeAssignment: '1' },
      { id: 'sb_ia1', name: 'SB Aide One', role: 'ia', startTime: '07:30', endTime: '15:00' },
    ],
    blockTypes: [{ id: 'bt_ela', required: true }],
    masterSchedule: { Monday: { '1': { '08:00': 'bt_mm', '08:05': 'bt_mm' } }, Tuesday: { '1': { '09:00': 'bt_lunch' } } },
    conflicts: {}, specialsSchedule: {}, iaAllocations: [], iaCoverage: [], iaSchedule: {}, duties: [],
    _tools: ['schedule_builder'],
  };
}

// Exactly what Class Builder writes: no SB tool, empty staff, empty blockTypes.
const cbFile = {
  _version: 1, _product: 'cohort_logic', _tools: ['class_builder'],
  school: { name: 'QA Handoff School', grades: ['1', 'K'] },
  staff: [],
  blockTypes: [],
  schedule: { masterSchedule: {}, conflicts: {}, specialsSchedule: {}, iaAllocations: [], iaSchedule: {} },
  classes: { students: [{ id: 0 }], rawRows: [], columnMap: {}, competencies: [] },
};

// ── Tiny assertion harness ────────────────────────────────────────────────────
// Tests are async (loadScheduleFromFile returns a Promise) AND share one mutable
// SchedState, so they must run SEQUENTIALLY — collect them, then await in order.
// (Running them fire-and-forget lets a later test's mutation race an earlier
// test's assertion, which produced a bogus failure the first time around.)
let passed = 0; const failures = []; const queue = [];
function test(name, fn) { queue.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ── THE REGRESSION ────────────────────────────────────────────────────────────
test('CB file (staff:[]) does NOT wipe an existing Schedule Builder roster', async () => {
  SchedState = seededSB();
  const before = SchedState.staff.length;
  return loadScheduleFromFile(fakeFile(cbFile)).then(() => {
    assert(before === 2, 'fixture should start with 2 staff');
    assert(SchedState.staff.length === 2,
      `staff roster was clobbered: ${before} → ${SchedState.staff.length} (empty array overwrote it)`);
    assert(SchedState.staff.some(s => s.name === 'SB Teacher One'), 'original teacher missing after load');
    assert(SchedState.staff.some(s => s.role === 'ia'), 'original IA missing after load');
  });
});

test('CB file still imports the school profile (the point of the handoff)', async () =>
  loadScheduleFromFile(fakeFile(cbFile)).then(() => {
    assert(SchedState.school.name === 'QA Handoff School',
      `school name should be imported, got ${SchedState.school.name}`);
  }));

test('CB file leaves the Schedule Builder master schedule intact', async () => {
  SchedState = seededSB();
  return loadScheduleFromFile(fakeFile(cbFile)).then(() => {
    const days = Object.keys(SchedState.masterSchedule);
    assert(days.includes('Monday') && days.includes('Tuesday'),
      `masterSchedule days lost: ${JSON.stringify(days)}`);
    assert(Object.keys(SchedState.masterSchedule.Monday['1']).length === 2,
      'Monday slots were altered by a cross-product import');
  });
});

// ── Don't over-correct: real staff must still import ──────────────────────────
test('a file WITH staff still imports it (fix does not block legitimate imports)', async () => {
  SchedState = seededSB();
  const withStaff = Object.assign({}, cbFile, {
    staff: [{ id: 'new1', name: 'Imported Teacher', role: 'classroom_teacher' }],
  });
  return loadScheduleFromFile(fakeFile(withStaff)).then(() => {
    assert(SchedState.staff.length === 1, `expected the imported roster, got ${SchedState.staff.length}`);
    assert(SchedState.staff[0].name === 'Imported Teacher', 'imported staff not applied');
  });
});

// ── A genuine SB file must still replace SB data ──────────────────────────────
test('a real Schedule Builder file still replaces the schedule', async () => {
  SchedState = seededSB();
  const sbFile = {
    _version: 1, _product: 'cohort_logic', _tools: ['schedule_builder'],
    school: { name: 'Other School' },
    staff: [{ id: 'x', name: 'Other Teacher', role: 'classroom_teacher' }],
    blockTypes: [{ id: 'bt_math', required: true }],
    schedule: { masterSchedule: { Friday: { '3': { '10:00': 'bt_math' } } } },
  };
  return loadScheduleFromFile(fakeFile(sbFile)).then(() => {
    assert(Object.keys(SchedState.masterSchedule).includes('Friday'),
      'SB file should replace masterSchedule');
    assert(SchedState.staff[0].name === 'Other Teacher', 'SB file should import its staff');
  });
});

// ── Run sequentially, then report ─────────────────────────────────────────────
(async () => {
  console.log('\nCross-product .cohortlogic load — import rules');
  for (const { name, fn } of queue) {
    try { await fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failures.push({ name, message: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
    process.exit(1);
  }
})();
