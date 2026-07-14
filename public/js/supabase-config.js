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

async function logError(product, errorType, message, userEmail) {
  try {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    if (/Edg\//.test(ua))     browser = 'Edge';
    else if (/Chrome\//.test(ua))  browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua))  browser = 'Safari';

    let os = 'Unknown';
    if (/iPhone|iPad/.test(ua))   os = 'iOS';
    else if (/Android/.test(ua))  os = 'Android';
    else if (/Windows/.test(ua))  os = 'Windows';
    else if (/Mac OS X/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua))    os = 'Linux';

    await SupabaseClient.from('error_logs').insert({
      product,
      error_type:  errorType,
      message:     String(message || '').slice(0, 1000),
      url:         window.location.href,
      browser:     `${browser} / ${os}`,
      user_email:  userEmail || null,
    });
  } catch (e) {
    console.warn('[CL error log]', e.message);
  }
}
