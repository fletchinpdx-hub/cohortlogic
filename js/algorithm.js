function runBalancingAlgorithm() {
  const grades = getGrades();
  AppState.results     = {};
  AppState.splitResults = [];

  // Build per-grade student pools
  const pools = {};
  grades.forEach(g => { pools[g] = AppState.students.filter(s => s.grade === g); });

  // ── Handle split classes first ──
  // Group by grade pair so we calculate target size ONCE per pair
  // using original pool sizes — not shrinking pools mid-loop
  const pairMap = {};
  AppState.splitClasses.forEach(sc => {
    const key = sc.grades.slice().sort().join('|');
    if (!pairMap[key]) pairMap[key] = { grades: sc.grades, splits: [] };
    pairMap[key].splits.push(sc);
  });

  Object.values(pairMap).forEach(({ grades: [gA, gB], splits }) => {
    const origA = pools[gA] || [];
    const origB = pools[gB] || [];
    if (!origA.length && !origB.length) return;

    // Calculate target size ONCE using full original pools
    const cfgA        = AppState.gradeConfig[gA] || { classCount: 1 };
    const cfgB        = AppState.gradeConfig[gB] || { classCount: 1 };
    const totalStudents = origA.length + origB.length;
    const totalClasses  = cfgA.classCount + cfgB.classCount + splits.length;
    const targetSize    = Math.round(totalStudents / Math.max(totalClasses, 1));
    const halfSize      = Math.round(targetSize / 2);

    // Sort pools once; track which students have been assigned
    const sortedA  = sortByComposite(origA);
    const sortedB  = sortByComposite(origB);
    const usedA    = new Set();
    const usedB    = new Set();

    splits.forEach(sc => {
      const availA = sortedA.filter(s => !usedA.has(s.id));
      const availB = sortedB.filter(s => !usedB.has(s.id));

      const takeA = pickDistributed(availA, Math.min(halfSize, availA.length));
      const takeB = pickDistributed(availB, Math.min(halfSize, availB.length));

      takeA.forEach(s => usedA.add(s.id));
      takeB.forEach(s => usedB.add(s.id));

      const splitStudents = snakeDraft([...takeA, ...takeB], 1)[0] || [];
      fixSeparations([splitStudents]);
      fixTogethers([splitStudents]);

      AppState.splitResults.push({
        id:      sc.id,
        grades:  sc.grades,
        teacher: sc.teacher,
        students: splitStudents,
      });
    });

    // Remove all assigned students from the grade pools
    pools[gA] = origA.filter(s => !usedA.has(s.id));
    pools[gB] = origB.filter(s => !usedB.has(s.id));
  });

  // ── Regular per-grade balancing ──
  grades.forEach(g => {
    const cfg      = AppState.gradeConfig[g] || { classCount: 1, teachers: [] };
    const students = pools[g] || [];
    if (cfg.classCount > 0) {
      AppState.results[g] = balanceGrade(students, cfg.classCount, g);
    }
  });
}

// ── Composite score (normalized 0–1 across any range) ──
function computeComposite(s) {
  let weightedSum = 0, totalWeight = 0;
  AppState.competencies
    .filter(c => c.type === 'score' && c.name && c.column)
    .forEach(c => {
      const v = s.scores[c.name];
      if (v === null || v === undefined) return;
      const min = c.min ?? 1;
      const max = c.max ?? 5;
      if (max <= min) return;
      const norm = (v - min) / (max - min);
      const normalized = (c.direction === 'desc') ? 1 - norm : norm;
      const weight = c.priority ? 3 : 1;
      weightedSum += normalized * weight;
      totalWeight += weight;
    });
  return totalWeight ? weightedSum / totalWeight : 0.5;
}

// When true, adds small random jitter so regenerate produces different arrangements
let _balanceWithVariation = false;

function sortByComposite(students) {
  return students
    .map(s => {
      const base = computeComposite(s);
      // Jitter is ±7.5% of the 0–1 scale — enough to shuffle similar students
      // but not enough to move a strong student below a weak one
      const jitter = _balanceWithVariation ? (Math.random() - 0.5) * 0.15 : 0;
      return { ...s, _composite: base + jitter };
    })
    .sort((a, b) => b._composite - a._composite);
}

// Pick `count` students distributed evenly across a sorted list
function pickDistributed(sorted, count) {
  if (count >= sorted.length) return [...sorted];
  const result = [];
  const step = sorted.length / count;
  for (let i = 0; i < count; i++) {
    result.push(sorted[Math.min(Math.floor(i * step + step / 2), sorted.length - 1)]);
  }
  return result;
}

// ── Snake-draft distribution ──
function snakeDraft(students, classCount) {
  const sorted  = sortByComposite(students);
  const classes = Array.from({ length: classCount }, () => []);
  let dir = 1, col = 0;
  for (const s of sorted) {
    classes[col].push(s);
    col += dir;
    if (col >= classCount) { col = classCount - 1; dir = -1; }
    else if (col < 0)      { col = 0;              dir =  1; }
  }
  return classes;
}

function balanceGrade(students, classCount, grade) {
  if (!classCount || classCount < 1) classCount = 1;

  // Pre-extract students pinned to a specific class (Keep with Teacher)
  const pins      = (AppState.keepWithTeacher || []).filter(k => k.grade === grade);
  const pinnedIds = new Set(pins.map(k => k.studentId));
  const unpinned  = students.filter(s => !pinnedIds.has(s.id));

  const classes = snakeDraft(unpinned, classCount);

  // Insert each pinned student into their designated class
  pins.forEach(k => {
    const student = students.find(s => s.id === k.studentId);
    if (!student) return;
    const targetIdx = Math.min(k.classIndex, classCount - 1);
    classes[targetIdx].push(student);
  });

  fixSeparations(classes);
  fixTogethers(classes);
  balanceCategories(classes);
  return classes;
}

// ── Separation constraint fixing ──
function fixSeparations(classes) {
  for (let pass = 0; pass < 10; pass++) {
    let anyViolation = false;
    for (const pair of AppState.separations) {
      let classA = -1, classB = -1, idxB = -1;
      classes.forEach((cls, ci) => {
        cls.forEach((s, si) => {
          if (s.id === pair.a) classA = ci;
          if (s.id === pair.b) { classB = ci; idxB = si; }
        });
      });
      if (classA === -1 || classB === -1 || classA !== classB) continue;
      anyViolation = true;
      let swapped = false;
      for (let ci = 0; ci < classes.length && !swapped; ci++) {
        if (ci === classA) continue;
        for (let si = 0; si < classes[ci].length && !swapped; si++) {
          const candidate = classes[ci][si];
          const wouldViolate = AppState.separations.some(p => {
            const other = p.a === pair.b ? p.b : p.b === pair.b ? p.a : null;
            return other && classes[ci].some(s => s.id === other);
          });
          if (!wouldViolate) {
            const tmp = classes[classA][idxB];
            classes[classA][idxB] = classes[ci][si];
            classes[ci][si] = tmp;
            swapped = true;
          }
        }
      }
    }
    if (!anyViolation) break;
  }
}

// ── Together constraint fixing ──
function fixTogethers(classes) {
  for (let pass = 0; pass < 10; pass++) {
    let anyViolation = false;
    for (const pair of AppState.togethers) {
      let classA = -1, classB = -1, idxB = -1;
      classes.forEach((cls, ci) => {
        cls.forEach((s, si) => {
          if (s.id === pair.a) classA = ci;
          if (s.id === pair.b) { classB = ci; idxB = si; }
        });
      });
      if (classA === -1 || classB === -1 || classA === classB) continue;
      anyViolation = true;

      // Try to move B into classA by swapping B with someone in classA (not A itself)
      let swapped = false;
      for (let si = 0; si < classes[classA].length && !swapped; si++) {
        const candidate = classes[classA][si];
        if (candidate.id === pair.a) continue;

        // Would B landing in classA violate any separation?
        const bViolatesInA = AppState.separations.some(p => {
          const other = p.a === pair.b ? p.b : p.b === pair.b ? p.a : null;
          return other && classes[classA].some((s, i) => i !== si && s.id === other);
        });
        if (bViolatesInA) continue;

        // Would candidate landing in classB violate any separation?
        const cViolatesInB = AppState.separations.some(p => {
          const other = p.a === candidate.id ? p.b : p.b === candidate.id ? p.a : null;
          return other && classes[classB].some((s, i) => i !== idxB && s.id === other);
        });
        if (cViolatesInB) continue;

        // Safe — swap B and candidate
        classes[classA][si]  = classes[classB][idxB];
        classes[classB][idxB] = candidate;
        swapped = true;
      }
    }
    if (!anyViolation) break;
  }
}

// ── Category balancing ──
// For each pair of classes, keeps swapping until that pair is fully
// optimized before moving to the next pair. Outer passes repeat until
// no pair needs further adjustment (handles cross-pair interactions).
function balanceCategories(classes) {
  const catComps = AppState.competencies.filter(c => c.type === 'category' && c.name && c.column);
  if (!catComps.length || classes.length < 2) return;

  const getCounts = (cls, name) => {
    const counts = {};
    cls.forEach(s => { const v = s.scores[name]; if (v) counts[v] = (counts[v] || 0) + 1; });
    return counts;
  };

  // Fully drain all improvements between a single pair of classes.
  // Returns true if at least one swap was made.
  const drainPair = (ci, cj, name) => {
    let anySwap = false;
    let pairImproved = true;
    while (pairImproved) {
      pairImproved = false;
      const cI = getCounts(classes[ci], name);
      const cJ = getCounts(classes[cj], name);
      let bestDelta = 0, bestSi = -1, bestSj = -1;
      for (let si = 0; si < classes[ci].length; si++) {
        for (let sj = 0; sj < classes[cj].length; sj++) {
          const catI = classes[ci][si].scores[name];
          const catJ = classes[cj][sj].scores[name];
          if (!catI || !catJ || catI === catJ) continue;
          const before = Math.abs((cI[catI]||0) - (cJ[catI]||0)) + Math.abs((cI[catJ]||0) - (cJ[catJ]||0));
          const nI = { ...cI }; nI[catI]--; nI[catJ] = (nI[catJ]||0) + 1;
          const nJ = { ...cJ }; nJ[catJ]--; nJ[catI] = (nJ[catI]||0) + 1;
          const after = Math.abs((nI[catI]||0) - (nJ[catI]||0)) + Math.abs((nI[catJ]||0) - (nJ[catJ]||0));
          const delta = before - after;
          if (delta > bestDelta) { bestDelta = delta; bestSi = si; bestSj = sj; }
        }
      }
      if (bestSi >= 0) {
        const tmp = classes[ci][bestSi];
        classes[ci][bestSi] = classes[cj][bestSj];
        classes[cj][bestSj] = tmp;
        pairImproved = true;
        anySwap = true;
      }
    }
    return anySwap;
  };

  const priorityCats = catComps.filter(c => c.priority);
  const regularCats  = catComps.filter(c => !c.priority);

  // Priority categories get dedicated passes first so they are never sacrificed
  // for lower-priority fields (e.g. gender and behavior are locked in before
  // ethnicity swaps can disturb them).
  const runPasses = (comps, maxPasses) => {
    for (let pass = 0; pass < maxPasses; pass++) {
      let improved = false;
      for (const comp of comps) {
        for (let ci = 0; ci < classes.length - 1; ci++) {
          for (let cj = ci + 1; cj < classes.length; cj++) {
            if (drainPair(ci, cj, comp.name)) improved = true;
          }
        }
      }
      if (!improved) break;
    }
  };

  runPasses(priorityCats, 30);
  runPasses(regularCats, 30);
}

// ── Class averages (scores) + category distributions ──
function classAverages(cls) {
  const avgs = {};
  AppState.competencies.filter(c => c.name && c.column).forEach(c => {
    if (c.type === 'score') {
      const vals = cls.map(s => s.scores[c.name]).filter(v => v != null);
      avgs[c.name] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
    } else if (c.type === 'category') {
      const counts = {};
      cls.forEach(s => { const v = s.scores[c.name]; if (v) counts[v] = (counts[v]||0) + 1; });
      avgs[c.name] = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' ') || '—';
    } else if (c.type === 'flag') {
      const yesCount = cls.filter(s => s.scores[c.name] === true).length;
      avgs[c.name] = `${yesCount}`;
    }
  });
  return avgs;
}
