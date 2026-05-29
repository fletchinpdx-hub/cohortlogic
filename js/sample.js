document.getElementById('download-sample-btn').addEventListener('click', generateSampleSpreadsheet);

function generateSampleSpreadsheet() {
  if (typeof trackEvent === 'function') trackEvent('sample_downloaded');
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

  // One set of homeroom teachers per grade (3–4 classes each)
  const homeroomTeachers = {
    'K': ['Ms. Patel',   'Mr. Thomas',  'Ms. Rivera',  'Mrs. Chen'],
    '1': ['Mrs. Johnson','Ms. Williams','Mr. Garcia',   'Ms. Kim'],
    '2': ['Mr. Davis',   'Mrs. Lopez',  'Ms. Anderson', 'Mr. Wilson'],
    '3': ['Ms. Martinez','Mrs. Brown',  'Mr. Nguyen',   'Ms. Taylor'],
    '4': ['Mrs. Harris', 'Mr. Clark',   'Ms. Robinson', 'Mr. Lewis'],
    '5': ['Ms. Walker',  'Mrs. Allen',  'Mr. Scott',    'Ms. Torres'],
  };

  const rows = [];
  let nextId = 10001; // sequential student IDs

  // ~500 students spread across 6 grades
  const perGrade = [80, 85, 82, 84, 83, 86];

  grades.forEach((grade, gi) => {
    const n        = perGrade[gi];
    const teachers = homeroomTeachers[grade];
    for (let i = 0; i < n; i++) {
      const first = firstNames[Math.floor(Math.random() * firstNames.length)];
      const last  = lastNames [Math.floor(Math.random() * lastNames.length)];

      // Assign homeroom round-robin across the grade's teachers
      const homeroom = teachers[i % teachers.length];

      // Scores: somewhat correlated (kids who are strong in one area tend to be strong in others)
      const base = 1 + Math.random() * 4;
      const mathScore    = clampScore(base + (Math.random() - 0.5) * 2);
      const readingScore = clampScore(base + (Math.random() - 0.5) * 2);
      const writingScore = clampScore(base + (Math.random() - 0.5) * 2);
      const attitudeScore = clampScore(1 + Math.random() * 4);
      const iep = Math.random() < 0.12 ? 'Yes' : 'No'; // ~12% IEP rate

      rows.push({
        'Student ID':     nextId++,
        'First Name':     first,
        'Last Name':      last,
        'Grade':          grade,
        'Homeroom':       homeroom,
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

  // Column widths: Student ID, First, Last, Grade, Homeroom, Math, Reading, Writing, Attitude, IEP
  ws['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 18 },
    { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 6 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  XLSX.writeFile(wb, 'sample-students.xlsx');
}

function clampScore(n) {
  return Math.min(5, Math.max(1, Math.round(n * 10) / 10));
}
