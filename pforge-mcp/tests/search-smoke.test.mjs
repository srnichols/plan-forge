/**
 * Plan Forge — Phase FORGE-SHOP-04 Slice 04.2: Search smoke tests.
 *
 * End-to-end tests through the search engine with fixture data.
 * Tests the API-layer contract: query parsing, result shape, scoring,
 * source filtering, and empty/edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { search, clearCache } from "../search/core.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-search-smoke-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupForge(tmpDir) {
  mkdirSync(resolve(tmpDir, ".forge", "runs", "run-001"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "bugs"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "incidents"), { recursive: true });
  mkdirSync(resolve(tmpDir, ".forge", "tempering"), { recursive: true });
  mkdirSync(resolve(tmpDir, "docs", "plans"), { recursive: true });
}

function writeJsonl(filePath, records) {
  writeFileSync(filePath, records.map(r => JSON.stringify(r)).join("\n") + "\n");
}

let tmpDir;

beforeEach(() => {
  tmpDir = makeTmpDir();
  setupForge(tmpDir);
  clearCache();
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
});

describe("Search smoke tests", () => {
  it("end-to-end: search returns hits ordered by score", () => {
    // Write events to run log
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { ts: new Date().toISOString(), event: "slice-completed", slice: 1, message: "blocker auth issue resolved" },
      { ts: new Date().toISOString(), event: "run-started", plan: "test-plan", message: "starting test run" },
    ]);

    const result = search({ query: "blocker auth" }, { cwd: tmpDir });
    expect(result).toHaveProperty("hits");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("truncated");

    if (result.hits.length > 1) {
      // Verify descending score order
      for (let i = 1; i < result.hits.length; i++) {
        expect(result.hits[i - 1].score).toBeGreaterThanOrEqual(result.hits[i].score);
      }
    }
  });

  it("end-to-end: hits span multiple source types", () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { ts: new Date().toISOString(), event: "slice-failed", message: "critical failure in deployment" },
    ]);
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "BUG-001.json"), JSON.stringify({
      id: "BUG-001", title: "Critical deployment bug", severity: "high",
      status: "open", createdAt: new Date().toISOString(),
    }));
    writeFileSync(resolve(tmpDir, "docs", "plans", "Phase-TEST-01.md"), "# Test Plan\n\n## Slice 1: Critical deployment fix\n\nFix the critical deployment pipeline.\n");

    const result = search({ query: "critical deployment" }, { cwd: tmpDir });
    const sources = new Set(result.hits.map(h => h.source));
    expect(sources.size).toBeGreaterThanOrEqual(2);
  });

  it("empty query returns empty results", () => {
    const result = search({ query: "" }, { cwd: tmpDir });
    expect(result.hits).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("source filter restricts to specified source", () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { ts: new Date().toISOString(), event: "slice-completed", message: "auth feature done" },
    ]);
    writeFileSync(resolve(tmpDir, ".forge", "bugs", "BUG-002.json"), JSON.stringify({
      id: "BUG-002", title: "Auth feature bug", severity: "medium",
      status: "open", createdAt: new Date().toISOString(),
    }));

    const result = search({ query: "auth", sources: ["bug"] }, { cwd: tmpDir });
    for (const hit of result.hits) {
      expect(hit.source).toBe("bug");
    }
  });

  it("correlationId match boosts above token-only match", () => {
    const corrId = "CORR-ABC-123";
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { ts: new Date().toISOString(), event: "slice-completed", message: "deploy step", correlationId: corrId },
      { ts: new Date().toISOString(), event: "slice-completed", message: "deploy step completed successfully" },
    ]);

    const result = search({ query: "deploy", correlationId: corrId }, { cwd: tmpDir });
    if (result.hits.length >= 2) {
      const corrHit = result.hits.find(h => h.correlationId === corrId);
      const plainHit = result.hits.find(h => h.correlationId !== corrId);
      if (corrHit && plainHit) {
        expect(corrHit.score).toBeGreaterThan(plainHit.score);
      }
    }
  });

  it("result shape has required fields for dashboard rendering", () => {
    writeJsonl(resolve(tmpDir, ".forge", "runs", "run-001", "events.log"), [
      { ts: new Date().toISOString(), event: "slice-completed", message: "test result shape" },
    ]);

    const result = search({ query: "test result" }, { cwd: tmpDir });
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.truncated).toBe("boolean");
    expect(Array.isArray(result.hits)).toBe(true);

    if (result.hits.length > 0) {
      const hit = result.hits[0];
      expect(hit).toHaveProperty("source");
      expect(hit).toHaveProperty("snippet");
      expect(hit).toHaveProperty("score");
    }
  });
});
