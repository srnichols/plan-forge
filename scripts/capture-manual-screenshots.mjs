#!/usr/bin/env node
// Capture Tier 1 manual screenshots from the running dashboard.
// Prerequisites: dashboard server must be running at http://127.0.0.1:3100/dashboard
// Usage: node scripts/capture-manual-screenshots.mjs
//
// Captures (Tier 1, per MANUAL-AUDIT-2026-05.md):
//   dashboard-runs-tab.png    -> historical runs view
//   dashboard-cost-tab.png    -> cost report
//   dashboard-config-tab.png  -> .forge.json editor
//   dashboard-progress-tab.png-> in-flight slice progress (or empty state if none active)
//   dashboard-forge-master-tab.png -> Studio tab
//   dashboard-timeline-tab.png-> unified timeline

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "docs/manual/assets/screenshots");
mkdirSync(OUT_DIR, { recursive: true });

const URL = "http://127.0.0.1:3100/dashboard/";
const VIEWPORT = { width: 1600, height: 1000 };

// Each capture: [filename, click sequence, optional waitFor selector]
const captures = [
  {
    name: "dashboard-runs-tab.png",
    clicks: ['.tab-btn[data-tab="runs"]'],
    description: "Runs tab — historical run list",
  },
  {
    name: "dashboard-cost-tab.png",
    clicks: ['.tab-btn[data-tab="cost"]'],
    description: "Cost tab — per-model breakdown + monthly trend",
  },
  {
    name: "dashboard-progress-tab.png",
    clicks: ['.tab-btn[data-tab="progress"]'],
    description: "Progress tab — slice progression",
  },
  {
    name: "dashboard-timeline-tab.png",
    clicks: ['.tab-btn[data-tab="timeline"]'],
    description: "Timeline tab — unified 9-source chronological view",
  },
  {
    name: "dashboard-forge-master-tab.png",
    clicks: ['button[data-group="forge-master"]', '.tab-btn[data-tab="forge-master"]'],
    description: "Forge-Master Studio tab — intent classifier + chat + cache stats",
  },
  {
    name: "dashboard-lg-health-tab.png",
    clicks: ['button[data-group="liveguard"]', '.tab-btn[data-tab="lg-health"]'],
    description: "LiveGuard Health tab — composite score + 30-day trend",
  },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();

console.log(`[shot] Loading ${URL} …`);
try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  // Wait for the dashboard JS to render at least one tab button
  await page.waitForSelector(".tab-btn", { timeout: 15000 });
} catch (err) {
  console.error(`[shot] Could not reach dashboard at ${URL}: ${err.message}`);
  console.error(`[shot] Make sure 'node pforge-mcp/server.mjs --dashboard-only' is running.`);
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(1500); // settle WebSocket + initial data fetch

let okCount = 0;
let failCount = 0;

for (const cap of captures) {
  const outPath = resolve(OUT_DIR, cap.name);
  try {
    for (const sel of cap.clicks) {
      const btn = page.locator(sel).first();
      const count = await btn.count();
      if (count === 0) {
        console.warn(`[shot] ${cap.name}: selector ${sel} not found, skipping click`);
        continue;
      }
      await btn.click({ force: true });
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(2500); // allow tab content fetch + render
    await page.screenshot({ path: outPath, fullPage: false });
    console.log(`[shot] ${cap.name} → ${outPath}`);
    okCount++;
  } catch (err) {
    console.error(`[shot] ${cap.name} FAILED: ${err.message}`);
    failCount++;
  }
}

await browser.close();
console.log(`\n[shot] Done. ${okCount} OK, ${failCount} failed.`);
process.exit(failCount > 0 ? 1 : 0);
