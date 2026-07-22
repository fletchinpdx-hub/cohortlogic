// entitlements.js — single source of truth for trial/paid access gating.
//
// Access is read from Supabase (server-authoritative — never trust localStorage)
// via the my_entitlement() RPC, which returns ONLY access info (no fees/Stripe ids).
// Access levels:
//   'full'    — paid: no gating.
//   'trial'   — limited: only the trial grade (1st), no export / print / save session.
//   'expired' — time-limited trial ended: hard lockout.
//
// Load AFTER supabase-config.js and BEFORE the app's own scripts. Call
// `await Entitlements.load()` once at boot before rendering gated UI.
//
// NOTE: Class Builder runs entirely client-side, so gating is enforced in the
// browser and is bypassable by a technical user. That's an accepted trade for a
// trial — the ENTITLEMENT itself is server-authoritative (can't be spoofed via
// localStorage); only the UI enforcement is client-side.

const Entitlements = (() => {
  // Fail SAFE (to the limited tier) until the real state loads.
  let _state = { access: 'trial', tier: 'individual', status: 'trial', trialEndsAt: null, loaded: false };

  async function load() {
    try {
      if (typeof SupabaseClient !== 'undefined' && SupabaseClient) {
        const { data, error } = await SupabaseClient.rpc('my_entitlement');
        const row = Array.isArray(data) ? data[0] : data;
        if (!error && row) {
          _state = {
            access: row.access || 'trial',
            tier: row.tier || 'individual',
            status: row.status || 'trial',
            trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
            loaded: true,
          };
        }
      }
    } catch (_) { /* network/RPC error → stay on the safe limited tier */ }
    _state.loaded = true;
    return _state;
  }

  const isFull    = () => _state.access === 'full';
  const isTrial   = () => _state.access === 'trial';
  const isExpired = () => _state.access === 'expired';

  // "First Grade Unlocked" — normalize the varied labels schools use for 1st grade.
  function isTrialGrade(g) {
    if (g == null) return false;
    const s = String(g).trim().toLowerCase().replace(/\s+/g, ' ');
    return ['1', '01', '1st', 'first', 'grade 1', 'g1', '1st grade', 'first grade'].includes(s);
  }
  // The unlocked trial grade present in a list of roster grades, or null if none.
  function unlockedGrade(grades) {
    return (grades || []).find(isTrialGrade) || null;
  }

  // Whole days remaining on a time-limited trial (null if no clock / not a trial).
  function daysLeft() {
    if (!_state.trialEndsAt) return null;
    return Math.max(0, Math.ceil((_state.trialEndsAt.getTime() - Date.now()) / 86400000));
  }

  // Feature gate. In the trial, export / print / save-session are locked; on a full
  // plan everything is allowed. Grade access is handled separately via unlockedGrade.
  const GATED = new Set(['export', 'print', 'save']);
  function allows(feature) {
    if (isFull()) return true;
    if (isExpired()) return false;
    return !GATED.has(feature);
  }

  // Fire a telemetry event when a trial user bumps into a gated feature. Gives
  // visibility into conversion friction / abuse without walling anything off.
  function gateHit(feature, extra) {
    try {
      if (typeof trackEvent === 'function') {
        trackEvent('cb_gate_hit', { feature, tier: _state.tier, access: _state.access, ...(extra || {}) });
      }
    } catch (_) { /* telemetry is best-effort */ }
  }

  return {
    load, isFull, isTrial, isExpired, isTrialGrade, unlockedGrade, daysLeft, allows, gateHit,
    tier: () => _state.tier,
    state: () => ({ ..._state }),
  };
})();
