/**
 * #307 — SDK-vs-spawn cost-parity benchmark (scripts/benchmark/sdk-parity.mjs).
 * Real runs spend AI credits; these tests cover planning and summarising.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PATHS, planRuns, readUsage, renderSummary, summarize } from "../../scripts/benchmark/sdk-parity.mjs";

const REPO = resolve(import.meta.dirname, "..", "..");

describe("planRuns", () => {
  it("runs every task on both paths, alternating which goes first", () => {
    const runs = planRuns([{ id: "a" }, { id: "b" }], 2);
    expect(runs.map((r) => `${r.task.id}${r.repeat}:${r.path}`)).toEqual([
      "a1:spawn", "a1:sdk", "a2:sdk", "a2:spawn",
      "b1:sdk", "b1:spawn", "b2:spawn", "b2:sdk",
    ]);
    for (const path of PATHS) expect(runs.filter((r) => r.path === path)).toHaveLength(4);
  });
});

describe("readUsage", () => {
  it("reads either path's token fields, with zeros for gaps", () => {
    expect(readUsage({ tokens_in: 10, tokens_out: 2, cache_read_tokens: 4, model: "m" })).toEqual({ tokensIn: 10, cached: 4, tokensOut: 2, premiumRequests: null, model: "m" });
    expect(readUsage({ tokens_in: 10, cached: 3 }).cached).toBe(3);
    expect(readUsage(undefined)).toMatchObject({ tokensIn: 0, cached: 0, tokensOut: 0 });
  });
});

describe("summarize", () => {
  const rec = (path, costUsd, extra = {}) => ({ path, passed: true, fellBack: false, tokensIn: 100, cached: 50, tokensOut: 10, costUsd, wallMs: 1000, ...extra });

  it("totals each path and reports the SDK's delta against spawn", () => {
    const s = summarize([rec("spawn", 0.01), rec("sdk", 0.009), rec("spawn", 0.01), rec("sdk", 0.0095, { passed: false })]);
    expect(s.byPath.spawn).toMatchObject({ runs: 2, passed: 2, costUsd: 0.02 });
    expect(s.byPath.sdk).toMatchObject({ runs: 2, passed: 1 });
    expect(s.costDeltaPct).toBe(-7.5);
    expect(s.tokensInDeltaPct).toBe(0);
  });

  it("withholds deltas when the paths ran a different number of tasks", () => {
    expect(summarize([rec("spawn", 0.01), rec("sdk", 0.01), rec("spawn", 0.01)]).costDeltaPct).toBeNull();
  });

  it("renders a table, flags SDK runs that fell back to spawn, and notes an early stop", () => {
    const records = [rec("spawn", 0.01), rec("sdk", 0.012, { fellBack: true })];
    const md = renderSummary({ model: "gpt-6-luna", summary: summarize(records), records, stoppedAtUsd: 0.022 });
    expect(md).toContain("| spawn | 1 | 1/1 |");
    expect(md).toContain("cost +20%");
    expect(md).toContain("1 SDK run(s) fell back to spawn");
    expect(md).toContain("Stopped early");
  });
});

describe("tasks.json", () => {
  it("every task has an id, a prompt and a check", () => {
    const { tasks } = JSON.parse(readFileSync(join(REPO, "scripts/benchmark/sdk-parity/tasks.json"), "utf8"));
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    for (const t of tasks) expect(t.id && t.prompt && t.check, JSON.stringify(t)).toBeTruthy();
  });
});
