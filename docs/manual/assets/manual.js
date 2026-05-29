/* Plan Forge Manual — JavaScript
   Sidebar navigation, client-side search, prev/next, copy buttons, mobile toggle. */

(function () {
  "use strict";

  // ─── Chapter registry ───
  const CHAPTERS = [
    { id: "index",               file: "index.html",               num: "",   title: "Manual Home",              act: "" },
    { id: "conventions",         file: "conventions.html",         num: "",   title: "Conventions Used in This Manual", act: "Front Matter" },
    { id: "foreword",            file: "foreword.html",            num: "",   title: "Foreword \u2014 From Impossible to Seven Minutes", act: "Front Matter" },
    { id: "stakeholder-briefing", file: "stakeholder-briefing.html", num: "",   title: "Stakeholder Briefing \u2014 the 10-minute white paper", act: "Front Matter" },
    { id: "reader-paths",        file: "reader-paths.html",        num: "",   title: "Reader-Journey Ladders \u2014 Pick Your Path", act: "Front Matter" },
    // ─── Quickstart (Zero to shipped in 30 min) ───
    { id: "quickstart-install",      file: "quickstart-install.html",      num: "Q1", title: "Install",                act: "Quickstart" },
    { id: "quickstart-first-plan",   file: "quickstart-first-plan.html",   num: "Q2", title: "Your First Plan",         act: "Quickstart" },
    { id: "quickstart-first-deploy", file: "quickstart-first-deploy.html", num: "Q3", title: "Review & Ship",           act: "Quickstart" },
    // ─── Part I — Smelt (intake → scope contract) ───
    { id: "what-is-plan-forge",  file: "what-is-plan-forge.html",  num: "1",  title: "What Is Plan Forge?",      act: "I" },
    { id: "how-it-works",        file: "how-it-works.html",        num: "2",  title: "How It Works",             act: "I" },
    { id: "installation",        file: "installation.html",        num: "3",  title: "Installation",             act: "I" },
    { id: "writing-plans",       file: "writing-plans.html",       num: "4",  title: "Writing Plans That Work",  act: "I" },
    { id: "crucible",            file: "crucible.html",            num: "5",  title: "Crucible (Idea Smelting)", act: "I" },
    { id: "spec-kit-interop",    file: "spec-kit-interop.html",    num: "",   title: "Spec Kit Interop",         act: "I" },
    // ─── Part II — Forge (execute → ship) ───
    { id: "your-first-plan",     file: "your-first-plan.html",     num: "6",  title: "Your First Plan",          act: "II" },
    { id: "dashboard",           file: "dashboard.html",           num: "7",  title: "The Dashboard",            act: "II" },
    { id: "dashboard-settings",  file: "dashboard-settings.html",  num: "",   title: "Dashboard — Settings",     act: "II" },
    { id: "dashboard-forge-master", file: "dashboard-forge-master.html", num: "", title: "Dashboard — Forge-Master", act: "II" },
    { id: "dashboard-liveguard", file: "dashboard-liveguard.html", num: "",   title: "Dashboard — LiveGuard",    act: "II" },
    { id: "forge-master",        file: "forge-master.html",        num: "",   title: "Forge-Master",  act: "II" },
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
    { id: "cost-and-economics",  file: "cost-and-economics.html",  num: "31", title: "Cost & Economics",         act: "II" },
    // ─── Part III — Guard (post-deploy defense) ───
    { id: "what-is-liveguard",   file: "what-is-liveguard.html",   num: "16", title: "What Is LiveGuard?",        act: "III" },
    { id: "liveguard-tools",     file: "liveguard-tools.html",     num: "17", title: "LiveGuard Tools Reference", act: "III" },
    { id: "liveguard-dashboard", file: "liveguard-dashboard.html", num: "18", title: "The LiveGuard Dashboard",    act: "III" },
    { id: "watcher",             file: "watcher.html",             num: "19", title: "The Watcher",               act: "III" },
    { id: "remote-bridge",       file: "remote-bridge.html",       num: "20", title: "The Remote Bridge",         act: "III" },
    { id: "security-threat-model", file: "security-threat-model.html", num: "30", title: "Security & Threat Model",   act: "III" },
    // ─── Part IV — Learn (memory first, retrospectives after) ───
    { id: "memory-architecture", file: "memory-architecture.html", num: "21", title: "Memory Architecture",       act: "IV" },
    { id: "memory-system",       file: "memory-system.html",       num: "22", title: "How the Shop Remembers",   act: "IV" },
    { id: "bug-registry",        file: "bug-registry.html",        num: "23", title: "The Bug Registry",           act: "IV" },
    { id: "testbed",             file: "testbed.html",             num: "24", title: "The Testbed",                act: "IV" },
    { id: "health-dna",          file: "health-dna.html",          num: "25", title: "Health DNA",                 act: "IV" },
    // ─── Part V (Integrate) ───
    { id: "copilot-integration",     file: "copilot-integration.html",     num: "26", title: "The Copilot Integration Trilogy", act: "V" },
    { id: "team-coordination",       file: "team-coordination.html",       num: "27", title: "Team Coordination",               act: "V" },
    { id: "knowledge-graph",         file: "knowledge-graph.html",         num: "28", title: "The Knowledge Graph",             act: "V" },
    { id: "integrating-from-outside", file: "integrating-from-outside.html", num: "29", title: "Integrating from Outside",        act: "V" },
    // ─── Appendices ───
    { id: "glossary",            file: "glossary.html",            num: "A",  title: "Glossary",                 act: "Appendix" },
    { id: "quick-reference",     file: "quick-reference.html",     num: "B",  title: "Quick Reference Card",     act: "Appendix" },
    { id: "stack-notes",         file: "stack-notes.html",         num: "C",  title: "Stack-Specific Notes",     act: "Appendix" },
    { id: "grok-warnings",       file: "grok-image-warnings.html", num: "D",  title: "Grok Image Warnings",      act: "Appendix" },
    { id: "sample-project",       file: "sample-project.html",      num: "E",  title: "Sample Project",            act: "Appendix" },
    { id: "liveguard-runbooks",  file: "liveguard-runbooks.html",  num: "F",  title: "LiveGuard Alert Runbooks",  act: "Appendix" },
    { id: "update-source",       file: "update-source.html",       num: "G",  title: "Update Source Modes",       act: "Appendix" },
    { id: "github-stack-alignment",           file: "github-stack-alignment.html",           num: "H", title: "GitHub Stack Alignment",            act: "Appendix" },
    { id: "plan-forge-on-the-github-stack", file: "plan-forge-on-the-github-stack.html", num: "I",  title: "Plan Forge on the GitHub Stack", act: "Appendix" },
    { id: "enterprise-deployment",            file: "enterprise-deployment.html",            num: "J", title: "Plan Forge for Enterprise",         act: "Appendix" },
    { id: "enterprise-reference-architecture", file: "enterprise-reference-architecture.html", num: "K", title: "Enterprise Reference Architecture", act: "Appendix" },
    { id: "agent-factory-recipe",             file: "agent-factory-recipe.html",             num: "L", title: "Agent Factory Recipe",              act: "Appendix" },
    { id: "fleet-operator-playbook",          file: "fleet-operator-playbook.html",          num: "M", title: "Fleet Operator Playbook",           act: "Appendix" },
    { id: "compliance-and-data-residency",    file: "compliance-and-data-residency.html",    num: "N", title: "Compliance & Data Residency",       act: "Appendix" },
    { id: "lessons-learned",                  file: "lessons-learned.html",                  num: "",  title: "Lessons Learned",                   act: "Appendix" },
    { id: "project-history",                  file: "project-history.html",                  num: "",  title: "Project History",                   act: "Appendix" },
    { id: "about-author",         file: "about-author.html",        num: "",   title: "About the Author",          act: "Appendix" },
    { id: "book-index",           file: "book-index.html",          num: "O",  title: "Book Index (A\u2013Z)",     act: "Appendix" },
    { id: "list-of-figures",      file: "list-of-figures.html",     num: "P",  title: "List of Figures",            act: "Appendix" },
    { id: "api-surface-index",    file: "api-surface-index.html",    num: "Q",  title: "Unified API Surface Index",  act: "Appendix" },
    { id: "day-in-the-forge",        file: "day-in-the-forge.html",        num: "R",  title: "A Day in the Forge \u2014 Three Vignettes",  act: "Appendix" },
    { id: "how-do-i",                file: "how-do-i.html",                num: "S",  title: "How Do I\u2026? \u2014 Task Index",          act: "Appendix" },
    { id: "forge-json-reference",    file: "forge-json-reference.html",    num: "T",  title: ".forge.json Reference",                       act: "Appendix" },
    { id: "environment-variables-reference", file: "environment-variables-reference.html", num: "U", title: "Environment Variables Reference",  act: "Appendix" },
    { id: "event-catalog",           file: "event-catalog.html",           num: "V",  title: "Event Catalog",                              act: "Appendix" },
    { id: "rest-api-reference",      file: "rest-api-reference.html",      num: "W",  title: "REST API Reference",                         act: "Appendix" },
    { id: "errors-and-exit-codes",   file: "errors-and-exit-codes.html",   num: "X",  title: "Errors & Exit Codes",                        act: "Appendix" },
    { id: "plan-pattern-library",    file: "plan-pattern-library.html",    num: "Y",  title: "Plan Pattern Library",                       act: "Appendix" },
    { id: "failure-mode-catalog",    file: "failure-mode-catalog.html",    num: "Z",  title: "Failure-Mode Catalog",                       act: "Appendix" },
  ];

  // ─── Chapter status registry ───
  // Maps chapter id → { label, version } for status pills in the sidebar and index page.
  // Labels: "NEW" | "UPDATED" | "BETA"
  const STATUS = {
    "foreword":                      { label: "NEW",     version: "v3.6.2" },
    "stakeholder-briefing":          { label: "NEW",     version: "v3.6.2" },
    "reader-paths":                  { label: "NEW",     version: "v3.6.2" },
    "day-in-the-forge":              { label: "NEW",     version: "v3.6.2" },
    "how-do-i":                      { label: "NEW",     version: "v3.6.2" },
    "forge-json-reference":          { label: "NEW",     version: "v3.6.2" },
    "environment-variables-reference": { label: "NEW",   version: "v3.6.2" },
    "event-catalog":                 { label: "NEW",     version: "v3.6.2" },
    "rest-api-reference":            { label: "NEW",     version: "v3.6.2" },
    "errors-and-exit-codes":         { label: "NEW",     version: "v3.6.2" },
    "security-threat-model":         { label: "NEW",     version: "v3.6.2" },
    "cost-and-economics":            { label: "NEW",     version: "v3.6.2" },
    "plan-pattern-library":          { label: "NEW",     version: "v3.6.2" },
    "failure-mode-catalog":          { label: "NEW",     version: "v3.6.2" },
    "instructions-agents-reference": { label: "UPDATED", version: "v3.6.2" },
    "troubleshooting":               { label: "UPDATED", version: "v3.6.2" },
    "customization":                 { label: "UPDATED", version: "v3.6.2" },
    "inner-loop":                    { label: "NEW",     version: "v2.57" },
    "self-deterministic-loop":       { label: "NEW",     version: "v2.58" },
    "competitive-loop":              { label: "NEW",     version: "v2.58" },
    "forge-master":                  { label: "NEW",     version: "v2.78" },
    "dashboard-forge-master":        { label: "NEW",     version: "v2.78" },
    "audit-loop":                    { label: "NEW",     version: "v2.80" },
    "spec-kit-interop":              { label: "NEW",     version: "v2.70" },
    "plan-forge-on-the-github-stack":{ label: "UPDATED", version: "v2.75" },
    "memory-system":                 { label: "NEW",     version: "v3.5.1" },
    "copilot-integration":           { label: "NEW",     version: "v3.1" },
    "team-coordination":             { label: "NEW",     version: "v3.4" },
    "knowledge-graph":               { label: "NEW",     version: "v3.3" },
    "integrating-from-outside":      { label: "NEW",     version: "v3.5" },
  };

  // ─── Edition ───
  // Single source of truth for the manual edition badge shown in the meta-bar.
  // Fifth Edition — v3.6.2 (Phase MANUAL-EBOOK-COMPLETION ≥10/18 content slices shipped: A1-A7 front matter + B1 .forge.json + B2 env vars + B3 lifecycle hooks)
  const EDITION = "3.6.2";

  // ─── Manual counts (single source of truth) ───
  //
  // Authors: do NOT hand-write these numbers in chapter HTML. Use a token instead:
  //
  //     <!--c:tools-->74<!--/c-->
  //
  // The value between the tokens is rewritten at build time by `maintain.mjs`
  // from the table below. Run `node docs/manual/maintain.mjs` after editing.
  // Tokens that reference an unknown key are flagged as a MEDIUM audit issue.
  //
  // When you change a number here:
  //   1. Update the comment on the line so the source-of-truth is documented.
  //   2. Run `node docs/manual/maintain.mjs` to propagate.
  //   3. Commit both this file and any chapter files the substitution touched.
  //
  const MANUAL_COUNTS = {
    // Pipeline / surface ────────────────────────────────────────────────
    tools:        105, // MCP TOOLS array length (capabilities snapshot toolCount) — tools.json is a curated subset (92) and lags; use: node -e "import('./pforge-mcp/server/tool-definitions.mjs').then(m=>console.log(m.TOOLS.length))"
    instructions: 18,  // presets/dotnet|typescript/.github/instructions/
    agents:       12,  // 6 stack-specific + 6 pipeline (post Pass 5 reconciliation; cross-stack reviewers folded into stack agents)
    skills:       11,  // dotnet preset (typescript = 10) — varies by preset
    hooks:         5,  // PreDeploy.md, PreCommit.mjs, PreAgentHandoff.md, PostSlice.md (+ plan-forge.json config) — Plan Forge lifecycle hooks (NOT Claude Code hook names)
    prompts:       8,  // project-profile + step0-step6 pipeline prompts
    presets:       9,  // presets/* excluding the "shared" base
    'cli-commands': 97, // pforge.ps1 switch arms (unique) — verify with PowerShell: ([regex]::Matches((Get-Content pforge.ps1 -Raw),"(?m)^\s+''([a-z][a-z-]+)''\s+\{") | %{ $_.Groups[1].Value } | Sort-Object -Unique).Count
    // Manual structure ──────────────────────────────────────────────────
    chapters:     30,  // numbered chapters 1-31 (excludes Quickstart Q1-Q3 and Appendices) — Ch 11 was archived; 26-29 added Third Edition; 30 (Security & Threat Model) + 31 (Cost & Economics) added v3.6.2 Slices C1-C2
    appendices:   26,  // lettered appendices A-Z (R Day in the Forge v3.6.2 Slice A3, S How Do I…? Task Index v3.6.2 Slice A4, T .forge.json Reference v3.6.2 Slice B1, U Environment Variables Reference v3.6.2 Slice B2, V Event Catalog v3.6.2 Slice B4, W REST API Reference v3.6.2 Slice B5, X Errors & Exit Codes v3.6.2 Slice B7, Y Plan Pattern Library v3.6.2 Slice C3, Z Failure-Mode Catalog v3.6.2 Slice C4)
    parts:         5,  // Smelt, Forge, Guard, Learn, Integrate (Part V added Third Edition)
    // Manual assets ─────────────────────────────────────────────────────
    htmlFiles:    80,  // total .html files in docs/manual/ (Third Edition Slice A + Slice B + C1 + C2 + C3 + C4; +Foreword/Stakeholder/Reader Paths/Day in the Forge/How Do I…?/.forge.json Reference/Env Vars Reference/Event Catalog/REST API Reference/Errors & Exit Codes/Security & Threat Model/Cost & Economics/Plan Pattern Library/Failure-Mode Catalog v3.6.2 Fifth Edition)
  };

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

    // Logo / title link with inline collapse toggle
    const titleRow = document.createElement("div");
    titleRow.className = "flex items-center justify-between border-b border-slate-800/50";
    const titleLink = document.createElement("a");
    titleLink.href = "index.html";
    titleLink.className = "block px-5 py-4 text-sm font-bold text-slate-100 hover:text-amber-400 transition-colors flex-1";
    titleLink.innerHTML = "⚒ Plan Forge Manual";
    titleRow.appendChild(titleLink);
    const sidebarCloseBtn = document.createElement("button");
    sidebarCloseBtn.id = "sidebar-close-btn";
    sidebarCloseBtn.type = "button";
    sidebarCloseBtn.className = "sidebar-close-btn p-2 mr-2 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 transition-colors";
    sidebarCloseBtn.setAttribute("aria-label", "Close navigation");
    sidebarCloseBtn.title = "Close navigation";
    sidebarCloseBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    titleRow.appendChild(sidebarCloseBtn);
    frag.appendChild(titleRow);

    const siteLinkRow = document.createElement("div");
    siteLinkRow.className = "px-5 pb-2 pt-1 border-b border-slate-800/40";
    siteLinkRow.innerHTML = '<a href="https://planforge.software/" target="_blank" rel="noopener noreferrer" class="text-xs font-medium text-slate-400 hover:text-amber-400 transition-colors">↗ Main Site</a>';
    frag.appendChild(siteLinkRow);

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
    const actLabels = { Quickstart: "⚡ Quickstart", I: "Part I — Smelt", II: "Part II — Forge", III: "Part III — Guard", IV: "Part IV — Learn", V: "Part V — Integrate", Appendix: "Appendices" };
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
        const st = STATUS[ch.id];
        a.innerHTML = '<span class="chapter-num">' + ch.num + "</span> " + ch.title +
          (st ? ' <span class="status-pill status-pill--' + st.label.toLowerCase() + '">' + st.label + ' ' + st.version + '</span>' : '');
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
        // Let theme-aware widgets re-render with the new palette. Listeners
        // attach to `document` so script load order doesn't matter.
        try {
          document.dispatchEvent(new CustomEvent("pforge:theme-change", { detail: { theme: next } }));
        } catch (e) { /* CustomEvent unsupported — best effort */ }
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

  // ─── Back-to-top button (long-page rescue) ───
  function initBackToTop() {
    // Inject the button once (idempotent if called twice)
    if (document.getElementById("back-to-top-btn")) return;
    const btn = document.createElement("button");
    btn.id = "back-to-top-btn";
    btn.type = "button";
    btn.className = "back-to-top-btn";
    btn.setAttribute("aria-label", "Back to top of page");
    btn.title = "Back to top";
    btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
    document.body.appendChild(btn);

    const SHOW_AFTER = 400; // px scrolled before the button appears
    const onScroll = () => {
      if (window.scrollY > SHOW_AFTER) btn.classList.add("visible");
      else btn.classList.remove("visible");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    btn.addEventListener("click", () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }

  // ─── Sidebar toggle (mobile slide-out + desktop collapse) ───
  function initMobileSidebar() {
    const btn = document.getElementById("mobile-sidebar-btn");
    const innerBtn = document.getElementById("sidebar-close-btn");
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
      if (innerBtn) {
        innerBtn.setAttribute("aria-expanded", String(!isCollapsed));
      }
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
    if (innerBtn) innerBtn.addEventListener("click", toggle);
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
    // Foreword
    { t: "The One-Paragraph Version (Foreword)", u: "foreword.html#one-paragraph" },
    { t: "What Changed (and What Did Not)",      u: "foreword.html#what-changed" },
    { t: "The Four-Station Shop (Foreword)",     u: "foreword.html#four-stations" },
    { t: "What This Book Is Not (Foreword)",     u: "foreword.html#what-this-book-is-not" },
    { t: "How To Read This Book (Foreword)",     u: "foreword.html#how-to-read" },
    // Stakeholder Briefing
    { t: "Executive Summary (Stakeholder Briefing)",              u: "stakeholder-briefing.html#section-1" },
    { t: "What Plan Forge Is and Is Not (Stakeholder Briefing)",  u: "stakeholder-briefing.html#section-2" },
    { t: "The Four Cost Levers (Stakeholder Briefing)",           u: "stakeholder-briefing.html#section-3" },
    { t: "The Compounding Flywheel (Stakeholder Briefing)",       u: "stakeholder-briefing.html#section-4" },
    { t: "What We Add You Didn't Ask For (Stakeholder Briefing)", u: "stakeholder-briefing.html#section-5" },
    { t: "Adoption Path - Two Routes (Stakeholder Briefing)",     u: "stakeholder-briefing.html#section-6" },
    { t: "Why Open Source Matters (Stakeholder Briefing)",        u: "stakeholder-briefing.html#section-7" },
    { t: "Make This Yours - Tailoring Flow (Stakeholder Briefing)", u: "stakeholder-briefing.html#section-8" },
    // Reader-Journey Ladders
    { t: "The Five Ladders at a Glance (Reader Paths)",  u: "reader-paths.html#orientation" },
    { t: "Solo Developer Ladder (Reader Paths)",         u: "reader-paths.html#solo-dev" },
    { t: "Team Lead Ladder (Reader Paths)",              u: "reader-paths.html#team-lead" },
    { t: "Reviewer or Architect Ladder (Reader Paths)",  u: "reader-paths.html#reviewer-architect" },
    { t: "Enterprise Architect Ladder (Reader Paths)",   u: "reader-paths.html#enterprise-architect" },
    { t: "Extension Author Ladder (Reader Paths)",       u: "reader-paths.html#extension-author" },
    { t: "When Two Ladders Apply (Reader Paths)",        u: "reader-paths.html#cross-hops" },
    // A Day in the Forge — three vignettes (Appendix R)
    { t: "Three Vignettes at a Glance (Day in the Forge)",          u: "day-in-the-forge.html#orientation" },
    { t: "The Loop That Never Ends (Day in the Forge)",             u: "day-in-the-forge.html#vignette-1" },
    { t: "The .NET A/B Test — 99 vs 44 (Day in the Forge)",         u: "day-in-the-forge.html#vignette-2" },
    { t: "Quorum Mode in Practice (Day in the Forge)",              u: "day-in-the-forge.html#vignette-3" },
    { t: "What the Three Vignettes Share (Day in the Forge)",       u: "day-in-the-forge.html#closing" },
    // How Do I…? — task-first navigation index (Appendix S)
    { t: "How Do I — The Nine Intent Groups",                      u: "how-do-i.html#orientation" },
    { t: "How Do I — Install and Set Up",                          u: "how-do-i.html#install" },
    { t: "How Do I — Plan a Feature",                              u: "how-do-i.html#plan" },
    { t: "How Do I — Execute a Plan",                              u: "how-do-i.html#execute" },
    { t: "How Do I — Review and Ship",                             u: "how-do-i.html#review-ship" },
    { t: "How Do I — Customize Plan Forge for My Project",         u: "how-do-i.html#customize" },
    { t: "How Do I — Operate at Scale (Teams and Fleets)",         u: "how-do-i.html#operate" },
    { t: "How Do I — Debug and Troubleshoot",                      u: "how-do-i.html#debug" },
    { t: "How Do I — Extend and Integrate",                        u: "how-do-i.html#extend" },
    { t: "How Do I — Brief Stakeholders and Onboard Readers",      u: "how-do-i.html#brief" },
    // .forge.json Reference — field-by-field config schema (Appendix T)
    { t: ".forge.json Reference — Orientation",                    u: "forge-json-reference.html#orientation" },
    { t: ".forge.json — Project Identity (projectName, preset)",   u: "forge-json-reference.html#identity" },
    { t: ".forge.json — updateSource (auto / github-tags)",        u: "forge-json-reference.html#updateSource" },
    { t: ".forge.json — meta.selfRepairRepo",                      u: "forge-json-reference.html#meta" },
    { t: ".forge.json — agents (claude, cursor, codex)",           u: "forge-json-reference.html#agents" },
    { t: ".forge.json — modelRouting (default, execute, review)",  u: "forge-json-reference.html#modelRouting" },
    { t: ".forge.json — forgeMaster reasoning loop",               u: "forge-json-reference.html#forgeMaster" },
    { t: ".forge.json — Execution Limits (parallelism, retries)",  u: "forge-json-reference.html#execution" },
    { t: ".forge.json — quorum (multi-model consensus)",           u: "forge-json-reference.html#quorum" },
    { t: ".forge.json — extensions",                               u: "forge-json-reference.html#extensions" },
    { t: ".forge.json — hooks.preDeploy (LiveGuard)",              u: "forge-json-reference.html#hooks-preDeploy" },
    { t: ".forge.json — hooks.postSlice (drift thresholds)",       u: "forge-json-reference.html#hooks-postSlice" },
    { t: ".forge.json — hooks.preAgentHandoff",                    u: "forge-json-reference.html#hooks-preAgentHandoff" },
    { t: ".forge.json — openclaw analytics bridge",                u: "forge-json-reference.html#openclaw" },
    { t: ".forge.json — runtime.gateSynthesis (Phase-25 L6)",      u: "forge-json-reference.html#runtime-gateSynthesis" },
    { t: ".forge.json — runtime.reviewer (Phase-25 L4)",           u: "forge-json-reference.html#runtime-reviewer" },
    { t: ".forge.json — brain.federation (cross-project memory)",  u: "forge-json-reference.html#brain" },
    { t: ".forge.json — testbed.path",                             u: "forge-json-reference.html#testbed" },
    { t: ".forge.json — Full Annotated Example",                   u: "forge-json-reference.html#full-example" },
    // Environment Variables Reference — every env var Plan Forge reads (Appendix U)
    { t: "Env Vars Reference — Orientation",                       u: "environment-variables-reference.html#orientation" },
    { t: "Env Vars — Provider API Keys (XAI, OpenAI, Anthropic)",  u: "environment-variables-reference.html#provider-api-keys" },
    { t: "Env Vars — Azure OpenAI Alternative Routing",            u: "environment-variables-reference.html#azure-openai" },
    { t: "Env Vars — Server Ports and Network",                    u: "environment-variables-reference.html#server-ports" },
    { t: "Env Vars — Project and Runtime",                         u: "environment-variables-reference.html#project-runtime" },
    { t: "Env Vars — Orchestrator Timing (gate, worker timeouts)", u: "environment-variables-reference.html#orchestrator-timing" },
    { t: "Env Vars — Feature Toggles",                             u: "environment-variables-reference.html#feature-toggles" },
    { t: "Env Vars — Telemetry (OpenTelemetry)",                   u: "environment-variables-reference.html#telemetry-otel" },
    { t: "Env Vars — Host Detection (read-only)",                  u: "environment-variables-reference.html#host-detection" },
    { t: "Env Vars — CLI Internal (set transiently by pforge)",   u: "environment-variables-reference.html#cli-internal" },
    { t: "Env Vars — Resolution Precedence",                       u: "environment-variables-reference.html#precedence" },
    { t: "Env Vars — Worked Example (PowerShell profile)",         u: "environment-variables-reference.html#worked-example" },
    // Event Catalog — every event Plan Forge emits (Appendix V)
    { t: "Event Catalog — Orientation",                            u: "event-catalog.html#orientation" },
    { t: "Event Catalog — Common Envelope (version, type, source, security_risk)", u: "event-catalog.html#envelope" },
    { t: "Event Catalog — source enum",                            u: "event-catalog.html#source-enum" },
    { t: "Event Catalog — security_risk enum",                     u: "event-catalog.html#security-risk-enum" },
    { t: "Event Catalog — Lifecycle (run-started, slice-*, run-completed)", u: "event-catalog.html#lifecycle" },
    { t: "Event Catalog — Skills (skill-started, skill-step-*)",   u: "event-catalog.html#skills" },
    { t: "Event Catalog — Crucible (crucible-smelt-*)",            u: "event-catalog.html#crucible" },
    { t: "Event Catalog — Bridge (approval-*, bridge-notification-*)", u: "event-catalog.html#bridge" },
    { t: "Event Catalog — Escalation & CI (slice-escalated, ci-triggered)", u: "event-catalog.html#escalation" },
    { t: "Event Catalog — Client→server (set-label)",            u: "event-catalog.html#client-server" },
    { t: "Event Catalog — LiveGuard (drift, incident, secret-scan, watch-*)", u: "event-catalog.html#liveguard" },
    { t: "Event Catalog — Tempering (bug-validated-fixed)",        u: "event-catalog.html#tempering" },
    { t: "Event Catalog — Consuming the Stream (WebSocket subscription)", u: "event-catalog.html#subscribing" },
    { t: "Event Catalog — Retention (hub ring, run journal, LiveGuard cache, OpenClaw)", u: "event-catalog.html#retention" },
    // REST API Reference — every endpoint Plan Forge exposes (Appendix W)
    { t: "REST API — Orientation (16 subsystems, 113 endpoints)",   u: "rest-api-reference.html#orientation" },
    { t: "REST API — Authentication, binding, and CORS",           u: "rest-api-reference.html#auth-and-binding" },
    { t: "REST API — Error response shape",                        u: "rest-api-reference.html#error-shape" },
    { t: "REST API — Discovery (well-known, capabilities, version, status)", u: "rest-api-reference.html#discovery" },
    { t: "REST API — Plan execution and runs",                     u: "rest-api-reference.html#plan-execution" },
    { t: "REST API — Cost",                                        u: "rest-api-reference.html#cost" },
    { t: "REST API — Search, timeline, hub",                       u: "rest-api-reference.html#search-timeline" },
    { t: "REST API — Memory (L1/L2/L3)",                           u: "rest-api-reference.html#memory" },
    { t: "REST API — Crucible (idea smelting)",                    u: "rest-api-reference.html#crucible" },
    { t: "REST API — LiveGuard (drift, incidents, deploys, secret scan)", u: "rest-api-reference.html#liveguard" },
    { t: "REST API — Quorum and fix proposals",                    u: "rest-api-reference.html#quorum-fix" },
    { t: "REST API — Tempering and bugs",                          u: "rest-api-reference.html#tempering-bugs" },
    { t: "REST API — Skills (decision tray)",                      u: "rest-api-reference.html#skills" },
    { t: "REST API — Inner loop (reviewer calibration, gate suggestions)", u: "rest-api-reference.html#innerloop" },
    { t: "REST API — Bridge and approvals",                        u: "rest-api-reference.html#bridge" },
    { t: "REST API — Copilot integration",                         u: "rest-api-reference.html#copilot-integration" },
    { t: "REST API — GitHub and team coordination",                u: "rest-api-reference.html#github-team" },
    { t: "REST API — Notifications, audit, dashboard, settings",   u: "rest-api-reference.html#notifications-audit" },
    { t: "REST API — Generic MCP dispatcher (POST /api/tool/:name)", u: "rest-api-reference.html#generic-dispatcher" },
    { t: "REST API — Forge-Master (conversational entrypoint)",    u: "rest-api-reference.html#forge-master" },
    { t: "REST API — Image generation",                            u: "rest-api-reference.html#image" },
    { t: "REST API — Worked Examples (curl, wscat, SDK)",          u: "rest-api-reference.html#worked-examples" },
    // Errors & Exit Codes — the contract CI / on-call depends on (Appendix X)
    { t: "Errors & Exit Codes — Orientation (4 layers)",            u: "errors-and-exit-codes.html#orientation" },
    { t: "Errors & Exit Codes — pforge CLI exit codes (0/1/2)",     u: "errors-and-exit-codes.html#cli-exit-codes" },
    { t: "Errors & Exit Codes — Orchestrator exit codes & statusReason", u: "errors-and-exit-codes.html#orchestrator-exit-codes" },
    { t: "Errors & Exit Codes — MCP tool errors (forge_* envelope)", u: "errors-and-exit-codes.html#mcp-tool-errors" },
    { t: "Errors & Exit Codes — REST error shape (HTTP 400/404/409/429/500)", u: "errors-and-exit-codes.html#rest-error-shape" },
    { t: "Errors & Exit Codes — OS subprocess exits (Ctrl+C, SIGKILL, SIGTERM)", u: "errors-and-exit-codes.html#os-subprocess-exits" },
    { t: "Errors & Exit Codes — Named error catalog (A-Z)",         u: "errors-and-exit-codes.html#named-error-catalog" },
    { t: "Errors & Exit Codes — Error events on the hub",           u: "errors-and-exit-codes.html#error-events" },
    { t: "Errors & Exit Codes — CI / scripting recipes",            u: "errors-and-exit-codes.html#ci-recipes" },
    { t: "Troubleshooting — Errors & Exit Codes quick reference",   u: "troubleshooting.html#errors-exit-codes" },
    // Security & Threat Model — engineering view of attack surface (Chapter 30, Part III)
    { t: "Security — Orientation (developer-machine-first posture)", u: "security-threat-model.html#orientation" },
    { t: "Security — Trust boundaries (6 boundaries)",              u: "security-threat-model.html#trust-boundaries" },
    { t: "Security — Attack surface enumeration",                   u: "security-threat-model.html#attack-surface" },
    { t: "Security — STRIDE per subsystem",                         u: "security-threat-model.html#stride" },
    { t: "Security — AI-specific threats (prompt injection, untrusted tool output, scope escape)", u: "security-threat-model.html#ai-threats" },
    { t: "Security — Prompt injection defenses",                    u: "security-threat-model.html#prompt-injection" },
    { t: "Security — Untrusted tool output defenses",               u: "security-threat-model.html#untrusted-tool-output" },
    { t: "Security — Scope escape (drift detection, Review Gate)",  u: "security-threat-model.html#scope-escape" },
    { t: "Security — Secret management (env, .forge/secrets.json, gh auth)", u: "security-threat-model.html#secret-management" },
    { t: "Security — Supply chain (Plan Forge itself, extensions, providers)", u: "security-threat-model.html#supply-chain" },
    { t: "Security — Sandboxing & gate execution (TCB boundary)",   u: "security-threat-model.html#sandboxing" },
    { t: "Security — Hardening checklist (12 controls)",            u: "security-threat-model.html#hardening-checklist" },
    { t: "Security — Incident response (LiveGuard front door)",     u: "security-threat-model.html#incident-response" },
    // Cost & Economics — pricing surface, drivers, anti-lock-in (Chapter 31, Part II)
    { t: "Cost — Orientation (BYOK, no markup, per-slice attribution)", u: "cost-and-economics.html#orientation" },
    { t: "Cost — Three sources of truth (pricing table, estimators, actuals)", u: "cost-and-economics.html#three-sources" },
    { t: "Cost — Cost drivers (model tier, tokens, quorum, cache, reasoning, retries)", u: "cost-and-economics.html#cost-drivers" },
    { t: "Cost — Estimate vs actuals (forge_estimate_quorum vs forge_cost_report)", u: "cost-and-economics.html#estimate-vs-actuals" },
    { t: "Cost — Per-quorum-mode economics (auto / power / speed / disabled)", u: "cost-and-economics.html#quorum-economics" },
    { t: "Cost — Cost-effective workflows (slice sizing, routing, gates, cache, quorum)", u: "cost-and-economics.html#effective-workflows" },
    { t: "Cost — Anti-lock-in posture (BYOK, no proxy, no telemetry, open pricing)", u: "cost-and-economics.html#anti-lock-in" },
    { t: "Cost — Forecasting at scale (groupBy model / role / scope)", u: "cost-and-economics.html#forecasting-at-scale" },
    { t: "Cost — Worked example (slice B5 ship REST API reference)", u: "cost-and-economics.html#worked-example" },
    // Plan Pattern Library — reusable plan archetypes (Appendix Y)
    { t: "Plan Patterns — Index of 14 patterns (when, slice count)", u: "plan-pattern-library.html#index" },
    { t: "Plan Pattern P1 — Add an Entity (DB → service → API → UI)", u: "plan-pattern-library.html#p1-add-entity" },
    { t: "Plan Pattern P2 — Add an Endpoint (new route on existing entity)", u: "plan-pattern-library.html#p2-add-endpoint" },
    { t: "Plan Pattern P3 — Add an External Integration (third-party API)", u: "plan-pattern-library.html#p3-add-integration" },
    { t: "Plan Pattern P4 — Refactor a Subsystem (multi-consumer migration)", u: "plan-pattern-library.html#p4-refactor" },
    { t: "Plan Pattern P5 — Fix a Regression (strict red-green-refactor)", u: "plan-pattern-library.html#p5-fix-regression" },
    { t: "Plan Pattern P6 — Hotfix (minimal-surface emergency change)", u: "plan-pattern-library.html#p6-hotfix" },
    { t: "Plan Pattern P7 — Feature Flag Rollout (ship dark, toggle later)", u: "plan-pattern-library.html#p7-feature-flag" },
    { t: "Plan Pattern P8 — Data Migration (additive + backfill + verify)", u: "plan-pattern-library.html#p8-data-migration" },
    { t: "Plan Pattern P9 — Dependency Upgrade (per-module fix slices)", u: "plan-pattern-library.html#p9-dependency-upgrade" },
    { t: "Plan Pattern P10 — Performance Fix (benchmark-driven)", u: "plan-pattern-library.html#p10-performance-fix" },
    { t: "Plan Pattern P11 — Security Patch (CVE / vulnerability)",  u: "plan-pattern-library.html#p11-security-patch" },
    { t: "Plan Pattern P12 — Documentation Phase (one slice per document)", u: "plan-pattern-library.html#p12-documentation-phase" },
    { t: "Plan Pattern P13 — CI/CD Workflow Change (no-op + promote)", u: "plan-pattern-library.html#p13-ci-workflow" },
    { t: "Plan Pattern P14 — Spike-Then-Build (time-boxed exploration)", u: "plan-pattern-library.html#p14-spike-then-build" },
    { t: "Plan Patterns — Composing patterns across phases",       u: "plan-pattern-library.html#composition" },
    { t: "Plan Patterns — Anti-patterns (mega-slice, test-after, etc.)", u: "plan-pattern-library.html#anti-patterns" },
    // Failure-Mode Catalog — 25 failure modes by layer (Appendix Z)
    { t: "Failure Modes — Index (25 failure modes across 8 layers)", u: "failure-mode-catalog.html#index" },
    { t: "Failure Mode FM1 — Token limit hit",                       u: "failure-mode-catalog.html#fm1-token-limit" },
    { t: "Failure Mode FM2 — Model timeout",                         u: "failure-mode-catalog.html#fm2-model-timeout" },
    { t: "Failure Mode FM3 — Malformed tool call",                   u: "failure-mode-catalog.html#fm3-malformed-tool-call" },
    { t: "Failure Mode FM4 — Edit blocked by scope / forbidden actions", u: "failure-mode-catalog.html#fm4-scope-blocked" },
    { t: "Failure Mode FM5 — Worker loop detected",                  u: "failure-mode-catalog.html#fm5-loop-detected" },
    { t: "Failure Mode FM6 — Gate test failure (legitimate)",        u: "failure-mode-catalog.html#fm6-test-failure" },
    { t: "Failure Mode FM7 — Gate timeout",                          u: "failure-mode-catalog.html#fm7-gate-timeout" },
    { t: "Failure Mode FM8 — Non-portable gate command",             u: "failure-mode-catalog.html#fm8-non-portable-gate" },
    { t: "Failure Mode FM9 — Documentation validator drift",         u: "failure-mode-catalog.html#fm9-validator-drift" },
    { t: "Failure Mode FM10 — Worker spawn failure",                 u: "failure-mode-catalog.html#fm10-worker-spawn" },
    { t: "Failure Mode FM11 — Git stash conflict on rollback",       u: "failure-mode-catalog.html#fm11-stash-conflict" },
    { t: "Failure Mode FM12 — Snapshot apply failure",               u: "failure-mode-catalog.html#fm12-snapshot-apply" },
    { t: "Failure Mode FM13 — Plan parse error",                     u: "failure-mode-catalog.html#fm13-plan-parse" },
    { t: "Failure Mode FM14 — Provider rate limit (HTTP 429)",       u: "failure-mode-catalog.html#fm14-rate-limit" },
    { t: "Failure Mode FM15 — Provider 5xx / outage",                u: "failure-mode-catalog.html#fm15-provider-5xx" },
    { t: "Failure Mode FM16 — Auth expired",                         u: "failure-mode-catalog.html#fm16-auth-expired" },
    { t: "Failure Mode FM17 — L2 jsonl corruption",                  u: "failure-mode-catalog.html#fm17-l2-corruption" },
    { t: "Failure Mode FM18 — L3 endpoint unreachable",              u: "failure-mode-catalog.html#fm18-l3-unreachable" },
    { t: "Failure Mode FM19 — Hook false positive",                  u: "failure-mode-catalog.html#fm19-hook-false-positive" },
    { t: "Failure Mode FM20 — Hook script error",                    u: "failure-mode-catalog.html#fm20-hook-script-error" },
    { t: "Failure Mode FM21 — Quorum panel disagrees below threshold", u: "failure-mode-catalog.html#fm21-panel-disagree" },
    { t: "Failure Mode FM22 — Quorum panelist timeout",              u: "failure-mode-catalog.html#fm22-panelist-timeout" },
    { t: "Failure Mode FM23 — Port already in use",                  u: "failure-mode-catalog.html#fm23-port-in-use" },
    { t: "Failure Mode FM24 — Disk full",                            u: "failure-mode-catalog.html#fm24-disk-full" },
    { t: "Failure Mode FM25 — File locked (Windows)",                u: "failure-mode-catalog.html#fm25-file-locked" },
    { t: "Failure Modes — General recovery techniques",              u: "failure-mode-catalog.html#general-recovery" },
    // Quickstart
    { t: "Check Prerequisites",                  u: "quickstart-install.html#prerequisites" },
    { t: "Clone and Run Setup",                  u: "quickstart-install.html#clone" },
    { t: "Pick Your Preset",                     u: "quickstart-install.html#presets" },
    { t: "Verify with pforge smith",             u: "quickstart-install.html#verify" },
    { t: "Easy Button (one-prompt install)",     u: "quickstart-install.html#easy-button" },
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
    { t: "v2.83 Host-Aware Routing", u: "project-history.html#v2-83-host-routing" },
    { t: "v2.95 Lattice / Code-Graph", u: "project-history.html#v2-95-lattice" },
    { t: "v3.0 Copilot Trilogy", u: "project-history.html#v3-0-copilot-trilogy" },
    { t: "v3.2–3.4 Team Mode", u: "project-history.html#v3-2-team-mode" },
    { t: "v3.6 OpenBrain L3 (current)", u: "project-history.html#v3-6-openbrain-l3" },
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
    // Lifecycle Hooks Reference — added in Phase MANUAL-EBOOK-COMPLETION Slice B3 (v3.6.2)
    { t: "Lifecycle Hooks Reference — all eight hooks",          u: "customization.html#lifecycle-hooks" },
    { t: "Lifecycle Hooks — Copilot session (SessionStart, PreToolUse, PostToolUse, Stop)", u: "customization.html#hooks-copilot-session" },
    { t: "Lifecycle Hooks — LiveGuard (PreDeploy, PostSlice, PreAgentHandoff)",             u: "customization.html#hooks-liveguard" },
    { t: "Lifecycle Hooks — Plan-execution guard (PreCommit)",   u: "customization.html#hooks-plan-execution" },
    { t: "Lifecycle Hooks — Resolution order",                   u: "customization.html#hooks-resolution" },
    { t: "Lifecycle Hooks — Writing a custom hook",              u: "customization.html#hooks-writing" },
    { t: "Configuration Hierarchy", u: "customization.html#config-hierarchy" },
    // Ch 9
    { t: "Universal Instruction Files", u: "instructions-agents.html#shared" },
    { t: "Domain Instruction Files", u: "instructions-agents.html#domain" },
    { t: "Stack-Specific Agents", u: "instructions-agents-reference.html#agents-stack" },
    { t: "Cross-Stack Agents", u: "instructions-agents-reference.html#agents-cross-stack" },
    { t: "Pipeline Agents", u: "instructions-agents-reference.html#agents-pipeline" },
    { t: "Skills Slash Commands", u: "instructions-agents-reference.html#skills" },
    { t: "Skills — SKILL.md Runtime Contract", u: "instructions-agents-reference.html#skills-runtime-contract" },
    { t: "Skills — Events Emitted by the Runner", u: "instructions-agents-reference.html#skills-events" },
    { t: "Skills — Three Ways to Invoke", u: "instructions-agents-reference.html#skills-invocation" },
    { t: "Skills — Shared Skills (every preset)", u: "instructions-agents-reference.html#skills-shared" },
    { t: "Skills — Stack-Specific Skills (per language)", u: "instructions-agents-reference.html#skills-stack" },
    { t: "Skills — Authoring a New Skill", u: "instructions-agents-reference.html#skills-authoring" },
    { t: "Lifecycle Hooks", u: "instructions-agents-reference.html#hooks" },
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
    // Ch 25 — How the Shop Remembers
    { t: "How the Shop Remembers", u: "memory-system.html" },
    { t: "The Four New Pieces (Hallmark, Anvil, Lattice, sync_memories)", u: "memory-system.html#four-pieces" },
    { t: "A Day in the Life of a Slice", u: "memory-system.html#day-in-the-life" },
    { t: "Why Cheaper Models Punch Above Their Weight", u: "memory-system.html#cheaper-models" },
    { t: "Three Memory Commands You Can Run Today", u: "memory-system.html#three-commands" },
    { t: "Anvil & Lattice Dashboard Tab", u: "memory-system.html#dashboard" },
    { t: "How the New Memory Pieces Fit the Old Tiers", u: "memory-system.html#how-they-fit" },
    { t: "Hallmark (provenance, hallmark/v1)", u: "memory-system.html#four-pieces" },
    { t: "Anvil (L3 boundary, DLQ, capability handshake)", u: "memory-system.html#four-pieces" },
    { t: "Lattice (code-graph, chunker, callers, blast)", u: "memory-system.html#four-pieces" },
    { t: "forge_sync_memories (Copilot Memory soft-sync)", u: "memory-system.html#four-pieces" },
    // Spec Kit Interop (Part I integration)
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

  // ─── Meta-bar (index page only) ───
  // Renders a thin informational bar above the chapter grid showing the edition,
  // content counts, and a What's New link.
  function buildMetaBar() {
    const el = document.getElementById("meta-bar");
    if (!el) return;
    el.innerHTML =
      '<span class="meta-bar__edition">v' + EDITION + '</span>' +
      '<span class="meta-bar__sep">·</span>' +
      '<span>Quickstart · 28 chapters · 14 appendices · 5 parts</span>' +
      '<span class="meta-bar__sep">·</span>' +
      '<a href="https://github.com/srnichols/plan-forge/blob/main/CHANGELOG.md" class="meta-bar__link" target="_blank" rel="noopener">What\'s New ↗</a>';
  }

  // ─── Init ───
  document.addEventListener("DOMContentLoaded", () => {
    buildSidebar();
    buildMetaBar();
    buildPrevNext();
    initCopyButtons();
    initMobileSidebar();
    initBackToTop();
    initSearch();
    initDiagramZoom();
    loadGlossaryTooltips();
  });

  // ─── Diagram zoom (click-to-zoom modal + "View full size" caption link) ───
  // Wires up every .diagram-img inside .chapter-content so readers can pop a
  // diagram open at native resolution. Many SVGs (especially the deep-dive
  // callback graphs) render too small to read inline because the
  // .chapter-content column is capped at 52rem. This restores legibility
  // without forcing every diagram to be a wide-figure breakout.
  function initDiagramZoom() {
    const imgs = document.querySelectorAll(".chapter-content .diagram-img");
    if (!imgs.length) return;

    const modal = document.createElement("div");
    modal.className = "diagram-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Diagram. Click outside or press Escape to close.");
    modal.innerHTML = '<button type="button" class="diagram-modal-close" aria-label="Close diagram">\u00d7</button><img alt="" />';
    document.body.appendChild(modal);

    const modalImg = modal.querySelector("img");
    const closeBtn = modal.querySelector(".diagram-modal-close");
    let lastFocus = null;

    function open(src, alt) {
      lastFocus = document.activeElement;
      modalImg.src = src;
      modalImg.alt = alt || "";
      modal.classList.add("open");
      document.documentElement.style.overflow = "hidden";
      closeBtn.focus();
    }
    function close() {
      modal.classList.remove("open");
      modalImg.removeAttribute("src");
      document.documentElement.style.overflow = "";
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    }

    imgs.forEach(function (img) {
      img.classList.add("zoomable");
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", (img.alt ? img.alt + " — " : "") + "click to view full size");
      img.addEventListener("click", function () { open(img.src, img.alt); });
      img.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(img.src, img.alt); }
      });

      // Inject a "View full size ↗" link into the figcaption, if present.
      const fig = img.closest(".manual-figure");
      if (!fig) return;
      const cap = fig.querySelector(".manual-figcaption");
      if (!cap || cap.querySelector(".diagram-fullsize-link")) return;
      const a = document.createElement("a");
      a.href = img.src;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "diagram-fullsize-link";
      a.textContent = "View full size \u2197";
      cap.appendChild(document.createTextNode(" "));
      cap.appendChild(a);
    });

    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target === modalImg) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });
  }

  // ─── Glossary tooltips bootstrap ───
  // Loads the auto-generated terms dictionary (assets/glossary-terms.js) and
  // the runtime walker/tooltip (assets/glossary-tooltips.js) dynamically, so
  // chapter shells don't have to add per-page <script> tags. Each chapter
  // already loads assets/manual.js (enforced by maintain.mjs Step 5 shell
  // sanity check) — adding the tooltip system here piggybacks on that gate.
  //
  // Source of truth: docs/manual/glossary.html. Re-generate glossary-terms.js
  // by running `node docs/manual/maintain.mjs` (Step 5d).
  function loadGlossaryTooltips() {
    // Skip on the glossary page itself (self-tooltipping is pointless and
    // could recurse if anchors collide with term names).
    if (/\/glossary\.html$/.test(location.pathname)) return;
    // Skip if .chapter-content isn't present (e.g., index.html grid).
    if (!document.querySelector(".chapter-content")) return;

    loadScript("assets/glossary-terms.js", function () {
      if (!window.GLOSSARY_TERMS || Object.keys(window.GLOSSARY_TERMS).length === 0) return;
      loadScript("assets/glossary-tooltips.js");
    });
  }

  function loadScript(src, onload) {
    const s = document.createElement("script");
    s.src = src;
    s.defer = true;
    if (onload) s.onload = onload;
    document.body.appendChild(s);
  }
})();
