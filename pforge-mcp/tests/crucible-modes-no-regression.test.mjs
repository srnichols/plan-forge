/**
 * Plan Forge — Phase-59 S2 baseline: crucible three-lane no-regression gate.
 *
 * Captures the exact renderDraft() output for tweak / feature / full smelts
 * at the start of Phase-59 Slice 2. Any change to crucible-draft.mjs that
 * alters rendered output will fail this test, requiring a deliberate fixture
 * regen (see regeneration note below).
 *
 * "Truthful refusal" principle (from crucible-draft.mjs comment): TBD markers
 * must NEVER be replaced with plausible-sounding filler. The tweak and feature
 * fixtures intentionally contain {{TBD: ...}} markers for unanswered fields —
 * the test asserts these survive rendering unchanged.
 *
 * To regenerate fixtures after an intentional renderDraft change:
 *   node --input-type=module scripts/regen-crucible-baseline.mjs
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { renderDraft, MANDATORY_BLOCKS } from "../crucible-draft.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures", "crucible-baseline");

function smeltFixturePath(lane) {
  return join(FIXTURE_DIR, `${lane}-smelt.json`);
}

function renderedFixturePath(lane) {
  return join(FIXTURE_DIR, `${lane}-rendered.md`);
}

describe("crucible-modes no-regression (Phase-59 baseline)", () => {
  for (const lane of ["tweak", "feature", "full"]) {
    it(`${lane} lane renderDraft matches baseline fixture`, () => {
      const smelt = JSON.parse(readFileSync(smeltFixturePath(lane), "utf8"));
      const expected = readFileSync(renderedFixturePath(lane), "utf8").replace(/\r\n/g, "\n");
      const actual = renderDraft(smelt).replace(/\r\n/g, "\n");
      expect(actual).toBe(expected);
    });
  }

  it("tweak fixture contains {{TBD: out-of-scope}} (truthful refusal of unanswered)", () => {
    const md = readFileSync(renderedFixturePath("tweak"), "utf8");
    expect(md).toContain("{{TBD: out-of-scope}}");
  });

  it("tweak fixture contains {{TBD: tests}} (truthful refusal of unanswered tests field)", () => {
    const md = readFileSync(renderedFixturePath("tweak"), "utf8");
    expect(md).toContain("{{TBD: tests}}");
  });

  it("full fixture contains all MANDATORY_BLOCKS", () => {
    const md = readFileSync(renderedFixturePath("full"), "utf8");
    for (const block of MANDATORY_BLOCKS) expect(md).toContain(block);
  });

  it("full fixture heading is prefixed with Phase-59 phaseName", () => {
    const md = readFileSync(renderedFixturePath("full"), "utf8");
    expect(md).toMatch(/^# Phase-59:/);
  });

  it("rendered fixtures are non-trivially long (>= 200 bytes each)", () => {
    for (const lane of ["tweak", "feature", "full"]) {
      const md = readFileSync(renderedFixturePath(lane), "utf8");
      expect(md.length).toBeGreaterThanOrEqual(200);
    }
  });
});
