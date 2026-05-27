/**
 * marketing-chrome.js
 * Shared behavior for all marketing pages:
 *  - Marks the current page's nav link as .is-active
 *  - Updates .footer-year spans with the current year
 *  - Injects mobile hamburger nav
 */
document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop() || 'index.html';

  // ── Active nav link (desktop) ────────────────────────────────────────────
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = (a.getAttribute('href') || '').split('/').pop();
    if (href === page) a.classList.add('is-active');
  });

  // ── Footer year ──────────────────────────────────────────────────────────
  const yr = new Date().getFullYear();
  document.querySelectorAll('.footer-year').forEach(el => { el.textContent = yr; });

  // ── Mobile nav ───────────────────────────────────────────────────────────
  const navWrap = document.querySelector('.nav-wrap');
  const navEl   = document.querySelector('.nav');
  const links   = document.querySelector('.nav-links');
  const actions = document.querySelector('.nav-actions');

  if (!navWrap || !navEl) return;

  // Inject hamburger button
  const hamburger = document.createElement('button');
  hamburger.className = 'nav-hamburger';
  hamburger.setAttribute('aria-label', 'Toggle navigation');
  hamburger.innerHTML = '<span></span><span></span><span></span>';
  navEl.appendChild(hamburger);

  // Build mobile panel: clone nav links + actions
  const panel = document.createElement('div');
  panel.className = 'nav-mobile-panel';

  if (links) {
    links.querySelectorAll('a').forEach(a => {
      const clone = a.cloneNode(true);
      // Re-apply active state on clones
      const href = (clone.getAttribute('href') || '').split('/').pop();
      if (href === page) clone.classList.add('is-active');
      panel.appendChild(clone);
    });
  }

  if (actions) {
    const actDiv = document.createElement('div');
    actDiv.className = 'nav-mobile-actions';
    actions.querySelectorAll('a').forEach(a => actDiv.appendChild(a.cloneNode(true)));
    panel.appendChild(actDiv);
  }

  navWrap.appendChild(panel);

  // Toggle open/closed
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    navWrap.classList.toggle('nav-open');
  });

  // Close when clicking outside
  document.addEventListener('click', () => navWrap.classList.remove('nav-open'));
  navWrap.addEventListener('click', e => e.stopPropagation());
});
