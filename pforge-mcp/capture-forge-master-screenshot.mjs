/**
 * Capture a single screenshot of the Forge-Master Studio dashboard tab.
 *
 * Usage:
 *   1. Start server: node pforge-mcp/server.mjs --dashboard-only
 *   2. Run this:     node scripts/capture-forge-master-screenshot.mjs
 *
 * Output: docs/assets/dashboard/forge-master.png
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT, "docs/assets/dashboard");
const DASHBOARD_URL = process.env.PFORGE_DASHBOARD_URL || "http://127.0.0.1:3100/dashboard";

mkdirSync(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await context.newPage();

// Surface browser console errors so we can diagnose client-side issues.
page.on("console", (msg) => {
  if (msg.type() === "error" || msg.type() === "warning") {
    console.log(`[browser ${msg.type()}]`, msg.text());
  }
});
page.on("pageerror", (err) => console.log("[browser error]", err.message));

console.log(`Loading ${DASHBOARD_URL} ...`);
await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded", timeout: 15000 });

// type="module" scripts are deferred — wait for forge-master module to expose
// its tab-activate hook on window before we click the tab.
await page.waitForFunction(() => typeof window.forgeMasterOnTabActivate === "function", { timeout: 10000 });
await page.waitForTimeout(500);

console.log("Switching to Forge-Master tab ...");
// First click the top-level group button so its subtab row becomes visible.
const groupBtn = await page.$('[data-group="forge-master"]');
if (!groupBtn) {
  console.error("Forge-Master group tab not found. Is this v2.63+ with the top-level group?");
  await browser.close();
  process.exit(1);
}
await groupBtn.click();
await page.waitForTimeout(150);

const tabBtn = await page.$('[data-testid="forge-master-tab-btn"]');
if (!tabBtn) {
  console.error("Forge-Master sub-tab button not found on dashboard.");
  await browser.close();
  process.exit(1);
}
await tabBtn.click();

// Force-call the tab activation hook in case of script-load race, then wait
// for the prompt catalog to actually render (not the "Loading…" placeholder).
const initResult = await page.evaluate(async () => {
  try {
    // The module exposes the hook but not init itself — trigger it via the hook.
    window.forgeMasterOnTabActivate?.();
    // Wait a tick then check state
    await new Promise((r) => setTimeout(r, 200));
    // Manually fetch and render to bypass any race
    const res = await fetch("/api/forge-master/prompts");
    const text = await res.text();
    return { status: res.status, length: text.length, preview: text.slice(0, 120) };
  } catch (err) {
    return { err: String(err) };
  }
});
console.log("init probe:", JSON.stringify(initResult));
try {
  await page.waitForFunction(
    () => {
      const el = document.getElementById("fm-gallery-list");
      return el && !el.textContent.includes("Loading prompt catalog");
    },
    { timeout: 8000 },
  );
} catch {
  console.warn("Prompt catalog did not finish loading in 8s — continuing with demo injection");
}

// Inject a demo chat + tool-call trace so the screenshot shows the feature
// in use, not an empty tab.
await page.evaluate(() => {
  const stream = document.getElementById("fm-chat-stream");
  if (stream) {
    stream.innerHTML = `
      <div class="rounded-lg bg-slate-800/70 border border-slate-700/50 px-3 py-2 ml-12">
        <div class="text-[10px] font-semibold text-slate-400 mb-1">You</div>
        <div class="text-sm text-slate-200">Why did Phase-28 slice 4 fail on the first attempt?</div>
      </div>
      <div class="rounded-lg bg-cyan-950/30 border border-cyan-800/40 px-3 py-2 mr-12">
        <div class="text-[10px] font-semibold text-cyan-400 mb-1">Forge-Master</div>
        <div class="text-sm text-slate-200 leading-relaxed">
          Slice 4 (gate on bash portability) hit the Windows <code class="text-amber-300">cmd→bash</code> shim
          with a <code class="text-amber-300">grep -c | { read n; ... }</code> pattern. The brace-group
          variable wasn't visible through the shim, so the gate read as zero matches and the orchestrator
          retried once on the same model before the worker rewrote the gate inline. Memory shows two prior
          incidents of the same pattern — I'd recommend filing a <code class="text-amber-300">prompt-defect</code>
          meta-bug so the step-2 hardener stops emitting brace-group gates.
        </div>
      </div>
      <div class="rounded-lg bg-slate-800/70 border border-slate-700/50 px-3 py-2 ml-12">
        <div class="text-[10px] font-semibold text-slate-400 mb-1">You</div>
        <div class="text-sm text-slate-200">File it.</div>
      </div>
      <div class="rounded-lg bg-cyan-950/30 border border-cyan-800/40 px-3 py-2 mr-12">
        <div class="text-[10px] font-semibold text-cyan-400 mb-1">Forge-Master</div>
        <div class="text-sm text-slate-200 leading-relaxed">
          Filing requires a write tool (<code class="text-amber-300">forge_meta_bug_file</code>) — that's
          outside my read-only allowlist. I'd suggest running it yourself from the terminal, or invoking it
          from your agent session. Happy to draft the issue body if you want.
        </div>
      </div>
    `;
  }

  const trace = document.getElementById("fm-tool-trace");
  if (trace) {
    trace.innerHTML = `
      <div class="rounded border border-slate-700/50 bg-slate-800/60 px-2 py-1.5">
        <div class="flex items-center justify-between">
          <code class="text-cyan-400 text-[11px]">brain_recall</code>
          <span class="text-[10px] text-emerald-400">ok · 142ms</span>
        </div>
        <div class="text-[10px] text-slate-500 mt-0.5">query: "Phase-28 slice 4 failure"</div>
      </div>
      <div class="rounded border border-slate-700/50 bg-slate-800/60 px-2 py-1.5">
        <div class="flex items-center justify-between">
          <code class="text-cyan-400 text-[11px]">forge_watch_live</code>
          <span class="text-[10px] text-emerald-400">ok · 58ms</span>
        </div>
        <div class="text-[10px] text-slate-500 mt-0.5">plan: Phase-28-FORGE-MASTER-MVP</div>
      </div>
      <div class="rounded border border-slate-700/50 bg-slate-800/60 px-2 py-1.5">
        <div class="flex items-center justify-between">
          <code class="text-cyan-400 text-[11px]">forge_bug_list</code>
          <span class="text-[10px] text-emerald-400">ok · 37ms</span>
        </div>
        <div class="text-[10px] text-slate-500 mt-0.5">class: prompt-defect · 2 matches</div>
      </div>
      <div class="rounded border border-slate-700/50 bg-slate-800/60 px-2 py-1.5">
        <div class="flex items-center justify-between">
          <code class="text-slate-500 text-[11px]">forge_meta_bug_file</code>
          <span class="text-[10px] text-slate-500">blocked · write tool</span>
        </div>
        <div class="text-[10px] text-slate-500 mt-0.5">not in read-only allowlist</div>
      </div>
    `;
  }

  // Pre-fill composer with a follow-up question
  const composer = document.getElementById("fm-composer");
  if (composer) composer.value = "Draft the meta-bug issue body.";
});

await page.waitForTimeout(500);

// If the prompt list rendered an error (no API key / Studio offline), log it.
const listText = await page.$eval("#tab-forge-master", (el) => el.innerText).catch(() => "");
console.log("Tab text preview:", listText.slice(0, 300).replace(/\s+/g, " "));

const out = resolve(OUTPUT_DIR, "forge-master.png");
await page.screenshot({ path: out, fullPage: true });
console.log(`Wrote ${out}`);

await browser.close();
