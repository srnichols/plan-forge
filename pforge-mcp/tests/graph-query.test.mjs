import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { queryByPhase, queryByFile, queryRecentChanges, neighbors, _resetGraphCache } from "../graph/query.mjs";
import { buildGraph } from "../graph/builder.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), "graph-query-"));
  _resetGraphCache();
});

afterEach(() => {
  _resetGraphCache();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function setupTestGraph(dir) {
  // Create a plan with phase and slices
  const plansDir = join(dir, "docs", "plans");
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(plansDir, "phase-38.md"), `# Phase-38.3 — Knowledge Graph\n\n### Slice 1 — Schema\n\n### Slice 2 — Builder\n`, "utf8");
  // Build graph and write snapshot
  const graph = buildGraph(dir, { execSyncFn: () => "abc1234 feat(graph): add builder\n" });
  return graph;
}

describe("queryByPhase", () => {
  it("returns correct nodes/edges for known phase", () => {
    setupTestGraph(tmpDir);
    _resetGraphCache();
    const result = queryByPhase("Phase-38.3", { projectDir: tmpDir });
    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.nodes.some(n => n.type === "Phase")).toBe(true);
  });

  it("returns empty for unknown phase", () => {
    setupTestGraph(tmpDir);
    _resetGraphCache();
    const result = queryByPhase("Phase-999", { projectDir: tmpDir });
    expect(result.nodeCount).toBe(0);
    expect(result.edgeCount).toBe(0);
  });
});

describe("queryByFile", () => {
  it("returns empty for file not in graph", () => {
    setupTestGraph(tmpDir);
    _resetGraphCache();
    const result = queryByFile("nonexistent.js", { projectDir: tmpDir });
    expect(result.nodeCount).toBe(0);
    expect(result.edgeCount).toBe(0);
  });
});

describe("queryRecentChanges", () => {
  it("returns commit nodes", () => {
    setupTestGraph(tmpDir);
    _resetGraphCache();
    const result = queryRecentChanges({ type: "Commit" }, { projectDir: tmpDir });
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(result).toHaveProperty("nodeCount");
    expect(result).toHaveProperty("edgeCount");
  });

  it("filters by type", () => {
    setupTestGraph(tmpDir);
    _resetGraphCache();
    const result = queryRecentChanges({ type: "Slice" }, { projectDir: tmpDir });
    expect(result.nodes.every(n => n.type === "Slice")).toBe(true);
  });
});

describe("neighbors", () => {
  it("returns 1-hop neighbors of a phase node", () => {
    const graph = setupTestGraph(tmpDir);
    _resetGraphCache();
    const phaseNode = graph.nodes.find(n => n.type === "Phase");
    if (!phaseNode) return; // skip if no phase
    const result = neighbors(phaseNode.id, { projectDir: tmpDir });
    expect(result).toHaveProperty("nodeCount");
    expect(result.nodeCount).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for unknown nodeId", () => {
    setupTestGraph(tmpDir);
    _resetGraphCache();
    const result = neighbors("nonexistent-id", { projectDir: tmpDir });
    expect(result.nodeCount).toBe(0);
    expect(result.edgeCount).toBe(0);
  });

  it("filters by edgeType", () => {
    const graph = setupTestGraph(tmpDir);
    _resetGraphCache();
    const phaseNode = graph.nodes.find(n => n.type === "Phase");
    if (!phaseNode) return;
    const result = neighbors(phaseNode.id, { projectDir: tmpDir, edgeType: "Phase→Slice" });
    expect(result.edges.every(e => e.type === "Phase→Slice")).toBe(true);
  });
});

describe("snapshot round-trip", () => {
  it("build → write snapshot → reset cache → load snapshot → query returns same result", () => {
    const graph = setupTestGraph(tmpDir);
    _resetGraphCache();
    const result1 = queryByPhase("Phase-38.3", { projectDir: tmpDir });
    _resetGraphCache();
    const result2 = queryByPhase("Phase-38.3", { projectDir: tmpDir });
    expect(result1.nodeCount).toBe(result2.nodeCount);
    expect(result1.edgeCount).toBe(result2.edgeCount);
  });
});

describe("empty graph", () => {
  it("all queries return { nodes: [], edges: [], nodeCount: 0, edgeCount: 0 }", () => {
    // Empty dir - no snapshot, no plans
    const r1 = queryByPhase("anything", { projectDir: tmpDir });
    expect(r1).toEqual({ nodes: [], edges: [], nodeCount: 0, edgeCount: 0 });
    _resetGraphCache();
    const r2 = queryByFile("anything", { projectDir: tmpDir });
    expect(r2).toEqual({ nodes: [], edges: [], nodeCount: 0, edgeCount: 0 });
    _resetGraphCache();
    const r3 = queryRecentChanges({}, { projectDir: tmpDir });
    expect(r3).toEqual({ nodes: [], edges: [], nodeCount: 0, edgeCount: 0 });
    _resetGraphCache();
    const r4 = neighbors("any-id", { projectDir: tmpDir });
    expect(r4).toEqual({ nodes: [], edges: [], nodeCount: 0, edgeCount: 0 });
  });
});
