/**
 * Tests for the buildBugFixSkillAdvisory helper in
 * pforge-mcp/server/tool-handlers/tempering.mjs.
 *
 * Verifies the routing table for the four lifecycle stages × scanner /
 * classification matrix surfaces the correct skill hint. The advisory is
 * an ACI sparse field — null returns are first-class (caller spreads
 * conditionally so the response shape stays minimal).
 */

import { describe, it, expect } from "vitest";
import { buildBugFixSkillAdvisory } from "../server/tool-handlers/tempering.mjs";

describe("buildBugFixSkillAdvisory — input guards", () => {
  it("returns null when bug is missing", () => {
    expect(buildBugFixSkillAdvisory({ stage: "registered", bug: null })).toBeNull();
    expect(buildBugFixSkillAdvisory({ stage: "registered", bug: undefined })).toBeNull();
  });

  it("returns null when stage is not a string", () => {
    expect(buildBugFixSkillAdvisory({ stage: 42, bug: {} })).toBeNull();
  });

  it("returns null for unknown stage", () => {
    expect(buildBugFixSkillAdvisory({ stage: "wat", bug: {} })).toBeNull();
  });
});

describe("buildBugFixSkillAdvisory — classification routing", () => {
  it("routes flake bugs to /forge-troubleshoot in pre-fix stages", () => {
    const advisory = buildBugFixSkillAdvisory({
      stage: "registered",
      bug: { classification: "flake", scanner: "unit" },
    });
    expect(advisory).toMatch(/forge-troubleshoot/);
  });

  it("routes flake bugs to /test-sweep after validation passes", () => {
    const advisory = buildBugFixSkillAdvisory({
      stage: "validated-pass",
      bug: { classification: "flake", scanner: "unit" },
    });
    expect(advisory).toMatch(/test-sweep/);
    expect(advisory).toMatch(/stability|flake/i);
  });

  it("routes infra bugs to CI / runner config note", () => {
    const advisory = buildBugFixSkillAdvisory({
      stage: "in-fix",
      bug: { classification: "infra", scanner: "unit" },
    });
    expect(advisory).toMatch(/CI|runner|config/i);
  });
});

describe("buildBugFixSkillAdvisory — real-bug routing by stage", () => {
  const bug = { classification: "real-bug", scanner: "unit" };

  it("suggests /code-review at the registered stage", () => {
    expect(buildBugFixSkillAdvisory({ stage: "registered", bug })).toMatch(/code-review/);
  });

  it("suggests /code-review + TDD at the in-fix stage (default scanner)", () => {
    const a = buildBugFixSkillAdvisory({ stage: "in-fix", bug });
    expect(a).toMatch(/code-review/);
    expect(a).toMatch(/TDD|failing test/i);
  });

  it("suggests /test-sweep on validated-pass", () => {
    expect(buildBugFixSkillAdvisory({ stage: "validated-pass", bug })).toMatch(/test-sweep/);
  });

  it("suggests evidence + /code-review on validated-fail", () => {
    const a = buildBugFixSkillAdvisory({ stage: "validated-fail", bug });
    expect(a).toMatch(/evidence/);
    expect(a).toMatch(/code-review/);
  });
});

describe("buildBugFixSkillAdvisory — scanner-specific routing at in-fix", () => {
  function inFix(scanner) {
    return buildBugFixSkillAdvisory({
      stage: "in-fix",
      bug: { classification: "real-bug", scanner },
    });
  }

  it("routes mutation scanner to /forge-quench", () => {
    expect(inFix("mutation")).toMatch(/forge-quench/);
  });

  it("routes visual-diff scanner to UI/rendering guidance", () => {
    expect(inFix("visual-diff")).toMatch(/UI|visual|rendering/i);
  });

  it("routes ui-playwright scanner to UI/rendering guidance", () => {
    expect(inFix("ui-playwright")).toMatch(/UI|visual|rendering/i);
  });

  it("routes load-stress scanner to performance guidance", () => {
    expect(inFix("load-stress")).toMatch(/performance|profile|hot-path/i);
  });

  it("routes performance-budget scanner to performance guidance", () => {
    expect(inFix("performance-budget")).toMatch(/performance|profile|hot-path/i);
  });

  it("routes contract scanner to consumer-impact guidance", () => {
    expect(inFix("contract")).toMatch(/contract|consumer/i);
  });

  it("routes unknown scanner to default TDD guidance", () => {
    expect(inFix("brand-new-scanner")).toMatch(/code-review/);
    expect(inFix("brand-new-scanner")).toMatch(/TDD|failing test/i);
  });
});

describe("buildBugFixSkillAdvisory — validated-fail mutation handling", () => {
  it("escalates mutation-class still-failing to /forge-quench", () => {
    const a = buildBugFixSkillAdvisory({
      stage: "validated-fail",
      bug: { classification: "real-bug", scanner: "mutation" },
    });
    expect(a).toMatch(/forge-quench/);
    expect(a).toMatch(/mutant|clarif/i);
  });
});

describe("buildBugFixSkillAdvisory — scanner as array", () => {
  it("uses first element when scanner is an array", () => {
    const a = buildBugFixSkillAdvisory({
      stage: "in-fix",
      bug: { classification: "real-bug", scanner: ["mutation", "unit"] },
    });
    expect(a).toMatch(/forge-quench/);
  });
});

describe("buildBugFixSkillAdvisory — missing classification falls back to real-bug", () => {
  it("treats unset classification as real-bug for the advisory", () => {
    const a = buildBugFixSkillAdvisory({
      stage: "in-fix",
      bug: { scanner: "unit" },
    });
    expect(a).toMatch(/code-review/);
  });
});
