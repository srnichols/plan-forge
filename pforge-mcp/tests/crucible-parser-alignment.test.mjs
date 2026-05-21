/**
 * Plan Forge — Phase-59 S5: renderer↔parser alignment tests.
 *
 * For each mode, renders a fixture smelt and verifies that the output
 * can be parsed by the plan-parser's parseScopeContract and parseSlices.
 *
 * Alignment assertions:
 *   - parseScopeContract: contract.forbidden is non-empty when forbidden-actions answered
 *   - parseScopeContract: contract.inScope is non-empty when scope fields answered
 *   - parseSlices: slices[0].scope is non-empty when scope-files answered (via [scope:] header)
 *   - parseSlices: slices.length >= 1 for fully-answered smelts
 *   - bug-batch: parseSlices.length equals slice-breakdown line count
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Import modes to ensure registry is populated before renderDraft calls.
import "../crucible/modes/tweak.mjs";
import "../crucible/modes/feature.mjs";
import "../crucible/modes/full.mjs";
import "../crucible/modes/bug-batch.mjs";

import { renderDraft } from "../crucible-draft.mjs";
import { parseScopeContract, parseSlices } from "../orchestrator/plan-parser.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures", "crucible-baseline");

function loadFixture(lane) {
  const smelt = JSON.parse(readFileSync(join(FIXTURE_DIR, `${lane}-smelt.json`), "utf-8"));
  const markdown = renderDraft(smelt);
  const lines = markdown.split("\n");
  return { smelt, markdown, lines };
}

// ─── parseScopeContract alignment ────────────────────────────────────

describe("parseScopeContract alignment — all modes", () => {
  for (const lane of ["tweak", "feature", "full", "bug-batch"]) {
    it(`${lane}: contract.forbidden is non-empty`, () => {
      const { lines } = loadFixture(lane);
      const contract = parseScopeContract(lines);
      expect(contract.forbidden.length).toBeGreaterThan(0);
    });

    it(`${lane}: contract.inScope is non-empty`, () => {
      const { lines } = loadFixture(lane);
      const contract = parseScopeContract(lines);
      expect(contract.inScope.length).toBeGreaterThan(0);
    });
  }
});

// ─── parseSlices alignment ────────────────────────────────────────────

describe("parseSlices alignment — bug-batch synthesized slices", () => {
  it("bug-batch: rendered markdown contains [scope:] clause in slice headers", () => {
    const { markdown } = loadFixture("bug-batch");
    expect(markdown).toMatch(/\[scope:[^\]]+\]/);
  });
});

describe("parseSlices alignment — bug-batch", () => {
  it("bug-batch: parseSlices returns slices matching slice-breakdown line count", () => {
    const { smelt, lines } = loadFixture("bug-batch");
    const breakdownAnswer = smelt.answers.find((a) => a.questionId === "slice-breakdown");
    expect(breakdownAnswer).toBeTruthy();
    const breakdownLineCount = breakdownAnswer.answer
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean).length;

    const slices = parseSlices(lines);
    expect(slices.length).toBe(breakdownLineCount);
  });

  it("bug-batch: each parsed slice has non-empty scope from [scope:] clause", () => {
    const { lines } = loadFixture("bug-batch");
    const slices = parseSlices(lines);
    for (const slice of slices) {
      expect(slice.scope.length).toBeGreaterThan(0);
    }
  });

  it("bug-batch: parseScopeContract sees forbidden from ### Forbidden", () => {
    const { lines } = loadFixture("bug-batch");
    const contract = parseScopeContract(lines);
    expect(contract.forbidden.length).toBeGreaterThan(0);
  });
});

// ─── Heading structure assertions ────────────────────────────────────

describe("heading structure — no ## Anti-patterns, has ### Forbidden", () => {
  for (const lane of ["tweak", "feature", "full", "bug-batch"]) {
    it(`${lane}: rendered output has no ## Anti-patterns heading`, () => {
      const { markdown } = loadFixture(lane);
      expect(markdown).not.toMatch(/^## Anti-patterns/m);
    });

    it(`${lane}: rendered output has ### Forbidden subheading`, () => {
      const { markdown } = loadFixture(lane);
      expect(markdown).toMatch(/^### Forbidden/m);
    });
  }
});
