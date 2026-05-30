/**
 * checkin-reports.js
 * Four report modes: Student · By Teacher · By Grade · School-wide
 * Each includes breakdown charts: by period, by month, by day of week.
 * Requires Chart.js loaded in the HTML.
 */

let _activeReportTab = 'student';
let _chartInstances  = {};   // keyed by canvas id → Chart instance

// Breakdown state — reset each time a report loads
let _breakdownData = {};    // { period, month, dow } — keyed by type
let _breakdownMode = { period: 'total', month: 'total', dow: 'total' };

let _incidentData = {};     // { period, month, dow } → { [key]: { count, minutes } }
let _incidentMode = { period: 'count', month: 'count', dow: 'count' };

const BREAKDOWN_COLORS = [
  { solid: '#2A9D8F', alpha: 'rgba(42,157,143,0.75)'  },
  { solid: '#3B82F6', alpha: 'rgba(59,130,246,0.75)'  },
  { solid: '#8B5CF6', alpha: 'rgba(139,92,246,0.75)'  },
  { solid: '#F59E0B', alpha: 'rgba(245,158,11,0.75)'  },
  { solid: '#EC4899', alpha: 'rgba(236,72,153,0.75)'  },
  { solid: '#EF4444', alpha: 'rgba(239,68,68,0.75)'   },
];

// ── Tab switching ──────────────────────────────────────────────────────────
function switchReportTab(tab) {
  _activeReportTab = tab;

  document.querySelectorAll('.report-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.report === tab);
  });

  ['student','teacher','grade','school'].forEach(t => {
    const el = document.getElementById(`rctrl-${t}`);
    if (el) el.classList.toggle('hidden', t !== tab);
  });

  document.getElementById('reports-body').innerHTML =
    '<p class="empty-state">Select filters above to run the report.</p>';

  destroyAllCharts();
  renderReports();
}

// ── Initialize Reports View ────────────────────────────────────────────────
function initReportsView() {
  populateReportStudentSelect();
  populateReportTeacherSelect();
  populateReportGradeSelect();
  setDefaultReportDates();
}

function populateReportStudentSelect() {
  const sel = document.getElementById('report-student-sel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select a student —</option>' +
    CicoState.students.map(s =>
      `<option value="${s.id}">${escHtml(s.last_name)}, ${escHtml(s.first_name)}</option>`
    ).join('');
}

function populateReportTeacherSelect() {
  const sel = document.getElementById('report-teacher-sel');
  if (!sel) return;
  const teachers = [...new Set(
    CicoState.students.map(s => s.homeroom).filter(Boolean)
  )].sort();
  sel.innerHTML = '<option value="">— Select a teacher —</option>' +
    teachers.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
}

function populateReportGradeSelect() {
  const sel = document.getElementById('report-grade-sel');
  if (!sel) return;
  const grades = [...new Set(
    CicoState.students.map(s => s.grade).filter(Boolean)
  )].sort((a,b) => gradeOrderCico(a) - gradeOrderCico(b));
  sel.innerHTML = '<option value="">— Select a grade —</option>' +
    grades.map(g => `<option value="${escHtml(g)}">Grade ${escHtml(g)}</option>`).join('');
}

function gradeOrderCico(g) {
  const map = { 'TK': -1, 'K': 0 };
  return map[g] !== undefined ? map[g] : (parseInt(g) || 99);
}

function setDefaultReportDates() {
  const today = todayISO();
  const thirtyAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();

  [['report-from','report-to'],
   ['report-teacher-from','report-teacher-to'],
   ['report-grade-from','report-grade-to'],
   ['report-school-from','report-school-to']
  ].forEach(([fromId, toId]) => {
    const f = document.getElementById(fromId);
    const t = document.getElementById(toId);
    if (f) f.value = thirtyAgo;
    if (t) t.value = today;
  });
}

// ── Main dispatch ──────────────────────────────────────────────────────────
async function renderReports() {
  destroyAllCharts();
  if      (_activeReportTab === 'student') await renderStudentReport();
  else if (_activeReportTab === 'teacher') await renderTeacherReport();
  else if (_activeReportTab === 'grade')   await renderGradeReport();
  else if (_activeReportTab === 'school')  await renderSchoolReport();
}

// ══════════════════════════════════════════════════════════════════════
// STUDENT REPORT
// ══════════════════════════════════════════════════════════════════════
async function renderStudentReport() {
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

  try {
    let q = SupabaseClient.from('cico_checkins').select(`
        id, check_in_date, notes,
        cico_period_scores ( period_number, category_id, score ),
        cico_incidents ( period_number, incident_type_id, minutes, notes,
          cico_incident_types ( abbreviation, description ) )
      `)
      .eq('student_id', studentId)
      .order('check_in_date');
    if (from) q = q.gte('check_in_date', from);
    if (to)   q = q.lte('check_in_date', to);

    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) {
      body.innerHTML = `<p class="empty-state">No check-ins found for ${escHtml(student.first_name)} in this date range.</p>`;
      return;
    }

    _breakdownData = {
      period: buildPeriodBreakdown(data),
      month:  buildMonthBreakdown(data),
      dow:    buildDowBreakdown(data),
    };
    _breakdownMode = { period: 'total', month: 'combined', dow: 'combined' };
    _incidentData  = {
      period: buildIncidentBreakdown('period', data),
      month:  buildIncidentBreakdown('month',  data),
      dow:    buildIncidentBreakdown('dow',    data),
    };
    _incidentMode = { period: 'count', month: 'count', dow: 'count' };

    body.innerHTML = buildStudentReportHTML(student, data);
    renderTrendChart('trend-chart', data);
    renderBreakdownSection('period');
    renderBreakdownSection('month');
    renderBreakdownSection('dow');
    renderIncidentSection('period');
    renderIncidentSection('month');
    renderIncidentSection('dow');
  } catch (err) {
    console.error(err);
    body.innerHTML = '<p class="empty-state" style="color:var(--ci-red);">Failed to load report.</p>';
  }
}

function buildStudentReportHTML(student, checkins) {
  const name = `${student.first_name} ${student.last_name}`;
  const { totalScore, totalPossible, totalIncidents, totalMinutes, incidentCounts } = aggregateCheckins(checkins);
  const overallPct = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null;
  const pctColor   = scorePctColor(overallPct);

  return `
    <div class="report-section">
      <h3>${escHtml(name)} — Summary</h3>
      ${statCards([
        { value: checkins.length, label: 'Check-ins' },
        { value: overallPct !== null ? overallPct + '%' : '—', label: 'Avg Score', color: pctColor },
        { value: totalIncidents, label: 'Incidents', color: totalIncidents > 0 ? 'var(--ci-red)' : null },
        { value: totalMinutes,   label: 'Incident Mins' },
      ])}
      <p class="chart-section-label">Score % by Day</p>
      <div class="chart-wrap"><canvas id="trend-chart"></canvas></div>
    </div>
    ${buildBreakdownSectionHTML('period', 'By Period', 'total')}
    ${buildBreakdownSectionHTML('month',  'By Month',  'combined')}
    ${buildBreakdownSectionHTML('dow',    'By Day of Week', 'combined')}
    ${buildIncidentSectionHTML('period', 'Incidents by Period')}
    ${buildIncidentSectionHTML('month',  'Incidents by Month')}
    ${buildIncidentSectionHTML('dow',    'Incidents by Day of Week')}
    ${buildIncidentTable(incidentCounts)}
    ${buildDailyDetailTable(checkins)}`;
}

// ══════════════════════════════════════════════════════════════════════
// TEACHER REPORT
// ══════════════════════════════════════════════════════════════════════
async function renderTeacherReport() {
  const body    = document.getElementById('reports-body');
  const teacher = document.getElementById('report-teacher-sel').value;
  const from    = document.getElementById('report-teacher-from').value;
  const to      = document.getElementById('report-teacher-to').value;

  if (!teacher) {
    body.innerHTML = '<p class="empty-state">Select a teacher to view their report.</p>';
    return;
  }
  body.innerHTML = '<p class="empty-state">Loading…</p>';

  try {
    const homeroomStudents = CicoState.students.filter(s => s.homeroom === teacher);
    if (!homeroomStudents.length) {
      body.innerHTML = `<p class="empty-state">No students found for ${escHtml(teacher)}.</p>`;
      return;
    }
    const studentIds = homeroomStudents.map(s => s.id);

    let q = SupabaseClient.from('cico_checkins').select(`
        id, check_in_date, student_id,
        cico_period_scores ( period_number, category_id, score ),
        cico_incidents ( period_number, incident_type_id, minutes,
          cico_incident_types ( abbreviation, description ) )
      `)
      .in('student_id', studentIds)
      .order('check_in_date');
    if (from) q = q.gte('check_in_date', from);
    if (to)   q = q.lte('check_in_date', to);

    const { data, error } = await q;
    if (error) throw error;

    const checkins = data || [];
    _breakdownData = {
      period: buildPeriodBreakdown(checkins),
      month:  buildMonthBreakdown(checkins),
      dow:    buildDowBreakdown(checkins),
    };
    _breakdownMode = { period: 'total', month: 'combined', dow: 'combined' };
    _incidentData  = {
      period: buildIncidentBreakdown('period', checkins),
      month:  buildIncidentBreakdown('month',  checkins),
      dow:    buildIncidentBreakdown('dow',    checkins),
    };
    _incidentMode = { period: 'count', month: 'count', dow: 'count' };

    body.innerHTML = buildGroupReportHTML({
      title:    `${escHtml(teacher)} — Homeroom Report`,
      subtitle: `${homeroomStudents.length} students · ${escHtml(from)} to ${escHtml(to)}`,
      students: homeroomStudents,
      checkins,
      groupBy:  'student',
      chartLabel: 'Avg Score % by Student',
    });

    renderGroupBarChart('group-bar-chart', buildStudentBarData(homeroomStudents, checkins));
    renderBreakdownSection('period');
    renderBreakdownSection('month');
    renderBreakdownSection('dow');
    renderIncidentSection('period');
    renderIncidentSection('month');
    renderIncidentSection('dow');
  } catch (err) {
    console.error(err);
    body.innerHTML = '<p class="empty-state" style="color:var(--ci-red);">Failed to load report.</p>';
  }
}

// ══════════════════════════════════════════════════════════════════════
// GRADE REPORT
// ══════════════════════════════════════════════════════════════════════
async function renderGradeReport() {
  const body  = document.getElementById('reports-body');
  const grade = document.getElementById('report-grade-sel').value;
  const from  = document.getElementById('report-grade-from').value;
  const to    = document.getElementById('report-grade-to').value;

  if (!grade) {
    body.innerHTML = '<p class="empty-state">Select a grade to view its report.</p>';
    return;
  }
  body.innerHTML = '<p class="empty-state">Loading…</p>';

  try {
    const gradeStudents = CicoState.students.filter(s => s.grade === grade);
    if (!gradeStudents.length) {
      body.innerHTML = `<p class="empty-state">No students found for Grade ${escHtml(grade)}.</p>`;
      return;
    }
    const studentIds = gradeStudents.map(s => s.id);

    let q = SupabaseClient.from('cico_checkins').select(`
        id, check_in_date, student_id,
        cico_period_scores ( period_number, category_id, score ),
        cico_incidents ( period_number, incident_type_id, minutes,
          cico_incident_types ( abbreviation, description ) )
      `)
      .in('student_id', studentIds)
      .order('check_in_date');
    if (from) q = q.gte('check_in_date', from);
    if (to)   q = q.lte('check_in_date', to);

    const { data, error } = await q;
    if (error) throw error;

    const checkins = data || [];
    _breakdownData = {
      period: buildPeriodBreakdown(checkins),
      month:  buildMonthBreakdown(checkins),
      dow:    buildDowBreakdown(checkins),
    };
    _breakdownMode = { period: 'total', month: 'combined', dow: 'combined' };
    _incidentData  = {
      period: buildIncidentBreakdown('period', checkins),
      month:  buildIncidentBreakdown('month',  checkins),
      dow:    buildIncidentBreakdown('dow',    checkins),
    };
    _incidentMode = { period: 'count', month: 'count', dow: 'count' };

    body.innerHTML = buildGroupReportHTML({
      title:    `Grade ${escHtml(grade)} — Report`,
      subtitle: `${gradeStudents.length} students tracked · ${escHtml(from)} to ${escHtml(to)}`,
      students: gradeStudents,
      checkins,
      groupBy:  'homeroom',
      chartLabel: 'Avg Score % by Homeroom',
    });

    renderGroupBarChart('group-bar-chart', buildHomeroomBarData(gradeStudents, checkins));
    renderBreakdownSection('period');
    renderBreakdownSection('month');
    renderBreakdownSection('dow');
    renderIncidentSection('period');
    renderIncidentSection('month');
    renderIncidentSection('dow');
  } catch (err) {
    console.error(err);
    body.innerHTML = '<p class="empty-state" style="color:var(--ci-red);">Failed to load report.</p>';
  }
}

// ══════════════════════════════════════════════════════════════════════
// SCHOOL-WIDE REPORT
// ══════════════════════════════════════════════════════════════════════
async function renderSchoolReport() {
  const body = document.getElementById('reports-body');
  const from = document.getElementById('report-school-from').value;
  const to   = document.getElementById('report-school-to').value;

  body.innerHTML = '<p class="empty-state">Loading…</p>';

  try {
    let q = SupabaseClient.from('cico_checkins').select(`
        id, check_in_date, student_id,
        cico_period_scores ( period_number, category_id, score ),
        cico_incidents ( period_number, incident_type_id, minutes,
          cico_incident_types ( abbreviation, description ) )
      `)
      .order('check_in_date');
    if (from) q = q.gte('check_in_date', from);
    if (to)   q = q.lte('check_in_date', to);

    const { data, error } = await q;
    if (error) throw error;

    if (!data?.length) {
      body.innerHTML = '<p class="empty-state">No check-ins found in this date range.</p>';
      return;
    }

    const checkins = data;
    const activeStudentIds = [...new Set(checkins.map(c => c.student_id))];
    _breakdownData = {
      period: buildPeriodBreakdown(checkins),
      month:  buildMonthBreakdown(checkins),
      dow:    buildDowBreakdown(checkins),
    };
    _breakdownMode = { period: 'total', month: 'combined', dow: 'combined' };
    _incidentData  = {
      period: buildIncidentBreakdown('period', checkins),
      month:  buildIncidentBreakdown('month',  checkins),
      dow:    buildIncidentBreakdown('dow',    checkins),
    };
    _incidentMode = { period: 'count', month: 'count', dow: 'count' };

    body.innerHTML = buildGroupReportHTML({
      title:    'School-wide Report',
      subtitle: `${activeStudentIds.length} students · ${escHtml(from)} to ${escHtml(to)}`,
      students: CicoState.students,
      checkins,
      groupBy:  'grade',
      chartLabel: 'Avg Score % by Grade',
    });

    renderGroupBarChart('group-bar-chart', buildGradeBarData(CicoState.students, checkins));
    renderBreakdownSection('period');
    renderBreakdownSection('month');
    renderBreakdownSection('dow');
    renderIncidentSection('period');
    renderIncidentSection('month');
    renderIncidentSection('dow');
  } catch (err) {
    console.error(err);
    body.innerHTML = '<p class="empty-state" style="color:var(--ci-red);">Failed to load report.</p>';
  }
}

// ══════════════════════════════════════════════════════════════════════
// BREAKDOWN DATA BUILDERS
// ══════════════════════════════════════════════════════════════════════

function buildPeriodBreakdown(checkins) {
  const periods = {};
  checkins.forEach(ci => {
    (ci.cico_period_scores || []).forEach(ps => {
      if (ps.score === null) return;
      if (!periods[ps.period_number]) periods[ps.period_number] = { total: 0, possible: 0, cats: {} };
      periods[ps.period_number].total    += ps.score;
      periods[ps.period_number].possible += 2;
      const cats = periods[ps.period_number].cats;
      if (!cats[ps.category_id]) cats[ps.category_id] = { score: 0, possible: 0 };
      cats[ps.category_id].score    += ps.score;
      cats[ps.category_id].possible += 2;
    });
  });
  return periods;
}

function buildMonthBreakdown(checkins) {
  const months = {};
  checkins.forEach(ci => {
    const key = ci.check_in_date.substring(0, 7);
    if (!months[key]) months[key] = { total: 0, possible: 0, cats: {} };
    (ci.cico_period_scores || []).forEach(ps => {
      if (ps.score === null) return;
      months[key].total    += ps.score;
      months[key].possible += 2;
      if (!months[key].cats[ps.category_id]) months[key].cats[ps.category_id] = { score: 0, possible: 0 };
      months[key].cats[ps.category_id].score    += ps.score;
      months[key].cats[ps.category_id].possible += 2;
    });
  });
  return months;
}

function buildDowBreakdown(checkins) {
  const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dow = {};
  checkins.forEach(ci => {
    const d   = new Date(ci.check_in_date + 'T12:00:00');
    const key = DOW_NAMES[d.getDay()];
    if (!dow[key]) dow[key] = { total: 0, possible: 0, cats: {} };
    (ci.cico_period_scores || []).forEach(ps => {
      if (ps.score === null) return;
      dow[key].total    += ps.score;
      dow[key].possible += 2;
      if (!dow[key].cats[ps.category_id]) dow[key].cats[ps.category_id] = { score: 0, possible: 0 };
      dow[key].cats[ps.category_id].score    += ps.score;
      dow[key].cats[ps.category_id].possible += 2;
    });
  });
  return dow;
}

// ══════════════════════════════════════════════════════════════════════
// INCIDENT BREAKDOWN DATA BUILDER
// ══════════════════════════════════════════════════════════════════════

function buildIncidentBreakdown(type, checkins) {
  const DOW_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const result = {};

  function addIncident(key, inc) {
    if (!result[key]) result[key] = { count: 0, minutes: 0, types: {} };
    result[key].count++;
    result[key].minutes += inc.minutes || 0;
    const tid  = inc.incident_type_id || 'unknown';
    const abbr = inc.cico_incident_types?.abbreviation || '?';
    if (!result[key].types[tid]) result[key].types[tid] = { abbr, count: 0, minutes: 0 };
    result[key].types[tid].count++;
    result[key].types[tid].minutes += inc.minutes || 0;
  }

  checkins.forEach(ci => {
    const incidents = ci.cico_incidents || [];
    if (!incidents.length) return;
    if (type === 'period') {
      incidents.forEach(inc => addIncident(inc.period_number, inc));
    } else {
      const key = type === 'month'
        ? ci.check_in_date.substring(0, 7)
        : DOW_NAMES[new Date(ci.check_in_date + 'T12:00:00').getDay()];
      incidents.forEach(inc => addIncident(key, inc));
    }
  });

  return result;
}

// ══════════════════════════════════════════════════════════════════════
// INCIDENT BREAKDOWN CHART RENDERING
// ══════════════════════════════════════════════════════════════════════

function buildIncidentSectionHTML(type, title) {
  return `
    <div class="report-section">
      <div class="report-section-header">
        <h3>${title}</h3>
        <div class="breakdown-toggle">
          <button class="breakdown-btn active" onclick="setIncidentMode('${type}','count',this)">Count</button>
          <button class="breakdown-btn"        onclick="setIncidentMode('${type}','minutes',this)">Minutes</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="inc-${type}-chart"></canvas></div>
    </div>`;
}

function setIncidentMode(type, mode, btn) {
  _incidentMode[type] = mode;
  btn.closest('.breakdown-toggle').querySelectorAll('.breakdown-btn')
     .forEach(b => b.classList.toggle('active', b === btn));
  renderIncidentSection(type);
}

function renderIncidentSection(type) {
  const data     = _incidentData[type];
  const mode     = _incidentMode[type];
  const canvasId = `inc-${type}-chart`;

  if (_chartInstances[canvasId]) {
    _chartInstances[canvasId].destroy();
    delete _chartInstances[canvasId];
  }
  if (!data || !Object.keys(data).length) return;

  let orderedKeys, keyLabel;
  if (type === 'period') {
    orderedKeys = Object.keys(data).map(Number).sort((a, b) => a - b);
    keyLabel    = k => `P${k}`;
  } else if (type === 'month') {
    orderedKeys = Object.keys(data).sort();
    keyLabel    = k => {
      const [y, m] = k.split('-');
      return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
    };
  } else {
    const DOW_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    orderedKeys = DOW_ORDER.filter(k => data[k]);
    keyLabel    = k => k;
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = orderedKeys.map(keyLabel);

  // Collect all incident types present in the data (ordered by total count desc)
  const typeMap = {};
  orderedKeys.forEach(k => {
    Object.entries(data[k]?.types || {}).forEach(([tid, info]) => {
      if (!typeMap[tid]) typeMap[tid] = { abbr: info.abbr, total: 0 };
      typeMap[tid].total += info.count;
    });
  });
  const typeIds = Object.keys(typeMap).sort((a, b) => typeMap[b].total - typeMap[a].total);

  const INC_COLORS = [
    'rgba(239,68,68,0.8)',   'rgba(245,158,11,0.8)',  'rgba(59,130,246,0.8)',
    'rgba(139,92,246,0.8)',  'rgba(34,197,94,0.8)',   'rgba(236,72,153,0.8)',
    'rgba(20,184,166,0.8)',  'rgba(251,146,60,0.8)',  'rgba(99,102,241,0.8)',
  ];

  const datasets = typeIds.map((tid, i) => ({
    label: typeMap[tid].abbr,
    data:  orderedKeys.map(k => data[k]?.types?.[tid]?.[mode] || 0),
    backgroundColor: INC_COLORS[i % INC_COLORS.length],
    borderWidth: 0,
    stack: 'inc',
  }));

  _chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { family: 'Nunito', size: 11 }, boxWidth: 12 } },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}${mode === 'minutes' ? ' min' : ''}` } }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Nunito', size: 12 } } },
        y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#E2E8F0' } }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// BREAKDOWN CHART RENDERING
// ══════════════════════════════════════════════════════════════════════

function buildBreakdownSectionHTML(type, title, defaultMode = 'total') {
  const toggle = defaultMode === 'combined' ? '' : `
        <div class="breakdown-toggle">
          <button class="breakdown-btn ${defaultMode === 'total' ? 'active' : ''}"    onclick="setBreakdownMode('${type}','total',this)">Total</button>
          <button class="breakdown-btn ${defaultMode === 'category' ? 'active' : ''}" onclick="setBreakdownMode('${type}','category',this)">By Category</button>
        </div>`;
  return `
    <div class="report-section">
      <div class="report-section-header">
        <h3>${title}</h3>${toggle}
      </div>
      <div class="chart-wrap"><canvas id="${type}-chart"></canvas></div>
    </div>`;
}

function setBreakdownMode(type, mode, btn) {
  _breakdownMode[type] = mode;
  btn.closest('.breakdown-toggle').querySelectorAll('.breakdown-btn')
     .forEach(b => b.classList.toggle('active', b === btn));
  renderBreakdownSection(type);
}

function renderBreakdownSection(type) {
  const data     = _breakdownData[type];
  const mode     = _breakdownMode[type];
  const canvasId = `${type}-chart`;

  if (_chartInstances[canvasId]) {
    _chartInstances[canvasId].destroy();
    delete _chartInstances[canvasId];
  }
  if (!data || !Object.keys(data).length) return;

  let orderedKeys, keyLabel;

  if (type === 'period') {
    orderedKeys = Object.keys(data).map(Number).sort((a, b) => a - b);
    keyLabel    = k => `P${k}`;
  } else if (type === 'month') {
    orderedKeys = Object.keys(data).sort();
    keyLabel    = k => {
      const [y, m] = k.split('-');
      return new Date(+y, +m - 1, 1).toLocaleString('default', { month: 'short', year: '2-digit' });
    };
  } else { // dow
    const DOW_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    orderedKeys = DOW_ORDER.filter(k => data[k]);
    keyLabel    = k => k;
  }

  renderBreakdownChart(canvasId, data, orderedKeys, keyLabel, mode);
}

function renderBreakdownChart(canvasId, data, orderedKeys, keyLabel, mode) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = orderedKeys.map(keyLabel);

  const catDatasets = CicoState.categories.map((cat, i) => {
    const col = BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length];
    const values = orderedKeys.map(k => {
      const cd = data[k]?.cats?.[cat.id];
      return cd && cd.possible > 0 ? Math.round((cd.score / cd.possible) * 100) : 0;
    });
    return { label: cat.name, data: values, backgroundColor: col.alpha, borderColor: col.solid, borderWidth: 1, borderRadius: 4 };
  });

  let datasets;
  if (mode === 'total') {
    const values = orderedKeys.map(k => {
      const d = data[k];
      return d && d.possible > 0 ? Math.round((d.total / d.possible) * 100) : 0;
    });
    const barColors = values.map(v =>
      v >= 80 ? 'rgba(34,197,94,0.75)' : v >= 50 ? 'rgba(245,158,11,0.75)' : 'rgba(239,68,68,0.75)'
    );
    datasets = [{ label: 'Avg Score %', data: values, backgroundColor: barColors, borderColor: barColors.map(c => c.replace('0.75','0.9')), borderWidth: 1, borderRadius: 4 }];
  } else if (mode === 'combined') {
    const totalValues = orderedKeys.map(k => {
      const d = data[k];
      return d && d.possible > 0 ? Math.round((d.total / d.possible) * 100) : 0;
    });
    datasets = [
      { label: 'Total', data: totalValues, backgroundColor: 'rgba(30,58,95,0.8)', borderColor: 'rgba(30,58,95,1)', borderWidth: 1, borderRadius: 4 },
      ...catDatasets,
    ];
  } else {
    datasets = catDatasets;
  }

  _chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: mode === 'category',
          position: 'top',
          labels: { font: { family: 'Nunito', size: 12 } }
        },
        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}%` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 12 } } },
        y: { min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { color: '#E2E8F0' } }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// SHARED HTML BUILDERS
// ══════════════════════════════════════════════════════════════════════

function buildGroupReportHTML({ title, subtitle, students, checkins, groupBy, chartLabel }) {
  const { totalScore, totalPossible, totalIncidents, totalMinutes, incidentCounts } = aggregateCheckins(checkins);
  const overallPct = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null;
  const activeIds  = new Set(checkins.map(c => c.student_id));

  return `
    <div class="report-section">
      <h3>${title}</h3>
      <p style="font-size:13px;color:var(--ci-text-2);margin-bottom:16px;">${subtitle}</p>
      ${statCards([
        { value: activeIds.size,   label: 'Students w/ Data' },
        { value: checkins.length,  label: 'Total Check-ins' },
        { value: overallPct !== null ? overallPct + '%' : '—', label: 'Avg Score', color: scorePctColor(overallPct) },
        { value: totalIncidents,   label: 'Total Incidents', color: totalIncidents > 0 ? 'var(--ci-red)' : null },
        { value: totalMinutes,     label: 'Incident Mins' },
      ])}
      <p class="chart-section-label">${escHtml(chartLabel)}</p>
      <div class="chart-wrap chart-tall"><canvas id="group-bar-chart"></canvas></div>
    </div>
    ${buildBreakdownSectionHTML('period', 'By Period', 'total')}
    ${buildBreakdownSectionHTML('month',  'By Month',  'combined')}
    ${buildBreakdownSectionHTML('dow',    'By Day of Week', 'combined')}
    ${buildIncidentSectionHTML('period', 'Incidents by Period')}
    ${buildIncidentSectionHTML('month',  'Incidents by Month')}
    ${buildIncidentSectionHTML('dow',    'Incidents by Day of Week')}
    ${buildIncidentTable(incidentCounts)}
    ${buildStudentBreakdownTable(students, checkins, groupBy)}`;
}

// Stat cards row
function statCards(cards) {
  return `<div class="report-stat-row">` +
    cards.map(c => `
      <div class="report-stat">
        <div class="report-stat-value" ${c.color ? `style="color:${c.color};"` : ''}>${c.value}</div>
        <div class="report-stat-label">${c.label}</div>
      </div>`).join('') +
    `</div>`;
}

// Incident summary table
function buildIncidentTable(incidentCounts) {
  const rows = Object.values(incidentCounts).sort((a,b) => b.count - a.count);
  if (!rows.length) return '';
  return `
    <div class="report-section">
      <h3>Incident Summary</h3>
      <table class="incident-summary-table">
        <thead><tr><th>Type</th><th>Count</th><th>Total Mins</th><th>Avg Mins</th></tr></thead>
        <tbody>
          ${rows.map(i => `
            <tr>
              <td><strong>${escHtml(i.abbr)}</strong><span style="color:var(--ci-text-2);margin-left:8px;font-size:12px;">${escHtml(i.desc || '')}</span></td>
              <td>${i.count}</td>
              <td>${i.minutes}</td>
              <td>${i.count > 0 ? Math.round(i.minutes / i.count) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

// Per-student breakdown (teacher/grade/school views)
function buildStudentBreakdownTable(students, checkins, groupBy) {
  const studentMap = {};
  students.forEach(s => { studentMap[s.id] = s; });

  const byStudent = {};
  checkins.forEach(ci => {
    if (!byStudent[ci.student_id]) byStudent[ci.student_id] = [];
    byStudent[ci.student_id].push(ci);
  });

  const rows = Object.entries(byStudent).map(([sid, cis]) => {
    const s = studentMap[sid];
    if (!s) return null;
    const { totalScore, totalPossible, totalIncidents, totalMinutes } = aggregateCheckins(cis);
    const pct = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : null;
    const groupLabel = groupBy === 'homeroom' ? (s.homeroom || '—')
                     : groupBy === 'grade'    ? (s.grade || '—')
                     : null;
    return { s, cis, pct, totalIncidents, totalMinutes, groupLabel };
  }).filter(Boolean).sort((a,b) => {
    if (a.groupLabel && b.groupLabel && a.groupLabel !== b.groupLabel)
      return a.groupLabel.localeCompare(b.groupLabel);
    return (a.pct === null ? -1 : a.pct) - (b.pct === null ? -1 : b.pct);
  });

  if (!rows.length) return '';

  const groupHeader = groupBy !== 'student' ?
    `<th>${groupBy === 'homeroom' ? 'Homeroom' : 'Grade'}</th>` : '';

  return `
    <div class="report-section">
      <h3>Student Breakdown</h3>
      <div style="overflow-x:auto;">
        <table class="incident-summary-table">
          <thead><tr>
            <th>Student</th>
            ${groupHeader}
            <th>Check-ins</th>
            <th>Avg Score</th>
            <th>Incidents</th>
            <th>Mins</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td>${escHtml(r.s.last_name)}, ${escHtml(r.s.first_name)}</td>
                ${groupBy !== 'student' ? `<td style="color:var(--ci-text-2);">${escHtml(r.groupLabel)}</td>` : ''}
                <td>${r.cis.length}</td>
                <td>${r.pct !== null
                  ? `<span style="font-weight:700;color:${scorePctColor(r.pct)};">${r.pct}%</span>`
                  : '—'}</td>
                <td>${r.totalIncidents > 0
                  ? `<span style="color:var(--ci-red);font-weight:700;">${r.totalIncidents}</span>`
                  : '—'}</td>
                <td>${r.totalMinutes || '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// Daily detail (student report only)
function buildDailyDetailTable(checkins) {
  return `
    <div class="report-section">
      <h3>Daily Detail</h3>
      <div style="overflow-x:auto;">
        <table class="incident-summary-table">
          <thead><tr><th>Date</th><th>Score %</th><th>Incidents</th><th>Minutes</th></tr></thead>
          <tbody>
            ${checkins.map(ci => {
              const scores   = ci.cico_period_scores || [];
              const total    = scores.reduce((a,s) => s.score !== null ? a + s.score : a, 0);
              const possible = scores.filter(s => s.score !== null).length * 2;
              const pct      = possible > 0 ? Math.round((total/possible)*100) : null;
              const incs     = ci.cico_incidents || [];
              const mins     = incs.reduce((a,i) => a + (i.minutes||0), 0);
              const chips    = incs.map(i =>
                `<span class="incident-chip">${escHtml(i.cico_incident_types?.abbreviation||'?')}</span>`
              ).join('');
              return `<tr>
                <td>${escHtml(formatDate(ci.check_in_date))}</td>
                <td>${pct !== null ? `<span style="color:${scorePctColor(pct)};font-weight:700;">${pct}%</span>` : '—'}</td>
                <td>${chips || '—'}</td>
                <td>${mins || '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
// BAR CHART DATA BUILDERS (group reports)
// ══════════════════════════════════════════════════════════════════════

function buildStudentBarData(students, checkins) {
  const byStudent = {};
  checkins.forEach(ci => {
    if (!byStudent[ci.student_id]) byStudent[ci.student_id] = [];
    byStudent[ci.student_id].push(ci);
  });
  const items = students
    .filter(s => byStudent[s.id])
    .map(s => {
      const { totalScore, totalPossible } = aggregateCheckins(byStudent[s.id]);
      const pct = totalPossible > 0 ? Math.round((totalScore/totalPossible)*100) : 0;
      return { label: `${s.last_name}, ${s.first_name.charAt(0)}.`, pct };
    })
    .sort((a,b) => b.pct - a.pct);
  return { labels: items.map(i=>i.label), values: items.map(i=>i.pct) };
}

function buildHomeroomBarData(students, checkins) {
  const studentMap = {};
  students.forEach(s => { studentMap[s.id] = s; });
  const byHomeroom = {};
  checkins.forEach(ci => {
    const s = studentMap[ci.student_id];
    if (!s) return;
    const key = s.homeroom || 'No Homeroom';
    if (!byHomeroom[key]) byHomeroom[key] = [];
    byHomeroom[key].push(ci);
  });
  const items = Object.entries(byHomeroom).map(([teacher, cis]) => {
    const { totalScore, totalPossible } = aggregateCheckins(cis);
    const pct = totalPossible > 0 ? Math.round((totalScore/totalPossible)*100) : 0;
    return { label: teacher, pct };
  }).sort((a,b) => b.pct - a.pct);
  return { labels: items.map(i=>i.label), values: items.map(i=>i.pct) };
}

function buildGradeBarData(students, checkins) {
  const studentMap = {};
  students.forEach(s => { studentMap[s.id] = s; });
  const byGrade = {};
  checkins.forEach(ci => {
    const s = studentMap[ci.student_id];
    if (!s) return;
    const key = s.grade ? `Grade ${s.grade}` : 'No Grade';
    if (!byGrade[key]) byGrade[key] = [];
    byGrade[key].push(ci);
  });
  const gradeOrder = ['TK','K','1','2','3','4','5','6','7','8'];
  const items = Object.entries(byGrade).map(([grade, cis]) => {
    const { totalScore, totalPossible } = aggregateCheckins(cis);
    const pct = totalPossible > 0 ? Math.round((totalScore/totalPossible)*100) : 0;
    return { label: grade, pct };
  }).sort((a,b) => {
    const ai = gradeOrder.indexOf(a.label.replace('Grade ',''));
    const bi = gradeOrder.indexOf(b.label.replace('Grade ',''));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return { labels: items.map(i=>i.label), values: items.map(i=>i.pct) };
}

// ══════════════════════════════════════════════════════════════════════
// EXISTING CHART RENDERERS
// ══════════════════════════════════════════════════════════════════════

function renderTrendChart(canvasId, checkins) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  const labels      = [];
  const scoreData   = [];
  const incidentData = [];

  checkins.forEach(ci => {
    const scores   = ci.cico_period_scores || [];
    const total    = scores.reduce((a,s) => s.score !== null ? a+s.score : a, 0);
    const possible = scores.filter(s => s.score !== null).length * 2;
    const pct      = possible > 0 ? Math.round((total/possible)*100) : null;
    labels.push(formatDate(ci.check_in_date).replace(/\w+, /,''));
    scoreData.push(pct);
    incidentData.push((ci.cico_incidents||[]).length);
  });

  _chartInstances[canvasId] = new Chart(canvas, {
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
            v === null ? '#94A3B8' : v >= 80 ? '#22C55E' : v >= 50 ? '#F59E0B' : '#EF4444'),
          pointRadius: 5, tension: .3, fill: true, yAxisID: 'y'
        },
        {
          label: 'Incidents',
          data: incidentData,
          borderColor: '#EF4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointBackgroundColor: '#EF4444',
          pointRadius: 4, tension: .3,
          borderDash: [4,3], yAxisID: 'y2'
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Nunito', size: 12 } } }
      },
      scales: {
        y:  { min: 0, max: 100, ticks: { callback: v => v+'%' }, grid: { color: '#E2E8F0' } },
        y2: { position: 'right', min: 0, ticks: { stepSize: 1 }, grid: { display: false } }
      }
    }
  });
}

function renderGroupBarChart(canvasId, { labels, values }) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !labels.length) return;

  const isHorizontal = labels.length > 6;
  const barColors = values.map(v =>
    v >= 80 ? 'rgba(34,197,94,.75)' : v >= 50 ? 'rgba(245,158,11,.75)' : 'rgba(239,68,68,.75)'
  );

  _chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Avg Score %',
        data: values,
        backgroundColor: barColors,
        borderColor: barColors.map(c => c.replace('.75','.9')),
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: isHorizontal ? 'y' : 'x',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `Score: ${ctx.raw}%` } }
      },
      scales: {
        x: isHorizontal
          ? { min: 0, max: 100, ticks: { callback: v => v+'%' }, grid: { color: '#E2E8F0' } }
          : { grid: { display: false }, ticks: { font: { family: 'Nunito', size: 12 } } },
        y: isHorizontal
          ? { ticks: { font: { family: 'Nunito', size: 12 } }, grid: { display: false } }
          : { min: 0, max: 100, ticks: { callback: v => v+'%' }, grid: { color: '#E2E8F0' } }
      }
    }
  });
}

// ══════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ══════════════════════════════════════════════════════════════════════

function aggregateCheckins(checkins) {
  let totalScore = 0, totalPossible = 0, totalIncidents = 0, totalMinutes = 0;
  const incidentCounts = {};

  checkins.forEach(ci => {
    (ci.cico_period_scores || []).forEach(ps => {
      if (ps.score !== null) { totalScore += ps.score; totalPossible += 2; }
    });
    (ci.cico_incidents || []).forEach(inc => {
      totalIncidents++;
      if (inc.minutes) totalMinutes += inc.minutes;
      const abbr = inc.cico_incident_types?.abbreviation || 'Unknown';
      const desc = inc.cico_incident_types?.description  || '';
      const key  = inc.incident_type_id || abbr;
      if (!incidentCounts[key]) incidentCounts[key] = { abbr, desc, count: 0, minutes: 0 };
      incidentCounts[key].count++;
      if (inc.minutes) incidentCounts[key].minutes += inc.minutes;
    });
  });

  return { totalScore, totalPossible, totalIncidents, totalMinutes, incidentCounts };
}

function scorePctColor(pct) {
  if (pct === null) return 'var(--ci-text-2)';
  if (pct >= 80) return '#15803d';
  if (pct >= 50) return '#b45309';
  return '#b91c1c';
}

function destroyAllCharts() {
  Object.values(_chartInstances).forEach(c => { try { c.destroy(); } catch(e){} });
  _chartInstances = {};
}
