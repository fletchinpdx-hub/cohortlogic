/**
 * referral-reports.js
 * Reports view: Referrals by Location / Behavior / Time of Day / Grade, plus a
 * Drill Down filter+group-by builder. One fetch per Generate; aggregation is
 * client-side. Mirrors the CICO reports' Chart.js lifecycle.
 */

let _repCharts = {};      // canvas id → Chart instance
let _repData   = [];      // cached referrals for the current date range/outcome
let _repTab    = 'location';
let _repDefaultsSet = false;

const REP_BAR_BG     = 'rgba(42,157,143,0.78)';
const REP_BAR_BORDER = 'rgba(42,157,143,1)';

// ── Init / defaults ───────────────────────────────────────────────────────
function _schoolYearStartISO() {
  const now = new Date();
  // School year starts Aug 1; before August, use last year's Aug 1.
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-08-01`;
}

function initReportsView() {
  if (!_repDefaultsSet) {
    document.getElementById('rep-from').value = _schoolYearStartISO();
    document.getElementById('rep-to').value   = refTodayISO();
    _populateDrilldownFilters();
    _repDefaultsSet = true;
  }
  loadReportData();
}

function _populateDrilldownFilters() {
  const fill = (id, items) => {
    document.getElementById(id).innerHTML =
      items.map(i => `<option value="${i.id}">${refEsc(i.label)}</option>`).join('');
  };
  fill('dd-behavior', RefState.behaviors);
  fill('dd-location', RefState.locations);
  fill('dd-action',   RefState.actions);
}

// ── Data ──────────────────────────────────────────────────────────────────
async function loadReportData() {
  const outcome = document.getElementById('rep-outcome').value;
  const from    = document.getElementById('rep-from').value;
  const to      = document.getElementById('rep-to').value;

  try {
    let query = SupabaseClient
      .from('referral_referrals')
      .select(`
        incident_date, incident_time, referral_type, grade_at_referral,
        location:referral_locations ( id, label ),
        behavior:referral_behaviors ( id, label ),
        action:referral_actions ( id, label ),
        motivation:referral_motivations ( id, label ),
        student:students ( id, grade, race_ethnicity, gender, iep )
      `)
      .limit(5000);

    if (outcome) query = query.eq('referral_type', outcome);
    if (from)    query = query.gte('incident_date', from);
    if (to)      query = query.lte('incident_date', to);

    const { data, error } = await query;
    if (error) throw error;
    _repData = data || [];
    renderActiveReport();
  } catch (err) {
    console.error('Load report data error:', err);
    refToast('Failed to load report data.', 'error');
  }
}

// ── Aggregation helpers ─────────────────────────────────────────────────────
function _gradeOf(r) { return r.grade_at_referral || r.student?.grade || 'Unknown'; }

function _countBy(rows, keyFn) {
  const m = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if (k === null || k === undefined || k === '') return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

// Both take a `key → count` Map and return {labels, values}.
function _orderByFreq(map) {
  const e = [...map.entries()].sort((a, b) => b[1] - a[1]);
  return { labels: e.map(x => x[0]), values: e.map(x => x[1]) };
}
function _orderByKey(map) { // numeric-aware natural sort on the key (e.g. grades)
  const e = [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  return { labels: e.map(x => x[0]), values: e.map(x => x[1]) };
}

// ── Chart rendering ─────────────────────────────────────────────────────────
function _renderBar(canvasId, labels, values, opts = {}) {
  if (_repCharts[canvasId]) { _repCharts[canvasId].destroy(); delete _repCharts[canvasId]; }
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;

  if (!labels.length) {
    _repCharts[canvasId] = new Chart(canvas, {
      type: 'bar',
      data: { labels: ['No data'], datasets: [{ data: [0], backgroundColor: '#e5e7eb' }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    });
    return;
  }

  const yTitle  = opts.yTitle || 'Number of Referrals';
  const tooltip = opts.tooltip || (ctx => `${ctx.parsed.y} referral${ctx.parsed.y !== 1 ? 's' : ''}`);
  const yScale  = { beginAtZero: true, title: { display: true, text: yTitle } };
  if (opts.yMax != null) yScale.max = opts.yMax; else yScale.ticks = { precision: 0 };

  _repCharts[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: yTitle,
        data: values,
        backgroundColor: REP_BAR_BG,
        borderColor: REP_BAR_BORDER,
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: tooltip } },
      },
      scales: {
        x: { ticks: { maxRotation: 60, minRotation: 0, autoSkip: false, font: { size: 11 } } },
        y: yScale,
      },
    },
  });
}

function _setSummary(count, label) {
  const el = document.getElementById('rep-summary');
  el.textContent = `${count} referral${count !== 1 ? 's' : ''}${label ? ' · ' + label : ''} in the selected range.`;
}

// ── Tab renderers ────────────────────────────────────────────────────────────
function renderActiveReport() {
  if (_repTab === 'location')  return renderLocationReport();
  if (_repTab === 'behavior')  return renderBehaviorReport();
  if (_repTab === 'time')      return renderTimeReport();
  if (_repTab === 'grade')     return renderGradeReport();
  if (_repTab === 'drilldown') return renderDrilldown();
  if (_repTab === 'equity')    return renderEquity();
}

function renderLocationReport() {
  const { labels, values } = _orderByFreq(_countBy(_repData, r => r.location?.label || 'Unknown'));
  _setSummary(_repData.length, 'by location');
  _renderBar('chart-location', labels, values);
}

function renderBehaviorReport() {
  const { labels, values } = _orderByFreq(_countBy(_repData, r => r.behavior?.label || 'Unknown'));
  _setSummary(_repData.length, 'by behavior');
  _renderBar('chart-behavior', labels, values);
}

function _hourLabel(hr) {
  const ampm = hr >= 12 ? 'PM' : 'AM';
  return `${hr % 12 || 12} ${ampm}`;
}

function renderTimeReport() {
  // Bucket by hour of day; only hours with data, ordered ascending.
  const buckets = new Map(); // hour(int) → count
  let timed = 0;
  _repData.forEach(r => {
    if (!r.incident_time) return;
    const hr = parseInt(String(r.incident_time).split(':')[0], 10);
    if (isNaN(hr)) return;
    timed++;
    buckets.set(hr, (buckets.get(hr) || 0) + 1);
  });
  const hours  = [...buckets.keys()].sort((a, b) => a - b);
  _setSummary(timed, 'with a recorded time');
  _renderBar('chart-time', hours.map(_hourLabel), hours.map(h => buckets.get(h)));
}

function renderGradeReport() {
  const { labels, values } = _orderByKey(_countBy(_repData, _gradeOf));
  _setSummary(_repData.length, 'by grade');
  _renderBar('chart-grade', labels, values);
}

// ── Drill down ───────────────────────────────────────────────────────────────
function _selectedValues(id) {
  return new Set([...document.getElementById(id).selectedOptions].map(o => o.value));
}

function renderDrilldown() {
  const behSet = _selectedValues('dd-behavior');
  const locSet = _selectedValues('dd-location');
  const actSet = _selectedValues('dd-action');
  const type   = document.getElementById('dd-type').value;
  const groupBy = document.getElementById('dd-groupby').value;

  let rows = _repData;
  if (behSet.size) rows = rows.filter(r => r.behavior && behSet.has(r.behavior.id));
  if (locSet.size) rows = rows.filter(r => r.location && locSet.has(r.location.id));
  if (actSet.size) rows = rows.filter(r => r.action   && actSet.has(r.action.id));
  if (type)        rows = rows.filter(r => r.referral_type === type);

  let keyFn, mode = 'freq';
  switch (groupBy) {
    case 'location':   keyFn = r => r.location?.label   || 'Unknown'; break;
    case 'behavior':   keyFn = r => r.behavior?.label   || 'Unknown'; break;
    case 'action':     keyFn = r => r.action?.label     || 'Unknown'; break;
    case 'motivation': keyFn = r => r.motivation?.label || 'Unknown'; break;
    case 'grade':      keyFn = _gradeOf; mode = 'natural'; break;
    case 'type':       keyFn = r => r.referral_type === 'major' ? 'Major' : 'Minor'; break;
    case 'month':      keyFn = null; break; // handled below
    default:           keyFn = r => r.location?.label || 'Unknown';
  }

  let ordered;
  if (groupBy === 'month') {
    const buckets = new Map(); // 'YYYY-MM' (sortable) → count
    rows.forEach(r => {
      if (!r.incident_date) return;
      const ym = String(r.incident_date).slice(0, 7);
      buckets.set(ym, (buckets.get(ym) || 0) + 1);
    });
    const keys = [...buckets.keys()].sort();
    const labels = keys.map(k => {
      const [y, mo] = k.split('-');
      return new Date(+y, +mo - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    });
    ordered = { labels, values: keys.map(k => buckets.get(k)) };
  } else {
    const counts = _countBy(rows, keyFn);
    ordered = (mode === 'natural') ? _orderByKey(counts) : _orderByFreq(counts);
  }

  _setSummary(rows.length, `grouped by ${groupBy}`);
  _renderBar('chart-drilldown', ordered.labels, ordered.values);
}

// ── Equity (Risk Index / Risk Ratio / Interpretations) ──────────────────────
function _studentGroupValue(s, dim) {
  if (dim === 'gender') return s.gender || 'Unspecified';
  if (dim === 'grade')  return s.grade ? `Grade ${s.grade}` : 'Unspecified';
  if (dim === 'iep')    return s.iep ? 'Has an IEP' : 'No IEP';
  return s.race_ethnicity || 'Unspecified'; // default: race
}

// Pure: given a roster, the set of student ids with ≥1 referral, and a grouping
// dimension, produce per-group enrollment / referral counts / risk index / risk
// ratio. Risk Ratio compares each group to ALL OTHER students.
function _computeEquity(students, referralStudentIds, dim) {
  const groups = new Map(); // label → { enrolled, withRef }
  students.forEach(s => {
    const g = _studentGroupValue(s, dim);
    if (!groups.has(g)) groups.set(g, { enrolled: 0, withRef: 0 });
    const rec = groups.get(g);
    rec.enrolled++;
    if (referralStudentIds.has(s.id)) rec.withRef++;
  });

  const totalEnrolled = students.length;
  const totalWithRef  = [...groups.values()].reduce((a, g) => a + g.withRef, 0);

  const rows = [...groups.entries()].map(([label, g]) => {
    const ri          = g.enrolled ? g.withRef / g.enrolled : 0;
    const otherEnroll = totalEnrolled - g.enrolled;
    const otherWith   = totalWithRef - g.withRef;
    const otherRI     = otherEnroll ? otherWith / otherEnroll : 0;
    const rr          = otherRI ? ri / otherRI : null; // null = no comparison group
    return { label, enrolled: g.enrolled, withRef: g.withRef, ri, rr };
  }).sort((a, b) => b.ri - a.ri);

  return { rows, totalEnrolled, totalWithRef };
}

function renderEquity() {
  const dim = document.getElementById('eq-group').value;
  const out = document.getElementById('eq-output');

  // Numerator source: distinct enrolled students with ≥1 referral in the current
  // outcome/date-range selection (_repData is already filtered by those controls).
  const referralStudentIds = new Set();
  _repData.forEach(r => { if (r.student?.id) referralStudentIds.add(r.student.id); });

  const { rows, totalEnrolled, totalWithRef } = _computeEquity(RefState.students, referralStudentIds, dim);

  if (!totalEnrolled) {
    out.innerHTML = '<p class="empty-state">No students on the roster yet — add students to see equity data.</p>';
    _renderBar('chart-equity', [], []);
    return;
  }

  _setSummary(totalWithRef, `students with ≥1 referral, of ${totalEnrolled} enrolled`);

  // Risk Index bar chart (0–1 scale)
  _renderBar('chart-equity', rows.map(r => r.label), rows.map(r => +r.ri.toFixed(4)), {
    yTitle: 'Risk Index', yMax: 1,
    tooltip: ctx => `Risk Index ${ctx.parsed.y.toFixed(2)}`,
  });

  const pct = v => `${(v * 100).toFixed(2)}%`;
  const riskRows = rows.map(r => `
    <tr>
      <td>${refEsc(r.label)}</td>
      <td style="text-align:right;">${r.enrolled}</td>
      <td style="text-align:right;">${r.withRef}</td>
      <td style="text-align:right;">${pct(r.ri)}</td>
      <td style="text-align:right;">${r.ri.toFixed(2)}</td>
      <td style="text-align:right;">${r.rr == null ? '—' : r.rr.toFixed(2)}</td>
    </tr>`).join('');

  const interpretations = rows.map(r =>
    `<li>Of the <strong>${r.enrolled}</strong> students in <strong>${refEsc(r.label)}</strong>, <strong>${pct(r.ri)}</strong> have at least one referral.</li>`
  ).join('');

  out.innerHTML = `
    <div class="eq-section">
      <h3>Risk Index &amp; Risk Ratio</h3>
      <p class="eq-note">Risk Index = students with ≥1 referral ÷ enrolled, per group. Risk Ratio compares a group's Risk Index to that of all other students (1.0 = equal; &gt;1 = over-represented).</p>
      <table class="cico-table">
        <thead>
          <tr>
            <th>Group</th>
            <th style="text-align:right;">Enrolled</th>
            <th style="text-align:right;">With Referral</th>
            <th style="text-align:right;">% Within Group</th>
            <th style="text-align:right;">Risk Index</th>
            <th style="text-align:right;">Risk Ratio</th>
          </tr>
        </thead>
        <tbody>${riskRows}</tbody>
        <tfoot>
          <tr style="font-weight:700;">
            <td>Total</td>
            <td style="text-align:right;">${totalEnrolled}</td>
            <td style="text-align:right;">${totalWithRef}</td>
            <td style="text-align:right;">${pct(totalEnrolled ? totalWithRef / totalEnrolled : 0)}</td>
            <td></td><td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div class="eq-section">
      <h3>Interpretations</h3>
      <ul class="eq-interpretations">${interpretations}</ul>
    </div>`;
}

// ── Tabs ──────────────────────────────────────────────────────────────────
function switchReportTab(tab) {
  _repTab = tab;
  document.querySelectorAll('.report-tab').forEach(t => t.classList.toggle('active', t.dataset.report === tab));
  document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${tab}`).classList.add('active');
  renderActiveReport();
}

// ── Event binding ───────────────────────────────────────────────────────────
function bindReportEvents() {
  document.getElementById('rep-generate-btn').addEventListener('click', loadReportData);
  document.querySelectorAll('.report-tab').forEach(t =>
    t.addEventListener('click', () => switchReportTab(t.dataset.report)));
  document.getElementById('dd-apply-btn').addEventListener('click', renderDrilldown);
  document.getElementById('eq-group').addEventListener('change', renderEquity);
}
