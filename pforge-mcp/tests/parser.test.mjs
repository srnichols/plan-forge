import { describe, it, expect } from "vitest";
import { parsePlan, SUPPORTED_AGENTS, compareSliceIds, normalizeSliceId } from "../orchestrator.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(__dirname, "fixtures", name);

describe("parsePlan", () => {
  it("parses plan title from h1 heading", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.meta.title).toBe("Sample Test Plan");
  });

  it("parses plan status", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.meta.status).toBe("in-progress");
  });

  it("parses feature branch", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.meta.branch).toBe("feature/test-branch");
  });

  it("parses in-scope items", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.scopeContract.inScope).toContain("Add parser module");
    expect(result.scopeContract.inScope).toContain("Write unit tests");
  });

  it("parses out-of-scope items", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.scopeContract.outOfScope).toContain("Database changes");
  });

  it("parses forbidden items", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.scopeContract.forbidden).toContain("Modify existing auth");
  });

  it("parses all slices", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices).toHaveLength(3);
  });

  it("parses slice numbers and titles", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[0].number).toBe("1");
    expect(result.slices[0].title).toBe("Setup Framework");
    expect(result.slices[1].number).toBe("2");
    expect(result.slices[1].title).toBe("Implement Parser");
  });

  it("parses build and test commands", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[0].buildCommand).toBe("npm install");
    expect(result.slices[0].testCommand).toBe("npm test");
  });

  it("parses validation gate", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[0].validationGate).toBe("npm test");
  });

  it("parses stop condition", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[0].stopCondition).toBe("All tests pass");
  });

  it("parses numbered tasks", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[0].tasks).toContain("Install dependencies");
    expect(result.slices[0].tasks).toContain("Configure vitest");
  });

  it("parses [P] parallel flag", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[1].parallel).toBe(true);
    expect(result.slices[0].parallel).toBe(false);
  });

  it("parses [scope:] tag", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[1].scope).toContain("src/parser.ts");
    expect(result.slices[1].scope).toContain("src/types.ts");
  });

  it("parses [depends:] single dependency", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[1].depends).toContain("1");
  });

  it("parses [depends:] multiple dependencies", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices[2].depends).toContain("1");
    expect(result.slices[2].depends).toContain("2");
  });

  it("builds a DAG with topological order", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.dag).toBeDefined();
    expect(result.dag.order).toBeInstanceOf(Array);
  });

  it("throws for paths outside project directory", () => {
    expect(() => parsePlan("C:\\Windows\\System32\\evil.md")).toThrow(
      /must be within project directory/
    );
  });
});

describe("parsePlan format tolerance", () => {
  const tolerancePlan = fixture("format-tolerance-plan.md");

  it("parses lowercase slice header", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[0].number).toBe("1");
    expect(result.slices[0].title).toBe("lowercase header");
  });

  it("parses UPPERCASE slice header", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[1].number).toBe("2");
    expect(result.slices[1].title).toBe("UPPERCASE HEADER");
  });

  it("parses [depends on:] fuzzy dependency tag", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[1].depends).toContain("1");
  });

  it("parses em dash (—) slice header separator", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[2].number).toBe("3");
    expect(result.slices[2].title).toBe("Em Dash Title");
  });

  it("parses [dep:] fuzzy dependency tag", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[2].depends).toContain("1");
  });

  it("parses [parallel] fuzzy parallel tag", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[2].parallel).toBe(true);
  });

  it("parses dash (-) slice header separator", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[3].number).toBe("4");
    expect(result.slices[3].title).toBe("Dash Title");
  });

  it("parses [needs:] fuzzy dependency tag", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[3].depends).toContain("1");
    expect(result.slices[3].depends).toContain("2");
  });

  it("parses [parallel-safe] fuzzy parallel tag", () => {
    const result = parsePlan(tolerancePlan);
    expect(result.slices[3].parallel).toBe(true);
  });
});

describe("alphanumeric slice IDs", () => {
  const tolerancePlan = fixture("format-tolerance-plan.md");

  it("parses ### Slice 5A: header with alpha suffix", () => {
    const result = parsePlan(tolerancePlan);
    const s5a = result.slices.find((s) => s.number === "5A");
    expect(s5a).toBeDefined();
    expect(s5a.title).toBe("Alpha variant A");
  });

  it("parses mixed numeric + alpha plan", () => {
    const result = parsePlan(tolerancePlan);
    const ids = result.slices.map((s) => s.number);
    expect(ids).toContain("1");
    expect(ids).toContain("5A");
    expect(ids).toContain("5B");
    expect(ids).toContain("6");
  });

  it("compareSliceIds: bare numeric before suffixed", () => {
    expect(compareSliceIds("2", "2A")).toBeLessThan(0);
  });

  it("compareSliceIds: lexicographic suffix order", () => {
    expect(compareSliceIds("2A", "2B")).toBeLessThan(0);
  });

  it("compareSliceIds: suffixed before next integer", () => {
    expect(compareSliceIds("2B", "3")).toBeLessThan(0);
  });

  it("normalizeSliceId: case-insensitive dependency resolves", () => {
    expect(normalizeSliceId("2a")).toBe("2A");
    expect(normalizeSliceId("Slice 2b")).toBe("2B");
    expect(normalizeSliceId(" 3 ")).toBe("3");
  });

  it("dependency [depends: 5a] resolves to node 5A in DAG", () => {
    const result = parsePlan(tolerancePlan);
    const s5b = result.slices.find((s) => s.number === "5B");
    expect(s5b.depends).toContain("5A");
    // Verify edge exists in DAG
    const node5A = result.dag.nodes.get("5A");
    expect(node5A.children).toContain("5B");
  });

  it("DAG order preserves correct alpha ordering", () => {
    const result = parsePlan(tolerancePlan);
    const order = result.dag.order;
    const i5A = order.indexOf("5A");
    const i5B = order.indexOf("5B");
    const i6 = order.indexOf("6");
    expect(i5A).toBeLessThan(i5B);
    expect(i5B).toBeLessThan(i6);
  });

  it("existing numeric/dotted fixture still passes (regression)", () => {
    const result = parsePlan(fixture("sample-plan.md"));
    expect(result.slices).toHaveLength(3);
    expect(result.slices[0].number).toBe("1");
    expect(result.dag.order).toBeInstanceOf(Array);
    expect(result.dag.order).toHaveLength(3);
  });
});

describe("SUPPORTED_AGENTS", () => {
  it("includes copilot", () => {
    expect(SUPPORTED_AGENTS).toContain("copilot");
  });

  it("includes all expected agents", () => {
    expect(SUPPORTED_AGENTS).toContain("claude");
    expect(SUPPORTED_AGENTS).toContain("cursor");
    expect(SUPPORTED_AGENTS).toContain("codex");
    expect(SUPPORTED_AGENTS).toContain("gemini");
    expect(SUPPORTED_AGENTS).toContain("windsurf");
    expect(SUPPORTED_AGENTS).toContain("generic");
  });

  it("is a non-empty array", () => {
    expect(Array.isArray(SUPPORTED_AGENTS)).toBe(true);
    expect(SUPPORTED_AGENTS.length).toBeGreaterThan(0);
  });
});
