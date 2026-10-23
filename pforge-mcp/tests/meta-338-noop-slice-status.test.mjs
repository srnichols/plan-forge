import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectWorkerBlockerReport } from "../orchestrator/worker-spawn.mjs";
import { detectNoOpSlice, isConcreteScopeFile, verifyNoOpSlice } from "../orchestrator/git-safety.mjs";
import { determineSliceStatus } from "../orchestrator/run-plan.mjs";
import { failNoOpSlice } from "../orchestrator/run-plan/slice-evidence-checks.mjs";

/**
 * Meta-bug #338 — a slice was recorded as passed although the worker reported a
 * Blocker and changed nothing. The gate happened to pass vacuously (#337), the
 * impact gate saw no changed files, and dependents built on work that never
 * happened. Neither signal was ever consulted: slice status came only from the
 * exit code, the gate result and the amount of stdout.
 */

const BLOCKER_REPORT = [
  "I could not complete this slice.",
  "",
  "## ⚠ Blocker",
  "",
  "**Slice:** 23 — Placement and egress policy",
  "**Problem:** kustomization.yaml is outside the declared scope, so the egress policy cannot be wired",
  "**Cause:** the slice scope omits deploy/k8s/base/kustomization.yaml",
  "**Impact:** Slice 27 cannot run",
  "**Attempted:** nothing was changed",
  "**Next action:** add the file to the Slice 23 scope",
].join("\n");

const DONE_REPORT = "Implemented placement.mjs and the NetworkPolicy, then ran the gate; all 20 tests pass. ".repeat(2);

describe("detectWorkerBlockerReport (#338)", () => {
  const worker = (output, extra = {}) => ({ worker: "sdk", exitCode: 0, output, ...extra });

  it("returns the reported problem for a real Blocker Report", () => {
    const reason = detectWorkerBlockerReport(worker(BLOCKER_REPORT), "auto");
    expect(reason).toContain("Blocker");
    expect(reason).toContain("kustomization.yaml is outside the declared scope");
  });

  it("accepts the variation-selector heading and other heading levels", () => {
    const output = BLOCKER_REPORT.replace("## ⚠ Blocker", "### \u26A0\uFE0F Blocker");
    expect(detectWorkerBlockerReport(worker(output), "auto")).toContain("kustomization.yaml");
  });

  it("ignores the unfilled template, which a docs slice may quote", () => {
    const template = [
      "Here is the template I added to the guide:",
      "",
      "## ⚠ Blocker",
      "",
      "**Slice:** <N> — <title>",
      "**Problem:** <what failed>",
      "**Next action:** <specific fix or question for human>",
    ].join("\n");
    expect(detectWorkerBlockerReport(worker(template), "auto")).toBeNull();
  });

  it("ignores prose that merely mentions blockers", () => {
    const output = `${DONE_REPORT}\nThere were no blockers, and the Blocker section of the guide is unchanged.`;
    expect(detectWorkerBlockerReport(worker(output), "auto")).toBeNull();
  });

  it("returns null for ordinary output", () => {
    expect(detectWorkerBlockerReport(worker(DONE_REPORT), "auto")).toBeNull();
  });

  it("does not judge a human worker or an assisted run", () => {
    expect(detectWorkerBlockerReport(worker(BLOCKER_REPORT, { worker: "human" }), "auto")).toBeNull();
    expect(detectWorkerBlockerReport(worker(BLOCKER_REPORT), "assisted")).toBeNull();
    expect(detectWorkerBlockerReport(null, "auto")).toBeNull();
  });
});

describe("determineSliceStatus (#338)", () => {
  const slice = { number: "23", title: "Placement and egress policy", validationGate: "npx vitest run tests/placement.test.mjs" };
  const passingGate = { success: true };
  const status = (output) => determineSliceStatus({
    workerResult: { worker: "sdk", exitCode: 0, output },
    mode: "auto",
    slice,
    gateResult: passingGate,
  });

  it("fails a slice whose worker reported a Blocker even though the gate passed", () => {
    const result = status(BLOCKER_REPORT);
    expect(result.status).toBe("failed");
    expect(result.statusReason).toMatch(/Blocker/);
  });

  it("still passes the same slice when the worker did the work", () => {
    expect(status(DONE_REPORT)).toMatchObject({ status: "passed", statusReason: null });
  });

  it("keeps a failed gate as the failure reason", () => {
    const result = determineSliceStatus({
      workerResult: { worker: "sdk", exitCode: 0, output: DONE_REPORT },
      mode: "auto",
      slice,
      gateResult: { success: false, failedCommand: "npx vitest run" },
    });
    expect(result.status).toBe("failed");
    expect(result.statusReason).toContain("validation gate failed");
  });
});

describe("isConcreteScopeFile (#338)", () => {
  it("accepts a path that names one file", () => {
    expect(isConcreteScopeFile("pforge-claw/src/placement.mjs")).toBe(true);
    expect(isConcreteScopeFile(".\\src\\a.ts")).toBe(true);
  });

  it("rejects globs, directories and entries without an extension", () => {
    expect(isConcreteScopeFile("pforge-claw/src/**")).toBe(false);
    expect(isConcreteScopeFile("src/*.mjs")).toBe(false);
    expect(isConcreteScopeFile("deploy/k8s/")).toBe(false);
    expect(isConcreteScopeFile("deploy/k8s")).toBe(false);
    expect(isConcreteScopeFile("Makefile")).toBe(false);
    expect(isConcreteScopeFile("")).toBe(false);
  });
});

describe("detectNoOpSlice (#338)", () => {
  const slice = { number: "23", title: "Placement", scope: ["src/placement.mjs", "deploy/k8s/networkpolicy-jobs.yaml"] };
  const none = () => false;

  it("flags a slice that changed nothing while its declared files do not exist", () => {
    const result = detectNoOpSlice({ slice, changed: [], exists: none });
    expect(result).toMatchObject({ applicable: true, noOp: true });
    expect(result.missing).toEqual(["src/placement.mjs", "deploy/k8s/networkpolicy-jobs.yaml"]);
  });

  it("lets an idempotent re-run pass when every declared file already exists", () => {
    expect(detectNoOpSlice({ slice, changed: [], exists: () => true }).noOp).toBe(false);
  });

  it("does not flag a slice that changed anything", () => {
    expect(detectNoOpSlice({ slice, changed: ["README.md"], exists: none }).noOp).toBe(false);
  });

  it("is not applicable to deletion slices, whose declared files are meant to vanish", () => {
    const deletion = { ...slice, title: "Delete redundant placement shims" };
    expect(detectNoOpSlice({ slice: deletion, changed: [], exists: none }).applicable).toBe(false);
  });

  it("is not applicable when the scope names no concrete file", () => {
    const globOnly = { number: "1", title: "x", scope: ["src/**", "docs/"] };
    expect(detectNoOpSlice({ slice: globOnly, changed: [], exists: none }).applicable).toBe(false);
    expect(detectNoOpSlice({ slice: { number: "2", title: "x" }, changed: [], exists: none }).applicable).toBe(false);
  });
});

describe("verifyNoOpSlice (#338, real repository)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  const git = (cwd, ...args) => execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-c", "user.email=t@example.test", "-c", "user.name=t", ...args],
    { cwd, encoding: "utf-8" },
  ).trim();

  function makeRepo() {
    const dir = mkdtempSync(join(tmpdir(), "pf-meta-338-"));
    dirs.push(dir);
    git(dir, "init", "-q");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "existing.mjs"), "export const a = 1;\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    return { dir, startSha: git(dir, "rev-parse", "HEAD") };
  }

  const slice = { number: "1", title: "Add feature", scope: ["src/feature.mjs"] };

  it("flags a slice that left the tree untouched and never created its file", () => {
    const { dir, startSha } = makeRepo();
    const result = verifyNoOpSlice({ slice, cwd: dir, startSha });
    expect(result).toMatchObject({ applicable: true, noOp: true, missing: ["src/feature.mjs"] });
  });

  it("passes once the declared file exists, committed or not", () => {
    const { dir, startSha } = makeRepo();
    writeFileSync(join(dir, "src", "feature.mjs"), "export const f = 1;\n");
    expect(verifyNoOpSlice({ slice, cwd: dir, startSha }).noOp).toBe(false);
  });

  it("counts a deleted tracked file as a change", () => {
    const { dir, startSha } = makeRepo();
    rmSync(join(dir, "src", "existing.mjs"));
    expect(verifyNoOpSlice({ slice, cwd: dir, startSha }).noOp).toBe(false);
  });

  it("is not applicable without a start commit or outside a repository", () => {
    const { dir } = makeRepo();
    expect(verifyNoOpSlice({ slice, cwd: dir, startSha: null }).applicable).toBe(false);
    const plain = mkdtempSync(join(tmpdir(), "pf-meta-338-plain-"));
    dirs.push(plain);
    expect(verifyNoOpSlice({ slice, cwd: plain, startSha: "deadbeef" }).applicable).toBe(false);
  });

  describe("failNoOpSlice wiring", () => {
    it("turns a passed no-op slice into a failed one and names the missing file", () => {
      const { dir, startSha } = makeRepo();
      const sliceResult = { status: "passed" };
      failNoOpSlice({ sliceResult, slice, cwd: dir, sliceStartHead: startSha });
      expect(sliceResult.status).toBe("failed");
      expect(sliceResult.statusReason).toContain("no-op-slice");
      expect(sliceResult.statusReason).toContain("src/feature.mjs");
      expect(sliceResult.noOpSlice).toEqual({ missing: ["src/feature.mjs"] });
    });

    it("leaves a slice that did its work alone", () => {
      const { dir, startSha } = makeRepo();
      writeFileSync(join(dir, "src", "feature.mjs"), "export const f = 1;\n");
      const sliceResult = { status: "passed" };
      failNoOpSlice({ sliceResult, slice, cwd: dir, sliceStartHead: startSha });
      expect(sliceResult).toEqual({ status: "passed" });
    });

    it("leaves a slice that already failed alone", () => {
      const { dir, startSha } = makeRepo();
      const sliceResult = { status: "failed", statusReason: "validation gate failed: x" };
      failNoOpSlice({ sliceResult, slice, cwd: dir, sliceStartHead: startSha });
      expect(sliceResult).toEqual({ status: "failed", statusReason: "validation gate failed: x" });
    });
  });
});
