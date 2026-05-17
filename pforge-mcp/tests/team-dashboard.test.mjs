import { describe, expect, it, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { recordActivity } from "../team-activity.mjs";
import {
  aggregateTeamActivity,
  buildTeamDashboard,
  detectConflictRisk,
} from "../dashboard/team-dashboard.mjs";

const tempRoots = [];

function makeStoreDir() {
  const root = join(tmpdir(), `pforge-team-dash-${process.pid}-${Date.now()}-${randomUUID()}`);
  const storeDir = join(root, ".forge");
  tempRoots.push(root);
  return storeDir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// ─── aggregateTeamActivity ──────────────────────────────────────────────────

describe("aggregateTeamActivity", () => {
  it("returns [] for empty activity", () => {
    expect(aggregateTeamActivity([])).toEqual([]);
  });

  it("groups runs by operator", () => {
    const activities = [
      { operator: "Alice <a@x.com>", timestamp: "2026-05-17T20:00:00Z", status: "completed", cost_usd: 0.5, plan: "plan-a" },
      { operator: "Bob <b@x.com>",   timestamp: "2026-05-17T19:00:00Z", status: "completed", cost_usd: 0.3, plan: "plan-b" },
      { operator: "Alice <a@x.com>", timestamp: "2026-05-17T21:00:00Z", status: "failed",    cost_usd: 0.1, plan: "plan-c" },
    ];
    const result = aggregateTeamActivity(activities);
    expect(result.length).toBe(2);
    const alice = result.find((op) => op.operator === "Alice <a@x.com>");
    expect(alice.runs_total).toBe(2);
    expect(alice.runs_completed).toBe(1);
    expect(alice.runs_failed).toBe(1);
    expect(alice.total_cost_usd).toBe(0.6);
    expect(alice.last_active).toBe("2026-05-17T21:00:00Z");
  });

  it("sorts operators by last_active descending", () => {
    const activities = [
      { operator: "Bob",   timestamp: "2026-05-17T19:00:00Z", status: "completed" },
      { operator: "Alice", timestamp: "2026-05-17T21:00:00Z", status: "completed" },
    ];
    const result = aggregateTeamActivity(activities);
    expect(result[0].operator).toBe("Alice");
    expect(result[1].operator).toBe("Bob");
  });

  it("caps recent_plans at 3 entries per operator", () => {
    const activities = ["p1", "p2", "p3", "p4"].map((plan, i) => ({
      operator: "Alice",
      timestamp: `2026-05-17T${String(20 + i).padStart(2,"0")}:00:00Z`,
      status: "completed",
      plan,
    }));
    const [alice] = aggregateTeamActivity(activities);
    expect(alice.recent_plans.length).toBeLessThanOrEqual(3);
  });

  it("handles missing operator field gracefully", () => {
    const activities = [
      { timestamp: "2026-05-17T20:00:00Z", status: "completed" },
    ];
    const [entry] = aggregateTeamActivity(activities);
    expect(entry.operator).toBe("unknown");
  });
});

// ─── detectConflictRisk ─────────────────────────────────────────────────────

describe("detectConflictRisk", () => {
  function makeOp(hoursAgo) {
    return {
      operator: `op-${hoursAgo}`,
      last_active: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(),
    };
  }

  it("returns none when no operators", () => {
    expect(detectConflictRisk([]).level).toBe("none");
  });

  it("returns low for single recent operator", () => {
    expect(detectConflictRisk([makeOp(1)]).level).toBe("low");
  });

  it("returns medium for 2 recent operators", () => {
    expect(detectConflictRisk([makeOp(1), makeOp(2)]).level).toBe("medium");
  });

  it("returns high for 3+ recent operators", () => {
    expect(detectConflictRisk([makeOp(1), makeOp(2), makeOp(3)]).level).toBe("high");
  });

  it("ignores operators inactive for more than 8 h", () => {
    const result = detectConflictRisk([makeOp(9), makeOp(10)]);
    expect(result.active_count).toBe(0);
    expect(result.level).toBe("none");
  });
});

// ─── buildTeamDashboard ─────────────────────────────────────────────────────

describe("buildTeamDashboard", () => {
  it("returns ok:true and empty operators when no activity file", () => {
    const storeDir = makeStoreDir();
    const result = buildTeamDashboard({ storeDir });
    expect(result.ok).toBe(true);
    expect(result.operators).toEqual([]);
    expect(result.conflict_risk.level).toBe("none");
    expect(result.summary.total_runs_today).toBe(0);
    expect(result.message).toContain("No team activity");
  });

  it("aggregates multi-operator activity correctly", () => {
    const storeDir = makeStoreDir();
    const ts = new Date().toISOString();

    recordActivity({ runId: "r1", plan: "plan-a", status: "completed", operator: "Alice <a@x.com>", timestamp: ts, cost_usd: 1.0 }, { storeDir });
    recordActivity({ runId: "r2", plan: "plan-b", status: "failed",    operator: "Bob <b@x.com>",   timestamp: ts, cost_usd: 0.5 }, { storeDir });

    const result = buildTeamDashboard({ storeDir });
    expect(result.ok).toBe(true);
    expect(result.operators.length).toBe(2);
    expect(result.summary.total_runs_today).toBe(2);
    expect(result.summary.total_cost_usd).toBe(1.5);
    expect(result.summary.success_rate).toBe(50);
    expect(result.conflict_risk.active_count).toBe(2);
    expect(result.conflict_risk.level).toBe("medium");
  });

  it("summary.success_rate is null when no today runs", () => {
    const storeDir = makeStoreDir();
    const old = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
    recordActivity({ runId: "r1", plan: "plan-a", status: "completed", operator: "Alice", timestamp: old }, { storeDir });

    const result = buildTeamDashboard({ storeDir });
    expect(result.summary.success_rate).toBeNull();
    expect(result.summary.total_runs_today).toBe(0);
  });

  it("message mentions developer count when operators exist", () => {
    const storeDir = makeStoreDir();
    const ts = new Date().toISOString();
    recordActivity({ runId: "r1", plan: "plan-x", status: "completed", operator: "Dev One", timestamp: ts }, { storeDir });
    const result = buildTeamDashboard({ storeDir });
    expect(result.message).toContain("1 developer");
  });
});

