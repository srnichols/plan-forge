/**
 * Bug #81 — buildEstimate honors resumeFrom.
 *
 * Before the fix, `--estimate --resume-from N` still summed every slice in
 * the plan (including shipped ones). This test pins the expected behaviour:
 * effective sliceCount, executionOrder, tokens, and slices[] must only cover
 * the tail of the execution order starting at resumeFrom.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlan, buildEstimate } from "../orchestrator.mjs";

function makeTempDir() {
  const dir = join(tmpdir(), `pforge-est-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const PLAN_MD = `---
crucibleId: resume-estimate-test
lane: full
source: human
---

# Plan

## Slices

### Slice 1: First

### Slice 2: Second

### Slice 3: Third

### Slice 4: Fourth
`;

describe("buildEstimate — bug #81 resumeFrom", () => {
  let cwd;
  let plan;

  beforeEach(() => {
    cwd = makeTempDir();
    const planPath = join(cwd, "plan.md");
    writeFileSync(planPath, PLAN_MD);
    plan = parsePlan(planPath, cwd);
  });

  it("without resumeFrom, estimate covers the full plan", () => {
    const est = buildEstimate(plan, null, cwd);
    expect(est.sliceCount).toBe(4);
    expect(est.executionOrder).toEqual(["1", "2", "3", "4"]);
    expect(est.slices.map((s) => s.number)).toEqual(["1", "2", "3", "4"]);
    expect(est.resumeFrom).toBeUndefined();
    expect(est.fullSliceCount).toBeUndefined();
  });

  it("with resumeFrom=3, estimate only covers slices 3 and 4", () => {
    const est = buildEstimate(plan, null, cwd, null, 3);
    expect(est.sliceCount).toBe(2);
    expect(est.executionOrder).toEqual(["3", "4"]);
    expect(est.slices.map((s) => s.number)).toEqual(["3", "4"]);
    expect(est.resumeFrom).toBe("3");
    expect(est.fullSliceCount).toBe(4);
  });

  it("estimated tokens/cost scale with effective slice count", () => {
    const fullEst = buildEstimate(plan, null, cwd);
    const partialEst = buildEstimate(plan, null, cwd, null, 3);
    // Partial should be half the full estimate (2 of 4 slices).
    expect(partialEst.tokens.estimatedInput).toBe(fullEst.tokens.estimatedInput / 2);
    expect(partialEst.tokens.estimatedOutput).toBe(fullEst.tokens.estimatedOutput / 2);
  });

  it("accepts numeric or string resumeFrom", () => {
    const byNum = buildEstimate(plan, null, cwd, null, 2);
    const byStr = buildEstimate(plan, null, cwd, null, "2");
    expect(byNum.sliceCount).toBe(byStr.sliceCount);
    expect(byNum.executionOrder).toEqual(byStr.executionOrder);
  });

  it("when resumeFrom does not match any slice, falls back to full plan", () => {
    const est = buildEstimate(plan, null, cwd, null, 99);
    expect(est.sliceCount).toBe(4);
    expect(est.executionOrder).toEqual(["1", "2", "3", "4"]);
  });
});
