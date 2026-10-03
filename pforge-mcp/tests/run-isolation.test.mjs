/**
 * Run isolation (recommendation 1/10). Workers commit during a slice, so a
 * slice that then fails its gate used to leave its commit on the operator's
 * branch (Phase-UPDATE-CORE slices 3-4). Each plan run now works on its own
 * pforge/run/* branch and only reaches the base branch when every slice passed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPullRequestBody,
  finishRunIsolation,
  loadRunIsolationConfig,
  RUN_BRANCH_PREFIX,
  runBranchName,
  startRunIsolation,
} from "../orchestrator/run-isolation.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const NOW = new Date("2026-10-03T10:20:30Z");
const PLAN = "docs/plans/Phase-7-CLIENT-SUMMARY-PLAN.md";

let repo;

function commitFile(rel, text, message) {
  writeFileSync(join(repo, rel), text);
  git(repo, "add", rel);
  git(repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pforge-run-iso-"));
  git(repo, "init", "-q", "-b", "main");
  commitFile("README.md", "base\n", "base");
  delete process.env.PFORGE_RUN_ISOLATION;
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  delete process.env.PFORGE_RUN_ISOLATION;
});

const DEFAULTS = { isolation: "branch", integrate: "fast-forward", draftPullRequest: true };

describe("runBranchName", () => {
  it("slugs the plan file name and stamps the UTC time", () => {
    expect(runBranchName(PLAN, NOW)).toBe(`${RUN_BRANCH_PREFIX}phase-7-client-summary-plan-20261003-102030`);
  });

  it("keeps branch names short and git-safe", () => {
    const name = runBranchName(`docs/plans/${"X ~^:?*[".repeat(20)}.md`, NOW);
    expect(name).toMatch(/^pforge\/run\/[a-z0-9-]+-20261003-102030$/);
    expect(name.length).toBeLessThanOrEqual(RUN_BRANCH_PREFIX.length + 60 + 16);
  });
});

describe("loadRunIsolationConfig", () => {
  it("defaults to a run branch fast-forwarded on success", () => {
    expect(loadRunIsolationConfig(repo)).toEqual(DEFAULTS);
  });

  it("reads runIsolation and runIntegration from .forge.json", () => {
    writeFileSync(join(repo, ".forge.json"), JSON.stringify({ runIsolation: "none", runIntegration: "pull-request", draftPullRequest: false }));
    expect(loadRunIsolationConfig(repo)).toEqual({ isolation: "none", integrate: "pull-request", draftPullRequest: false });
  });

  it("ignores unknown values and lets PFORGE_RUN_ISOLATION override", () => {
    writeFileSync(join(repo, ".forge.json"), JSON.stringify({ runIsolation: "sideways", runIntegration: "yolo" }));
    expect(loadRunIsolationConfig(repo)).toEqual(DEFAULTS);
    process.env.PFORGE_RUN_ISOLATION = "none";
    expect(loadRunIsolationConfig(repo).isolation).toBe("none");
  });
});

describe("startRunIsolation", () => {
  it("creates a run branch from the current branch, records the base, and carries uncommitted work", () => {
    writeFileSync(join(repo, "notes.txt"), "work in progress\n");
    const iso = startRunIsolation({ cwd: repo, planPath: PLAN, config: DEFAULTS, now: NOW });
    expect(iso).toMatchObject({ enabled: true, reused: false, baseBranch: "main", runBranch: runBranchName(PLAN, NOW) });
    expect(git(repo, "branch", "--show-current")).toBe(iso.runBranch);
    expect(git(repo, "config", `branch.${iso.runBranch}.pforge-base`)).toBe("main");
    expect(readFileSync(join(repo, "notes.txt"), "utf8")).toBe("work in progress\n");
  });

  it("reuses the run branch when a run resumes on it", () => {
    const first = startRunIsolation({ cwd: repo, planPath: PLAN, config: DEFAULTS, now: NOW });
    const again = startRunIsolation({ cwd: repo, planPath: PLAN, config: DEFAULTS, now: new Date("2026-10-04T00:00:00Z") });
    expect(again).toMatchObject({ enabled: true, reused: true, baseBranch: "main", runBranch: first.runBranch });
  });

  it.each([
    ["isolation is off", () => ({ config: { ...DEFAULTS, isolation: "none" } }), /runIsolation/],
    ["HEAD is detached", () => { git(repo, "checkout", "-q", "--detach"); return {}; }, /detached/],
  ])("does nothing when %s", (_label, arrange, reason) => {
    const extra = arrange();
    const iso = startRunIsolation({ cwd: repo, planPath: PLAN, config: DEFAULTS, now: NOW, ...extra });
    expect(iso.enabled).toBe(false);
    expect(iso.reason).toMatch(reason);
    expect(git(repo, "branch", "--list", `${RUN_BRANCH_PREFIX}*`)).toBe("");
  });

  it("does nothing outside a git repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "pforge-run-iso-plain-"));
    try {
      const iso = startRunIsolation({ cwd: plain, planPath: PLAN, config: DEFAULTS, now: NOW });
      expect(iso).toMatchObject({ enabled: false });
      expect(iso.reason).toMatch(/git/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("finishRunIsolation", () => {
  const start = () => startRunIsolation({ cwd: repo, planPath: PLAN, config: DEFAULTS, now: NOW });

  it("fast-forwards the base branch on success, returns to it, and deletes the run branch", () => {
    const iso = start();
    commitFile("feature.txt", "done\n", "slice 1");
    const runHead = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "plan-status.md"), "status rewritten after the run\n");

    const out = finishRunIsolation({ cwd: repo, isolation: iso, allPassed: true, config: DEFAULTS });

    expect(out.action).toBe("fast-forwarded");
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect(git(repo, "rev-parse", "main")).toBe(runHead);
    expect(git(repo, "branch", "--list", iso.runBranch)).toBe("");
    expect(readFileSync(join(repo, "plan-status.md"), "utf8")).toBe("status rewritten after the run\n");
  });

  it("keeps a failed run on its branch and leaves the base branch untouched", () => {
    const baseHead = git(repo, "rev-parse", "main");
    const iso = start();
    commitFile("half-done.txt", "wip\n", "slice 1 (gate failed)");

    const out = finishRunIsolation({ cwd: repo, isolation: iso, allPassed: false, config: DEFAULTS });

    expect(out.action).toBe("kept-on-branch");
    expect(git(repo, "branch", "--show-current")).toBe(iso.runBranch);
    expect(git(repo, "rev-parse", "main")).toBe(baseHead);
    expect(out.message).toContain("--resume-from");
    expect(out.message).toContain(`git branch -D ${iso.runBranch}`);
  });

  it("does not move a base branch that gained commits during the run", () => {
    const iso = start();
    commitFile("feature.txt", "done\n", "slice 1");
    git(repo, "branch", "-f", "main", git(repo, "rev-parse", "HEAD~1"));
    git(repo, "checkout", "-q", "main");
    commitFile("hotfix.txt", "urgent\n", "hotfix on main");
    const mainHead = git(repo, "rev-parse", "main");
    git(repo, "checkout", "-q", iso.runBranch);

    const out = finishRunIsolation({ cwd: repo, isolation: iso, allPassed: true, config: DEFAULTS });

    expect(out.action).toBe("base-moved");
    expect(git(repo, "rev-parse", "main")).toBe(mainHead);
    expect(git(repo, "branch", "--show-current")).toBe(iso.runBranch);
  });

  it("leaves a successful run on its branch when runIntegration is none", () => {
    const iso = start();
    commitFile("feature.txt", "done\n", "slice 1");
    const out = finishRunIsolation({ cwd: repo, isolation: iso, allPassed: true, config: { ...DEFAULTS, integrate: "none" } });
    expect(out.action).toBe("kept-on-branch");
    expect(git(repo, "branch", "--show-current")).toBe(iso.runBranch);
  });

  it("pushes the run branch and opens a pull request when runIntegration is pull-request", () => {
    const iso = start();
    commitFile("feature.txt", "done\n", "slice 1");
    const calls = [];
    const runCommand = vi.fn((cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "gh") return { status: 0, stdout: "https://github.com/acme/app/pull/42\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    });
    const summary = { phase: "Phase-7-CLIENT-SUMMARY-PLAN", status: "completed", results: { passed: 1, failed: 0, skipped: 0, total: 1 }, sliceResults: [], cost: { total_cost_usd: 0.04 } };

    const out = finishRunIsolation({ cwd: repo, isolation: iso, allPassed: true, config: { ...DEFAULTS, integrate: "pull-request" }, summary, runCommand });

    expect(out).toMatchObject({ action: "pull-request", url: "https://github.com/acme/app/pull/42" });
    expect(calls[0]).toEqual(["git", "push", "-u", "origin", iso.runBranch]);
    const pr = calls.find((c) => c[0] === "gh");
    expect(pr.slice(0, 3)).toEqual(["gh", "pr", "create"]);
    expect(pr).toEqual(expect.arrayContaining(["--base", "main", "--head", iso.runBranch, "--draft"]));
    const bodyFile = pr[pr.indexOf("--body-file") + 1];
    expect(existsSync(bodyFile)).toBe(false);
    expect(git(repo, "branch", "--show-current")).toBe("main");
  });

  it("reports a failed pull request without losing the run branch", () => {
    const iso = start();
    const runCommand = () => ({ status: 1, stdout: "", stderr: "fatal: no remote 'origin'" });
    const out = finishRunIsolation({ cwd: repo, isolation: iso, allPassed: true, config: { ...DEFAULTS, integrate: "pull-request" }, summary: {}, runCommand });
    expect(out.action).toBe("pull-request-failed");
    expect(out.message).toContain("no remote");
    expect(git(repo, "branch", "--show-current")).toBe(iso.runBranch);
  });

  it("is a no-op when isolation was not enabled", () => {
    expect(finishRunIsolation({ cwd: repo, isolation: { enabled: false }, allPassed: true, config: DEFAULTS })).toEqual({ action: "none" });
  });
});

describe("buildPullRequestBody", () => {
  it("lists each slice with status, duration and cost, and the run totals", () => {
    const body = buildPullRequestBody({
      phase: "Phase-7-CLIENT-SUMMARY-PLAN",
      status: "completed",
      results: { passed: 2, failed: 0, skipped: 1, total: 3 },
      totalDuration: 125_000,
      cost: { total_cost_usd: 0.0379 },
      sliceResults: [
        { number: "1", title: "Repository", status: "passed", duration: 60_000, cost: { cost_usd: 0.02 } },
        { number: "2", title: "Service | API", status: "passed", duration: 65_000, cost: { cost_usd: 0.0179 } },
        { sliceId: "3", status: "skipped" },
      ],
    });
    expect(body).toContain("Phase-7-CLIENT-SUMMARY-PLAN");
    expect(body).toContain("| 1 | Repository | passed | 1m 0s | $0.0200 |");
    expect(body).toContain("| 2 | Service \\| API | passed | 1m 5s | $0.0179 |");
    expect(body).toContain("| 3 |  | skipped |  |  |");
    expect(body).toContain("2 passed, 0 failed, 1 skipped");
    expect(body).toContain("$0.0379");
  });
});
