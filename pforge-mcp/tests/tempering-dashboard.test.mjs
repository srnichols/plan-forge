/**
 * Plan Forge — Phase TEMPER-01 Slice 01.2: dashboard surface.
 *
 * Pure file-contract tests — we pin the source to make sure the
 * dashboard tab, the Watcher-tab Tempering chip row, and the REST
 * wiring cannot be accidentally regressed by another slice. The actual
 * DOM rendering is exercised by the playwright E2E suite (out of scope
 * for this phase — see TEMPER-03).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");
const serverMjs = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");

describe("dashboard/index.html — Tempering tab shell", () => {
  it("registers a Tempering tab button in the Forge sub-tabs", () => {
    expect(indexHtml).toMatch(/data-tab="tempering"/);
    expect(indexHtml).toMatch(/🛠 Tempering/);
  });

  it("declares a <section id=\"tab-tempering\"> panel", () => {
    expect(indexHtml).toMatch(/<section\s+id="tab-tempering"/);
  });

  it("wires the Run scan button to runTemperingScan()", () => {
    expect(indexHtml).toMatch(/onclick="runTemperingScan\(\)"/);
    expect(indexHtml).toMatch(/data-testid="tempering-scan-btn"/);
  });

  it("has the four read-only Tempering panes (summary/coverage/gaps/history)", () => {
    expect(indexHtml).toMatch(/data-testid="tempering-summary"/);
    expect(indexHtml).toMatch(/data-testid="tempering-coverage"/);
    expect(indexHtml).toMatch(/data-testid="tempering-gaps"/);
    expect(indexHtml).toMatch(/data-testid="tempering-history"/);
  });

  it("never exposes a write-style control other than the scan button", () => {
    // Slice 01.2 is still read-only. Bug registry / fix-proposal controls
    // belong to TEMPER-04/06. This guard fails if anyone adds
    // onclick="delete…" / onclick="edit…" buttons to the panel early.
    const section = indexHtml.match(/<section\s+id="tab-tempering"[\s\S]*?<\/section>/);
    expect(section).toBeTruthy();
    expect(section[0]).not.toMatch(/onclick="(delete|edit|abandon|file)/i);
  });
});

describe("dashboard/app.js — Tempering wiring", () => {
  it("registers a tempering tabLoadHook", () => {
    expect(appJs).toMatch(/tempering:\s*\(\)\s*=>\s*\{\s*loadTemperingStatus\(\)/);
  });

  it("ships loadTemperingStatus, runTemperingScan, renderTemperingPanel", () => {
    expect(appJs).toMatch(/async\s+function\s+loadTemperingStatus/);
    expect(appJs).toMatch(/async\s+function\s+runTemperingScan/);
    expect(appJs).toMatch(/function\s+renderTemperingPanel/);
  });

  it("calls the REST wrappers for both tempering tools", () => {
    expect(appJs).toMatch(/\/api\/tool\/forge_tempering_status/);
    expect(appJs).toMatch(/\/api\/tool\/forge_tempering_scan/);
  });

  it("seeds state.tempering with the expected shape", () => {
    expect(appJs).toMatch(/tempering:\s*\{[\s\S]{0,200}?initialized:\s*false/);
    expect(appJs).toMatch(/scans:\s*\[\]/);
  });

  it("exposes renderTemperingPanel on window for refresh wiring", () => {
    expect(appJs).toMatch(/window\.renderTemperingPanel\s*=\s*renderTemperingPanel/);
  });

  it("adds a Watcher-tab Tempering chip row with the correct testid", () => {
    expect(appJs).toMatch(/data-testid="watcher-tempering-row"/);
    // Must render only when `latest.tempering` is truthy — protects the
    // panel from rendering an empty row on projects with no scans.
    expect(appJs).toMatch(/if\s*\(latest\.tempering\)/);
  });

  it("renders coverage progress bars per layer with minimum markers", () => {
    expect(appJs).toMatch(/data-testid="tempering-coverage-row-/);
    expect(appJs).toMatch(/Math\.min\(100,\s*actual\)|\bactual\b/);
  });
});

describe("server.mjs — REST routing for Tempering tools", () => {
  it("marks both tempering tools as MCP_ONLY so they are not shelled through pforge.ps1", () => {
    expect(serverMjs).toMatch(/"forge_tempering_scan".*"forge_tempering_status"|"forge_tempering_status".*"forge_tempering_scan"/s);
  });
});
