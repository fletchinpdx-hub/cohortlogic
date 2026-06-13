// ── Save / Restore Session ──
// Serialises the full AppState to a .cohort JSON file so users can pick up
// where they left off without losing any students, settings, or results.

const SESSION_VERSION = 1;

const SESSION_FIELDS = [
  'rawHeaders', 'rawRows', 'columnMap', 'competencies',
  'students', 'gradeConfig', 'splitClasses',
  'separations', 'togethers', 'keepWithTeacher',
  'displayMode', 'results', 'splitResults',
];

// ── Save ──
document.getElementById('save-session-btn').addEventListener('click', saveSession);

function saveSession() {
  const payload = { _version: SESSION_VERSION };
  SESSION_FIELDS.forEach(k => { payload[k] = AppState[k]; });

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cohort-session-${new Date().toISOString().slice(0,10)}.cohort`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (typeof trackEvent === 'function') trackEvent('session_saved');
}

// ── Restore ──
document.getElementById('restore-session-btn').addEventListener('click', () => {
  document.getElementById('restore-file-input').click();
});

document.getElementById('restore-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // allow re-selecting the same file later
  loadCohortFile(file);
});

// Drag & drop on the restore drop zone
const restoreZone = document.getElementById('restore-drop-zone');
restoreZone.addEventListener('dragover', e => { e.preventDefault(); restoreZone.classList.add('drag-over'); });
restoreZone.addEventListener('dragleave', () => restoreZone.classList.remove('drag-over'));
restoreZone.addEventListener('drop', e => {
  e.preventDefault();
  restoreZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadCohortFile(file);
});

function loadCohortFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data._version) throw new Error('Not a valid .cohort file.');
      restoreSession(data);
    } catch (err) {
      alert('Could not restore session: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function restoreSession(data) {
  SESSION_FIELDS.forEach(k => {
    if (data[k] !== undefined) AppState[k] = data[k];
  });

  // Rebuild UI from restored state
  updateSidebarStatus();

  if (AppState.students.length) {
    renderStudents();
    buildGradeConfig();
  }

  if (AppState.results && Object.keys(AppState.results).length) {
    renderResults();
    navigateTo('results');
  } else if (AppState.students.length) {
    navigateTo('classes');
  }

  if (typeof trackEvent === 'function') trackEvent('session_restored');
}
