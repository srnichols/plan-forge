#!/usr/bin/env node
/**
 * Release rehearsal (#300) — run before tagging, on the release commit.
 *
 *   node scripts/release/rehearse.mjs [--release-ref HEAD] [--previous-tag vX.Y.Z]
 *        [--preset typescript] [--checks scripts/release/release-checks.json]
 *        [--logs <dir>] [--skip-tag-check]
 *
 * From a `git archive` of the release commit (what consumers download), in
 * PowerShell and Bash:
 *   1. fresh setup into an empty project;
 *   2. setup from the previous release tag, consumer customizations, then update
 *      to the release with the previous release's wrapper and again with the new one.
 * Customizations must survive, the update guard must keep an edited guidance file,
 * and every release-checks.json entry must hold. Exits 1 on any FAIL.
 */

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import {
  Checks, checkTagCollision, commitAll, evaluateFileCheck, expandRef, findBash, git, has, isCleanVersion,
  makeWorkRoot, newConsumer, SHORT_SHA, parseArgs, previousTag, readJson, readText, requirePwsh, runBash, runPwsh,
  sameText, selectFileChecks, shq, toBashPath, versionAt,
} from "./harness.mjs";

const REPO_DEFAULT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CONSUMER_VERSION = "9.8.7";
const MARKER = "<!-- consumer-marker -->";
const GUARD_MARKER = "<!-- guard-marker -->";
const GIT_WORKFLOW = ".github/instructions/git-workflow.instructions.md";

// ─── Shell adapters ─────────────────────────────────────────────────────────

function setupFrom(ctx, { shell, payload, project, name }) {
  const log = join(ctx.root, `${name}-setup-${payload === ctx.src ? "release" : "previous"}.log`);
  if (shell === "ps") {
    return runPwsh(join(payload, "setup.ps1"), ["-Preset", ctx.preset, "-ProjectPath", project, "-ProjectName", name, "-NonInteractive", "-Force"], { cwd: project, log });
  }
  const line = `bash ${shq(toBashPath(ctx.bash, join(payload, "setup.sh")))} --preset ${ctx.preset} --path ${shq(toBashPath(ctx.bash, project))} --name ${shq(name)} --non-interactive --force`;
  return runBash(ctx.bash, line, { cwd: project, log });
}

/** Run the project's own pforge wrapper; `src` in args is replaced by the shell's path to the payload. */
function pforge(ctx, { shell, project, args, log }) {
  const logPath = join(ctx.root, log);
  if (shell === "ps") {
    return { status: runPwsh(join(project, "pforge.ps1"), args.map((a) => (a === "src" ? ctx.src : a)), { cwd: project, log: logPath }), log: logPath };
  }
  const shArgs = args.map((a) => shq(a === "src" ? toBashPath(ctx.bash, ctx.src) : a)).join(" ");
  return { status: runBash(ctx.bash, `cd ${shq(toBashPath(ctx.bash, project))} && bash ./pforge.sh ${shArgs}`, { cwd: project, log: logPath }), log: logPath };
}

// ─── Assertions ─────────────────────────────────────────────────────────────

function assertRelease(ctx, tag, project, { fresh = false, previousWrapper = false } = {}) {
  const cfg = readJson(join(project, ".forge.json")) ?? {};
  ctx.checks.add(`${tag} templateVersion = ${ctx.version}`, cfg.templateVersion === ctx.version, cfg.templateVersion);
  for (const check of selectFileChecks(ctx.spec, { preset: ctx.preset, fresh, previousWrapper })) {
    const { ok, detail } = evaluateFileCheck(project, check);
    ctx.checks.add(`${tag} ${check.label}`, ok, detail);
  }
}

/** A stack preset's own testing/security instructions win over the shared copies (#280). */
function assertStackInstructions(ctx, tag, project) {
  for (const name of ["testing", "security"]) {
    const rel = `.github/instructions/${name}.instructions.md`;
    const presetCopy = join(ctx.src, "presets", ctx.preset, rel);
    const expected = existsSync(presetCopy) ? presetCopy : join(ctx.src, "presets", "shared", rel);
    ctx.checks.add(`${tag} ${name}.instructions matches the ${existsSync(presetCopy) ? ctx.preset : "shared"} preset copy`, sameText(join(project, rel), expected));
  }
}

function assertConsumerKept(ctx, tag, project) {
  ctx.checks.add(`${tag} custom .forge.json key kept`, readJson(join(project, ".forge.json"))?.custom?.keep === "yes");
  ctx.checks.add(`${tag} copilot-instructions customization kept`, has(join(project, ".github/copilot-instructions.md"), MARKER));
  ctx.checks.add(`${tag} customized deploy instructions kept`, has(join(project, ".github/instructions/deploy.instructions.md"), MARKER));
  ctx.checks.add(`${tag} consumer VERSION kept`, readText(join(project, "VERSION")) === CONSUMER_VERSION, readText(join(project, "VERSION")));
}

function assertGuardKept(ctx, tag, project, name) {
  ctx.checks.add(`${tag} edited git-workflow kept`, has(join(project, GIT_WORKFLOW), GUARD_MARKER));
  ctx.checks.add(`${tag} pending copy of git-workflow written`, existsSync(join(project, ".forge/update-pending", GIT_WORKFLOW)));
  const step0 = join(project, ".github/prompts/step0-specify-feature.prompt.md");
  ctx.checks.add(`${tag} step0 prompt has no <YOUR PROJECT NAME>`, !has(step0, "<YOUR PROJECT NAME>"));
  ctx.checks.add(`${tag} step0 prompt names the project`, has(step0, name));
  assertStackInstructions(ctx, tag, project);
}

// ─── Consumer preparation ───────────────────────────────────────────────────

function prepareOldConsumer(ctx, shell, name) {
  const project = newConsumer(ctx.root, name);
  setupFrom(ctx, { shell, payload: ctx.old, project, name });
  const cfgPath = join(project, ".forge.json");
  const cfg = readJson(cfgPath) ?? {};
  cfg.custom = { keep: "yes" };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  appendFileSync(join(project, ".github/copilot-instructions.md"), `\n${MARKER}\n`);
  appendFileSync(join(project, ".github/instructions/deploy.instructions.md"), `\n${MARKER}\n`);
  writeFileSync(join(project, "VERSION"), CONSUMER_VERSION);
  commitAll(project, "consumer on previous release");
  return project;
}

function editGitWorkflow(project) {
  appendFileSync(join(project, GIT_WORKFLOW), `\n${GUARD_MARKER}\n`);
  commitAll(project, "consumer edits git workflow");
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

function freshInstall(ctx, shell) {
  const name = `fresh-${shell}`;
  const project = newConsumer(ctx.root, name);
  const status = setupFrom(ctx, { shell, payload: ctx.src, project, name });
  ctx.checks.add(`${name} setup exit 0`, status === 0, `exit ${status}`);
  assertRelease(ctx, name, project, { fresh: true });
  assertStackInstructions(ctx, name, project);
}

function updatePowerShell(ctx) {
  const name = "upd-ps";
  const project = prepareOldConsumer(ctx, "ps", name);
  const run = (args, log) => pforge(ctx, { shell: "ps", project, args, log });

  const first = run(["update", "src", "--force"], `${name}-update1.log`);
  ctx.checks.add(`${name} update with the previous release's wrapper exit 0`, first.status === 0, `exit ${first.status}`);
  assertRelease(ctx, name, project, { previousWrapper: true });
  assertConsumerKept(ctx, name, project);

  const dry = run(["update", "src", "--dry-run"], `${name}-update2.log`);
  ctx.checks.add(`${name} updated wrapper starts cleanly (dry run) exit 0`, dry.status === 0, `exit ${dry.status}`);

  editGitWorkflow(project);
  const guarded = run(["update", "src", "--force"], `${name}-update3.log`);
  ctx.checks.add(`${name} update with the new wrapper exit 0`, guarded.status === 0, `exit ${guarded.status}`);
  ctx.checks.add(`${name} new wrapper reports KEEP for the edited file`, has(guarded.log, "KEEP"));
  assertRelease(ctx, `${name}#3`, project);
  assertGuardKept(ctx, `${name}#3`, project, name);
  assertConsumerKept(ctx, `${name}#3`, project);

  run(["update", "src", "--force", "--overwrite-customized"], `${name}-update4.log`);
  ctx.checks.add(`${name} --overwrite-customized replaced git-workflow`, !has(join(project, GIT_WORKFLOW), GUARD_MARKER));
  ctx.checks.add(`${name} --overwrite-customized backed it up`, findFile(join(project, ".forge/update-backups"), "git-workflow.instructions.md"));
}

function updateBash(ctx) {
  const name = "upd-sh";
  const project = prepareOldConsumer(ctx, "sh", name);
  const run = (args, log) => pforge(ctx, { shell: "sh", project, args, log });

  const first = run(["update", "src", "--force"], `${name}-update1.log`);
  // An older Bash wrapper replaces itself mid-run and may exit non-zero after finishing.
  ctx.checks.add(`${name} update with the previous release's wrapper completed`, has(first.log, "Update complete"), `exit ${first.status}`);
  ctx.checks.note(`${name} after one update with the previous release's Bash wrapper`);
  assertRelease(ctx, `${name}#1`, project, { previousWrapper: true });
  assertConsumerKept(ctx, `${name}#1`, project);

  editGitWorkflow(project);
  const second = run(["update", "src", "--force"], `${name}-update2.log`);
  ctx.checks.add(`${name} update with the new wrapper exit 0`, second.status === 0, `exit ${second.status}`);
  ctx.checks.note(`${name} after a second update with the new wrapper`);
  assertRelease(ctx, `${name}#2`, project);
  assertConsumerKept(ctx, `${name}#2`, project);
  ctx.checks.add(`${name} new wrapper reports KEEP for the edited file`, has(second.log, "KEEP"));
  assertGuardKept(ctx, `${name}#2`, project, name);
}

function findFile(dir, fileName) {
  if (!existsSync(dir)) return false;
  return readdirSync(dir, { recursive: true }).some((p) => String(p).replace(/\\/g, "/").endsWith(fileName));
}

// ─── Main ───────────────────────────────────────────────────────────────────

function buildContext(argv) {
  const args = parseArgs(argv, ["skipTagCheck"]);
  const repo = resolve(args.repo ?? REPO_DEFAULT);
  const ref = args.releaseRef ?? "HEAD";
  const version = versionAt(repo, ref);
  if (!isCleanVersion(version)) {
    throw new Error(`VERSION at ${ref} is ${version}; rehearse the release commit (X.Y.Z, no -dev)`);
  }
  const root = makeWorkRoot("pf-release-rehearsal", args.logs);
  const spec = readJson(resolve(args.checks ?? join(REPO_DEFAULT, "scripts/release/release-checks.json")));
  return {
    args, repo, ref, version, root, spec,
    sha: git(["rev-parse", `${ref}^{commit}`], repo),
    previous: args.previousTag ?? previousTag(repo, version),
    preset: args.preset ?? "typescript",
    bash: findBash(),
    checks: new Checks(),
  };
}

function main() {
  const ctx = buildContext(process.argv.slice(2));
  requirePwsh();
  ctx.checks.note(`rehearsing ${ctx.version} (${ctx.ref} ${ctx.sha.slice(0, SHORT_SHA)}) against ${ctx.previous}, preset ${ctx.preset}`);
  if (!ctx.args.skipTagCheck) checkTagCollision(ctx.checks, ctx.repo, ctx.version, ctx.sha);
  ctx.src = expandRef(ctx.repo, ctx.ref, join(ctx.root, "release"));
  ctx.old = expandRef(ctx.repo, ctx.previous, join(ctx.root, "previous"));

  freshInstall(ctx, "ps");
  freshInstall(ctx, "sh");
  updatePowerShell(ctx);
  updateBash(ctx);
  return ctx.checks.finish(ctx.root);
}

try {
  process.exitCode = main();
} catch (err) {
  console.error(`rehearse: ${err.message}`);
  process.exitCode = 2;
}
