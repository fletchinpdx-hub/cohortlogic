// Schedule Builder — interactive intro tour (coach-marks).
// Self-contained, CSP-safe (all handlers via addEventListener; no inline JS).
// Auto-launches once on first visit; replayable anytime from the sidebar button.
//
// Design note: unlike the Class Builder tour, this one is SPOTLIGHT-ONLY — it
// highlights the sidebar nav items down the four phases and explains each, but it
// never navigates views or touches SchedState. Schedule Builder's later views are
// progressively locked (they can't/shouldn't render out of order), the first-visit
// landing screen shouldn't be clobbered by a passive tour, and its UX churns — so a
// zero-side-effect tour keyed to stable `data-view` selectors is both safer and more
// maintainable. The padlocks on locked nav items are left visible on purpose: they
// teach "finish setup first."
(function () {
  if (window.__sbTourLoaded) return;
  window.__sbTourLoaded = true;

  var SEEN_KEY = 'sb_tour_v1_done';

  // ── Tour script ─────────────────────────────────────────────────────────────
  // Each step spotlights `anchor` (a sidebar element) and shows a card. Steps with
  // no anchor render a centered card (welcome / finish).
  var STEPS = [
    {
      anchor: null,
      // Both spaces in the title after "to" are NBSPs (U+00A0), not plain spaces:
      // they hold the product name and the emoji together as one unbreakable unit,
      // so the title wraps to "Welcome to" / "Schedule Builder <emoji>" rather than
      // orphaning the emoji on its own line once h3 reserves room for the Skip
      // button. Do not "tidy" them into regular spaces.
      title: 'Welcome to Schedule Builder 👋',
      body: 'Schedule Builder helps you build your school\'s master schedule in four phases. Here\'s a quick tour of how it\'s laid out.',
      primary: 'Start tour →',
      secondary: 'Skip'
    },
    {
      anchor: '[data-view="school"]',
      badge: 'Phase 1 · Setup',
      title: 'School Info',
      body: 'Start here. Enter your school\'s hours, grades, lunch, and recess. Every schedule is built around these, so it\'s step one.'
    },
    {
      anchor: '[data-view="staff"]',
      badge: 'Phase 1 · Setup',
      title: 'Staff Roster',
      body: 'Add classroom teachers, specials teachers, and instructional assistants. The scheduler assigns them and won\'t double-book anyone.'
    },
    {
      anchor: '[data-view="specials"]',
      badge: 'Phase 1 · Setup',
      title: 'Specials',
      body: 'Define PE, Music, Library, and the like — how long each runs, how many times a week, and who teaches it.'
    },
    {
      anchor: '[data-view="blocks"]',
      badge: 'Phase 1 · Setup',
      title: 'Block Types',
      body: 'Set your instructional blocks (ELA, Math, intervention windows) and the minutes each grade needs. Synchronized Blocks line a block up across grades.'
    },
    {
      anchor: '#nav-master',
      badge: 'Phase 1 · Build',
      title: 'Master Schedule',
      body: 'Where it all comes together — the app auto-places your blocks and specials on a drag-and-drop grid you can fine-tune. 🔒 Unlocks once your grades are set up.'
    },
    {
      anchor: '#nav-specials-sched',
      badge: 'Phase 2 · Detail',
      title: 'Specials, Class & IA Schedules',
      body: 'Review the specials rotation by teacher, see each class\'s full week, and assign IAs to blocks. 🔒 These open as you complete the earlier phases.'
    },
    {
      anchor: '[data-view="export"]',
      badge: 'Finish',
      title: 'Export',
      body: 'Send the finished schedule to Excel — per-day master tabs, class schedules, specials, and IA assignments, all in one workbook.'
    },
    {
      anchor: '#download-sched-btn',
      badge: 'Save your work',
      title: 'Download & load files',
      body: 'Schedule Builder keeps your data in your browser, never on a server. Download a .cohortlogic file to save or share it — and load one here anytime to pick up where you left off.'
    },
    {
      anchor: null,
      title: 'You\'re all set 🎉',
      body: 'That\'s the layout. Work down the phases and you\'ll have a full master schedule. You can replay this tour anytime from the “Take the tour” button in the sidebar.',
      primary: 'Get started',
      secondary: null
    }
  ];

  var CONTENT_COUNT = STEPS.length - 2; // numbered/dotted steps between welcome & finish

  var idx = 0;
  var els = {};

  // ── Styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('sb-tour-style')) return;
    var css =
      '#sb-tour-overlay{position:fixed;inset:0;z-index:10000;pointer-events:none;font-family:"Nunito",system-ui,sans-serif}' +
      '#sb-tour-overlay.active{pointer-events:auto}' +
      '#sb-tour-dim{position:fixed;inset:0;background:rgba(10,34,64,.55);opacity:0;transition:opacity .2s ease}' +
      '#sb-tour-dim.show{opacity:1}' +
      '#sb-tour-spot{position:fixed;border-radius:10px;box-shadow:0 0 0 9999px rgba(10,34,64,.62);' +
      'outline:3px solid #0ea5e9;outline-offset:2px;transition:all .25s cubic-bezier(.4,0,.2,1);pointer-events:none}' +
      '#sb-tour-spot.hidden{display:none}' +
      '#sb-tour-card{position:fixed;width:340px;max-width:calc(100vw - 32px);background:#fff;border-radius:14px;' +
      'box-shadow:0 18px 50px rgba(10,34,64,.35);padding:20px 20px 16px;box-sizing:border-box;' +
      'opacity:0;transform:translateY(6px);transition:opacity .2s ease,transform .2s ease}' +
      '#sb-tour-card.show{opacity:1;transform:translateY(0)}' +
      '#sb-tour-card .sb-tour-badge{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.04em;' +
      'text-transform:uppercase;color:#0ea5e9;margin-bottom:6px}' +
      // padding-right reserves the top-right corner for the absolutely-positioned
      // Skip button, so a long title (the badge-less welcome step) wraps instead of
      // running underneath it. Harmless on the other steps — their titles are short.
      '#sb-tour-card h3{margin:0 0 8px;font-size:18px;font-weight:800;color:#0a2240;line-height:1.25;' +
      'padding-right:52px}' +
      '#sb-tour-card p{margin:0 0 16px;font-size:14px;line-height:1.5;color:#475569}' +
      '#sb-tour-card .sb-tour-foot{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '#sb-tour-dots{display:flex;gap:6px;flex-wrap:wrap;max-width:150px}' +
      '#sb-tour-dots span{width:7px;height:7px;border-radius:50%;background:#cbd5e1;transition:background .2s}' +
      '#sb-tour-dots span.on{background:#0ea5e9}' +
      '#sb-tour-card .sb-tour-btns{display:flex;gap:8px;align-items:center}' +
      '.sb-tour-btn{font-family:inherit;font-weight:700;font-size:13px;border-radius:8px;padding:8px 14px;' +
      'cursor:pointer;border:1px solid transparent;transition:background .15s,border-color .15s}' +
      '.sb-tour-btn-primary{background:#0ea5e9;color:#fff}' +
      '.sb-tour-btn-primary:hover{background:#0284c7}' +
      '.sb-tour-btn-ghost{background:transparent;color:#64748b;border-color:#e2e8f0}' +
      '.sb-tour-btn-ghost:hover{background:#f1f5f9}' +
      '#sb-tour-skip{position:absolute;top:12px;right:12px;background:none;border:none;color:#94a3b8;' +
      'font-size:12px;font-weight:700;cursor:pointer;padding:4px}' +
      '#sb-tour-skip:hover{color:#475569}' +
      '#sb-tour-launch{display:block;width:100%;margin-top:10px;background:rgba(255,255,255,.08);' +
      'border:1px solid rgba(255,255,255,.18);color:#fff;font-family:inherit;font-weight:700;font-size:12px;' +
      'border-radius:8px;padding:8px 10px;cursor:pointer;text-align:center;transition:background .15s}' +
      '#sb-tour-launch:hover{background:rgba(255,255,255,.16)}' +
      '@media (max-width:640px){#sb-tour-card{width:calc(100vw - 24px)}}';
    var style = document.createElement('style');
    style.id = 'sb-tour-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── DOM build ─────────────────────────────────────────────────────────────
  function buildOverlay() {
    var overlay = document.createElement('div');
    overlay.id = 'sb-tour-overlay';

    var dim = document.createElement('div');
    dim.id = 'sb-tour-dim';

    var spot = document.createElement('div');
    spot.id = 'sb-tour-spot';
    spot.className = 'hidden';

    var card = document.createElement('div');
    card.id = 'sb-tour-card';

    var skip = document.createElement('button');
    skip.id = 'sb-tour-skip';
    skip.type = 'button';
    skip.textContent = 'Skip ✕';
    skip.addEventListener('click', end);

    var badge = document.createElement('span');
    badge.className = 'sb-tour-badge';

    var h3 = document.createElement('h3');
    var p = document.createElement('p');

    var foot = document.createElement('div');
    foot.className = 'sb-tour-foot';

    var dots = document.createElement('div');
    dots.id = 'sb-tour-dots';

    var btns = document.createElement('div');
    btns.className = 'sb-tour-btns';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'sb-tour-btn sb-tour-btn-ghost';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', function () { go(idx - 1); });

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'sb-tour-btn sb-tour-btn-primary';
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

    for (var i = 0; i < CONTENT_COUNT; i++) {
      dots.appendChild(document.createElement('span'));
    }
  }

  // ── Positioning ───────────────────────────────────────────────────────────
  function positionForStep(s) {
    var card = els.card, spot = els.spot, dim = els.dim;
    var pad = 16;

    function centered() {
      spot.className = 'hidden';
      dim.classList.add('show');
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      requestAnimationFrame(function () { card.style.transform = 'translate(-50%, -50%)'; });
    }

    if (!s.anchor) { centered(); return; }

    var anchor = document.querySelector(s.anchor);
    // Fall back to a centered card when the anchor is missing OR hidden (e.g. the
    // sidebar collapses behind a hamburger on mobile → no client rects).
    if (!anchor || anchor.getClientRects().length === 0) { centered(); return; }

    dim.classList.remove('show'); // the spotlight's box-shadow provides the dim
    var r = anchor.getBoundingClientRect();
    var sp = 6;
    spot.className = '';
    spot.style.left = (r.left - sp) + 'px';
    spot.style.top = (r.top - sp) + 'px';
    spot.style.width = (r.width + sp * 2) + 'px';
    spot.style.height = (r.height + sp * 2) + 'px';

    // Keep the card at a STABLE spot — just right of the anchor, vertically centered
    // in the viewport — so only the spotlight travels down the sidebar between steps.
    var cardW = card.offsetWidth || 340;
    var cardH = card.offsetHeight || 200;
    var left = r.right + pad + 8;
    var top = (window.innerHeight - cardH) / 2;

    if (left + cardW > window.innerWidth - pad) {
      left = Math.min(r.left, window.innerWidth - cardW - pad);
      top = r.bottom + pad;
    }
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

    els.badge.style.display = s.badge ? 'inline-block' : 'none';
    els.badge.textContent = s.badge || '';
    els.h3.textContent = s.title;
    els.p.textContent = s.body;

    els.backBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
    els.nextBtn.textContent = s.primary || (idx >= STEPS.length - 1 ? 'Done' : 'Next →');
    els.skip.style.display = (idx === STEPS.length - 1) ? 'none' : 'block';

    // Progress dots reflect the content steps (indices 1..CONTENT_COUNT).
    var dotEls = els.dots.children;
    for (var i = 0; i < dotEls.length; i++) {
      dotEls[i].className = (idx >= 1 && (i + 1) <= idx) ? 'on' : '';
    }
    els.dots.style.visibility = (idx >= 1 && idx <= CONTENT_COUNT) ? 'visible' : 'hidden';

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
    var footer = document.querySelector('#sidebar .sidebar-footer');
    if (!footer || document.getElementById('sb-tour-launch')) return;
    var btn = document.createElement('button');
    btn.id = 'sb-tour-launch';
    btn.type = 'button';
    btn.textContent = '🎬 Take the tour';
    btn.addEventListener('click', start);
    footer.appendChild(btn);
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  // The app boots async (auth + product gate) and stays `visibility:hidden` until
  // ready — and shows a landing screen on first visit. Wait for the app to be
  // visible with a rendered nav before auto-launching, so the tour never fires over
  // a blank/hidden page or during a redirect.
  function whenReady(cb) {
    var tries = 0;
    (function check() {
      tries++;
      var visible = document.body && getComputedStyle(document.body).visibility !== 'hidden';
      var navReady = document.querySelector('#nav .nav-item');
      if (visible && navReady) { cb(); return; }
      if (tries > 60) return; // ~15s cap; bail if the page redirected/never booted
      setTimeout(check, 250);
    })();
  }

  function boot() {
    injectStyles();
    injectLauncher();
    var seen;
    try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { seen = '1'; }
    if (!seen) {
      whenReady(function () { setTimeout(start, 600); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose a manual trigger (handy for testing / future menu items).
  window.SBTour = { start: start, end: end };
})();
