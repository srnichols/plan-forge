/* Plan Forge Manual — JavaScript
   Sidebar navigation, client-side search, prev/next, copy buttons, mobile toggle. */

(function () {
  "use strict";

  // ─── Chapter registry ───
  const CHAPTERS = [
    { id: "index",               file: "index.html",               num: "",   title: "Manual Home",              act: "" },
    { id: "what-is-plan-forge",  file: "what-is-plan-forge.html",  num: "1",  title: "What Is Plan Forge?",      act: "I" },
    { id: "how-it-works",        file: "how-it-works.html",        num: "2",  title: "How It Works",             act: "I" },
    { id: "installation",        file: "installation.html",        num: "3",  title: "Installation",             act: "I" },
    { id: "your-first-plan",     file: "your-first-plan.html",     num: "4",  title: "Your First Plan",          act: "II" },
    { id: "writing-plans",       file: "writing-plans.html",       num: "5",  title: "Writing Plans That Work",  act: "II" },
    { id: "dashboard",           file: "dashboard.html",           num: "6",  title: "The Dashboard",            act: "II" },
    { id: "cli-reference",       file: "cli-reference.html",       num: "7",  title: "CLI Reference",            act: "III" },
    { id: "customization",       file: "customization.html",       num: "8",  title: "Customization",            act: "III" },
    { id: "instructions-agents", file: "instructions-agents.html", num: "9",  title: "Instruction Files & Agents", act: "III" },
    { id: "mcp-server",          file: "mcp-server.html",          num: "10", title: "MCP Server & Tools",       act: "III" },
    { id: "extensions",          file: "extensions.html",          num: "11", title: "Extensions",               act: "III" },
    { id: "multi-agent",         file: "multi-agent.html",         num: "12", title: "Multi-Agent Setup",        act: "III" },
    { id: "advanced-execution",  file: "advanced-execution.html",  num: "13", title: "Advanced Execution",       act: "III" },
    { id: "troubleshooting",     file: "troubleshooting.html",     num: "14", title: "Troubleshooting",          act: "III" },
    { id: "glossary",            file: "glossary.html",            num: "A",  title: "Glossary",                 act: "Appendix" },
    { id: "quick-reference",     file: "quick-reference.html",     num: "B",  title: "Quick Reference Card",     act: "Appendix" },
    { id: "stack-notes",         file: "stack-notes.html",         num: "C",  title: "Stack-Specific Notes",     act: "Appendix" },
    { id: "sample-project",       file: "sample-project.html",      num: "E",  title: "Sample Project",            act: "Appendix" },
  ];

  // Detect current page
  const currentFile = location.pathname.split("/").pop() || "index.html";
  const currentIdx = CHAPTERS.findIndex((c) => c.file === currentFile);

  // ─── Sidebar generation ───
  function buildSidebar() {
    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;

    let lastAct = "";
    const frag = document.createDocumentFragment();

    // Logo / title link
    const titleLink = document.createElement("a");
    titleLink.href = "index.html";
    titleLink.className = "block px-5 py-4 text-sm font-bold text-slate-100 hover:text-amber-400 transition-colors border-b border-slate-800/50";
    titleLink.innerHTML = "⚒ Plan Forge Manual";
    frag.appendChild(titleLink);

    // Search
    const searchWrap = document.createElement("div");
    searchWrap.className = "px-4 py-3 relative";
    searchWrap.innerHTML =
      '<svg class="absolute left-7 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
      '<input type="text" class="search-input" placeholder="Search manual..." aria-label="Search manual" />' +
      '<div class="search-results"></div>';
    frag.appendChild(searchWrap);

    CHAPTERS.forEach((ch, i) => {
      if (i === 0) return; // Skip index in sidebar nav

      // Act header
      if (ch.act && ch.act !== lastAct) {
        lastAct = ch.act;
        const actLabels = { I: "Act I — Learn", II: "Act II — Build", III: "Act III — Master", Appendix: "Appendices" };
        const actEl = document.createElement("div");
        actEl.className = "sidebar-act";
        actEl.textContent = actLabels[ch.act] || ch.act;
        frag.appendChild(actEl);
      }

      const a = document.createElement("a");
      a.href = ch.file;
      a.className = "sidebar-link" + (i === currentIdx ? " active" : "");
      a.innerHTML = '<span class="chapter-num">' + ch.num + "</span> " + ch.title;
      frag.appendChild(a);
    });

    nav.appendChild(frag);
  }

  // ─── Prev / Next ───
  function buildPrevNext() {
    const container = document.getElementById("chapter-prev-next");
    if (!container || currentIdx < 0) return;

    const prev = currentIdx > 0 ? CHAPTERS[currentIdx - 1] : null;
    const next = currentIdx < CHAPTERS.length - 1 ? CHAPTERS[currentIdx + 1] : null;

    if (prev) {
      container.innerHTML +=
        '<a href="' + prev.file + '">' +
        '<span class="nav-label">← Previous</span>' +
        '<span class="nav-title">' + (prev.num ? prev.num + ". " : "") + prev.title + "</span>" +
        "</a>";
    }
    if (next) {
      container.innerHTML +=
        '<a href="' + next.file + '" class="next">' +
        '<span class="nav-label">Next →</span>' +
        '<span class="nav-title">' + (next.num ? next.num + ". " : "") + next.title + "</span>" +
        "</a>";
    }
  }

  // ─── Copy buttons ───
  function initCopyButtons() {
    document.querySelectorAll(".cmd-copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const block = btn.closest(".cmd-block");
        const code = block ? block.querySelector("code") : null;
        if (!code) return;
        navigator.clipboard.writeText(code.innerText).then(() => {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("copied");
          }, 2000);
        });
      });
    });
  }

  // ─── Mobile sidebar ───
  function initMobileSidebar() {
    const btn = document.getElementById("mobile-sidebar-btn");
    const sidebar = document.getElementById("manual-sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (!btn || !sidebar) return;

    const toggle = () => {
      sidebar.classList.toggle("open");
      if (overlay) overlay.classList.toggle("open");
    };
    btn.addEventListener("click", toggle);
    if (overlay) overlay.addEventListener("click", toggle);

    // Close on link click (mobile)
    sidebar.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        sidebar.classList.remove("open");
        if (overlay) overlay.classList.remove("open");
      });
    });
  }

  // ─── Client-side search ───
  function initSearch() {
    const input = document.querySelector(".search-input");
    const resultsEl = document.querySelector(".search-results");
    if (!input || !resultsEl) return;

    // Build index from chapters + headings on current page
    const searchIndex = CHAPTERS.filter((_, i) => i > 0).map((ch) => ({
      title: (ch.num ? ch.num + ". " : "") + ch.title,
      url: ch.file,
    }));

    // Add h2/h3 from current page
    document.querySelectorAll(".chapter-content h2[id], .chapter-content h3[id]").forEach((h) => {
      searchIndex.push({
        title: h.textContent.trim(),
        url: "#" + h.id,
      });
    });

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) {
        resultsEl.classList.remove("active");
        return;
      }

      const matches = searchIndex.filter((item) => item.title.toLowerCase().includes(q));
      if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="search-result-item" style="color:#64748b">No results</div>';
      } else {
        resultsEl.innerHTML = matches
          .slice(0, 12)
          .map((m) => {
            const highlighted = m.title.replace(new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi"), "<mark>$1</mark>");
            return '<a href="' + m.url + '" class="search-result-item">' + highlighted + "</a>";
          })
          .join("");
      }
      resultsEl.classList.add("active");
    });

    // Close on click outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-input") && !e.target.closest(".search-results")) {
        resultsEl.classList.remove("active");
      }
    });
  }

  // ─── Init ───
  document.addEventListener("DOMContentLoaded", () => {
    buildSidebar();
    buildPrevNext();
    initCopyButtons();
    initMobileSidebar();
    initSearch();
  });
})();
