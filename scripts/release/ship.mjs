#!/usr/bin/env node
/**
 * Plan Forge — release automation (maintainer-only).
 *
 * Runs docs/RELEASE-CHECKLIST.md §3 end to end: sync planning/main → master in
 * the release worktree, promote the CHANGELOG, set VERSION, commit, rehearse,
 * push, tag, cut the GitHub Release, verify it publicly, bump back to -dev, and
 * sync master → planning/main. Every step is the command the checklist names.
 *
 * Usage:
 *   node scripts/release/ship.mjs --version 3.31.0 --title "Safer runs" \
 *     --worktree ../Plan-Forge-release-3.26.6            # dry run: preflight + plan
 *   node scripts/release/ship.mjs ... --execute           # run it
 *   node scripts/release/ship.mjs ... --execute --from-step tag   # resume after a failure
 *
 * --planning defaults to this checkout (planning/main); --date to today (UTC).
 * Nothing is pushed in a dry run. A failed step stops the run; fix the cause
 * and resume with --from-step <id>.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const UNRELEASED = "## [Unreleased]";
const RELEASE_HEADING = /^## \[\d+\.\d+\.\d+\]/m;
/** `git status --porcelain` prints a two-letter status and a space before each path. */
const PORCELAIN_STATUS_WIDTH = 3;
const ISO_DATE_LENGTH = "YYYY-MM-DD".length;

/** The files a release or bump-back commit may change. */
export const RELEASE_FILES = Object.freeze([
  "VERSION", "package.json", "package-lock.json", "pforge-mcp/package.json",
  "pforge-mcp/package-lock.json", "pforge-master/package.json", "CHANGELOG.md",
]);

function parseVersion(version) {
  const match = String(version).match(SEMVER);
  if (!match) throw new Error(`version must be X.Y.Z, got "${version}"`);
  return match.slice(1).map(Number);
}

function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** @returns {"major"|"minor"|"patch"} */
export function releaseSegment(version) {
  const [, minor, patch] = parseVersion(version);
  if (patch > 0) return "patch";
  return minor > 0 ? "minor" : "major";
}

/** The -dev version after `version`, for the same segment (RELEASE-CHECKLIST §3 Step 9). */
export function nextDevVersion(version) {
  const [major, minor, patch] = parseVersion(version);
  const segment = releaseSegment(version);
  if (segment === "patch") return `${major}.${minor}.${patch + 1}-dev`;
  if (segment === "minor") return `${major}.${minor + 1}.0-dev`;
  return `${major + 1}.0.0-dev`;
}

function splitUnreleased(text) {
  const start = text.indexOf(UNRELEASED);
  if (start < 0) throw new Error("CHANGELOG has no [Unreleased] section");
  const bodyStart = start + UNRELEASED.length;
  const rest = text.slice(bodyStart);
  const next = rest.search(RELEASE_HEADING);
  const bodyEnd = next < 0 ? text.length : bodyStart + next;
  return { head: text.slice(0, start), body: text.slice(bodyStart, bodyEnd), tail: text.slice(bodyEnd) };
}

/** Move [Unreleased] under `## [X.Y.Z] — date — title`, keeping an empty [Unreleased]. */
export function promoteChangelog(text, { version, date, title }) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  if (text.includes(`## [${version}]`)) throw new Error(`CHANGELOG already has a [${version}] section`);
  const { head, body, tail } = splitUnreleased(text);
  const content = body.trim();
  if (!content) throw new Error("CHANGELOG [Unreleased] is empty — nothing to release");
  return `${head}${UNRELEASED}${eol}${eol}## [${version}] — ${date} — ${title}${eol}${eol}${content}${eol}${eol}${tail}`;
}

/** The body of the `## [version]` section, for the tag message and release notes. */
export function releaseNotes(text, version) {
  const normalized = text.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(`## [${version}]`);
  if (start < 0) throw new Error(`CHANGELOG has no [${version}] section`);
  const afterHeading = normalized.indexOf("\n", start) + 1;
  const rest = normalized.slice(afterHeading);
  const next = rest.search(/^## \[/m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

/** Changed files outside RELEASE_FILES. */
export function unexpectedReleaseChanges(files) {
  return files.filter((file) => !RELEASE_FILES.includes(file));
}

// ─── Preflight ────────────────────────────────────────────────────────

const PRECONDITION_QUERIES = ({ version, worktree, planningRepo }) => [
  { key: "fetch", cmd: "git", args: ["fetch", "--quiet", "origin"], cwd: planningRepo },
  { key: "planning:branch", cmd: "git", args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: planningRepo },
  { key: "planning:status", cmd: "git", args: ["status", "--porcelain"], cwd: planningRepo },
  { key: "planning:ahead-behind", cmd: "git", args: ["rev-list", "--left-right", "--count", "origin/planning/main...HEAD"], cwd: planningRepo },
  { key: "worktree:branch", cmd: "git", args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: worktree },
  { key: "worktree:status", cmd: "git", args: ["status", "--porcelain"], cwd: worktree },
  { key: "tags", cmd: "git", args: ["tag", "--list", "v*", "--sort=-v:refname"], cwd: planningRepo },
  { key: "remote-tag", cmd: "git", args: ["ls-remote", "--tags", "origin", `v${version}`], cwd: planningRepo },
  { key: "gh", cmd: "gh", args: ["auth", "status"], cwd: planningRepo },
];

function queryAll(queries, exec) {
  const answers = {};
  for (const query of queries) {
    try {
      answers[query.key] = String(exec(query) ?? "").trim();
    } catch (err) {
      answers[query.key] = err;
    }
  }
  return answers;
}

function branchProblems(a) {
  const problems = [];
  if (a["planning:branch"] !== "planning/main") problems.push(`planning checkout is on "${a["planning:branch"]}", not planning/main`);
  if (a["planning:status"]) problems.push("planning checkout has uncommitted changes");
  const [behind, ahead] = String(a["planning:ahead-behind"]).split(/\s+/).map(Number);
  if (behind || ahead) problems.push(`planning/main is ${ahead} ahead / ${behind} behind origin — push or pull first`);
  if (a["worktree:branch"] !== "master") problems.push(`release worktree is on "${a["worktree:branch"]}", not master`);
  if (a["worktree:status"]) problems.push("release worktree has uncommitted changes");
  return problems;
}

const releaseTags = (tagsText) => String(tagsText || "").split(/\s+/).filter((t) => SEMVER.test(t.replace(/^v/, "")));

/** The highest vX.Y.Z tag below `version`, from `git tag --sort=-v:refname` output. */
export function previousTagFor(version, tagsText) {
  return releaseTags(tagsText).find((t) => compareVersions(t.slice(1), version) < 0) ?? null;
}

function versionProblems(a, version) {
  const latest = releaseTags(a.tags)[0];
  const problems = [];
  if (latest && compareVersions(version, latest.slice(1)) <= 0) problems.push(`v${version} is not newer than the latest tag ${latest}`);
  if (a["remote-tag"] && !(a["remote-tag"] instanceof Error)) problems.push(`tag v${version} already exists on origin`);
  return { problems, previousTag: previousTagFor(version, a.tags) };
}

/**
 * @param {{ version: string, worktree: string, planningRepo: string, changelog: string, exec?: Function }} opts
 * @returns {{ ok: boolean, problems: string[], previousTag: string|null }}
 */
export function checkPreconditions({ version, worktree, planningRepo, changelog, exec = defaultExec }) {
  const answers = queryAll(PRECONDITION_QUERIES({ version, worktree, planningRepo }), exec);
  const problems = branchProblems(answers);
  if (answers.gh instanceof Error) problems.push("gh is not signed in — run gh auth login");
  const versions = versionProblems(answers, version);
  problems.push(...versions.problems);
  try {
    if (!splitUnreleased(changelog).body.trim()) problems.push("CHANGELOG [Unreleased] is empty");
  } catch (err) {
    problems.push(err.message);
  }
  return { ok: problems.length === 0, problems, previousTag: versions.previousTag };
}

function defaultExec({ cmd, args, cwd }) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

// ─── Steps ────────────────────────────────────────────────────────────

function syncMasterCommand(direction, platform) {
  return platform === "win32"
    ? { cmd: "pwsh", args: ["-NoProfile", "-File", "scripts/sync-master.ps1", "-Direction", direction] }
    : { cmd: "bash", args: ["scripts/sync-master.sh", direction] };
}

const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
const describeCommand = ({ cmd, args }) => [cmd, ...args].map(quote).join(" ");

function commandStep({ id, title, cwd, command, env }) {
  return { id, title, cwd, describe: describeCommand(command), run: (ctx) => ctx.runCommand(command, { cwd, env }) };
}

function changedFiles(ctx, cwd) {
  return ctx.capture({ cmd: "git", args: ["status", "--porcelain"] }, { cwd })
    .split(/\r?\n/).filter(Boolean).map((line) => line.slice(PORCELAIN_STATUS_WIDTH).trim());
}

function commitReleaseFiles(ctx, { cwd, message, allowChangelog = true }) {
  const files = changedFiles(ctx, cwd);
  const allowed = allowChangelog ? RELEASE_FILES : RELEASE_FILES.filter((f) => f !== "CHANGELOG.md");
  const unexpected = files.filter((f) => !allowed.includes(f));
  if (unexpected.length > 0) throw new Error(`unexpected changes, refusing to commit: ${unexpected.join(", ")}`);
  ctx.runCommand({ cmd: "git", args: ["add", ...files] }, { cwd });
  ctx.runCommand({ cmd: "git", args: ["commit", "-q", ...message.flatMap((m) => ["-m", m])] }, { cwd });
}

function tagStep({ version, title, worktree }) {
  const tag = `v${version}`;
  return {
    id: "tag", title: "Annotate the tag at the release commit", cwd: worktree,
    describe: `git tag -a --cleanup=verbatim -F <${tag} notes from CHANGELOG> ${tag} HEAD`,
    run(ctx) {
      const notes = releaseNotes(readFileSync(join(worktree, "CHANGELOG.md"), "utf8"), version);
      const dir = mkdtempSync(join(tmpdir(), "pf-ship-"));
      try {
        const file = join(dir, "tag-message.txt");
        writeFileSync(file, `${tag} - ${title}\n\n${notes}\n`);
        ctx.runCommand({ cmd: "git", args: ["tag", "-a", "--cleanup=verbatim", "-F", file, tag, "HEAD"] }, { cwd: worktree });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      const tagged = ctx.capture({ cmd: "git", args: ["show", `${tag}:VERSION`] }, { cwd: worktree }).trim();
      if (tagged !== version) throw new Error(`${tag}:VERSION is "${tagged}", expected ${version}`);
    },
  };
}

function releaseSteps({ version, title, date, previousTag, worktree, platform }) {
  const tag = `v${version}`;
  const node = process.execPath;
  return [
    commandStep({ id: "sync-to-master", title: "Fast-forward master to planning/main and scrub dev-only files", cwd: worktree, command: syncMasterCommand("to-master", platform) }),
    {
      id: "promote-changelog", title: "Promote [Unreleased] in CHANGELOG.md", cwd: worktree,
      describe: `CHANGELOG.md: [Unreleased] → [${version}] — ${date} — ${title}`,
      run() {
        const file = join(worktree, "CHANGELOG.md");
        writeFileSync(file, promoteChangelog(readFileSync(file, "utf8"), { version, date, title }));
      },
    },
    commandStep({ id: "set-version", title: "Set VERSION and package versions", cwd: worktree, command: { cmd: node, args: ["scripts/sync-versions.mjs", version] } }),
    {
      id: "release-commit", title: "Commit the release", cwd: worktree,
      describe: `git add <version files + CHANGELOG.md>; git commit -m "chore(release): ${tag}" -m "${title}"`,
      run: (ctx) => commitReleaseFiles(ctx, { cwd: worktree, message: [`chore(release): ${tag}`, title] }),
    },
    commandStep({ id: "rehearse", title: "Rehearse the release commit", cwd: worktree, command: { cmd: node, args: ["scripts/release/rehearse.mjs", "--release-ref", "HEAD", "--previous-tag", previousTag] } }),
    commandStep({ id: "push-master", title: "Push master", cwd: worktree, command: { cmd: "git", args: ["push", "origin", "master"] } }),
    tagStep({ version, title, worktree }),
    commandStep({ id: "push-tag", title: "Push the tag", cwd: worktree, command: { cmd: "git", args: ["push", "origin", tag] } }),
    commandStep({ id: "github-release", title: "Cut the GitHub Release", cwd: worktree, command: { cmd: "gh", args: ["release", "create", tag, "--notes-from-tag", "--verify-tag", "--title", `${tag} - ${title}`] } }),
  ];
}

function postReleaseSteps({ version, previousTag, worktree, planningRepo, platform }) {
  const next = nextDevVersion(version);
  return [
    {
      id: "verify-public", title: "Verify the Release over the public download", cwd: worktree,
      describe: `GITHUB_TOKEN=$(gh auth token) node scripts/release/verify-public.mjs --expected-version ${version} --previous-tag ${previousTag}`,
      run(ctx) {
        const token = ctx.capture({ cmd: "gh", args: ["auth", "token"] }, { cwd: worktree }).trim();
        ctx.runCommand(
          { cmd: process.execPath, args: ["scripts/release/verify-public.mjs", "--expected-version", version, "--previous-tag", previousTag] },
          { cwd: worktree, env: { ...process.env, GITHUB_TOKEN: token } },
        );
      },
    },
    {
      id: "bump-dev", title: `Bump back to ${next}`, cwd: worktree,
      describe: `node scripts/sync-versions.mjs ${next}; git commit -m "chore: bump VERSION to ${next}"; git push origin master`,
      run(ctx) {
        ctx.runCommand({ cmd: process.execPath, args: ["scripts/sync-versions.mjs", next] }, { cwd: worktree });
        commitReleaseFiles(ctx, { cwd: worktree, message: [`chore: bump VERSION to ${next}`], allowChangelog: false });
        ctx.runCommand({ cmd: "git", args: ["push", "origin", "master"] }, { cwd: worktree });
      },
    },
    commandStep({ id: "sync-to-planning", title: "Bring master back into planning/main", cwd: planningRepo, command: syncMasterCommand("to-planning", platform) }),
    commandStep({ id: "push-planning", title: "Push planning/main", cwd: planningRepo, command: { cmd: "git", args: ["push", "origin", "planning/main"] } }),
  ];
}

/**
 * The release, as an ordered list of steps: { id, title, cwd, describe, run(ctx) }.
 * @param {{ version: string, title: string, date: string, previousTag: string, worktree: string, planningRepo: string, platform?: string }} opts
 */
export function buildReleaseSteps({ platform = process.platform, ...opts }) {
  return [...releaseSteps({ ...opts, platform }), ...postReleaseSteps({ ...opts, platform })];
}

// ─── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { execute: false, planningRepo: REPO_ROOT, date: new Date().toISOString().slice(0, ISO_DATE_LENGTH) };
  const valueFlags = { "--version": "version", "--title": "title", "--worktree": "worktree", "--planning": "planningRepo", "--date": "date", "--from-step": "fromStep" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--execute") opts.execute = true;
    else if (valueFlags[argv[i]]) opts[valueFlags[argv[i]]] = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  for (const required of ["version", "title", "worktree"]) {
    if (!opts[required]) throw new Error(`--${required} is required`);
  }
  parseVersion(opts.version);
  return { ...opts, worktree: resolve(opts.worktree), planningRepo: resolve(opts.planningRepo) };
}

const liveContext = {
  runCommand({ cmd, args }, { cwd, env } = {}) {
    const result = spawnSync(cmd, args, { cwd, env: env ?? process.env, stdio: "inherit", windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${describeCommand({ cmd, args })} exited ${result.status}`);
  },
  capture: ({ cmd, args }, { cwd } = {}) => defaultExec({ cmd, args, cwd }),
};

function selectSteps(steps, fromStep) {
  if (!fromStep) return steps;
  const index = steps.findIndex((step) => step.id === fromStep);
  if (index < 0) throw new Error(`unknown step "${fromStep}"; steps: ${steps.map((s) => s.id).join(", ")}`);
  return steps.slice(index);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const changelog = readFileSync(join(opts.planningRepo, "CHANGELOG.md"), "utf8");
  // Resuming skips preflight: the release is half done, so "clean and in sync" no longer holds.
  const preflight = opts.fromStep
    ? { ok: true, problems: [], previousTag: null }
    : checkPreconditions({ version: opts.version, worktree: opts.worktree, planningRepo: opts.planningRepo, changelog });
  const previousTag = preflight.previousTag
    ?? previousTagFor(opts.version, defaultExec({ cmd: "git", args: ["tag", "--list", "v*", "--sort=-v:refname"], cwd: opts.planningRepo }));
  if (!preflight.ok) {
    console.error("Preflight failed:");
    for (const problem of preflight.problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }
  const steps = selectSteps(buildReleaseSteps({ ...opts, previousTag }), opts.fromStep);
  console.log(`Release v${opts.version} — ${opts.title} (previous ${previousTag})${opts.execute ? "" : " — DRY RUN"}`);
  for (const [i, step] of steps.entries()) {
    console.log(`\n[${i + 1}/${steps.length}] ${step.id}: ${step.title}\n    ${step.cwd}\n    $ ${step.describe}`);
    if (!opts.execute) continue;
    try {
      await step.run(liveContext);
    } catch (err) {
      console.error(`\n✗ ${step.id} failed: ${err.message}\nFix the cause, then resume with --execute --from-step ${step.id}`);
      process.exit(1);
    }
  }
  console.log(opts.execute ? `\n✓ v${opts.version} released.` : "\nDry run only. Re-run with --execute to release.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
