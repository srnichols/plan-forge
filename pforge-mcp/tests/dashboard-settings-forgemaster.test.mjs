/**
 * Phase 40 — Settings > Forge-Master observer tab.
 *
 * Source + DOM contract tests for S1.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { FORGE_MASTER_DEFAULTS, getForgeMasterConfig } from "../../pforge-master/src/config.mjs";

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

const AUDITOR_FIELD_IDS = [
  "cfg-auditor-modeltier",
  "cfg-auditor-on-failure",
  "cfg-auditor-every-n-runs",
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

describe("settings-forgemaster auditor tab markup", () => {
  it("renders all three auditor cfg-* fields exactly once inside the same section", () => {
    const section = document.getElementById("tab-settings-forgemaster");
    for (const id of AUDITOR_FIELD_IDS) {
      expect(document.querySelectorAll(`#${id}`)).toHaveLength(1);
      expect(section?.querySelector(`#${id}`), `${id} must live inside tab-settings-forgemaster`).not.toBeNull();
    }
  });

  it("reuses the documented model tier labels for the auditor selector", () => {
    const labels = [...document.querySelectorAll("#cfg-auditor-modeltier option")].map((opt) => opt.textContent.trim());
    expect(labels).toEqual([
      "Inherit ask mode (default)",
      "Flagship (best quality)",
      "Mid (balanced)",
      "Fast (cheapest)",
    ]);
  });
});

describe("settings-forgemaster auditor wiring", () => {
  it("loadConfig hydrates auditor values from currentConfig.forgeMaster.auditor", () => {
    expect(js).toContain("const auditorCfg = currentConfig.forgeMaster?.auditor || {};");
    expect(js).toContain('document.getElementById("cfg-auditor-modeltier")');
    expect(js).toContain('document.getElementById("cfg-auditor-on-failure")');
    expect(js).toContain('document.getElementById("cfg-auditor-every-n-runs")');
  });

  it("saveConfig persists forgeMaster.auditor fields through /api/config", () => {
    expect(js).toContain("auditor: {");
    expect(js).toContain("modelTier: auditorModelTier || null");
    expect(js).toContain("onFailure: auditorOnFailure");
    expect(js).toContain("everyNRuns: auditorEveryNRuns");
  });

  it("client validation rejects everyNRuns values 1 through 4", () => {
    expect(js).toContain("auditorEveryNRuns >= 1 && auditorEveryNRuns <= 4");
    expect(js).toContain("Auditor run cadence must be blank or at least 5.");
  });

  it("Forge-Master defaults now include an auditor block", () => {
    expect(FORGE_MASTER_DEFAULTS.auditor).toEqual({ modelTier: null });
  });

  it("getForgeMasterConfig resolves forgeMaster.auditor.modelTier", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pforge-master-config-"));
    try {
      writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify({ forgeMaster: { auditor: { modelTier: "mid" } } }), "utf-8");
      const cfg = getForgeMasterConfig({ cwd });
      expect(cfg.auditor).toEqual({ modelTier: "mid" });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
