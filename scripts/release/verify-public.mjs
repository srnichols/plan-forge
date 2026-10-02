#!/usr/bin/env node
/**
 * Public self-update verification (#300) — run after the GitHub Release is published.
 *
 *   node scripts/release/verify-public.mjs [--expected-version X.Y.Z] [--previous-tag vX.Y.Z]
 *        [--preset dotnet] [--checks scripts/release/release-checks.json] [--logs <dir>]
 *
 * Projects installed from the previous release run `pforge self-update`, which
 * downloads and extracts the latest GitHub release. This is the path a local
 * rehearsal cannot cover. PowerShell and Bash, with and without a root VERSION
 * file of the project's own. Set GITHUB_TOKEN to avoid API rate limits.
 * Exits 1 on any FAIL.
 */

import { appendFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Checks, commitAll, evaluateFileCheck, expandRef, findBash, has, makeWorkRoot, newConsumer, parseArgs,
  previousTag, readJson, readText, requirePwsh, runBash, runPwsh, selectFileChecks, shq, toBashPath,
} from "./harness.mjs";

const REPO_DEFAULT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CONSUMER_VERSION = "9.8.7";
const GUARD_MARKER = "<!-- guard-marker -->";
const GIT_WORKFLOW = ".github/instructions/git-workflow.instructions.md";

/** The tag `pforge self-update` will install: the latest GitHub release. */
function latestReleaseVersion(repo) {
  const r = spawnSync(process.execPath, [join(repo, "pforge-mcp/update-from-github.mjs"), "resolve-tag"], { encoding: "utf8" });
  const parsed = JSON.parse(r.stdout || "{}");
  if (!parsed.ok) throw new Error(`could not resolve the latest release: ${r.stdout}${r.stderr}`);
  return parsed.tag.replace(/^v/, "");
}

function installPrevious(ctx, { shell, name, withVersion }) {
  const project = newConsumer(ctx.root, name);
  const log = join(ctx.root, `${name}-setup.log`);
  if (shell === "ps") {
    runPwsh(join(ctx.old, "setup.ps1"), ["-Preset", ctx.preset, "-ProjectPath", project, "-ProjectName", name, "-NonInteractive", "-Force"], { cwd: project, log });
  } else {
    runBash(ctx.bash, `bash ${shq(toBashPath(ctx.bash, join(ctx.old, "setup.sh")))} --preset ${ctx.preset} --path ${shq(toBashPath(ctx.bash, project))} --name ${shq(name)} --non-interactive --force`, { cwd: project, log });
  }
  if (withVersion) writeFileSync(join(project, "VERSION"), CONSUMER_VERSION);
  commitAll(project, "consumer on previous release");
  return project;
}

function selfUpdate(ctx, { shell, project, log }) {
  const logPath = join(ctx.root, log);
  const status = shell === "ps"
    ? runPwsh(join(project, "pforge.ps1"), ["self-update", "--yes", "--force"], { cwd: project, log: logPath })
    : runBash(ctx.bash, `cd ${shq(toBashPath(ctx.bash, project))} && bash ./pforge.sh self-update --yes --force`, { cwd: project, log: logPath });
  return { status, log: logPath };
}

function assertUpdated(ctx, tag, project, withVersion) {
  const cfg = readJson(join(project, ".forge.json")) ?? {};
  ctx.checks.add(`${tag} templateVersion = ${ctx.version}`, cfg.templateVersion === ctx.version, cfg.templateVersion);
  for (const check of selectFileChecks(ctx.spec, { preset: ctx.preset, fresh: false })) {
    const { ok, detail } = evaluateFileCheck(project, check);
    ctx.checks.add(`${tag} ${check.label}`, ok, detail);
  }
  if (withVersion) ctx.checks.add(`${tag} consumer VERSION kept`, readText(join(project, "VERSION")) === CONSUMER_VERSION);
}

/** Edit a guidance file, self-update again, and expect the guard to keep the edit (#280). */
function assertGuardOnSecondUpdate(ctx, { shell, project, name }) {
  appendFileSync(join(project, GIT_WORKFLOW), `\n${GUARD_MARKER}\n`);
  commitAll(project, "consumer edits git workflow");
  const run = selfUpdate(ctx, { shell, project, log: `${name}-guarded.log` });
  ctx.checks.add(`${name} self-update after an edit exit 0`, run.status === 0, `exit ${run.status}`);
  ctx.checks.add(`${name} reports KEEP for the edited file`, has(run.log, "KEEP"));
  ctx.checks.add(`${name} edited git-workflow kept`, has(join(project, GIT_WORKFLOW), GUARD_MARKER));
  ctx.checks.add(`${name} pending copy written`, existsSync(join(project, ".forge/update-pending", GIT_WORKFLOW)));
  ctx.checks.add(`${name} left no update-* download in .forge/cache (#298)`, !hasUpdateCache(project));
}

function hasUpdateCache(project) {
  const cache = join(project, ".forge/cache");
  return existsSync(cache) && readdirSync(cache).some((n) => n.startsWith("update-"));
}

/** PowerShell project with its own root VERSION: one self-update, then a guarded one. */
function powershellScenario(ctx) {
  const name = "public-ps";
  const project = installPrevious(ctx, { shell: "ps", name, withVersion: true });
  const run = selfUpdate(ctx, { shell: "ps", project, log: `${name}.log` });
  ctx.checks.add(`${name} self-update exit 0`, run.status === 0, `exit ${run.status}`);
  assertUpdated(ctx, name, project, true);
  assertGuardOnSecondUpdate(ctx, { shell: "ps", project, name });
}

/** Bash project: the previous wrapper's self-update, the new wrapper's, then a guarded one. */
function bashScenario(ctx, { withVersion }) {
  const name = withVersion ? "public-sh-version" : "public-sh";
  const project = installPrevious(ctx, { shell: "sh", name, withVersion });
  const first = selfUpdate(ctx, { shell: "sh", project, log: `${name}-1.log` });
  // The previous Bash wrapper replaces itself mid-run and may exit non-zero after finishing.
  ctx.checks.add(`${name} previous wrapper's self-update completed`, has(first.log, "Update complete"), `exit ${first.status}`);
  if (withVersion) ctx.checks.add(`${name} self-update read .forge.json, not the project's VERSION (#297)`, !has(first.log, `v${CONSUMER_VERSION}`));
  const second = selfUpdate(ctx, { shell: "sh", project, log: `${name}-2.log` });
  ctx.checks.add(`${name} new wrapper's self-update exit 0`, second.status === 0, `exit ${second.status}`);
  ctx.checks.add(`${name} new wrapper has no syntax error`, !has(second.log, "syntax error"));
  assertUpdated(ctx, name, project, withVersion);
  assertGuardOnSecondUpdate(ctx, { shell: "sh", project, name });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = resolve(args.repo ?? REPO_DEFAULT);
  const version = args.expectedVersion ?? latestReleaseVersion(repo);
  const ctx = {
    repo, version,
    previous: args.previousTag ?? previousTag(repo, version),
    preset: args.preset ?? "dotnet",
    root: makeWorkRoot("pf-release-public", args.logs),
    spec: readJson(resolve(args.checks ?? join(REPO_DEFAULT, "scripts/release/release-checks.json"))),
    bash: findBash(),
    checks: new Checks(),
  };
  requirePwsh();
  ctx.checks.note(`verifying public self-update to ${version} from ${ctx.previous}, preset ${ctx.preset}`);
  ctx.old = expandRef(repo, ctx.previous, join(ctx.root, "previous"));

  powershellScenario(ctx);
  bashScenario(ctx, { withVersion: false });
  bashScenario(ctx, { withVersion: true });
  return ctx.checks.finish(ctx.root);
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`verify-public: ${err.message}`);
  process.exitCode = 2;
}
