async function init() {
  const { data: { session } } = await SupabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  const { data: profile } = await SupabaseClient
    .from('profiles')
    .select('full_name, school_name, school_id, approved, role')
    .eq('id', session.user.id)
    .single();

  const firstName = profile?.full_name?.split(' ')[0] || session.user.email;
  document.getElementById('user-greeting').textContent = firstName;

  if (!profile || !profile.approved) {
    document.getElementById('pending-state').style.display = 'flex';
  } else {
    document.getElementById('dashboard-state').style.display = 'block';
    if (profile.school_name) {
      document.getElementById('school-line').textContent = profile.school_name;
    }

    // Show gated product cards based on what the school has enabled
    if (profile.school_id) {
      const { data: school } = await SupabaseClient
        .from('schools')
        .select('enabled_products')
        .eq('id', profile.school_id)
        .single();
      const enabled = school?.enabled_products || [];
      if (enabled.includes('schedule_builder')) {
        document.getElementById('schedule-card').style.display = '';
      }
    }

    // Role-aware admin link. The link is convenience only — the admin panels
    // re-verify role server-side (+ RLS), so a non-admin who reaches the URL is
    // still bounced. Super admins go to their own panel; school admins to theirs.
    const adminLink = document.getElementById('admin-link');
    if (profile.role === 'super_admin') {
      adminLink.href = 'admin/';
      adminLink.firstChild.textContent = 'Open admin panel ';
      adminLink.style.display = 'inline-flex';
    } else if (profile.role === 'school_admin') {
      adminLink.href = 'school-admin/';
      adminLink.style.display = 'inline-flex';
    }
  }
}

async function doSignOut() {
  await SupabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.sign-out-btn').forEach(btn => {
    btn.addEventListener('click', doSignOut);
  });
  init();
});
