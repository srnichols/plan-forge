/* Plan Forge — Briefing-Deck Interactive JS
 *
 * Usage: <script src="/assets/briefing-deck.js" defer></script>
 * Pairs with the .deck/.slide markup defined in briefing-deck.css.
 *
 * Features:
 *  - IntersectionObserver-driven active-slide tracking
 *  - Dot-nav: auto-built from .slide elements; click-to-jump; aria-current
 *  - Progress bar: updates as slides change
 *  - Keyboard navigation: ArrowDown/Up, Space, PageDown/Up, Home/End
 *  - Touch/swipe: touchstart + touchend, vertical-only, 40 px threshold
 *  - Keyboard hint: fades out on first user interaction
 *  - Slide-number badges: injected when absent
 */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    const deck = document.querySelector('.deck');
    if (!deck) return;

    const slides = Array.from(deck.querySelectorAll('.slide'));
    if (!slides.length) return;

    // ── Inject slide-number badges when absent ──────────────────────────
    slides.forEach((slide, i) => {
      if (!slide.querySelector('.slide-num')) {
        const badge = document.createElement('span');
        badge.className = 'slide-num';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = `${i + 1} / ${slides.length}`;
        slide.appendChild(badge);
      }
    });

    // ── Build dot-nav when absent ───────────────────────────────────────
    let dotNav = document.querySelector('.dot-nav');
    let dotButtons = [];

    if (!dotNav) {
      dotNav = document.createElement('nav');
      dotNav.className = 'dot-nav';
      dotNav.setAttribute('aria-label', 'Slide navigation');

      const ul = document.createElement('ul');
      slides.forEach((slide, i) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        const label =
          slide.querySelector('.slide-title')?.textContent?.trim() ||
          `Slide ${i + 1}`;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-current', 'false');
        btn.addEventListener('click', () => {
          scrollToSlide(i);
          dismissHint();
        });
        li.appendChild(btn);
        ul.appendChild(li);
        dotButtons.push(btn);
      });

      dotNav.appendChild(ul);
      document.body.appendChild(dotNav);
    } else {
      dotButtons = Array.from(dotNav.querySelectorAll('button'));
    }

    // ── Progress bar ────────────────────────────────────────────────────
    let progressBar = document.querySelector('.deck-progress');
    if (!progressBar) {
      progressBar = document.createElement('div');
      progressBar.className = 'deck-progress';
      progressBar.setAttribute('role', 'progressbar');
      progressBar.setAttribute('aria-valuemin', '0');
      progressBar.setAttribute('aria-valuemax', '100');
      document.body.appendChild(progressBar);
    }

    // ── Keyboard hint ────────────────────────────────────────────────────
    let hint = document.querySelector('.deck-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'deck-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.textContent = '↑ ↓  arrow keys  ·  swipe to navigate';
      document.body.appendChild(hint);
    }

    let hintDismissed = false;
    const dismissHint = () => {
      if (hintDismissed) return;
      hintDismissed = true;
      hint.classList.add('hidden');
    };

    // ── Active-slide tracking via IntersectionObserver ──────────────────
    let activeIndex = 0;

    const updateActive = (index) => {
      if (index < 0 || index >= slides.length) return;
      activeIndex = index;

      dotButtons.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
        btn.setAttribute('aria-current', i === index ? 'true' : 'false');
      });

      const pct =
        slides.length <= 1 ? 100 : (index / (slides.length - 1)) * 100;
      progressBar.style.width = `${pct}%`;
      progressBar.setAttribute('aria-valuenow', Math.round(pct));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = slides.indexOf(entry.target);
            if (idx !== -1) updateActive(idx);
          }
        });
      },
      { root: deck, threshold: 0.5 }
    );

    slides.forEach((slide) => observer.observe(slide));

    // ── Scroll-to-slide helper ──────────────────────────────────────────
    const scrollToSlide = (index) => {
      const clamped = Math.max(0, Math.min(index, slides.length - 1));
      slides[clamped].scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // ── Keyboard navigation ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable
      ) return;

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          scrollToSlide(activeIndex + 1);
          dismissHint();
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          scrollToSlide(activeIndex - 1);
          dismissHint();
          break;
        case 'Home':
          e.preventDefault();
          scrollToSlide(0);
          dismissHint();
          break;
        case 'End':
          e.preventDefault();
          scrollToSlide(slides.length - 1);
          dismissHint();
          break;
        default:
          break;
      }
    });

    // ── Touch / swipe navigation ─────────────────────────────────────────
    let touchStartY = 0;
    let touchStartX = 0;
    const SWIPE_THRESHOLD = 40;

    deck.addEventListener(
      'touchstart',
      (e) => {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
      },
      { passive: true }
    );

    deck.addEventListener(
      'touchend',
      (e) => {
        const dy = touchStartY - e.changedTouches[0].clientY;
        const dx = touchStartX - e.changedTouches[0].clientX;

        if (Math.abs(dy) < SWIPE_THRESHOLD && Math.abs(dx) < SWIPE_THRESHOLD)
          return;
        // Ignore predominantly horizontal swipes (e.g. image carousels)
        if (Math.abs(dx) > Math.abs(dy)) return;

        scrollToSlide(dy > 0 ? activeIndex + 1 : activeIndex - 1);
        dismissHint();
      },
      { passive: true }
    );

    // Initialise UI at first slide
    updateActive(0);
  }
}());
