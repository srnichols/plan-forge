/**
 * Dashboard Screenshot Capture Script
 *
 * Captures all dashboard tabs with Playwright.
 * Uses real historical data from .forge/runs/ + cost-history.json.
 * Injects simulated run events for Progress tab "under load" state.
 *
 * Usage:
 *   1. Start server: node server.mjs --dashboard-only
 *   2. Run this:     node capture-screenshots.mjs
 *
 * Output: ../docs/assets/dashboard/ (relative to plan-forge repo)
 */

import { chromium } from "playwright";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_FORGE_ROOT = resolve(__dirname, "../../Plan-Forge");
const OUTPUT_DIR = resolve(PLAN_FORGE_ROOT, "docs/assets/dashboard");
const DASHBOARD_URL = "http://127.0.0.1:3100/dashboard";

// Simulated run events for Progress tab
const SIMULATED_EVENTS = [
  {
    type: "run-started",
    data: {
      plan: "docs/plans/Phase-3-INVOICE-ENGINE-PLAN.md",
      sliceCount: 6,
      executionOrder: ["1", "2", "3", "4", "5", "6"],
      mode: "auto",
      model: "claude-opus-4.6",
      quorum: { enabled: true, auto: true, threshold: 6 },
    },
  },
  {
    type: "slice-started",
    data: { sliceId: "1", title: "Invoice Model + DB Migration" },
  },
  {
    type: "slice-completed",
    data: {
      sliceId: "1",
      title: "Invoice Model + DB Migration",
      status: "passed",
      model: "claude-opus-4.6",
      duration: 42300,
      cost_usd: 0.0847,
      gateStatus: "passed",
      attempts: 1,
      tokens_in: 12400,
      tokens_out: 3200,
    },
  },
  {
    type: "slice-started",
    data: { sliceId: "2", title: "Invoice Repository + CRUD Queries" },
  },
  {
    type: "slice-completed",
    data: {
      sliceId: "2",
      title: "Invoice Repository + CRUD Queries",
      status: "passed",
      model: "claude-opus-4.6",
      duration: 38700,
      cost_usd: 0.0723,
      gateStatus: "passed",
      attempts: 2,
      tokens_in: 10800,
      tokens_out: 2900,
    },
  },
  {
    type: "slice-started",
    data: { sliceId: "3", title: "Invoice Service + Business Logic" },
  },
  {
    type: "slice-completed",
    data: {
      sliceId: "3",
      title: "Invoice Service + Business Logic",
      status: "passed",
      model: "grok-4",
      duration: 31200,
      cost_usd: 0.0512,
      gateStatus: "passed",
      attempts: 1,
      tokens_in: 8900,
      tokens_out: 2100,
    },
  },
  {
    type: "slice-started",
    data: { sliceId: "4", title: "API Controller + Endpoints" },
  },
  // Slice 4 is "executing" — screenshot captures this state
];

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Output: ${OUTPUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  // ─── 1. Load dashboard ──────────────────────────────────────────────
  console.log("Loading dashboard...");
  await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });

  // Wait for page to settle
  await page.waitForTimeout(1500);

  // ─── 2. Progress tab — inject plan browser + simulated run events ───
  console.log("Capturing Progress tab (plan browser + simulated live run)...");

  // Dashboard now defaults to Home — click Progress first so injection targets exist.
  await clickTab(page, "progress");
  await page.waitForTimeout(500);

  // Inject plan browser data (v2.7)
  await page.evaluate(() => {
    const listEl = document.getElementById("plan-list");
    const countEl = document.getElementById("plan-count");
    const browser = document.getElementById("plan-browser");
    if (!listEl) return;
    if (browser) browser.open = true;
    if (countEl) countEl.textContent = "(6)";
    const plans = [
      { title: "Invoice Engine", file: "Phase-3-INVOICE-ENGINE-PLAN.md", status: "🚧", sliceCount: 6, branch: "feature/v2.4-invoice",
        scope: { in: ["src/invoices/**", "prisma/migrations/**"], out: ["src/auth/**"], forbidden: ["src/config/**"] },
        slices: [
          { id: 1, title: "DB Migration", depends: [], parallel: false },
          { id: 2, title: "Repository", depends: [1], parallel: false },
          { id: 3, title: "Service Logic", depends: [2], parallel: false },
          { id: 4, title: "API Controller", depends: [3], parallel: false },
          { id: 5, title: "PDF Generation", depends: [3], parallel: true },
          { id: 6, title: "E2E Tests", depends: [4, 5], parallel: false },
        ] },
      { title: "Dashboard Core", file: "Phase-4-DASHBOARD-CORE-PLAN.md", status: "✅", sliceCount: 5, branch: "" },
      { title: "Dashboard Advanced", file: "Phase-5-DASHBOARD-ADVANCED-PLAN.md", status: "✅", sliceCount: 4, branch: "" },
      { title: "Parallel Execution", file: "Phase-6-PARALLEL-EXECUTION-PLAN.md", status: "📋", sliceCount: 7, branch: "" },
      { title: "WebSocket Hub", file: "Phase-3-WEBSOCKET-HUB-PLAN.md", status: "✅", sliceCount: 4, branch: "" },
      { title: "Dashboard v2.9", file: "Phase-11-DASHBOARD-V2.9-PLAN.md", status: "🚧", sliceCount: 8, branch: "feature/v2.9-dashboard-power-ux" },
    ];
    function escH(s) { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;"); }
    listEl.innerHTML = plans.map((p, pi) => {
      const icon = p.status;
      // v2.9: Scope contract
      let scopeHtml = "";
      if (p.scope) {
        scopeHtml = `<details class="mt-1 ml-7" ${pi === 0 ? 'open' : ''}>
          <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">Scope Contract</summary>
          <div class="grid grid-cols-3 gap-2 mt-1 py-1 text-xs">
            <div><p class="text-gray-500 font-semibold mb-1">In Scope</p>${p.scope.in.map(s => `<span class="text-green-400 text-xs">✓ ${s}</span>`).join("<br>")}</div>
            <div><p class="text-gray-500 font-semibold mb-1">Out of Scope</p>${p.scope.out.map(s => `<span class="text-gray-500 text-xs">✗ ${s}</span>`).join("<br>")}</div>
            <div><p class="text-gray-500 font-semibold mb-1">Forbidden</p>${p.scope.forbidden.map(s => `<span class="text-red-400 text-xs">⛔ ${s}</span>`).join("<br>")}</div>
          </div>
        </details>`;
      }
      // v2.9: DAG view
      let dagHtml = "";
      if (p.slices && p.slices.some(s => s.depends?.length > 0 || s.parallel)) {
        const lines = p.slices.map(s => {
          const deps = s.depends?.length ? ` <span class="text-gray-600">← ${s.depends.join(",")}</span>` : "";
          const pTag = s.parallel ? ' <span class="text-purple-400">[P]</span>' : "";
          const indent = s.depends?.length > 0 ? "ml-4" : "";
          return `<div class="${indent} py-0.5"><span class="text-gray-500 w-6 inline-block text-right">${s.id}.</span> <span class="text-gray-300">${escH(s.title)}</span>${pTag}${deps}</div>`;
        }).join("");
        dagHtml = `<details class="mt-1 ml-7" ${pi === 0 ? 'open' : ''}>
          <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-300">DAG View</summary>
          <div class="text-xs mt-1 py-1 font-mono">${lines}</div>
        </details>`;
      }
      return `
        <div class="py-2 border-b border-gray-700/50 last:border-0 group">
          <div class="flex items-center gap-3">
            <span class="text-sm">${icon}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-gray-200 truncate">${p.title}</p>
              <p class="text-xs text-gray-500">${p.file} · ${p.sliceCount} slices${p.branch ? " · " + p.branch : ""}</p>
            </div>
            <div class="flex gap-1 opacity-90">
              <button class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition">Estimate</button>
              <button class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition">Run</button>
            </div>
          </div>
          ${scopeHtml}${dagHtml}
        </div>`;
    }).join("");
  });
  await page.waitForTimeout(300);

  // Inject simulated run events
  for (const event of SIMULATED_EVENTS) {
    await page.evaluate((evt) => {
      if (typeof handleEvent === "function") handleEvent(evt);
    }, event);
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);

  // v2.9: Inject event log entries
  await page.evaluate(() => {
    const logEl = document.getElementById("event-log");
    const countEl = document.getElementById("event-log-count");
    if (!logEl) return;
    const events = [
      { time: "10:42:01", type: "run-started", color: "text-blue-400" },
      { time: "10:42:02", type: "slice-started", color: "text-cyan-400", detail: " slice 1" },
      { time: "10:42:44", type: "slice-completed", color: "text-green-300", detail: " slice 1" },
      { time: "10:42:45", type: "slice-started", color: "text-cyan-400", detail: " slice 2" },
      { time: "10:43:24", type: "slice-completed", color: "text-green-300", detail: " slice 2" },
      { time: "10:43:25", type: "slice-started", color: "text-cyan-400", detail: " slice 3" },
      { time: "10:43:56", type: "slice-completed", color: "text-green-300", detail: " slice 3" },
      { time: "10:43:57", type: "slice-started", color: "text-cyan-400", detail: " slice 4" },
    ];
    logEl.innerHTML = events.map(e => `<div class="${e.color} py-0.5">[${e.time}] ${e.type}${e.detail || ""}</div>`).join("");
    if (countEl) countEl.textContent = `(${events.length})`;
    // Open the event log details
    const details = logEl.closest("details");
    if (details) details.open = true;
  });

  // v2.9: Show hub clients badge — leave footer version alone so the
  // dashboard's real /api/capabilities fetch populates it from VERSION.
  await page.evaluate(() => {
    const hubEl = document.getElementById("hub-clients");
    if (hubEl) { hubEl.textContent = "2 clients"; hubEl.classList.remove("hidden"); }
  });
  await page.waitForTimeout(300);

  await page.screenshot({ path: resolve(OUTPUT_DIR, "progress.png"), fullPage: true });

  // ─── 3. Runs tab ────────────────────────────────────────────────────
  console.log("Capturing Runs tab...");
  await clickTab(page, "runs");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "runs.png"), fullPage: false });

  // ─── 4. Cost tab — Section Screenshots ───────────────────────────────
  console.log("Capturing Cost tab sections...");
  await clickTab(page, "cost");
  await page.waitForTimeout(2500); // Charts need time to render
  // Inject model comparison table
  await page.evaluate(() => {
    const el = document.getElementById("model-comparison");
    if (!el) return;
    const models = [
      { model: "claude-opus-4.6", runs: 14, passRate: 96, avgDur: "38.2s", avgCost: "$0.0741", tokens: "187,400" },
      { model: "grok-4", runs: 8, passRate: 88, avgDur: "31.7s", avgCost: "$0.0528", tokens: "98,600" },
      { model: "claude-sonnet-4", runs: 5, passRate: 100, avgDur: "22.1s", avgCost: "$0.0312", tokens: "54,200" },
      { model: "grok-3-mini", runs: 3, passRate: 67, avgDur: "18.4s", avgCost: "$0.0189", tokens: "31,100" },
    ];
    el.innerHTML = `<table class="w-full text-sm">
      <thead class="text-xs text-gray-500 border-b border-gray-700">
        <tr><th class="px-3 py-2 text-left">Model</th><th class="px-3 py-2 text-right">Runs</th><th class="px-3 py-2 text-right">Pass Rate</th><th class="px-3 py-2 text-right">Avg Duration</th><th class="px-3 py-2 text-right">Avg Cost</th><th class="px-3 py-2 text-right">Tokens</th></tr>
      </thead>
      <tbody>${models.map(s => {
        const prColor = s.passRate >= 90 ? "text-green-400" : s.passRate >= 70 ? "text-amber-400" : "text-red-400";
        return `<tr class="border-b border-gray-700/50 hover:bg-gray-700/30">
          <td class="px-3 py-2 text-gray-200">${s.model}</td>
          <td class="px-3 py-2 text-right text-gray-400">${s.runs}</td>
          <td class="px-3 py-2 text-right ${prColor}">${s.passRate}%</td>
          <td class="px-3 py-2 text-right text-gray-400">${s.avgDur}</td>
          <td class="px-3 py-2 text-right text-gray-400">${s.avgCost}</td>
          <td class="px-3 py-2 text-right text-gray-400">${s.tokens}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  });
  await page.waitForTimeout(500);

  // Full page screenshot (backward compat)
  await page.screenshot({ path: resolve(OUTPUT_DIR, "cost.png"), fullPage: true });

  // Section screenshots
  const costSections = [
    { selector: "#tab-cost > .grid.md\\:grid-cols-3", name: "cost-overview.png" },
    { selector: "#tab-cost > .grid.md\\:grid-cols-2", name: "cost-charts.png" },
    { selector: "#chart-cost-trend", name: "cost-trend.png", parent: true },
    { selector: "#chart-duration-trend", name: "cost-duration.png", parent: true },
    { selector: "#chart-model-perf", name: "cost-models.png", parent: true },
  ];
  for (const sec of costSections) {
    try {
      const el = sec.parent
        ? await page.$(`${sec.selector}`).then(async (e) => e ? await e.evaluateHandle((e) => e.closest(".bg-gray-800")) : null)
        : await page.$(sec.selector);
      if (el) {
        await el.screenshot({ path: resolve(OUTPUT_DIR, sec.name) });
        console.log(`  ✅ ${sec.name}`);
      }
    } catch { /* skip if section not found */ }
  }

  // ─── 5. Actions tab ─────────────────────────────────────────────────
  console.log("Capturing Actions tab...");
  await clickTab(page, "actions");
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "actions.png"), fullPage: true });

  // ─── 6. Config tab + Memory Search (v2.7) ────────────────────────────
  console.log("Capturing Config tab...");
  await clickTab(page, "config");
  await page.waitForTimeout(1500);
  // Inject realistic config state: grok checked, API provider active, OpenBrain connected, memory search visible
  await page.evaluate(() => {
    const grokCb = document.querySelector('.cfg-agent-checkbox[value="grok"]');
    if (grokCb) grokCb.checked = true;
    const apiEl = document.getElementById("cfg-api-providers");
    if (apiEl) apiEl.innerHTML = '<span class="text-green-400">✓ xAI Grok</span> <span class="text-gray-500">— XAI_API_KEY configured</span>';
    const obEl = document.getElementById("cfg-openbrain");
    if (obEl) obEl.innerHTML = '<span class="text-green-400">✓ Connected</span> <span class="text-gray-500">— openbrain</span><br><span class="text-xs text-gray-500">http://localhost:3200</span>';
    // v2.9: Advanced settings panel
    const advDetails = document.querySelector('#tab-config details');
    if (advDetails) advDetails.open = true;
    const maxP = document.getElementById('cfg-max-parallel');
    if (maxP) maxP.value = 3;
    const maxR = document.getElementById('cfg-max-retries');
    if (maxR) maxR.value = 1;
    const maxH = document.getElementById('cfg-max-history');
    if (maxH) maxH.value = 50;
    const qEnabled = document.getElementById('cfg-quorum-enabled');
    if (qEnabled) qEnabled.checked = true;
    const qThresh = document.getElementById('cfg-quorum-threshold');
    if (qThresh) qThresh.value = 7;
    const qModels = document.getElementById('cfg-quorum-models');
    if (qModels) qModels.value = 'grok-3-mini, claude-sonnet-4.6, gpt-5.2-codex';
    // Workers
    const workersEl = document.getElementById('cfg-workers');
    if (workersEl) workersEl.innerHTML = '<span class="text-green-400 text-xs mr-3">✓ gh-copilot</span><span class="text-green-400 text-xs mr-3">✓ claude</span><span class="text-gray-600 text-xs mr-3">✗ codex</span><span class="text-green-400 text-xs mr-3">✓ grok (API)</span>';
    // v2.9: Memory search with presets
    const searchPanel = document.getElementById("memory-search-panel");
    if (searchPanel) {
      searchPanel.classList.remove("hidden");
      // Inject presets
      const presetsEl = document.getElementById("memory-presets");
      if (presetsEl) presetsEl.innerHTML = [
        '📋 Phase', '📋 PLAN', '📋 roadmap',
        '🏗️ architecture', '🏗️ design',
        '⚙️ config', '⚙️ model', '⚙️ quorum',
        '🧪 test', '🧪 validation',
        '💰 cost', '💰 token',
        '🐛 bug', '🐛 fix', '🐛 TODO'
      ].map(q => `<button class="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition">${q}</button>`).join('');
      const input = document.getElementById("memory-search-input");
      if (input) input.value = "architecture";
      const results = document.getElementById("memory-search-results");
      if (results) results.innerHTML = `
        <div class="bg-gray-700/50 rounded p-2 mb-2 border border-gray-700">
          <div class="flex items-center gap-2 mb-1"><span class="text-xs text-blue-400 font-mono">docs/plans/Phase-11-DASHBOARD-V2.9-PLAN.md</span><span class="text-xs text-gray-600">:42</span></div>
          <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-20 overflow-hidden">## Scope Contract\n### In Scope\n- pforge-mcp/dashboard/app.js — all client-side enhancements</pre>
        </div>
        <div class="bg-gray-700/50 rounded p-2 mb-2 border border-gray-700">
          <div class="flex items-center gap-2 mb-1"><span class="text-xs text-blue-400 font-mono">.forge/cost-history.json</span><span class="text-xs text-gray-600">:1</span></div>
          <pre class="text-xs text-gray-300 whitespace-pre-wrap max-h-20 overflow-hidden">{"total_cost_usd": 2.47, "runs": 30, "by_model": {"claude-opus-4.6": ...}}</pre>
        </div>`;
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "config.png"), fullPage: true });

  // ─── 7. Traces tab ─────────────────────────────────────────────────
  console.log("Capturing Traces tab...");
  await clickTab(page, "traces");
  await page.waitForTimeout(1500);
  // Try to select the first run if available
  const traceOptions = await page.$$eval("#trace-run-select option", (opts) =>
    opts.filter((o) => o.value).map((o) => o.value)
  );
  if (traceOptions.length > 0) {
    await page.selectOption("#trace-run-select", traceOptions[0]);
    await page.waitForTimeout(2000);
  }
  // v2.9: Show search input with value
  await page.evaluate(() => {
    const searchEl = document.getElementById("trace-search");
    if (searchEl) searchEl.value = "slice";
  });
  await page.screenshot({ path: resolve(OUTPUT_DIR, "traces.png"), fullPage: false });

  // ─── 8. Skills tab ──────────────────────────────────────────────────
  console.log("Capturing Skills tab...");
  await clickTab(page, "skills");
  // Inject a mock skill execution for visual interest
  await page.evaluate(() => {
    if (typeof handleEvent === "function") {
      handleEvent({
        type: "skill-started",
        data: { skillName: "code-review", stepCount: 5, timestamp: new Date().toISOString() },
      });
      handleEvent({
        type: "skill-step-started",
        data: { skillName: "code-review", stepNumber: 1, stepName: "Gather context", timestamp: new Date().toISOString() },
      });
      handleEvent({
        type: "skill-step-completed",
        data: { skillName: "code-review", stepNumber: 1, stepName: "Gather context", status: "passed", duration: 2300 },
      });
      handleEvent({
        type: "skill-step-started",
        data: { skillName: "code-review", stepNumber: 2, stepName: "Architecture review", timestamp: new Date().toISOString() },
      });
      handleEvent({
        type: "skill-step-completed",
        data: { skillName: "code-review", stepNumber: 2, stepName: "Architecture review", status: "passed", duration: 4100 },
      });
      handleEvent({
        type: "skill-step-started",
        data: { skillName: "code-review", stepNumber: 3, stepName: "Security scan", timestamp: new Date().toISOString() },
      });
      handleEvent({
        type: "skill-step-completed",
        data: { skillName: "code-review", stepNumber: 3, stepName: "Security scan", status: "passed", duration: 3200 },
      });
      handleEvent({
        type: "skill-step-started",
        data: { skillName: "code-review", stepNumber: 4, stepName: "Test coverage", timestamp: new Date().toISOString() },
      });
      // Step 4 still executing — screenshot captures this
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "skills.png"), fullPage: false });

  // ─── 9. Replay tab ──────────────────────────────────────────────────
  console.log("Capturing Replay tab...");
  await clickTab(page, "replay");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "replay.png"), fullPage: false });

  // ─── 10. Extensions tab (v2.7) ───────────────────────────────────────
  console.log("Capturing Extensions tab...");
  await clickTab(page, "extensions");
  await page.waitForTimeout(2000);
  // Mark first extension as installed (renderExtensions already has Install/Uninstall buttons)
  await page.evaluate(() => {
    const firstCard = document.querySelector('#tab-extensions .bg-gray-800');
    if (firstCard) {
      const btn = firstCard.querySelector('.ext-btn');
      if (btn) {
        btn.textContent = 'Uninstall';
        btn.className = 'ext-btn text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 border border-red-600/30 hover:bg-red-600/40';
      }
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "extensions.png"), fullPage: false });

  // ─── Done ───────────────────────────────────────────────────────────
  await browser.close();
  console.log(`\n✅ Captured 9 screenshots to ${OUTPUT_DIR}`);
}

async function clickTab(page, tabName) {
  // Switch to correct group first (LiveGuard tabs need the liveguard group visible)
  const isLG = tabName.startsWith("lg-");
  if (isLG) {
    await page.evaluate(() => { if (typeof switchGroup === "function") switchGroup("liveguard"); });
    await page.waitForTimeout(200);
  } else {
    await page.evaluate(() => { if (typeof switchGroup === "function") switchGroup("forge"); });
    await page.waitForTimeout(200);
  }
  await page.click(`button[data-tab="${tabName}"]`);
  await page.waitForTimeout(300);
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
