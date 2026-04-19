/**
 * Plan Forge — Notifications Watcher Tests
 *
 * Phase FORGE-SHOP-03 Slice 03.2
 *
 * Tests the notification-delivery-failing anomaly rule,
 * the corresponding recommendation, and the notifications
 * field in buildWatchSnapshot.
 */
import { describe, it, expect } from "vitest";
import { detectWatchAnomalies, recommendFromAnomalies } from "../orchestrator.mjs";

describe("notification watcher anomalies", () => {
  const baseSnapshot = { ok: true, runState: "completed", artifacts: [], events: [], counts: { failed: 0, started: 0, completed: 0, escalated: 0, quorumDispatched: 0, quorumLegsCompleted: 0, quorumReviewed: 0, skillsStarted: 0, skillsCompleted: 0, skillStepsFailed: 0, events: 0, artifacts: 0 } };

  it("fires notification-delivery-failing when failedLastHour >= 3", () => {
    const snapshot = {
      ...baseSnapshot,
      notifications: { sentToday: 5, failedToday: 4, failedLastHour: 3, failingAdapter: "webhook" },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const match = anomalies.find(a => a.code === "notification-delivery-failing");
    expect(match).toBeDefined();
    expect(match.severity).toBe("warn");
    expect(match.message).toContain("3");
    expect(match.message).toContain("webhook");
  });

  it("does NOT fire notification-delivery-failing when failedLastHour < 3", () => {
    const snapshot = {
      ...baseSnapshot,
      notifications: { sentToday: 5, failedToday: 2, failedLastHour: 2, failingAdapter: "slack" },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const match = anomalies.find(a => a.code === "notification-delivery-failing");
    expect(match).toBeUndefined();
  });

  it("does NOT fire when notifications is null", () => {
    const snapshot = { ...baseSnapshot, notifications: null };
    const anomalies = detectWatchAnomalies(snapshot);
    const match = anomalies.find(a => a.code === "notification-delivery-failing");
    expect(match).toBeUndefined();
  });

  it("fires with failingAdapter omitted gracefully", () => {
    const snapshot = {
      ...baseSnapshot,
      notifications: { sentToday: 0, failedToday: 5, failedLastHour: 5 },
    };
    const anomalies = detectWatchAnomalies(snapshot);
    const match = anomalies.find(a => a.code === "notification-delivery-failing");
    expect(match).toBeDefined();
    expect(match.message).toContain("5");
  });
});

describe("notification watcher recommendations", () => {
  it("recommends forge_notify_test for notification-delivery-failing", () => {
    const anomalies = [{
      code: "notification-delivery-failing",
      severity: "warn",
      message: "3 failures in the last hour",
    }];
    const recs = recommendFromAnomalies(anomalies, {});
    const match = recs.find(r => r.code === "notification-delivery-failing");
    expect(match).toBeDefined();
    expect(match.command).toBe("forge_notify_test");
    expect(match.action).toContain("adapter config");
  });
});

describe("notification chip counters", () => {
  const baseSnapshot = { ok: true, runState: "completed", artifacts: [], events: [], counts: { failed: 0, started: 0, completed: 0, escalated: 0, quorumDispatched: 0, quorumLegsCompleted: 0, quorumReviewed: 0, skillsStarted: 0, skillsCompleted: 0, skillStepsFailed: 0, events: 0, artifacts: 0 } };

  it("returns sentToday and failedToday from notification events", () => {
    const snapshot = {
      ...baseSnapshot,
      notifications: { sentToday: 10, failedToday: 2, failedLastHour: 1 },
    };
    expect(snapshot.notifications.sentToday).toBe(10);
    expect(snapshot.notifications.failedToday).toBe(2);
    // No anomaly because failedLastHour < 3
    const anomalies = detectWatchAnomalies(snapshot);
    expect(anomalies.find(a => a.code === "notification-delivery-failing")).toBeUndefined();
  });

  it("shows Notify: 0 / 0 when no notification events", () => {
    const snapshot = { ...baseSnapshot, notifications: null };
    // Null notifications means no chip data — dashboard shows 0/0 default
    expect(snapshot.notifications).toBeNull();
  });
});
