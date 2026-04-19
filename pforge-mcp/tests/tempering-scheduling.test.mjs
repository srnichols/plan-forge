/**
 * Plan Forge — TEMPER-05 Slice 05.2: Scheduling decision helper tests.
 *
 * ~15 assertions covering the shouldRunMutation decision matrix,
 * isCriticalPathTouched glob matching, and isNightlyWindow.
 */

import { describe, it, expect } from "vitest";
import {
  shouldRunMutation,
  isCriticalPathTouched,
  isNightlyWindow,
} from "../tempering/scheduling.mjs";

// ─── shouldRunMutation ───────────────────────────────────────────────

describe("shouldRunMutation — decision matrix", () => {
  it("returns run:true with reason 'explicit-full' when fullMutation is set", () => {
    const result = shouldRunMutation({
      config: { scanners: { mutation: { fullMutation: true } } },
      trigger: "post-slice",
    });
    expect(result.run).toBe(true);
    expect(result.reason).toBe("explicit-full");
  });

  it("returns run:true with reason 'manual-trigger' for manual trigger", () => {
    const result = shouldRunMutation({ config: {}, trigger: "manual" });
    expect(result.run).toBe(true);
    expect(result.reason).toBe("manual-trigger");
  });

  it("returns run:true with reason 'nightly-trigger' for nightly trigger", () => {
    const result = shouldRunMutation({ config: {}, trigger: "nightly" });
    expect(result.run).toBe(true);
    expect(result.reason).toBe("nightly-trigger");
  });

  it("returns run:true with reason 'critical-path-touched' when touchedFiles match criticalPaths", () => {
    const result = shouldRunMutation({
      config: { scanners: { mutation: { criticalPaths: ["src/core/**"] } } },
      trigger: "post-slice",
      touchedFiles: ["src/core/auth.ts"],
    });
    expect(result.run).toBe(true);
    expect(result.reason).toBe("critical-path-touched");
  });

  it("returns run:false with reason 'non-critical-post-slice' when no critical path touched", () => {
    const result = shouldRunMutation({
      config: { scanners: { mutation: { criticalPaths: ["src/core/**"] } } },
      trigger: "post-slice",
      touchedFiles: ["src/utils/helpers.ts"],
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe("non-critical-post-slice");
  });

  it("returns run:false when trigger is post-slice with empty criticalPaths", () => {
    const result = shouldRunMutation({
      config: { scanners: { mutation: { criticalPaths: [] } } },
      trigger: "post-slice",
      touchedFiles: ["anything.ts"],
    });
    expect(result.run).toBe(false);
    expect(result.reason).toBe("non-critical-post-slice");
  });

  it("returns run:false with reason 'unknown-trigger' for unrecognized trigger", () => {
    const result = shouldRunMutation({ config: {}, trigger: "unknown" });
    expect(result.run).toBe(false);
    expect(result.reason).toBe("unknown-trigger");
  });

  it("fullMutation overrides even post-slice with no critical path", () => {
    const result = shouldRunMutation({
      config: { scanners: { mutation: { fullMutation: true, criticalPaths: [] } } },
      trigger: "post-slice",
      touchedFiles: [],
    });
    expect(result.run).toBe(true);
    expect(result.reason).toBe("explicit-full");
  });

  it("handles null/undefined ctx gracefully", () => {
    const result = shouldRunMutation(null);
    expect(result.run).toBe(true); // defaults to manual trigger
    expect(result.reason).toBe("manual-trigger");
  });
});

// ─── isCriticalPathTouched ───────────────────────────────────────────

describe("isCriticalPathTouched — glob matching", () => {
  it("matches wildcard pattern", () => {
    expect(isCriticalPathTouched(["src/core/auth.ts"], ["src/core/*"])).toBe(true);
  });

  it("matches globstar pattern", () => {
    expect(isCriticalPathTouched(["src/deep/nested/file.js"], ["src/**"])).toBe(true);
  });

  it("returns false when no files match", () => {
    expect(isCriticalPathTouched(["tests/foo.test.ts"], ["src/core/**"])).toBe(false);
  });

  it("returns false with empty touchedFiles", () => {
    expect(isCriticalPathTouched([], ["src/**"])).toBe(false);
  });

  it("returns false with empty criticalPaths", () => {
    expect(isCriticalPathTouched(["src/foo.ts"], [])).toBe(false);
  });

  it("handles malformed glob gracefully (no throw)", () => {
    // An unusual pattern — should not crash
    expect(isCriticalPathTouched(["src/foo.ts"], [""])).toBe(false);
  });
});

// ─── isNightlyWindow ────────────────────────────────────────────────

describe("isNightlyWindow", () => {
  it("returns true for nightly trigger", () => {
    expect(isNightlyWindow("nightly", {})).toBe(true);
  });

  it("returns false for post-slice trigger", () => {
    expect(isNightlyWindow("post-slice", {})).toBe(false);
  });

  it("returns false for manual trigger", () => {
    expect(isNightlyWindow("manual", {})).toBe(false);
  });
});
