/**
 * Phase 40 — Settings > Forge-Master observer tab.
 *
 * Source + DOM contract tests for S1.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const js = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;

const OBSERVER_FIELD_IDS = [
  "cfg-observer-enabled",
  "cfg-observer-modeltier",
  "cfg-observer-budget-usd",
  "cfg-observer-budget-narrations",
  "cfg-observer-batch-window-ms",
  "cfg-observer-brain-capture",
];

describe("settings-forgemaster observer tab markup", () => {
  it("appends a Forge-Master settings button at the end of the settings subtab row", () => {
    const buttons = [...document.querySelectorAll("#subtabs-settings .tab-btn")];
    expect(buttons.at(-1)?.getAttribute("data-tab")).toBe("settings-forgemaster");
    expect(buttons.at(-1)?.id).not.toBe("tab-settings-forgemaster");
  });

  it("declares <section id='tab-settings-forgemaster'>", () => {
    const section = document.getElementById("tab-settings-forgemaster");
    expect(section).not.toBeNull();
    expect(section.className).toContain("tab-content");
  });

  it("renders all six observer cfg-* fields exactly once inside the new section", () => {
    const section = document.getElementById("tab-settings-forgemaster");
    for (const id of OBSERVER_FIELD_IDS) {
      expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
      expect(section?.querySelector(`#${id}`), `${id} must live inside tab-settings-forgemaster`).not.toBeNull();
    }
  });

  it("uses the documented model tier labels", () => {
    const labels = [...document.querySelectorAll("#cfg-observer-modeltier option")].map((opt) => opt.textContent.trim());
    expect(labels).toEqual([
      "Inherit ask mode (default)",
      "Flagship (best quality)",
      "Mid (balanced)",
      "Fast (cheapest)",
    ]);
  });
});

describe("settings-forgemaster observer tab wiring", () => {
  it("registers a settings-forgemaster tabLoadHook that loads config", () => {
    expect(js).toContain("'settings-forgemaster': () => { loadConfig(); }");
  });

  it("loadConfig hydrates observer values from currentConfig.forgeMaster.observer", () => {
    expect(js).toContain("const observerCfg = currentConfig.forgeMaster?.observer || {};");
    expect(js).toContain('document.getElementById("cfg-observer-enabled")');
    expect(js).toContain('document.getElementById("cfg-observer-modeltier")');
    expect(js).toContain('document.getElementById("cfg-observer-budget-usd")');
    expect(js).toContain('document.getElementById("cfg-observer-budget-narrations")');
    expect(js).toContain('document.getElementById("cfg-observer-batch-window-ms")');
    expect(js).toContain('document.getElementById("cfg-observer-brain-capture")');
  });

  it("saveConfig persists forgeMaster.observer fields through /api/config", () => {
    expect(js).toContain("forgeMaster: {");
    expect(js).toContain("observer: {");
    expect(js).toContain("enabled: observerEnabled");
    expect(js).toContain("modelTier: observerModelTier || null");
    expect(js).toContain("maxUsdPerDay: Number.isFinite(observerBudgetUsd) ? observerBudgetUsd : 1");
    expect(js).toContain("maxNarrationsPerHour: Number.isFinite(observerBudgetNarrations) ? observerBudgetNarrations : 6");
    expect(js).toContain("batchWindowMs: Number.isFinite(observerBatchWindowMs) ? observerBatchWindowMs : 60000");
    expect(js).toContain("brainCapture: observerBrainCapture");
  });
});
