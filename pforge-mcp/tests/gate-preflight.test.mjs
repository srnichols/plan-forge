import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runPlan } from "../orchestrator.mjs";
import {
  gateCommandTools, preflightGates, classifyUnrunnableGate, loadGatePreflightMode,
} from "../orchestrator/gate-preflight.mjs";

describe("gateCommandTools", () => {
  it("returns the executable of a simple command", () => {
    expect(gateCommandTools("pnpm test")).toEqual(["pnpm"]);
  });

  it("checks every command in a chain or pipeline", () => {
    expect(gateCommandTools("cargo build && cargo test || dotnet test; go vet ./... | grep -v ok"))
      .toEqual(["cargo", "dotnet", "go", "grep"]);
  });

  it("skips shell builtins, env assignments and quoted text", () => {
    expect(gateCommandTools(`cd app && FOO=1 BAR=2 pytest -q && echo "uv run && poetry" && test -f x`))
      .toEqual(["pytest"]);
  });

  it("skips package runners that fetch their own tools, and project-relative scripts", () => {
    expect(gateCommandTools("npx vitest run && pnpm dlx tsc && bunx eslint . && ./scripts/check.sh && bin/run"))
      .toEqual(["pnpm"]);
  });

  it("checks the program after env", () => {
    expect(gateCommandTools("env NODE_ENV=test node -e \"1\"")).toEqual(["node"]);
  });

  it("ignores script text inside node -e, including escaped quotes", () => {
    expect(gateCommandTools(`node -e "const c=require('fs').readFileSync('a');if(!c.includes(\\"x\\"))throw new Error(\\"no\\");console.log(\\"ok\\")"`))
      .toEqual(["node"]);
  });

  it("ignores fragments that are not program names", () => {
    expect(gateCommandTools("node x.js; console.log() && \"")).toEqual(["node"]);
  });

  it("strips .exe/.cmd suffixes", () => {
    expect(gateCommandTools("dotnet.exe test && pnpm.cmd lint")).toEqual(["dotnet", "pnpm"]);
  });
});

describe("preflightGates", () => {
  let dir;
  let binDir;
  const exe = (name) => {
    const file = join(binDir, process.platform === "win32" ? `${name}.cmd` : name);
    writeFileSync(file, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", { mode: 0o755 });
  };
  const env = () => ({ PATH: binDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" });
  const plan = (...gates) => ({ slices: gates.map((validationGate, i) => ({ number: String(i + 1), validationGate })) });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pf-gate-preflight-"));
    binDir = join(dir, "bin");
    mkdirSync(binDir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reports a gate tool that is not on PATH", () => {
    exe("pnpm");
    const r = preflightGates({ plan: plan("pnpm test", "cargo test"), cwd: dir, env: env() });
    expect(r.missing).toEqual([{ slice: "2", command: "cargo test", tool: "cargo" }]);
    expect(r.checked).toBe(2);
  });

  it("finds tools in the project's node_modules/.bin", () => {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", ".bin", process.platform === "win32" ? "vitest.cmd" : "vitest"), "");
    expect(preflightGates({ plan: plan("vitest run"), cwd: dir, env: env() }).missing).toEqual([]);
  });

  it("reports each missing tool once per slice", () => {
    const r = preflightGates({ plan: plan("zzz-tool a && zzz-tool b"), cwd: dir, env: env() });
    expect(r.missing).toHaveLength(1);
  });

  it("handles multi-line gates and slices without a gate", () => {
    exe("pnpm");
    const r = preflightGates({ plan: { slices: [{ number: "1", validationGate: "pnpm build\nzzz-missing check" }, { number: "2" }] }, cwd: dir, env: env() });
    expect(r.missing.map((m) => m.tool)).toEqual(["zzz-missing"]);
  });
});

describe("classifyUnrunnableGate", () => {
  const failed = (extra) => ({ success: false, output: "", stderr: "", error: "", exitCode: 1, ...extra });

  it("recognises bash's command not found", () => {
    expect(classifyUnrunnableGate(failed({ exitCode: 127, stderr: "bash: line 1: pnpm: command not found" })))
      .toMatchObject({ tool: "pnpm" });
  });

  it("recognises sh's not found", () => {
    expect(classifyUnrunnableGate(failed({ exitCode: 127, stderr: "sh: 1: cargo: not found" }))).toMatchObject({ tool: "cargo" });
  });

  it("recognises cmd.exe's not recognized", () => {
    const r = classifyUnrunnableGate(failed({ exitCode: 9009, error: "'pnpm' is not recognized as an internal or external command,\r\noperable program or batch file." }));
    expect(r).toMatchObject({ tool: "pnpm" });
    expect(r.reason).toMatch(/pnpm/);
  });

  it("recognises PowerShell's not recognized", () => {
    expect(classifyUnrunnableGate(failed({ stderr: "The term 'dotnet' is not recognized as the name of a cmdlet, function, script file, or operable program." })))
      .toMatchObject({ tool: "dotnet" });
  });

  it("leaves a missing project script to the retry (the worker may create it)", () => {
    expect(classifyUnrunnableGate(failed({ exitCode: 127, stderr: "bash: ./scripts/check.sh: No such file or directory" }))).toBeNull();
    expect(classifyUnrunnableGate(failed({ exitCode: 127, stderr: "bash: scripts/check.sh: command not found" }))).toBeNull();
  });

  it("leaves ordinary test failures alone", () => {
    expect(classifyUnrunnableGate(failed({ output: "FAIL src/a.test.ts\nError: expected 1 to be 2" }))).toBeNull();
    expect(classifyUnrunnableGate({ success: true, exitCode: 0 })).toBeNull();
    expect(classifyUnrunnableGate(null)).toBeNull();
  });
});

describe("loadGatePreflightMode", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-gate-preflight-mode-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to warn", () => {
    expect(loadGatePreflightMode(dir)).toBe("warn");
  });

  it("reads block and off, ignoring other values", () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gatePreflight: "block" }));
    expect(loadGatePreflightMode(dir)).toBe("block");
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gatePreflight: "off" }));
    expect(loadGatePreflightMode(dir)).toBe("off");
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gatePreflight: "loud" }));
    expect(loadGatePreflightMode(dir)).toBe("warn");
  });
});

// Allowed gate commands that are often absent; the first one missing here drives the run test.
const RARE_GATE_TOOLS = ["gradle", "mvn", "cargo", "cmake", "mypy", "ruff", "dotnet", "go", "pnpm", "yarn", "make"];
const missingTool = RARE_GATE_TOOLS.find((tool) =>
  preflightGates({ plan: { slices: [{ number: "1", validationGate: `${tool} --version` }] }, cwd: process.cwd() }).missing.length > 0);

describe.skipIf(!missingTool)("runPlan gate tool preflight", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-gate-preflight-run-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const writePlan = () => {
    const path = join(dir, "plan.md");
    writeFileSync(path, [
      "# Preflight Plan", "", "**Status**: HARDENED", "", "## Scope Contract", "", "### In Scope", "- `a.txt`", "",
      "### Forbidden", "- nothing", "", "## Execution Slices", "", "### Slice 1: Build", "",
      "**Validation Gate**", "```", `${missingTool} --version`, "```", "", "1. Do it.", "",
    ].join("\n"));
    return path;
  };

  it("refuses to start when gatePreflight is block", async () => {
    writeFileSync(join(dir, ".forge.json"), JSON.stringify({ gatePreflight: "block" }));
    const result = await runPlan(writePlan(), { cwd: dir, dryRunWorker: true, manualImport: true, quorum: false });
    expect(result.code).toBe("GATE_TOOLS_MISSING");
    expect(result.missing).toEqual([{ slice: "1", command: `${missingTool} --version`, tool: missingTool }]);
  });

  it("only warns by default", async () => {
    const result = await runPlan(writePlan(), { cwd: dir, dryRunWorker: true, manualImport: true, quorum: false });
    expect(result.code).not.toBe("GATE_TOOLS_MISSING");
  });
});

describe("Guard: an unrunnable gate stops the retries", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "orchestrator", "run-plan.mjs"), "utf-8");
  const loop = src.slice(src.indexOf("async function _executeSliceAttemptLoop"), src.indexOf("async function executeSlice("));

  it("breaks before recording the gate failure for a retry", () => {
    const classifyIdx = loop.indexOf("gateResult.unrunnable = classifyUnrunnableGate(gateResult)");
    const breakIdx = loop.indexOf("if (gateResult.unrunnable) break;");
    const retryIdx = loop.indexOf("_recordGateFailureForRetry(");
    expect(classifyIdx).toBeGreaterThan(-1);
    expect(breakIdx).toBeGreaterThan(classifyIdx);
    expect(breakIdx).toBeLessThan(retryIdx);
  });

  it("reports gate-unrunnable ahead of the generic gate branch", () => {
    const statusFn = src.slice(src.indexOf("function _executeSliceDetermineStatus"));
    const idx = statusFn.indexOf("gateResult.unrunnable");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(statusFn.indexOf("!gateResult.success"));
    expect(statusFn).toMatch(/gate-unrunnable: /);
  });
});
