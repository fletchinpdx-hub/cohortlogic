// ── File upload (Excel + CSV) ──
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');

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

  const isCSV   = /\.csv$/i.test(file.name);
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

  if (!isCSV && !isExcel) {
    showImportStatus('Please upload an Excel (.xlsx) or CSV (.csv) file.', 'error');
    return;
  }

  showImportStatus('Reading file…', 'info');
  const reader = new FileReader();

  reader.onload = e => {
    try {
      let wb;
      if (isCSV) {
        // SheetJS reads CSV as a string
        wb = XLSX.read(e.target.result, { type: 'string' });
      } else {
        wb = XLSX.read(e.target.result, { type: 'array' });
      }
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showImportStatus('The file appears to be empty.', 'error'); return; }
      loadRawData(rows, file.name);
    } catch (err) {
      showImportStatus('Could not read the file. Make sure it is a valid Excel or CSV file.', 'error');
      if (typeof logError === 'function') logError('class_builder', 'import_failed', err.message);
    }
  };

  if (isCSV) {
    reader.readAsText(file);
  } else {
    reader.readAsArrayBuffer(file);
  }
}

// ── Process raw import ──
function loadRawData(rows, sourceName) {
  AppState.rawRows    = rows;
  AppState.rawHeaders = Object.keys(rows[0]);
  showImportStatus(
    `✓ Loaded ${rows.length} rows from "${sourceName}". Now go to Field Mapping to configure columns.`,
    'success'
  );
  if (typeof trackEvent === 'function') trackEvent('import_excel', { rows: rows.length });
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
