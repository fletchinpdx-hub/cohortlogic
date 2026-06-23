/**
 * checkin-history.js
 * History view: browse, filter, and display past check-in records.
 */

// ── Initialize History View ────────────────────────────────────────────────
function initHistoryView() {
  populateHistoryStudentFilter();
  setDefaultHistoryDates();
}

function setDefaultHistoryDates() {
  const toEl   = document.getElementById('history-to');
  const fromEl = document.getElementById('history-from');
  const today  = todayISO();
  toEl.value   = today;

  // Default: last 30 days
  const d = new Date();
  d.setDate(d.getDate() - 30);
  fromEl.value = d.toISOString().split('T')[0];
}

function populateHistoryStudentFilter() {
  const sel = document.getElementById('history-student-filter');
  sel.innerHTML = '<option value="">All Students</option>' +
    CicoState.students
      .map(s => `<option value="${s.id}">${escHtml(s.last_name)}, ${escHtml(s.first_name)}</option>`)
      .join('');
}

// ── Load & Render History ──────────────────────────────────────────────────
async function loadHistory() {
  const container = document.getElementById('history-results');
  const studentId = document.getElementById('history-student-filter').value;
  const from      = document.getElementById('history-from').value;
  const to        = document.getElementById('history-to').value;

  container.innerHTML = '<p class="empty-state">Loading…</p>';

  try {
    let query = SupabaseClient
      .from('cico_checkins')
      .select(`
        id,
        check_in_date,
        notes,
        student_id,
        student:students ( first_name, last_name, grade, homeroom ),
        cico_period_scores ( period_number, category_id, score ),
        cico_incidents ( period_number, incident_type_id, minutes, notes,
          cico_incident_types ( abbreviation, description ) )
      `)
      .order('check_in_date', { ascending: false })
      .limit(100);

    if (studentId) query = query.eq('student_id', studentId);
    if (from)      query = query.gte('check_in_date', from);
    if (to)        query = query.lte('check_in_date', to);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || !data.length) {
      container.innerHTML = '<p class="empty-state">No check-ins found for the selected filters.</p>';
      return;
    }

    container.innerHTML = data.map(checkin => renderCheckinCard(checkin)).join('');

  } catch (err) {
    console.error('History load error:', err);
    container.innerHTML = '<p class="empty-state" style="color:var(--ci-red);">Failed to load history. Please try again.</p>';
  }
}

// ── Render a single check-in card ──────────────────────────────────────────
function renderCheckinCard(checkin) {
  const student  = checkin.student;
  const name     = student ? `${student.first_name} ${student.last_name}` : 'Unknown Student';
  const meta     = student ? [student.grade ? 'Grade ' + student.grade : '', student.homeroom].filter(Boolean).join(' · ') : '';
  const dateStr  = formatDate(checkin.check_in_date);

  // Group scores by period
  const scoresByPeriod = {};
  (checkin.cico_period_scores || []).forEach(ps => {
    if (!scoresByPeriod[ps.period_number]) scoresByPeriod[ps.period_number] = [];
    scoresByPeriod[ps.period_number].push(ps);
  });

  // Group incidents by period
  const incidentsByPeriod = {};
  (checkin.cico_incidents || []).forEach(inc => {
    if (!incidentsByPeriod[inc.period_number]) incidentsByPeriod[inc.period_number] = [];
    incidentsByPeriod[inc.period_number].push(inc);
  });

  // Build period cells
  const periodCount = CicoState.settings.period_count || 8;
  let periodCells = '';
  for (let p = 1; p <= periodCount; p++) {
    const scores   = scoresByPeriod[p] || [];
    const incidents = incidentsByPeriod[p] || [];

    let badgesHtml = '';
    CicoState.categories.forEach(cat => {
      const hit   = scores.find(s => s.category_id === cat.id);
      const score = hit ? hit.score : null;
      const cls   = score !== null ? `score-badge-${score}` : 'score-badge-null';
      const lbl   = score !== null ? score : '—';
      badgesHtml += `<span class="score-badge ${cls}" title="${escHtml(cat.name)}">${lbl}</span>`;
    });

    let incHtml = '';
    if (incidents.length) {
      incHtml = `<div class="history-incidents" style="margin-top:4px;">` +
        incidents.map(inc => {
          const abbr = inc.cico_incident_types?.abbreviation || '?';
          const mins = inc.minutes ? ` ${inc.minutes}m` : '';
          return `<span class="incident-chip" title="${escHtml(inc.cico_incident_types?.description || '')}">${escHtml(abbr)}${mins}</span>`;
        }).join('') + `</div>`;
    }

    periodCells += `
      <div class="history-period-cell">
        <div class="history-period-label">P${p}</div>
        <div class="history-score-badges">${badgesHtml}</div>
        ${incHtml}
      </div>`;
  }

  // Totals
  const allScores = checkin.cico_period_scores || [];
  const scored    = allScores.filter(s => s.score !== null);
  const total     = scored.reduce((acc, s) => acc + s.score, 0);
  const maxPossible = scored.length * 2;
  const pct = maxPossible > 0 ? Math.round((total / maxPossible) * 100) : null;

  let pctBadge = '';
  if (pct !== null) {
    const cls = pct >= 80 ? 'score-total-good' : pct >= 50 ? 'score-total-ok' : 'score-total-low';
    pctBadge = `<span class="period-score-total ${cls}" style="margin-left:8px;">${pct}%</span>`;
  }

  const totalIncidents = (checkin.cico_incidents || []).length;
  const incidentBadge = totalIncidents
    ? `<span style="font-size:12px;color:var(--ci-red);margin-left:8px;">⚠ ${totalIncidents} incident${totalIncidents > 1 ? 's' : ''}</span>`
    : '';

  const notesHtml = checkin.notes
    ? `<div class="checkin-card-notes">"${escHtml(checkin.notes)}"</div>` : '';

  return `
    <div class="checkin-card">
      <div class="checkin-card-header">
        <div>
          <div class="checkin-card-name">${escHtml(name)}${pctBadge}${incidentBadge}</div>
          <div class="checkin-card-meta">${escHtml(meta)}</div>
        </div>
        <div class="checkin-card-date">${escHtml(dateStr)}</div>
      </div>
      <div class="history-score-grid">${periodCells}</div>
      ${notesHtml}
    </div>`;
}
