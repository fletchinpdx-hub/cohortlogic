document.getElementById('download-sample-btn').addEventListener('click', generateSampleSpreadsheet);

function generateSampleSpreadsheet() {
  const firstNames = ['Emma','Liam','Olivia','Noah','Ava','Elijah','Sophia','Oliver','Isabella','Lucas',
    'Mia','Mason','Charlotte','Logan','Amelia','Ethan','Harper','Aiden','Evelyn','Jackson',
    'Abigail','Sebastian','Emily','Mateo','Elizabeth','Jack','Mila','Owen','Ella','Theodore',
    'Riley','Asher','Aria','James','Luna','Leo','Penelope','Axel','Layla','Julian',
    'Chloe','Ezra','Victoria','Levi','Grace','Isaiah','Zoey','Eli','Nora','Landon'];

  const lastNames = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez',
    'Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore',
    'Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez',
    'Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen',
    'Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell'];

  const grades = ['K','1','2','3','4','5'];
  const rows   = [];

  // ~500 students spread across 6 grades
  const perGrade = [80, 85, 82, 84, 83, 86];

  grades.forEach((grade, gi) => {
    const n = perGrade[gi];
    for (let i = 0; i < n; i++) {
      const first = firstNames[Math.floor(Math.random() * firstNames.length)];
      const last  = lastNames [Math.floor(Math.random() * lastNames.length)];

      // Scores: somewhat correlated (kids who are strong in one area tend to be strong in others)
      const base = 1 + Math.random() * 4;
      const mathScore    = clampScore(base + (Math.random() - 0.5) * 2);
      const readingScore = clampScore(base + (Math.random() - 0.5) * 2);
      const writingScore = clampScore(base + (Math.random() - 0.5) * 2);
      const attitudeScore = clampScore(1 + Math.random() * 4);
      const iep = Math.random() < 0.12 ? 'Yes' : 'No'; // ~12% IEP rate

      rows.push({
        'First Name':     first,
        'Last Name':      last,
        'Grade':          grade,
        'Math Score':     mathScore,
        'Reading Score':  readingScore,
        'Writing Score':  writingScore,
        'Attitude Score': attitudeScore,
        'IEP':            iep,
      });
    }
  });

  // Shuffle rows
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 14 }, { wch: 14 }, { wch: 8 },
    { wch: 12 }, { wch: 14 }, { wch: 14 },
    { wch: 14 }, { wch: 6 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'sample-students.xlsx');
}

function clampScore(n) {
  return Math.min(5, Math.max(1, Math.round(n * 10) / 10));
}
