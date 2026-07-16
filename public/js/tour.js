// Class Builder — interactive intro tour (coach-marks).
// Self-contained, CSP-safe (all handlers via addEventListener; no inline JS).
// Auto-launches once on first visit; replayable anytime from the sidebar button.
//
// Mirrors the feedback.js pattern: injects its own <style> + DOM, guards against
// double-include, and namespaces everything under `cb-tour-*`.
(function () {
  if (window.__cbTourLoaded) return;
  window.__cbTourLoaded = true;

  var SEEN_KEY = 'cb_tour_v1_done';

  // ── Tour script ─────────────────────────────────────────────────────────────
  // Each step navigates the main panel to `view` (via the app's global
  // navigateTo) and spotlights the matching sidebar nav item. `view: null`
  // renders a centered card (welcome / finish) with no spotlight.
  var STEPS = [
    {
      view: null,
      title: 'Welcome to Class Builder 👋',
      body: 'Class Builder turns your student roster into balanced, equitable classes in a few minutes. Here\'s a quick 60-second tour of how it works.',
      primary: 'Start tour →',
      secondary: 'Skip'
    },
    {
      view: 'school',
      anchor: '[data-view="school"]',
      step: 1,
      title: 'School Profile',
      body: 'Start here. Add your school name (and district, if you like). This travels with your saved file so it can be shared with Schedule Builder.'
    },
    {
      view: 'import',
      anchor: '[data-view="import"]',
      step: 2,
      title: 'Import & Export',
      body: 'Everything to do with files lives here. Upload your roster (Excel or CSV) — it stays in your browser and is never sent to a server. It\'s also where you save your work as a .cohortlogic file, reopen it later, and download the finished class lists. No roster yet? Grab the sample or a blank template.'
    },
    {
      view: 'fields',
      anchor: '[data-view="fields"]',
      step: 3,
      title: 'Map your columns',
      body: 'Tell Class Builder which columns hold names and grade, and which scores or flags to balance on — like Math, Reading, Behavior, IEP, or Gender. Add or remove fields to match how your school tracks data.'
    },
    {
      view: 'classes',
      anchor: '[data-view="classes"]',
      step: 4,
      title: 'Set up your classes',
      body: 'For each grade, choose how many classes you need and assign teachers. This tells the balancer how many buckets to spread students across.'
    },
    {
      view: 'students',
      anchor: '[data-view="students"]',
      step: 5,
      title: 'Rules, then generate',
      body: 'Review your students and set placement rules — Keep Apart, Keep Together, and Keep with Teacher. When you\'re ready, hit “⚡ Generate Balanced Classes.”'
    },
    {
      view: 'results',
      anchor: '[data-view="results"]',
      step: 6,
      title: 'Review & export',
      body: 'See your balanced classes with at-a-glance stats. Drag students between classes to fine-tune, then export by grade or teacher — or save the session to pick up later.'
    },
    {
      view: null,
      title: 'You\'re all set 🎉',
      body: 'That\'s the whole flow. You can replay this tour anytime from the “Take the tour” button at the bottom of the sidebar.',
      primary: 'Get started',
      secondary: null
    }
  ];

  var idx = 0;
  var els = {}; // { overlay, spotlight, card, ... }

  // ── Styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('cb-tour-style')) return;
    var css =
      '#cb-tour-overlay{position:fixed;inset:0;z-index:10000;pointer-events:none;font-family:"Nunito",system-ui,sans-serif}' +
      '#cb-tour-overlay.active{pointer-events:auto}' +
      // Dim layer (used for centered cards with no spotlight)
      '#cb-tour-dim{position:fixed;inset:0;background:rgba(10,34,64,.55);opacity:0;transition:opacity .2s ease}' +
      '#cb-tour-dim.show{opacity:1}' +
      // Spotlight: box-shadow creates the dim + a cutout hole around the anchor
      '#cb-tour-spot{position:fixed;border-radius:10px;box-shadow:0 0 0 9999px rgba(10,34,64,.62);' +
      'outline:3px solid #0ea5e9;outline-offset:2px;transition:all .25s cubic-bezier(.4,0,.2,1);pointer-events:none}' +
      '#cb-tour-spot.hidden{display:none}' +
      // Card
      '#cb-tour-card{position:fixed;width:340px;max-width:calc(100vw - 32px);background:#fff;border-radius:14px;' +
      'box-shadow:0 18px 50px rgba(10,34,64,.35);padding:20px 20px 16px;box-sizing:border-box;' +
      'opacity:0;transform:translateY(6px);transition:opacity .2s ease,transform .2s ease}' +
      '#cb-tour-card.show{opacity:1;transform:translateY(0)}' +
      '#cb-tour-card .cb-tour-badge{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.04em;' +
      'text-transform:uppercase;color:#0ea5e9;margin-bottom:6px}' +
      '#cb-tour-card h3{margin:0 0 8px;font-size:18px;font-weight:800;color:#0a2240;line-height:1.25}' +
      '#cb-tour-card p{margin:0 0 16px;font-size:14px;line-height:1.5;color:#475569}' +
      '#cb-tour-card .cb-tour-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '#cb-tour-dots{display:flex;gap:6px}' +
      '#cb-tour-dots span{width:7px;height:7px;border-radius:50%;background:#cbd5e1;transition:background .2s}' +
      '#cb-tour-dots span.on{background:#0ea5e9}' +
      '#cb-tour-card .cb-tour-btns{display:flex;gap:8px;align-items:center}' +
      '.cb-tour-btn{font-family:inherit;font-weight:700;font-size:13px;border-radius:8px;padding:8px 14px;' +
      'cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s}' +
      '.cb-tour-btn-primary{background:#0ea5e9;color:#fff}' +
      '.cb-tour-btn-primary:hover{background:#0284c7}' +
      '.cb-tour-btn-ghost{background:transparent;color:#64748b;border-color:#e2e8f0}' +
      '.cb-tour-btn-ghost:hover{background:#f1f5f9}' +
      '#cb-tour-skip{position:absolute;top:12px;right:12px;background:none;border:none;color:#94a3b8;' +
      'font-size:12px;font-weight:700;cursor:pointer;padding:4px}' +
      '#cb-tour-skip:hover{color:#475569}' +
      // Replay launcher in the sidebar
      '#cb-tour-launch{display:block;width:100%;margin-top:10px;background:rgba(255,255,255,.08);' +
      'border:1px solid rgba(255,255,255,.18);color:#fff;font-family:inherit;font-weight:700;font-size:12px;' +
      'border-radius:8px;padding:8px 10px;cursor:pointer;text-align:center;transition:background .15s}' +
      '#cb-tour-launch:hover{background:rgba(255,255,255,.16)}' +
      '@media (max-width:640px){#cb-tour-card{width:calc(100vw - 24px)}}';
    var style = document.createElement('style');
    style.id = 'cb-tour-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── DOM build ─────────────────────────────────────────────────────────────
  function buildOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'cb-tour-overlay';

    var dim = document.createElement('div');
    dim.id = 'cb-tour-dim';

    var spot = document.createElement('div');
    spot.id = 'cb-tour-spot';
    spot.className = 'hidden';

    var card = document.createElement('div');
    card.id = 'cb-tour-card';

    var skip = document.createElement('button');
    skip.id = 'cb-tour-skip';
    skip.type = 'button';
    skip.textContent = 'Skip ✕';
    skip.addEventListener('click', end);

    var badge = document.createElement('span');
    badge.className = 'cb-tour-badge';

    var h3 = document.createElement('h3');
    var p = document.createElement('p');

    var foot = document.createElement('div');
    foot.className = 'cb-tour-foot';

    var dots = document.createElement('div');
    dots.id = 'cb-tour-dots';

    var btns = document.createElement('div');
    btns.className = 'cb-tour-btns';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'cb-tour-btn cb-tour-btn-ghost';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', function () { go(idx - 1); });

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'cb-tour-btn cb-tour-btn-primary';
    nextBtn.addEventListener('click', function () {
      if (idx >= STEPS.length - 1) { end(); } else { go(idx + 1); }
    });

    btns.appendChild(backBtn);
    btns.appendChild(nextBtn);
    foot.appendChild(dots);
    foot.appendChild(btns);

    card.appendChild(skip);
    card.appendChild(badge);
    card.appendChild(h3);
    card.appendChild(p);
    card.appendChild(foot);

    overlay.appendChild(dim);
    overlay.appendChild(spot);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    els = { overlay: overlay, dim: dim, spot: spot, card: card, skip: skip,
            badge: badge, h3: h3, p: p, dots: dots, backBtn: backBtn, nextBtn: nextBtn };

    // Build the progress dots once.
    for (var i = 1; i < STEPS.length - 1; i++) {
      var d = document.createElement('span');
      dots.appendChild(d);
    }
  }

  // ── Positioning ───────────────────────────────────────────────────────────
  function positionForStep(s) {
    var card = els.card, spot = els.spot, dim = els.dim;
    var pad = 16;

    if (!s.view || !s.anchor) {
      // Centered card, full dim, no spotlight.
      spot.className = 'hidden';
      dim.classList.add('show');
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      // .show class re-adds translateY(0); override with the centering transform.
      requestAnimationFrame(function () { card.style.transform = 'translate(-50%, -50%)'; });
      return;
    }

    var anchor = document.querySelector(s.anchor);
    // Fall back to a centered card (full dim, no spotlight) when the anchor is
    // missing OR hidden — e.g. the sidebar nav collapses behind a hamburger on
    // mobile, so the nav item has no client rects. The view still navigates, so
    // the tour reads as a sequence of centered cards over the real pages.
    if (!anchor || anchor.getClientRects().length === 0) {
      spot.className = 'hidden';
      dim.classList.add('show');
      card.style.left = '50%'; card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      requestAnimationFrame(function () { card.style.transform = 'translate(-50%, -50%)'; });
      return;
    }

    dim.classList.remove('show'); // spotlight box-shadow provides the dim instead
    var r = anchor.getBoundingClientRect();
    var sp = 6;
    spot.className = '';
    spot.style.left = (r.left - sp) + 'px';
    spot.style.top = (r.top - sp) + 'px';
    spot.style.width = (r.width + sp * 2) + 'px';
    spot.style.height = (r.height + sp * 2) + 'px';

    // The step anchors are nav items stacked in the sidebar. Keep the card at a
    // STABLE spot — just right of the anchor, vertically centered in the viewport —
    // so only the spotlight moves between steps (no jarring vertical jumps, and it
    // never clutters over the page heading near the top).
    var cardW = card.offsetWidth || 340;
    var cardH = card.offsetHeight || 200;
    var left = r.right + pad + 8;
    var top = (window.innerHeight - cardH) / 2;

    if (left + cardW > window.innerWidth - pad) {
      // Narrow screen (e.g. collapsed sidebar / mobile) — place below the anchor.
      left = Math.min(r.left, window.innerWidth - cardW - pad);
      top = r.bottom + pad;
    }
    // Clamp within the viewport.
    left = Math.max(pad, Math.min(left, window.innerWidth - cardW - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - cardH - pad));

    card.style.transform = '';
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  // ── Render a step ─────────────────────────────────────────────────────────
  function go(n) {
    if (n < 0 || n >= STEPS.length) return;
    idx = n;
    var s = STEPS[idx];

    // Drive the real app to the matching view.
    if (s.view && typeof window.navigateTo === 'function') {
      try { window.navigateTo(s.view); } catch (e) { /* no-op */ }
    }

    els.badge.style.display = s.step ? 'inline-block' : 'none';
    els.badge.textContent = s.step ? ('Step ' + s.step + ' of 6') : '';
    els.h3.textContent = s.title;
    els.p.textContent = s.body;

    els.backBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
    els.nextBtn.textContent = s.primary || (idx >= STEPS.length - 1 ? 'Done' : 'Next →');
    els.skip.style.display = (idx === STEPS.length - 1) ? 'none' : 'block';

    // Progress dots reflect the 6 numbered steps (indices 1..6).
    var dotEls = els.dots.children;
    for (var i = 0; i < dotEls.length; i++) {
      dotEls[i].className = (idx >= 1 && (i + 1) <= idx) ? 'on' : '';
    }
    els.dots.style.visibility = s.step ? 'visible' : 'hidden';

    // Force a reflow-free measure then position.
    els.card.classList.remove('show');
    requestAnimationFrame(function () {
      positionForStep(s);
      els.card.classList.add('show');
    });
  }

  function reposition() {
    if (!els.overlay || !els.overlay.classList.contains('active')) return;
    positionForStep(STEPS[idx]);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  function start() {
    if (!els.overlay) { injectStyles(); buildOverlay(); }
    idx = 0;
    els.overlay.classList.add('active');
    els.card.classList.remove('show');
    go(0);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('keydown', onKey);
  }

  function end() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    if (els.overlay) els.overlay.classList.remove('active');
    if (els.dim) els.dim.classList.remove('show');
    if (els.card) els.card.classList.remove('show');
    if (els.spot) els.spot.className = 'hidden';
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') { end(); }
    else if (e.key === 'ArrowRight') { if (idx < STEPS.length - 1) go(idx + 1); }
    else if (e.key === 'ArrowLeft') { if (idx > 0) go(idx - 1); }
  }

  // ── Sidebar replay launcher ───────────────────────────────────────────────
  function injectLauncher() {
    var footer = document.getElementById('sidebar-footer');
    if (!footer || document.getElementById('cb-tour-launch')) return;
    var btn = document.createElement('button');
    btn.id = 'cb-tour-launch';
    btn.type = 'button';
    btn.textContent = '🎬 Take the tour';
    btn.addEventListener('click', start);
    footer.appendChild(btn);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    injectStyles();
    injectLauncher();
    var seen;
    try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { seen = '1'; }
    if (!seen) {
      // Let the app finish its first paint before launching.
      setTimeout(start, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose a manual trigger (handy for testing / future menu items).
  window.CBTour = { start: start, end: end };
})();
