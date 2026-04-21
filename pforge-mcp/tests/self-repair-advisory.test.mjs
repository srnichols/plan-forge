/**
 * Tests for detectSelfRepairMissed() — post-slice advisory scanner.
 * Phase-28.3 Slice 4.
 *
 * Covers:
 *   1. Trajectory with markers + no meta-bug call → warning emitted.
 *   2. Trajectory with markers + meta-bug call → no warning.
 *   3. Trajectory with no markers → no warning.
 *   4. Missing/null trajectory → no warning, no crash.
 */

import { describe, it, expect } from "vitest";
import { detectSelfRepairMissed } from "../orchestrator.mjs";

describe("detectSelfRepairMissed", () => {
  // ── Case 1: markers present, no meta-bug call → advisory ──────────
  it("returns matched markers when trajectory has self-repair language and no meta-bug call", () => {
    const trajectory = [
      "I noticed the gate pattern was wrong.",
      "I applied a workaround to fix the failing validation.",
      "The slice now passes after the hand-fix.",
    ].join("\n");

    const result = detectSelfRepairMissed(trajectory, "Slice completed successfully.");
    expect(result).not.toBeNull();
    expect(result.matched).toContain("gate pattern");
    expect(result.matched).toContain("workaround");
    expect(result.matched).toContain("hand-fix");
  });

  it("detects 'fixed the plan' marker", () => {
    const trajectory = "I fixed the plan because the scope was wrong.";
    const result = detectSelfRepairMissed(trajectory, "done");
    expect(result).not.toBeNull();
    expect(result.matched).toContain("fixed the plan");
  });

  it("detects 'plan was wrong' marker (case-insensitive)", () => {
    const trajectory = "The Plan Was Wrong — the gate referenced a deleted file.";
    const result = detectSelfRepairMissed(trajectory, "");
    expect(result).not.toBeNull();
    expect(result.matched).toContain("Plan Was Wrong");
  });

  it("detects 'brittle gate' marker", () => {
    const trajectory = "This brittle gate broke on Windows.";
    const result = detectSelfRepairMissed(trajectory, "output text");
    expect(result).not.toBeNull();
    expect(result.matched).toContain("brittle gate");
  });

  it("detects 'plan forge bug' marker", () => {
    const trajectory = "Found a plan forge bug in the parser.";
    const result = detectSelfRepairMissed(trajectory, "");
    expect(result).not.toBeNull();
    expect(result.matched).toContain("plan forge bug");
  });

  it("detects 'orchestrator bug' marker", () => {
    const trajectory = "This looks like an orchestrator bug.";
    const result = detectSelfRepairMissed(trajectory, "");
    expect(result).not.toBeNull();
    expect(result.matched).toContain("orchestrator bug");
  });

  it("deduplicates matched markers", () => {
    const trajectory = [
      "I used a workaround here.",
      "Another workaround was needed for the second gate.",
      "Yet another workaround for good measure.",
    ].join("\n");

    const result = detectSelfRepairMissed(trajectory, "");
    expect(result).not.toBeNull();
    expect(result.matched).toEqual(["workaround"]);
  });

  // ── Case 2: markers present + meta-bug call → no warning ──────────
  it("returns null when trajectory has markers but worker called forge_meta_bug_file", () => {
    const trajectory = "I applied a workaround to fix the brittle gate.";
    const workerOutput = [
      "Working on the slice...",
      "Calling forge_meta_bug_file to report the gate issue.",
      "Slice complete.",
    ].join("\n");

    const result = detectSelfRepairMissed(trajectory, workerOutput);
    expect(result).toBeNull();
  });

  // ── Case 3: no markers → no warning ───────────────────────────────
  it("returns null when trajectory has no self-repair markers", () => {
    const trajectory = [
      "Implemented the new API endpoint.",
      "Added validation for input parameters.",
      "All tests pass successfully.",
    ].join("\n");

    const result = detectSelfRepairMissed(trajectory, "done");
    expect(result).toBeNull();
  });

  // ── Case 4: missing trajectory → no warning, no crash ─────────────
  it("returns null when trajectory is null", () => {
    const result = detectSelfRepairMissed(null, "some output");
    expect(result).toBeNull();
  });

  it("returns null when trajectory is empty string", () => {
    const result = detectSelfRepairMissed("", "some output");
    expect(result).toBeNull();
  });

  it("returns null when trajectory is undefined", () => {
    const result = detectSelfRepairMissed(undefined, "some output");
    expect(result).toBeNull();
  });

  // ── Edge cases ────────────────────────────────────────────────────
  it("handles null worker output gracefully", () => {
    const trajectory = "Applied a workaround for the failing gate.";
    const result = detectSelfRepairMissed(trajectory, null);
    expect(result).not.toBeNull();
    expect(result.matched).toContain("workaround");
  });

  it("only scans last 200 lines of trajectory", () => {
    // Build a trajectory with a marker on line 1 and 250 clean lines after
    const lines = ["I used a workaround here."];
    for (let i = 0; i < 250; i++) {
      lines.push(`Clean line ${i} — no markers.`);
    }
    const trajectory = lines.join("\n");

    // The marker is outside the last 200 lines
    const result = detectSelfRepairMissed(trajectory, "");
    expect(result).toBeNull();
  });

  it("finds markers within last 200 lines", () => {
    const lines = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`Clean line ${i}`);
    }
    lines.push("Found a plan forge bug in the gate logic.");
    for (let i = 0; i < 50; i++) {
      lines.push(`More clean lines ${i}`);
    }
    const trajectory = lines.join("\n");

    const result = detectSelfRepairMissed(trajectory, "");
    expect(result).not.toBeNull();
    expect(result.matched).toContain("plan forge bug");
  });
});
