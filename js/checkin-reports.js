/**
 * checkin-reports.js
 * Reports view: student trend chart + incident summary table.
 * Requires Chart.js loaded in the HTML.
 */

let _trendChart = null;  // Chart.js instance, destroyed on re-render

// ── Initialize Reports View ────────────────────────────────────────────────
function initReportsView() {
  populateReportStudentSelect();
  setDefaultReportDates();
  renderReports();
}

function populateReportStudentSelect() {
  const sel = document.getElementById('report-student-sel');
  sel.innerHTML = '<option value="">— Select a student —</option>' +
    CicoState.students.map(s =>
      `<option value="${s.id}">${escHtml(s.last_name)}, ${escHtml(s.first_name)}</option>`
    ).join('');
}

function setDefaultReportDates() {
  const today = todayISO();
  document.getElementById('report-to').value = today;
  const d = new Date();
  d.setDate(d.getDate() - 30);
  document.getElementById('report-from').value = d.toISOString().split('T')[0];
}

// ── Main render ────────────────────────────────────────────────────────────
async function renderReports() {
  const body      = document.getElementById('reports-body');
  const studentId = document.getElementById('report-student-sel').value;
  const from      = document.getElementById('report-from').value;
  const to        = document.getElementById('report-to').value;

  if (!studentId) {
    body.innerHTML = '<p class="empty-state">Select a student to view their report.</p>';
    return;
  }

  const student = CicoState.students.find(s => s.id === studentId);
  if (!student) return;

  body.innerHTML = '<p class="empty-state">Loading…</p>';
  destroyChart();

  try {
    let query = SupabaseClient
      .from('cico_checkins')
      .select(`
        id,
        check_in_date,
        cico_period_scores ( period_number, category_id, score ),
        cico_incidents ( period_number, incident_type_id, minutes,
          cico_incident_types ( abbreviation ) )
      `)
      .eq('student_id', studentId)
      .order('check_in_date');

    if (from) query = query.gte('check_in_date', from);
    if (to)   query = query.lte('check_in_date', to);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || !data.length) {
      body.innerHTML = `<p class="empty-state">No check-ins found for ${escHtml(student.first_name)} in this date range.</p>`;
      return;
    }

    body.innerHTML = buildReportHTML(student, data);

    // Render chart after DOM is ready
    renderTrendChart(data);

  } catch (err) {
    console.error('Report error:', err);
    body.innerHTML = '<p class="empty-state" style="color:var(--ci-red);">Failed to load report.</p>';
  }
}

// ── Build report HTML ──────────────────────────────────────────────────────
function buildReportHTML(student, checkins) {
  const name = `${student.first_name} ${student.last_name}`;

  // Aggregate stats
  let totalScore = 0, totalPossible = 0, totalIncidents = 0, totalMinutes = 0;
  const incidentCounts = {};  // typeId → { abbr, count, minutes }

  checkins.forEach(ci => {
    const scores = ci.cico_period_scores || [];
    scores.forEach(ps => {
      if (ps.score !== null) {
        totalScore    += ps.score;
        totalPossible += 2;
      }
    });
    const incidents = ci.cico_incidents || [];
    incidents.forEach(inc => {
      totalIncidents++;
      if (inc.minutes) totalMinutes += inc.minutes;
      const abbr = inc.cico_incident_types?.abbreviation || 'Unknown';
      if (!incidentCounts[inc.incident_type_id]) {
        incidentCounts[inc.incident_type_id] = { abbr, count: 0, minutes: 0 };
      }
      incidentCounts[inc.incident_type_id].count++;
      if (inc.minutes) incidentCounts[inc.incident_type_id].minutes += inc.minutes;
    });
  });

  const overallPct = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null;

  // Stat cards
  const pctDisplay = overallPct !== null ? `${overallPct}%` : '—';
  const pctColor   = overallPct === null ? 'var(--ci-text-2)'
                   : overallPct >= 80 ? '#15803d'
                   : overallPct >= 50 ? '#b45309' : '#b91c1c';

  // Incident summary table
  const incidentRows = Object.values(incidentCounts)
    .sort((a,b) => b.count - a.count)
    .map(i => `
      <tr>
        <td><strong>${escHtml(i.abbr)}</strong></td>
        <td>${i.count}</td>
        <td>${i.minutes || 0}</td>
        <td>${i.count > 0 ? Math.round(i.minutes / i.count) : 0}</td>
      </tr>
    `).join('');

  return `
    <div class="report-section">
      <h3>${escHtml(name)} — Summary</h3>
      <div class="report-stat-row">
        <div class="report-stat">
          <div class="report-stat-value">${checkins.length}</div>
          <div class="report-stat-label">Check-ins</div>
        </div>
        <div class="report-stat">
          <div class="report-stat-value" style="color:${pctColor};">${pctDisplay}</div>
          <div class="report-stat-label">Overall Score</div>
        </div>
        <div class="report-stat">
          <div class="report-stat-value" style="color:${totalIncidents > 0 ? 'var(--ci-red)' : 'inherit'};">${totalIncidents}</div>
          <div class="report-stat-label">Incidents</div>
        </div>
        <div class="report-stat">
          <div class="report-stat-value">${totalMinutes}</div>
          <div class="report-stat-label">Incident Mins</div>
        </div>
      </div>

      <!-- Trend chart -->
      <div class="chart-wrap">
        <canvas id="trend-chart"></canvas>
      </div>
    </div>

    ${incidentRows ? `
    <div class="report-section">
      <h3>Incident Summary</h3>
      <table class="incident-summary-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Count</th>
            <th>Total Mins</th>
            <th>Avg Mins</th>
          </tr>
        </thead>
        <tbody>${incidentRows}</tbody>
      </table>
    </div>` : ''}

    <!-- Per-day detail table -->
    <div class="report-section">
      <h3>Daily Detail</h3>
      <div style="overflow-x:auto;">
        <table class="incident-summary-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Score %</th>
              <th>Incidents</th>
              <th>Minutes</th>
            </tr>
          </thead>
          <tbody>
            ${checkins.map(ci => {
              const scores  = ci.cico_period_scores || [];
              const dayTotal    = scores.reduce((a, s) => s.score !== null ? a + s.score : a, 0);
              const dayPossible = scores.filter(s => s.score !== null).length * 2;
              const dayPct  = dayPossible > 0 ? `${Math.round((dayTotal/dayPossible)*100)}%` : '—';
              const dayInc  = ci.cico_incidents || [];
              const dayMins = dayInc.reduce((a, i) => a + (i.minutes || 0), 0);
              const chips   = dayInc.map(i => {
                const abbr = i.cico_incident_types?.abbreviation || '?';
                return `<span class="incident-chip">${escHtml(abbr)}</span>`;
              }).join('');
              return `
                <tr>
                  <td>${escHtml(formatDate(ci.check_in_date))}</td>
                  <td>${dayPct}</td>
                  <td>${chips || '—'}</td>
                  <td>${dayMins || '—'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Trend Chart ────────────────────────────────────────────────────────────
function renderTrendChart(checkins) {
  const canvas = document.getElementById('trend-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Build daily score % array
  const labels = [];
  const scoreData = [];
  const incidentData = [];

  checkins.forEach(ci => {
    const scores    = ci.cico_period_scores || [];
    const total     = scores.reduce((a, s) => s.score !== null ? a + s.score : a, 0);
    const possible  = scores.filter(s => s.score !== null).length * 2;
    const pct       = possible > 0 ? Math.round((total / possible) * 100) : null;
    labels.push(formatDate(ci.check_in_date).replace(/\w+, /, ''));  // trim weekday
    scoreData.push(pct);
    incidentData.push((ci.cico_incidents || []).length);
  });

  destroyChart();

  _trendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Daily Score %',
          data: scoreData,
          borderColor: '#2A9D8F',
          backgroundColor: 'rgba(42,157,143,.1)',
          borderWidth: 2,
          pointBackgroundColor: scoreData.map(v =>
            v === null ? '#94A3B8' : v >= 80 ? '#22C55E' : v >= 50 ? '#F59E0B' : '#EF4444'
          ),
          pointRadius: 5,
          tension: .3,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'Incidents',
          data: incidentData,
          borderColor: '#EF4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointBackgroundColor: '#EF4444',
          pointRadius: 4,
          tension: .3,
          borderDash: [4, 3],
          yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Nunito', size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => {
              if (ctx.datasetIndex === 0) return `Score: ${ctx.raw !== null ? ctx.raw + '%' : 'n/a'}`;
              return `Incidents: ${ctx.raw}`;
            }
          }
        }
      },
      scales: {
        y:  { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#E2E8F0' } },
        y2: { position: 'right', min: 0, ticks: { stepSize: 1 }, grid: { display: false } }
      }
    }
  });
}

function destroyChart() {
  if (_trendChart) {
    _trendChart.destroy();
    _trendChart = null;
  }
}
