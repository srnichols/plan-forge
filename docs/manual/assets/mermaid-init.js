// ─────────────────────────────────────────────────────────────────────────────
// Plan Forge Manual — shared mermaid initializer (classic script)
//
// IMPORTANT: This MUST be a non-module classic script. The manual is commonly
// browsed locally via file:// (e.g. ebook preview), and Chromium browsers
// block ES module imports under file:// origins via CORS. Classic <script>
// tags have no such restriction.
//
// Loaded as `<script src="assets/mermaid-init.js" defer></script>` from every
// manual page that contains <pre class="mermaid"> blocks. The script
// dynamically injects the mermaid UMD bundle from jsDelivr the first time it
// runs, so individual HTML pages only need the one <script> tag.
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  "use strict";

  var MERMAID_SRC = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js";

  var COMMON = {
    fontFamily: "Inter, ui-sans-serif",
    fontSize: "14px",
  };

  // Dark palette — matches the manual's default slate-950 background.
  var DARK = {
    fontFamily: COMMON.fontFamily,
    fontSize: COMMON.fontSize,
    background: "#0f172a",
    mainBkg: "#1e293b",
    nodeBorder: "#f59e0b",
    nodeTextColor: "#f1f5f9",
    textColor: "#cbd5e1",
    lineColor: "#64748b",
    edgeLabelBackground: "#1e293b",
    primaryColor: "#1e3a5f",
    primaryTextColor: "#f1f5f9",
    primaryBorderColor: "#60a5fa",
    secondaryColor: "#3b2410",
    secondaryTextColor: "#fef3c7",
    secondaryBorderColor: "#fbbf24",
    tertiaryColor: "#064e3b",
    tertiaryTextColor: "#d1fae5",
    tertiaryBorderColor: "#34d399",
    clusterBkg: "#1e293b",
    clusterBorder: "#475569",
    titleColor: "#fbbf24",
    noteBkgColor: "#451a03",
    noteTextColor: "#fef3c7",
    noteBorderColor: "#fbbf24",
  };

  // Light palette — slate-50 page with bright accent borders and pastel fills.
  var LIGHT = {
    fontFamily: COMMON.fontFamily,
    fontSize: COMMON.fontSize,
    background: "#f8fafc",
    mainBkg: "#ffffff",
    nodeBorder: "#d97706",
    nodeTextColor: "#0f172a",
    textColor: "#334155",
    lineColor: "#475569",
    edgeLabelBackground: "#ffffff",
    primaryColor: "#dbeafe",
    primaryTextColor: "#0f172a",
    primaryBorderColor: "#2563eb",
    secondaryColor: "#fef3c7",
    secondaryTextColor: "#78350f",
    secondaryBorderColor: "#d97706",
    tertiaryColor: "#d1fae5",
    tertiaryTextColor: "#064e3b",
    tertiaryBorderColor: "#059669",
    clusterBkg: "#f1f5f9",
    clusterBorder: "#94a3b8",
    titleColor: "#b45309",
    noteBkgColor: "#fef3c7",
    noteTextColor: "#78350f",
    noteBorderColor: "#d97706",
  };

  function isLight() {
    return document.documentElement.classList.contains("light-mode");
  }

  function configFor(theme) {
    return {
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
      themeVariables: theme === "light" ? LIGHT : DARK,
      flowchart: { curve: "basis", padding: 12 },
      sequence: { actorMargin: 60, noteMargin: 12 },
    };
  }

  // Bare-bones fallback if the custom palette ever trips mermaid's parser.
  function fallbackConfig(theme) {
    return {
      startOnLoad: false,
      securityLevel: "loose",
      theme: theme === "light" ? "default" : "dark",
    };
  }

  function blocks() {
    return Array.prototype.slice.call(document.querySelectorAll("pre.mermaid"));
  }

  function snapshotSources() {
    blocks().forEach(function (el) {
      if (!el.dataset.mermaidSource) {
        el.dataset.mermaidSource = el.textContent;
      }
    });
  }

  function resetBlocks() {
    blocks().forEach(function (el) {
      if (el.dataset.mermaidSource) {
        el.textContent = el.dataset.mermaidSource;
      }
      el.removeAttribute("data-processed");
    });
  }

  function renderAll() {
    if (!window.mermaid) return Promise.resolve();
    var nodes = blocks();
    if (nodes.length === 0) return Promise.resolve();
    var theme = isLight() ? "light" : "dark";
    try {
      window.mermaid.initialize(configFor(theme));
    } catch (initErr) {
      console.warn("[mermaid] initialize failed with custom palette:", initErr);
    }
    return window.mermaid.run({ nodes: nodes }).catch(function (err) {
      console.warn("[mermaid] custom palette render failed, falling back:", err);
      resetBlocks();
      try {
        window.mermaid.initialize(fallbackConfig(theme));
      } catch (e) { /* noop */ }
      return window.mermaid.run({ nodes: blocks() }).catch(function (err2) {
        console.error("[mermaid] fallback render also failed:", err2);
      });
    });
  }

  function rerender() {
    resetBlocks();
    return renderAll();
  }

  function boot() {
    snapshotSources();
    renderAll();
    document.addEventListener("pforge:theme-change", rerender);
    window.pforgeRerenderMermaid = rerender;
  }

  function loadMermaidThenBoot() {
    if (window.mermaid) { boot(); return; }
    var s = document.createElement("script");
    s.src = MERMAID_SRC;
    s.async = true;
    s.onload = boot;
    s.onerror = function () {
      console.error("[mermaid] failed to load bundle from " + MERMAID_SRC);
    };
    document.head.appendChild(s);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadMermaidThenBoot, { once: true });
  } else {
    loadMermaidThenBoot();
  }
})();
