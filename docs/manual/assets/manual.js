/* Plan Forge Manual — JavaScript
   Sidebar navigation, client-side search, prev/next, copy buttons, mobile toggle. */

(function () {
  "use strict";

  // ─── Chapter registry ───
  const CHAPTERS = [
    { id: "index",               file: "index.html",               num: "",   title: "Manual Home",              act: "" },
    // ─── Quickstart (Zero to shipped in 30 min) ───
    { id: "quickstart-install",      file: "quickstart-install.html",      num: "Q1", title: "Install",                act: "Quickstart" },
    { id: "quickstart-first-plan",   file: "quickstart-first-plan.html",   num: "Q2", title: "Your First Plan",         act: "Quickstart" },
    { id: "quickstart-first-deploy", file: "quickstart-first-deploy.html", num: "Q3", title: "Review & Ship",           act: "Quickstart" },
    // ─── Act I — Smelt (intake → scope contract) ───
    { id: "what-is-plan-forge",  file: "what-is-plan-forge.html",  num: "1",  title: "What Is Plan Forge?",      act: "I" },
    { id: "how-it-works",        file: "how-it-works.html",        num: "2",  title: "How It Works",             act: "I" },
    { id: "installation",        file: "installation.html",        num: "3",  title: "Installation",             act: "I" },
    { id: "writing-plans",       file: "writing-plans.html",       num: "4",  title: "Writing Plans That Work",  act: "I" },
    { id: "crucible",            file: "crucible.html",            num: "5",  title: "Crucible (Idea Smelting)", act: "I" },
    { id: "spec-kit-interop",    file: "spec-kit-interop.html",    num: "",   title: "Spec Kit Interop",         act: "I" },
    // ─── Act II — Forge (execute → ship) ───
    { id: "your-first-plan",     file: "your-first-plan.html",     num: "6",  title: "Your First Plan",          act: "II" },
    { id: "dashboard",           file: "dashboard.html",           num: "7",  title: "The Dashboard",            act: "II" },
    { id: "dashboard-settings",  file: "dashboard-settings.html",  num: "",   title: "Dashboard — Settings",     act: "II" },
    { id: "dashboard-forge-master", file: "dashboard-forge-master.html", num: "", title: "Dashboard — Forge-Master", act: "II" },
    { id: "dashboard-liveguard", file: "dashboard-liveguard.html", num: "",   title: "Dashboard — LiveGuard",    act: "II" },
    { id: "forge-master",        file: "forge-master.html",        num: "",   title: "Forge-Master (Deep Dive)",  act: "II" },
    { id: "cli-reference",       file: "cli-reference.html",       num: "8",  title: "CLI Reference",            act: "II" },
    { id: "customization",       file: "customization.html",       num: "9",  title: "Customization",            act: "II" },
    { id: "instructions-agents", file: "instructions-agents.html", num: "10", title: "Instruction Files & Agents", act: "II" },
    { id: "instructions-agents-reference", file: "instructions-agents-reference.html", num: "", title: "Instructions & Agents — Reference", act: "II" },
    { id: "mcp-server",           file: "mcp-server.html",              num: "11", title: "MCP Server & Tools",        act: "II" },
    { id: "mcp-server-quickstart", file: "mcp-server-quickstart.html", num: "",   title: "MCP Server — Quick Start",  act: "II" },
    { id: "mcp-server-reference",  file: "mcp-server-reference.html",  num: "",   title: "MCP Server — Reference",    act: "II" },
    { id: "extensions",           file: "extensions.html",              num: "12", title: "Extensions",                act: "II" },
    { id: "multi-agent",         file: "multi-agent.html",         num: "13", title: "Multi-Agent Setup",        act: "II" },
    { id: "advanced-execution",  file: "advanced-execution.html",  num: "14", title: "Advanced Execution",       act: "II" },
    { id: "self-deterministic-loop", file: "self-deterministic-loop.html", num: "", title: "Self-Deterministic Loop (Deep Dive)", act: "II" },
    { id: "inner-loop",          file: "inner-loop.html",          num: "",   title: "The Inner Loop (Deep Dive)",       act: "II" },
    { id: "competitive-loop",    file: "competitive-loop.html",    num: "",   title: "The Competitive Loop (Deep Dive)", act: "II" },
    { id: "audit-loop",          file: "audit-loop.html",          num: "",   title: "Audit Loop (Deep Dive)",            act: "II" },
    { id: "troubleshooting",     file: "troubleshooting.html",     num: "15", title: "Troubleshooting",          act: "II" },
    // ─── Act III — Guard (post-deploy defense) ───
    { id: "what-is-liveguard",   file: "what-is-liveguard.html",   num: "16", title: "What Is LiveGuard?",        act: "III" },
    { id: "liveguard-tools",     file: "liveguard-tools.html",     num: "17", title: "LiveGuard Tools Reference", act: "III" },
    { id: "liveguard-dashboard", file: "liveguard-dashboard.html", num: "18", title: "The LiveGuard Dashboard",    act: "III" },
    { id: "watcher",             file: "watcher.html",             num: "19", title: "The Watcher",               act: "III" },
    { id: "remote-bridge",       file: "remote-bridge.html",       num: "20", title: "The Remote Bridge",         act: "III" },
    // ─── Act IV — Learn (memory & retrospectives) ───
    { id: "bug-registry",        file: "bug-registry.html",        num: "21", title: "The Bug Registry",           act: "IV" },
    { id: "testbed",             file: "testbed.html",             num: "22", title: "The Testbed",                act: "IV" },
    { id: "health-dna",          file: "health-dna.html",          num: "23", title: "Health DNA",                 act: "IV" },
    { id: "memory-architecture", file: "memory-architecture.html", num: "24", title: "Memory Architecture",       act: "IV" },
    // ─── Appendices ───
    { id: "glossary",            file: "glossary.html",            num: "A",  title: "Glossary",                 act: "Appendix" },
    { id: "quick-reference",     file: "quick-reference.html",     num: "B",  title: "Quick Reference Card",     act: "Appendix" },
    { id: "stack-notes",         file: "stack-notes.html",         num: "C",  title: "Stack-Specific Notes",     act: "Appendix" },
    { id: "grok-warnings",       file: "grok-image-warnings.html", num: "D",  title: "Grok Image Warnings",      act: "Appendix" },
    { id: "sample-project",       file: "sample-project.html",      num: "E",  title: "Sample Project",            act: "Appendix" },
    { id: "liveguard-runbooks",  file: "liveguard-runbooks.html",  num: "F",  title: "LiveGuard Alert Runbooks",  act: "Appendix" },
    { id: "update-source",       file: "update-source.html",       num: "G",  title: "Update Source Modes",       act: "Appendix" },
    { id: "plan-forge-on-the-github-stack", file: "plan-forge-on-the-github-stack.html", num: "H",  title: "Plan Forge on the GitHub Stack", act: "Appendix" },
    { id: "enterprise-deployment",            file: "enterprise-deployment.html",            num: "I", title: "Plan Forge for Enterprise",         act: "Appendix" },
    { id: "github-stack-alignment",           file: "github-stack-alignment.html",           num: "J", title: "GitHub Stack Alignment",            act: "Appendix" },
    { id: "enterprise-reference-architecture", file: "enterprise-reference-architecture.html", num: "K", title: "Enterprise Reference Architecture", act: "Appendix" },
    { id: "agent-factory-recipe",             file: "agent-factory-recipe.html",             num: "L", title: "Agent Factory Recipe",              act: "Appendix" },
    { id: "fleet-operator-playbook",          file: "fleet-operator-playbook.html",          num: "M", title: "Fleet Operator Playbook",           act: "Appendix" },
    { id: "compliance-and-data-residency",    file: "compliance-and-data-residency.html",    num: "N", title: "Compliance & Data Residency",       act: "Appendix" },
    { id: "lessons-learned",                  file: "lessons-learned.html",                  num: "",  title: "Lessons Learned",                   act: "Appendix" },
    { id: "project-history",                  file: "project-history.html",                  num: "",  title: "Project History",                   act: "Appendix" },
    { id: "about-author",         file: "about-author.html",        num: "",   title: "About the Author",          act: "Appendix" },
    { id: "book-index",           file: "book-index.html",          num: "O",  title: "Book Index (A\u2013Z)",     act: "Appendix" },
  ];

  // Detect current page
  const currentFile = location.pathname.split("/").pop() || "index.html";
  const currentIdx = CHAPTERS.findIndex((c) => c.file === currentFile);

  // ─── Theme (light / dark) ───
  // Apply saved theme as early as possible so the sidebar renders the correct toggle label.
  const THEME_KEY = "pforge-manual-theme";
  function getTheme() {
    try { return localStorage.getItem(THEME_KEY) || "dark"; } catch (e) { return "dark"; }
  }
  function setTheme(theme) {
    document.documentElement.classList.toggle("light-mode", theme === "light");
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  }
  // Apply immediately (before DOMContentLoaded) so first paint matches saved preference.
  if (getTheme() === "light") {
    document.documentElement.classList.add("light-mode");
  }

  // ─── Sidebar collapse state ───
  const NAV_STATE_KEY = "pforge-manual-nav-state";
  function loadNavState() {
    try { return JSON.parse(localStorage.getItem(NAV_STATE_KEY) || "{}"); } catch (e) { return {}; }
  }
  function saveNavState(state) {
    try { localStorage.setItem(NAV_STATE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function actGroupId(act) {
    return "nav-act-" + act.replace(/[^a-zA-Z0-9]/g, "-");
  }

  // ─── Sidebar generation ───
  function buildSidebar() {
    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;

    const navState = loadNavState();
    const theme = getTheme();
    const frag = document.createDocumentFragment();

    // Logo / title link
    const titleLink = document.createElement("a");
    titleLink.href = "index.html";
    titleLink.className = "block px-5 py-4 text-sm font-bold text-slate-100 hover:text-amber-400 transition-colors border-b border-slate-800/50";
    titleLink.innerHTML = "⚒ Plan Forge Manual";
    frag.appendChild(titleLink);

    // Sidebar controls (Collapse All / Expand All / Theme toggle)
    const controls = document.createElement("div");
    controls.className = "sidebar-controls";
    controls.innerHTML =
      '<button id="nav-collapse-all" class="sidebar-ctrl-btn" type="button" aria-label="Collapse all sections" title="Collapse all">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>' +
        ' Collapse' +
      '</button>' +
      '<button id="nav-expand-all" class="sidebar-ctrl-btn" type="button" aria-label="Expand all sections" title="Expand all">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' +
        ' Expand' +
      '</button>' +
      '<button id="nav-theme-toggle" class="sidebar-ctrl-btn" type="button" aria-label="Toggle light/dark theme" title="Toggle theme">' +
        (theme === "light" ? '🌙 Dark' : '☀️ Light') +
      '</button>';
    frag.appendChild(controls);

    // Search
    const searchWrap = document.createElement("div");
    searchWrap.className = "px-4 py-3 relative";
    searchWrap.innerHTML =
      '<svg class="absolute left-7 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>' +
      '<input type="text" class="search-input" placeholder="Search manual..." aria-label="Search manual" />' +
      '<div class="search-results"></div>';
    frag.appendChild(searchWrap);

    // Group chapters by act so we can render collapsible sections
    const actLabels = { Quickstart: "⚡ Quickstart", I: "Act I — Smelt", II: "Act II — Forge", III: "Act III — Guard", IV: "Act IV — Learn", Appendix: "Appendices" };
    const actOrder = [];
    const actGroups = {};
    CHAPTERS.forEach((ch, i) => {
      if (i === 0) return; // Skip index
      if (!ch.act) return;
      if (!actGroups[ch.act]) { actGroups[ch.act] = []; actOrder.push(ch.act); }
      actGroups[ch.act].push({ ch, idx: i });
    });

    actOrder.forEach((act) => {
      const items = actGroups[act];
      const groupId = actGroupId(act);
      const containsActive = items.some((it) => it.idx === currentIdx);
      // Default: expanded. If user explicitly collapsed it AND active page isn't inside, honor that.
      const stored = navState[groupId];
      const expanded = containsActive ? true : (stored === false ? false : true);

      const header = document.createElement("button");
      header.type = "button";
      header.className = "sidebar-act sidebar-act-toggle" + (expanded ? " expanded" : "");
      header.setAttribute("data-group", groupId);
      header.setAttribute("aria-expanded", String(expanded));
      header.setAttribute("aria-controls", groupId);
      header.innerHTML =
        '<span>' + (actLabels[act] || act) + '</span>' +
        '<svg class="sidebar-act-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
      frag.appendChild(header);

      const childBox = document.createElement("div");
      childBox.id = groupId;
      childBox.className = "sidebar-act-children" + (expanded ? " expanded" : "");
      items.forEach(({ ch, idx }) => {
        const a = document.createElement("a");
        a.href = ch.file;
        a.className = "sidebar-link" + (idx === currentIdx ? " active" : "");
        a.innerHTML = '<span class="chapter-num">' + ch.num + "</span> " + ch.title;
        childBox.appendChild(a);
      });
      frag.appendChild(childBox);
    });

    nav.appendChild(frag);

    // ─── Wire controls ───
    const collapseBtn = document.getElementById("nav-collapse-all");
    const expandBtn = document.getElementById("nav-expand-all");
    const themeBtn = document.getElementById("nav-theme-toggle");

    function setGroup(groupEl, headerEl, expand) {
      groupEl.classList.toggle("expanded", expand);
      headerEl.classList.toggle("expanded", expand);
      headerEl.setAttribute("aria-expanded", String(expand));
    }

    nav.querySelectorAll(".sidebar-act-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const groupId = btn.getAttribute("data-group");
        const groupEl = document.getElementById(groupId);
        if (!groupEl) return;
        const willExpand = !groupEl.classList.contains("expanded");
        setGroup(groupEl, btn, willExpand);
        const state = loadNavState();
        state[groupId] = willExpand;
        saveNavState(state);
      });
    });

    if (collapseBtn) {
      collapseBtn.addEventListener("click", () => {
        const state = {};
        nav.querySelectorAll(".sidebar-act-toggle").forEach((btn) => {
          const groupEl = document.getElementById(btn.getAttribute("data-group"));
          if (groupEl) { setGroup(groupEl, btn, false); state[groupEl.id] = false; }
        });
        saveNavState(state);
      });
    }
    if (expandBtn) {
      expandBtn.addEventListener("click", () => {
        const state = {};
        nav.querySelectorAll(".sidebar-act-toggle").forEach((btn) => {
          const groupEl = document.getElementById(btn.getAttribute("data-group"));
          if (groupEl) { setGroup(groupEl, btn, true); state[groupEl.id] = true; }
        });
        saveNavState(state);
      });
    }
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        const next = getTheme() === "light" ? "dark" : "light";
        setTheme(next);
        themeBtn.innerHTML = next === "light" ? '🌙 Dark' : '☀️ Light';
      });
    }

    // Scroll active link into view on first load
    const activeEl = nav.querySelector(".sidebar-link.active");
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "center", behavior: "instant" });
    }
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

  // ─── Sidebar toggle (mobile slide-out + desktop collapse) ───
  function initMobileSidebar() {
    const btn = document.getElementById("mobile-sidebar-btn");
    const sidebar = document.getElementById("manual-sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (!btn || !sidebar) return;

    const desktopMQ = window.matchMedia("(min-width: 1024px)");
    const STORAGE_KEY = "pforgeManualSidebarCollapsed";

    // Restore desktop collapse preference
    if (desktopMQ.matches && localStorage.getItem(STORAGE_KEY) === "1") {
      document.body.classList.add("sidebar-collapsed");
    }

    const updateAria = () => {
      const isCollapsed = desktopMQ.matches
        ? document.body.classList.contains("sidebar-collapsed")
        : !sidebar.classList.contains("open");
      btn.setAttribute("aria-label", isCollapsed ? "Open navigation" : "Close navigation");
      btn.setAttribute("aria-expanded", String(!isCollapsed));
    };
    updateAria();

    const toggle = () => {
      if (desktopMQ.matches) {
        // Desktop: collapse/expand via body class, persist to localStorage
        document.body.classList.toggle("sidebar-collapsed");
        const collapsed = document.body.classList.contains("sidebar-collapsed");
        if (collapsed) localStorage.setItem(STORAGE_KEY, "1");
        else localStorage.removeItem(STORAGE_KEY);
      } else {
        // Mobile: slide-out sidebar over content
        sidebar.classList.toggle("open");
        if (overlay) overlay.classList.toggle("open");
      }
      updateAria();
    };
    btn.addEventListener("click", toggle);
    if (overlay) overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
      updateAria();
    });

    // Close on link click (mobile only)
    sidebar.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        if (!desktopMQ.matches) {
          sidebar.classList.remove("open");
          if (overlay) overlay.classList.remove("open");
          updateAria();
        }
      });
    });

    // Re-evaluate aria on viewport change so screen-reader state stays accurate
    desktopMQ.addEventListener("change", updateAria);
  }

  // ─── Client-side search ───
  // Cross-page search index: chapters + key sections from every chapter
  const SEARCH_SECTIONS = [
    // Quickstart
    { t: "Check Prerequisites",                  u: "quickstart-install.html#prerequisites" },
    { t: "Clone and Run Setup",                  u: "quickstart-install.html#clone" },
    { t: "Pick Your Preset",                     u: "quickstart-install.html#presets" },
    { t: "Verify with pforge smith",             u: "quickstart-install.html#verify" },
    { t: "Specify the Feature (Quickstart)",     u: "quickstart-first-plan.html#step-0" },
    { t: "Pre-flight Check (Quickstart)",        u: "quickstart-first-plan.html#step-1" },
    { t: "Harden the Plan (Quickstart)",         u: "quickstart-first-plan.html#step-2" },
    { t: "Execute the Plan (Quickstart)",        u: "quickstart-first-plan.html#step-3" },
    { t: "Sweep for Deferred Work (Quickstart)", u: "quickstart-first-deploy.html#step-4" },
    { t: "Independent Review (Quickstart)",      u: "quickstart-first-deploy.html#step-5" },
    { t: "Ship (Quickstart)",                    u: "quickstart-first-deploy.html#step-6" },
    { t: "Whats Next After Quickstart",          u: "quickstart-first-deploy.html#whats-next" },
    // Ch 1
    { t: "The Problem in One Sentence", u: "what-is-plan-forge.html#the-problem" },
    { t: "The 80/20 Wall", u: "what-is-plan-forge.html#the-eighty-twenty-wall" },
    { t: "Evidence A/B Test Results", u: "what-is-plan-forge.html#evidence" },
    { t: "What Happens Without Guardrails", u: "what-is-plan-forge.html#without-guardrails" },
    { t: "What Plan Forge Does", u: "what-is-plan-forge.html#what-it-does" },
    { t: "The Blacksmith Analogy", u: "what-is-plan-forge.html#the-analogy" },
    { t: "Who This Is For", u: "what-is-plan-forge.html#who-its-for" },
    { t: "What This Is Not", u: "what-is-plan-forge.html#what-this-is-not" },
    // Ch 2
    { t: "The 7-Step Pipeline", u: "how-it-works.html#pipeline" },
    { t: "Sessions and Why They Matter", u: "how-it-works.html#sessions" },
    { t: "Why Session Isolation Works", u: "how-it-works.html#why-session-isolation-works" },
    { t: "The File System", u: "how-it-works.html#file-system" },
    { t: "How Guardrails Auto-Load (applyTo)", u: "how-it-works.html#apply-to" },
    { t: ".forge.json Config", u: "how-it-works.html#forge-json" },
    { t: "Plans Are Markdown", u: "how-it-works.html#plans" },
    { t: "Slices Gates and Scope", u: "how-it-works.html#building-blocks" },
    { t: "Nested Subagents", u: "how-it-works.html#sessions" },
    // Lessons Learned
    { t: "Agents Don't Drift Maliciously", u: "lessons-learned.html#agents-dont-drift-maliciously" },
    { t: "Auto-Loading Beats Manual", u: "lessons-learned.html#auto-loading-beats-manual" },
    { t: "Independent Review Catches What Builds Miss", u: "lessons-learned.html#independent-review" },
    { t: "Slice Boundaries Matter More Than You Think", u: "lessons-learned.html#slice-boundaries" },
    { t: "Focused Instructions Beat Generic Ones", u: "lessons-learned.html#focused-instructions" },
    // Project History
    { t: "v1.0 Foundation", u: "project-history.html#v1-0-foundation" },
    { t: "v2.0 Autonomous", u: "project-history.html#v2-0-autonomous" },
    { t: "v2.5 Quorum Mode", u: "project-history.html#v2-5-quorum" },
    { t: "v2.10 OpenClaw", u: "project-history.html#v2-10-openclaw" },
    { t: "v2.14 GitHub Copilot Integration", u: "project-history.html#v2-14-copilot" },
    { t: "v2.18 Temper Guards", u: "project-history.html#v2-18-temper-guards" },
    { t: "v2.83 Current Release", u: "project-history.html#v2-83-current" },
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
    { t: "Skills Tab", u: "dashboard.html#skills" },
    { t: "Watcher Tab", u: "dashboard.html#watcher" },
    { t: "Audit-Loop Activation", u: "dashboard.html#audit-loop" },
    { t: "Timeline Tab", u: "dashboard.html#timeline" },
    // Dashboard — Settings
    { t: "Settings General Tab", u: "dashboard-settings.html#settings-general" },
    { t: "Settings Models Tab", u: "dashboard-settings.html#settings-models" },
    { t: "Settings Execution Tab", u: "dashboard-settings.html#settings-execution" },
    { t: "Settings API Keys Tab", u: "dashboard-settings.html#settings-api-keys" },
    { t: "Settings Updates Tab", u: "dashboard-settings.html#settings-updates" },
    { t: "Settings Memory Tab", u: "dashboard-settings.html#settings-memory" },
    { t: "Settings Bridge Tab", u: "dashboard-settings.html#settings-bridge" },
    { t: "Settings Crucible Tab", u: "dashboard-settings.html#settings-crucible" },
    { t: "Settings Brain Tab", u: "dashboard-settings.html#settings-brain" },
    // Dashboard — Forge-Master Studio
    { t: "Forge-Master Studio Tab", u: "dashboard-forge-master.html#studio" },
    { t: "Studio Classification Badge", u: "dashboard-forge-master.html#studio-classification" },
    { t: "Studio Quorum Advisory", u: "dashboard-forge-master.html#studio-quorum" },
    { t: "Studio Session Persistence", u: "dashboard-forge-master.html#studio-sessions" },
    // Dashboard — LiveGuard Tabs
    { t: "LiveGuard Health Tab", u: "dashboard-liveguard.html#lg-health" },
    { t: "LiveGuard Incidents Tab", u: "dashboard-liveguard.html#lg-incidents" },
    { t: "LiveGuard Triage Tab", u: "dashboard-liveguard.html#lg-triage" },
    { t: "LiveGuard Security Tab", u: "dashboard-liveguard.html#lg-security" },
    { t: "LiveGuard Env Tab", u: "dashboard-liveguard.html#lg-env" },
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
    // Ch 11
    { t: "MCP Server Architecture", u: "mcp-server.html#architecture" },
    { t: "MCP Server Chapter Overview", u: "mcp-server.html#chapters" },
    // Ch 11 — Quick Start
    { t: "Starting the MCP Server", u: "mcp-server-quickstart.html#starting" },
    { t: "Verify MCP Server Running", u: "mcp-server-quickstart.html#verify" },
    { t: "forge_capabilities Discovery", u: "mcp-server-quickstart.html#tool-capabilities" },
    { t: "forge_smith Environment Check", u: "mcp-server-quickstart.html#tool-smith" },
    { t: "forge_run_plan Execute Plan", u: "mcp-server-quickstart.html#tool-run-plan" },
    { t: "forge_plan_status Execution Status", u: "mcp-server-quickstart.html#tool-plan-status" },
    { t: "forge_abort Stop Execution", u: "mcp-server-quickstart.html#tool-abort" },
    { t: "forge_diagnose Bug Investigation", u: "mcp-server-quickstart.html#tool-diagnose" },
    { t: "forge_analyze Consistency Scoring", u: "mcp-server-quickstart.html#tool-analyze" },
    { t: "forge_estimate_quorum Cost Preview", u: "mcp-server-quickstart.html#tool-estimate" },
    { t: "Typical MCP Workflow", u: "mcp-server-quickstart.html#workflow" },
    // Ch 11 — Reference
    { t: "MCP Tools 69 Categories", u: "mcp-server-reference.html#tools" },
    { t: "Core MCP Tools", u: "mcp-server-reference.html#tools-core" },
    { t: "LiveGuard MCP Tools", u: "mcp-server-reference.html#tools-liveguard" },
    { t: "Watcher MCP Tools", u: "mcp-server-reference.html#tools-watcher" },
    { t: "Crucible MCP Tools", u: "mcp-server-reference.html#tools-crucible" },
    { t: "Tempering MCP Tools", u: "mcp-server-reference.html#tools-tempering" },
    { t: "Bug Registry MCP Tools", u: "mcp-server-reference.html#tools-bug-registry" },
    { t: "Testbed MCP Tools", u: "mcp-server-reference.html#tools-testbed" },
    { t: "Forge-Master MCP Tool", u: "mcp-server-reference.html#tools-forge-master" },
    { t: "REST API Endpoints", u: "mcp-server-reference.html#rest-api" },
    { t: "WebSocket Hub Events", u: "mcp-server-reference.html#websocket" },
    { t: "OTLP Telemetry Traces", u: "mcp-server-reference.html#telemetry" },
    { t: "Cost Tracking", u: "mcp-server-reference.html#cost" },
    { t: "SDK for Integrators", u: "mcp-server-reference.html#sdk" },
    { t: "API Key Configuration", u: "mcp-server-reference.html#api-keys" },
    { t: "forge_generate_image", u: "mcp-server-reference.html#tools-core" },
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
    { t: "OpenBrain: The Connective Tissue", u: "multi-agent.html#openbrain-connective-tissue" },
    // Ch 13
    { t: "Model Routing", u: "advanced-execution.html#model-routing" },
    { t: "Escalation Chains", u: "advanced-execution.html#escalation" },
    { t: "Quorum Mode", u: "advanced-execution.html#quorum" },
    { t: "Quorum vs Quorum Advisory", u: "advanced-execution.html#quorum-vs-advisory" },
    { t: "Worked Example - Copilot CLI + Grok API", u: "advanced-execution.html#quorum-mixed-example" },
    { t: "Estimating Quorum Cost forge_estimate_quorum", u: "advanced-execution.html#quorum-estimate" },
    { t: "Quorum Complexity Scoring Rubric", u: "advanced-execution.html#quorum-complexity" },
    { t: "Multi-Agent Quorum Turns PFORGE_QUORUM_TURN", u: "advanced-execution.html#quorum-multi-agent" },
    { t: "Quorum Quality Examples - 3 Models vs 1", u: "advanced-execution.html#quorum-quality-examples" },
    { t: "Host-Aware Routing", u: "advanced-execution.html#host-routing" },
    { t: "Cost Optimization", u: "advanced-execution.html#cost-optimization" },
    { t: "CI Integration GitHub Actions", u: "advanced-execution.html#ci-integration" },
    { t: "Parallel Execution DAG", u: "advanced-execution.html#parallel" },
    { t: "Resume and Retry", u: "advanced-execution.html#resume" },
    { t: "OpenBrain Memory", u: "advanced-execution.html#openbrain" },
    // Audit Loop chapter
    { t: "Discovery Harness Implementation", u: "audit-loop.html#discovery-harness" },
    { t: "Three-Lane Triage Funnel", u: "audit-loop.html#three-lane-triage" },
    // Ch 14
    { t: "Diagnostic Tools", u: "troubleshooting.html#diagnostics" },
    { t: "Agent Not Following Guardrails", u: "troubleshooting.html#guardrails-not-loading" },
    { t: "Plan Execution Fails", u: "troubleshooting.html#execution-fails" },
    { t: "Dashboard Won't Load", u: "troubleshooting.html#dashboard-issues" },
    { t: "Setup Failed", u: "troubleshooting.html#setup-issues" },
    { t: "Costs Are Too High", u: "troubleshooting.html#costs-high" },
    { t: "Grok Image Generation", u: "troubleshooting.html#image-generation" },
    { t: "Common Error Messages", u: "troubleshooting.html#common-errors" },
    // Ch 20 — Remote Bridge
    { t: "End-to-End Workflow: WhatsApp to Shipped PR", u: "remote-bridge.html#end-to-end-workflow" },
    // Ch 24 — Memory Architecture
    { t: "Unified Memory Across Agents", u: "memory-architecture.html#unified-memory-across-agents" },
    // Spec Kit Interop (Act I integration)
    { t: "Spec Kit Import Flow", u: "spec-kit-interop.html#import-flow" },
    { t: "Spec Kit Import Procedure", u: "spec-kit-interop.html#import-procedure" },
    { t: "Spec Kit Ecosystem Extensions", u: "spec-kit-interop.html#ecosystem-extensions" },
    // Appendix I — Plan Forge for Enterprise
    { t: "Why Plan Forge for the Enterprise", u: "enterprise-deployment.html#why-plan-forge-for-the-enterprise" },
    { t: "Where to Find What You Need (Enterprise)", u: "enterprise-deployment.html#where-to-find-what-you-need" },
    { t: "Quick Start for Evaluators", u: "enterprise-deployment.html#quick-start-for-evaluators" },
    // Appendix J — GitHub Stack Alignment
    { t: "What GitHub Ships (the Substrate)", u: "github-stack-alignment.html#what-github-ships-the-substrate" },
    { t: "What GitHub Leaves to the Ecosystem", u: "github-stack-alignment.html#what-github-leaves-to-ecosystem" },
    { t: "How Plan Forge Composes with GitHub", u: "github-stack-alignment.html#how-plan-forge-composes" },
    // Appendix K — Enterprise Reference Architecture
    { t: "Generic Enterprise Reference Architecture", u: "enterprise-reference-architecture.html#reference-architecture-a-generic" },
    { t: "Microsoft Foundry Composition Variant", u: "enterprise-reference-architecture.html#microsoft-foundry-variant" },
    { t: "Network and Isolation Patterns (Cloud / Hybrid / Air-Gapped)", u: "enterprise-reference-architecture.html#network-and-isolation-patterns" },
    { t: "Capacity Planning (Per-Team Sizing)", u: "enterprise-reference-architecture.html#capacity-planning" },
    // Appendix L — Agent Factory Recipe
    { t: "Agent Factory — The Recipe in One Page", u: "agent-factory-recipe.html#the-recipe-in-one-page" },
    { t: "Step 3 — Route Agents to Lanes", u: "agent-factory-recipe.html#step-3-route-agents" },
    { t: "MCP Server Selection (Plan Forge / GitHub / Foundry Toolbox)", u: "agent-factory-recipe.html#step-5-shared-tools" },
    { t: "Scaling the Factory Across Teams", u: "agent-factory-recipe.html#scaling-the-factory" },
    // Appendix M — Fleet Operator Playbook
    { t: "Day 1 — Pilot Installation", u: "fleet-operator-playbook.html#day-1-pilot-installation" },
    { t: "Week 4 — Pilot Graduation", u: "fleet-operator-playbook.html#week-4-pilot-graduation" },
    { t: "Week 12 — Full Fleet Quarterly Review", u: "fleet-operator-playbook.html#week-12-full-fleet" },
    { t: "Fleet KPIs", u: "fleet-operator-playbook.html#kpis" },
    { t: "Cost Discipline", u: "fleet-operator-playbook.html#cost-discipline" },
    { t: "Multi-Team Operations (Federated vs Centralized)", u: "fleet-operator-playbook.html#multi-team" },
    // Appendix N — Compliance and Data Residency
    { t: "Compliance — Data Flow", u: "compliance-and-data-residency.html#data-flow" },
    { t: "Compliance — Audit Logging", u: "compliance-and-data-residency.html#audit-logging" },
    { t: "Compliance — Identity and Authentication", u: "compliance-and-data-residency.html#identity-and-authentication" },
    { t: "Compliance Posture (SOC2 / HIPAA / PCI / FedRAMP / GDPR)", u: "compliance-and-data-residency.html#compliance-posture" },
    { t: "Air-Gapped Deployment", u: "compliance-and-data-residency.html#air-gapped-deployment" },
    { t: "Azure Government", u: "compliance-and-data-residency.html#azure-government" },
    { t: "Observability Export (OTel)", u: "compliance-and-data-residency.html#observability-export" },
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
