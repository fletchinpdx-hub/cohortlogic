// ── Excel drag & drop ──
const dropZone   = document.getElementById('drop-zone');
const fileInput  = document.getElementById('file-input');
const browseBtn  = document.getElementById('browse-btn');

browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file) return;
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    showImportStatus('Please upload an Excel file (.xlsx or .xls)', 'error');
    return;
  }
  showImportStatus('Reading file…', 'info');
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showImportStatus('The spreadsheet appears to be empty.', 'error'); return; }
      loadRawData(rows, file.name);
    } catch (err) {
      showImportStatus('Could not read the file. Make sure it is a valid Excel spreadsheet.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Google Sheets import ──
document.getElementById('sheets-import-btn').addEventListener('click', importFromSheets);

function importFromSheets() {
  const url = document.getElementById('sheets-url').value.trim();
  if (!url) { showImportStatus('Please paste a Google Sheets URL.', 'error'); return; }

  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) { showImportStatus('That doesn\'t look like a valid Google Sheets URL.', 'error'); return; }

  const id = match[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
  showImportStatus('Fetching Google Sheet…', 'info');

  fetch(exportUrl)
    .then(res => {
      if (!res.ok) throw new Error('Could not fetch sheet. Make sure it is shared as "Anyone with the link can view."');
      return res.arrayBuffer();
    })
    .then(buf => {
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showImportStatus('The sheet appears to be empty.', 'error'); return; }
      loadRawData(rows, 'Google Sheet');
    })
    .catch(err => showImportStatus(err.message, 'error'));
}

// ── Process raw import ──
function loadRawData(rows, sourceName) {
  AppState.rawRows    = rows;
  AppState.rawHeaders = Object.keys(rows[0]);
  showImportStatus(
    `✓ Loaded ${rows.length} rows from "${sourceName}". Now go to Field Mapping to configure columns.`,
    'success'
  );
  const evtName = sourceName === 'Google Sheet' ? 'import_sheets' : 'import_excel';
  if (typeof trackEvent === 'function') trackEvent(evtName, { rows: rows.length });
  // Auto-guess column mappings
  autoGuessMapping();
  // Render field mapping view immediately
  renderFieldMapping();
  updateSidebarStatus();
  navigateTo('fields');
}

// Try to auto-match common column name patterns
function autoGuessMapping() {
  const headers = AppState.rawHeaders;

  function guess(patterns) {
    for (const h of headers) {
      const hl = h.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const p of patterns) {
        if (hl.includes(p)) return h;
      }
    }
    return '';
  }

  AppState.columnMap.firstName = guess(['firstname', 'first', 'fname']);
  AppState.columnMap.lastName  = guess(['lastname', 'last', 'lname']);
  AppState.columnMap.grade     = guess(['grade', 'yr', 'year', 'level']);

  AppState.competencies.forEach(c => {
    const key = c.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    c.column = guess([key]);
  });
}
