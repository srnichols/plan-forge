import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../graph/builder.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), "graph-builder-"));
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("buildGraph — Phase/Slice extraction", () => {
  it("extracts Phase and Slice nodes from plan markdown", () => {
    const plansDir = join(tmpDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "phase-38.md"), `# Phase-38.3 — Knowledge Graph\n\n### Slice 1 — Schema\n\n### Slice 2 — Builder\n`, "utf8");
    const { nodes, edges } = buildGraph(tmpDir, { execSyncFn: () => "" });
    const phaseNodes = nodes.filter(n => n.type === "Phase");
    const sliceNodes = nodes.filter(n => n.type === "Slice");
    expect(phaseNodes.length).toBe(1);
    expect(phaseNodes[0].name).toContain("Phase-38.3");
    expect(sliceNodes.length).toBe(2);
    expect(edges.filter(e => e.type === "Phase→Slice").length).toBe(2);
  });

  it("uses frontmatter crucibleId as phase id when present", () => {
    const plansDir = join(tmpDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "phase-99.md"), `---\ncrucibleId: phase-99-custom\n---\n# Phase-99 — Test\n`, "utf8");
    const { nodes } = buildGraph(tmpDir, { execSyncFn: () => "" });
    const phaseNodes = nodes.filter(n => n.type === "Phase");
    expect(phaseNodes.length).toBe(1);
    expect(phaseNodes[0].id).toContain("phase-99-custom");
  });
});

describe("buildGraph — commit nodes", () => {
  it("creates Commit nodes from mocked git log", () => {
    const mockOutput = "abc1234 feat(graph): add builder\ndef5678 fix(query): handle empty graph\n";
    const { nodes } = buildGraph(tmpDir, { execSyncFn: () => mockOutput });
    const commits = nodes.filter(n => n.type === "Commit");
    expect(commits.length).toBe(2);
    expect(commits[0].name).toBe("feat(graph): add builder");
    expect(commits[0].id).toBe("commit-abc1234");
  });

  it("returns empty nodes when git log fails", () => {
    const { nodes } = buildGraph(tmpDir, { execSyncFn: () => { throw new Error("not a git repo"); } });
    const commits = nodes.filter(n => n.type === "Commit");
    expect(commits.length).toBe(0);
  });
});

describe("buildGraph — empty state", () => {
  it("returns { nodes: [], edges: [] } on empty tmp dir", () => {
    const { nodes, edges } = buildGraph(tmpDir, { execSyncFn: () => "" });
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});

describe("buildGraph — malformed frontmatter", () => {
  it("skips malformed files and continues", () => {
    const plansDir = join(tmpDir, "docs", "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, "bad.md"), `---\nmalformed: [unclosed\n---\n# Phase-1 — Good\n`, "utf8");
    writeFileSync(join(plansDir, "good.md"), `# Phase-2 — Good\n### Slice 1 — Hello\n`, "utf8");
    const { nodes } = buildGraph(tmpDir, { execSyncFn: () => "" });
    const phaseNodes = nodes.filter(n => n.type === "Phase");
    // Should have at least the good phase
    expect(phaseNodes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildGraph — since date filtering", () => {
  it("passes since param to execSyncFn", () => {
    let capturedCmd = "";
    const mockExec = (cmd) => { capturedCmd = cmd; return ""; };
    buildGraph(tmpDir, { since: "7 days ago", execSyncFn: mockExec });
    expect(capturedCmd).toContain("7 days ago");
  });
});
