import { describe, it, expect, vi, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runPforge, DEFAULT_PFORGE_TIMEOUT_MS } from "../server/helpers.mjs";
import { _analyzeAnvilCompute } from "../server/anvil-compute.mjs";

/**
 * Meta-bug #351 — on a large worktree the forge_analyze MCP handler failed with
 * `spawnSync cmd.exe ETIMEDOUT` before any score, while the same CLI finished
 * (92/100) when run directly with a longer wait. Two causes:
 *
 *   - the Test Coverage step re-read every test file for every MUST criterion
 *     that no file matched, 72 s on the reporter's worktree;
 *   - runPforge hard-codes 60 s for every command, and nothing told the caller
 *     the wrapper's timeout, not the analysis, had ended the run.
 *
 * pforge.sh has no criterion matching to slow down; its parity gap is separate.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";

const dirs = [];
afterEach(() => {
  // A timed-out child can outlive the shell that was killed and still hold its cwd.
  for (const dir of dirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* best-effort */ }
  }
});

const tempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

describe("runPforge timeout (#351)", () => {
  const stubProject = (script) => {
    const dir = tempDir("pf-meta-351-run-");
    writeFileSync(join(dir, isWin ? "pforge.ps1" : "pforge.sh"), script);
    return dir;
  };
  const prints = isWin ? 'Write-Output "analysis done"' : 'echo "analysis done"';
  const sleeps = isWin ? "Start-Sleep -Seconds 12" : "sleep 12";

  it("keeps 60 s as the default for every other command", () => {
    expect(DEFAULT_PFORGE_TIMEOUT_MS).toBe(60_000);
  });

  it("returns the output of a command that finishes inside the timeout", () => {
    const result = runPforge("analyze plan.md", stubProject(prints), { timeoutMs: 120_000 });
    expect(result.success).toBe(true);
    expect(result.output).toBe("analysis done");
  });

  it("stops a command at the timeout it was given", () => {
    const started = Date.now();
    const result = runPforge("analyze plan.md", stubProject(sleeps), { timeoutMs: 1_500 });
    expect(result.success).toBe(false);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it("says the wrapper's timeout ended the run, not the analysis", () => {
    const result = runPforge("analyze plan.md", stubProject(sleeps), { timeoutMs: 1_500 });
    expect(result.timedOut).toBe(true);
    expect(result.error).toMatch(/did not finish within 1\.5s/);
    expect(result.error).toMatch(/not an analysis failure/);
    expect(result.error).toContain("analyze plan.md");
    expect(result.error).not.toMatch(/ETIMEDOUT/);
  }, 30_000);

  it("does not report an ordinary failure as a timeout", () => {
    const result = runPforge("analyze plan.md", stubProject("exit 3"), { timeoutMs: 120_000 });
    expect(result.success).toBe(false);
    expect(result.timedOut).toBeUndefined();
    expect(result.exitCode).toBe(3);
  });
});

describe("forge_analyze asks for the longer timeout (#351)", () => {
  it("runs the analysis with more than the default 60 s", async () => {
    const run = vi.fn().mockReturnValue({ success: true, output: "Consistency Score: 92/100" });
    const cwd = tempDir("pf-meta-351-anvil-");
    await _analyzeAnvilCompute({ plan: "docs/plans/Phase-62-PLAN.md" }, {
      _runPforge: run, _withAnvil: (fn) => fn(), _codeHash: "t", _cwd: cwd,
    });
    expect(run).toHaveBeenCalledTimes(1);
    const [command, runCwd, options] = run.mock.calls[0];
    expect(command).toBe('analyze "docs/plans/Phase-62-PLAN.md"');
    expect(runCwd).toBe(cwd);
    expect(options.timeoutMs).toBeGreaterThan(DEFAULT_PFORGE_TIMEOUT_MS);
  });
});

// ─── pforge.ps1: the criterion → test traceability step ─────────────────────

const ps1Source = readFileSync(join(REPO_ROOT, "pforge.ps1"), "utf-8");

function extractFunction(name) {
  const start = ps1Source.indexOf(`function ${name} {`);
  if (start === -1) return null;
  return ps1Source.slice(start, ps1Source.indexOf("\n}\n", start) + 2);
}

describe.skipIf(!isWin)("pforge.ps1 reads each test file once (#351)", () => {
  const CRITERIA = [
    "Items endpoint returns paginated results",
    "Cache invalidates expired sessions quickly",
    "Webhook signatures reject tampered payloads",
    "Exporter streams enormous attachments",
    "Scheduler recovers abandoned reservations",
    "Importer rejects malformed archives",
  ];

  function runDriver(testFiles) {
    const fn = extractFunction("Get-UntestedMustCriteria");
    expect(fn, "pforge.ps1 should define Get-UntestedMustCriteria").not.toBeNull();
    const dir = tempDir("pf-meta-351-ps1-");
    const filesDir = join(dir, "files");
    mkdirSync(filesDir);
    for (const [name, text] of Object.entries(testFiles)) writeFileSync(join(filesDir, name), text);
    const driver = join(dir, "driver.ps1");
    writeFileSync(driver, [
      "$ErrorActionPreference = 'Stop'",
      "$script:reads = 0",
      // Counts the reads, then does exactly what the script's own call would.
      "function Get-Content { [CmdletBinding()] param([string]$LiteralPath, [switch]$Raw) $script:reads++; Microsoft.PowerShell.Management\\Get-Content -LiteralPath $LiteralPath -Raw:$Raw }",
      fn,
      `$criteria = @(${CRITERIA.map((c) => `'${c}'`).join(", ")})`,
      `$files = Get-ChildItem -LiteralPath '${filesDir}' -File`,
      "$untested = @(Get-UntestedMustCriteria -Criteria $criteria -TestFiles $files)",
      "@{ reads = $script:reads; untested = $untested } | ConvertTo-Json -Compress",
    ].join("\n"));
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", driver], { encoding: "utf-8", timeout: 120_000 });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout.trim().split(/\r?\n/).pop());
  }

  const MANY_FILES = {
    ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`noise-${i}.test.ts`, `// unrelated test number ${i}\n`])),
    "items.test.ts": "describe('Items endpoint', () => it('returns a page'))\n",
    "sessions.test.ts": "it('invalidates expired rows', () => {})\n",
  };

  it("reads every file once however many criteria go unmatched", () => {
    const { reads, untested } = runDriver(MANY_FILES);
    expect(untested).toHaveLength(4);
    expect(reads).toBe(Object.keys(MANY_FILES).length);
  });

  it("returns the unmatched criteria in plan order", () => {
    const { untested } = runDriver(MANY_FILES);
    expect(untested).toEqual([CRITERIA[2], CRITERIA[3], CRITERIA[4], CRITERIA[5]]);
  });

  it("matches on two of a criterion's first three long words, in any file", () => {
    const { untested } = runDriver({
      "a.test.ts": "Items only\n",
      "b.test.ts": "Webhook signatures\n",
      "c.test.ts": "Scheduler recovers abandoned\n",
    });
    expect(untested).toEqual([CRITERIA[0], CRITERIA[1], CRITERIA[3], CRITERIA[5]]);
  });

  it("stops reading once every criterion has a match", () => {
    const everything = CRITERIA.map((c) => c.split(" ").slice(0, 3).join(" ")).join("\n");
    const { reads, untested } = runDriver({
      "a.test.ts": everything,
      "b.test.ts": "never needed\n",
      "c.test.ts": "never needed\n",
    });
    expect(untested).toEqual([]);
    expect(reads).toBe(1);
  });
});

// ─── pforge.ps1 analyze, end to end on a small repository ───────────────────

describe.skipIf(!isWin)("pforge.ps1 analyze traces criteria to tests as before (#351)", () => {
  const PLAN_REL = "docs/plans/Phase-9-TRACE-FIXTURE-PLAN.md";
  const PLAN = [
    "# Phase 9 — Trace Fixture",
    "",
    "## Acceptance Criteria",
    "- **MUST**: Items endpoint returns paginated results",
    "- **MUST**: Cache invalidates expired sessions quickly",
    "- **MUST**: Webhook signatures reject tampered payloads",
    "- **MUST**: Exporter streams enormous attachments",
    "",
    "### Slice 1 — Items endpoint",
    "",
    "**Validation Gate**:",
    "```bash",
    "npm test",
    "```",
    "",
  ].join("\n");

  function seedRepo() {
    const dir = tempDir("pf-meta-351-cli-");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const files = {
      [PLAN_REL]: PLAN,
      "tests/items.test.ts": "// Items endpoint returns paginated results\n",
      "tests/sessions.test.ts": "// invalidates expired sessions\n",
      "tests/unrelated.test.ts": "// nothing to see\n",
    };
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), content);
    }
    copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(dir, "pforge.ps1"));
    copyFileSync(join(REPO_ROOT, "pforge.sh"), join(dir, "pforge.sh"));
    return dir;
  }

  it("counts the traced criteria and names the untraced ones in plan order", () => {
    const dir = seedRepo();
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, "pforge.ps1"), "analyze", PLAN_REL],
      { cwd: dir, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1" }, timeout: 120_000 },
    );
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toMatch(/2\/4 MUST criteria have matching tests/);
    const first = out.indexOf("No test found for: Webhook signatures reject tampered payloads");
    const second = out.indexOf("No test found for: Exporter streams enormous attachments");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(out).not.toMatch(/No test found for: Items endpoint/);
    expect(out).toMatch(/Consistency Score: \d+\/100/);
  });
});

describe("Guard: the criterion loop does not read files (#351)", () => {
  it("pforge.ps1 matches criteria through Get-UntestedMustCriteria", () => {
    expect(ps1Source).toContain("$untestedMust = @(Get-UntestedMustCriteria -Criteria $mustCriteria -TestFiles $testFiles)");
    expect(ps1Source).not.toMatch(/foreach \(\$criterion in \$mustCriteria\)[\s\S]{0,600}Get-Content/);
  });

  it("the function is the only place the traceability step reads a test file", () => {
    const section = ps1Source.slice(ps1Source.indexOf('Write-Host "Test Coverage:"'), ps1Source.indexOf("SLICE → GATE COMPLETENESS"));
    expect(section).not.toContain("Get-Content");
  });
});
