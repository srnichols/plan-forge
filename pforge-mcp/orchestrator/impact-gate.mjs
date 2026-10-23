/**
 * Plan Forge — impact gate (recommendation 2).
 *
 * A slice's validation gate checks what the plan author thought to check.
 * After it passes, this runs the tests related to the files the slice
 * actually changed, so a regression elsewhere fails the slice instead of
 * surfacing later in the full suite.
 *
 * Related tests, in order:
 *   1. test files the slice changed
 *   2. tests named after a changed source file (foo.mjs -> foo.test.mjs,
 *      test_foo.py, foo_test.go, FooTests.cs, foo_spec.rb)
 *   3. tests in the Lattice blast radius, when an index exists
 *
 * Runners: vitest or jest (from package.json), pytest, go test, dotnet test
 * (VSTest or Microsoft.Testing.Platform syntax — see dotnet-test-command.mjs),
 * or `.forge.json` impactGate.command with a {files} placeholder.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join, posix, resolve } from "node:path";
import { computeBlastRadius } from "../forge-tools/regression-guard.mjs";
import { runGate } from "./gate-runner.mjs";
import { isRunnableTestFile, isTestFile } from "../test-files.mjs";
import { buildDotnetTestCommand } from "../dotnet-test-command.mjs";

export { isRunnableTestFile, isTestFile };

const IMPACT_MODES = Object.freeze(["block", "warn", "off"]);
const DEFAULT_MAX_TESTS = 40;
const GIT_TIMEOUT_MS = 15_000;
const JS_TEST_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);

const toPosix = (p) => p.replace(/\\/g, "/");

/**
 * @param {string} cwd
 * @returns {{ mode: "block"|"warn"|"off", command: string|null, maxTests: number }}
 */
export function loadImpactGateConfig(cwd) {
  let raw;
  try {
    const path = resolve(cwd, ".forge.json");
    if (existsSync(path)) raw = JSON.parse(readFileSync(path, "utf8")).impactGate;
  } catch { /* invalid .forge.json: defaults */ }
  const cfg = typeof raw === "string" ? { mode: raw } : (raw ?? {});
  return {
    mode: IMPACT_MODES.includes(cfg.mode) ? cfg.mode : "block",
    command: typeof cfg.command === "string" && cfg.command.includes("{files}") ? cfg.command : null,
    maxTests: Number.isInteger(cfg.maxTests) && cfg.maxTests > 0 ? cfg.maxTests : DEFAULT_MAX_TESTS,
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT_MS });
}

const lines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Files changed since `sinceSha` (committed, modified or untracked) that still exist, sorted. */
export function changedFilesSince({ cwd, sinceSha }) {
  if (!sinceSha) return [];
  try {
    const changed = new Set([
      ...lines(git(cwd, ["diff", "--name-only", sinceSha])),
      ...lines(git(cwd, ["ls-files", "--others", "--exclude-standard"])),
    ]);
    return [...changed].map(toPosix).filter((f) => existsSync(join(cwd, f))).sort();
  } catch {
    return [];
  }
}

/** File stem with test affixes removed: test_models.py, models_test.py, models.test.mjs and ModelsTests.cs all -> "models". */
function testSubjectStem(path) {
  return basename(path).toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/\.(test|spec)$/, "")
    .replace(/^test_/, "")
    .replace(/_(test|spec)$/, "")
    .replace(/tests?$/, "");
}

const sourceStem = (path) => basename(path).toLowerCase().replace(/\.[^.]+$/, "");

/**
 * @returns {{ tests: string[] }} related runnable tests: changed tests, then name matches, then Lattice matches
 */
export function findRelatedTests({ cwd, changedFiles, trackedFiles, blastRadius = computeBlastRadius }) {
  const changedTests = changedFiles.filter(isRunnableTestFile).sort();
  const sources = changedFiles.filter((f) => !isTestFile(f));

  const stems = new Set(sources.map(sourceStem));
  const byName = trackedFiles.filter((f) => isRunnableTestFile(f) && stems.has(testSubjectStem(f))).sort();

  let byLattice = [];
  try {
    byLattice = (blastRadius(sources, { deps: { cwd } })?.tests ?? []).map(toPosix).filter(isRunnableTestFile).sort();
  } catch { /* a broken index must not fail the gate */ }

  return { tests: [...new Set([...changedTests, ...byName, ...byLattice])] };
}

const quote = (p) => `"${p}"`;

/** "vitest run" / "jest" when `script` runs that runner, else null. */
function runnerInScript(script) {
  const text = String(script ?? "");
  if (/\bvitest\b/.test(text)) return "vitest run";
  return /\bjest\b/.test(text) ? "jest" : null;
}

/**
 * "vitest run" / "jest" when the package.json in `dir` declares that runner as a
 * dependency, or runs it from its test script. A workspace package can run a runner
 * it never declares, because it is hoisted from the repo root, so `pforge-sdk`
 * (`"test": "npx vitest run"`, no dependencies) went undetected (meta-bug #371).
 */
function declaredJsRunner(cwd, dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, dir, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return "vitest run";
    if (deps.jest) return "jest";
    return runnerInScript(pkg.scripts?.test);
  } catch { /* no package.json here */ }
  return null;
}

/** Nearest package dir (at or above the test, inside cwd) that declares a JS test runner. */
function jsRunnerFor(cwd, testFile) {
  for (let dir = posix.dirname(testFile); ; dir = posix.dirname(dir)) {
    const runner = declaredJsRunner(cwd, dir);
    if (runner) return { dir, runner };
    if (dir === "." || dir === "") return null;
  }
}

const E2E_CONFIG_NAME = /^(?:playwright|cypress)\.config\.[cm]?[jt]s$/;
const SPEC_FILE_NAME = /\.spec\.[^/]+$/i;

/**
 * A `*.spec.*` file at or below a Playwright or Cypress config belongs to that runner.
 * vitest cannot execute it, so handing it over failed the slice on a test that never
 * ran (meta-bug #372). Any other `*.spec.*` file, a vitest unit spec, is unaffected.
 */
function ownedByE2eRunner(cwd, testFile) {
  if (!SPEC_FILE_NAME.test(testFile)) return false;
  for (let dir = posix.dirname(testFile); ; dir = posix.dirname(dir)) {
    if (readdirSafe(join(cwd, dir)).some((name) => E2E_CONFIG_NAME.test(name))) return true;
    if (dir === "." || dir === "") return false;
  }
}

const SUITE_CONFIG_EXTENSIONS = Object.freeze(["mjs", "js", "ts", "mts", "cjs", "cts"]);

/**
 * `vitest.<suite>.config.*` in the package for a test under `tests/<suite>/`,
 * else null. A package whose e2e suite has its own config excludes that suite
 * from the default one, so the default config reports "no test files" for it.
 */
function suiteConfigFor(cwd, dir, packageRelativeTest) {
  const suite = /^tests\/([^/]+)\//.exec(packageRelativeTest)?.[1];
  if (!suite) return null;
  return SUITE_CONFIG_EXTENSIONS.map((ext) => `vitest.${suite}.config.${ext}`).find((name) => existsSync(join(cwd, dir, name))) ?? null;
}

/**
 * One run per workspace package (and per suite config). The package is the
 * working directory — tests that use process.cwd() expect it, and its own
 * vitest/jest config is the one that loads — and files are package-relative.
 * `--prefix` only moved where the binary resolved, so vitest kept loading the
 * root config and found nothing outside it (meta-bug #321).
 */
function jsCommands(cwd, tests) {
  const groups = new Map();
  const unrunnable = [];
  const e2e = [];
  for (const test of tests) {
    if (ownedByE2eRunner(cwd, test)) { e2e.push(test); continue; }
    const found = jsRunnerFor(cwd, test);
    if (!found) { unrunnable.push(test); continue; }
    const file = found.dir === "." ? test : posix.relative(found.dir, test);
    const config = found.runner.startsWith("vitest") ? suiteConfigFor(cwd, found.dir, file) : null;
    const key = JSON.stringify([found.dir, found.runner, config]);
    if (!groups.has(key)) groups.set(key, { dir: found.dir, runner: found.runner, config, files: [] });
    groups.get(key).files.push(file);
  }
  const runs = [...groups.values()].map(({ dir, runner, config, files }) => ({
    command: `npx ${runner}${config ? ` --config ${config}` : ""} ${files.map(quote).join(" ")}`,
    workdir: dir === "." ? null : dir,
  }));
  return { runs, unrunnable, e2e };
}

/** Nearest *.csproj at or above the test file's directory, inside cwd. */
function nearestCsproj(cwd, testFile) {
  let dir = posix.dirname(testFile);
  for (;;) {
    const abs = join(cwd, dir);
    if (existsSync(abs)) {
      const proj = readdirSafe(abs).find((n) => n.endsWith(".csproj"));
      if (proj) return dir === "." ? proj : `${dir}/${proj}`;
    }
    if (dir === "." || dir === "") return null;
    dir = posix.dirname(dir);
  }
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function dotnetCommands(cwd, tests) {
  const byProject = new Map();
  for (const t of tests) {
    const proj = nearestCsproj(cwd, t);
    if (!proj) return null;
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj).push(basename(t, extname(t)));
  }
  return [...byProject].map(([project, classes]) => buildDotnetTestCommand({ cwd, project, classes }));
}

const EXT_GROUPS = Object.freeze({ ".py": "py", ".go": "go", ".cs": "cs" });

/** Tests grouped by runner family, in command order: js, py, go, cs, other. */
function groupTests(tests) {
  const groups = { js: [], py: [], go: [], cs: [], other: [] };
  for (const t of tests) {
    const ext = extname(t).toLowerCase();
    groups[JS_TEST_EXTENSIONS.has(ext) ? "js" : (EXT_GROUPS[ext] ?? "other")].push(t);
  }
  return groups;
}

/** Runs that belong in the project root: a command string each, no working directory of its own. */
const inRoot = (commands) => commands.map((command) => ({ command, workdir: null }));

/** Per runner family: (cwd, files) -> { runs, unrunnable }. */
const GROUP_COMMANDS = Object.freeze({
  js: (cwd, files) => jsCommands(cwd, files),
  py: (_cwd, files) => ({ runs: inRoot([`python -m pytest ${files.map(quote).join(" ")}`]), unrunnable: [] }),
  go: (_cwd, files) => ({ runs: inRoot([`go test ${[...new Set(files.map((t) => `./${posix.dirname(t)}`))].sort().join(" ")}`]), unrunnable: [] }),
  cs: (cwd, files) => {
    const commands = dotnetCommands(cwd, files);
    return commands ? { runs: inRoot(commands), unrunnable: [] } : { runs: [], unrunnable: files };
  },
  other: (_cwd, files) => ({ runs: [], unrunnable: files }),
});

/** A run as a person would type it: `cd pkg && npx vitest run ...` when it belongs in a package. */
const displayCommand = ({ command, workdir }) => (workdir ? `cd ${workdir} && ${command}` : command);

/** Why some related tests were not run, or "" when all were. */
function skippedMessage({ unrunnable, e2e }) {
  const reasons = [];
  if (unrunnable.length > 0) {
    reasons.push(`no test runner detected for ${unrunnable.join(", ")}; set impactGate.command in .forge.json (e.g. "bundle exec rspec {files}")`);
  }
  if (e2e.length > 0) {
    reasons.push(`${e2e.join(", ")} run under Playwright or Cypress, not vitest; set impactGate.command to run them`);
  }
  return reasons.join("; ");
}

/**
 * @returns {{ commands: string[], runs: Array<{ command: string, workdir: string|null }>, skipped?: string }}
 *   `runs` is what executes (a command and the project-relative directory it
 *   runs in); `commands` is the same list as readable strings.
 */
export function buildImpactCommands({ cwd, tests, config }) {
  if (config.command) {
    const command = config.command.replace("{files}", tests.map(quote).join(" "));
    return { commands: [command], runs: [{ command, workdir: null }] };
  }
  const runs = [];
  const unrunnable = [];
  const e2e = [];
  for (const [group, files] of Object.entries(groupTests(tests))) {
    if (files.length === 0) continue;
    const out = GROUP_COMMANDS[group](cwd, files);
    runs.push(...out.runs);
    unrunnable.push(...out.unrunnable);
    e2e.push(...(out.e2e ?? []));
  }
  const commands = runs.map(displayCommand);
  const skipped = skippedMessage({ unrunnable, e2e });
  return skipped ? { commands, runs, skipped } : { commands, runs };
}

function trackedFiles(cwd) {
  try {
    return lines(git(cwd, ["ls-files"])).map(toPosix);
  } catch {
    return [];
  }
}

/**
 * Run the tests related to what changed since `sinceSha`.
 *
 * @returns {{ ran: boolean, success: boolean, reason?: string, tests?: string[], truncated?: boolean,
 *   commands?: string[], failedCommand?: string, output?: string, skipped?: string }}
 */
export function runImpactGate({ cwd, sinceSha, config, runGateFn = runGate, blastRadius = computeBlastRadius }) {
  if (config.mode === "off") return { ran: false, success: true, reason: "impactGate is off" };
  const changedFiles = changedFilesSince({ cwd, sinceSha });
  if (changedFiles.length === 0) return { ran: false, success: true, reason: "no files changed since the slice started" };

  const related = findRelatedTests({ cwd, changedFiles, trackedFiles: [...new Set([...trackedFiles(cwd), ...changedFiles])], blastRadius }).tests;
  if (related.length === 0) return { ran: false, success: true, reason: "no related tests found for the changed files" };

  const tests = related.slice(0, config.maxTests);
  const truncated = related.length > tests.length;
  const { commands, runs, skipped } = buildImpactCommands({ cwd, tests, config });
  for (const [index, run] of runs.entries()) {
    const result = run.workdir ? runGateFn(run.command, cwd, { workdir: run.workdir }) : runGateFn(run.command, cwd);
    if (!result.success) {
      return { ran: true, success: false, tests, truncated, commands, skipped, failedCommand: commands[index], output: result.output ?? result.error ?? "" };
    }
  }
  return { ran: runs.length > 0, success: true, tests, truncated, commands, skipped };
}
