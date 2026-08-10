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

  // ─── Issue #245: prose answers produced malformed YAML ─────────────
  // The answer was split on commas and joined into a flow sequence, so a prose
  // reply emitted linkedBugs: [free text with colons and #241 ...]. Inside a
  // flow sequence an unquoted ' #' opens a comment and ': ' is ambiguous.
  describe("prose answers (issue #245)", () => {
    const withAnswer = (answer) => buildFinalizeFrontmatter({ ...BASE_SMELT, answers: [{ questionId: "linked-bugs", answer }] }, "Phase-60");

    it("drops prose that cannot be a bug id", () => {
      const fm = withAnswer("No tempering bug IDs are linked — this originates from research, not a defect. Context: #241 is the parent.");
      expect(fm).not.toContain("linkedBugs");
    });

    it("keeps real ids and drops the prose around them", () => {
      const fm = withAnswer("Mostly research, but RMG-0035 is related; see also RMG-0041 for context.");
      expect(fm).toContain("linkedBugs: [RMG-0035, RMG-0041]");
    });

    it("never emits a YAML comment marker or bare colon inside the sequence", () => {
      const fm = withAnswer("see: #241 and #243, plus RMG-0035");
      const line = fm.split("\n").find((l) => l.startsWith("linkedBugs:")) || "";
      expect(line).not.toMatch(/\s#/);
      expect(line.slice("linkedBugs:".length)).not.toMatch(/: /);
      expect(line).toContain("RMG-0035");
    });
  });

  it("always emits crucibleId, lane, source, phaseId", () => {
    const fm = buildFinalizeFrontmatter({ ...BASE_SMELT, id: "abc" }, "Phase-99");
    expect(fm).toContain("crucibleId: abc");
    expect(fm).toContain("lane: feature");
    expect(fm).toContain("source: human");
    expect(fm).toContain("phaseId: Phase-99");
  });
});
