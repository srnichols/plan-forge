import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getOperator, loadActivity, recordActivity } from "../team-activity.mjs";

const tempRoots = [];

function makeRoot() {
  const root = join(tmpdir(), `pforge-team-activity-${process.pid}-${Date.now()}-${randomUUID()}`);
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("team activity feed", () => {
  it("recordActivity writes a valid JSONL line to the store", async () => {
    const storeDir = join(makeRoot(), ".forge");
    const activity = recordActivity({
      runId: "run-1",
      plan: "docs/plans/Phase-TEAM-ACTIVITY.md",
      status: "completed",
      sliceCount: 5,
      duration_ms: 45000,
      cost_usd: 0.85,
      operator: "Test Operator <test@example.com>",
      timestamp: "2026-05-17T20:00:00.000Z",
    }, { storeDir });

    const raw = await readFile(join(storeDir, "team-activity.jsonl"), "utf-8");
    const parsed = JSON.parse(raw.trim());
    expect(parsed).toEqual(activity);
    expect(parsed).toMatchObject({
      run_id: "run-1",
      slice_count: 5,
      version: "1.0",
    });
  });

  it("loadActivity returns entries in reverse order", () => {
    const storeDir = join(makeRoot(), ".forge");
    recordActivity({ runId: "run-1", plan: "plan-a", status: "completed", operator: "A", timestamp: "2026-05-17T19:00:00.000Z" }, { storeDir });
    recordActivity({ runId: "run-2", plan: "plan-b", status: "completed", operator: "B", timestamp: "2026-05-17T20:00:00.000Z" }, { storeDir });

    const activities = loadActivity({ storeDir });
    expect(activities.map((a) => a.run_id)).toEqual(["run-2", "run-1"]);
  });

  it("loadActivity limit caps results", () => {
    const storeDir = join(makeRoot(), ".forge");
    recordActivity({ runId: "run-1", plan: "plan-a", status: "completed", operator: "A", timestamp: "2026-05-17T19:00:00.000Z" }, { storeDir });
    recordActivity({ runId: "run-2", plan: "plan-b", status: "completed", operator: "B", timestamp: "2026-05-17T20:00:00.000Z" }, { storeDir });
    recordActivity({ runId: "run-3", plan: "plan-c", status: "completed", operator: "C", timestamp: "2026-05-17T21:00:00.000Z" }, { storeDir });

    const activities = loadActivity({ storeDir, limit: 2 });
    expect(activities.map((a) => a.run_id)).toEqual(["run-3", "run-2"]);
  });

  it("loadActivity since filters correctly", () => {
    const storeDir = join(makeRoot(), ".forge");
    recordActivity({ runId: "run-1", plan: "plan-a", status: "completed", operator: "A", timestamp: "2026-05-17T18:00:00.000Z" }, { storeDir });
    recordActivity({ runId: "run-2", plan: "plan-b", status: "completed", operator: "B", timestamp: "2026-05-17T20:00:00.000Z" }, { storeDir });
    recordActivity({ runId: "run-3", plan: "plan-c", status: "aborted", operator: "C", timestamp: "2026-05-17T22:00:00.000Z" }, { storeDir });

    const activities = loadActivity({ storeDir, since: "2026-05-17T19:30:00.000Z" });
    expect(activities.map((a) => a.run_id)).toEqual(["run-3", "run-2"]);
  });

  it("loadActivity returns [] when file does not exist", () => {
    const storeDir = join(makeRoot(), ".forge");
    expect(loadActivity({ storeDir })).toEqual([]);
  });

  it("recordActivity creates the store directory when missing", async () => {
    const root = makeRoot();
    await mkdir(root, { recursive: true });
    const storeDir = join(root, ".forge");

    expect(existsSync(storeDir)).toBe(false);
    recordActivity({ runId: "run-1", plan: "plan-a", status: "completed", operator: "A" }, { storeDir });
    expect(existsSync(storeDir)).toBe(true);
    expect(existsSync(join(storeDir, "team-activity.jsonl"))).toBe(true);
  });

  it("getOperator returns a string", () => {
    const operator = getOperator(process.cwd());
    expect(typeof operator).toBe("string");
    expect(operator.length).toBeGreaterThan(0);
  });
});
