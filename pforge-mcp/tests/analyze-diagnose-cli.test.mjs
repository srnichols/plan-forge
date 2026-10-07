/**
 * `pforge analyze --quorum|--models` and `pforge diagnose` were documented for
 * the CLI (CLI-GUIDE, capabilities.md, the review watcher's
 * "pforge analyze --quorum=power <plan>" hint) but never implemented: analyze
 * ignored every flag and diagnose was an unknown command. Both shells now
 * forward to `node pforge-mcp/orchestrator.mjs --analyze|--diagnose`, whose
 * argument handling lives in orchestrator/analysis-cli.mjs.
 */

import { describe, it, expect, afterEach } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseAnalysisCliArgs, runAnalysisCli } from "../orchestrator/analysis-cli.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p))
  : "bash";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = undefined;
});

function makeTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

describe("parseAnalysisCliArgs", () => {
  it("defaults analyze mode from the target the way forge_analyze does", () => {
    expect(parseAnalysisCliArgs(["--analyze", "docs/plans/Phase-1.md"], "analyze"))
      .toEqual({ target: "docs/plans/Phase-1.md", mode: "plan", models: null, preset: null });
    expect(parseAnalysisCliArgs(["--analyze", "src/planner/plan-builder.ts"], "analyze").mode).toBe("file");
    expect(parseAnalysisCliArgs(["--analyze", "notes.md", "--mode", "file"], "analyze").mode).toBe("file");
  });

  it("splits --models and accepts a known --preset", () => {
    expect(parseAnalysisCliArgs(["--diagnose", "a.cs", "--models", " m1, m2 ,", "--preset", "speed"], "diagnose"))
      .toEqual({ target: "a.cs", mode: "diagnose", models: ["m1", "m2"], preset: "speed" });
    // A PowerShell array argument ("--models m1,m2" typed unquoted) arrives space-joined.
    expect(parseAnalysisCliArgs(["--analyze", "a.md", "--models", "m1 m2"], "analyze").models).toEqual(["m1", "m2"]);
  });

  it("rejects a missing target, an unknown preset and an unknown mode", () => {
    expect(parseAnalysisCliArgs(["--analyze"], "analyze").error).toMatch(/^Usage: node orchestrator\.mjs --analyze/);
    expect(parseAnalysisCliArgs(["--diagnose"], "diagnose").error).toMatch(/^Usage: node orchestrator\.mjs --diagnose/);
    expect(parseAnalysisCliArgs(["--analyze", "a.md", "--preset", "auto"], "analyze").error)
      .toMatch(/Unknown quorum preset "auto"\. Valid: power, speed, power-gov/);
    expect(parseAnalysisCliArgs(["--analyze", "a.md", "--preset", "toString"], "analyze").error).toMatch(/Unknown quorum preset/);
    expect(parseAnalysisCliArgs(["--analyze", "a.md", "--mode", "review"], "analyze").error).toMatch(/mode must be one of/);
  });
});

describe("runAnalysisCli", () => {
  const fakeResult = (overrides = {}) => ({ models: ["m1", "m2"], totalDuration: 1500, totalCost: 0.25, synthesis: "## Findings", ...overrides });

  it("passes the parsed options to the analyzer and saves the report", async () => {
    const cwd = makeTmp("pf-analysis-cli-");
    const calls = [];
    const analyze = async (opts) => { calls.push(opts); return fakeResult({ target: opts.target }); };
    await runAnalysisCli(["--analyze", "src/billing.ts", "--preset", "power"], "analyze", { cwd, analyze });

    expect(calls).toEqual([{ target: "src/billing.ts", mode: "file", models: null, preset: "power", cwd }]);
    expect(process.exitCode).toBe(0);
    const reports = readdirSync(join(cwd, ".forge", "analysis"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/^billing\.ts-\d+\.json$/);
  });

  it("names diagnose reports diagnose-<file>", async () => {
    const cwd = makeTmp("pf-analysis-cli-");
    await runAnalysisCli(["--diagnose", "src/billing.ts"], "diagnose", { cwd, analyze: async () => fakeResult() });
    expect(readdirSync(join(cwd, ".forge", "analysis"))[0]).toMatch(/^diagnose-billing\.ts-\d+\.json$/);
  });

  it("exits 1 without calling the analyzer on bad input, and on analyzer failure", async () => {
    const cwd = makeTmp("pf-analysis-cli-");
    let called = false;
    await runAnalysisCli(["--analyze", "a.md", "--preset", "nope"], "analyze", { cwd, analyze: async () => { called = true; } });
    expect(called).toBe(false);
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await runAnalysisCli(["--analyze", "a.md"], "analyze", { cwd, analyze: async () => { throw new Error("all legs failed"); } });
    expect(process.exitCode).toBe(1);
    expect(existsSync(join(cwd, ".forge", "analysis"))).toBe(false);
  });
});

// ─── Both shells forward to the orchestrator ─────────────────────────────────

// Stands in for pforge-mcp/orchestrator.mjs: records its argv, exits with FAKE_EXIT.
const FAKE_ORCHESTRATOR = [
  "import { writeFileSync } from 'node:fs';",
  "writeFileSync(process.env.FAKE_ARGV_FILE, JSON.stringify(process.argv.slice(2)));",
  "process.exit(Number(process.env.FAKE_EXIT || 0));",
  "",
].join("\n");

function seedRepo() {
  const dir = makeTmp("pf-analyze-diagnose-");
  mkdirSync(join(dir, ".git"));
  for (const [rel, content] of Object.entries({
    "docs/plans/Phase-1-PLAN.md": "# Phase 1\n",
    "src/Billing/InvoiceService.cs": "class InvoiceService {}\n",
    "pforge-mcp/orchestrator.mjs": FAKE_ORCHESTRATOR,
  })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  copyFileSync(join(REPO_ROOT, "pforge.ps1"), join(dir, "pforge.ps1"));
  copyFileSync(join(REPO_ROOT, "pforge.sh"), join(dir, "pforge.sh"));
  return dir;
}

const SHELLS = [
  {
    name: "pforge.ps1",
    enabled: isWin,
    run: (dir, args, env) => spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(dir, "pforge.ps1"), ...args],
      { cwd: dir, encoding: "utf-8", env, timeout: 120_000 },
    ),
  },
  {
    name: "pforge.sh",
    enabled: Boolean(BASH),
    run: (dir, args, env) => spawnSync(BASH, ["pforge.sh", ...args], { cwd: dir, encoding: "utf-8", env, timeout: 120_000 }),
  },
];

for (const shell of SHELLS) {
  describe.skipIf(!shell.enabled)(`${shell.name} analyze --quorum / diagnose`, () => {
    function invoke(args, { exit = 0 } = {}) {
      const dir = seedRepo();
      const argvFile = join(dir, "argv.json");
      const env = { ...process.env, NO_COLOR: "1", FAKE_ARGV_FILE: argvFile, FAKE_EXIT: String(exit) };
      const result = shell.run(dir, args, env);
      const forwarded = existsSync(argvFile) ? JSON.parse(readFileSync(argvFile, "utf-8")) : null;
      const out = `${result.stdout}\n${result.stderr}`;
      // The forwarded target is the resolved path; compare its tail.
      const tail = forwarded ? [...forwarded.slice(0, 1), forwarded[1].replace(/\\/g, "/").split("/").slice(-2).join("/"), ...forwarded.slice(2)] : null;
      return { status: result.status, out, forwarded: tail };
    }

    it("forwards a quorum preset, with flags before or after the target", () => {
      expect(invoke(["analyze", "docs/plans/Phase-1-PLAN.md", "--quorum=power"]).forwarded)
        .toEqual(["--analyze", "plans/Phase-1-PLAN.md", "--preset", "power"]);
      expect(invoke(["analyze", "--quorum", "docs/plans/Phase-1-PLAN.md"]).forwarded)
        .toEqual(["--analyze", "plans/Phase-1-PLAN.md"]);
    });

    it("reviews a source file when --models is given, passing --mode through", () => {
      expect(invoke(["analyze", "src/Billing/InvoiceService.cs", "--models", "m1,m2", "--mode", "file"]).forwarded)
        .toEqual(["--analyze", "Billing/InvoiceService.cs", "--mode", "file", "--models", "m1,m2"]);
    });

    it("runs diagnose through the orchestrator and propagates its exit code", () => {
      const r = invoke(["diagnose", "src/Billing/InvoiceService.cs", "--models", "m1"], { exit: 3 });
      expect(r.forwarded).toEqual(["--diagnose", "Billing/InvoiceService.cs", "--models", "m1"]);
      expect(r.status, r.out).toBe(3);
    });

    it("rejects bad input before reaching the orchestrator", () => {
      for (const args of [
        ["diagnose"],
        ["diagnose", "src/Billing/Missing.cs"],
        ["diagnose", "src/Billing/InvoiceService.cs", "--mode", "file"],
        ["analyze", "docs/plans/Phase-1-PLAN.md", "--verbose"],
        ["analyze", "docs/plans/Phase-1-PLAN.md", "--models"],
      ]) {
        const r = invoke(args);
        expect(r.status, `${args.join(" ")}\n${r.out}`).toBe(1);
        expect(r.forwarded, args.join(" ")).toBeNull();
      }
    });
  });
}

describe.skipIf(!isWin)("pforge.ps1 --models typed at a PowerShell prompt", () => {
  it("forwards an unquoted m1,m2 (bound as an array) as a comma list", () => {
    const dir = seedRepo();
    const argvFile = join(dir, "argv.json");
    const script = join(dir, "pforge.ps1").replace(/'/g, "''");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `& '${script}' diagnose src/Billing/InvoiceService.cs --models m1,m2`],
      { cwd: dir, encoding: "utf-8", env: { ...process.env, NO_COLOR: "1", FAKE_ARGV_FILE: argvFile }, timeout: 120_000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const forwarded = JSON.parse(readFileSync(argvFile, "utf-8"));
    expect(forwarded.slice(-2)).toEqual(["--models", "m1,m2"]);
  });
});

describe("Guard: dashboard multi-model actions run in-process, not through the 60 s CLI proxy", () => {
  const app = readFileSync(join(REPO_ROOT, "pforge-mcp", "dashboard", "app.js"), "utf-8");

  it("the Analyze (quorum) and Diagnose buttons call the MCP tools", () => {
    const start = app.indexOf("async function runAnalyzeQuorum()");
    const block = app.slice(start, app.indexOf("window.runAnalyzeQuorum", start));
    expect(block).toContain('runQuorumTool("forge_analyze"');
    expect(block).toContain('runQuorumTool("forge_diagnose"');
    expect(block).not.toMatch(/runAction\("(analyze|diagnose)"/);
  });

  it("the HTTP bridge dispatches both tools to their MCP handlers", async () => {
    const { MCP_ONLY_TOOLS } = await import("../server/tool-handlers.mjs");
    expect(MCP_ONLY_TOOLS.has("forge_analyze")).toBe(true);
    expect(MCP_ONLY_TOOLS.has("forge_diagnose")).toBe(true);
  });
});