function runBalancingAlgorithm() {
  const grades = getGrades();
  AppState.results = {};

  grades.forEach(g => {
    const cfg      = AppState.gradeConfig[g] || { classCount: 1, teachers: [] };
    const students = AppState.students.filter(s => s.grade === g);
    AppState.results[g] = balanceGrade(students, cfg.classCount);
  });
}

function balanceGrade(students, classCount) {
  if (!classCount || classCount < 1) classCount = 1;

  // Compute composite score for each student (average of all score-type competencies)
  const scored = students.map(s => {
    const scores = AppState.competencies
      .filter(c => c.type === 'score' && c.name && c.column)
      .map(c => s.scores[c.name])
      .filter(v => v !== null && v !== undefined);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 2.5;
    return { ...s, _composite: avg };
  });

  // Sort by composite descending
  scored.sort((a, b) => b._composite - a._composite);

  // Snake-draft distribution: fill classes in zigzag order for even distribution
  const classes = Array.from({ length: classCount }, () => []);
  let direction = 1;
  let col = 0;

  for (const student of scored) {
    classes[col].push(student);
    col += direction;
    if (col >= classCount) { col = classCount - 1; direction = -1; }
    else if (col < 0)      { col = 0;              direction =  1; }
  }

  // Fix separation constraints
  fixSeparations(classes);

  return classes;
}

function fixSeparations(classes) {
  const maxPasses = 10;

  for (let pass = 0; pass < maxPasses; pass++) {
    let anyViolation = false;

    for (const pair of AppState.separations) {
      // Find which classes each student is in
      let classA = -1, classB = -1, idxA = -1, idxB = -1;

      classes.forEach((cls, ci) => {
        cls.forEach((s, si) => {
          if (s.id === pair.a) { classA = ci; idxA = si; }
          if (s.id === pair.b) { classB = ci; idxB = si; }
        });
      });

      if (classA === -1 || classB === -1 || classA !== classB) continue;

      // Violation — try to swap student B with someone in another class
      anyViolation = true;
      let swapped = false;

      for (let ci = 0; ci < classes.length; ci++) {
        if (ci === classA) continue;
        for (let si = 0; si < classes[ci].length; si++) {
          const candidate = classes[ci][si];
          // Check this swap doesn't create a new violation
          const wouldViolate = AppState.separations.some(p => {
            const otherId = (p.a === pair.b ? p.b : p.a === pair.b ? p.b : null);
            if (!otherId) return false;
            return classes[ci].some(s => s.id === otherId);
          });
          if (!wouldViolate) {
            // Swap
            classes[classA][idxB] = candidate;
            classes[ci][si]       = classes[classA][idxB];
            classes[classA][idxB] = candidate;
            // More precisely:
            const tmp = classes[classA][idxB];
            classes[classA][idxB] = classes[ci][si];
            classes[ci][si] = tmp;
            swapped = true;
            break;
          }
        }
        if (swapped) break;
      }
    }

    if (!anyViolation) break;
  }
}

// Compute per-competency average for a class
function classAverages(cls) {
  const avgs = {};
  AppState.competencies
    .filter(c => c.type === 'score' && c.name && c.column)
    .forEach(c => {
      const vals = cls.map(s => s.scores[c.name]).filter(v => v != null);
      avgs[c.name] = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
    });
  return avgs;
}
