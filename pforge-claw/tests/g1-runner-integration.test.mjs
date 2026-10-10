import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunners } from "../src/jobs/runners.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { applicationIdentity, matchesApplicationAck } from "../src/protocol/l2-ack.mjs";
import { createL2Receiver } from "../src/protocol/l2-receiver.mjs";
import { createLaneDirectory } from "../src/lanes/directory.mjs";
import { createRemoteLane } from "../src/lanes/remote-lane.mjs";
import { createLocalLane } from "../src/lanes/local-lane.mjs";
import { createWorkerRegistry } from "../src/protocol/worker-registry.mjs";
import { L2_ACK_ERRORS } from "../src/protocol/messages.mjs";
import { buildWorktreeLaunch } from "../src/mcp/project-client.mjs";
import { drain, g1Deferred, publicationCalls, runnerFixture } from "./g1-runner-fixture.mjs";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({ ...await original(), spawn }));
const fixtures = [];
const NATIVE_RUN_ID = "native-run-1";
const NATIVE_ENDED_AT = "2026-10-10T16:00:00.000Z";

async function fixture(options) {
  const created = await runnerFixture(options);
  fixtures.push(created);
  return created;
}

function childProcess({ code = 0, immediate = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => { queueMicrotask(() => child.emit("close", null)); return true; });
  spawn.mockImplementation(() => {
    if (immediate) queueMicrotask(() => child.emit("close", code));
    return child;
  });
  return child;
}

async function nativePlanFixture({ reportFor, hasSummary = true, exitCode = 0, status = "completed" } = {}) {
  const f = await fixture({ type: "plan", changes: false });
  const plan = path.join(f.worktree, "docs", "plans", "Phase-1-PLAN.md");
  const summary = { plan, endTime: NATIVE_ENDED_AT, status, cost: { total_cost_usd: 0.375 } };
  const native = {
    runs: 3, total_cost_usd: 999,
    latest: { date: summary.endTime, plan: summary.plan, status: summary.status, total_cost_usd: 0.375 },
  };
  await mkdir(path.join(f.repo, ".forge"), { recursive: true });
  await writeFile(path.join(f.repo, ".forge", "cost-history.json"), JSON.stringify([
    { date: "2026-10-10T17:00:00.000Z", plan: "other-home-plan", total_cost_usd: 999 },
  ]));
  f.client.call.mockImplementation(async (tool) => tool === "forge_cost_report"
    ? reportFor ? reportFor({ native, summary, f }) : native
    : null);
  const child = childProcess({ immediate: false });
  spawn.mockImplementation(() => {
    void Promise.resolve().then(async () => {
      const runDir = path.join(f.worktree, ".forge", "runs", NATIVE_RUN_ID);
      await mkdir(runDir, { recursive: true });
      await writeFile(path.join(runDir, "run.json"), JSON.stringify({ runId: NATIVE_RUN_ID }));
      if (hasSummary) await writeFile(path.join(runDir, "summary.json"), JSON.stringify(summary));
      child.emit("close", exitCode);
    });
    return child;
  });
  const finished = [];
  f.bus.on("job.finished", (event) => finished.push(event));
  return { ...f, summary, native, finished };
}

afterEach(async () => {
  spawn.mockReset();
  vi.useRealTimers();
  await Promise.all(fixtures.splice(0).map((entry) => entry.cleanup()));
});

describe("G1 runner completion integration", () => {
  it("uses a validated relative plan, foreground, approved quorum/resume and the prepared environment", async () => {
    const f = await fixture({ type: "plan", fields: { quorum: "power", resumeFrom: 4 }, changes: false });
    childProcess();
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.status).toBe("succeeded");
    expect(spawn.mock.calls[0][1]).toEqual([
      "run-plan", path.join("docs", "plans", "Phase-1-PLAN.md"), "--foreground",
      "--quorum=power", "--resume-from", "4",
    ]);
    expect(spawn.mock.calls[0][2]).toMatchObject({ cwd: f.worktree, env: { G1_JOB_VALUE: "job-owned-canary" } });
  });

  it("propagates the real foreground nonzero exit without publishing or cleanup", async () => {
    const f = await fixture({ type: "plan" });
    childProcess({ code: 23 });
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result).toMatchObject({ status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23 });
    expect(publicationCalls(f)).toEqual([]);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it("rejects absolute plan arguments before spawning even when they name an inside file", async () => {
    const f = await fixture({
      type: "plan",
      fields: ({ home }) => ({
        planPath: path.join(home, "worktrees", "project-1", "a1000001", "docs", "plans", "Phase-1-PLAN.md"),
      }),
    });
    childProcess();
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result).toMatchObject({ status: "failed", error: "PLAN_PATH_INVALID" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("passes prepared env to runtime, MCP and every Git/GH edge without global writes or state leakage", async () => {
    const f = await fixture();
    const before = { ...process.env };
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.status).toBe("succeeded");
    expect(f.ctx.runtime.run.mock.calls[0][0].env).toMatchObject({ G1_JOB_VALUE: "job-owned-canary" });
    expect(f.mcpInputs[0].env).toMatchObject({ G1_JOB_VALUE: "job-owned-canary" });
    expect(f.calls.every(({ options }) => options.env?.G1_JOB_VALUE === "job-owned-canary")).toBe(true);
    expect(process.env).toEqual(before);
    const records = [...f.store.read("jobs")].map(({ record }) => record);
    expect(JSON.stringify(records)).not.toContain("job-owned-canary");
    expect(Object.keys(records.at(-1).result).sort()).toEqual(["branch", "prUrl"]);
  });

  it("copies real canonical artifacts and queued records before matching ACK, success and cleanup", async () => {
    const f = await fixture();
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.status).toBe("succeeded");
    expect(await readFile(path.join(f.repo, ".forge", "runs", "job-1", "run.json"), "utf8"))
      .toBe('{"id":"job-1"}\n');
    expect(await readFile(path.join(f.repo, ".forge", "openbrain-queue.jsonl"), "utf8"))
      .toBe('{"id":"queued-1","text":"retained"}\n');
    const identity = applicationIdentity(result.l2);
    expect(matchesApplicationAck(identity, result.l2)).toBe(true);
    expect(result.l2.ok).toBe(true);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(true);
    expect(currentJobs(f.store)[f.job.id].state).toBe("succeeded");
  });

  it("fences publication, success and workspace removal after runtime abort", async () => {
    const f = await fixture();
    f.ctx.config.jobs.pushOnFailure = true;
    const controller = new AbortController();
    const execute = f.ctx.runtime.run.getMockImplementation();
    f.ctx.runtime.run.mockImplementation(async (turn) => {
      const result = await execute(turn);
      controller.abort();
      return result;
    });
    const result = await createRunners(f.ctx).runJob(f.job, { signal: controller.signal });
    expect(result.status).toBe("cancelled");
    expect(currentJobs(f.store)[f.job.id].state).toBe("cancelled");
    expect(publicationCalls(f)).toEqual([]);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
    expect(await readFile(path.join(f.worktree, ".forge", "openbrain-queue.jsonl"), "utf8")).toContain("retained");
  });

  it("awaits outstanding forge_abort settlement even when the child has already closed", async () => {
    const f = await fixture({ type: "plan" });
    const child = childProcess({ immediate: false });
    const abort = g1Deferred();
    f.client.call.mockImplementation((tool) => tool === "forge_abort" ? abort.promise : Promise.resolve(null));
    const controller = new AbortController();
    let settled = false;
    const pending = createRunners(f.ctx).runJob(f.job, { signal: controller.signal })
      .then((result) => { settled = true; return result; });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    controller.abort();
    child.emit("close", 0);
    for (let index = 0; index < 100; index += 1) await Promise.resolve();
    expect(settled).toBe(false);
    abort.resolve({ ok: true });
    expect((await pending).status).toBe("cancelled");
    expect(publicationCalls(f)).toEqual([]);
  });

  it.each(["commit", "push"])("fences all later publication after abort during %s", async (verb) => {
    const f = await fixture();
    f.config.jobs.pushOnFailure = true;
    const controller = new AbortController();
    const original = f.ctx.runner;
    f.ctx.runner = async (command, args, options) => {
      const completed = await original(command, args, options);
      if (command === "git" && args.includes(verb) && !args.includes("worktree")) controller.abort();
      return completed;
    };
    const result = await createRunners(f.ctx).runJob(f.job, { signal: controller.signal });
    expect(result.status).toBe("cancelled");
    const published = publicationCalls(f);
    expect(published.at(-1).args).toContain(verb);
    expect(published.filter(({ args }) => args.includes("push"))).toHaveLength(verb === "push" ? 1 : 0);
    expect(published.some(({ command }) => command === "fixture-gh")).toBe(false);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it("retains undelivered history when real canonical application conflicts", async () => {
    const f = await fixture();
    await mkdir(path.join(f.repo, ".forge", "runs", "job-1"), { recursive: true });
    await writeFile(path.join(f.repo, ".forge", "runs", "job-1", "run.json"), "canonical\n");
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result).toMatchObject({ status: "failed", error: "L2_CONFLICT" });
    expect([...f.store.read("jobs")].map(({ record }) => record.reason)).toContain("l2-sync-incomplete");
    expect(await readFile(path.join(f.repo, ".forge", "runs", "job-1", "run.json"), "utf8")).toBe("canonical\n");
    expect(await readFile(path.join(f.worktree, ".forge", "runs", "job-1", "run.json"), "utf8")).toBe('{"id":"job-1"}\n');
    expect(JSON.parse(await readFile(path.join(f.worktree, ".claw-job.json"), "utf8")).l2Pending).toBe(true);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it.each([true, { ok: true, lastSeq: 9 }])("never accepts transport receipt %j as canonical application", async (receipt) => {
    const f = await fixture();
    const homeLane = "remote-home";
    const config = {
      ...f.config,
      lanes: [...f.config.lanes, { id: homeLane, kind: "remote" }],
      projects: [{ ...f.config.projects[0], homeLane }],
    };
    const registry = createWorkerRegistry({ requireL2: true });
    const directory = createLaneDirectory();
    directory.configure(config.lanes);
    directory.register(createRemoteLane({ id: homeLane, registry }));
    registry.connect("fixture-home-worker", {
      laneId: homeLane, capabilities: { projects: ["project-1"] },
      send(packet) {
        if (packet.t !== "lease") return;
        queueMicrotask(() => registry.onEvent({
          leaseId: packet.leaseId, attempt: packet.attempt, workerId: "fixture-home-worker",
          event: { v: 1, jobId: packet.request.requestId, seq: 1, ts: new Date(0).toISOString(),
            type: "finished", data: { status: "ok", result: receipt } },
        }));
      },
    });
    f.ctx.l2Receiver = createL2Receiver({ config, currentLaneId: "execution-host", directory });
    try {
      const result = await createRunners(f.ctx).runJob(f.job);
      expect(result).toMatchObject({ status: "failed", error: L2_ACK_ERRORS.UNCONFIRMED });
      expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
    } finally {
      registry.close();
    }
  });

  it("defers source release only for the verified worker composition context", async () => {
    const f = await fixture();
    f.ctx.externalHistoryDelivery = true;
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.status).toBe("succeeded");
    expect(result.l2).toBeUndefined();
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
    expect(await readFile(path.join(f.worktree, ".forge", "openbrain-queue.jsonl"), "utf8")).toContain("retained");
  });

  it("ignores job/config/environment attempts to select external history delivery", async () => {
    const f = await fixture({ fields: { externalHistoryDelivery: true } });
    f.config.externalHistoryDelivery = true;
    f.ctx.env.externalHistoryDelivery = "true";
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.l2).toMatchObject({ ok: true, jobId: f.job.id, projectId: "project-1" });
    expect(await readFile(path.join(f.repo, ".forge", "openbrain-queue.jsonl"), "utf8")).toContain("retained");
  });

  it("keeps the approved quorum/resume choices when a submitted copy requests different values", async () => {
    const f = await fixture({ type: "plan", fields: { quorum: "power", resumeFrom: 4 }, changes: false });
    childProcess();
    const result = await createRunners(f.ctx).runJob({ ...f.job, quorum: "speed", resumeFrom: 99 });
    expect(result.status).toBe("succeeded");
    expect(spawn.mock.calls[0][1].slice(-3)).toEqual(["--quorum=power", "--resume-from", "4"]);
  });

  it("honors a genuinely consumed quorum radio choice rather than the original stored default", async () => {
    const f = await fixture({
      type: "plan", fields: { quorum: "auto", resumeFrom: 4 }, approvalQuorum: "power", changes: false,
    });
    childProcess();
    expect((await createRunners(f.ctx).runJob({ ...f.job, quorum: "speed" })).status).toBe("succeeded");
    expect(spawn.mock.calls[0][1].slice(-3)).toEqual(["--quorum=power", "--resume-from", "4"]);
  });

  it("awaits and closes a transport that connects after cancellation before returning", async () => {
    const f = await fixture();
    const connecting = g1Deferred();
    const began = g1Deferred();
    const closing = g1Deferred();
    f.client.close.mockImplementation(() => closing.promise);
    f.ctx.projectClients = null;
    f.ctx.mcp = () => { began.resolve(); return connecting.promise; };
    const controller = new AbortController();
    let settled = false;
    const pending = createRunners(f.ctx).runJob(f.job, { signal: controller.signal })
      .then((value) => { settled = true; return value; });
    await began.promise;
    controller.abort();
    connecting.resolve(f.client);
    for (let index = 0; index < 100; index += 1) await Promise.resolve();
    expect(f.client.close).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    closing.resolve();
    expect((await pending).status).toBe("cancelled");
    expect(f.ctx.runtime.run).not.toHaveBeenCalled();
    expect(publicationCalls(f)).toEqual([]);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it("retains source history when an executing MCP transport cannot confirm closure", async () => {
    const f = await fixture();
    f.client.close.mockRejectedValue(new Error("fixture-close-failure"));
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result).toMatchObject({ status: "failed", error: "MCP_CLOSE_FAILED" });
    expect(publicationCalls(f)).toEqual([]);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
    expect(await readFile(path.join(f.worktree, ".forge", "openbrain-queue.jsonl"), "utf8")).toContain("retained");
    f.client.close.mockResolvedValue(undefined);
  });

  it("passes prepared environment and signal through the existing workspace launch callback", async () => {
    const f = await fixture();
    f.ctx.projectClients = null;
    f.ctx.mcpLaunchForWorktree = vi.fn(({ project, cwd, env }) => buildWorktreeLaunch({
      project, cwd, env, config: f.config, which: async () => true,
    }));
    const controller = new AbortController();
    const result = await createRunners(f.ctx).runJob(f.job, { signal: controller.signal });
    expect(result.status).toBe("succeeded");
    expect(f.ctx.mcpLaunchForWorktree).toHaveBeenCalledOnce();
    expect(f.ctx.mcpLaunchForWorktree.mock.calls[0][0]).toMatchObject({
      project: { id: "project-1" }, cwd: f.worktree,
      env: { G1_JOB_VALUE: "job-owned-canary" }, signal: controller.signal,
    });
    expect(f.ctx.runtime.run.mock.calls[0][0].mcpServers["plan-forge"].env).toMatchObject({
      JOB_VALUE: "job-owned-canary", G1_JOB_VALUE: "job-owned-canary",
    });
  });

  it("closes an acquired workspace client when its launch callback fails", async () => {
    const f = await fixture();
    f.ctx.projectClients = null;
    f.ctx.mcpLaunchForWorktree = async () => { throw Object.assign(new Error("fixture"), { code: "MCP_CONFIG_MISSING" }); };
    expect(await createRunners(f.ctx).runJob(f.job)).toMatchObject({ status: "failed", error: "MCP_CONFIG_MISSING" });
    expect(f.client.close).toHaveBeenCalledOnce();
    expect(f.ctx.runtime.run).not.toHaveBeenCalled();
  });

  it.each(["missing-PLAN.md", "C:outside-PLAN.md", path.join("docs", "plans"),
    path.join("..", "..", "..", "outside-PLAN.md")])("rejects invalid plan argument %s before foreground spawn", async (planPath) => {
    const f = await fixture({ type: "plan", fields: { planPath } });
    childProcess();
    expect(await createRunners(f.ctx).runJob(f.job)).toMatchObject({ status: "failed", error: "PLAN_PATH_INVALID" });
    expect(spawn).not.toHaveBeenCalled();
    expect(publicationCalls(f)).toEqual([]);
  });
});

describe("G1 native plan actuals attribution", () => {
  it("uses the isolated MCP path and exact native summary despite a different concurrent home latest", async () => {
    const f = await nativePlanFixture();
    const result = await createRunners(f.ctx).runJob(f.job);
    const expected = {
      jobId: f.job.id, projectId: "project-1", runId: NATIVE_RUN_ID,
      plan: "Phase-1-PLAN.md", endedAt: NATIVE_ENDED_AT,
      usage: { costUSD: 0.375, premiumRequests: null },
    };
    expect(result.status).toBe("succeeded");
    expect(result.planActuals).toEqual(expected);
    expect(result.planActuals.runId).not.toBe(f.job.id);
    const calls = f.client.call.mock.calls.filter(([tool]) => tool === "forge_cost_report");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ path: f.worktree });
    expect(calls[0][1]).not.toHaveProperty("runId");
    expect(f.mcpInputs[0]).toMatchObject({ cwd: f.worktree, env: { G1_JOB_VALUE: "job-owned-canary" } });
    expect(f.finished).toHaveLength(1);
    expect(f.finished[0].planActuals).toEqual(expected);
    const stored = [...f.store.read("jobs")].map(({ record }) => record);
    expect(Object.keys(stored.at(-1).result)).toEqual([]);
    expect(JSON.stringify(result.planActuals)).not.toContain(f.worktree);
    expect(JSON.stringify(result.planActuals)).not.toContain("job-owned-canary");
  });

  describe("Guard: execution proof depends on the inner policy instead of outer features", () => {
    it.each(["runners.mjs", "plan-process.mjs"])("%s imports the canonical inner proof choices", async (filename) => {
      const source = await readFile(path.resolve("src", "jobs", filename), "utf8");
      expect(source).toContain('"./approval-proof.mjs"');
      expect(source).not.toContain('"../crossproject.mjs"');
      expect(source).not.toContain('"../approvals.mjs"');
    });
  });

  it.each(["plan", "date", "status", "aggregate-only", "malformed"])(
    "reports explicit unknown for native %s mismatch, never aggregate spend",
    async (mismatch) => {
      const f = await nativePlanFixture({
        reportFor({ native, f: current }) {
          if (mismatch === "aggregate-only") return { runs: 3, total_cost_usd: 999 };
          if (mismatch === "malformed") return { runs: "invalid", latest: native.latest };
          const latest = { ...native.latest };
          if (mismatch === "plan") latest.plan = path.join(current.repo, "docs", "plans", "Phase-1-PLAN.md");
          if (mismatch === "date") latest.date = "2026-10-10T17:00:00.000Z";
          if (mismatch === "status") latest.status = "failed";
          return { ...native, latest };
        },
      });
      const result = await createRunners(f.ctx).runJob(f.job);
      expect(result.status).toBe("succeeded");
      expect(result.planActuals).toBeNull();
      expect(result.planActualsError).toMatch(/^[A-Z_]+$/);
      expect(f.finished[0].planActuals).toBeNull();
      expect(f.finished[0].planActualsError).toBe(result.planActualsError);
    },
  );

  it("does not fetch latest when the actual native run summary is missing", async () => {
    const f = await nativePlanFixture({ hasSummary: false });
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.planActuals).toBeNull();
    expect(result.planActualsError).toBeTruthy();
    expect(f.client.call.mock.calls.filter(([tool]) => tool === "forge_cost_report")).toEqual([]);
  });

  it("keeps reported zero distinct from missing premium units", async () => {
    const f = await nativePlanFixture({
      reportFor: ({ native }) => ({ ...native, latest: { ...native.latest, total_cost_usd: 0, premiumRequests: 0 } }),
    });
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.planActuals.usage).toEqual({ costUSD: 0, premiumRequests: 0 });
  });

  it("attributes reported failed-plan spend without publishing, success or source cleanup", async () => {
    const f = await nativePlanFixture({ exitCode: 23, status: "failed" });
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result).toMatchObject({
      status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23,
      planActuals: { jobId: f.job.id, projectId: "project-1", runId: NATIVE_RUN_ID, usage: { costUSD: 0.375 } },
    });
    expect(f.finished[0].planActuals).toEqual(result.planActuals);
    expect(publicationCalls(f)).toEqual([]);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it("retains verified measured spend when later canonical history delivery fails", async () => {
    const f = await nativePlanFixture();
    await mkdir(path.join(f.repo, ".forge", "runs", NATIVE_RUN_ID), { recursive: true });
    await writeFile(path.join(f.repo, ".forge", "runs", NATIVE_RUN_ID, "summary.json"), "different canonical bytes\n");
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.status).toBe("failed");
    expect(result.planActuals).toMatchObject({
      jobId: f.job.id, projectId: "project-1", runId: NATIVE_RUN_ID,
      usage: { costUSD: 0.375, premiumRequests: null },
    });
    expect(f.finished[0].planActuals).toEqual(result.planActuals);
    expect(f.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it("emits only a safe plan basename after exact private-source correlation", async () => {
    const f = await nativePlanFixture();
    const result = await createRunners(f.ctx).runJob(f.job);
    expect(result.planActuals.plan).toBe("Phase-1-PLAN.md");
    expect(result.planActuals.plan).not.toMatch(/[\\/]/);
  });

  it("preserves verified plan actuals in the real local lane terminal before worker delivery", async () => {
    const f = await nativePlanFixture();
    const lane = createLocalLane({
      runtime: { run: (job) => createRunners(f.ctx).runJob(job, { signal: job.signal, emit: job.emit }) },
    });
    const events = await drain(lane.submit(f.job));
    expect(events.at(-1).data.status).toBe("succeeded");
    expect(events.at(-1).data.planActuals).toEqual(f.finished[0].planActuals);
  });

  it.each(["foreign", "nested"])("refuses %s financial facts in a local plan terminal", async (kind) => {
    const actuals = {
      jobId: kind === "foreign" ? "other" : "job-1", projectId: "project-1", runId: NATIVE_RUN_ID,
      plan: "Phase-1-PLAN.md", endedAt: NATIVE_ENDED_AT, usage: { costUSD: 1, premiumRequests: null },
    };
    const lane = createLocalLane({ runtime: { run: async () => ({
      status: "succeeded", ...(kind === "nested" ? { result: { planActuals: actuals } } : { planActuals: actuals }),
    }) } });
    const events = await drain(lane.submit({
      id: "job-1", projectId: "project-1", type: "plan", planPath: path.join("docs", "plans", "Phase-1-PLAN.md"),
    }));
    expect(events.at(-1).data.planActuals).toBeNull();
    expect(events.at(-1).data.planActualsError).toMatch(/^[A-Z_]+$/);
  });

  it("never promotes SDK task financial fields to a plan terminal", async () => {
    const lane = createLocalLane({ runtime: { run: async () => ({ status: "succeeded", planActuals: {
      jobId: "job-1", projectId: "project-1", runId: NATIVE_RUN_ID,
      plan: "Phase-1-PLAN.md", endedAt: NATIVE_ENDED_AT, usage: { costUSD: 1, premiumRequests: null },
    } }) } });
    const events = await drain(lane.submit({ id: "job-1", projectId: "project-1", type: "task" }));
    expect(events.at(-1).data).not.toHaveProperty("planActuals");
  });

  it("normalizes an unreported premium unit without losing reported zero USD in a plan terminal", async () => {
    const lane = createLocalLane({ runtime: { run: async () => ({ status: "succeeded", planActuals: {
      jobId: "job-1", projectId: "project-1", runId: NATIVE_RUN_ID,
      plan: "Phase-1-PLAN.md", endedAt: NATIVE_ENDED_AT, usage: { costUSD: 0 },
    } }) } });
    const events = await drain(lane.submit({
      id: "job-1", projectId: "project-1", type: "plan", planPath: path.join("docs", "plans", "Phase-1-PLAN.md"),
    }));
    expect(events.at(-1).data.planActuals.usage).toEqual({ costUSD: 0, premiumRequests: null });
  });

  it("requires an ISO instant, not a merely parseable calendar label, for financial attribution", async () => {
    const lane = createLocalLane({ runtime: { run: async () => ({ status: "succeeded", planActuals: {
      jobId: "job-1", projectId: "project-1", runId: NATIVE_RUN_ID,
      plan: "Phase-1-PLAN.md", endedAt: "2026", usage: { costUSD: 0.25, premiumRequests: null },
    } }) } });
    const events = await drain(lane.submit({
      id: "job-1", projectId: "project-1", type: "plan", planPath: path.join("docs", "plans", "Phase-1-PLAN.md"),
    }));
    expect(events.at(-1).data.planActuals).toBeNull();
  });
});
