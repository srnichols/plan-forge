/* Plan Forge — Shared Theme JS
 *
 * Manages light/dark mode for the docs site.
 * Persists preference in localStorage under the key 'pforge-theme'.
 * Applies the `light` class to <html> for light mode; dark is the default.
 *
 * Usage:
 *   toggleTheme()           — flip the current theme
 *   initTheme()             — call once on page load to restore saved preference
 *
 * HTML button example:
 *   <button onclick="toggleTheme()" aria-label="Toggle theme">...</button>
 */

const PFORGE_THEME_KEY = 'pforge-theme';

function initTheme() {
  const saved = localStorage.getItem(PFORGE_THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isLight = saved ? saved === 'light' : !prefersDark;
  document.documentElement.classList.toggle('light', isLight);
  _syncThemeButtons(isLight);
}

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem(PFORGE_THEME_KEY, isLight ? 'light' : 'dark');
  _syncThemeButtons(isLight);
}

function _syncThemeButtons(isLight) {
  document.querySelectorAll('[data-theme-toggle]').forEach((el) => {
    el.setAttribute('aria-pressed', isLight ? 'true' : 'false');
    const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';
    el.setAttribute('aria-label', label);
    const icon = el.querySelector('[data-theme-icon]');
    if (icon) icon.textContent = isLight ? '☀️' : '🌙';
  });
}

// Auto-init when DOM is ready.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTheme);
} else {
  initTheme();
}
