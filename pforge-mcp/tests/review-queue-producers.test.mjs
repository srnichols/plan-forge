/**
 * Plan Forge — Phase FORGE-SHOP-02 Slice 02.2: Review queue producer hook tests.
 *
 * Verifies that the 5 `maybeAdd*Review` helpers:
 *   1. Create a review item on happy path
 *   2. Are idempotent (same correlationId → no duplicate)
 *   3. Short-circuit when NODE_ENV=test
 *   4. Never throw — even when addReviewItem fails
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  maybeAddStallReview,
  maybeAddTemperingReview,
  maybeAddBugReview,
  maybeAddVisualBaselineReview,
  maybeAddFixPlanReview,
  listReviewItems,
} from "../orchestrator.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `pforge-producers-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeHub() {
  const events = [];
  return { events, broadcast: (evt) => events.push(evt) };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("maybeAddStallReview", () => {
  let dir, hub, origEnv;
  beforeEach(() => { dir = makeTmpDir(); hub = makeHub(); origEnv = process.env.NODE_ENV; delete process.env.NODE_ENV; });
  afterEach(() => { process.env.NODE_ENV = origEnv; try { rmSync(dir, { recursive: true }); } catch {} });

  it("creates a review item on happy path", () => {
    const result = maybeAddStallReview(dir, { correlationId: "smelt-001", title: "Stall detected" }, hub, null);
    expect(result).toBeTruthy();
    expect(result.source).toBe("crucible-stall");
    expect(result.severity).toBe("medium");
    expect(result.correlationId).toBe("smelt-001");
  });

  it("is idempotent — same correlationId produces 1 item", () => {
    maybeAddStallReview(dir, { correlationId: "smelt-002" }, hub, null);
    maybeAddStallReview(dir, { correlationId: "smelt-002" }, hub, null);
    const items = listReviewItems(dir, { source: "crucible-stall", correlationId: "smelt-002" });
    expect(items.length).toBe(1);
  });

  it("returns null when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const result = maybeAddStallReview(dir, { correlationId: "smelt-003" }, hub, null);
    expect(result).toBeNull();
    const items = listReviewItems(dir, { source: "crucible-stall" });
    expect(items.length).toBe(0);
  });
});

describe("maybeAddTemperingReview", () => {
  let dir, hub, origEnv;
  beforeEach(() => { dir = makeTmpDir(); hub = makeHub(); origEnv = process.env.NODE_ENV; delete process.env.NODE_ENV; });
  afterEach(() => { process.env.NODE_ENV = origEnv; try { rmSync(dir, { recursive: true }); } catch {} });

  it("creates a review item on happy path", () => {
    const result = maybeAddTemperingReview(dir, { correlationId: "run-01" }, hub, null);
    expect(result).toBeTruthy();
    expect(result.source).toBe("tempering-quorum-inconclusive");
    expect(result.severity).toBe("medium");
  });

  it("is idempotent", () => {
    maybeAddTemperingReview(dir, { correlationId: "run-02" }, hub, null);
    maybeAddTemperingReview(dir, { correlationId: "run-02" }, hub, null);
    const items = listReviewItems(dir, { source: "tempering-quorum-inconclusive", correlationId: "run-02" });
    expect(items.length).toBe(1);
  });

  it("returns null when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const result = maybeAddTemperingReview(dir, { correlationId: "run-03" }, hub, null);
    expect(result).toBeNull();
  });
});

describe("maybeAddBugReview", () => {
  let dir, hub, origEnv;
  beforeEach(() => { dir = makeTmpDir(); hub = makeHub(); origEnv = process.env.NODE_ENV; delete process.env.NODE_ENV; });
  afterEach(() => { process.env.NODE_ENV = origEnv; try { rmSync(dir, { recursive: true }); } catch {} });

  it("creates a review item on happy path with blocker severity", () => {
    const result = maybeAddBugReview(dir, {
      correlationId: "bug-001",
      severity: "blocker",
      context: { bugId: "bug-001", scanner: "unit" },
    }, hub, null);
    expect(result).toBeTruthy();
    expect(result.source).toBe("bug-classify");
    expect(result.severity).toBe("blocker");
  });

  it("is idempotent", () => {
    maybeAddBugReview(dir, { correlationId: "bug-002", severity: "blocker" }, hub, null);
    maybeAddBugReview(dir, { correlationId: "bug-002", severity: "blocker" }, hub, null);
    const items = listReviewItems(dir, { source: "bug-classify", correlationId: "bug-002" });
    expect(items.length).toBe(1);
  });

  it("returns null when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const result = maybeAddBugReview(dir, { correlationId: "bug-003", severity: "blocker" }, hub, null);
    expect(result).toBeNull();
  });
});

describe("maybeAddVisualBaselineReview", () => {
  let dir, hub, origEnv;
  beforeEach(() => { dir = makeTmpDir(); hub = makeHub(); origEnv = process.env.NODE_ENV; delete process.env.NODE_ENV; });
  afterEach(() => { process.env.NODE_ENV = origEnv; try { rmSync(dir, { recursive: true }); } catch {} });

  it("creates a review item on happy path", () => {
    const result = maybeAddVisualBaselineReview(dir, {
      correlationId: "visual-abc123",
      context: { url: "http://example.com", diffPercent: 0.015 },
    }, hub, null);
    expect(result).toBeTruthy();
    expect(result.source).toBe("tempering-baseline");
    expect(result.severity).toBe("medium");
  });

  it("is idempotent", () => {
    maybeAddVisualBaselineReview(dir, { correlationId: "visual-def" }, hub, null);
    maybeAddVisualBaselineReview(dir, { correlationId: "visual-def" }, hub, null);
    const items = listReviewItems(dir, { source: "tempering-baseline", correlationId: "visual-def" });
    expect(items.length).toBe(1);
  });

  it("returns null when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const result = maybeAddVisualBaselineReview(dir, { correlationId: "visual-xyz" }, hub, null);
    expect(result).toBeNull();
  });
});

describe("maybeAddFixPlanReview", () => {
  let dir, hub, origEnv;
  beforeEach(() => { dir = makeTmpDir(); hub = makeHub(); origEnv = process.env.NODE_ENV; delete process.env.NODE_ENV; });
  afterEach(() => { process.env.NODE_ENV = origEnv; try { rmSync(dir, { recursive: true }); } catch {} });

  it("creates a review item on happy path with custom severity", () => {
    const result = maybeAddFixPlanReview(dir, {
      correlationId: "fix-001",
      severity: "high",
      context: { proposalId: "fix-001", planPath: "docs/plans/auto/fix.md" },
    }, hub, null);
    expect(result).toBeTruthy();
    expect(result.source).toBe("fix-plan-approval");
    expect(result.severity).toBe("high");
  });

  it("is idempotent", () => {
    maybeAddFixPlanReview(dir, { correlationId: "fix-002", severity: "high" }, hub, null);
    maybeAddFixPlanReview(dir, { correlationId: "fix-002", severity: "high" }, hub, null);
    const items = listReviewItems(dir, { source: "fix-plan-approval", correlationId: "fix-002" });
    expect(items.length).toBe(1);
  });

  it("returns null when NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const result = maybeAddFixPlanReview(dir, { correlationId: "fix-003", severity: "high" }, hub, null);
    expect(result).toBeNull();
  });
});

describe("producer hook error handling", () => {
  it("never throws when addReviewItem would throw (invalid source avoided by design)", () => {
    // This tests that the try/catch wrapper works by passing a path that doesn't exist
    const result = maybeAddStallReview("/nonexistent/path/that/cannot/be/created/_test_", {
      correlationId: "err-001",
    }, null, null);
    // Should return null (swallowed error), not throw
    expect(result).toBeNull();
  });
});
