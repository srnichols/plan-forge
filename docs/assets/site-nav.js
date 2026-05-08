/* Plan Forge — Site Navigation JS
 *
 * Two modes:
 *
 * 1. Injection mode — add a placeholder element where the nav should render:
 *      <div data-site-nav-placeholder></div>
 *    The script fetches _includes/site-nav.html, replaces ROOT_PLACEHOLDER with
 *    the correct relative root, injects the markup, then wires up interactions.
 *
 *    Provide the root hint via data-nav-root on the script tag, or let the
 *    script auto-detect it from its own src path:
 *      <script src="../assets/site-nav.js" data-nav-root="../"></script>
 *
 * 2. Init-only mode — nav HTML is already in the page (inline):
 *    Just include this script; it will wire up mobile-menu and dropdown
 *    interactions on DOMContentLoaded without fetching anything.
 *
 * Compatible with: shared.js (does not duplicate scroll-reveal or active-nav
 * logic — those live in shared.js).  Load site-nav.js AFTER the nav markup
 * is present, or let it self-inject via the placeholder pattern.
 */

(function () {
  'use strict';

  /* ── Path detection ───────────────────────────────────────────────── */

  function getNavRoot() {
    const script = document.currentScript;
    if (script) {
      // Explicit override wins
      if (script.dataset.navRoot !== undefined) return script.dataset.navRoot;
      // Derive from the script's own URL: strip "assets/site-nav.js" suffix
      const src = script.getAttribute('src') || '';
      const m = src.match(/^(.*?)assets\/site-nav\.js/);
      if (m) return m[1];
    }
    return '';
  }

  /* ── Nav interaction wiring ───────────────────────────────────────── */

  function initNavInteractions() {
    // ── Mobile menu ────────────────────────────────────────────────
    const btn  = document.getElementById('mobile-btn');
    const menu = document.getElementById('mobile-menu');

    if (btn && menu) {
      const HAMBURGER = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>';
      const CLOSE     = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';

      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-controls',  'mobile-menu');

      const setOpen = (open) => {
        menu.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label',    open ? 'Close menu' : 'Open menu');
        btn.innerHTML = open ? CLOSE : HAMBURGER;
      };

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen(menu.classList.contains('hidden'));
      });

      menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));

      document.addEventListener('click', (e) => {
        if (!menu.classList.contains('hidden') &&
            !menu.contains(e.target) &&
            !btn.contains(e.target)) {
          setOpen(false);
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
          setOpen(false);
          btn.focus();
        }
      });

      window.matchMedia('(min-width: 768px)').addEventListener('change', (e) => {
        if (e.matches) setOpen(false);
      });
    }

    // ── Desktop dropdowns ──────────────────────────────────────────
    const triggers = document.querySelectorAll('.nav-dropdown-trigger');

    triggers.forEach((trigger) => {
      const triggerBtn = trigger.querySelector('button');
      if (!triggerBtn) return;

      triggerBtn.setAttribute('aria-haspopup', 'true');
      triggerBtn.setAttribute('aria-expanded', 'false');

      triggerBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const wasOpen = trigger.classList.contains('nav-dropdown-open');
        // Close all first
        triggers.forEach((t) => {
          t.classList.remove('nav-dropdown-open');
          const b = t.querySelector('button');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
        if (!wasOpen) {
          trigger.classList.add('nav-dropdown-open');
          triggerBtn.setAttribute('aria-expanded', 'true');
        }
      });

      trigger.querySelectorAll('.nav-dropdown a').forEach((a) =>
        a.addEventListener('click', () => {
          trigger.classList.remove('nav-dropdown-open');
          triggerBtn.setAttribute('aria-expanded', 'false');
        })
      );
    });

    if (triggers.length) {
      document.addEventListener('click', (e) => {
        triggers.forEach((trigger) => {
          if (!trigger.contains(e.target) && trigger.classList.contains('nav-dropdown-open')) {
            trigger.classList.remove('nav-dropdown-open');
            const b = trigger.querySelector('button');
            if (b) b.setAttribute('aria-expanded', 'false');
          }
        });
      });

      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        triggers.forEach((trigger) => {
          if (trigger.classList.contains('nav-dropdown-open')) {
            trigger.classList.remove('nav-dropdown-open');
            const b = trigger.querySelector('button');
            if (b) { b.setAttribute('aria-expanded', 'false'); b.focus(); }
          }
        });
      });
    }
  }

  /* ── Injection mode ───────────────────────────────────────────────── */

  function injectNav(root, placeholder) {
    const url = root + '_includes/site-nav.html';
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('site-nav fetch ' + r.status + ': ' + url);
        return r.text();
      })
      .then((html) => {
        const resolved = html.replaceAll('ROOT_PLACEHOLDER', root);
        // Replace placeholder element with the fetched nav markup
        const tmp = document.createElement('div');
        tmp.innerHTML = resolved;
        placeholder.replaceWith(...tmp.childNodes);
        initNavInteractions();
      })
      .catch((err) => {
        console.warn('[site-nav] Could not load nav include:', err);
        // Remove the empty placeholder so layout is not affected
        placeholder.remove();
      });
  }

  /* ── Entry point ──────────────────────────────────────────────────── */

  const _root = getNavRoot();

  function init() {
    const placeholder = document.querySelector('[data-site-nav-placeholder]');
    if (placeholder) {
      injectNav(_root, placeholder);
    } else {
      // Nav markup already in page — just wire up interactions
      initNavInteractions();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
