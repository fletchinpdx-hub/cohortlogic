const SUPABASE_URL = 'https://dlqnzlwuzktcljxxxlit.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RoK_SBEyXYfp11RfTmh26g_7VLumGSe';

const SupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getSessionToken() {
  let token = sessionStorage.getItem('cl_session_token');
  if (!token) {
    token = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('cl_session_token', token);
  }
  return token;
}

async function trackSession() {
  try {
    const { error } = await SupabaseClient.from('sessions').upsert(
      { session_token: getSessionToken(), user_agent: navigator.userAgent },
      { onConflict: 'session_token' }
    );
    if (error) console.warn('[CL tracking] session:', error.message);
  } catch (e) {
    console.warn('[CL tracking] session exception:', e.message);
  }
}

async function trackEvent(name, data = {}) {
  try {
    const { error } = await SupabaseClient.from('events').insert({
      session_token: getSessionToken(),
      event_name: name,
      event_data: data,
    });
    if (error) console.warn('[CL tracking] event:', error.message);
  } catch (e) {
    console.warn('[CL tracking] event exception:', e.message);
  }
}
