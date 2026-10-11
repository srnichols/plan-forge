import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClawError } from "../src/errors.mjs";
import { createRunners } from "../src/jobs/runners.mjs";
import { NATIVE_SCOPE_ERRORS } from "../src/jobs/native-command-supervisor.mjs";
import { PUBLICATION_ERRORS } from "../src/protocol/messages.mjs";
import { publicationCalls, runnerFixture } from "./g1-runner-fixture.mjs";

const fixtures = [];

async function fixture(options) {
  const value = await runnerFixture(options);
  fixtures.push(value);
  return value;
}

async function historyMarker(value) {
  return JSON.parse(await readFile(path.join(value.worktree, ".claw-job.json"), "utf8"));
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((value) => value.cleanup()));
});

describe("FRC-01 native publication settlement on every lane", () => {
  it.each(["status", "commit", "push", "fixture-gh"])(
    "retains local history and blocks later effects after an unconfirmed %s", async (operation) => {
      const value = await fixture();
      value.config.jobs.pushOnFailure = true;
      const receive = vi.spyOn(value.ctx.l2Receiver, "receive");
      const original = value.ctx.runner;
      let failedIndex;
      value.ctx.runner = async (command, args, options) => {
        const completed = await original(command, args, options);
        if ((operation === "fixture-gh" && command === operation)
          || (command === "git" && args.includes(operation) && !args.includes("worktree"))) {
          failedIndex ??= value.calls.length - 1;
          return { ...completed, settlementConfirmed: false, error: new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED) };
        }
        return completed;
      };
      const completed = await createRunners(value.ctx).runJob(value.job);
      expect(completed).toMatchObject({
        status: "failed", error: PUBLICATION_ERRORS.DENIED, settlementConfirmed: false,
      });
      expect(failedIndex).toBeTypeOf("number");
      expect(value.calls.slice(failedIndex + 1)).toEqual([]);
      expect(receive).not.toHaveBeenCalled();
      expect(await historyMarker(value)).toMatchObject({ l2Pending: true });
      expect((await historyMarker(value)).applicationAck).toBeUndefined();
      expect(value.calls.some(({ args }) => args.includes("remove"))).toBe(false);
    },
  );
});

describe("FRC-02 physically unconfirmed execution is not finalizable history", () => {
  it.each([false, true])("retains a source after MCP closure failure without losing an earlier failure=%s", async (failed) => {
    const value = await fixture();
    value.config.jobs.pushOnFailure = true;
    const receive = vi.spyOn(value.ctx.l2Receiver, "receive");
    const execute = value.ctx.runtime.run.getMockImplementation();
    value.ctx.runtime.run.mockImplementation(async (input) => {
      const completed = await execute(input);
      if (failed) throw new ClawError("RUNTIME_FAILED");
      return completed;
    });
    value.client.close.mockRejectedValue(new Error("inert unconfirmed MCP closure"));
    try {
      const completed = await createRunners(value.ctx).runJob(value.job);
      expect(completed).toMatchObject({
        status: "failed", error: failed ? "RUNTIME_FAILED" : "MCP_CLOSE_FAILED", settlementConfirmed: false,
      });
      expect(publicationCalls(value)).toEqual([]);
      expect(receive).not.toHaveBeenCalled();
      expect(await historyMarker(value)).toMatchObject({ l2Pending: true });
    } finally {
      value.client.close.mockResolvedValue(undefined);
    }
  });

  it.each([
    ["failed", "RUNTIME_FAILED"],
    ["succeeded", NATIVE_SCOPE_ERRORS.UNCONFIRMED],
  ])("never discards a structured runtime's false settlement flag with status %s", async (status, expectedError) => {
    const value = await fixture();
    value.config.jobs.pushOnFailure = true;
    const execute = value.ctx.runtime.run.getMockImplementation();
    const receive = vi.spyOn(value.ctx.l2Receiver, "receive");
    value.ctx.runtime.run.mockImplementation(async (input) => {
      await execute(input);
      return { status, ...(status === "failed" ? { error: "RUNTIME_FAILED" } : {}), settlementConfirmed: false };
    });
    const completed = await createRunners(value.ctx).runJob(value.job);
    expect(completed).toMatchObject({ status: "failed", error: expectedError, settlementConfirmed: false });
    expect(publicationCalls(value)).toEqual([]);
    expect(receive).not.toHaveBeenCalled();
    expect(await historyMarker(value)).toMatchObject({ l2Pending: true });
  });

  it.each([false, true])("retains a native-uncertain source, including cancellation=%s", async (cancelled) => {
    const value = await fixture({ type: "plan" });
    value.config.jobs.pushOnFailure = true;
    const controller = new AbortController();
    const receive = vi.spyOn(value.ctx.l2Receiver, "receive");
    value.ctx.planRunner = async (_command, _args, options) => {
      const runs = path.join(options.cwd, ".forge", "runs", "unconfirmed");
      await mkdir(runs, { recursive: true });
      await writeFile(path.join(runs, "events.log"), "native source not proven stable\n");
      if (cancelled) controller.abort();
      return {
        code: 0, stdout: "", stderr: "", settlementConfirmed: false,
        error: new ClawError(NATIVE_SCOPE_ERRORS.UNCONFIRMED),
      };
    };
    const completed = await createRunners(value.ctx).runJob(value.job, { signal: controller.signal });
    expect(completed).toMatchObject({
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? "JOB_CANCELLED" : NATIVE_SCOPE_ERRORS.UNCONFIRMED,
      settlementConfirmed: false,
    });
    expect(publicationCalls(value)).toEqual([]);
    expect(receive).not.toHaveBeenCalled();
    expect(await historyMarker(value)).toMatchObject({ l2Pending: true });
    expect((await historyMarker(value)).applicationAck).toBeUndefined();
    expect(await readFile(path.join(value.worktree, ".forge", "runs", "unconfirmed", "events.log"), "utf8"))
      .toBe("native source not proven stable\n");
    expect(value.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it("preserves a settled native failure and still applies its canonical history", async () => {
    const value = await fixture({ type: "plan" });
    const receive = vi.spyOn(value.ctx.l2Receiver, "receive");
    value.ctx.planRunner = async (_command, _args, options) => {
      const runs = path.join(options.cwd, ".forge", "runs", "settled-failure");
      await mkdir(runs, { recursive: true });
      await writeFile(path.join(runs, "events.log"), "stable failed native history\n");
      return { code: 23, stdout: "", stderr: "", settlementConfirmed: true };
    };
    const completed = await createRunners(value.ctx).runJob(value.job);
    expect(completed).toMatchObject({ status: "failed", error: "PLAN_RUN_FAILED", exitCode: 23, l2: { ok: true } });
    expect(receive).toHaveBeenCalledOnce();
    expect(await historyMarker(value)).toMatchObject({ l2Pending: false, applicationAck: { ok: true } });
    expect(value.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });

  it("retains history when an optional failure push becomes physically unconfirmed", async () => {
    const value = await fixture();
    value.config.jobs.pushOnFailure = true;
    value.ctx.runtime.run.mockRejectedValue(new ClawError("RUNTIME_FAILED"));
    const receive = vi.spyOn(value.ctx.l2Receiver, "receive");
    const original = value.ctx.runner;
    value.ctx.runner = async (command, args, options) => {
      const completed = await original(command, args, options);
      return args.includes("push") ? { ...completed, settlementConfirmed: false } : completed;
    };
    const completed = await createRunners(value.ctx).runJob(value.job);
    expect(completed).toMatchObject({ status: "failed", error: "RUNTIME_FAILED", settlementConfirmed: false });
    expect(receive).not.toHaveBeenCalled();
    expect(await historyMarker(value)).toMatchObject({ l2Pending: true });
  });
});

describe("FRC-03 publication failures and physical settlement are separate", () => {
  it("confirms a fully settled failed publication without changing its failed outcome", async () => {
    const value = await fixture();
    const confirmSettled = vi.fn();
    value.ctx.withPublication = async (_authority, operation) => operation({
      signal: new AbortController().signal, confirmSettled,
    });
    const original = value.ctx.runner;
    value.ctx.runner = async (command, args, options) => {
      const completed = await original(command, args, options);
      return args.includes("push") ? { ...completed, code: 7 } : completed;
    };
    const completed = await createRunners(value.ctx).runJob(value.job);
    expect(completed).toMatchObject({ status: "failed", error: "PUBLISH_FAILED" });
    expect(confirmSettled).toHaveBeenCalledOnce();
    expect(value.calls.some(({ command }) => command === "fixture-gh")).toBe(false);
    expect(value.calls.some(({ args }) => args.includes("remove"))).toBe(false);
  });
});
