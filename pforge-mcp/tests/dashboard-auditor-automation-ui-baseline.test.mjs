/**
 * Phase 40 — AUDITOR-AUTOMATION-UI baseline harness (updated to reflect S1–S6 shipped state).
 *
 * Originally captured the pre-change dashboard/API state.
 * Updated per Phase-39 precedent (c19e9f2) to assert the shipped state.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const APP_JS = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const SERVER_SRC = readFileSync(resolve(HERE, "..", "server.mjs"), "utf-8");
const SCRATCH_ROOT = resolve(HERE, "..", ".vitest-scratch");

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
  "tab-settings-forgemaster",
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
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  tmpProject = join(SCRATCH_ROOT, `pforge-phase40-baseline-${process.pid}-${Date.now()}`);
  mkdirSync(tmpProject, { recursive: true });
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

describe("Phase 40 shipped — settings surfaces (S1 + S2)", () => {
  it("has all 11 settings sections including new Forge-Master tab", () => {
    for (const id of EXPECTED_SETTINGS_SECTIONS) {
      expect(INDEX_HTML, `${id} must be present`).toContain(`id="${id}"`);
    }
  });

  it("declares all nine observer + auditor cfg-* fields", () => {
    for (const id of PHASE40_FIELD_IDS) {
      expect(INDEX_HTML, `${id} must be present`).toContain(`id="${id}"`);
    }
  });
});

describe("Phase 40 shipped — card and API surfaces (S3 + S4 + S5 + S6)", () => {
  it("wires observer:narration event type in index.html", () => {
    expect(INDEX_HTML).toContain("observer:narration");
  });

  it("renders Observer Narrations, Cross-Run Watcher Anomalies, and Auditor Latest Report cards", () => {
    expect(INDEX_HTML).toContain("Observer Narrations");
    expect(INDEX_HTML).toContain("Cross-Run Watcher Anomalies");
    expect(INDEX_HTML).toContain("Auditor Latest Report");
  });

  it("app.js calls /api/watcher/cross-run and /api/auditor/latest and /api/brain/recall", () => {
    expect(APP_JS).toContain("/api/watcher/cross-run");
    expect(APP_JS).toContain("/api/auditor/latest");
    expect(APP_JS).toContain("/api/brain/recall?source=observer&limit=20");
  });

  it("server exposes both Phase 40 read endpoints", () => {
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
