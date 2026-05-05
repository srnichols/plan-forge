/**
 * Tests for the copilot-coding-agent-assignable check and the orchestrator
 * pre-flight integration added in Hotfix v2.90.4.
 *
 * Coverage:
 *   inspectGithubStack unit tests:
 *     - check is registered as the 9th default check
 *     - returns na when ghToken is not provided
 *
 *   Orchestrator pre-flight integration (uses _inspectGithubStack DI):
 *     - pass  → pre-flight succeeds, dispatch proceeds
 *     - warn  → pre-flight fails (COPILOT_AGENT_PREFLIGHT_FAILED)
 *     - na    → pre-flight succeeds (check was skipped, not blocking)
 *     - fail  → pre-flight fails (API error is also blocking)
 *
 *   Pre-flight always sends { ghToken: true } to inspectGithubStack when
 *   worker is "copilot-coding-agent".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { inspectGithubStack } from "../github-introspect.mjs";
import { runPlan } from "../orchestrator.mjs";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Minimal 1-slice plan with no validation gate (keeps test setup simple).
 */
function buildFixturePlan() {
  return [
    "---",
    "crucibleId: test-copilot-agent-assignable",
    "---",
    "# Test Plan: Copilot Agent Assignable Pre-flight",
    "",
    "## Scope Contract",
    "### In Scope",
    "- src/",
    "",
    "## Slice Plan",
    "",
    "### Slice 1 — Dummy slice",
    "**Goal**: Placeholder slice for pre-flight tests",
    "**Files in scope**: src/placeholder.js",
  ].join("\n");
}

/**
 * Minimal passing inspection for github-remote + gh-cli.
 * copilot-coding-agent-assignable is omitted from this base so individual
 * tests can inject whatever status they need.
 */
function basePassingChecks(cwd) {
  return [
    { id: "github-remote", status: "pass", label: "git remote → github.com", detail: "github.com remote configured" },
    { id: "gh-cli", status: "pass", label: "gh CLI on PATH", detail: "gh CLI available" },
  ];
}

/**
 * Build a mock _inspectGithubStack that returns passing base checks plus the
 * provided copilot-coding-agent-assignable result.
 */
function mockInspection(cwd, assignableCheck) {
  return () => ({
    projectRoot: cwd,
    checks: [
      ...basePassingChecks(cwd),
      assignableCheck,
    ],
    summary: { pass: 0, warn: 0, fail: 0, na: 0, total: 3 },
  });
}

// ─── inspectGithubStack unit tests ────────────────────────────────────────────

describe("inspectGithubStack — copilot-coding-agent-assignable check", () => {
  it("registers the check as the 9th default check", () => {
    const r = inspectGithubStack(process.cwd());
    const check = r.checks.find((c) => c.id === "copilot-coding-agent-assignable");
    expect(check).toBeDefined();
    expect(r.checks[8].id).toBe("copilot-coding-agent-assignable");
  });

  it("returns na when ghToken is not provided", () => {
    const r = inspectGithubStack(process.cwd());
    const check = r.checks.find((c) => c.id === "copilot-coding-agent-assignable");
    expect(check.status).toBe("na");
    expect(check.detail).toBeTruthy();
  });

  it("check has the required shape fields", () => {
    const r = inspectGithubStack(process.cwd());
    const check = r.checks.find((c) => c.id === "copilot-coding-agent-assignable");
    expect(check.id).toBe("copilot-coding-agent-assignable");
    expect(check.label).toBeTruthy();
    expect(["pass", "warn", "fail", "na"]).toContain(check.status);
    expect(check.detail).toBeTruthy();
  });

  it("is included in the summary total", () => {
    const r = inspectGithubStack(process.cwd());
    expect(r.summary.total).toBe(r.checks.length);
    expect(r.summary.na).toBeGreaterThanOrEqual(1); // at least the assignable check is na
  });
});

// ─── Orchestrator pre-flight integration tests ────────────────────────────────

describe("runPlan copilot-coding-agent — copilot-coding-agent-assignable pre-flight", () => {
  let tmpDir;
  let planPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pforge-cca-assignable-"));
    planPath = join(tmpDir, "test-plan.md");
    writeFileSync(planPath, buildFixturePlan(), "utf-8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("always passes { ghToken: true } to _inspectGithubStack", async () => {
    let capturedOpts;
    await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: (root, opts) => {
        capturedOpts = opts;
        // Return a failing result so runPlan exits quickly without dispatching
        return {
          projectRoot: root,
          checks: [
            { id: "github-remote", status: "fail", label: "git remote → github.com", detail: "no .git" },
            { id: "gh-cli", status: "pass", label: "gh CLI on PATH", detail: "gh CLI available" },
          ],
          summary: { pass: 1, warn: 0, fail: 1, na: 0, total: 2 },
        };
      },
    });

    expect(capturedOpts).toBeDefined();
    expect(capturedOpts.ghToken).toBe(true);
  });

  it("warn status → COPILOT_AGENT_PREFLIGHT_FAILED with fix-hint surfaced", async () => {
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: mockInspection(tmpDir, {
        id: "copilot-coding-agent-assignable",
        label: "Copilot coding agent assignable",
        status: "warn",
        detail: "@copilot is not assignable on this repo — Copilot Coding Agent may not be enabled",
        fixHint: "Enable Copilot Coding Agent: https://docs.github.com/copilot/using-github-copilot/using-copilot-coding-agent",
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(result.error).toMatch(/copilot-coding-agent-assignable/);
    expect(result.error).toMatch(/not assignable/);
  });

  it("fail status (API error) → COPILOT_AGENT_PREFLIGHT_FAILED", async () => {
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: mockInspection(tmpDir, {
        id: "copilot-coding-agent-assignable",
        label: "Copilot coding agent assignable",
        status: "fail",
        detail: "could not reach GitHub API — network error",
        fixHint: "Check your network connection and retry.",
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(result.error).toMatch(/copilot-coding-agent-assignable/);
    expect(result.error).toMatch(/network error/);
  });

  it("na status → pre-flight passes (check was skipped, not blocking)", async () => {
    let dispatchCalled = false;

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: mockInspection(tmpDir, {
        id: "copilot-coding-agent-assignable",
        label: "Copilot coding agent assignable",
        status: "na",
        detail: "skipped — pass --gh-token to probe",
      }),
      _dispatchSlice: () => {
        dispatchCalled = true;
        return { issueNumber: 1, issueUrl: "https://github.com/owner/repo/issues/1" };
      },
      _pollPullRequest: async () => ({
        status: "merged",
        prNumber: 1,
        prUrl: "https://github.com/owner/repo/pull/1",
      }),
    });

    // Pre-flight did not block on na
    expect(result.code).not.toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(dispatchCalled).toBe(true);
  });

  it("pass status → pre-flight passes, dispatch proceeds", async () => {
    let dispatchCalled = false;

    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: mockInspection(tmpDir, {
        id: "copilot-coding-agent-assignable",
        label: "Copilot coding agent assignable",
        status: "pass",
        detail: "@copilot is assignable on this repo",
      }),
      _dispatchSlice: () => {
        dispatchCalled = true;
        return { issueNumber: 2, issueUrl: "https://github.com/owner/repo/issues/2" };
      },
      _pollPullRequest: async () => ({
        status: "merged",
        prNumber: 2,
        prUrl: "https://github.com/owner/repo/pull/2",
      }),
    });

    // Pre-flight did not block on pass
    expect(result.code).not.toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    expect(dispatchCalled).toBe(true);
  });

  it("warn blocks dispatch — _dispatchSlice is never called", async () => {
    let dispatchCalled = false;

    await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: mockInspection(tmpDir, {
        id: "copilot-coding-agent-assignable",
        label: "Copilot coding agent assignable",
        status: "warn",
        detail: "@copilot is not assignable on this repo",
        fixHint: "Enable Copilot Coding Agent at github.com settings.",
      }),
      _dispatchSlice: () => {
        dispatchCalled = true;
        return { issueNumber: 3, issueUrl: "https://github.com/owner/repo/issues/3" };
      },
    });

    expect(dispatchCalled).toBe(false);
  });

  it("warn on assignable check alongside passing base checks → only assignable detail in error", async () => {
    const result = await runPlan(planPath, {
      cwd: tmpDir,
      manualImport: true,
      worker: "copilot-coding-agent",
      quorum: false,
      noTempering: true,
      _inspectGithubStack: mockInspection(tmpDir, {
        id: "copilot-coding-agent-assignable",
        label: "Copilot coding agent assignable",
        status: "warn",
        detail: "Copilot Coding Agent not enabled on this repo",
        fixHint: "Visit repo settings and enable Copilot Coding Agent.",
      }),
    });

    expect(result.status).toBe("failed");
    expect(result.code).toBe("COPILOT_AGENT_PREFLIGHT_FAILED");
    // Error should mention the assignable check, not github-remote or gh-cli (those pass)
    expect(result.error).toMatch(/copilot-coding-agent-assignable/);
    expect(result.error).not.toMatch(/github-remote/);
    expect(result.error).not.toMatch(/gh-cli/);
  });
});
