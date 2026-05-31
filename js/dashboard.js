async function init() {
  const { data: { session } } = await SupabaseClient.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  const { data: profile } = await SupabaseClient
    .from('profiles')
    .select('full_name, school_name, approved')
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
