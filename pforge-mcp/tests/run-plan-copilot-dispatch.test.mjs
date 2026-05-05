/**
 * Plan Forge — Phase GITHUB-B Slice 3: Orchestrator pre-flight + dispatch routing
 *
 * Integration test: runs a 2-slice fixture plan end-to-end with a mock `gh` CLI.
 * Uses injectable dependencies (_inspectGithubStack, _dispatchSlice, _pollPullRequest)
 * so no real GitHub API calls are made and no real `gh` installation is required.
 *
 * Coverage:
 *   - Pre-flight check: github-remote + gh-cli required to pass
 *   - Pre-flight fail: github-remote not pass → runPlan returns status:failed with code
 *   - Pre-flight fail: gh-cli not pass → runPlan returns status:failed with code
 *   - Happy path: 2 slices dispatched, 2 PRs polled, run completes
 *   - PR timeout: slice marked failed when pollPullRequest returns { status: "timeout" }
 *   - gh error: GhError from dispatchSlice propagates as slice failure
 *   - dryRun skips pre-flight (works without gh)
 *   - estimate skips dispatch (returns estimate object)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPlan } from "../orchestrator.mjs";
import { dispatchSlice, pollPullRequest } from "../workers/copilot-coding-agent.mjs";
import { createMockGh } from "./helpers/mock-gh.mjs";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Minimal passing inspectGithubStack result for both required checks.
 * @param {string} cwd
 */
function passingInspection(cwd) {
  return {
    projectRoot: cwd,
    checks: [
      { id: "github-remote", status: "pass", label: "git remote → github.com", detail: "github.com remote configured" },
      { id: "gh-cli", status: "pass", label: "gh CLI on PATH", detail: "gh CLI available" },
    ],
    summary: { pass: 2, warn: 0, fail: 0, na: 0, total: 2 },
  };
}

/**
 * Build a 2-slice fixture plan. No validation gates so tests don't need bash.
 */
function buildFixturePlan() {
  return [
    "---",
    "crucibleId: test-copilot-dispatch-slice3",
    "---",
    "# Test Plan: Copilot Coding Agent Dispatch",
    "",
    "## Scope Contract",
    "### In Scope",
    "- src/",
    "",
    "## Slice Plan",
    "",
    "### Slice 1 — Fix the login bug",
    "**Goal**: Fix the authentication bug in src/auth.js",
    "**Files in scope**: src/auth.js",
    "",
    "### Slice 2 — Add regression tests",
    "**Goal**: Add unit tests for the fixed authentication code",
    "**Files in scope**: tests/auth.test.js",
  ].join("\n");
}

/** Wrap dispatchSlice to inject mock env and capture dispatch records. */
function wrapDispatch(mock, dispatched) {
  return (slice, opts) => {
    const result = dispatchSlice(slice, { ...opts, env: mock.env });
    dispatched.push({ sliceNumber: slice.number, title: slice.title, ...result });
    return result;
  };
}

/** Wrap pollPullRequest to inject mock env, fast poll, and capture records. */
function wrapPoll(mock, polled, extraOpts = {}) {
  return (issueNumber, opts) => {
    const r = pollPullRequest(issueNumber, {
      ...opts,
      env: mock.env,
      intervalMs: 0,
      timeoutMs: 5_000,
      ...extraOpts,
    });
    r.then?.((pr) => polled.push({ issueNumber, ...pr }));
    return r;
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runPlan copilot-coding-agent — pre-flight checks", () => {
  let tmpDir;
  let planPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pforge-cca-preflight-"));
    planPath = join(tmpDir, "test-plan.md");
    writeFileSync(planPath, buildFixturePlan(), "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns failed with COPILOT_AGENT_PREFLIGHT_FAILED when github-remote is not pass", async () => {
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: () => ({
        projectRoot: tmpDir,
        checks: [
          { id: "github-remote", status: "na", label: "git remote → github.com", detail: "no .git directory found (not a clone)" },
          { id: "gh-cli", status: "pass", label: "gh CLI on PATH", detail: "gh CLI available" },
        ],
        summary: { pass: 1, warn: 0, fail: 0, na: 1, total: 2 },
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(result.error).toMatch(/github-remote/);
    expect(result.error).toMatch(/pforge github status/);
  });

  it("returns failed when gh-cli is not pass", async () => {
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: () => ({
        projectRoot: tmpDir,
        checks: [
          { id: "github-remote", status: "pass", label: "git remote → github.com", detail: "github.com remote configured" },
          { id: "gh-cli", status: "warn", label: "gh CLI on PATH", detail: "gh CLI not found on PATH", fixHint: "Install GitHub CLI: https://cli.github.com" },
        ],
        summary: { pass: 1, warn: 1, fail: 0, na: 0, total: 2 },
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(result.error).toMatch(/gh-cli/);
  });

  it("returns failed when both github-remote and gh-cli fail", async () => {
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: () => ({
        projectRoot: tmpDir,
        checks: [
          { id: "github-remote", status: "warn", label: "git remote → github.com", detail: "no github.com remote" },
          { id: "gh-cli", status: "warn", label: "gh CLI on PATH", detail: "gh CLI not found on PATH" },
        ],
        summary: { pass: 0, warn: 2, fail: 0, na: 0, total: 2 },
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(result.error).toMatch(/github-remote/);
    expect(result.error).toMatch(/gh-cli/);
  });

  it("skips pre-flight for dryRun and returns dry-run status", async () => {
    // No _inspectGithubStack injected — would throw if called
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      dryRun: true,
      // Intentionally not injecting _inspectGithubStack — dryRun must skip pre-flight
      _inspectGithubStack: () => { throw new Error("pre-flight should not run in dryRun mode"); },
    });

    expect(result.status).toBe("dry-run");
  });
});

describe("runPlan copilot-coding-agent — dispatch routing", () => {
  let tmpDir;
  let planPath;
  let mock;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pforge-cca-dispatch-"));
    planPath = join(tmpDir, "test-plan.md");
    writeFileSync(planPath, buildFixturePlan(), "utf-8");
  });

  afterEach(() => {
    mock?.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("dispatches both slices and polls for PRs (happy path)", async () => {
    mock = createMockGh([
      {
        match: ["issue", "create"],
        stdout: "https://github.com/owner/repo/issues/1\n",
      },
      {
        match: ["pr", "list"],
        stdout: JSON.stringify([
          { number: 10, url: "https://github.com/owner/repo/pull/10", state: "OPEN", isDraft: false },
        ]) + "\n",
      },
    ]);

    const dispatched = [];
    const prResults = [];

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: () => passingInspection(tmpDir),
      _dispatchSlice: (slice, opts) => {
        const r = dispatchSlice(slice, { ...opts, env: mock.env });
        dispatched.push({ sliceNumber: slice.number, issueNumber: r.issueNumber });
        return r;
      },
      _pollPullRequest: async (issueNumber, opts) => {
        const pr = await pollPullRequest(issueNumber, {
          ...opts,
          env: mock.env,
          intervalMs: 0,
          timeoutMs: 5_000,
        });
        prResults.push({ issueNumber, prNumber: pr.prNumber, status: pr.status });
        return pr;
      },
    });

    // Both slices should be dispatched
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0].issueNumber).toBe(1);
    // Second dispatch also returns issue #1 (same mock scenario — verifies dispatch was called twice)
    expect(dispatched[1].issueNumber).toBe(1);

    // PRs polled for both slices
    expect(prResults).toHaveLength(2);
    expect(prResults[0].prNumber).toBe(10);
    expect(prResults[0].status).toBe("open");
    expect(prResults[1].prNumber).toBe(10);

    // Run should complete with both slices passed
    expect(result).toBeDefined();
    expect(result.sliceResults).toHaveLength(2);
    expect(result.sliceResults.every((r) => r.status === "passed")).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("marks a slice failed when pollPullRequest returns timeout", async () => {
    mock = createMockGh([
      {
        match: ["issue", "create"],
        stdout: "https://github.com/owner/repo/issues/99\n",
      },
      // No PR ever found — pr list returns empty
      { match: ["pr", "list"], stdout: "[]\n" },
    ]);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: () => passingInspection(tmpDir),
      _dispatchSlice: (slice, opts) => dispatchSlice(slice, { ...opts, env: mock.env }),
      // Use an instant timeout so the test doesn't wait 30 min
      _pollPullRequest: (issueNumber, opts) =>
        pollPullRequest(issueNumber, { ...opts, env: mock.env, intervalMs: 0, timeoutMs: 0 }),
    });

    // Run should report at least one slice failed (timeout → exitCode 1)
    expect(result).toBeDefined();
    const sliceResults1 = result.sliceResults ?? [];
    const failedSlices1 = sliceResults1.filter((r) => r.status === "failed");
    expect(failedSlices1.length).toBeGreaterThan(0);
  });

  it("marks a slice failed when dispatchSlice throws GhError", async () => {
    mock = createMockGh([
      // Simulate gh auth error on issue create
      {
        match: ["issue", "create"],
        stdout: "",
        stderr: "authentication required\n",
        exit: 1,
      },
    ]);

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: () => passingInspection(tmpDir),
      _dispatchSlice: (slice, opts) => dispatchSlice(slice, { ...opts, env: mock.env }),
      _pollPullRequest: (issueNumber, opts) =>
        pollPullRequest(issueNumber, { ...opts, env: mock.env, intervalMs: 0, timeoutMs: 0 }),
    });

    expect(result).toBeDefined();
    const sliceResults2 = result.sliceResults ?? [];
    const failedSlices2 = sliceResults2.filter((r) => r.status === "failed");
    expect(failedSlices2.length).toBeGreaterThan(0);
  });

  it("does not reach dispatch when pre-flight fails", async () => {
    let dispatchCalled = false;

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: () => ({
        projectRoot: tmpDir,
        checks: [
          { id: "github-remote", status: "fail", label: "git remote → github.com", detail: "no .git directory" },
          { id: "gh-cli", status: "pass", label: "gh CLI on PATH", detail: "gh CLI available" },
        ],
        summary: { pass: 1, warn: 0, fail: 1, na: 0, total: 2 },
      }),
      _dispatchSlice: () => { dispatchCalled = true; return { issueNumber: 1, issueUrl: "x" }; },
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(dispatchCalled).toBe(false);
  });
});
