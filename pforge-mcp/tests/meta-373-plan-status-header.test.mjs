import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parsePlan } from "../orchestrator/plan-parser.mjs";
import { PLAN_CORPUS, PLAN_CORPUS_ROOT, PLANS_DIR } from "./helpers/plan-corpus.mjs";

/**
 * Meta-bug #373 — `parseMeta` overwrote the plan's status on every
 * `**Status**:` line it met, so the LAST one in the file won. Plans carry more
 * status lines further down (an advisory note, a per-section status), and those
 * replaced the header's. Phase-42 and Phase-50, both shipped, parsed as
 * "Advisory data for the Step-2 hardener...", which the dashboard and the plan
 * summary then showed.
 *
 * The plan's status is the one in its header, before the first `##` heading.
 */

describe("plan status comes from the header (#373)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-373-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const SLICES = ["## Execution Slices", "### Slice 1: Work", "1. Do it", ""];
  function parseMetaOf(...lines) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, lines.join("\n"));
    return parsePlan(planPath, dir).meta;
  }

  it("keeps the header's status when a later section carries another", () => {
    const meta = parseMetaOf(
      "# Phase 9: Status probe", "", "**Status**: In Progress", "**Feature Branch**: `feature/probe`", "",
      "## Scope Contract", "### In Scope", "- src/**", "", ...SLICES,
      "## Notes", "**Status**: pending review",
    );
    expect(meta.status).toBe("In Progress");
    expect(meta.branch).toBe("feature/probe");
    expect(meta.title).toBe("Phase 9: Status probe");
  });

  it("does not take a status written inside a slice for the plan's", () => {
    const meta = parseMetaOf(
      "# Phase 9: Status probe", "", "**Status**: Hardened", "", "## Scope Contract", "### In Scope", "- src/**", "",
      "## Execution Slices", "### Slice 1: Work", "**Status**: Done", "1. Do it", "",
    );
    expect(meta.status).toBe("Hardened");
  });

  it("reads a status written as a quoted header line", () => {
    const meta = parseMetaOf("# Phase 9", "> **Status**: Draft", "", "## Scope Contract", "### In Scope", "- src/**", "", ...SLICES);
    expect(meta.status).toBe("Draft");
  });

  it("falls back to the first status in the file when the header has none", () => {
    const meta = parseMetaOf(
      "# Phase 9", "", "## Scope Contract", "### In Scope", "- src/**", "", "**Status**: Late", ...SLICES, "**Status**: Later",
    );
    expect(meta.status).toBe("Late");
  });

  it("leaves the status empty when the plan declares none", () => {
    expect(parseMetaOf("# Phase 9", "", "## Scope Contract", "### In Scope", "- src/**", "", ...SLICES).status).toBe("");
  });
});

const STATUS = /\*\*Status\*\*:\s*(.+)/;

/** The first Status line before the first `##` heading, which is where this repository's plans declare it. */
function headerStatus(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const end = lines.findIndex((line) => /^##\s/.test(line));
  for (const line of end === -1 ? lines : lines.slice(0, end)) {
    const match = line.match(STATUS);
    if (match) return match[1].trim();
  }
  return null;
}

// The corpus is the framework's own phase plans: planning/main has them, master and an installed project do not (#398).
describe.skipIf(PLAN_CORPUS.length === 0)("the plans in docs/plans report their header status (#373)", () => {
  const plans = PLAN_CORPUS;

  it("reads a corpus large enough to mean something", () => {
    expect(plans.length).toBeGreaterThan(20);
  });

  it("reports each plan's header status, including the plans with several Status lines", () => {
    const wrong = plans
      .map((file) => ({ plan: relative(PLANS_DIR, file).replace(/\\/g, "/"), expected: headerStatus(file), actual: parsePlan(file, PLAN_CORPUS_ROOT).meta.status }))
      .filter(({ expected, actual }) => expected !== null && actual !== expected)
      .map(({ plan, expected, actual }) => `${plan}: expected "${expected.slice(0, 50)}" but parsed "${actual.slice(0, 50)}"`);
    expect(wrong).toEqual([]);
  });

  it("reports the two shipped plans that carry an advisory Status line further down as shipped", () => {
    for (const name of ["Phase-42-CLEAN-CODE-AUDIT-PLAN.md", "Phase-50-CLEAN-CODE-GUIDANCE-PLAN.md"]) {
      const file = join(PLANS_DIR, name);
      if (!existsSync(file)) continue;
      expect(parsePlan(file, PLAN_CORPUS_ROOT).meta.status, name).toMatch(/shipped/i);
    }
  });
});
