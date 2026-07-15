// ── Send Feedback — shared, standard component for all Cohort Logic products ──
//
// Drop-in: add ONE line to any product page, after supabase-config.js:
//   <script src="js/feedback.js?v=NN" data-product="Schedule Builder" data-key="schedule_builder"></script>
//
// Self-contained: injects its own floating button, modal, and styles. Fully
// CSP-safe — every handler is wired with addEventListener (NO inline onclick,
// which the site CSP `script-src 'self'` silently blocks). Styles are injected
// as a <style> element, allowed by `style-src 'unsafe-inline'`.
//
// data-product: human label shown in the modal ("Schedule Builder").
// data-key:     value stored in the feedback.product column ("schedule_builder",
//               "cico", "class_builder", "referrals", "dashboard"). Keep stable —
//               it's how feedback is bucketed per product.
//
// Submits to Supabase `feedback` { product, name, email, message }. Requires
// SupabaseClient (from supabase-config.js) to be present on the page.

(function () {
  if (window.__cohortFeedbackLoaded) return;      // guard against double-include
  window.__cohortFeedbackLoaded = true;

  // Read config synchronously while document.currentScript is still valid.
  var script = document.currentScript ||
    (function () { var s = document.querySelectorAll('script[src*="feedback.js"]'); return s[s.length - 1]; })();
  var PRODUCT_LABEL = (script && script.dataset.product) || 'Cohort Logic';
  var PRODUCT_KEY   = (script && script.dataset.key) || 'unknown';

  function init() {
    if (document.getElementById('cf-fb-btn')) return;   // already injected

    // ── Styles (namespaced cf-fb-*, self-contained so it works on any product
    //    regardless of which stylesheet it loads) ──
    var style = document.createElement('style');
    style.id = 'cf-fb-styles';
    style.textContent = [
      '.cf-fb-btn{position:fixed;right:18px;bottom:18px;z-index:9998;display:inline-flex;align-items:center;gap:6px;',
        'padding:10px 16px;background:#0ea5e9;color:#fff;border:none;border-radius:999px;font:600 14px/1 inherit;',
        'font-family:inherit;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.18);transition:transform .12s,box-shadow .12s;}',
      '.cf-fb-btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.24);}',
      '.cf-fb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;',
        'justify-content:center;padding:16px;}',
      '.cf-fb-overlay.cf-fb-hidden{display:none;}',
      '.cf-fb-modal{background:#fff;border-radius:12px;width:100%;max-width:460px;box-shadow:0 20px 60px rgba(0,0,0,.2);overflow:hidden;font-family:inherit;}',
      '.cf-fb-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 0;}',
      '.cf-fb-head h2{margin:0;font-size:18px;font-weight:700;color:#0a2240;}',
      '.cf-fb-close{background:none;border:none;font-size:18px;color:#9ca3af;cursor:pointer;line-height:1;padding:4px;}',
      '.cf-fb-close:hover{color:#0a2240;}',
      '.cf-fb-intro{margin:8px 20px 14px;font-size:13px;color:#6b7280;}',
      '.cf-fb-label{display:block;margin:0 20px 4px;font-size:12px;font-weight:600;color:#0a2240;}',
      '.cf-fb-input,.cf-fb-textarea{display:block;width:calc(100% - 40px);margin:0 20px 12px;padding:8px 10px;',
        'border:1px solid #d1d5db;border-radius:6px;font-size:14px;font-family:inherit;box-sizing:border-box;}',
      '.cf-fb-textarea{height:110px;resize:vertical;}',
      '.cf-fb-input:focus,.cf-fb-textarea:focus{outline:none;border-color:#0ea5e9;}',
      '.cf-fb-error{margin:0 20px 10px;font-size:13px;color:#ef4444;}',
      '.cf-fb-error.cf-fb-hidden{display:none;}',
      '.cf-fb-submit{display:block;width:calc(100% - 40px);margin:0 20px 20px;padding:10px;background:#0ea5e9;color:#fff;',
        'border:none;border-radius:6px;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;transition:opacity .15s;}',
      '.cf-fb-submit:hover{opacity:.88;}',
      '.cf-fb-submit:disabled{opacity:.5;cursor:not-allowed;}',
      '.cf-fb-thanks{padding:32px 20px;text-align:center;}',
      '.cf-fb-thanks.cf-fb-hidden{display:none;}',
      '.cf-fb-thanks-icon{font-size:40px;margin-bottom:12px;}',
      '.cf-fb-thanks h3{margin:0 0 8px;font-size:18px;color:#0a2240;}',
      '.cf-fb-thanks p{margin:0;font-size:14px;color:#6b7280;}',
      '@media print{.cf-fb-btn{display:none;}}'
    ].join('');
    document.head.appendChild(style);

    // ── DOM ──
    var esc = function (s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

    var btn = document.createElement('button');
    btn.id = 'cf-fb-btn';
    btn.className = 'cf-fb-btn';
    btn.type = 'button';
    btn.innerHTML = '💬 Send Feedback';
    document.body.appendChild(btn);

    var overlay = document.createElement('div');
    overlay.id = 'cf-fb-overlay';
    overlay.className = 'cf-fb-overlay cf-fb-hidden';
    overlay.innerHTML =
      '<div class="cf-fb-modal" role="dialog" aria-modal="true" aria-label="Send feedback">' +
        '<div class="cf-fb-head"><h2>Send Feedback</h2>' +
          '<button class="cf-fb-close" type="button" aria-label="Close">✕</button></div>' +
        '<p class="cf-fb-intro">Help us improve ' + esc(PRODUCT_LABEL) + '. All feedback is read by the Cohort Logic team.</p>' +
        '<div class="cf-fb-form">' +
          '<label class="cf-fb-label">Name</label>' +
          '<input type="text" class="cf-fb-input cf-fb-name" placeholder="Your name" />' +
          '<label class="cf-fb-label">Email</label>' +
          '<input type="email" class="cf-fb-input cf-fb-email" placeholder="your@email.com" />' +
          '<label class="cf-fb-label">Feedback <span style="color:#ef4444">*</span></label>' +
          '<textarea class="cf-fb-textarea cf-fb-message" placeholder="Tell us what\'s working, what\'s not, or what you\'d love to see…"></textarea>' +
          '<div class="cf-fb-error cf-fb-hidden"></div>' +
          '<button class="cf-fb-submit" type="button">Submit Feedback</button>' +
        '</div>' +
        '<div class="cf-fb-thanks cf-fb-hidden">' +
          '<div class="cf-fb-thanks-icon">✅</div><h3>Thank you!</h3>' +
          '<p>Your feedback helps us make ' + esc(PRODUCT_LABEL) + ' better for everyone. We appreciate you taking the time.</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var formEl   = overlay.querySelector('.cf-fb-form');
    var thanksEl = overlay.querySelector('.cf-fb-thanks');
    var errEl    = overlay.querySelector('.cf-fb-error');
    var nameEl   = overlay.querySelector('.cf-fb-name');
    var emailEl  = overlay.querySelector('.cf-fb-email');
    var msgEl    = overlay.querySelector('.cf-fb-message');
    var submitEl = overlay.querySelector('.cf-fb-submit');

    // Optional per-product enrichment. A product may define
    // window.getFeedbackContext() → { name, email, fields } to pre-fill the form
    // (name/email) and attach extra columns to the insert (e.g. CICO's user_id /
    // school_name). Absent or throwing → no enrichment.
    function ctx() {
      try { return (typeof window.getFeedbackContext === 'function' && window.getFeedbackContext()) || {}; }
      catch (e) { return {}; }
    }

    function open() {
      overlay.classList.remove('cf-fb-hidden');
      formEl.classList.remove('cf-fb-hidden');
      thanksEl.classList.add('cf-fb-hidden');
      errEl.classList.add('cf-fb-hidden');
      var c = ctx();
      if (c.name  && !nameEl.value)  nameEl.value  = c.name;
      if (c.email && !emailEl.value) emailEl.value = c.email;
      setTimeout(function () { msgEl.focus(); }, 30);
    }
    function close() { overlay.classList.add('cf-fb-hidden'); }
    function showErr(t) { errEl.textContent = t; errEl.classList.remove('cf-fb-hidden'); }

    async function submit() {
      var message = (msgEl.value || '').trim();
      if (!message) { showErr('Please enter your feedback before submitting.'); return; }
      errEl.classList.add('cf-fb-hidden');
      submitEl.disabled = true; submitEl.textContent = 'Submitting…';
      try {
        // SupabaseClient is a top-level `const` from supabase-config.js — a global
        // lexical binding, NOT a window property — so guard with typeof, not
        // window.SupabaseClient (which is always undefined and would always throw).
        if (typeof SupabaseClient === 'undefined') throw new Error('Feedback client unavailable');
        var payload = {
          product: PRODUCT_KEY,
          name:    (nameEl.value || '').trim()  || null,
          email:   (emailEl.value || '').trim() || null,
          message: message,
        };
        var fields = ctx().fields;
        if (fields) for (var k in fields) if (Object.prototype.hasOwnProperty.call(fields, k)) payload[k] = fields[k];
        var res = await SupabaseClient.from('feedback').insert(payload);
        if (res && res.error) throw res.error;
        formEl.classList.add('cf-fb-hidden');
        thanksEl.classList.remove('cf-fb-hidden');
      } catch (e) {
        showErr('Something went wrong. Please try again.');
      } finally {
        submitEl.disabled = false; submitEl.textContent = 'Submit Feedback';
      }
    }

    // ── Wiring (all addEventListener — CSP-safe) ──
    btn.addEventListener('click', open);
    overlay.querySelector('.cf-fb-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    submitEl.addEventListener('click', submit);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.classList.contains('cf-fb-hidden')) close();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
