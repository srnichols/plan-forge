/**
 * Phase 40 — /api/watcher/cross-run.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-cross-run-api-"));
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

async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

function seedSummary(runId, summary) {
  const dir = resolve(tmpProject, ".forge", "runs", runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
}

function seedCrossRunHistory() {
  rmSync(resolve(tmpProject, ".forge"), { recursive: true, force: true });
  const now = Date.now();
  seedSummary("run-1", {
    runId: "run-1",
    startTime: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now - 3 * 24 * 60 * 60 * 1000 + 60_000).toISOString(),
    status: "failed",
    results: { total: 2 },
    cost: { total_cost_usd: 1.0 },
    sliceResults: [
      { number: 1, title: "Compile", status: "passed", attempts: 1, duration: 20_000 },
      { number: 2, title: "Gate Verify", status: "failed", attempts: 3, duration: 400_000, statusReason: "timeout" },
    ],
  });
  seedSummary("run-2", {
    runId: "run-2",
    startTime: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now - 2 * 24 * 60 * 60 * 1000 + 60_000).toISOString(),
    status: "failed",
    results: { total: 2 },
    cost: { total_cost_usd: 2.0 },
    sliceResults: [
      { number: 1, title: "Compile", status: "passed", attempts: 1, duration: 25_000 },
      { number: 2, title: "Gate Verify", status: "failed", attempts: 4, duration: 420_000, statusReason: "timeout" },
    ],
  });
  seedSummary("run-3", {
    runId: "run-3",
    startTime: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now - 1 * 24 * 60 * 60 * 1000 + 60_000).toISOString(),
    status: "completed",
    results: { total: 2 },
    cost: { total_cost_usd: 4.0 },
    sliceResults: [
      { number: 1, title: "Compile", status: "passed", attempts: 1, duration: 20_000 },
      { number: 2, title: "Gate Verify", status: "passed", attempts: 1, duration: 30_000 },
    ],
  });
}

describe("GET /api/watcher/cross-run", () => {
  it("computes a 14d cross-run report and writes the cache file", async () => {
    seedCrossRunHistory();

    const res = await get("/api/watcher/cross-run");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.mode).toBe("cross-run");
    expect(body.fromCache).toBe(false);
    expect(Array.isArray(body.anomalies)).toBe(true);
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(body.snapshot.crossRun.recurringFailures.length).toBeGreaterThan(0);
    expect(body.anomalies.map((a) => a.code)).toContain("cross-run.recurring-gate-failure");

    const cachePath = resolve(tmpProject, ".forge", "cross-run-cache.json");
    expect(existsSync(cachePath)).toBe(true);
    const cached = JSON.parse(readFileSync(cachePath, "utf-8"));
    expect(cached.cachedAt).toBe(body.cachedAt);
    expect(cached.report.mode).toBe("cross-run");
  });

  it("returns a fresh cached payload without recomputing", async () => {
    const cachePath = resolve(tmpProject, ".forge", "cross-run-cache.json");
    mkdirSync(resolve(tmpProject, ".forge"), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({
      cachedAt: new Date().toISOString(),
      report: {
        ok: true,
        mode: "cross-run",
        anomalies: [{ code: "cached.anomaly", severity: "info", message: "from cache" }],
        recommendations: [],
        snapshot: { ok: true, source: "cache" },
      },
    }, null, 2), "utf-8");

    const res = await get("/api/watcher/cross-run");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(true);
    expect(body.anomalies[0].code).toBe("cached.anomaly");
    expect(body.snapshot.source).toBe("cache");
  });

  it("ignores stale cache entries and recomputes the report", async () => {
    seedCrossRunHistory();
    const cachePath = resolve(tmpProject, ".forge", "cross-run-cache.json");
    writeFileSync(cachePath, JSON.stringify({
      cachedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      report: {
        ok: true,
        mode: "cross-run",
        anomalies: [{ code: "stale.cache", severity: "info", message: "old" }],
        recommendations: [],
        snapshot: { ok: true, source: "stale" },
      },
    }, null, 2), "utf-8");

    const res = await get("/api/watcher/cross-run");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fromCache).toBe(false);
    expect(body.anomalies.map((a) => a.code)).not.toContain("stale.cache");
    expect(body.mode).toBe("cross-run");
  });
});
