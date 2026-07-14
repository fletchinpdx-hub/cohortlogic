// Auth gate — must be logged in and approved to access the app.
// Loaded synchronously in <head> after supabase-js and supabase-config.js.
(async () => {
  const { data: { session } } = await SupabaseClient.auth.getSession();
  if (!session) { window.location.replace('login.html'); return; }
  const { data: profile } = await SupabaseClient
    .from('profiles').select('approved').eq('id', session.user.id).single();
  if (!profile || !profile.approved) { window.location.replace('dashboard.html'); }
})();
