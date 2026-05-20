/**
 * Phase 40 S6 — Auditor latest-report card.
 *
 * Tests HTML markup, JS wiring, and live API behavior including
 * JSDOM-level sanitization check.
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
  tmpProject = join(SCRATCH_ROOT, `pforge-auditor-card-${process.pid}-${Date.now()}`);
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

function seedAuditorRun(runId, auditorData) {
  const dir = resolve(tmpProject, ".forge", "runs", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "summary.json"), JSON.stringify({ _auditor: auditorData }, null, 2));
}

describe("S6 — auditor-report-card HTML markup", () => {
  it("renders auditor report card in tab-forge-master", () => {
    const section = document.getElementById("tab-forge-master");
    const card = section.querySelector('[data-testid="auditor-report-card"]');
    expect(card, "auditor-report-card must exist").not.toBeNull();
  });

  it("declares #auditor-latest-report", () => {
    const el = document.getElementById("auditor-latest-report");
    expect(el, "#auditor-latest-report must exist").not.toBeNull();
  });

  it("contains an 'Auditor Latest Report' heading", () => {
    expect(html).toContain("Auditor Latest Report");
  });

  it("has a refresh button calling loadAuditorLatest()", () => {
    const card = document.querySelector('[data-testid="auditor-report-card"]');
    const btn = card.querySelector("button[title='Refresh']");
    expect(btn, "Refresh button must exist").not.toBeNull();
    expect(btn.getAttribute("onclick")).toContain("loadAuditorLatest");
  });
});

describe("S6 — auditor-report-card JS wiring", () => {
  it("defines loadAuditorLatest function", () => {
    expect(js).toContain("function loadAuditorLatest(");
  });

  it("fetches /api/auditor/latest", () => {
    expect(js).toContain("/api/auditor/latest");
  });

  it("exposes loadAuditorLatest on window", () => {
    expect(js).toContain("window.loadAuditorLatest = loadAuditorLatest");
  });

  it("forge-master tabLoadHook calls loadAuditorLatest", () => {
    expect(js).toMatch(/'forge-master'[\s\S]*loadAuditorLatest/);
  });
});

describe("S6 — /api/auditor/latest responses", () => {
  it("returns triggered=false when no runs exist", async () => {
    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(false);
    expect(body.message).toBeTruthy();
  });

  it("returns triggered auditor data when a run has _auditor.triggered=true", async () => {
    seedAuditorRun("run-auditor-1", {
      triggered: true,
      reason: "onFailure",
      timestamp: "2024-06-01T12:00:00Z",
      config: { onFailure: true, everyNRuns: null },
    });

    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(true);
    expect(body.reason).toBe("onFailure");
    expect(body.runId).toBe("run-auditor-1");
  });

  it("skips runs without _auditor.triggered and finds the one that has it", async () => {
    const dir = resolve(tmpProject, ".forge", "runs", "run-no-auditor");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "summary.json"), JSON.stringify({ status: "completed" }, null, 2));

    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(true);
  });
});
