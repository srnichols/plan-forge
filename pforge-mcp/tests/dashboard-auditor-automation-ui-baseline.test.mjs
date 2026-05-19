/**
 * Phase 40 — AUDITOR-AUTOMATION-UI baseline harness.
 *
 * Confirms the current dashboard/API contract after S4 lands.
 * Later slices intentionally update the remaining absent surfaces.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const APP_JS = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const SERVER_SRC = readFileSync(resolve(HERE, "..", "server.mjs"), "utf-8");

const EXPECTED_SETTINGS_SECTIONS = [
  "tab-settings-general",
  "tab-settings-models",
  "tab-settings-execution",
  "tab-settings-api-keys",
  "tab-settings-updates",
  "tab-settings-memory",
  "tab-settings-bridge",
  "tab-settings-crucible",
  "tab-settings-brain",
  "tab-settings-copilot",
];

const PHASE40_FIELD_IDS = [
  "cfg-observer-enabled",
  "cfg-observer-modeltier",
  "cfg-observer-budget-usd",
  "cfg-observer-budget-narrations",
  "cfg-observer-batch-window-ms",
  "cfg-observer-brain-capture",
  "cfg-auditor-modeltier",
  "cfg-auditor-on-failure",
  "cfg-auditor-every-n-runs",
];

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-phase40-baseline-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((resolveListen) => server.once("listening", resolveListen));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  if (savedCwd) process.chdir(savedCwd);
  delete process.env.PLAN_FORGE_PROJECT;
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

describe("Phase 40 baseline — settings surfaces", () => {
  it("keeps the current 10 settings sections and now includes Forge-Master", () => {
    for (const id of EXPECTED_SETTINGS_SECTIONS) {
      expect(INDEX_HTML).toContain(`id="${id}"`);
    }
    expect(INDEX_HTML).toContain('id="tab-settings-forgemaster"');
    expect(APP_JS).toContain("settings-forgemaster");
  });

  it("now declares observer and auditor cfg-* fields", () => {
    for (const id of PHASE40_FIELD_IDS) {
      expect(INDEX_HTML).toContain(`id="${id}"`);
    }
  });
});

describe("Phase 40 baseline — card and API surfaces", () => {
  it("wires observer narrations and still omits cross-run anomalies and auditor report cards", () => {
    expect(APP_JS).toContain("observer:narration");
    expect(INDEX_HTML).toContain("Observer Narrations");
    expect(APP_JS).toContain("/api/brain/recall?source=observer&limit=20");
    expect(INDEX_HTML).not.toContain("Cross-Run Watcher Anomalies");
    expect(INDEX_HTML).not.toContain("Auditor Latest Report");
    expect(APP_JS).not.toContain("/api/watcher/cross-run");
    expect(APP_JS).not.toContain("/api/auditor/latest");
  });

  it("server source exposes the current read endpoints", () => {
    expect(SERVER_SRC).toContain('/api/watcher/cross-run');
    expect(SERVER_SRC).toContain('/api/auditor/latest');
  });

  it("GET /api/watcher/cross-run returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/watcher/cross-run`);
    expect(res.status).toBe(200);
  });

  it("GET /api/auditor/latest returns 200", async () => {
    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
  });
});
