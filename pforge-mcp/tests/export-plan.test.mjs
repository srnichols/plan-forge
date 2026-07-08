/**
 * Tests for pforge-mcp/export-plan.mjs
 *
 * Covers:
 *   - parseTitle            — heading extraction
 *   - parseSteps            — numbered, bulleted, checkbox, heading fallback
 *   - extractPaths          — backtick, quoted, bare paths
 *   - derivePhaseSlug       — title → SLUG transformation
 *   - buildGate             — test / code / default gate generation
 *   - buildSlice            — step → Slice descriptor
 *   - exportPlan            — end-to-end, including error paths
 *   - exportPlanFromFile    — file-based entry point
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseTitle,
  parseSteps,
  parseStructuredSlices,
  extractPaths,
  derivePhaseSlug,
  buildGate,
  buildSlice,
  exportPlan,
  exportPlanFromFile,
} from "../export-plan.mjs";

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── parseTitle ──────────────────────────────────────────────────────────────

describe("parseTitle", () => {
  it("extracts the first # heading", () => {
    expect(parseTitle("# Add JWT Authentication\nSome text.")).toBe("Add JWT Authentication");
  });

  it("ignores ## and deeper headings when # exists", () => {
    expect(parseTitle("# Main Title\n## Sub")).toBe("Main Title");
  });

  it("picks the # heading even when prose precedes it", () => {
    expect(parseTitle("Some plain text\n# Title")).toBe("Title");
  });

  it("returns 'Untitled Feature' for empty input", () => {
    expect(parseTitle("")).toBe("Untitled Feature");
  });

  it("trims whitespace from the title", () => {
    expect(parseTitle("#   Spaces Around Title   ")).toBe("Spaces Around Title");
  });
});

// ─── parseSteps ──────────────────────────────────────────────────────────────

describe("parseSteps", () => {
  it("parses numbered list items", () => {
    const text = "1. Create the module\n2. Add tests\n3. Update docs";
    expect(parseSteps(text)).toEqual(["Create the module", "Add tests", "Update docs"]);
  });

  it("parses bulleted list items with -", () => {
    const text = "- Step one\n- Step two\n- Step three";
    expect(parseSteps(text)).toEqual(["Step one", "Step two", "Step three"]);
  });

  it("parses bulleted list items with *", () => {
    const text = "* Alpha\n* Beta";
    expect(parseSteps(text)).toEqual(["Alpha", "Beta"]);
  });

  it("parses checkbox items (unchecked and checked)", () => {
    const text = "- [ ] Build the middleware\n- [x] Write tests";
    expect(parseSteps(text)).toEqual(["Build the middleware", "Write tests"]);
  });

  it("falls back to ## sub-headings when no list items", () => {
    const text = "# Title\n## Create auth module\n## Add tests";
    const steps = parseSteps(text);
    expect(steps).toContain("Create auth module");
    expect(steps).toContain("Add tests");
  });

  it("returns empty array for prose with no list items or sub-headings", () => {
    const text = "# Title\nJust a description paragraph.";
    expect(parseSteps(text)).toEqual([]);
  });

  it("ignores blank bulleted lines", () => {
    const text = "- Step one\n- \n- Step two";
    expect(parseSteps(text)).toEqual(["Step one", "Step two"]);
  });
});

// ─── parseStructuredSlices (meta-bug #235) ───────────────────────────────────

describe("parseStructuredSlices", () => {
  const STRUCTURED = `# Campaign Lifecycle

## Slice 1: Add the Prisma relation
Update \`api/prisma/schema.prisma\`.

Acceptance criteria:
- The Item.campaign relation exists
- Bulk import still compiles

## Slice 2: Wire the service
Edit \`api/src/campaigns/service.ts\`.
- returns 200
- writes an audit row
`;

  it("returns one slice per heading, not one per bullet", () => {
    const slices = parseStructuredSlices(STRUCTURED);
    expect(slices).toHaveLength(2);
  });

  it("uses the heading label as the goal", () => {
    const slices = parseStructuredSlices(STRUCTURED);
    expect(slices[0].goal).toBe("Add the Prisma relation");
    expect(slices[1].goal).toBe("Wire the service");
  });

  it("keeps bullet points inside the slice body (not new slices)", () => {
    const slices = parseStructuredSlices(STRUCTURED);
    expect(slices[0].body).toContain("Bulk import still compiles");
  });

  it("recognises 'Step N' and 'Phase N' headings too", () => {
    expect(parseStructuredSlices("## Step 1: A\n## Step 2: B")).toHaveLength(2);
    expect(parseStructuredSlices("### Phase 1 — X\n### Phase 2 — Y")).toHaveLength(2);
  });

  it("derives a goal from the body when the heading has no label", () => {
    const slices = parseStructuredSlices("## Slice 1\n- Do the thing");
    expect(slices[0].goal).toBe("Do the thing");
  });

  it("returns [] for loose plans with no slice/step/phase headings", () => {
    expect(parseStructuredSlices("# Title\n1. One\n2. Two")).toEqual([]);
    expect(parseStructuredSlices("## Create auth module\n## Add tests")).toEqual([]);
  });
});

// ─── extractPaths ────────────────────────────────────────────────────────────

describe("extractPaths", () => {
  it("extracts backtick-quoted paths", () => {
    const text = "Create `src/auth/jwt.mjs` and `src/auth/index.mjs`.";
    expect(extractPaths(text)).toContain("src/auth/jwt.mjs");
    expect(extractPaths(text)).toContain("src/auth/index.mjs");
  });

  it("extracts double-quoted paths", () => {
    const text = `Modify "pforge-mcp/server.mjs" to register the tool.`;
    expect(extractPaths(text)).toContain("pforge-mcp/server.mjs");
  });

  it("extracts bare paths with known root segments", () => {
    const text = "Add tests in tests/auth-jwt.test.mjs for the new module.";
    const paths = extractPaths(text);
    expect(paths).toContain("tests/auth-jwt.test.mjs");
  });

  it("deduplicates repeated paths", () => {
    const text = "Edit `src/foo.ts` twice: `src/foo.ts` again.";
    const paths = extractPaths(text);
    expect(paths.filter((p) => p === "src/foo.ts")).toHaveLength(1);
  });

  it("returns empty array when no paths are found", () => {
    expect(extractPaths("No paths in this sentence at all.")).toEqual([]);
  });
});

// ─── derivePhaseSlug ─────────────────────────────────────────────────────────

describe("derivePhaseSlug", () => {
  it("uppercases and hyphenates significant words", () => {
    const slug = derivePhaseSlug("Add rate limiting to the REST API");
    expect(slug).toBe("RATE-LIMITING-REST-API");
  });

  it("removes short stop words", () => {
    const slug = derivePhaseSlug("Fix the bug in the database layer");
    expect(slug).not.toContain("THE");
    expect(slug).not.toContain("FIX");
  });

  it("returns at most 4 words", () => {
    const slug = derivePhaseSlug("implement advanced multi-tenant user authentication system");
    expect(slug.split("-").length).toBeLessThanOrEqual(4);
  });

  it("returns 'FEATURE' for a title that reduces to no significant words", () => {
    expect(derivePhaseSlug("Add the new")).toBe("FEATURE");
  });
});

// ─── buildGate ───────────────────────────────────────────────────────────────

describe("buildGate", () => {
  it("generates a vitest run gate for test files", () => {
    const gate = buildGate(["pforge-mcp/tests/auth.test.mjs"], "Add tests");
    expect(gate).toContain("vitest run");
    expect(gate).toContain("tests/auth.test.mjs");
    expect(gate).toContain("echo ok");
  });

  it("generates an existence check gate for code files", () => {
    const gate = buildGate(["src/auth/jwt.ts"], "Create JWT module");
    expect(gate).toContain("test -f src/auth/jwt.ts");
    expect(gate).toContain("echo ok");
  });

  it("generates a placeholder gate when no files are provided", () => {
    const gate = buildGate([], "Do something generic");
    expect(gate).toContain("ok");
  });

  it("prefers test-file gate over code-file gate when both are present", () => {
    const gate = buildGate(
      ["src/auth/jwt.ts", "tests/auth.test.mjs"],
      "Create module and add tests"
    );
    expect(gate).toContain("vitest run");
  });

  it("adds a typecheck reminder for TypeScript files (meta-bug #234)", () => {
    const gate = buildGate(["src/auth/jwt.ts"], "Create JWT module");
    expect(gate.toLowerCase()).toContain("typecheck");
  });

  it("does not add a typecheck reminder for non-TypeScript files", () => {
    const gate = buildGate(["src/auth/jwt.mjs"], "Create JWT module");
    expect(gate.toLowerCase()).not.toContain("typecheck");
  });
});

// ─── buildSlice ──────────────────────────────────────────────────────────────

describe("buildSlice", () => {
  it("returns the correct ordinal number", () => {
    expect(buildSlice("Do something", 3).number).toBe(3);
  });

  it("preserves the goal text", () => {
    expect(buildSlice("Create `src/foo.ts`", 1).goal).toBe("Create `src/foo.ts`");
  });

  it("extracts files from the goal text", () => {
    const slice = buildSlice("Create `src/middleware/auth.ts`", 1);
    expect(slice.files).toContain("src/middleware/auth.ts");
  });

  it("generates a gate based on extracted files", () => {
    const slice = buildSlice("Add tests in `tests/auth.test.mjs`", 2);
    expect(slice.gate).toContain("vitest run");
  });
});

// ─── exportPlan ──────────────────────────────────────────────────────────────

const SAMPLE_PLAN = `# Add rate limiting to the API

Protect the REST endpoints from abuse by adding per-IP rate limiting.

1. Create \`src/middleware/rate-limiter.ts\` with configurable limits
2. Wire the middleware into \`src/app.ts\`
3. Add tests in \`tests/rate-limiter.test.ts\`
4. Update \`docs/api/rate-limiting.md\` with usage examples
`;

describe("exportPlan", () => {
  it("returns ok:true for valid input", () => {
    const result = exportPlan(SAMPLE_PLAN);
    expect(result.ok).toBe(true);
  });

  it("parses the correct title", () => {
    const result = exportPlan(SAMPLE_PLAN);
    expect(result.title).toBe("Add rate limiting to the API");
  });

  it("generates the correct number of slices", () => {
    const result = exportPlan(SAMPLE_PLAN);
    expect(result.sliceCount).toBe(4);
  });

  it("derives a phase slug from the title", () => {
    const result = exportPlan(SAMPLE_PLAN);
    expect(result.phaseSlug).toBeTruthy();
    expect(/^[A-Z][A-Z0-9-]+$/.test(result.phaseSlug)).toBe(true);
  });

  it("honours the phaseName override", () => {
    const result = exportPlan(SAMPLE_PLAN, { phaseName: "MY-CUSTOM-PHASE" });
    expect(result.phaseSlug).toBe("MY-CUSTOM-PHASE");
    expect(result.plan).toContain("Phase-MY-CUSTOM-PHASE:");
  });

  it("output plan contains the HARDENED status header", () => {
    const { plan } = exportPlan(SAMPLE_PLAN);
    expect(plan).toContain("Hardened, ready for execution");
  });

  it("output plan contains Scope Contract section", () => {
    const { plan } = exportPlan(SAMPLE_PLAN);
    expect(plan).toContain("## Scope Contract");
  });

  it("output plan contains Forbidden Actions", () => {
    const { plan } = exportPlan(SAMPLE_PLAN);
    expect(plan).toContain("### Forbidden Actions");
  });

  it("output plan contains an Execution Slices section", () => {
    const { plan } = exportPlan(SAMPLE_PLAN);
    expect(plan).toContain("## Execution Slices");
    expect(plan).toContain("### Slice 1:");
  });

  it("includes extracted file paths in the output", () => {
    const { plan } = exportPlan(SAMPLE_PLAN);
    expect(plan).toContain("src/middleware/rate-limiter.ts");
  });

  it("returns ok:false for empty input", () => {
    const result = exportPlan("");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns ok:false when no steps are found", () => {
    const result = exportPlan("# Just a title\nJust a description with no list.");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("No steps found");
  });

  it("includes a message field on success", () => {
    const result = exportPlan(SAMPLE_PLAN);
    expect(result.message).toBeTruthy();
    expect(result.message).toContain("Phase-");
  });
});

// ─── exportPlan — structured slice headings (meta-bug #235) ──────────────────

const STRUCTURED_PLAN = `# Campaign Lifecycle

Manage campaign create, archive, and delete.

## Slice 1: Add the Prisma relation
Update \`api/prisma/schema.prisma\` with an Item.campaign relation.

Acceptance criteria:
- The relation exists
- Bulk import still compiles

## Slice 2: Add the service
Create \`api/src/campaigns/service.ts\`.
- create returns 201
- archive sets status to Archived

## Slice 3: Add tests
Add \`api/src/campaigns/service.test.ts\`.
`;

describe("exportPlan with structured slice headings", () => {
  it("produces one slice per '## Slice N' heading, not one per bullet", () => {
    const result = exportPlan(STRUCTURED_PLAN);
    expect(result.ok).toBe(true);
    expect(result.sliceCount).toBe(3);
  });

  it("uses the heading label as the slice goal", () => {
    const { plan } = exportPlan(STRUCTURED_PLAN);
    expect(plan).toContain("### Slice 1: Add the Prisma relation");
    expect(plan).toContain("### Slice 2: Add the service");
  });

  it("extracts files from the slice body", () => {
    const result = exportPlan(STRUCTURED_PLAN);
    expect(result.files).toContain("api/prisma/schema.prisma");
    expect(result.files).toContain("api/src/campaigns/service.ts");
  });

  it("does not turn acceptance-criteria bullets into slices", () => {
    const { plan } = exportPlan(STRUCTURED_PLAN);
    expect(plan).not.toContain("### Slice 4:");
  });
});

// ─── exportPlanFromFile ──────────────────────────────────────────────────────

describe("exportPlanFromFile", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `pforge-export-plan-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("reads and exports a file successfully", () => {
    const inputPath = join(tmpDir, "loose-plan.md");
    writeFileSync(inputPath, SAMPLE_PLAN, "utf-8");
    const result = exportPlanFromFile(inputPath, { cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(result.sliceCount).toBe(4);
  });

  it("writes to outputPath when provided", () => {
    const inputPath = join(tmpDir, "loose-plan.md");
    const outputPath = join(tmpDir, "output", "Phase-TEST-PLAN.md");
    writeFileSync(inputPath, SAMPLE_PLAN, "utf-8");

    const result = exportPlanFromFile(inputPath, { outputPath, cwd: tmpDir });
    expect(result.ok).toBe(true);
    expect(existsSync(result.outputPath)).toBe(true);
  });

  it("returns ok:false for a missing input file", () => {
    const result = exportPlanFromFile(join(tmpDir, "nonexistent.md"), { cwd: tmpDir });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});
