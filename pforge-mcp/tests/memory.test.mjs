/**
 * Plan Forge — Memory module unit tests
 *
 * Covers the watcher → L2/L3 memory helpers added in v2.35.1 (G3.1):
 *   - shapeWatcherAnomalyThought
 *   - dedupeWatcherAnomalies
 *
 * Pure-function tests — no fs, no network, no MCP plumbing.
 */

import { describe, it, expect } from "vitest";
import {
  shapeWatcherAnomalyThought,
  dedupeWatcherAnomalies,
} from "../memory.mjs";

// ─── shapeWatcherAnomalyThought ──────────────────────────────────────

describe("shapeWatcherAnomalyThought (G3.1)", () => {
  it("maps error severity to 'gotcha' type", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "error", code: "slice-failed", message: "2 slices failed" },
      { targetPath: "/x", runId: "r1", runState: "completed" },
    );
    expect(out.type).toBe("gotcha");
  });

  it("maps warn severity to 'gotcha' type", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "warn", code: "stalled", message: "stale for 6min" },
      { targetPath: "/x", runId: "r1" },
    );
    expect(out.type).toBe("gotcha");
  });

  it("maps info severity to 'lesson' type", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "info", code: "all-skipped", message: "no-op re-run" },
      { targetPath: "/x", runId: "r1" },
    );
    expect(out.type).toBe("lesson");
  });

  it("uses 'forge_watch/<code>' source attribution by default (GX.4 convention)", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "error", code: "slice-failed", message: "x" },
      { targetPath: "/x", runId: "r1" },
    );
    expect(out.source).toBe("forge_watch/slice-failed");
  });

  it("uses 'forge_watch_live/<code>' when tool argument is forge_watch_live", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "warn", code: "high-retries", message: "3 attempts" },
      { targetPath: "/x", runId: "r1" },
      "forge_watch_live",
    );
    expect(out.source).toBe("forge_watch_live/high-retries");
  });

  it("prefixes content with 'Watcher anomaly' for forge_watch", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "error", code: "slice-failed", message: "2 failed" },
      { targetPath: "/x", runId: "r1", runState: "completed" },
    );
    expect(out.content).toMatch(/^Watcher anomaly \[slice-failed\]: 2 failed/);
  });

  it("prefixes content with 'Live watcher anomaly' for forge_watch_live", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "warn", code: "stalled", message: "stale" },
      { targetPath: "/x", runId: "r1" },
      "forge_watch_live",
    );
    expect(out.content).toMatch(/^Live watcher anomaly \[stalled\]: stale/);
  });

  it("includes targetPath, runId, and runState in content when all provided", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "error", code: "slice-failed", message: "x" },
      { targetPath: "/foo/bar", runId: "20260418-abc", runState: "completed" },
    );
    expect(out.content).toContain("targetPath=/foo/bar");
    expect(out.content).toContain("runId=20260418-abc");
    expect(out.content).toContain("state=completed");
  });

  it("substitutes 'n/a' for missing runId", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "warn", code: "x", message: "y" },
      { targetPath: "/p" },
    );
    expect(out.content).toContain("runId=n/a");
  });

  it("omits runState segment when not provided", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "warn", code: "x", message: "y" },
      { targetPath: "/p", runId: "r" },
    );
    expect(out.content).not.toContain("state=");
  });

  it("omits targetPath segment when not provided", () => {
    const out = shapeWatcherAnomalyThought(
      { severity: "warn", code: "x", message: "y" },
      {},
    );
    expect(out.content).not.toContain("targetPath=");
  });
});

// ─── dedupeWatcherAnomalies ──────────────────────────────────────────

describe("dedupeWatcherAnomalies (G3.1)", () => {
  it("returns [] for non-array input", () => {
    expect(dedupeWatcherAnomalies(null)).toEqual([]);
    expect(dedupeWatcherAnomalies(undefined)).toEqual([]);
    expect(dedupeWatcherAnomalies("foo")).toEqual([]);
  });

  it("preserves unique anomalies in first-seen order", () => {
    const input = [
      { code: "a", message: "m1", severity: "warn" },
      { code: "b", message: "m2", severity: "error" },
      { code: "c", message: "m3", severity: "info" },
    ];
    const out = dedupeWatcherAnomalies(input);
    expect(out).toHaveLength(3);
    expect(out.map((a) => a.code)).toEqual(["a", "b", "c"]);
  });

  it("deduplicates on code+message pair", () => {
    const input = [
      { code: "stalled", message: "6min", severity: "warn" },
      { code: "stalled", message: "6min", severity: "warn" },
      { code: "stalled", message: "6min", severity: "warn" },
    ];
    expect(dedupeWatcherAnomalies(input)).toHaveLength(1);
  });

  it("keeps anomalies with same code but different messages", () => {
    const input = [
      { code: "stalled", message: "5min", severity: "warn" },
      { code: "stalled", message: "10min", severity: "warn" },
    ];
    expect(dedupeWatcherAnomalies(input)).toHaveLength(2);
  });

  it("skips entries without a code", () => {
    const input = [
      { message: "no code here" },
      { code: "x", message: "good", severity: "warn" },
      null,
      undefined,
    ];
    expect(dedupeWatcherAnomalies(input)).toHaveLength(1);
  });

  it("handles missing message by treating it as empty string", () => {
    const input = [
      { code: "x", severity: "warn" },
      { code: "x", severity: "warn" },
    ];
    expect(dedupeWatcherAnomalies(input)).toHaveLength(1);
  });
});
