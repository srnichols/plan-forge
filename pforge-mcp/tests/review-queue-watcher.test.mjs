/**
 * Plan Forge — Phase FORGE-SHOP-02 Slice 02.2: Review queue watcher integration tests.
 *
 * Tests the review-queue-backlog anomaly and its recommendation,
 * plus the reviewQueue field in buildWatchSnapshot.
 */

import { describe, it, expect } from "vitest";
import {
  detectWatchAnomalies,
  recommendFromAnomalies,
} from "../orchestrator.mjs";

function makeBaseSnapshot(overrides = {}) {
  return {
    ok: true,
    targetPath: "/tmp/test-project",
    runId: "run-001",
    runState: "completed",
    lastEventAgeMs: 1000,
    counts: { started: 1, completed: 1, failed: 0, escalated: 0, quorumDispatched: 0, quorumLegsCompleted: 0, quorumReviewed: 0, skillsStarted: 0, skillsCompleted: 0, skillStepsFailed: 0, events: 5, artifacts: 1 },
    artifacts: [{ sliceNumber: 1, status: "passed", tokensOut: 100, duration: 30000, attempts: 1 }],
    summary: null,
    crucible: null,
    tempering: null,
    reviewQueue: null,
    ...overrides,
  };
}

describe("detectWatchAnomalies — review-queue-backlog", () => {
  it("fires anomaly when open > 10", () => {
    const snapshot = makeBaseSnapshot({ reviewQueue: { open: 15, blockerAgeMs: null } });
    const anomalies = detectWatchAnomalies(snapshot);
    const rqAnomaly = anomalies.find(a => a.code === "review-queue-backlog");
    expect(rqAnomaly).toBeTruthy();
    expect(rqAnomaly.severity).toBe("warn");
    expect(rqAnomaly.message).toContain("15 open reviews");
  });

  it("fires anomaly when blocker age > 4h", () => {
    const fiveHoursMs = 5 * 60 * 60 * 1000;
    const snapshot = makeBaseSnapshot({ reviewQueue: { open: 2, blockerAgeMs: fiveHoursMs } });
    const anomalies = detectWatchAnomalies(snapshot);
    const rqAnomaly = anomalies.find(a => a.code === "review-queue-backlog");
    expect(rqAnomaly).toBeTruthy();
    expect(rqAnomaly.message).toContain("Blocker review open for");
  });

  it("does NOT fire when open <= 10 and no stale blockers", () => {
    const snapshot = makeBaseSnapshot({ reviewQueue: { open: 3, blockerAgeMs: 1000 } });
    const anomalies = detectWatchAnomalies(snapshot);
    const rqAnomaly = anomalies.find(a => a.code === "review-queue-backlog");
    expect(rqAnomaly).toBeUndefined();
  });

  it("does NOT fire when reviewQueue is null", () => {
    const snapshot = makeBaseSnapshot({ reviewQueue: null });
    const anomalies = detectWatchAnomalies(snapshot);
    const rqAnomaly = anomalies.find(a => a.code === "review-queue-backlog");
    expect(rqAnomaly).toBeUndefined();
  });
});

describe("recommendFromAnomalies — review-queue-backlog", () => {
  it("maps review-queue-backlog to recommendation", () => {
    const anomalies = [{ severity: "warn", code: "review-queue-backlog", message: "test" }];
    const snapshot = makeBaseSnapshot();
    const recs = recommendFromAnomalies(anomalies, snapshot);
    const rec = recs.find(r => r.code === "review-queue-backlog");
    expect(rec).toBeTruthy();
    expect(rec.action).toContain("Review tab");
  });

  it("anomaly severity is warn", () => {
    const snapshot = makeBaseSnapshot({ reviewQueue: { open: 20, blockerAgeMs: null } });
    const anomalies = detectWatchAnomalies(snapshot);
    const rqAnomaly = anomalies.find(a => a.code === "review-queue-backlog");
    expect(rqAnomaly.severity).toBe("warn");
    expect(rqAnomaly.code).toBe("review-queue-backlog");
  });
});
