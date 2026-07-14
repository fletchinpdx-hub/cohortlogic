#!/usr/bin/env node
/*
 * Unit tests for the Class Builder balancing algorithm (js/algorithm.js).
 *
 * algorithm.js is browser code that reads a global `AppState` and a couple of
 * helpers from app.js. Rather than a test framework, we load it into a Node `vm`
 * context with a mock AppState (the same lightweight harness pattern used for the
 * referral report aggregations). Pure logic, no browser, runs in well under a second.
 *
 * These are INVARIANT tests: they assert properties that must hold for ANY input
 * (no student lost or duplicated, class sizes within ±1, constraints respected)
 * rather than exact arrangements, so they don't break when the algorithm is tuned.
 *
 * Run: node tests/algorithm.test.js   (exits 1 on any failure)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── Load algorithm.js into a sandbox with a mock AppState ──────────────────────
const algoSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'algorithm.js'), 'utf8');

// A fresh sandbox per scenario so tests never leak state into each other.
function makeSandbox(appState) {
  const sandbox = {
    AppState: appState,
    Math,
    console,
    // Minimal reimplementations of the two app.js helpers algorithm.js relies on.
    gradeOrder(g) {
      const upper = (g || '').toUpperCase();
      const map = { K: 0, TK: -1, PK: -2 };
      if (map[upper] !== undefined) return map[upper];
      const n = parseInt(g, 10);
      return isNaN(n) ? 999 : n;
    },
    getGrades() {
      const grades = [...new Set(appState.students.map(s => s.grade))];
      return grades.sort((a, b) => sandbox.gradeOrder(a) - sandbox.gradeOrder(b));
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(algoSrc, sandbox);
  return sandbox;
}

// A blank AppState with sensible defaults; override per test.
function baseState(overrides = {}) {
  return Object.assign({
    students: [],
    competencies: [],
    separations: [],
    togethers: [],
    keepWithTeacher: [],
    gradeConfig: {},
    splitClasses: [],
    results: {},
    splitResults: [],
  }, overrides);
}

// Build N students in one grade with a gender category, deterministically.
function makeStudents(grade, n, startId = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: startId + i,
      grade,
      scores: {
        Math: (i % 5) + 1,
        Gender: i % 2 === 0 ? 'F' : 'M',
      },
    });
  }
  return out;
}

const GENDER_COMP = { type: 'category', name: 'Gender', column: 'Gender', priority: true };
const MATH_COMP = { type: 'score', name: 'Math', column: 'Math', min: 1, max: 5 };

// ── Tiny assertion harness ─────────────────────────────────────────────────────
let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// Collect every student id across all result classes (regular + split).
function allPlacedIds(state) {
  const ids = [];
  Object.values(state.results).forEach(classes =>
    classes.forEach(cls => cls.forEach(s => ids.push(s.id)))
  );
  state.splitResults.forEach(sr => sr.students.forEach(s => ids.push(s.id)));
  return ids;
}

// Assert that within each grade, the largest and smallest class differ by ≤1.
function assertBalanced(state, grade) {
  const sizes = state.results[grade].map(c => c.length);
  const spread = Math.max(...sizes) - Math.min(...sizes);
  assert(spread <= 1, `grade ${grade} class sizes ${JSON.stringify(sizes)} differ by ${spread} (>1)`);
}

console.log('\nClass Builder algorithm — invariant tests');

// ── snakeDraft ─────────────────────────────────────────────────────────────────
test('snakeDraft distributes evenly with no loss or duplication', () => {
  const sb = makeSandbox(baseState({ competencies: [MATH_COMP] }));
  const students = makeStudents('3', 20);
  const classes = sb.snakeDraft(students, 3);
  const sizes = classes.map(c => c.length).sort();
  assert(JSON.stringify(sizes) === JSON.stringify([6, 7, 7]), `sizes were ${JSON.stringify(sizes)}`);
  const ids = classes.flat().map(s => s.id).sort((a, b) => a - b);
  assert(ids.length === 20, `expected 20 placements, got ${ids.length}`);
  assert(new Set(ids).size === 20, 'duplicate student detected');
});

// ── runBalancingAlgorithm: every student placed exactly once ────────────────────
test('runBalancingAlgorithm places every student exactly once', () => {
  const students = [...makeStudents('K', 18, 0), ...makeStudents('1', 22, 100)];
  const state = baseState({
    students,
    competencies: [MATH_COMP, GENDER_COMP],
    gradeConfig: { K: { classCount: 2, teachers: [] }, '1': { classCount: 3, teachers: [] } },
  });
  const sb = makeSandbox(state);
  sb.runBalancingAlgorithm();

  const placed = allPlacedIds(state).sort((a, b) => a - b);
  const expected = students.map(s => s.id).sort((a, b) => a - b);
  assert(placed.length === expected.length, `placed ${placed.length}, expected ${expected.length}`);
  assert(JSON.stringify(placed) === JSON.stringify(expected), 'placed id set != input id set');
});

// ── runBalancingAlgorithm: class sizes balanced within each grade ───────────────
test('runBalancingAlgorithm keeps class sizes within ±1 per grade', () => {
  const students = [...makeStudents('2', 27, 0)];
  const state = baseState({
    students,
    competencies: [MATH_COMP, GENDER_COMP],
    gradeConfig: { '2': { classCount: 3, teachers: [] } },
  });
  const sb = makeSandbox(state);
  sb.runBalancingAlgorithm();
  assertBalanced(state, '2'); // 27 / 3 → 9,9,9
});

// ── Separations respected ────────────────────────────────────────────────────────
test('fixSeparations keeps a keep-apart pair in different classes', () => {
  const students = makeStudents('3', 12, 0);
  const state = baseState({
    students,
    competencies: [MATH_COMP],
    separations: [{ a: 0, b: 1 }],
    gradeConfig: { '3': { classCount: 2, teachers: [] } },
  });
  const sb = makeSandbox(state);
  sb.runBalancingAlgorithm();
  const classes = state.results['3'];
  const classOf = id => classes.findIndex(cls => cls.some(s => s.id === id));
  assert(classOf(0) !== classOf(1), 'students 0 and 1 landed in the same class');
});

// ── Togethers respected ──────────────────────────────────────────────────────────
test('fixTogethers keeps a keep-together pair in the same class', () => {
  const students = makeStudents('3', 12, 0);
  const state = baseState({
    students,
    competencies: [MATH_COMP],
    togethers: [{ a: 0, b: 11 }],
    gradeConfig: { '3': { classCount: 2, teachers: [] } },
  });
  const sb = makeSandbox(state);
  sb.runBalancingAlgorithm();
  const classes = state.results['3'];
  const classOf = id => classes.findIndex(cls => cls.some(s => s.id === id));
  assert(classOf(0) === classOf(11), 'students 0 and 11 landed in different classes');
});

// ── Keep-with-teacher pin honored, sizes still balanced ─────────────────────────
test('keepWithTeacher pins the student to its target class without breaking balance', () => {
  const students = makeStudents('4', 20, 0);
  const state = baseState({
    students,
    competencies: [MATH_COMP],
    keepWithTeacher: [{ studentId: 7, grade: '4', classIndex: 1 }],
    gradeConfig: { '4': { classCount: 2, teachers: [] } },
  });
  const sb = makeSandbox(state);
  sb.runBalancingAlgorithm();
  const classes = state.results['4'];
  assert(classes[1].some(s => s.id === 7), 'pinned student 7 is not in class index 1');
  assertBalanced(state, '4'); // 20 / 2 → 10,10
});

// ── balanceCategories never loses a student ─────────────────────────────────────
test('balanceCategories preserves every student while improving balance', () => {
  const state = baseState({ competencies: [GENDER_COMP], separations: [], togethers: [] });
  const sb = makeSandbox(state);
  // Two lopsided classes: all F in one, all M in the other.
  const classA = makeStudents('5', 6, 0).map(s => ({ ...s, scores: { Gender: 'F' } }));
  const classB = makeStudents('5', 6, 100).map(s => ({ ...s, scores: { Gender: 'M' } }));
  const classes = [classA, classB];
  const before = Math.abs(classA.filter(s => s.scores.Gender === 'F').length -
                          classB.filter(s => s.scores.Gender === 'F').length);
  sb.balanceCategories(classes);
  const idsAfter = classes.flat().map(s => s.id).sort((a, b) => a - b);
  assert(idsAfter.length === 12 && new Set(idsAfter).size === 12, 'student lost or duplicated');
  const after = Math.abs(classes[0].filter(s => s.scores.Gender === 'F').length -
                         classes[1].filter(s => s.scores.Gender === 'F').length);
  assert(after < before, `balance did not improve (before ${before}, after ${after})`);
  assert(classes[0].length === 6 && classes[1].length === 6, 'class sizes changed during balancing');
});

// ── Report ───────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
