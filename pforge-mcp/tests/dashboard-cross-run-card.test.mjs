/**
 * Phase 40 S5 — Cross-run watcher anomalies card.
 *
 * Tests HTML markup, JS wiring, and live API behavior.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const js = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;
const SCRATCH_ROOT = resolve(HERE, "..", ".vitest-scratch");

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  tmpProject = join(SCRATCH_ROOT, `pforge-cross-run-card-${process.pid}-${Date.now()}`);
  mkdirSync(tmpProject, { recursive: true });
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise(r => server.close(r));
  if (savedCwd) process.chdir(savedCwd);
  delete process.env.PLAN_FORGE_PROJECT;
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

function seedRun(id, summary) {
  const dir = resolve(tmpProject, ".forge", "runs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "summary.json"), JSON.stringify(summary, null, 2));
}

describe("S5 — cross-run-anomalies-card HTML markup", () => {
  it("renders cross-run anomalies card in tab-forge-master", () => {
    const section = document.getElementById("tab-forge-master");
    const card = section.querySelector('[data-testid="cross-run-anomalies-card"]');
    expect(card, "cross-run-anomalies-card must exist").not.toBeNull();
  });

  it("declares #cross-run-anomalies-list", () => {
    const list = document.getElementById("cross-run-anomalies-list");
    expect(list, "#cross-run-anomalies-list must exist").not.toBeNull();
  });

  it("contains a 'Cross-Run Watcher Anomalies' heading", () => {
    expect(html).toContain("Cross-Run Watcher Anomalies");
  });

  it("has a refresh button calling loadCrossRunAnomalies()", () => {
    const card = document.querySelector('[data-testid="cross-run-anomalies-card"]');
    const btn = card.querySelector("button[title='Refresh']");
    expect(btn, "Refresh button must exist").not.toBeNull();
    expect(btn.getAttribute("onclick")).toContain("loadCrossRunAnomalies");
  });
});

describe("S5 — cross-run-anomalies-card JS wiring", () => {
  it("defines loadCrossRunAnomalies function", () => {
    expect(js).toContain("function loadCrossRunAnomalies(");
  });

  it("fetches /api/watcher/cross-run", () => {
    expect(js).toContain("/api/watcher/cross-run");
  });

  it("exposes loadCrossRunAnomalies on window", () => {
    expect(js).toContain("window.loadCrossRunAnomalies = loadCrossRunAnomalies");
  });

  it("forge-master tabLoadHook calls loadCrossRunAnomalies", () => {
    expect(js).toMatch(/'forge-master'[\s\S]*loadCrossRunAnomalies/);
  });
});

describe("S5 — /api/watcher/cross-run responses", () => {
  it("returns empty anomalies when no runs exist", async () => {
    const res = await fetch(`${baseUrl}/api/watcher/cross-run`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.anomalies)).toBe(true);
  });

  it("returns cached payload if fresh cache exists", async () => {
    const cacheDir = resolve(tmpProject, ".forge");
    mkdirSync(cacheDir, { recursive: true });
    const cachePath = resolve(cacheDir, "cross-run-cache.json");
    writeFileSync(cachePath, JSON.stringify({
      cachedAt: new Date().toISOString(),
      report: {
        ok: true,
        mode: "cross-run",
        anomalies: [{ code: "test.anomaly", severity: "warn", message: "cached entry" }],
        recommendations: [],
        snapshot: { ok: true },
      },
    }, null, 2));

    const res = await fetch(`${baseUrl}/api/watcher/cross-run`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(true);
    expect(body.anomalies[0].code).toBe("test.anomaly");
  });
});
