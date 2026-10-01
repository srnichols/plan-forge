/**
 * Meta-bugs #283, #286 — `pforge diff` (forge_diff) and `pforge analyze`
 * (forge_analyze) misread a plan's scope contract:
 *
 *   pforge.ps1  '(?s)### Forbidden Actions(.*?)(?=^###?\s|\z)' had no (?m), so
 *               "^" never matched mid-file and the section ran to EOF. Every
 *               backticked slice scope after it became a "forbidden" path, and
 *               `-like "*$hint*"` read a backticked "[parallel-safe]" tag as a
 *               character class that matched nearly every file.
 *   pforge.sh   awk '/### Forbidden Actions/,/^###? /' ended the range on its
 *               own heading line, so both lists were always empty — the
 *               opposite failure: nothing was ever forbidden.
 *
 * Meta-bug #284 — `pforge analyze` aborted under Windows PowerShell 5.1 with
 * "A parameter cannot be found that matches parameter name 'Raw'" when a test
 * file lived under a bracketed route directory such as `app/[id]/`.
 *
 * Both shells now share one contract: sections stop at the next heading, and
 * hints are literal text whose only wildcard is "*".
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const PLAN_REL = "docs/plans/Phase-7-SCOPE-FIXTURE-PLAN.md";

// Git Bash on Windows; plain bash elsewhere. WSL's System32 bash is avoided on
// purpose — it runs in a different filesystem namespace.
const GIT_BASH_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];
const BASH = isWin ? GIT_BASH_CANDIDATES.find((p) => existsSync(p)) : "bash";

const PLAN = [
  "# Phase 7 — Scope Fixture",
  "",
  "## Scope Contract",
  "",
  "### In Scope",
  "- `src/app/**`",
  "",
  "### Forbidden Actions",
  "- Do not modify `infra/**`",
  "- Never strip the `[parallel-safe]` tag from slice headings",
  "- Do not use `*` globs in gates",
  "- Keep `retries` at `0`, `strict` set to `true`, and never run `git push --force`",
  "",
  "## Acceptance Criteria",
  "- **MUST**: Items endpoint returns paginated results",
  "",
  "## Execution Slices",
  "",
  "### Slice 1 — Items endpoint [parallel-safe]",
  "",
  "**Scope** (files in scope):",
  "- `src/app/items.ts`",
  "- `src/app/[id]/page.test.ts`",
  "",
  "1. Implement the paginated items endpoint.",
  "",
  "**Validation Gate**:",
  "```bash",
  "npm test",
  "```",
  "",
].join("\n");

const TRACKED_FILES = {
  "src/app/items.ts": "export const items = [];\n",
  "src/app/[id]/page.test.ts": "it('returns paginated items endpoint results', () => {});\n",
  "infra/main.tf": "# infrastructure\n",
  "docs/notes.md": "notes\n",
  "docs/v10/strict-true.md": "prose tokens `0`, `strict` and `true` must not match this path\n",
};

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A repo whose four tracked files all carry unstaged edits, plus the plan and both CLIs. */
function seedRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-283-"));
  tmpDirs.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "meta-283@example.invalid");
  git(dir, "config", "user.name", "Meta 283");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "core.autocrlf", "false");
  const files = { ...TRACKED_FILES, [PLAN_REL]: PLAN };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  for (const rel of Object.keys(TRACKED_FILES)) appendFileSync(join(dir, rel), "// edited\n");
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(dir, "pforge.ps1"));
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(dir, "pforge.sh"));
  return dir;
}

function runPs1(dir, ...args) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, "pforge.ps1"), ...args],
    { cwd: dir, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" }, timeout: 120_000 },
  );
}

function runSh(dir, ...args) {
  return spawnSync(BASH, ["pforge.sh", ...args], {
    cwd: dir,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 120_000,
  });
}

// Stands in for pforge-mcp/orchestrator/gate-helpers.mjs so analyze's lint
// wiring (env vars, file:// import, output, scoring) is exercised in isolation.
const FAKE_GATE_LINT = [
  "export function lintGateCommands(planPath) {",
  "  const name = planPath.split(/[\\\\/]/).pop();",
  "  return { errors: [{ message: \"fixture error for \" + name }], warnings: [{ message: \"fixture warning\" }] };",
  "}",
  "",
].join("\n");

function withFakeGateLint(dir) {
  mkdirSync(join(dir, "pforge-mcp", "orchestrator"), { recursive: true });
  writeFileSync(join(dir, "pforge-mcp", "orchestrator", "gate-helpers.mjs"), FAKE_GATE_LINT);
  return dir;
}

function expectGateLintReport(output) {
  expect(output).toMatch(/Gate lint: 1 error\(s\) — plan will fail at runtime/);
  expect(output).toMatch(/^\s+fixture error for Phase-7-SCOPE-FIXTURE-PLAN\.md$/m);
  expect(output).toMatch(/Gate lint: 1 warning\(s\)/);
  expect(output).toMatch(/^\s+fixture warning$/m);
}

function lineFor(output, file) {
  return output.split(/\r?\n/).find((l) => l.includes(`  ${file}`)) || "";
}

function expectDiffVerdicts(result) {
  const out = result.stdout;
  expect(lineFor(out, "infra/main.tf"), out).toMatch(/FORBIDDEN\s+infra\/main\.tf\s+\(matches: infra\/\*\*\)/);
  expect(lineFor(out, "src/app/items.ts"), out).toMatch(/IN SCOPE/);
  expect(lineFor(out, "src/app/[id]/page.test.ts"), out).toMatch(/IN SCOPE/);
  expect(lineFor(out, "docs/notes.md"), out).toMatch(/UNPLANNED/);
  expect(lineFor(out, "docs/v10/strict-true.md"), out).toMatch(/UNPLANNED/);
  expect(out).toMatch(/DRIFT DETECTED — 1 forbidden file\(s\) touched/);
  expect(result.status).toBe(1);
}

describe.skipIf(!isWin)("pforge.ps1 diff/analyze honor the scope contract (meta #283, #284, #286)", () => {
  it("diff bounds Forbidden Actions at the next heading and matches hints literally", () => {
    const dir = seedRepo();
    expectDiffVerdicts(runPs1(dir, "diff", PLAN_REL));
  });

  it("analyze completes under Windows PowerShell 5.1 with a bracketed test path", () => {
    const dir = seedRepo();
    const result = runPs1(dir, "analyze", PLAN_REL);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).not.toMatch(/parameter name 'Raw'/);
    expect(out).toMatch(/Consistency Score: \d+\/100/);
    expect(out).toMatch(/1 forbidden file\(s\) touched/);
    expect(out).toMatch(/1 MUST criteria have matching tests/);
  });

  it("analyze reports the plan's gate lint", () => {
    const dir = withFakeGateLint(seedRepo());
    expectGateLintReport(runPs1(dir, "analyze", PLAN_REL).stdout);
  });
});

describe.skipIf(!BASH)("pforge.sh diff/analyze honor the scope contract (meta #283, #286)", () => {
  it("diff reads the Forbidden Actions and In Scope sections", () => {
    const dir = seedRepo();
    expectDiffVerdicts(runSh(dir, "diff", PLAN_REL));
  });

  it("analyze counts forbidden and unplanned files for a plan without SHOULD criteria", () => {
    const dir = seedRepo();
    const result = runSh(dir, "analyze", PLAN_REL);
    expect(result.stderr).not.toMatch(/syntax error/);
    expect(result.stdout).toMatch(/1 forbidden file\(s\) touched/);
    expect(result.stdout).toMatch(/2 file\(s\) outside Scope Contract/);
    expect(result.stdout).toMatch(/Consistency Score: \d+\/100/);
  });

  it("analyze reports the plan's gate lint, like pforge.ps1", () => {
    const dir = withFakeGateLint(seedRepo());
    expectGateLintReport(runSh(dir, "analyze", PLAN_REL).stdout);
  });

  it("diff and analyze still report on a clean working tree", () => {
    const dir = seedRepo();
    git(dir, "checkout", "--", ".");
    const diff = runSh(dir, "diff", PLAN_REL);
    expect(diff.stdout).toMatch(/No changed files detected/);
    expect(diff.status).toBe(0);
    const analyze = runSh(dir, "analyze", PLAN_REL);
    expect(analyze.stdout).toMatch(/No uncommitted changes/);
    expect(analyze.stdout).toMatch(/Consistency Score: \d+\/100/);
  });
});

describe("Guard: both CLIs share one scope-hint contract (meta #283, #286)", () => {
  const ps1 = readSource("pforge.ps1");
  const sh = readSource("pforge.sh");

  it("pforge.ps1 has no unanchored section regex or -like hint match left", () => {
    expect(ps1).not.toContain("(?s)### Forbidden Actions(.*?)");
    expect(ps1).not.toContain("(?s)### In Scope(.*?)");
    expect(ps1).not.toMatch(/-like\s+"\*\$(fp|sp)\*"/);
  });

  it("pforge.sh has no self-terminating awk range left", () => {
    expect(sh).not.toContain("awk '/### Forbidden Actions/,/^###? /'");
    expect(sh).not.toContain("sed -n '/### Forbidden Actions/,/^###/p'");
  });

  it("diff and analyze route through the shared helpers in each shell", () => {
    expect((ps1.match(/Get-PlanScopeVerdict \$file/g) || []).length).toBe(2);
    expect((sh.match(/plan_scope_verdict "\$file"/g) || []).length).toBe(2);
  });

  it("pforge.sh compiles hint regexes once, not per changed file", () => {
    const start = sh.indexOf("plan_scope_verdict() {");
    const body = sh.slice(start, sh.indexOf("\n}\n", start));
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toContain("$(");
    expect(body).not.toMatch(/\bsed\b/);
  });

  it("analyze reads test files with -LiteralPath (meta #284)", () => {
    expect(ps1).toContain("Get-Content -LiteralPath $tf.FullName -Raw");
    expect(ps1).not.toContain("Get-Content $tf.FullName -Raw");
  });
});

function readSource(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf-8").replace(/\r\n/g, "\n");
}
