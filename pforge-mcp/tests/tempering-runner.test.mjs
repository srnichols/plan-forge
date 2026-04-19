import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  runSubprocess,
  runScannerUnit,
  runTemperingRun,
  pickChangedFiles,
  deriveOverallVerdict,
} from "../tempering/runner.mjs";
import {
  STACK_ADAPTER_PATHS,
  SUPPORTED_STACKS_SLICE_02_1,
  validateAdapterEntry,
  loadAdapter,
} from "../tempering/adapters.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(__dirname, "..");          // pforge-mcp/
const REPO_ROOT = resolve(__dirname, "..", "..");   // plan-forge/

// ─── Fake subprocess ─────────────────────────────────────────────────

/**
 * Build a fake `spawn` implementation that emits a scripted stdout
 * stream then closes with the given exit code. Lets us exercise the
 * runner without ever shelling out to a real test runner.
 */
function makeFakeSpawn({ stdout = "", stderr = "", exitCode = 0, delayMs = 0, hang = false, emitError = null } = {}) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    // kill() emits close so the runner's timeout + grace-kill path can
    // settle deterministically. Matches real child_process behaviour
    // where SIGTERM results in a close event with signal !== null.
    proc.kill = (signal) => {
      if (proc._killed) return;
      proc._killed = true;
      setTimeout(() => proc.emit("close", null, signal || "SIGTERM"), 1);
    };
    if (emitError) {
      setTimeout(() => proc.emit("error", new Error(emitError)), 1);
      return proc;
    }
    if (hang) return proc; // never emits close on its own — forces timeout
    setTimeout(() => {
      if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
      if (stderr) proc.stderr.emit("data", Buffer.from(stderr));
      proc.emit("close", exitCode, null);
    }, delayMs);
    return proc;
  };
  spawn.calls = calls;
  return spawn;
}

function makeHub() {
  const events = [];
  return {
    events,
    broadcast: (evt) => events.push(evt),
  };
}

function makeProject() {
  const dir = resolve(tmpdir(), `temper-02-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  // Seed a package.json so detectStack returns "typescript"
  writeFileSync(resolve(dir, "package.json"), '{"name":"t"}', "utf-8");
  return dir;
}

// ─── Adapter registry ────────────────────────────────────────────────

describe("tempering/adapters — STACK_ADAPTER_PATHS", () => {
  it("lists exactly the 9 known stacks", () => {
    const keys = Object.keys(STACK_ADAPTER_PATHS).sort();
    expect(keys).toEqual([
      "azure-iac", "dotnet", "go", "java", "php",
      "python", "rust", "swift", "typescript",
    ]);
  });

  it("marks six stacks first-class for slice 02.1", () => {
    expect([...SUPPORTED_STACKS_SLICE_02_1].sort()).toEqual([
      "dotnet", "go", "java", "python", "rust", "typescript",
    ]);
  });

  it("paths are frozen", () => {
    expect(Object.isFrozen(STACK_ADAPTER_PATHS)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_STACKS_SLICE_02_1)).toBe(true);
  });

  it("every supported stack ships a real adapter file on disk", () => {
    for (const stack of SUPPORTED_STACKS_SLICE_02_1) {
      const rel = STACK_ADAPTER_PATHS[stack];
      // Relative paths are anchored at pforge-mcp/tempering/; resolve against that.
      const abs = resolve(MCP_ROOT, "tempering", rel);
      expect(existsSync(abs)).toBe(true);
    }
  });

  it("stub stacks also ship a file on disk", () => {
    for (const stack of ["php", "swift", "azure-iac"]) {
      const rel = STACK_ADAPTER_PATHS[stack];
      const abs = resolve(MCP_ROOT, "tempering", rel);
      expect(existsSync(abs)).toBe(true);
    }
  });
});

describe("tempering/adapters — validateAdapterEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(validateAdapterEntry({ cmd: ["x"], parseOutput: () => ({}) })).toEqual({ ok: true });
  });
  it("accepts an explicitly-unsupported stub", () => {
    expect(validateAdapterEntry({ supported: false, reason: "stub" })).toEqual({ ok: true });
  });
  it("rejects missing entry", () => {
    expect(validateAdapterEntry(null).ok).toBe(false);
    expect(validateAdapterEntry(undefined).ok).toBe(false);
  });
  it("rejects missing cmd array", () => {
    const r = validateAdapterEntry({ parseOutput: () => ({}) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("invalid-cmd-array");
  });
  it("rejects missing parseOutput", () => {
    const r = validateAdapterEntry({ cmd: ["x"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing-parseOutput");
  });
});

describe("tempering/adapters — loadAdapter", () => {
  it("returns null for unknown stack", async () => {
    expect(await loadAdapter("cobol")).toBe(null);
  });

  it("uses injected importFn and accepts a well-formed module", async () => {
    const fake = { temperingAdapter: { unit: { supported: true, cmd: ["x"], parseOutput: () => ({}) } } };
    const result = await loadAdapter("typescript", { importFn: async () => fake });
    expect(result).toBe(fake.temperingAdapter);
  });

  it("returns null when importFn throws", async () => {
    const result = await loadAdapter("typescript", { importFn: async () => { throw new Error("boom"); } });
    expect(result).toBe(null);
  });

  it("returns null when module lacks temperingAdapter export", async () => {
    const result = await loadAdapter("typescript", { importFn: async () => ({}) });
    expect(result).toBe(null);
  });
});

describe("preset adapters — shape contract", () => {
  for (const stack of ["typescript", "dotnet", "python", "go", "java", "rust"]) {
    it(`${stack} adapter passes validateAdapterEntry for unit`, async () => {
      const mod = await import(`../../presets/${stack}/tempering-adapter.mjs`);
      expect(mod.temperingAdapter).toBeDefined();
      expect(validateAdapterEntry(mod.temperingAdapter.unit).ok).toBe(true);
      expect(mod.temperingAdapter.unit.supported).toBe(true);
    });
  }

  for (const stack of ["php", "swift", "azure-iac"]) {
    it(`${stack} adapter is a valid stub (unsupported)`, async () => {
      const mod = await import(`../../presets/${stack}/tempering-adapter.mjs`);
      expect(mod.temperingAdapter).toBeDefined();
      expect(mod.temperingAdapter.unit.supported).toBe(false);
      expect(mod.temperingAdapter.integration.supported).toBe(false);
      // Stubs still pass validation (supported:false is a valid shape)
      expect(validateAdapterEntry(mod.temperingAdapter.unit).ok).toBe(true);
    });
  }
});

// ─── parseOutput smoke tests (one per supported stack) ───────────────

describe("preset adapters — parseOutput", () => {
  it("typescript parses vitest JSON", async () => {
    const mod = await import("../../presets/typescript/tempering-adapter.mjs");
    const json = JSON.stringify({ numPassedTests: 42, numFailedTests: 1, numPendingTests: 2, numTodoTests: 1 });
    const r = mod.temperingAdapter.unit.parseOutput(json, "", 1);
    expect(r).toEqual({ pass: 42, fail: 1, skipped: 3, coverage: null });
  });

  it("typescript falls back to exit code on unparseable output", async () => {
    const mod = await import("../../presets/typescript/tempering-adapter.mjs");
    const r = mod.temperingAdapter.unit.parseOutput("no json here", "", 1);
    expect(r.fail).toBe(1);
  });

  it("dotnet parses summary line", async () => {
    const mod = await import("../../presets/dotnet/tempering-adapter.mjs");
    const r = mod.temperingAdapter.unit.parseOutput("Failed: 0, Passed: 42, Skipped: 1, Total: 43", "", 0);
    expect(r).toEqual({ pass: 42, fail: 0, skipped: 1, coverage: null });
  });

  it("python parses pytest summary", async () => {
    const mod = await import("../../presets/python/tempering-adapter.mjs");
    const r = mod.temperingAdapter.unit.parseOutput("3 passed, 1 failed, 2 skipped in 0.45s", "", 1);
    expect(r).toEqual({ pass: 3, fail: 1, skipped: 2, coverage: null });
  });

  it("go parses -json stream", async () => {
    const mod = await import("../../presets/go/tempering-adapter.mjs");
    const stream = [
      '{"Action":"pass","Test":"TestA","Package":"x"}',
      '{"Action":"fail","Test":"TestB","Package":"x"}',
      '{"Action":"skip","Test":"TestC","Package":"x"}',
      '{"Action":"pass","Package":"x"}',  // no Test → package-level, ignored
    ].join("\n");
    const r = mod.temperingAdapter.unit.parseOutput(stream, "", 1);
    expect(r).toEqual({ pass: 1, fail: 1, skipped: 1, coverage: null });
  });

  it("java parses surefire summary (last match wins)", async () => {
    const mod = await import("../../presets/java/tempering-adapter.mjs");
    const out = [
      "Tests run: 5, Failures: 0, Errors: 0, Skipped: 0",
      "Tests run: 10, Failures: 1, Errors: 1, Skipped: 2",
    ].join("\n");
    const r = mod.temperingAdapter.unit.parseOutput(out, "", 1);
    // total=10, fail=1+1=2, skip=2, pass=10-2-2=6
    expect(r).toEqual({ pass: 6, fail: 2, skipped: 2, coverage: null });
  });

  it("rust parses cargo test summary (sum across binaries)", async () => {
    const mod = await import("../../presets/rust/tempering-adapter.mjs");
    const out = [
      "test result: ok. 3 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out",
      "test result: FAILED. 2 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out",
    ].join("\n");
    const r = mod.temperingAdapter.unit.parseOutput(out, "", 1);
    expect(r).toEqual({ pass: 5, fail: 1, skipped: 1, coverage: null });
  });
});

// ─── runSubprocess ───────────────────────────────────────────────────

describe("runSubprocess", () => {
  it("captures stdout/stderr and exit code", async () => {
    const spawn = makeFakeSpawn({ stdout: "hello", stderr: "warn", exitCode: 0 });
    const r = await runSubprocess(["echo", "x"], { cwd: ".", budgetMs: 1000, spawn });
    expect(r.stdout).toBe("hello");
    expect(r.stderr).toBe("warn");
    expect(r.exitCode).toBe(0);
    expect(r.timedOut).toBe(false);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty-cmd error for empty array", async () => {
    const r = await runSubprocess([], { cwd: ".", budgetMs: 1000 });
    expect(r.exitCode).toBe(-1);
    expect(r.error).toBe("empty-cmd");
  });

  it("surfaces spawn error (ENOENT) without throwing", async () => {
    const spawn = makeFakeSpawn({ emitError: "ENOENT" });
    const r = await runSubprocess(["nope"], { cwd: ".", budgetMs: 1000, spawn });
    expect(r.exitCode).toBe(-1);
    expect(r.error).toBe("ENOENT");
    expect(r.timedOut).toBe(false);
  });

  it("kills process on budget exceeded", async () => {
    const spawn = makeFakeSpawn({ hang: true });
    const r = await runSubprocess(["sleep"], { cwd: ".", budgetMs: 50, spawn });
    expect(r.timedOut).toBe(true);
    expect(spawn.calls.length).toBe(1);
  });

  it("propagates cwd to spawn options", async () => {
    const spawn = makeFakeSpawn({ exitCode: 0 });
    await runSubprocess(["x"], { cwd: "/some/dir", budgetMs: 1000, spawn });
    expect(spawn.calls[0].opts.cwd).toBe("/some/dir");
    expect(spawn.calls[0].opts.shell).toBe(false);
  });
});

// ─── runScannerUnit ──────────────────────────────────────────────────

describe("runScannerUnit", () => {
  const baseConfig = {
    scanners: { unit: true },
    runtimeBudgets: { unitMaxMs: 1000 },
  };
  const goodAdapter = {
    unit: {
      supported: true,
      cmd: ["fake", "test"],
      parseOutput: (stdout) => {
        const m = stdout.match(/p=(\d+) f=(\d+) s=(\d+)/);
        if (!m) return { pass: 0, fail: 0, skipped: 0, coverage: null };
        return { pass: +m[1], fail: +m[2], skipped: +m[3], coverage: null };
      },
    },
  };

  it("returns pass verdict on clean run", async () => {
    const spawn = makeFakeSpawn({ stdout: "p=5 f=0 s=1", exitCode: 0 });
    const r = await runScannerUnit({
      config: baseConfig, stack: "typescript", adapter: goodAdapter, cwd: ".", spawn,
    });
    expect(r.verdict).toBe("pass");
    expect(r.pass).toBe(5);
    expect(r.fail).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.exitCode).toBe(0);
  });

  it("returns fail verdict when adapter reports failures", async () => {
    const spawn = makeFakeSpawn({ stdout: "p=3 f=2 s=0", exitCode: 1 });
    const r = await runScannerUnit({
      config: baseConfig, stack: "typescript", adapter: goodAdapter, cwd: ".", spawn,
    });
    expect(r.verdict).toBe("fail");
    expect(r.fail).toBe(2);
  });

  it("returns fail verdict when exit code is non-zero even if adapter parses 0 failures", async () => {
    const spawn = makeFakeSpawn({ stdout: "p=0 f=0 s=0", exitCode: 2 });
    const r = await runScannerUnit({
      config: baseConfig, stack: "typescript", adapter: goodAdapter, cwd: ".", spawn,
    });
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(2);
  });

  it("returns budget-exceeded when process hangs", async () => {
    const spawn = makeFakeSpawn({ hang: true });
    const r = await runScannerUnit({
      config: { ...baseConfig, runtimeBudgets: { unitMaxMs: 50 } },
      stack: "typescript", adapter: goodAdapter, cwd: ".", spawn,
    });
    expect(r.verdict).toBe("budget-exceeded");
    expect(r.timedOut).toBe(true);
  });

  it("returns error verdict on spawn ENOENT", async () => {
    const spawn = makeFakeSpawn({ emitError: "ENOENT" });
    const r = await runScannerUnit({
      config: baseConfig, stack: "typescript", adapter: goodAdapter, cwd: ".", spawn,
    });
    expect(r.verdict).toBe("error");
    expect(r.error).toBe("ENOENT");
  });

  it("skips when scanner disabled in config", async () => {
    const r = await runScannerUnit({
      config: { scanners: { unit: false }, runtimeBudgets: {} },
      stack: "typescript", adapter: goodAdapter, cwd: ".",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });

  it("skips when adapter is null", async () => {
    const r = await runScannerUnit({
      config: baseConfig, stack: "cobol", adapter: null, cwd: ".",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("no-adapter");
  });

  it("skips with reason for unsupported-stub adapter", async () => {
    const r = await runScannerUnit({
      config: baseConfig, stack: "php",
      adapter: { unit: { supported: false, reason: "stub-reason" } },
      cwd: ".",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("stub-reason");
  });

  it("captures parser error without throwing", async () => {
    const spawn = makeFakeSpawn({ stdout: "x", exitCode: 0 });
    const r = await runScannerUnit({
      config: baseConfig, stack: "typescript",
      adapter: { unit: { supported: true, cmd: ["x"], parseOutput: () => { throw new Error("parser-boom"); } } },
      cwd: ".", spawn,
    });
    expect(r.parseError).toBe("parser-boom");
    expect(r.verdict).toBe("pass"); // exit 0 + fail=0
  });

  it("propagates sliceRef into result", async () => {
    const spawn = makeFakeSpawn({ stdout: "p=1 f=0 s=0", exitCode: 0 });
    const r = await runScannerUnit({
      config: baseConfig, stack: "typescript", adapter: goodAdapter, cwd: ".", spawn,
      sliceRef: { plan: "Phase-X.md", slice: "01.1" },
    });
    expect(r.sliceRef).toEqual({ plan: "Phase-X.md", slice: "01.1" });
  });
});

// ─── runTemperingRun (top-level) ─────────────────────────────────────

describe("runTemperingRun", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const fakeAdapter = {
    unit: {
      supported: true,
      cmd: ["npx", "vitest", "run"],
      parseOutput: () => ({ pass: 7, fail: 0, skipped: 1, coverage: null }),
    },
  };

  it("rejects missing projectDir", async () => {
    const r = await runTemperingRun({});
    expect(r.ok).toBe(false);
    expect(r.code).toBe("missing-projectDir");
  });

  it("seeds config.json on first run and writes a run record", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const r = await runTemperingRun({
      projectDir, spawn, adapter: fakeAdapter,
    });
    expect(r.ok).toBe(true);
    expect(r.configWritten).toBe(true);
    expect(r.stack).toBe("typescript");
    expect(r.verdict).toBe("pass");
    expect(existsSync(r.runRecordPath)).toBe(true);
    const rec = JSON.parse(readFileSync(r.runRecordPath, "utf-8"));
    expect(rec.phase).toBe("TEMPER-05");
    expect(rec.slice).toBe("05.1");
    expect(rec.scanners[0].scanner).toBe("unit");
    // Slice 02.2 — integration runs alongside unit. With no integration
    // entry on fakeAdapter it short-circuits as skipped:no-adapter,
    // which is the documented fallback for partial adapter coverage.
    expect(rec.scanners[1].scanner).toBe("integration");
    expect(rec.scanners[1].skipped).toBe(true);
    // Slice 03.1 — UI scanner fires third; with no config.url it
    // skips as "url-not-configured".
    expect(rec.scanners[2].scanner).toBe("ui-playwright");
    expect(rec.scanners[2].skipped).toBe(true);
    // Slice 03.2 — contract scanner fires fourth; with no spec it
    // skips as "no-spec-found".
    expect(rec.scanners[3].scanner).toBe("contract");
    expect(rec.scanners[3].skipped).toBe(true);
    // Slice 04.1 — visual-diff scanner fires fifth; with no manifest
    // it skips as "no-screenshot-manifest" or "scanner-load-failed".
    expect(rec.scanners[4].scanner).toBe("visual-diff");
    // Slice 05.1 — flakiness, perf-budget, load-stress scanners.
    expect(rec.scanners[5].scanner).toBe("flakiness");
    expect(rec.scanners[6].scanner).toBe("performance-budget");
    expect(rec.scanners[7].scanner).toBe("load-stress");
  });

  it("emits start / scanner-started / scanner-completed / completed events in order", async () => {
    const hub = makeHub();
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    await runTemperingRun({ projectDir, hub, spawn, adapter: fakeAdapter });
    const types = hub.events.map((e) => e.type);
    // Slice 05.1 — eight scanners fire in order (unit, integration,
    // ui-playwright, contract, visual-diff, flakiness, perf-budget,
    // load-stress), each bracketed by started/completed.
    expect(types).toEqual([
      "tempering-run-started",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-scanner-started",
      "tempering-run-scanner-completed",
      "tempering-run-completed",
    ]);
  });

  it("tempering-run-completed carries primitives only (no source content)", async () => {
    const hub = makeHub();
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    await runTemperingRun({ projectDir, hub, spawn, adapter: fakeAdapter });
    const completed = hub.events.find((e) => e.type === "tempering-run-completed");
    expect(completed).toBeDefined();
    expect(Object.keys(completed.data).sort()).toEqual([
      "correlationId", "durationMs", "fail", "pass", "runId",
      "scannerCount", "skipped", "sliceRef", "stack", "verdict",
    ]);
  });

  it("mints a correlationId when none provided", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const r = await runTemperingRun({ projectDir, spawn, adapter: fakeAdapter });
    expect(r.correlationId).toMatch(/^temper-run-/);
  });

  it("honours passed-in correlationId", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const r = await runTemperingRun({
      projectDir, spawn, adapter: fakeAdapter, correlationId: "smelt-123",
    });
    expect(r.correlationId).toBe("smelt-123");
  });

  it("returns skipped result when config.enabled is false", async () => {
    // Seed config manually with enabled:false
    mkdirSync(resolve(projectDir, ".forge", "tempering"), { recursive: true });
    writeFileSync(
      resolve(projectDir, ".forge", "tempering", "config.json"),
      JSON.stringify({ enabled: false }),
      "utf-8",
    );
    const r = await runTemperingRun({ projectDir, adapter: fakeAdapter });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("tempering-disabled");
  });

  it("propagates sliceRef through to run record and event", async () => {
    const hub = makeHub();
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const sliceRef = { plan: "Phase-TEMPER-02.md", slice: "02.1" };
    const r = await runTemperingRun({ projectDir, hub, spawn, adapter: fakeAdapter, sliceRef });
    const rec = JSON.parse(readFileSync(r.runRecordPath, "utf-8"));
    expect(rec.sliceRef).toEqual(sliceRef);
    const completed = hub.events.find((e) => e.type === "tempering-run-completed");
    expect(completed.data.sliceRef).toEqual(sliceRef);
  });

  it("writes run-<ts>.json into .forge/tempering/", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const r = await runTemperingRun({ projectDir, spawn, adapter: fakeAdapter });
    const files = readdirSync(resolve(projectDir, ".forge", "tempering"));
    expect(files.some((f) => f.startsWith("run-") && f.endsWith(".json"))).toBe(true);
    expect(r.runRecordPath).toMatch(/run-.*\.json$/);
  });
});

// ─── pickChangedFiles ────────────────────────────────────────────────

describe("pickChangedFiles", () => {
  it("returns [] when lastGreenSha missing", async () => {
    expect(await pickChangedFiles({ cwd: ".", lastGreenSha: null })).toEqual([]);
    expect(await pickChangedFiles({ cwd: ".", lastGreenSha: "" })).toEqual([]);
  });

  it("parses git diff --name-only output", async () => {
    const gitSpawn = makeFakeSpawn({ stdout: "src/a.ts\nsrc/b.ts\n\n", exitCode: 0 });
    const r = await pickChangedFiles({ cwd: ".", lastGreenSha: "abc123", gitSpawn });
    expect(r).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns [] on git failure", async () => {
    const gitSpawn = makeFakeSpawn({ exitCode: 128, stderr: "not a repo" });
    const r = await pickChangedFiles({ cwd: ".", lastGreenSha: "abc", gitSpawn });
    expect(r).toEqual([]);
  });
});

// ─── deriveOverallVerdict ────────────────────────────────────────────

describe("deriveOverallVerdict", () => {
  it("picks worst verdict", () => {
    expect(deriveOverallVerdict([{ verdict: "pass" }, { verdict: "fail" }])).toBe("fail");
    expect(deriveOverallVerdict([{ verdict: "fail" }, { verdict: "budget-exceeded" }])).toBe("budget-exceeded");
    expect(deriveOverallVerdict([{ verdict: "error" }, { verdict: "pass" }])).toBe("error");
  });
  it("returns skipped when only skipped", () => {
    expect(deriveOverallVerdict([{ verdict: "skipped" }])).toBe("skipped");
  });
  it("returns skipped for empty input", () => {
    expect(deriveOverallVerdict([])).toBe("skipped");
    expect(deriveOverallVerdict(null)).toBe("skipped");
  });
});

// ─── Server tool wiring (capabilities + tools.json + server.mjs) ─────

describe("tempering-runner — MCP wiring", () => {
  const serverSrc = readFileSync(resolve(MCP_ROOT, "server.mjs"), "utf-8");
  const capSrc = readFileSync(resolve(MCP_ROOT, "capabilities.mjs"), "utf-8");

  it("server.mjs imports runTemperingRun from tempering/runner.mjs", () => {
    expect(serverSrc).toMatch(/import\s*\{\s*runTemperingRun\s*\}\s*from\s*"\.\/tempering\/runner\.mjs"/);
  });

  it("server.mjs registers forge_tempering_run handler", () => {
    expect(serverSrc).toMatch(/name === "forge_tempering_run"/);
  });

  it("forge_tempering_run is in MCP_ONLY_TOOLS set", () => {
    expect(serverSrc).toMatch(/"forge_tempering_run"/);
    const idx = serverSrc.indexOf("MCP_ONLY_TOOLS = new Set");
    const after = serverSrc.slice(idx);
    expect(after.indexOf('"forge_tempering_run"')).toBeGreaterThan(0);
  });

  it("capabilities.mjs registers forge_tempering_run with addedIn 2.43.0", () => {
    // capabilities.mjs is the authoritative source; tools.json is
    // generated from it via `node server.mjs --validate` and is
    // gitignored, so we assert against capabilities.mjs only.
    expect(capSrc).toMatch(/forge_tempering_run:\s*\{/);
    expect(capSrc).toMatch(/addedIn:\s*"2\.43\.0"/);
    expect(capSrc).toMatch(/intent:\s*\[[^\]]*"tempering"/);
  });
});
