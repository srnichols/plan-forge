/**
 * Plan Forge — run isolation (recommendations 1 and 10).
 *
 * Workers commit during a slice, so a slice that then fails its gate used to
 * leave its commit on the operator's branch. Each auto-mode run now works on
 * its own `pforge/run/<plan>-<UTC time>` branch:
 *
 *   start   create the run branch from the current branch (uncommitted work
 *           comes along) and record that base branch in git config; a resumed
 *           run already on a run branch reuses it.
 *   finish  every slice passed  -> runIntegration decides:
 *             "fast-forward" (default)  move the base branch to the run
 *                                       branch's commit, switch to it, delete
 *                                       the run branch
 *             "pull-request"            push the run branch and open a pull
 *                                       request against the base branch
 *             "none"                    leave the work on the run branch
 *           any slice failed    -> stay on the run branch; the base branch is
 *                                  untouched
 *
 * Git runs synchronously here: only at run start and end, never per slice.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { MS_PER_SECOND } from "../time-units.mjs";

export const RUN_BRANCH_PREFIX = "pforge/run/";
const RUN_ISOLATION_MODES = Object.freeze(["branch", "none"]);
const RUN_INTEGRATION_MODES = Object.freeze(["fast-forward", "pull-request", "none"]);
const BASE_CONFIG_KEY = "pforge-base";
/** Longest plan slug kept in a run branch name. */
const MAX_SLUG_LENGTH = 60;
const GIT_TIMEOUT_MS = 30_000;
const PUSH_TIMEOUT_MS = 120_000;
/** `YYYYMMDDTHHMMSS`: the compact ISO date-time prefix used in branch names. */
const COMPACT_STAMP_LENGTH = 15;
const COST_DECIMALS = 4;

function defaultGit(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS }).trim();
}

function tryGit(cwd, args) {
  try {
    return defaultGit(cwd, args);
  } catch {
    return null;
  }
}

function defaultRunCommand(cmd, args, { cwd }) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: PUSH_TIMEOUT_MS, windowsHide: true });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error?.message || "") };
}

/**
 * @param {string} cwd
 * @returns {{ isolation: "branch"|"none", integrate: "fast-forward"|"pull-request"|"none", draftPullRequest: boolean }}
 */
export function loadRunIsolationConfig(cwd) {
  let config = {};
  try {
    const path = resolve(cwd, ".forge.json");
    if (existsSync(path)) config = JSON.parse(readFileSync(path, "utf8"));
  } catch { /* invalid .forge.json: defaults */ }
  const envIsolation = process.env.PFORGE_RUN_ISOLATION;
  const isolation = [envIsolation, config.runIsolation].find((v) => RUN_ISOLATION_MODES.includes(v)) ?? "branch";
  const integrate = RUN_INTEGRATION_MODES.includes(config.runIntegration) ? config.runIntegration : "fast-forward";
  const draftPullRequest = typeof config.draftPullRequest === "boolean" ? config.draftPullRequest : true;
  return { isolation, integrate, draftPullRequest };
}

/** `pforge/run/<plan slug>-<YYYYMMDD-HHMMSS>` in UTC. */
export function runBranchName(planPath, now = new Date()) {
  const slug = basename(planPath, ".md").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "") || "plan";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, COMPACT_STAMP_LENGTH);
  return `${RUN_BRANCH_PREFIX}${slug}-${stamp}`;
}

/**
 * Move the run onto its own branch. Never throws: anything unexpected
 * disables isolation for this run and says why.
 *
 * @returns {{ enabled: boolean, reason?: string, baseBranch?: string|null, runBranch?: string, reused?: boolean }}
 */
export function startRunIsolation({ cwd, planPath, config, now = new Date() }) {
  if (config.isolation === "none") return { enabled: false, reason: "runIsolation is \"none\"" };
  if (tryGit(cwd, ["rev-parse", "--is-inside-work-tree"]) !== "true") return { enabled: false, reason: "not a git repository" };
  if (!tryGit(cwd, ["rev-parse", "--verify", "HEAD"])) return { enabled: false, reason: "the repository has no commits yet" };
  const current = tryGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!current) return { enabled: false, reason: "HEAD is detached; check out a branch to isolate the run" };

  if (current.startsWith(RUN_BRANCH_PREFIX)) {
    const baseBranch = tryGit(cwd, ["config", `branch.${current}.${BASE_CONFIG_KEY}`]);
    return { enabled: true, reused: true, baseBranch, runBranch: current };
  }

  const runBranch = runBranchName(planPath, now);
  try {
    defaultGit(cwd, ["checkout", "-q", "-b", runBranch]);
    defaultGit(cwd, ["config", `branch.${runBranch}.${BASE_CONFIG_KEY}`, current]);
  } catch (err) {
    return { enabled: false, reason: `could not create ${runBranch}: ${firstLine(err)}` };
  }
  return { enabled: true, reused: false, baseBranch: current, runBranch };
}

/**
 * Integrate (or keep) the run's work. Never throws.
 *
 * @returns {{ action: "none"|"fast-forwarded"|"kept-on-branch"|"base-moved"|"pull-request"|"pull-request-failed", message?: string, url?: string }}
 */
export function finishRunIsolation({ cwd, isolation, allPassed, config, summary = {}, runCommand = defaultRunCommand }) {
  if (!isolation?.enabled) return { action: "none" };
  const { baseBranch, runBranch } = isolation;
  if (!allPassed) {
    return {
      action: "kept-on-branch",
      message: `Not every slice passed, so ${baseBranch ?? "the base branch"} is unchanged and the work so far is on ${runBranch}. `
        + `Fix and continue with \`pforge run-plan <plan> --resume-from <slice>\` (it reuses ${runBranch}), `
        + `or discard it with \`git checkout ${baseBranch ?? "<base>"} && git branch -D ${runBranch}\`.`,
    };
  }
  if (!baseBranch || config.integrate === "none") {
    return { action: "kept-on-branch", message: `The run's work is on ${runBranch}${baseBranch ? `; merge it into ${baseBranch} when ready` : ""}.` };
  }
  if (config.integrate === "pull-request") return openPullRequest({ cwd, baseBranch, runBranch, config, summary, runCommand });
  return fastForwardBase({ cwd, baseBranch, runBranch });
}

function fastForwardBase({ cwd, baseBranch, runBranch }) {
  try {
    const runHead = defaultGit(cwd, ["rev-parse", "HEAD"]);
    const baseHead = defaultGit(cwd, ["rev-parse", `refs/heads/${baseBranch}`]);
    if (tryGit(cwd, ["merge-base", "--is-ancestor", baseHead, runHead]) === null) {
      return {
        action: "base-moved",
        message: `${baseBranch} gained commits during the run, so it was not moved. The run's work is on ${runBranch}; merge or rebase it yourself.`,
      };
    }
    // Same commit after the update, so switching cannot conflict with uncommitted files.
    defaultGit(cwd, ["update-ref", `refs/heads/${baseBranch}`, runHead, baseHead]);
    defaultGit(cwd, ["checkout", "-q", baseBranch]);
    defaultGit(cwd, ["branch", "-D", runBranch]);
    return { action: "fast-forwarded", message: `Every slice passed; ${baseBranch} now includes the run's commits.` };
  } catch (err) {
    return { action: "kept-on-branch", message: `Could not fast-forward ${baseBranch} (${firstLine(err)}); the run's work is on ${runBranch}.` };
  }
}

function openPullRequest({ cwd, baseBranch, runBranch, config, summary, runCommand }) {
  const push = runCommand("git", ["push", "-u", "origin", runBranch], { cwd });
  if (push.status !== 0) return prFailed(runBranch, push);

  const bodyFile = join(tmpdir(), `pforge-pr-${process.pid}-${Date.now()}.md`);
  writeFileSync(bodyFile, buildPullRequestBody(summary));
  const title = `Plan Forge: ${summary.phase ?? runBranch}`;
  const args = ["pr", "create", "--base", baseBranch, "--head", runBranch, "--title", title, "--body-file", bodyFile];
  if (config.draftPullRequest) args.push("--draft");
  let pr;
  try {
    pr = runCommand("gh", args, { cwd });
  } finally {
    rmSync(bodyFile, { force: true });
  }
  if (pr.status !== 0) return prFailed(runBranch, pr);

  const url = pr.stdout.trim().split(/\r?\n/).pop();
  const back = tryGit(cwd, ["checkout", "-q", baseBranch]);
  return {
    action: "pull-request",
    url,
    message: `Opened ${url} from ${runBranch} into ${baseBranch}.${back === null ? ` Still on ${runBranch}.` : ""}`,
  };
}

function prFailed(runBranch, result) {
  return {
    action: "pull-request-failed",
    message: `Could not open a pull request (${(result.stderr || result.stdout || "unknown error").trim().split(/\r?\n/)[0]}); the run's work is on ${runBranch}.`,
  };
}

function firstLine(err) {
  return String(err?.stderr || err?.message || err).trim().split(/\r?\n/)[0];
}

const SECONDS_PER_MINUTE = 60;

function formatDuration(ms) {
  if (typeof ms !== "number") return "";
  const seconds = Math.round(ms / MS_PER_SECOND);
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
}

function formatCost(usd) {
  return typeof usd === "number" ? `$${usd.toFixed(COST_DECIMALS)}` : "";
}

const tableCell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** Markdown body for the run's pull request: totals, then one row per slice. */
export function buildPullRequestBody(summary) {
  const r = summary.results ?? {};
  const rows = (summary.sliceResults ?? []).map((s) => `| ${tableCell(s.number ?? s.sliceId)} | ${tableCell(s.title)} | ${tableCell(s.status)} | ${formatDuration(s.duration)} | ${formatCost(s.cost?.cost_usd)} |`);
  return [
    `Opened by \`pforge run-plan\` for **${summary.phase ?? "a plan"}** (${summary.status ?? "unknown"}).`,
    "",
    `**Slices:** ${r.passed ?? 0} passed, ${r.failed ?? 0} failed, ${r.skipped ?? 0} skipped. `
      + `**Duration:** ${formatDuration(summary.totalDuration) || "n/a"}. **Cost:** ${formatCost(summary.cost?.total_cost_usd) || "n/a"}.`,
    "",
    "| Slice | Title | Status | Duration | Cost |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
