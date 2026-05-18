/* Plan Forge Manual — Glossary Tooltips
 *
 * Wraps the first occurrence of each glossary term in `.chapter-content`
 * with a hover/focus tooltip showing the definition and a link to the
 * glossary. Loaded by assets/manual.js after the page boots.
 *
 * Data:   window.GLOSSARY_TERMS      → { "Term Name": "Plain text definition", ... }
 *         window.GLOSSARY_TERM_OPTS  → { skip: ["Run", "Hub", ...] }
 *         (both populated by assets/glossary-terms.js — auto-generated from glossary.html)
 *
 * Source of truth: docs/manual/glossary.html (regenerate via maintain.mjs Step 5d).
 *
 * Design notes:
 *   - Bails out on glossary.html itself (no self-tooltips, no infinite recursion).
 *   - First-occurrence-only per term per page (academic style: define on first use).
 *   - Case-sensitive match for terms ≤ 5 chars (avoids common-word false positives
 *     like "Hub" matching "hub" in prose). Case-insensitive for longer terms.
 *   - Skip selectors keep highlights out of code, links, headings, and table headers.
 *   - Uses DocumentFragment-based replacement (no innerHTML), so prose containing
 *     "&", "<", or ">" can't break the page.
 *   - Tooltip is a single reused #glossary-tooltip element; positioned via
 *     getBoundingClientRect with flip-on-low-space.
 */
(function () {
  "use strict";

  // Bail out on the glossary page itself.
  if (/\/glossary\.html$/.test(location.pathname)) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    const TERMS = window.GLOSSARY_TERMS;
    if (!TERMS || typeof TERMS !== "object") return;
    const opts = window.GLOSSARY_TERM_OPTS || {};
    const SKIP = new Set(Array.isArray(opts.skip) ? opts.skip : []);

    const root = document.querySelector(".chapter-content");
    if (!root) return;

    // Sort terms longest first so multi-word terms win over their prefixes
    // (e.g., "Plan Forge" wins over "Forge"). Skip listed exclusions.
    const candidates = Object.keys(TERMS)
      .filter((t) => !SKIP.has(t))
      .sort((a, b) => b.length - a.length);
    if (candidates.length === 0) return;

    // Pre-compile a regex per term once. Word-boundary aware on both sides
    // using a non-word-or-hyphen lookahead/lookbehind via capture groups so
    // terms with internal punctuation (P&L, CI/CD, .forge) still match.
    const regexes = candidates.map((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = term.length <= 5 ? "" : "i";
      // Group 1: leading boundary (or start); Group 2: term; Group 3: optional plural 's'.
      // Lookahead for trailing boundary keeps the cursor advancing properly.
      const re = new RegExp("(^|[^\\w-])(" + escaped + ")(s?)(?=[^\\w-]|$)", flags);
      return { term, re };
    });

    const seen = new Set(); // first-occurrence-only across the whole page

    // Collect text nodes first (mutating during walk would invalidate the walker)
    const skipSelectors = ".term-highlight, code, pre, kbd, samp, a, h1, h2, h3, h4, h5, h6, .manual-table thead, .callout-meta, [data-no-tooltip]";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest(skipSelectors)) return NodeFilter.FILTER_REJECT;
        if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
      // Stop scanning once every term has been wrapped at least once.
      if (seen.size === candidates.length) break;
      processNode(node, regexes, seen, TERMS);
    }

    if (seen.size === 0) return; // no matches → no tooltip needed

    // Set up the single reused tooltip element + delegated event handlers.
    const tip = document.createElement("div");
    tip.id = "glossary-tooltip";
    tip.setAttribute("role", "tooltip");
    tip.setAttribute("aria-hidden", "true");
    document.body.appendChild(tip);

    let hideTimer = null;

    function showTip(el) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      const term = el.dataset.glossaryTerm;
      const def = TERMS[term];
      if (!def) return;
      const anchor = slug(term);
      tip.innerHTML = "";
      const termEl = document.createElement("div");
      termEl.className = "gt-term";
      termEl.textContent = term;
      const defEl = document.createElement("div");
      defEl.className = "gt-def";
      defEl.textContent = def;
      const linkEl = document.createElement("a");
      linkEl.className = "gt-link";
      linkEl.href = "glossary.html#" + anchor;
      linkEl.textContent = "Open in Glossary ↗";
      tip.appendChild(termEl);
      tip.appendChild(defEl);
      tip.appendChild(linkEl);
      tip.classList.add("visible");
      tip.setAttribute("aria-hidden", "false");
      positionTip(el);
    }

    function positionTip(el) {
      const rect = el.getBoundingClientRect();
      // Measure tip after content is set
      const tipRect = tip.getBoundingClientRect();
      const margin = 8;
      const maxLeft = window.innerWidth - tipRect.width - margin;
      const left = Math.max(margin, Math.min(rect.left, maxLeft));
      const spaceBelow = window.innerHeight - rect.bottom;
      // Flip above if no room below
      const top = spaceBelow >= tipRect.height + margin * 2
        ? rect.bottom + margin
        : Math.max(margin, rect.top - tipRect.height - margin);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }

    function scheduleHide() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        tip.classList.remove("visible");
        tip.setAttribute("aria-hidden", "true");
        hideTimer = null;
      }, 120);
    }

    function cancelHide() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    }

    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest(".term-highlight");
      if (el) showTip(el);
      else if (e.target.closest("#glossary-tooltip")) cancelHide();
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest(".term-highlight")) {
        const next = e.relatedTarget;
        if (!next || !next.closest || !next.closest("#glossary-tooltip")) scheduleHide();
      } else if (e.target.closest("#glossary-tooltip")) {
        const next = e.relatedTarget;
        if (!next || !next.closest || !next.closest(".term-highlight, #glossary-tooltip")) scheduleHide();
      }
    });
    document.addEventListener("focusin", (e) => {
      const el = e.target.closest(".term-highlight");
      if (el) showTip(el);
    });
    document.addEventListener("focusout", (e) => {
      if (e.target.closest(".term-highlight")) scheduleHide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") scheduleHide();
    });
    window.addEventListener("scroll", scheduleHide, { passive: true });
  }

  // Replace matching ranges in a text node with .term-highlight spans.
  // Uses DocumentFragment so special characters in prose never reach innerHTML.
  function processNode(node, regexes, seen, TERMS) {
    const text = node.textContent;
    const matches = [];
    for (const { term, re } of regexes) {
      if (seen.has(term)) continue;
      re.lastIndex = 0;
      const m = re.exec(text);
      if (!m) continue;
      const start = m.index + m[1].length;
      const end = start + m[2].length + (m[3] || "").length;
      matches.push({ start, end, term });
    }
    if (matches.length === 0) return;

    // Resolve overlaps: keep longest, then earliest.
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const accepted = [];
    for (const m of matches) {
      const last = accepted[accepted.length - 1];
      if (!last || m.start >= last.end) accepted.push(m);
    }

    if (accepted.length === 0) return;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const m of accepted) {
      if (m.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.start)));
      const span = document.createElement("span");
      span.className = "term-highlight";
      span.dataset.glossaryTerm = m.term;
      span.tabIndex = 0;
      span.setAttribute("role", "button");
      span.setAttribute("aria-label", "Glossary entry: " + m.term);
      span.textContent = text.slice(m.start, m.end);
      frag.appendChild(span);
      seen.add(m.term);
      cursor = m.end;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(frag, node);
  }

  // Mirror the anchor convention used by glossary.html section headings,
  // so "Open in Glossary" can deep-link when terms also have <h2 id>s.
  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
})();
