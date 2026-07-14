/**
 * referral-review.js
 * Review queue (reviewers only): list referrals sent for review, open one,
 * add reviewer notes, and mark it reviewed. Visibility is gated to
 * school_admin / super_admin in referral-state.js; RLS is the real backstop.
 */

const REVIEW_SELECT = `
  id, incident_date, incident_time, referral_type, referring_staff, notes, status,
  student:students ( first_name, last_name, grade ),
  behavior:referral_behaviors ( label ),
  action:referral_actions ( label ),
  location:referral_locations ( label )
`;

// Lightweight badge count, refreshed at startup and after each review.
async function refreshReviewBadge() {
  const badge = document.getElementById('review-badge');
  if (!badge) return;
  const { count, error } = await SupabaseClient
    .from('referral_referrals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review');
  if (error) return;
  if (count && count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function loadReviewQueue() {
  const container = document.getElementById('review-results');
  container.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    const { data, error } = await SupabaseClient
      .from('referral_referrals')
      .select(REVIEW_SELECT)
      .eq('status', 'pending_review')
      .order('incident_date', { ascending: true })
      .order('incident_time', { ascending: true, nullsFirst: true })
      .limit(200);
    if (error) throw error;

    refreshReviewBadge();

    if (!data || !data.length) {
      container.innerHTML = '<p class="empty-state">Nothing waiting for review. 🎉</p>';
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
          <td>${refEsc(r.action?.label) || '—'}</td>
          <td><button class="btn-cico btn-outline-cico btn-sm-cico" data-review-id="${r.id}">Review</button></td>
        </tr>`;
    }).join('');

    container.innerHTML = `
      <p style="font-size:13px;color:#6b7280;margin:0 0 10px;">${data.length} awaiting review</p>
      <table class="cico-table">
        <thead><tr><th>Date</th><th>Student</th><th>Type</th><th>Behavior</th><th>Action Taken</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    // Stash for the modal (avoid a re-fetch).
    _reviewCache = {};
    data.forEach(r => { _reviewCache[r.id] = r; });
  } catch (err) {
    console.error('Load review queue error:', err);
    container.innerHTML = '<p class="empty-state" style="color:#ef4444;">Failed to load the review queue.</p>';
  }
}

let _reviewCache = {};

function openReviewModal(id) {
  const r = _reviewCache[id];
  if (!r) return;
  document.getElementById('review-ref-id').value = id;
  document.getElementById('review-notes').value = '';
  const stu  = r.student ? `${refEsc(r.student.last_name)}, ${refEsc(r.student.first_name)}` : 'Unknown student';
  const when = `${refFormatDate(r.incident_date)}${r.incident_time ? ' · ' + refFormatTime(r.incident_time) : ''}`;
  document.getElementById('review-detail').innerHTML = `
    <div style="display:grid;grid-template-columns:90px 1fr;gap:4px 10px;">
      <strong>Student</strong><span>${stu}${r.student?.grade ? ' · Gr ' + refEsc(r.student.grade) : ''}</span>
      <strong>When</strong><span>${when}</span>
      <strong>Behavior</strong><span>${refEsc(r.behavior?.label) || '—'}</span>
      <strong>Location</strong><span>${refEsc(r.location?.label) || '—'}</span>
      <strong>Action</strong><span>${refEsc(r.action?.label) || '—'}</span>
      <strong>Staff</strong><span>${refEsc(r.referring_staff) || '—'}</span>
      ${r.notes ? `<strong>Notes</strong><span>${refEsc(r.notes)}</span>` : ''}
    </div>`;
  document.getElementById('review-modal').classList.remove('hidden');
}

function closeReviewModal() {
  document.getElementById('review-modal').classList.add('hidden');
}

async function markReviewed() {
  const id = document.getElementById('review-ref-id').value;
  if (!id) return;
  const notes = document.getElementById('review-notes').value.trim() || null;
  const btn = document.getElementById('review-mark-done');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const { error } = await SupabaseClient
      .from('referral_referrals')
      .update({
        status:         'reviewed',
        reviewed_by:    RefState.currentUser.id,
        reviewed_at:    new Date().toISOString(),
        reviewer_notes: notes,
      })
      .eq('id', id);
    if (error) throw error;
    refToast('✅ Marked reviewed.', 'success');
    closeReviewModal();
    loadReviewQueue();
  } catch (err) {
    console.error('Mark reviewed error:', err);
    refToast('Failed to save review.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Mark Reviewed';
  }
}

function bindReviewEvents() {
  document.querySelector('#review-modal .cico-modal-backdrop').addEventListener('click', closeReviewModal);
  document.getElementById('review-modal-close').addEventListener('click', closeReviewModal);
  document.getElementById('review-modal-cancel').addEventListener('click', closeReviewModal);
  document.getElementById('review-mark-done').addEventListener('click', markReviewed);
  document.getElementById('review-results').addEventListener('click', e => {
    const btn = e.target.closest('[data-review-id]');
    if (btn) openReviewModal(btn.getAttribute('data-review-id'));
  });
}
