/**
 * PostSlice Tempering hook tests (Phase TEMPER-02 Slice 02.2).
 *
 * The hook is a standalone primitive in this slice — `pforge run-plan`
 * wire-in lands in a later slice. Tests cover skip patterns, config
 * gating, per-slice fired-once guard, sliceRef propagation, and
 * injected-runner error containment.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  runPostSliceTemperingHook,
  resetPostSliceTemperingFired,
} from "../orchestrator.mjs";

function makeProject() {
  const dir = resolve(tmpdir(), `temper-hook-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function seedConfig(projectDir, cfg) {
  mkdirSync(resolve(projectDir, ".forge", "tempering"), { recursive: true });
  writeFileSync(
    resolve(projectDir, ".forge", "tempering", "config.json"),
    JSON.stringify(cfg),
    "utf-8",
  );
}

describe("runPostSliceTemperingHook", () => {
  let projectDir;
  beforeEach(() => {
    projectDir = makeProject();
    resetPostSliceTemperingFired();
  });
  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns triggered=false when no commitMessage given", async () => {
    const r = await runPostSliceTemperingHook({ runTemperingRun: async () => ({}) });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("no-commit-message");
  });

  it("returns triggered=false when no runner injected", async () => {
    const r = await runPostSliceTemperingHook({
      commitMessage: "feat(x): y",
    });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("no-runner-injected");
  });

  it("skips docs commits", async () => {
    const r = await runPostSliceTemperingHook({
      commitMessage: "docs(readme): update",
      cwd: projectDir,
      runTemperingRun: async () => ({}),
    });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toMatch(/^skip-pattern:/);
  });

  it("skips merge commits", async () => {
    const r = await runPostSliceTemperingHook({
      commitMessage: "Merge pull request #1 from foo/bar",
      cwd: projectDir,
      runTemperingRun: async () => ({}),
    });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toMatch(/^skip-pattern:/);
  });

  it("skips non-conventional-commit messages", async () => {
    const r = await runPostSliceTemperingHook({
      commitMessage: "wip: tinkering",
      cwd: projectDir,
      runTemperingRun: async () => ({}),
    });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("not-conventional-commit");
  });

  it("returns skipped when config.enabled === false", async () => {
    seedConfig(projectDir, { enabled: false, execution: { trigger: "post-slice" } });
    const r = await runPostSliceTemperingHook({
      commitMessage: "feat(x): y",
      cwd: projectDir,
      runTemperingRun: async () => ({}),
    });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("tempering-disabled");
  });

  it("returns skipped when trigger mode is not post-slice", async () => {
    seedConfig(projectDir, { enabled: true, execution: { trigger: "on-demand" } });
    const r = await runPostSliceTemperingHook({
      commitMessage: "feat(x): y",
      cwd: projectDir,
      runTemperingRun: async () => ({}),
    });
    expect(r.triggered).toBe(false);
    expect(r.skippedReason).toBe("trigger-mode:on-demand");
  });

  it("fires the injected runner on a conventional commit with default config", async () => {
    let calls = 0;
    const r = await runPostSliceTemperingHook({
      commitMessage: "feat(temper): Slice 02.2",
      cwd: projectDir,
      sliceRef: { plan: "Phase-TEMPER-02.md", slice: "02.2" },
      runTemperingRun: async (args) => {
        calls += 1;
        expect(args.sliceRef).toEqual({ plan: "Phase-TEMPER-02.md", slice: "02.2" });
        expect(args.projectDir).toBe(projectDir);
        return { ok: true, runId: "run-xyz", verdict: "pass" };
      },
    });
    expect(calls).toBe(1);
    expect(r.triggered).toBe(true);
    expect(r.action).toBe("ran");
    expect(r.result.runId).toBe("run-xyz");
  });

  it("fires exactly once per sliceRef across repeated calls", async () => {
    let calls = 0;
    const runner = async () => { calls += 1; return { ok: true }; };
    const args = {
      commitMessage: "feat(x): y",
      cwd: projectDir,
      sliceRef: { plan: "P.md", slice: "01.1" },
      runTemperingRun: runner,
    };
    await runPostSliceTemperingHook(args);
    const r2 = await runPostSliceTemperingHook(args);
    expect(calls).toBe(1);
    expect(r2.triggered).toBe(false);
    expect(r2.skippedReason).toBe("already-fired-for-slice");
  });

  it("allows separate slices to each fire once", async () => {
    let calls = 0;
    const runner = async () => { calls += 1; return { ok: true }; };
    await runPostSliceTemperingHook({
      commitMessage: "feat(x): a",
      cwd: projectDir,
      sliceRef: { plan: "P.md", slice: "01.1" },
      runTemperingRun: runner,
    });
    await runPostSliceTemperingHook({
      commitMessage: "feat(x): b",
      cwd: projectDir,
      sliceRef: { plan: "P.md", slice: "01.2" },
      runTemperingRun: runner,
    });
    expect(calls).toBe(2);
  });

  it("resetPostSliceTemperingFired clears the guard", async () => {
    let calls = 0;
    const runner = async () => { calls += 1; return { ok: true }; };
    const args = {
      commitMessage: "feat(x): y",
      cwd: projectDir,
      sliceRef: { plan: "P.md", slice: "02.1" },
      runTemperingRun: runner,
    };
    await runPostSliceTemperingHook(args);
    resetPostSliceTemperingFired();
    await runPostSliceTemperingHook(args);
    expect(calls).toBe(2);
  });

  it("contains runner errors — returns action=error instead of throwing", async () => {
    const r = await runPostSliceTemperingHook({
      commitMessage: "feat(x): y",
      cwd: projectDir,
      sliceRef: { plan: "P.md", slice: "02.1" },
      runTemperingRun: async () => { throw new Error("boom"); },
    });
    expect(r.triggered).toBe(true);
    expect(r.action).toBe("error");
    expect(r.skippedReason).toMatch(/runner-threw:boom/);
  });
});
