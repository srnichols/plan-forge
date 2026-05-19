/**
 * Phase 40 S6 — Auditor latest-report card.
 *
 * Verifies the HTML markup, app.js wiring, and /api/auditor/latest endpoint
 * behavior. The endpoint reads auditor invocation records from run summaries
 * (written by Phase 39's auditor auto-invoke feature).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(HERE, "..", "dashboard", "index.html"), "utf-8");
const js = readFileSync(resolve(HERE, "..", "dashboard", "app.js"), "utf-8");
const dom = new JSDOM(html);
const document = dom.window.document;

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-auditor-card-"));
  savedCwd = process.cwd();
  process.env.PLAN_FORGE_PROJECT = tmpProject;
  process.chdir(tmpProject);

  const { createExpressApp } = await import("../server.mjs");
  const app = createExpressApp();
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (savedCwd) process.chdir(savedCwd);
  delete process.env.PLAN_FORGE_PROJECT;
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

describe("auditor report card — markup", () => {
  it("declares the auditor-latest-report container in the dashboard", () => {
    const el = document.getElementById("auditor-latest-report");
    expect(el).not.toBeNull();
  });

  it("includes an Auditor Latest Report heading visible to the user", () => {
    expect(html).toContain("Auditor Latest Report");
  });

  it("includes a refresh button calling loadAuditorLatest", () => {
    expect(html).toContain("loadAuditorLatest()");
  });
});

describe("auditor report card — app.js wiring", () => {
  it("defines loadAuditorLatest and calls /api/auditor/latest", () => {
    expect(js).toContain("loadAuditorLatest");
    expect(js).toContain("/api/auditor/latest");
  });

  it("registers the auditor-auto-invoke live WebSocket event handler", () => {
    expect(js).toContain('case "auditor-auto-invoke"');
    expect(js).toContain("handleAuditorAutoInvoke(");
  });

  it("renders an empty state when data.triggered is false", () => {
    expect(js).toContain("data.triggered");
    expect(js).toContain("data.message");
  });

  it("exports loadAuditorLatest to window for HTML button wiring", () => {
    expect(js).toContain("window.loadAuditorLatest = loadAuditorLatest");
  });
});

describe("auditor report card — /api/auditor/latest endpoint", () => {
  it("returns triggered=false with a message when no runs directory exists", async () => {
    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("returns triggered=false when runs exist but none contain an auditor record", async () => {
    const runDir = resolve(tmpProject, ".forge", "runs", "run-001");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      resolve(runDir, "summary.json"),
      JSON.stringify({ runId: "run-001", status: "completed", results: { total: 1 } }),
      "utf-8",
    );
    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(false);
  });

  it("returns the most recent auditor invocation when one exists", async () => {
    const runDir = resolve(tmpProject, ".forge", "runs", "run-002");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      resolve(runDir, "summary.json"),
      JSON.stringify({
        runId: "run-002",
        status: "failed",
        _auditor: {
          triggered: true,
          reason: "onFailure",
          timestamp: "2026-05-19T00:00:00.000Z",
          config: { onFailure: true, everyNRuns: null },
        },
      }),
      "utf-8",
    );

    const res = await fetch(`${baseUrl}/api/auditor/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.triggered).toBe(true);
    expect(body.reason).toBe("onFailure");
    expect(body.runId).toBe("run-002");
    expect(body.config.onFailure).toBe(true);
  });
});
