/**
 * Plan Forge — Phase-26 Slice 12 (/api/innerloop/* endpoints) tests
 *
 * Covers the six REST endpoints added to server.mjs that power the
 * Slice-13 Inner Loop dashboard tab:
 *   - GET /api/innerloop/status
 *   - GET /api/innerloop/reviewer-calibration
 *   - GET /api/innerloop/gate-suggestions
 *   - GET /api/innerloop/cost-anomalies
 *   - GET /api/innerloop/proposed-fixes
 *   - GET /api/innerloop/federation
 *
 * Harness pattern mirrors tests/config-api.test.mjs: set PLAN_FORGE_PROJECT
 * before importing server.mjs so PROJECT_DIR binds to our tmp fixture.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Harness ────────────────────────────────────────────────────

let server;
let baseUrl;
let tmpProject;
let savedCwd;

beforeAll(async () => {
  tmpProject = mkdtempSync(join(tmpdir(), "pforge-innerloop-api-"));
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
  if (tmpProject && existsSync(tmpProject)) rmSync(tmpProject, { recursive: true, force: true });
});

async function get(path) {
  return fetch(`${baseUrl}${path}`);
}

function seedForge(...parts) {
  const dir = resolve(tmpProject, ".forge", ...parts.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  return resolve(dir, parts[parts.length - 1]);
}

function writeJsonl(path, records) {
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(path, lines, "utf-8");
}

// ─── /api/innerloop/status ──────────────────────────────────────

describe("GET /api/innerloop/status", () => {
  it("returns default advisory payload with empty state", async () => {
    // Reset any residual fixture from prior tests in this file.
    try { rmSync(resolve(tmpProject, ".forge"), { recursive: true, force: true }); } catch { /* ignore */ }
    // Write config that disables federation explicitly.
    writeFileSync(resolve(tmpProject, ".forge.json"), "{}", "utf-8");

    const res = await get("/api/innerloop/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviewer).toEqual({ eligible: false, count: 0, threshold: 50 });
    expect(body.skills).toEqual({ pendingCount: 0 });
    expect(body.federation).toEqual({ enabled: false, repoCount: 0, configErrors: 0 });
    expect(body.autoFix).toEqual({ openProposals: 0 });
  });

  it("reflects reviewer calibration progress when reviews exist", async () => {
    const dir = resolve(tmpProject, ".forge", "reviews");
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 7; i++) {
      writeFileSync(resolve(dir, `r-${i}.json`), JSON.stringify({ i }), "utf-8");
    }
    const res = await get("/api/innerloop/status");
    const body = await res.json();
    expect(body.reviewer.count).toBe(7);
    expect(body.reviewer.eligible).toBe(false);
    expect(body.reviewer.threshold).toBe(50);
  });
});

// ─── /api/innerloop/reviewer-calibration ────────────────────────

describe("GET /api/innerloop/reviewer-calibration", () => {
  it("returns {count, threshold, eligible}", async () => {
    // Add 3 more to the 7 seeded above.
    const dir = resolve(tmpProject, ".forge", "reviews");
    for (let i = 7; i < 10; i++) {
      writeFileSync(resolve(dir, `r-${i}.json`), JSON.stringify({ i }), "utf-8");
    }
    const res = await get("/api/innerloop/reviewer-calibration");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(10);
    expect(body.threshold).toBe(50);
    expect(body.eligible).toBe(false);
  });
});

// ─── /api/innerloop/gate-suggestions ────────────────────────────

describe("GET /api/innerloop/gate-suggestions", () => {
  it("returns empty when the ledger is absent", async () => {
    const res = await get("/api/innerloop/gate-suggestions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ records: [], counters: {} });
  });

  it("aggregates per-suggestionKey counters and returns recent records newest-first", async () => {
    const path = seedForge("gate-suggestions.jsonl");
    writeJsonl(path, [
      { type: "accept", suggestionKey: "abc123", domain: "database", suggestedCommand: "npm run migrate", at: "2026-04-10T00:00:00Z" },
      { type: "accept", suggestionKey: "abc123", domain: "database", suggestedCommand: "npm run migrate", at: "2026-04-11T00:00:00Z" },
      { type: "accept", suggestionKey: "def456", domain: "api",      suggestedCommand: "npm run openapi", at: "2026-04-12T00:00:00Z" },
    ]);

    const res = await get("/api/innerloop/gate-suggestions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counters).toEqual({ abc123: 2, def456: 1 });
    expect(body.records).toHaveLength(3);
    // Newest-first ordering
    expect(body.records[0].at).toBe("2026-04-12T00:00:00Z");
  });
});

// ─── /api/innerloop/cost-anomalies ──────────────────────────────

describe("GET /api/innerloop/cost-anomalies", () => {
  it("returns empty when the ledger is absent", async () => {
    const res = await get("/api/innerloop/cost-anomalies");
    const body = await res.json();
    expect(body).toEqual({ anomalies: [], count: 0 });
  });

  it("returns up to 50 anomalies, newest-first", async () => {
    const path = seedForge("cost-anomalies.jsonl");
    const records = [];
    for (let i = 0; i < 55; i++) {
      records.push({ sliceNumber: i, ratio: 2.5, at: `2026-04-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` });
    }
    writeJsonl(path, records);
    const res = await get("/api/innerloop/cost-anomalies");
    const body = await res.json();
    expect(body.count).toBe(55);
    expect(body.anomalies).toHaveLength(50);
    // Newest-first: the last-appended (slice 54) should lead.
    expect(body.anomalies[0].sliceNumber).toBe(54);
  });
});

// ─── /api/innerloop/proposed-fixes ──────────────────────────────

describe("GET /api/innerloop/proposed-fixes", () => {
  it("returns empty when the directory is absent", async () => {
    const res = await get("/api/innerloop/proposed-fixes");
    const body = await res.json();
    expect(body).toEqual({ fixes: [] });
  });

  it("lists patch files sorted mtime desc", async () => {
    const dir = resolve(tmpProject, ".forge", "proposed-fixes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "fix-a.patch"), "a", "utf-8");
    const aTime = new Date("2025-01-01T00:00:00Z");
    utimesSync(resolve(dir, "fix-a.patch"), aTime, aTime);
    writeFileSync(resolve(dir, "fix-b.patch"), "b", "utf-8");
    const bTime = new Date("2026-04-20T00:00:00Z");
    utimesSync(resolve(dir, "fix-b.patch"), bTime, bTime);

    const res = await get("/api/innerloop/proposed-fixes");
    const body = await res.json();
    expect(body.fixes).toHaveLength(2);
    expect(body.fixes[0].fixId).toBe("fix-b");
    expect(body.fixes[1].fixId).toBe("fix-a");
    expect(body.fixes[0].sizeBytes).toBe(1);
  });
});

// ─── /api/innerloop/federation ──────────────────────────────────

describe("GET /api/innerloop/federation", () => {
  it("reports disabled when federation is not configured", async () => {
    writeFileSync(resolve(tmpProject, ".forge.json"), JSON.stringify({}), "utf-8");
    const res = await get("/api/innerloop/federation");
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.repos).toEqual([]);
    expect(body.trajectories).toEqual([]);
    expect(body.limit).toBe(100);
  });

  it("surfaces configErrors for invalid repo entries", async () => {
    writeFileSync(
      resolve(tmpProject, ".forge.json"),
      JSON.stringify({ brain: { federation: { enabled: true, repos: ["https://bad/url", "relative/path"] } } }),
      "utf-8"
    );
    const res = await get("/api/innerloop/federation");
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.configErrors.length).toBe(2);
    expect(body.trajectories).toEqual([]);
  });

  it("returns trajectory list when federation has valid repos", async () => {
    const sibling = mkdtempSync(join(tmpdir(), "pforge-sibling-"));
    try {
      const tdir = resolve(sibling, ".forge", "trajectories", "Phase-X");
      mkdirSync(tdir, { recursive: true });
      writeFileSync(resolve(tdir, "slice-1.md"), "hello", "utf-8");

      writeFileSync(
        resolve(tmpProject, ".forge.json"),
        JSON.stringify({ brain: { federation: { enabled: true, repos: [sibling] } } }),
        "utf-8"
      );

      const res = await get("/api/innerloop/federation");
      const body = await res.json();
      expect(body.enabled).toBe(true);
      expect(body.trajectories).toHaveLength(1);
      expect(body.trajectories[0].sliceId).toBe("1");
      expect(body.trajectories[0].planBasename).toBe("Phase-X");
      // The `content` field is intentionally stripped for the list view.
      expect(body.trajectories[0].content).toBeUndefined();
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });
});
