/**
 * Issue #264 — a worker that never launched was recorded as a validation gate
 * failure, sending diagnosis to entirely the wrong place.
 *
 * The measured run (Rummag Phase 151D slice 5, two orchestrators in separate
 * worktrees) looked like this:
 *
 *   slice-5-log.txt   STDOUT: (empty)
 *                     STDERR: The process cannot access the file
 *                             '...copilotCli\copilot.ps1' because it is being
 *                             used by another process.
 *                             + FullyQualifiedErrorId : CommandNotFoundException
 *
 *   slice-5.json      status:       failed
 *                     gateStatus:   failed
 *                     statusReason: validation gate failed: pnpm --filter
 *                                   @rummag/api exec vitest run ...
 *                     gateError:    No test files found, exiting with code 1
 *
 * Every signal named vitest and a test path. The cause was a Windows file lock
 * on a shared CLI entrypoint.
 *
 * The gap was precise. detectSilentWorkerFailure (Issue #77) covers the
 * exit-ZERO case and returns early on `exitCode !== 0`, so empty stdout with a
 * non-zero exit — a process that never started — fell straight through to the
 * gate, which then truthfully reported the absence of work nobody had done.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectWorkerLaunchFailure, detectSilentWorkerFailure } from "../orchestrator/worker-spawn.mjs";

const LAUNCH_FAILURE = {
  worker: "gh-copilot",
  exitCode: 1,
  output: "",
  stderr: "The process cannot access the file 'copilot.ps1' because it is being used by another process.\n    + FullyQualifiedErrorId : CommandNotFoundException",
};

describe("detectWorkerLaunchFailure (#264)", () => {
  it("fires on empty stdout with a non-zero exit", () => {
    const reason = detectWorkerLaunchFailure(LAUNCH_FAILURE, "auto");
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/never launched/i);
  });

  it("carries the stderr tail, which is where the real cause was", () => {
    const reason = detectWorkerLaunchFailure(LAUNCH_FAILURE, "auto");
    expect(reason).toMatch(/CommandNotFoundException/);
    expect(reason).toMatch(/used by another process/);
  });

  it("says the gate was skipped and why", () => {
    const reason = detectWorkerLaunchFailure(LAUNCH_FAILURE, "auto");
    expect(reason).toMatch(/gate was skipped/i);
    expect(reason).toMatch(/never attempted/i);
  });

  it("does not fire when the worker produced real output", () => {
    expect(detectWorkerLaunchFailure({
      ...LAUNCH_FAILURE,
      output: "x".repeat(200),
    }, "auto")).toBeNull();
  });

  it("does not fire on a clean exit", () => {
    expect(detectWorkerLaunchFailure({ ...LAUNCH_FAILURE, exitCode: 0 }, "auto")).toBeNull();
  });

  it("leaves a timeout to its own path — the worker did run", () => {
    expect(detectWorkerLaunchFailure({ ...LAUNCH_FAILURE, timedOut: true }, "auto")).toBeNull();
  });

  it("leaves a signal kill to its own path — the worker did run", () => {
    // 130 = SIGINT. detectKilledBySignal is the more specific diagnosis.
    expect(detectWorkerLaunchFailure({ ...LAUNCH_FAILURE, exitCode: 130 }, "auto")).toBeNull();
  });

  it("stays out of assisted mode and human workers", () => {
    expect(detectWorkerLaunchFailure(LAUNCH_FAILURE, "assisted")).toBeNull();
    expect(detectWorkerLaunchFailure({ ...LAUNCH_FAILURE, worker: "human" }, "auto")).toBeNull();
  });

  it("tolerates a missing worker result", () => {
    expect(detectWorkerLaunchFailure(null, "auto")).toBeNull();
    expect(detectWorkerLaunchFailure(undefined, "auto")).toBeNull();
  });
});

describe("the two detectors partition the failure space (#264)", () => {
  it("silent-failure still owns the exit-0 case", () => {
    const exitZero = { ...LAUNCH_FAILURE, exitCode: 0 };
    expect(detectSilentWorkerFailure(exitZero, "auto", "5")).toBeTruthy();
    expect(detectWorkerLaunchFailure(exitZero, "auto")).toBeNull();
  });

  it("launch-failure owns the non-zero case", () => {
    expect(detectSilentWorkerFailure(LAUNCH_FAILURE, "auto", "5")).toBeNull();
    expect(detectWorkerLaunchFailure(LAUNCH_FAILURE, "auto")).toBeTruthy();
  });
});

describe("Guard: the orchestrator skips the gate and reports the launch (#264)", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf-8");

  it("does not run the gate when the worker never launched", () => {
    expect(src).toMatch(/const launchFailure = detectWorkerLaunchFailure\(/);
    expect(src).toMatch(/launchFailure\s*\n?\s*\?\s*\{[^}]*skipped: true/);
  });

  it("reports worker-launch-failed ahead of the gate branch", () => {
    const statusFn = src.slice(src.indexOf("function _executeSliceDetermineStatus"));
    const launchIdx = statusFn.indexOf("gateResult.launchFailure");
    const gateIdx = statusFn.indexOf("!gateResult.success");
    expect(launchIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(launchIdx, "gate branch must not shadow the launch branch").toBeLessThan(gateIdx);
    expect(statusFn).toMatch(/worker-launch-failed/);
  });

  it("records gateStatus as skipped, not failed", () => {
    expect(src).toMatch(/gateStatus:\s*gateResult\.launchFailure\s*\?\s*"skipped"/);
  });
});

/**
 * The contention half. A lock on the shared `copilot.ps1` entrypoint is
 * transient by nature, so the reporter asked for a retry with backoff, and
 * #264 was closed on the belief that it "comes for free: a skipped gate leaves
 * gateResult.success false, so the existing retry loop takes another attempt."
 *
 * It does not. `detectWorkerLaunchFailure` only fires when `exitCode !== 0`,
 * and the attempt loop reaches an unconditional
 *
 *     if (workerResult.exitCode !== 0) break;
 *
 * before any retry bookkeeping — so a launch failure always left the loop on
 * attempt 0 and the transient lock was never retried.
 */
describe("Guard: a launch failure is retried with backoff (#264 contention)", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf-8");
  const loop = src.slice(
    src.indexOf("async function _executeSliceAttemptLoop"),
    src.indexOf("async function executeSlice("),
  );

  it("handles the launch failure before the non-zero-exit break", () => {
    const retryIdx = loop.indexOf("if (launchFailure)");
    const breakIdx = loop.indexOf("if (workerResult.exitCode !== 0) break;");
    expect(retryIdx, "no launch-failure retry branch in the attempt loop").toBeGreaterThan(-1);
    expect(breakIdx).toBeGreaterThan(-1);
    expect(
      retryIdx,
      "the non-zero-exit break runs first, so a launch failure can never retry",
    ).toBeLessThan(breakIdx);
  });

  it("backs off before retrying rather than re-colliding immediately", () => {
    expect(loop).toMatch(/await _recordLaunchFailureForRetry\(/);
    const helper = src.slice(
      src.indexOf("async function _recordLaunchFailureForRetry"),
      src.indexOf("function _recordGateFailureForRetry"),
    );
    expect(helper).toMatch(/WORKER_LAUNCH_RETRY_BACKOFF_MS/);
    expect(helper).toMatch(/await new Promise\(\(r\) => setTimeout/);
  });

  it("does not describe a launch failure as a gate-command failure", () => {
    const retryIdx = loop.indexOf("if (launchFailure)");
    expect(retryIdx, "no launch-failure branch to inspect").toBeGreaterThan(-1);
    const branch = loop.slice(retryIdx, retryIdx + 600);
    expect(branch).not.toMatch(/Gate command/);
  });
});
