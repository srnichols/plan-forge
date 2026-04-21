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

  // Mobile menu
  const btn = document.getElementById('mobile-btn');
  const menu = document.getElementById('mobile-menu');
  if (btn && menu) {
    btn.addEventListener('click', () => menu.classList.toggle('hidden'));
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => menu.classList.add('hidden')));
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
    // Auto-close on mouseleave with a short grace period so the user can
    // cross the small gap between trigger and panel without it slamming shut.
    let leaveTimer = null;
    const cancelLeave = () => { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } };
    trigger.addEventListener('mouseleave', () => {
      cancelLeave();
      leaveTimer = setTimeout(() => {
        trigger.classList.remove('nav-dropdown-open');
        triggerBtn.setAttribute('aria-expanded', 'false');
      }, 250);
    });
    trigger.addEventListener('mouseenter', cancelLeave);
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
