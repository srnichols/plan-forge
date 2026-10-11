import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRunners } from "../src/jobs/runners.mjs";
import { runnerFixture } from "./g1-runner-fixture.mjs";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({ ...await original(), spawn }));
const fixtures = [];
const NOW = "2026-10-10T18:30:00.000Z";
const TRACE_ID = "0123456789abcdef0123456789abcdef";
const PLAN = path.join("docs", "plans", "Phase-1-PLAN.md");

function nativeEvent(type, data, ts = new Date().toISOString()) {
  return { ts, type, data, source: null, security_risk: null };
}

function nativeWatch(events, overrides = {}) {
  return {
    ok: true, mode: "polling", durationMs: 1000,
    capturedEvents: events.length, droppedEvents: 0, maxCapturedEvents: 100,
    capturedAnomalies: 0, eventProjection: "verbose", events,
    ...overrides,
  };
}

function nativeStarted(worktree, overrides = {}) {
  const startedAt = new Date().toISOString();
  return nativeEvent("run-started", {
    plan: path.join(worktree, PLAN), traceId: TRACE_ID, startTime: startedAt,
    model: "configured-work-model", mode: "auto", quorumMode: "power", quorumPreset: "power",
    sliceCount: 4, executionOrder: ["1", "2", "3", "4"],
    quorum: { enabled: true, auto: false, threshold: 5 },
    ...overrides,
  }, startedAt);
}

async function planRun(watchFor, {
  cacheWatch = true, withSignal = true, fields = { quorum: "power", resumeFrom: 4 },
} = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  const fixture = await runnerFixture({
    type: "plan", changes: false, fields,
  });
  fixtures.push(fixture);
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => { queueMicrotask(() => child.emit("close", null)); return true; });
  spawn.mockReturnValue(child);
  let watchResponse;
  fixture.client.call.mockImplementation(async (tool) => {
    if (tool !== "forge_watch_live") return null;
    if (cacheWatch) watchResponse ??= watchFor(fixture);
    else watchResponse = watchFor(fixture);
    return watchResponse;
  });
  const updates = [];
  const controller = new AbortController();
  const pending = createRunners(fixture.ctx).runJob(fixture.job, {
    emit: (type, data) => updates.push({ type, data }),
    ...(withSignal ? { signal: controller.signal } : {}),
  });
  await vi.waitFor(() => expect(fixture.client.call.mock.calls.some(([tool]) => tool === "forge_watch_live")).toBe(true));
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
  return {
    fixture, child, controller, updates, pending,
    async finish(code = 0) {
      child.emit("close", code);
      return pending;
    },
  };
}

afterEach(async () => {
  spawn.mockReset();
  vi.useRealTimers();
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe("native foreground plan progress adapter", () => {
  it("requests full native event payloads on the isolated workspace without changing execution choices", async () => {
    const run = await planRun((fixture) => nativeWatch([
      nativeStarted(fixture.worktree),
      nativeEvent("slice-started", { sliceId: "4", title: "Approved resumed slice", complexityScore: 1 }),
      nativeEvent("slice-completed", { sliceId: "4", status: "passed", duration: 1000, attempts: 1 }),
    ]));
    try {
      const request = run.fixture.client.call.mock.calls.find(([tool]) => tool === "forge_watch_live");
      expect(request[1]).toEqual({
        targetPath: run.fixture.worktree, durationMs: 1000, pollIntervalMs: 500, maxCapturedEvents: 100, verbose: true,
      });
      expect(request[2].signal).toBeInstanceOf(AbortSignal);
      expect(spawn.mock.calls[0][1]).toEqual([
        "run-plan", PLAN, "--foreground", "--quorum=power", "--resume-from", "4",
      ]);
      expect(spawn.mock.calls[0][2].env.G1_JOB_VALUE).toBe("job-owned-canary");
    } finally {
      expect((await run.finish()).status).toBe("succeeded");
    }
  });

  it("normalizes actual passed slice facts to measured progress, not the resumed slice ordinal", async () => {
    const run = await planRun((fixture) => nativeWatch([
      nativeStarted(fixture.worktree),
      nativeEvent("slice-started", { sliceId: "4", title: "Approved resumed slice", complexityScore: 1 }),
      nativeEvent("slice-completed", { sliceId: "4", status: "passed", duration: 1000, attempts: 1 }),
    ]));
    try {
      expect(run.updates.filter(({ type, data }) => type === "progress" && Number.isFinite(data.percent)))
        .toEqual([{
          type: "progress",
          data: {
            percent: 25, completedSlices: 1, totalSlices: 4, traceId: TRACE_ID,
            basis: "reported-passed-slices",
          },
        }]);
      expect(run.updates.find(({ type }) => type === "slice")).toEqual({
        type: "slice",
        data: { index: 4, total: 4, sliceId: "4", status: "passed", traceId: TRACE_ID },
      });
    } finally {
      expect((await run.finish()).status).toBe("succeeded");
    }
  });

  it("does not turn stdout JSON percentages or unsupported idle reports into typed progress", async () => {
    const run = await planRun(() => ({ state: "idle", active: false, events: [], progress: 0 }));
    try {
      run.child.stdout.emit("data", Buffer.from('{"progress":0.99,"percent":99}\n'));
    } finally {
      expect((await run.finish()).status).toBe("succeeded");
    }
    expect(run.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    expect(run.updates.some(({ data }) => data.code === "PLAN_PROGRESS_UNAVAILABLE")).toBe(true);
  });

  it("cancels pending watcher polling and refuses late numeric updates before finishing teardown", async () => {
    const watch = Promise.withResolvers();
    const run = await planRun(() => watch.promise);
    run.controller.abort();
    expect((await run.pending).status).toBe("cancelled");
    watch.resolve(nativeWatch([nativeStarted(run.fixture.worktree), passedSlice("1")]));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(run.child.kill).toHaveBeenCalledOnce();
    expect(run.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    const abortRequest = run.fixture.client.call.mock.calls.find(([tool]) => tool === "forge_abort");
    expect(abortRequest[1]).toEqual({ path: run.fixture.worktree });
    expect(run.fixture.calls.some(({ args }) => args.includes("push") || args.includes("remove"))).toBe(false);
  });
});

async function loggedWatch(fixture) {
  const eventsPath = path.join(fixture.worktree, ".forge", "runs", "fast-native-run", "events.log");
  if (!existsSync(eventsPath)) return nativeWatch([]);
  let text;
  try {
    text = await readFile(eventsPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return nativeWatch([]);
    throw error;
  }
  const events = text.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const match = /^\[([^\]]+)\]\s+([a-z-]+):\s*(.*)$/.exec(line);
    return nativeEvent(match[2], JSON.parse(match[3]), match[1]);
  });
  return nativeWatch(events);
}

function fastPlanRun(watchFor, options = {}) {
  return planRun(watchFor, { cacheWatch: false, fields: { quorum: "power" }, ...options });
}

async function writeFastNativeCompletion(fixture) {
  const planPath = path.join(fixture.worktree, PLAN);
  await writeFile(planPath, "# Native fixture plan\n\n### Slice 1: Actual fixture slice\n");
  const declared = [...(await readFile(planPath, "utf8")).matchAll(/^### Slice ([\d.]+[A-Za-z]?):/gm)]
    .map((match) => match[1]);
  expect(declared).toEqual(["1"]);
  const started = nativeStarted(fixture.worktree, { sliceCount: declared.length, executionOrder: declared });
  const events = [
    started,
    nativeEvent("slice-started", { sliceId: "1", title: "Actual fixture slice" }),
    passedSlice("1"),
    nativeEvent("run-completed", {
      plan: started.data.plan, startTime: started.data.startTime, endTime: new Date().toISOString(),
      sliceCount: 1, status: "completed", results: { passed: 1, failed: 0, skipped: 0, total: 1 },
    }),
  ];
  const eventsPath = path.join(fixture.worktree, ".forge", "runs", "fast-native-run", "events.log");
  await mkdir(path.dirname(eventsPath), { recursive: true });
  await writeFile(eventsPath, events.map(({ ts, type, data }) => `[${ts}] ${type}: ${JSON.stringify(data)}\n`).join(""));
}

describe("fast native foreground completion measurement", () => {
  it("drains actual completed run evidence when the child exits between an empty poll and the next poll", async () => {
    const run = await fastPlanRun(loggedWatch);
    await vi.waitFor(() => expect(run.updates.some(({ data }) => data.code === "PLAN_PROGRESS_UNAVAILABLE")).toBe(true));
    expect(run.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    await writeFastNativeCompletion(run.fixture);
    expect((await run.finish()).status).toBe("succeeded");
    expect(run.updates.filter(({ type, data }) => type === "progress" && Number.isFinite(data.percent)))
      .toEqual([{
        type: "progress",
        data: { percent: 100, completedSlices: 1, totalSlices: 1, traceId: TRACE_ID, basis: "reported-passed-slices" },
      }]);
    const requests = run.fixture.client.call.mock.calls.filter(([tool]) => tool === "forge_watch_live");
    expect(requests).toHaveLength(2);
    expect(requests[1][1]).toEqual(requests[0][1]);
    expect(requests[1][1].targetPath).toBe(run.fixture.worktree);
    expect(run.updates.find(({ type }) => type === "slice").data).toMatchObject({
      index: 1, total: 1, sliceId: "1", status: "passed",
    });
  });

  it("keeps a failed final read unknown rather than fabricating 100 percent or failing a successful child", async () => {
    let reads = 0;
    const run = await fastPlanRun(() => {
      if (reads++ === 0) return nativeWatch([]);
      throw new Error("private native-read failure");
    });
    expect((await run.finish()).status).toBe("succeeded");
    expect(run.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    expect(JSON.stringify(run.updates)).not.toContain("private native-read failure");
    expect(run.updates.some(({ data }) => data.code === "PLAN_PROGRESS_UNAVAILABLE")).toBe(true);
  });

  it("bounds a hung final read and refuses any later measurement", async () => {
    const final = Promise.withResolvers();
    let reads = 0;
    const run = await fastPlanRun(() => reads++ === 0 ? nativeWatch([]) : final.promise);
    const finishing = run.finish();
    await vi.waitFor(() => expect(reads).toBe(2));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await finishing).status).toBe("succeeded");
    final.resolve(nativeWatch([nativeStarted(run.fixture.worktree), passedSlice("1")]));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(run.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    expect(run.updates.some(({ data }) => data.code === "PLAN_PROGRESS_UNAVAILABLE")).toBe(true);
  });

  it("does not publish or emit late measured progress when cancellation interrupts the final read", async () => {
    const final = Promise.withResolvers();
    let reads = 0;
    const run = await fastPlanRun(() => reads++ === 0 ? nativeWatch([]) : final.promise);
    await writeFastNativeCompletion(run.fixture);
    const finishing = run.finish();
    await vi.waitFor(() => expect(reads).toBe(2));
    run.controller.abort();
    expect((await finishing).status).toBe("cancelled");
    final.resolve(await loggedWatch(run.fixture));
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(run.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    expect(run.fixture.calls.some(({ args }) => args.includes("push") || args.includes("remove"))).toBe(false);
    expect(JSON.parse(await readFile(path.join(run.fixture.worktree, ".claw-job.json"), "utf8")).l2Pending).toBe(true);
  });

  it("deduplicates final replay against measurements already emitted by the active poll", async () => {
    const run = await planRun((fixture) => nativeWatch([
      nativeStarted(fixture.worktree), passedSlice("4"),
    ]));
    expect((await run.finish()).status).toBe("succeeded");
    expect(run.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([25]);
    expect(run.updates.filter(({ type }) => type === "slice")).toHaveLength(1);
  });

  it("takes a final scoped measurement without requiring a caller-supplied signal", async () => {
    const run = await fastPlanRun(loggedWatch, { withSignal: false });
    await writeFastNativeCompletion(run.fixture);
    expect((await run.finish()).status).toBe("succeeded");
    expect(run.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([100]);
  });

  it("does not take a success-only final measurement for a nonzero foreground exit", async () => {
    const run = await fastPlanRun(() => nativeWatch([]));
    expect(await run.finish(23)).toMatchObject({ status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23 });
    expect(run.fixture.client.call.mock.calls.filter(([tool]) => tool === "forge_watch_live")).toHaveLength(1);
    expect(run.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    expect(run.fixture.calls.some(({ args }) => args.includes("push") || args.includes("remove"))).toBe(false);
  });
});

async function progressTracker(overrides = {}) {
  const { createPlanProgress } = await import("../src/jobs/plan-progress.mjs");
  return createPlanProgress({
    worktree: path.resolve("tests", ".g1-fixtures", "progress-policy"),
    relativePlan: PLAN, startedAt: new Date(NOW).getTime(), ...overrides,
  });
}

function passedSlice(sliceId, overrides = {}) {
  return nativeEvent("slice-completed", { sliceId, status: "passed", ...overrides });
}

describe("native plan progress policy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  it("keeps replayed completed slice IDs distinct and percentages monotonic across polls", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const first = tracker.consume(nativeWatch([nativeStarted(root), passedSlice("2")]));
    const second = tracker.consume(nativeWatch([nativeStarted(root), passedSlice("2"), passedSlice("1")]));
    const third = tracker.consume(nativeWatch([nativeStarted(root), passedSlice("2"), passedSlice("1")]));
    expect(first.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([25]);
    expect(second.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([50]);
    expect(third.updates).toEqual([]);
    expect(first.updates.find(({ type }) => type === "slice").data.index).toBe(2);
  });

  it("keeps missing measured counts null after a real run start instead of inventing zero", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const result = tracker.consume(nativeWatch([
      nativeStarted(root),
      nativeEvent("slice-started", { sliceId: "1", title: "Still executing" }),
    ]));
    expect(result.updates).toEqual([{
      type: "progress", data: {
        percent: null, completedSlices: null, totalSlices: 4, traceId: TRACE_ID,
        basis: "reported-passed-slices",
      },
    }]);
  });

  it.each([
    null,
    { ok: false, error: "private connection detail", events: [] },
    { isError: true, content: [{ type: "text", text: '{"ok":true,"percent":100}' }] },
    nativeWatch([], { eventProjection: "lite" }),
    nativeWatch([], { events: 1 }),
    nativeWatch([], { capturedEvents: -1 }),
    nativeWatch([], { capturedEvents: 1 }),
    nativeWatch([], { droppedEvents: 1 }),
    { state: "idle", active: false, progress: 0, events: [] },
    { content: [{ type: "text", text: "Hints\n{\"ok\":true,\"events\":[]}" }] },
  ])("does not turn missing/lite/malformed/dropped response %j into a measurement", async (report) => {
    const result = (await progressTracker()).consume(report);
    expect(result.updates).toEqual([]);
    expect(result.reason).toMatch(/^PLAN_PROGRESS_[A-Z_]+$/);
    expect(JSON.stringify(result)).not.toContain("private connection detail");
  });

  it("normalizes the actual MCP JSON envelope and hub timestamp fields", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const report = nativeWatch([nativeStarted(root), passedSlice("1")], { mode: "websocket" });
    report.events = report.events.map(({ ts, ...event }) => ({ ...event, timestamp: ts, version: "1.0", source: "file-watcher" }));
    const result = tracker.consume({ content: [{ type: "text", text: JSON.stringify(report) }] });
    expect(result.updates.at(-1).data.percent).toBe(25);
  });

  it.each([
    { sliceCount: undefined },
    { executionOrder: undefined },
    { sliceCount: 0, executionOrder: [] },
    { executionOrder: ["1", "1", "3", "4"] },
    { sliceCount: 3, executionOrder: ["1", "2", "3", "4"] },
    { sliceCount: "4" },
    { executionOrder: ["private/run-token", "2", "3", "4"] },
  ])("requires reported coherent run counts/order %j before counting slices", async (fields) => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const result = tracker.consume(nativeWatch([nativeStarted(root, fields), passedSlice("1")]));
    expect(result.updates).toEqual([]);
    expect(result.reason).toBeTruthy();
  });

  it("rejects historical and foreign-plan starts, even with the same plan basename", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const stale = nativeStarted(root, { startTime: "2026-10-09T18:30:00.000Z" });
    stale.ts = stale.data.startTime;
    expect(tracker.consume(nativeWatch([stale, passedSlice("1")])).updates).toEqual([]);
    const foreign = nativeStarted(path.join(root, "different-checkout"));
    expect(tracker.consume(nativeWatch([foreign, passedSlice("1")])).updates).toEqual([]);
  });

  it("finds the current matching run after older hub history without combining their outcomes", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const oldTime = "2026-10-09T18:30:00.000Z";
    const old = nativeStarted(root, { startTime: oldTime, traceId: "ffffffffffffffffffffffffffffffff" });
    old.ts = oldTime;
    const staleSlice = nativeEvent("slice-completed", { sliceId: "1", status: "passed" }, oldTime);
    const result = tracker.consume(nativeWatch([old, staleSlice, nativeStarted(root), passedSlice("2")]));
    expect(result.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([25]);
    expect(result.updates.filter(({ type }) => type === "slice").map(({ data }) => data.sliceId)).toEqual(["2"]);
  });

  it("does not mix an overlapping foreign run or undeclared outcome into the matching run", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    tracker.consume(nativeWatch([nativeStarted(root), passedSlice("1")]));
    const foreign = nativeStarted(path.join(root, "foreign"));
    expect(tracker.consume(nativeWatch([foreign, passedSlice("2")])).updates).toEqual([]);
    expect(tracker.consume(nativeWatch([nativeStarted(root), passedSlice("not-declared")])).updates).toEqual([]);
    const wrongTrace = tracker.consume(nativeWatch([nativeStarted(root), passedSlice("2", {
      traceId: "ffffffffffffffffffffffffffffffff",
    })]));
    expect(wrongTrace.updates).toEqual([]);
  });

  it("refuses to replace the active same-plan trace with another run's identity", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    tracker.consume(nativeWatch([nativeStarted(root), passedSlice("1")]));
    const result = tracker.consume(nativeWatch([
      nativeStarted(root, { traceId: "ffffffffffffffffffffffffffffffff" }), passedSlice("2"),
    ]));
    expect(result.updates).toEqual([]);
    expect(result.reason).toBe("PLAN_PROGRESS_SCOPE_MISMATCH");
  });

  it("does not call a slice-started or failed outcome completed or infer percentage from its ID", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const result = tracker.consume(nativeWatch([
      nativeStarted(root),
      nativeEvent("slice-started", { sliceId: "4" }),
      nativeEvent("slice-failed", { sliceId: "4", status: "failed", error: "private failed details" }),
    ]));
    expect(result.updates.some(({ type }) => type === "slice")).toBe(false);
    expect(result.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private failed details");
  });

  it("uses only an exact matching terminal summary's actually reported passed count", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const started = nativeStarted(root);
    const summary = nativeEvent("run-completed", {
      plan: started.data.plan, startTime: started.data.startTime, endTime: NOW,
      sliceCount: 4, status: "failed", results: { passed: 1, failed: 1, skipped: 0, total: 2 },
    });
    const result = tracker.consume(nativeWatch([started, passedSlice("1"), summary]));
    expect(result.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([25]);
    expect(result.updates.some(({ data }) => data.percent === 100 || data.status === "succeeded")).toBe(false);
    const zero = await progressTracker();
    const zeroResult = zero.consume(nativeWatch([started, { ...summary, data: {
      ...summary.data, results: { passed: 0, failed: 1, skipped: 0, total: 1 },
    } }]));
    expect(zeroResult.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([0]);
  });

  it("reports 100 percent only from actually reported full passed completion", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const started = nativeStarted(root);
    const result = tracker.consume(nativeWatch([started, nativeEvent("run-completed", {
      plan: started.data.plan, startTime: NOW, endTime: NOW, sliceCount: 4, status: "completed",
      results: { passed: 4, failed: 0, skipped: 0, total: 4 },
    })]));
    expect(result.updates.at(-1).data.percent).toBe(100);
    expect(result.updates.at(-1).data.completedSlices).toBe(4);
  });

  it("rejects terminal success shape without measured counts and contradictory summaries", async () => {
    const tracker = await progressTracker();
    const root = path.resolve("tests", ".g1-fixtures", "progress-policy");
    const started = nativeStarted(root);
    const summary = {
      plan: started.data.plan, startTime: NOW, endTime: NOW, sliceCount: 4, status: "completed",
    };
    const first = tracker.consume(nativeWatch([started, nativeEvent("run-completed", summary)]));
    expect(first.updates.some(({ data }) => Number.isFinite(data.percent))).toBe(false);
    const second = tracker.consume(nativeWatch([
      started, passedSlice("1"), nativeEvent("run-completed", {
        ...summary, results: { passed: 0, failed: 0, skipped: 0, total: 0 },
      }),
    ]));
    expect(second.updates.filter(({ data }) => Number.isFinite(data.percent)).map(({ data }) => data.percent)).toEqual([25]);
  });
});
