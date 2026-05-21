/**
 * Phase-59 S3 — frontmatter completeness tests.
 * Tests the buildFinalizeFrontmatter helper from crucible/core/finalize.mjs.
 */
import { describe, it, expect } from "vitest";
import { buildFinalizeFrontmatter } from "../crucible/core/finalize.mjs";

const BASE_SMELT = {
  id: "test-smelt-001",
  lane: "feature",
  source: "human",
  answers: [],
};

describe("buildFinalizeFrontmatter", () => {
  it("emits phaseId always", () => {
    const fm = buildFinalizeFrontmatter(BASE_SMELT, "Phase-60");
    expect(fm).toContain("phaseId: Phase-60");
  });

  it("omits linkedBugs and bugId when neither present", () => {
    const fm = buildFinalizeFrontmatter(BASE_SMELT, "Phase-60");
    expect(fm).not.toContain("linkedBugs");
    expect(fm).not.toContain("bugId");
  });

  it("emits bugId and linkedBugs: [bugId] when bugId present but no linked-bugs answer", () => {
    const smelt = { ...BASE_SMELT, bugId: "RMG-0035" };
    const fm = buildFinalizeFrontmatter(smelt, "Phase-60");
    expect(fm).toContain("bugId: RMG-0035");
    expect(fm).toContain("linkedBugs: [RMG-0035]");
  });

  it("emits both from linked-bugs answer when present", () => {
    const smelt = {
      ...BASE_SMELT,
      bugId: "RMG-0035",
      answers: [{ questionId: "linked-bugs", answer: "RMG-0035, RMG-0041" }],
    };
    const fm = buildFinalizeFrontmatter(smelt, "Phase-60");
    expect(fm).toContain("bugId: RMG-0035");
    expect(fm).toContain("linkedBugs: [RMG-0035, RMG-0041]");
  });

  it("always emits crucibleId, lane, source, phaseId", () => {
    const fm = buildFinalizeFrontmatter({ ...BASE_SMELT, id: "abc" }, "Phase-99");
    expect(fm).toContain("crucibleId: abc");
    expect(fm).toContain("lane: feature");
    expect(fm).toContain("source: human");
    expect(fm).toContain("phaseId: Phase-99");
  });
});
