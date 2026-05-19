/**
 * Phase 40 S5 — Cross-run watcher anomalies card.
 *
 * Verifies the HTML markup and app.js wiring for the cross-run anomalies card.
 * The /api/watcher/cross-run endpoint behaviour is covered separately by
 * api-watcher-cross-run.test.mjs.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const js = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;

describe("cross-run anomalies card — markup", () => {
  it("declares the cross-run-anomalies-list container in the dashboard", () => {
    const el = document.getElementById("cross-run-anomalies-list");
    expect(el).not.toBeNull();
  });

  it("includes a Cross-Run Watcher Anomalies heading visible to the user", () => {
    expect(html).toContain("Cross-Run Watcher Anomalies");
  });

  it("includes a refresh button calling loadCrossRunAnomalies", () => {
    expect(html).toContain("loadCrossRunAnomalies()");
  });
});

describe("cross-run anomalies card — app.js wiring", () => {
  it("defines loadCrossRunAnomalies and calls /api/watcher/cross-run", () => {
    expect(js).toContain("loadCrossRunAnomalies");
    expect(js).toContain("/api/watcher/cross-run");
  });

  it("renders severity-coloured anomaly rows from the response", () => {
    expect(js).toContain("a.code");
    expect(js).toContain("a.severity");
    expect(js).toContain("a.message");
  });

  it("renders an empty-state message when no anomalies are found", () => {
    expect(js).toContain("No anomalies detected");
  });

  it("exports loadCrossRunAnomalies to window for HTML button wiring", () => {
    expect(js).toContain("window.loadCrossRunAnomalies = loadCrossRunAnomalies");
  });

  it("loadForgeMasterLiveSignals calls loadCrossRunAnomalies for auto-load on tab activate", () => {
    expect(js).toContain("loadCrossRunAnomalies()");
  });
});
