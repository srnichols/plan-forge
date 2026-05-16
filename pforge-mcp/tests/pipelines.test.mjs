/**
 * pipelines.test.mjs — Tests for pipelinesList() and pipelinesStats()
 *
 * Phase-ANVIL Slice 6
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { pipelinesList, pipelinesStats } from "../pipelines.mjs";

function makeTempDir() {
  const dir = resolve(tmpdir(), `pipelines-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── pipelinesList ───────────────────────────────────────────────────────────

describe("pipelinesList", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns exactly four pipeline entries", () => {
    const list = pipelinesList({ cwd: tmpDir });
    expect(list.length).toBe(4);
  });

  it("each entry has required fields: id, label, artifact, artifactExists, lastWriteAt", () => {
    const list = pipelinesList({ cwd: tmpDir });
    for (const p of list) {
      expect(typeof p.id).toBe("string");
      expect(p.id.length).toBeGreaterThan(0);
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.artifact).toBe("string");
      expect(typeof p.artifactExists).toBe("boolean");
      // lastWriteAt may be null when the artifact is absent
      expect(p.lastWriteAt === null || typeof p.lastWriteAt === "string").toBe(true);
    }
  });

  it("all four pipeline ids are distinct", () => {
    const list = pipelinesList({ cwd: tmpDir });
    const ids = list.map((p) => p.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("reports artifactExists: false on a fresh (empty) repo", () => {
    const list = pipelinesList({ cwd: tmpDir });
    expect(list.every((p) => p.artifactExists === false)).toBe(true);
  });

  it("reports lastWriteAt: null when artifact is absent", () => {
    const list = pipelinesList({ cwd: tmpDir });
    expect(list.every((p) => p.lastWriteAt === null)).toBe(true);
  });

  it("reports artifactExists: true and a non-null lastWriteAt when an artifact file exists", () => {
    const forgeDir = resolve(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "events.log"), "test-event\n");

    const list = pipelinesList({ cwd: tmpDir });
    const watcher = list.find((p) => p.id === "watcher-drift");
    expect(watcher).toBeDefined();
    expect(watcher.artifactExists).toBe(true);
    expect(typeof watcher.lastWriteAt).toBe("string");
    // ISO-8601 sanity check
    expect(new Date(watcher.lastWriteAt).getTime()).toBeGreaterThan(0);
  });

  it("reports artifactExists: true when artifact is a directory (runs, crucible)", () => {
    const forgeDir = resolve(tmpDir, ".forge");
    mkdirSync(resolve(forgeDir, "runs"), { recursive: true });

    const list = pipelinesList({ cwd: tmpDir });
    const hub = list.find((p) => p.id === "hub-session-replay");
    expect(hub.artifactExists).toBe(true);
  });

  it("includes all four canonical pipeline ids", () => {
    const list = pipelinesList({ cwd: tmpDir });
    const ids = list.map((p) => p.id);
    expect(ids).toContain("orchestrator-memory");
    expect(ids).toContain("watcher-drift");
    expect(ids).toContain("hub-session-replay");
    expect(ids).toContain("crucible-thoughts");
  });
});

// ─── pipelinesStats ──────────────────────────────────────────────────────────

describe("pipelinesStats", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns an object with pipelines array and anvil object", () => {
    const stats = pipelinesStats({ cwd: tmpDir });
    expect(stats).toBeDefined();
    expect(Array.isArray(stats.pipelines)).toBe(true);
    expect(typeof stats.anvil).toBe("object");
  });

  it("pipelines array has four entries", () => {
    const stats = pipelinesStats({ cwd: tmpDir });
    expect(stats.pipelines.length).toBe(4);
  });

  it("anvil has entries, totalBytes, perTool fields", () => {
    const stats = pipelinesStats({ cwd: tmpDir });
    expect(typeof stats.anvil.entries).toBe("number");
    expect(typeof stats.anvil.totalBytes).toBe("number");
    expect(typeof stats.anvil.perTool).toBe("object");
  });

  it("anvil.entries is 0 on a fresh (empty) repo", () => {
    const stats = pipelinesStats({ cwd: tmpDir });
    expect(stats.anvil.entries).toBe(0);
  });

  it("anvil.totalBytes is 0 on a fresh (empty) repo", () => {
    const stats = pipelinesStats({ cwd: tmpDir });
    expect(stats.anvil.totalBytes).toBe(0);
  });

  it("anvil.perTool is empty object on a fresh repo", () => {
    const stats = pipelinesStats({ cwd: tmpDir });
    expect(Object.keys(stats.anvil.perTool).length).toBe(0);
  });

  it("pipelines entries match pipelinesList output", () => {
    const stats = pipelinesStats({ cwd: tmpDir });
    const list = pipelinesList({ cwd: tmpDir });
    expect(stats.pipelines).toEqual(list);
  });
});
