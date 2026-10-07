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

/** "vitest run" / "jest" when the package.json in `dir` declares that runner, else null. */
function declaredJsRunner(cwd, dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, dir, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.vitest) return "vitest run";
    if (deps.jest) return "jest";
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

/** One command per workspace package: `npx [--prefix <pkg>] <runner> <files>`. */
function jsCommands(cwd, tests) {
  const groups = new Map();
  const unrunnable = [];
  for (const t of tests) {
    const found = jsRunnerFor(cwd, t);
    if (!found) { unrunnable.push(t); continue; }
    const key = `${found.dir}\t${found.runner}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const commands = [...groups].map(([key, files]) => {
    const [dir, runner] = key.split("\t");
    const prefix = dir === "." ? "" : `--prefix ${dir} `;
    return `npx ${prefix}${runner} ${files.map(quote).join(" ")}`;
  });
  return { commands, unrunnable };
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

/** Per runner family: (cwd, files) -> { commands, unrunnable }. */
const GROUP_COMMANDS = Object.freeze({
  js: (cwd, files) => jsCommands(cwd, files),
  py: (_cwd, files) => ({ commands: [`python -m pytest ${files.map(quote).join(" ")}`], unrunnable: [] }),
  go: (_cwd, files) => ({ commands: [`go test ${[...new Set(files.map((t) => `./${posix.dirname(t)}`))].sort().join(" ")}`], unrunnable: [] }),
  cs: (cwd, files) => {
    const commands = dotnetCommands(cwd, files);
    return commands ? { commands, unrunnable: [] } : { commands: [], unrunnable: files };
  },
  other: (_cwd, files) => ({ commands: [], unrunnable: files }),
});

/**
 * @returns {{ commands: string[], skipped?: string }}
 */
export function buildImpactCommands({ cwd, tests, config }) {
  if (config.command) return { commands: [config.command.replace("{files}", tests.map(quote).join(" "))] };
  const commands = [];
  const unrunnable = [];
  for (const [group, files] of Object.entries(groupTests(tests))) {
    if (files.length === 0) continue;
    const out = GROUP_COMMANDS[group](cwd, files);
    commands.push(...out.commands);
    unrunnable.push(...out.unrunnable);
  }
  if (unrunnable.length === 0) return { commands };
  return {
    commands,
    skipped: `no test runner detected for ${unrunnable.join(", ")}; set impactGate.command in .forge.json (e.g. "bundle exec rspec {files}")`,
  };
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
  const { commands, skipped } = buildImpactCommands({ cwd, tests, config });
  for (const command of commands) {
    const result = runGateFn(command, cwd);
    if (!result.success) {
      return { ran: true, success: false, tests, truncated, commands, skipped, failedCommand: command, output: result.output ?? result.error ?? "" };
    }
  }
  return { ran: commands.length > 0, success: true, tests, truncated, commands, skipped };
}
