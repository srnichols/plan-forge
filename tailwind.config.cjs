/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './docs/**/*.html',
    './docs/manual/assets/manual.js',
  ],
  safelist: [
    // status-pill--* classes are CSS-only (in manual.css) — no Tailwind classes to safelist
  ],
  theme: {
    extend: {
      colors: {
        forge: {
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
    },
  },
  plugins: [],
};
