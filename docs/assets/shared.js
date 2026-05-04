/* Plan Forge — Shared JS */

// Scroll reveal
document.addEventListener('DOMContentLoaded', () => {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

  // Active nav highlighting
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('nav a[href^="#"]');
  if (sections.length && navLinks.length) {
    const onScroll = () => {
      let current = '';
      sections.forEach(s => { if (window.scrollY >= s.offsetTop - 120) current = s.id; });
      navLinks.forEach(a => {
        a.classList.toggle('nav-active', a.getAttribute('href') === '#' + current);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Mobile menu — toggle on hamburger, close on outside-click, Escape, or
  // any link inside. Hamburger icon swaps to an X when open and aria state
  // is kept in sync for screen readers.
  const btn = document.getElementById('mobile-btn');
  const menu = document.getElementById('mobile-menu');
  if (btn && menu) {
    const HAMBURGER_SVG = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>';
    const CLOSE_SVG = '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'mobile-menu');

    const setMenuState = (open) => {
      menu.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      btn.innerHTML = open ? CLOSE_SVG : HAMBURGER_SVG;
    };
    const closeMenu = () => setMenuState(false);
    const toggleMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setMenuState(menu.classList.contains('hidden'));
    };

    btn.addEventListener('click', toggleMenu);
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));
    // Click outside the menu (and not on the toggle button) closes it.
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('hidden')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      closeMenu();
    });
    // Escape closes and returns focus to the toggle button.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (menu.classList.contains('hidden')) return;
      closeMenu();
      btn.focus();
    });
    // Resizing past the md breakpoint resets state so the menu doesn't
    // stay "open" when the desktop nav takes over.
    const mq = window.matchMedia('(min-width: 768px)');
    mq.addEventListener('change', (e) => { if (e.matches) closeMenu(); });
  }

  // Desktop dropdown menus — click-toggle with outside-click + Escape to close.
  // Hover still works (CSS :hover) but state is owned here so touch devices
  // and mouse users both get a menu that retracts reliably.
  const dropdownTriggers = document.querySelectorAll('.nav-dropdown-trigger');
  dropdownTriggers.forEach((trigger) => {
    const triggerBtn = trigger.querySelector('button');
    if (!triggerBtn) return;
    triggerBtn.setAttribute('aria-haspopup', 'true');
    triggerBtn.setAttribute('aria-expanded', 'false');
    triggerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = trigger.classList.contains('nav-dropdown-open');
      // Close any other open dropdowns first
      dropdownTriggers.forEach((t) => {
        t.classList.remove('nav-dropdown-open');
        const b = t.querySelector('button');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        trigger.classList.add('nav-dropdown-open');
        triggerBtn.setAttribute('aria-expanded', 'true');
      }
    });
    // Close when a link inside the dropdown is clicked
    trigger.querySelectorAll('.nav-dropdown a').forEach((a) =>
      a.addEventListener('click', () => {
        trigger.classList.remove('nav-dropdown-open');
        triggerBtn.setAttribute('aria-expanded', 'false');
      })
    );
  });
  if (dropdownTriggers.length) {
    // Click outside any open dropdown closes it
    document.addEventListener('click', (e) => {
      dropdownTriggers.forEach((trigger) => {
        if (!trigger.contains(e.target) && trigger.classList.contains('nav-dropdown-open')) {
          trigger.classList.remove('nav-dropdown-open');
          const b = trigger.querySelector('button');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });
    });
    // Escape closes any open dropdown
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      dropdownTriggers.forEach((trigger) => {
        if (trigger.classList.contains('nav-dropdown-open')) {
          trigger.classList.remove('nav-dropdown-open');
          const b = trigger.querySelector('button');
          if (b) {
            b.setAttribute('aria-expanded', 'false');
            b.focus();
          }
        }
      });
    });
  }
});

// Copy button with feedback
function copyCode(btn) {
  const block = btn.closest('.code-block') || btn.closest('.rounded-xl');
  const code = block.querySelector('code');
  if (code) {
    navigator.clipboard.writeText(code.innerText);
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
  }
}
