import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createE2EWorkerServer } from "../helpers/e2e-worker.mjs";
import {
  createExecutionHome, createExecutionProbe, createExecutionTimers,
} from "../helpers/execution-evidence.mjs";
import { createScriptedCopilot } from "../helpers/scripted-copilot.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const homes = [];
let server;

afterEach(async () => {
  await server?.stop();
  server = null;
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

describe("execution-E2E harness regressions", () => {
  it("runs the pre-barrier hook and cancels held external execution without a timeout", async () => {
    const entered = Promise.withResolvers();
    const script = createScriptedCopilot({
      beforeRun: () => entered.resolve(),
      onRun: () => { throw new Error("aborted external execution must not continue"); },
    });
    const jobId = "held-job";
    script.hold(jobId);
    const controller = new AbortController();
    const running = script.runtime.run({
      cwd: path.join(PACKAGE_ROOT, "fixture-project", jobId), signal: controller.signal,
    });
    await entered.promise;
    expect(script.activeJobs.has(jobId)).toBe(true);
    controller.abort();
    expect(await running).toMatchObject({ status: "cancelled" });
    expect(script.activeJobs.size).toBe(0);
    script.releaseAll();
  });

  it("measures actual overlapping external runs and records project-specific execution windows", async () => {
    const script = createScriptedCopilot();
    const probe = createExecutionProbe(script.runtime);
    for (const jobId of ["job-one", "job-two"]) script.hold(jobId);
    const first = probe.runtime.run({ cwd: path.join(PACKAGE_ROOT, "fixture-one", "job-one") });
    const second = probe.runtime.run({ cwd: path.join(PACKAGE_ROOT, "fixture-two", "job-two") });
    await Promise.all([probe.entered("job-one"), probe.entered("job-two")]);
    expect(probe.peakActive).toBe(2);
    expect([...probe.projectPeaks]).toEqual([["fixture-one", 1], ["fixture-two", 1]]);
    script.releaseAll();
    await Promise.all([first, second]);
    expect(probe.active.size).toBe(0);
    expect(probe.windows.every((window) => window.leftOrder > window.enteredOrder)).toBe(true);
  });

  it("advances injected worker-heartbeat timers deterministically and removes cancelled callbacks", async () => {
    const timers = createExecutionTimers();
    const calls = [];
    timers.setTimeoutFn(() => calls.push("second"), 2);
    timers.setTimeoutFn(() => calls.push("first"), 1);
    const cancelled = timers.setTimeoutFn(() => calls.push("cancelled"), 1);
    timers.clearTimeoutFn(cancelled);
    await timers.advance(1);
    expect(calls).toEqual(["first"]);
    await timers.advance(1);
    expect(calls).toEqual(["first", "second"]);
  });

  it("enrolls through the real refreshable secret resolver without putting the worker secret on the wire", async () => {
    const home = await createExecutionHome("enrollment");
    homes.push(home);
    server = await createE2EWorkerServer({ home, lanes: ["fixture-lane"] });
    const worker = await server.startWorker({
      id: "fixture-worker", laneId: "fixture-lane", workerHome: path.join(home, "worker"),
      capabilities: {
        os: process.platform, arch: process.arch, macos: process.platform === "darwin",
        toolchains: ["node"], projects: [],
      },
      config: { lanes: [{ id: "fixture-lane", kind: "local", maxHeavy: 1 }] },
      runtimeFactory: ({ id }) => ({ id, async run() { return { status: "succeeded" }; } }),
    });
    expect(server.registry.current(worker.workerId)).toBeTruthy();
    expect(worker.secretAppearsInPackets()).toBe(false);
    await worker.crashWorker();
    expect(server.registry.current(worker.workerId)).toBeFalsy();
  });
});

describe("Guard: execution-E2E fixtures never default to a system temporary directory", () => {
  it("preserves configured homes and passes authenticated lane identity to the real MCP manager", async () => {
    const worker = await readFile(path.join(PACKAGE_ROOT, "tests", "helpers", "e2e-worker.mjs"), "utf8");
    expect(worker).not.toMatch(/homeLane:\s*["']local["']/);
    const manager = worker.match(/createProjectClients\(\{([\s\S]*?)\}\)/)?.[1];
    expect(manager).toContain("currentLaneId: laneId");
    expect(manager).toContain("directory: ctx.lanes");
  });

  it("keeps both rig and repository fixture defaults inside the package-owned execution workspace", async () => {
    for (const name of ["e2e-rig.mjs", "fixture-repos.mjs"]) {
      const source = await readFile(path.join(PACKAGE_ROOT, "tests", "helpers", name), "utf8");
      expect(source.includes("os.tmpdir()"), `${name} must not use a system temporary directory`).toBe(false);
      expect(source.includes("createExecutionHome"), `${name} must use the execution fixture home`).toBe(true);
    }
  });
});
