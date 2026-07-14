/**
 * referral-list.js
 * Referrals view: filter by student / type / date range and list results.
 */

function _statusPill(status) {
  if (status === 'pending_review') return '<span class="ref-pill ref-pill-review">Pending review</span>';
  if (status === 'reviewed')       return '<span class="ref-pill ref-pill-reviewed">Reviewed</span>';
  return '<span class="ref-pill ref-pill-open">Open</span>';
}

function _populateListStudentFilter() {
  const sel = document.getElementById('list-student-sel');
  const current = sel.value;
  sel.innerHTML = '<option value="">All students</option>' +
    RefState.students.map(s =>
      `<option value="${s.id}">${refEsc(s.last_name)}, ${refEsc(s.first_name)}</option>`).join('');
  sel.value = current;
}

async function loadReferrals() {
  _populateListStudentFilter();
  const container = document.getElementById('ref-list-results');
  container.innerHTML = '<p class="empty-state">Loading…</p>';

  const studentId = document.getElementById('list-student-sel').value;
  const type      = document.getElementById('list-type-sel').value;
  const from      = document.getElementById('list-from').value;
  const to        = document.getElementById('list-to').value;

  try {
    let query = SupabaseClient
      .from('referral_referrals')
      .select(`
        id, incident_date, incident_time, referral_type, referring_staff,
        seclusion_restraint, notes, status,
        student:students ( first_name, last_name, grade ),
        location:referral_locations ( label ),
        behavior:referral_behaviors ( label ),
        action:referral_actions ( label )
      `)
      .order('incident_date', { ascending: false })
      .order('incident_time', { ascending: false, nullsFirst: false })
      .limit(200);

    if (studentId) query = query.eq('student_id', studentId);
    if (type)      query = query.eq('referral_type', type);
    if (from)      query = query.gte('incident_date', from);
    if (to)        query = query.lte('incident_date', to);

    const { data, error } = await query;
    if (error) throw error;

    if (!data || !data.length) {
      container.innerHTML = '<p class="empty-state">No referrals found for these filters.</p>';
      return;
    }

    const rows = data.map(r => {
      const stu  = r.student ? `${refEsc(r.student.last_name)}, ${refEsc(r.student.first_name)}` : 'Unknown';
      const when = `${refFormatDate(r.incident_date)}${r.incident_time ? ' · ' + refFormatTime(r.incident_time) : ''}`;
      const typeTag = r.referral_type === 'major'
        ? '<span class="ref-pill ref-pill-major">Major</span>'
        : '<span class="ref-pill ref-pill-minor">Minor</span>';
      return `
        <tr>
          <td>${when}</td>
          <td>${stu}</td>
          <td>${typeTag}</td>
          <td>${refEsc(r.behavior?.label) || '—'}</td>
          <td>${refEsc(r.location?.label) || '—'}</td>
          <td>${refEsc(r.action?.label) || '—'}</td>
          <td>${_statusPill(r.status)}</td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <p style="font-size:13px;color:#6b7280;margin:0 0 10px;">${data.length} referral${data.length !== 1 ? 's' : ''}${data.length === 200 ? ' (showing most recent 200)' : ''}</p>
      <table class="cico-table">
        <thead>
          <tr><th>Date</th><th>Student</th><th>Type</th><th>Behavior</th><th>Location</th><th>Action Taken</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    console.error('Load referrals error:', err);
    container.innerHTML = '<p class="empty-state" style="color:#ef4444;">Failed to load referrals. Please try again.</p>';
  }
}

function bindListEvents() {
  _populateListStudentFilter();
  document.getElementById('list-search-btn').addEventListener('click', loadReferrals);
}
