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

  // Inject plan browser data (v2.7)
  await page.evaluate(() => {
    const listEl = document.getElementById("plan-list");
    const countEl = document.getElementById("plan-count");
    const browser = document.getElementById("plan-browser");
    if (!listEl) return;
    if (browser) browser.open = true;
    if (countEl) countEl.textContent = "(6)";
    const plans = [
      { title: "Invoice Engine", file: "Phase-3-INVOICE-ENGINE-PLAN.md", status: "🚧", sliceCount: 6, branch: "feature/v2.4-invoice" },
      { title: "Dashboard Core", file: "Phase-4-DASHBOARD-CORE-PLAN.md", status: "✅", sliceCount: 5, branch: "" },
      { title: "Dashboard Advanced", file: "Phase-5-DASHBOARD-ADVANCED-PLAN.md", status: "✅", sliceCount: 4, branch: "" },
      { title: "Parallel Execution", file: "Phase-6-PARALLEL-EXECUTION-PLAN.md", status: "📋", sliceCount: 7, branch: "" },
      { title: "WebSocket Hub", file: "Phase-3-WEBSOCKET-HUB-PLAN.md", status: "✅", sliceCount: 4, branch: "" },
      { title: "Dashboard Enhancements", file: "Phase-9-DASHBOARD-ENHANCEMENT-PLAN.md", status: "🚧", sliceCount: 8, branch: "feature/v2.7-dashboard-enhancement" },
    ];
    listEl.innerHTML = plans.map(p => `
      <div class="flex items-center gap-3 py-2 border-b border-gray-700/50 last:border-0 group">
        <span class="text-sm">${p.status}</span>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-gray-200 truncate">${p.title}</p>
          <p class="text-xs text-gray-500">${p.file} · ${p.sliceCount} slices${p.branch ? " · " + p.branch : ""}</p>
        </div>
        <div class="flex gap-1 opacity-90">
          <button class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition">Estimate</button>
          <button class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded transition">Run</button>
        </div>
      </div>`).join("");
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
  await page.screenshot({ path: resolve(OUTPUT_DIR, "progress.png"), fullPage: false });

  // ─── 3. Runs tab ────────────────────────────────────────────────────
  console.log("Capturing Runs tab...");
  await clickTab(page, "runs");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "runs.png"), fullPage: false });

  // ─── 4. Cost tab + Model Comparison (v2.7) ──────────────────────────
  console.log("Capturing Cost tab...");
  await clickTab(page, "cost");
  await page.waitForTimeout(2000); // Charts need time to render
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
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "cost.png"), fullPage: false });

  // ─── 5. Actions tab ─────────────────────────────────────────────────
  console.log("Capturing Actions tab...");
  await clickTab(page, "actions");
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "actions.png"), fullPage: false });

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
    // Show memory search panel with sample results
    const searchPanel = document.getElementById("memory-search-panel");
    if (searchPanel) {
      searchPanel.classList.remove("hidden");
      const input = document.getElementById("memory-search-input");
      if (input) input.value = "deployment strategy";
      const results = document.getElementById("memory-search-results");
      if (results) results.innerHTML = `
        <div class="bg-gray-700/50 rounded p-2 mb-1 text-xs">
          <p class="text-gray-300 font-medium">deployment-notes</p>
          <p class="text-gray-500 mt-0.5">Use blue-green deploys for production. Always run smoke tests after helm upgrade...</p>
        </div>
        <div class="bg-gray-700/50 rounded p-2 mb-1 text-xs">
          <p class="text-gray-300 font-medium">infrastructure-decisions</p>
          <p class="text-gray-500 mt-0.5">Azure Container Apps preferred over AKS for smaller services. Cost ~60% lower...</p>
        </div>`;
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUTPUT_DIR, "config.png"), fullPage: false });

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
  await page.click(`button[data-tab="${tabName}"]`);
  await page.waitForTimeout(300);
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
