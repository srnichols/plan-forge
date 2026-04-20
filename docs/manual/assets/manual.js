/* Plan Forge Manual — JavaScript
   Sidebar navigation, client-side search, prev/next, copy buttons, mobile toggle. */

(function () {
  "use strict";

  // ─── Chapter registry ───
  const CHAPTERS = [
    { id: "index",               file: "index.html",               num: "",   title: "Manual Home",              act: "" },
    // ─── Act I — Smelt (intake → scope contract) ───
    { id: "what-is-plan-forge",  file: "what-is-plan-forge.html",  num: "1",  title: "What Is Plan Forge?",      act: "I" },
    { id: "how-it-works",        file: "how-it-works.html",        num: "2",  title: "How It Works",             act: "I" },
    { id: "installation",        file: "installation.html",        num: "3",  title: "Installation",             act: "I" },
    { id: "writing-plans",       file: "writing-plans.html",       num: "4",  title: "Writing Plans That Work",  act: "I" },
    { id: "crucible",            file: "crucible.html",            num: "5",  title: "Crucible (Idea Smelting)", act: "I" },
    // ─── Act II — Forge (execute → ship) ───
    { id: "your-first-plan",     file: "your-first-plan.html",     num: "6",  title: "Your First Plan",          act: "II" },
    { id: "dashboard",           file: "dashboard.html",           num: "7",  title: "The Dashboard",            act: "II" },
    { id: "cli-reference",       file: "cli-reference.html",       num: "8",  title: "CLI Reference",            act: "II" },
    { id: "customization",       file: "customization.html",       num: "9",  title: "Customization",            act: "II" },
    { id: "instructions-agents", file: "instructions-agents.html", num: "10", title: "Instruction Files & Agents", act: "II" },
    { id: "mcp-server",          file: "mcp-server.html",          num: "11", title: "MCP Server & Tools",       act: "II" },
    { id: "extensions",          file: "extensions.html",          num: "12", title: "Extensions",               act: "II" },
    { id: "multi-agent",         file: "multi-agent.html",         num: "13", title: "Multi-Agent Setup",        act: "II" },
    { id: "advanced-execution",  file: "advanced-execution.html",  num: "14", title: "Advanced Execution",       act: "II" },
    { id: "troubleshooting",     file: "troubleshooting.html",     num: "15", title: "Troubleshooting",          act: "II" },
    // ─── Act III — Guard (post-deploy defense) ───
    { id: "what-is-liveguard",   file: "what-is-liveguard.html",   num: "16", title: "What Is LiveGuard?",        act: "III" },
    { id: "liveguard-tools",     file: "liveguard-tools.html",     num: "17", title: "LiveGuard Tools Reference", act: "III" },
    { id: "liveguard-dashboard", file: "liveguard-dashboard.html", num: "18", title: "The LiveGuard Dashboard",    act: "III" },
    // ─── Act IV — Learn (memory & retrospectives) ───
    { id: "memory-architecture", file: "memory-architecture.html", num: "19", title: "Memory Architecture",       act: "IV" },
    // ─── Appendices ───
    { id: "glossary",            file: "glossary.html",            num: "A",  title: "Glossary",                 act: "Appendix" },
    { id: "quick-reference",     file: "quick-reference.html",     num: "B",  title: "Quick Reference Card",     act: "Appendix" },
    { id: "stack-notes",         file: "stack-notes.html",         num: "C",  title: "Stack-Specific Notes",     act: "Appendix" },
    { id: "grok-warnings",       file: "grok-image-warnings.html", num: "D",  title: "Grok Image Warnings",      act: "Appendix" },
    { id: "sample-project",       file: "sample-project.html",      num: "E",  title: "Sample Project",            act: "Appendix" },
    { id: "liveguard-runbooks",  file: "liveguard-runbooks.html",  num: "F",  title: "LiveGuard Alert Runbooks",  act: "Appendix" },
    { id: "about-author",         file: "about-author.html",        num: "",   title: "About the Author",          act: "Appendix" },
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
        const actLabels = { I: "Act I — Smelt", II: "Act II — Forge", III: "Act III — Guard", IV: "Act IV — Learn", Appendix: "Appendices" };
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
  // Cross-page search index: chapters + key sections from every chapter
  const SEARCH_SECTIONS = [
    // Ch 1
    { t: "The Problem in One Sentence", u: "what-is-plan-forge.html#the-problem" },
    { t: "What Happens Without Guardrails", u: "what-is-plan-forge.html#without-guardrails" },
    { t: "What Plan Forge Does", u: "what-is-plan-forge.html#what-it-does" },
    { t: "The Blacksmith Analogy", u: "what-is-plan-forge.html#the-analogy" },
    { t: "Who This Is For", u: "what-is-plan-forge.html#who-its-for" },
    { t: "What This Is Not", u: "what-is-plan-forge.html#what-this-is-not" },
    // Ch 2
    { t: "The 7-Step Pipeline", u: "how-it-works.html#pipeline" },
    { t: "Sessions and Why They Matter", u: "how-it-works.html#sessions" },
    { t: "The File System", u: "how-it-works.html#file-system" },
    { t: "How Guardrails Auto-Load (applyTo)", u: "how-it-works.html#apply-to" },
    { t: ".forge.json Config", u: "how-it-works.html#forge-json" },
    { t: "Plans Are Markdown", u: "how-it-works.html#plans" },
    { t: "Slices Gates and Scope", u: "how-it-works.html#building-blocks" },
    { t: "Nested Subagents", u: "how-it-works.html#sessions" },
    // Ch 3
    { t: "Prerequisites", u: "installation.html#prerequisites" },
    { t: "One-Click Install", u: "installation.html#one-click" },
    { t: "Setup Wizard", u: "installation.html#setup-wizard" },
    { t: "Choosing Your Preset", u: "installation.html#presets" },
    { t: "pforge smith Verification", u: "installation.html#verify" },
    { t: "Multi-Agent Setup", u: "installation.html#multi-agent" },
    { t: "Updating Plan Forge", u: "installation.html#updating" },
    // Ch 4
    { t: "Step 0 Specify the Feature", u: "your-first-plan.html#step-0" },
    { t: "Step 2 Harden the Plan", u: "your-first-plan.html#step-2" },
    { t: "Reading the Hardened Plan", u: "your-first-plan.html#reading-the-plan" },
    { t: "Step 3 Execute", u: "your-first-plan.html#step-3" },
    { t: "Step 5 Review", u: "your-first-plan.html#step-5" },
    { t: "Pipeline Agents Click-Through", u: "your-first-plan.html#alternative" },
    // Ch 5
    { t: "Plan Structure", u: "writing-plans.html#structure" },
    { t: "Writing a Good Scope Contract", u: "writing-plans.html#scope-contract" },
    { t: "Slicing Strategy", u: "writing-plans.html#slicing" },
    { t: "Validation Gates", u: "writing-plans.html#gates" },
    { t: "Parallel Execution [P] tag", u: "writing-plans.html#parallel" },
    { t: "Stop Conditions", u: "writing-plans.html#stop-conditions" },
    { t: "Context Files per Slice", u: "writing-plans.html#context" },
    { t: "Common Mistakes", u: "writing-plans.html#mistakes" },
    // Ch 6
    { t: "Starting the Dashboard", u: "dashboard.html#starting" },
    { t: "Progress Tab", u: "dashboard.html#progress" },
    { t: "Runs Tab", u: "dashboard.html#runs" },
    { t: "Cost Tab", u: "dashboard.html#cost" },
    { t: "Actions Tab", u: "dashboard.html#actions" },
    { t: "Replay Tab", u: "dashboard.html#replay" },
    { t: "Config Tab", u: "dashboard.html#config" },
    { t: "Traces Tab OTLP", u: "dashboard.html#traces" },
    // Ch 7
    { t: "pforge init", u: "cli-reference.html#init" },
    { t: "pforge check", u: "cli-reference.html#check" },
    { t: "pforge smith", u: "cli-reference.html#smith" },
    { t: "pforge status", u: "cli-reference.html#status" },
    { t: "pforge sweep", u: "cli-reference.html#sweep" },
    { t: "pforge diff", u: "cli-reference.html#diff" },
    { t: "pforge analyze", u: "cli-reference.html#analyze" },
    { t: "pforge diagnose", u: "cli-reference.html#diagnose" },
    { t: "pforge run-plan", u: "cli-reference.html#run-plan" },
    { t: "pforge ext", u: "cli-reference.html#ext" },
    { t: "pforge update", u: "cli-reference.html#update" },
    { t: "analyze vs diagnose", u: "cli-reference.html#commands" },
    // Ch 8
    { t: "Two-Layer Guardrail Model", u: "customization.html#two-layers" },
    { t: "Project Principles", u: "customization.html#principles" },
    { t: "Project Profile", u: "customization.html#profile" },
    { t: "copilot-instructions.md", u: "customization.html#master-config" },
    { t: "Custom Instruction Files", u: "customization.html#custom-instructions" },
    { t: "applyTo Pattern Reference", u: "customization.html#custom-instructions" },
    { t: "Configuration Hierarchy", u: "customization.html#config-hierarchy" },
    // Ch 9
    { t: "Universal Instruction Files", u: "instructions-agents.html#shared" },
    { t: "Domain Instruction Files", u: "instructions-agents.html#domain" },
    { t: "Stack-Specific Agents", u: "instructions-agents.html#agents" },
    { t: "Cross-Stack Agents", u: "instructions-agents.html#agents" },
    { t: "Pipeline Agents", u: "instructions-agents.html#agents" },
    { t: "Skills Slash Commands", u: "instructions-agents.html#skills" },
    { t: "Lifecycle Hooks", u: "instructions-agents.html#hooks" },
    // Ch 10
    { t: "MCP Server Architecture", u: "mcp-server.html#architecture" },
    { t: "18 MCP Tools", u: "mcp-server.html#tools" },
    { t: "REST API Endpoints", u: "mcp-server.html#rest-api" },
    { t: "WebSocket Hub Events", u: "mcp-server.html#websocket" },
    { t: "OTLP Telemetry Traces", u: "mcp-server.html#telemetry" },
    { t: "Cost Tracking", u: "mcp-server.html#cost" },
    { t: "SDK for Integrators", u: "mcp-server.html#sdk" },
    { t: "forge_run_plan", u: "mcp-server.html#tools" },
    { t: "forge_generate_image", u: "mcp-server.html#tools" },
    // Ch 11
    { t: "Extension Catalog", u: "extensions.html#catalog" },
    { t: "Installing Extensions", u: "extensions.html#installing" },
    { t: "Creating Extensions", u: "extensions.html#creating" },
    { t: "Publishing Extensions", u: "extensions.html#publishing" },
    // Ch 12
    { t: "Feature Parity Matrix", u: "multi-agent.html#comparison" },
    { t: "Claude Code Setup", u: "multi-agent.html#claude" },
    { t: "Cursor Setup", u: "multi-agent.html#cursor" },
    { t: "Codex Setup", u: "multi-agent.html#codex" },
    { t: "Gemini Setup", u: "multi-agent.html#gemini" },
    { t: "Windsurf Setup", u: "multi-agent.html#windsurf" },
    { t: "Cloud Agent", u: "multi-agent.html#cloud-agent" },
    { t: "Spec Kit Interop", u: "multi-agent.html#spec-kit" },
    // Ch 13
    { t: "Model Routing", u: "advanced-execution.html#model-routing" },
    { t: "Escalation Chains", u: "advanced-execution.html#escalation" },
    { t: "Quorum Mode", u: "advanced-execution.html#quorum" },
    { t: "Cost Optimization", u: "advanced-execution.html#cost-optimization" },
    { t: "CI Integration GitHub Actions", u: "advanced-execution.html#ci-integration" },
    { t: "Parallel Execution DAG", u: "advanced-execution.html#parallel" },
    { t: "Resume and Retry", u: "advanced-execution.html#resume" },
    { t: "OpenBrain Memory", u: "advanced-execution.html#openbrain" },
    // Ch 14
    { t: "Diagnostic Tools", u: "troubleshooting.html#diagnostics" },
    { t: "Agent Not Following Guardrails", u: "troubleshooting.html#guardrails-not-loading" },
    { t: "Plan Execution Fails", u: "troubleshooting.html#execution-fails" },
    { t: "Dashboard Won't Load", u: "troubleshooting.html#dashboard-issues" },
    { t: "Setup Failed", u: "troubleshooting.html#setup-issues" },
    { t: "Costs Are Too High", u: "troubleshooting.html#costs-high" },
    { t: "Grok Image Generation", u: "troubleshooting.html#image-generation" },
    { t: "Common Error Messages", u: "troubleshooting.html#common-errors" },
  ];

  function initSearch() {
    const input = document.querySelector(".search-input");
    const resultsEl = document.querySelector(".search-results");
    if (!input || !resultsEl) return;

    // Build index: chapter titles + cross-page section index + current-page headings
    const searchIndex = CHAPTERS.filter((_, i) => i > 0).map((ch) => ({
      title: (ch.num ? ch.num + ". " : "") + ch.title,
      url: ch.file,
    }));

    // Add cross-page sections
    SEARCH_SECTIONS.forEach((s) => searchIndex.push({ title: s.t, url: s.u }));

    // Add h2/h3 from current page (deep links within this page)
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
