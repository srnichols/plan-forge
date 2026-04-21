/**
 * Plan Forge — Phase-28.3 Slice 1: Meta-bug resolver + class schema tests.
 *
 * Covers:
 *   - resolveSelfRepairRepo fallback (default)
 *   - resolveSelfRepairRepo with valid config
 *   - resolveSelfRepairRepo with malformed input
 *   - resolveSelfRepairRepo with empty/missing config
 *   - META_BUG_CLASSES canonical values
 *   - SELF_REPAIR_LABELS values
 */

import { describe, it, expect } from "vitest";

import {
  resolveSelfRepairRepo,
  META_BUG_CLASSES,
  SELF_REPAIR_LABELS,
} from "../tempering/bug-adapters/github.mjs";

// ─── resolveSelfRepairRepo ────────────────────────────────────────────

describe("resolveSelfRepairRepo", () => {
  const FALLBACK = { owner: "srnichols", repo: "plan-forge" };

  it("returns default fallback when config is undefined", () => {
    expect(resolveSelfRepairRepo(undefined)).toEqual(FALLBACK);
  });

  it("returns default fallback when config is null", () => {
    expect(resolveSelfRepairRepo(null)).toEqual(FALLBACK);
  });

  it("returns default fallback when config is empty object", () => {
    expect(resolveSelfRepairRepo({})).toEqual(FALLBACK);
  });

  it("returns default fallback when meta key is missing", () => {
    expect(resolveSelfRepairRepo({ meta: {} })).toEqual(FALLBACK);
  });

  it("returns default fallback when selfRepairRepo is empty string", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "" } })).toEqual(FALLBACK);
  });

  it("returns default fallback when selfRepairRepo is non-string", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: 42 } })).toEqual(FALLBACK);
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: true } })).toEqual(FALLBACK);
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: null } })).toEqual(FALLBACK);
  });

  it("returns default fallback when selfRepairRepo has no slash (malformed)", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "foo" } })).toEqual(FALLBACK);
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "noslash" } })).toEqual(FALLBACK);
  });

  it("returns default fallback when selfRepairRepo has empty segments", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "/repo" } })).toEqual(FALLBACK);
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "owner/" } })).toEqual(FALLBACK);
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "/" } })).toEqual(FALLBACK);
  });

  it("returns default fallback when selfRepairRepo has too many segments", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "a/b/c" } })).toEqual(FALLBACK);
  });

  it("parses valid owner/repo from config", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "a/b" } })).toEqual({
      owner: "a",
      repo: "b",
    });
  });

  it("parses valid owner/repo with realistic names", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "myteam/plan-forge-fork" } })).toEqual({
      owner: "myteam",
      repo: "plan-forge-fork",
    });
  });

  it("trims whitespace from selfRepairRepo", () => {
    expect(resolveSelfRepairRepo({ meta: { selfRepairRepo: "  a/b  " } })).toEqual({
      owner: "a",
      repo: "b",
    });
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = resolveSelfRepairRepo(undefined);
    const b = resolveSelfRepairRepo(undefined);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// ─── META_BUG_CLASSES ─────────────────────────────────────────────────

describe("META_BUG_CLASSES", () => {
  it("contains exactly the 3 canonical meta-bug classes", () => {
    expect(META_BUG_CLASSES).toEqual(["plan-defect", "orchestrator-defect", "prompt-defect"]);
  });

  it("has length 3", () => {
    expect(META_BUG_CLASSES).toHaveLength(3);
  });
});

// ─── SELF_REPAIR_LABELS ───────────────────────────────────────────────

describe("SELF_REPAIR_LABELS", () => {
  it("contains the expected labels", () => {
    expect(SELF_REPAIR_LABELS).toEqual(["self-repair", "plan-forge-internal"]);
  });

  it("has length 2", () => {
    expect(SELF_REPAIR_LABELS).toHaveLength(2);
  });
});
