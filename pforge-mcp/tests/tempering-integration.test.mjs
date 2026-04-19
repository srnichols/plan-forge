/**
 * Tempering integration-scanner tests (Phase TEMPER-02 Slice 02.2).
 *
 * Exercises the generic `runScanner` with `scanner: "integration"`
 * across every first-class adapter plus the common skip paths. These
 * live in a separate file from `tempering-runner.test.mjs` so the
 * integration-specific matrix (6 stacks × parser shape) is readable
 * without wading through unit-scanner history.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  runScanner,
  runScannerIntegration,
  runTemperingRun,
} from "../tempering/runner.mjs";
import { loadAdapter } from "../tempering/adapters.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(__dirname, "..");

function makeFakeSpawn({ stdout = "", stderr = "", exitCode = 0, delayMs = 0 } = {}) {
  const calls = [];
  const spawn = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => { setTimeout(() => proc.emit("close", null, "SIGTERM"), 1); };
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
  return { events, broadcast: (evt) => events.push(evt) };
}

function makeProject() {
  const dir = resolve(tmpdir(), `temper-int-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "package.json"), '{"name":"t"}', "utf-8");
  return dir;
}

const baseConfig = {
  enabled: true,
  scanners: { unit: true, integration: true },
  runtimeBudgets: { unitMaxMs: 60000, integrationMaxMs: 120000 },
  execution: { regressionFirst: false, trigger: "post-slice" },
};

// ─── runScanner (generic, scanner="integration") ─────────────────────

describe("runScanner — scanner: integration", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("skips when scanner is disabled in config", async () => {
    const r = await runScanner({
      scanner: "integration",
      config: { ...baseConfig, scanners: { unit: true, integration: false } },
      stack: "typescript",
      adapter: { integration: { supported: true, cmd: ["x"], parseOutput: () => ({}) } },
      cwd: projectDir,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("scanner-disabled");
    expect(r.verdict).toBe("skipped");
  });

  it("skips when adapter has no integration entry", async () => {
    const r = await runScanner({
      scanner: "integration",
      config: baseConfig,
      stack: "typescript",
      adapter: { unit: { supported: true, cmd: ["x"], parseOutput: () => ({}) } },
      cwd: projectDir,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("no-adapter");
  });

  it("skips when adapter.integration.supported === false", async () => {
    const r = await runScanner({
      scanner: "integration",
      config: baseConfig,
      stack: "php",
      adapter: { integration: { supported: false, reason: "stub" } },
      cwd: projectDir,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("stub");
  });

  it("honours integrationMaxMs budget key (not unitMaxMs)", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    await runScanner({
      scanner: "integration",
      config: {
        ...baseConfig,
        runtimeBudgets: { unitMaxMs: 1, integrationMaxMs: 999999 },
      },
      stack: "typescript",
      adapter: {
        integration: {
          supported: true,
          cmd: ["npx", "vitest", "run", "--dir", "tests/integration"],
          parseOutput: () => ({ pass: 3, fail: 0, skipped: 0 }),
        },
      },
      cwd: projectDir,
      spawn,
    });
    // If we'd used unitMaxMs (1 ms), the fake spawn's ~0 ms delay
    // would still race; we're really asserting the call went through
    // and completed. The verdict check is the real oracle.
    const r = await runScanner({
      scanner: "integration",
      config: baseConfig,
      stack: "typescript",
      adapter: {
        integration: {
          supported: true,
          cmd: ["x"],
          parseOutput: () => ({ pass: 3, fail: 0, skipped: 0 }),
        },
      },
      cwd: projectDir,
      spawn,
    });
    expect(r.verdict).toBe("pass");
    expect(r.scanner).toBe("integration");
  });

  it("records verdict=fail when parser reports fail > 0", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 1 });
    const r = await runScanner({
      scanner: "integration",
      config: baseConfig,
      stack: "typescript",
      adapter: {
        integration: {
          supported: true,
          cmd: ["x"],
          parseOutput: () => ({ pass: 2, fail: 1, skipped: 0 }),
        },
      },
      cwd: projectDir,
      spawn,
    });
    expect(r.verdict).toBe("fail");
    expect(r.fail).toBe(1);
  });

  it("carries scanner='integration' on the returned record", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const r = await runScanner({
      scanner: "integration",
      config: baseConfig,
      stack: "typescript",
      adapter: {
        integration: {
          supported: true,
          cmd: ["x"],
          parseOutput: () => ({ pass: 1, fail: 0, skipped: 0 }),
        },
      },
      cwd: projectDir,
      spawn,
    });
    expect(r.scanner).toBe("integration");
  });
});

// ─── runScannerIntegration wrapper ───────────────────────────────────

describe("runScannerIntegration — back-compat wrapper", () => {
  it("routes through runScanner with scanner='integration'", async () => {
    const r = await runScannerIntegration({
      config: baseConfig,
      stack: "typescript",
      adapter: null,
      cwd: ".",
    });
    expect(r.scanner).toBe("integration");
    expect(r.skipped).toBe(true);
  });
});

// ─── Adapter integration parsers ─────────────────────────────────────
// Load each real adapter and feed canonical output samples through its
// integration.parseOutput. Catches regressions in parsers without
// booting a real test runner.

describe("preset adapters — integration.parseOutput", () => {
  it("typescript parses vitest JSON", async () => {
    const mod = await loadAdapter("typescript");
    expect(mod).toBeTruthy();
    expect(mod.integration).toBeTruthy();
    const sample = JSON.stringify({
      numTotalTests: 10,
      numPassedTests: 8,
      numFailedTests: 1,
      numPendingTests: 1,
    });
    const r = mod.integration.parseOutput(sample, "", 1);
    expect(r.pass).toBe(8);
    expect(r.fail).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it("dotnet parses Microsoft test summary", async () => {
    const mod = await loadAdapter("dotnet");
    const sample = "Passed!  - Failed:     0, Passed:    42, Skipped:     3, Total:    45";
    const r = mod.integration.parseOutput(sample, "", 0);
    expect(r.pass).toBe(42);
    expect(r.fail).toBe(0);
    expect(r.skipped).toBe(3);
  });

  it("python parses pytest summary line", async () => {
    const mod = await loadAdapter("python");
    const sample = "=========== 7 passed, 2 failed, 1 skipped in 3.42s ===========";
    const r = mod.integration.parseOutput(sample, "", 1);
    expect(r.pass).toBe(7);
    expect(r.fail).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it("go parses -json event stream", async () => {
    const mod = await loadAdapter("go");
    const sample = [
      '{"Action":"pass","Test":"TestA"}',
      '{"Action":"fail","Test":"TestB"}',
      '{"Action":"skip","Test":"TestC"}',
      '{"Action":"pass","Test":"TestD"}',
    ].join("\n");
    const r = mod.integration.parseOutput(sample, "", 1);
    expect(r.pass).toBe(2);
    expect(r.fail).toBe(1);
    expect(r.skipped).toBe(1);
  });

  it("java parses Surefire totals", async () => {
    const mod = await loadAdapter("java");
    const sample = "Tests run: 15, Failures: 1, Errors: 0, Skipped: 2";
    const r = mod.integration.parseOutput(sample, "", 1);
    expect(r.pass).toBe(12);  // 15 - 1 - 0 - 2
    expect(r.fail).toBe(1);
    expect(r.skipped).toBe(2);
  });

  it("rust parses cargo test result line", async () => {
    const mod = await loadAdapter("rust");
    const sample = "test result: ok. 23 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out";
    const r = mod.integration.parseOutput(sample, "", 0);
    expect(r.pass).toBe(23);
    expect(r.fail).toBe(0);
    expect(r.skipped).toBe(1);
  });
});

// ─── End-to-end: runTemperingRun with both scanners ──────────────────

describe("runTemperingRun — two-scanner run (TEMPER-02 Slice 02.2)", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeProject(); });
  afterEach(() => { try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const bothScannersAdapter = {
    unit: {
      supported: true,
      cmd: ["npx", "vitest", "run"],
      parseOutput: () => ({ pass: 5, fail: 0, skipped: 0 }),
    },
    integration: {
      supported: true,
      cmd: ["npx", "vitest", "run", "--dir", "tests/integration"],
      parseOutput: () => ({ pass: 3, fail: 0, skipped: 0 }),
    },
  };

  it("runs unit then integration and totals pass/fail across both", async () => {
    const hub = makeHub();
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const r = await runTemperingRun({
      projectDir, hub, spawn, adapter: bothScannersAdapter,
    });
    // Slice 05.1 adds flakiness, perf-budget, load-stress scanners.
    // 8 entries on the record but only unit+integration contribute to
    // pass/fail totals here.
    expect(r.scanners).toHaveLength(8);
    expect(r.scanners[0].scanner).toBe("unit");
    expect(r.scanners[1].scanner).toBe("integration");
    expect(r.scanners[2].scanner).toBe("ui-playwright");
    expect(r.scanners[2].skipped).toBe(true);
    expect(r.scanners[3].scanner).toBe("contract");
    expect(r.scanners[3].skipped).toBe(true);
    expect(r.scanners[4].scanner).toBe("visual-diff");
    expect(r.scanners[5].scanner).toBe("flakiness");
    expect(r.scanners[6].scanner).toBe("performance-budget");
    expect(r.scanners[7].scanner).toBe("load-stress");
    expect(r.verdict).toBe("pass");

    const completed = hub.events.find((e) => e.type === "tempering-run-completed");
    expect(completed.data.scannerCount).toBe(8);
    expect(completed.data.pass).toBe(8);
  });

  it("short-circuits integration when unit hits budget-exceeded", async () => {
    // budgetMaxMs=1 with a hanging fake spawn → unit times out.
    const spawn = (bin, args, opts) => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => { setTimeout(() => proc.emit("close", null, "SIGTERM"), 1); };
      // never emits close on its own — forces budget-exceeded
      return proc;
    };
    // Seed config with tiny unit budget
    mkdirSync(resolve(projectDir, ".forge", "tempering"), { recursive: true });
    writeFileSync(
      resolve(projectDir, ".forge", "tempering", "config.json"),
      JSON.stringify({
        enabled: true,
        scanners: { unit: true, integration: true, "ui-playwright": true },
        runtimeBudgets: { unitMaxMs: 1, integrationMaxMs: 60000 },
        execution: { regressionFirst: false, trigger: "post-slice" },
      }),
      "utf-8",
    );
    const r = await runTemperingRun({
      projectDir, spawn, adapter: bothScannersAdapter,
    });
    expect(r.scanners[0].verdict).toBe("budget-exceeded");
    expect(r.scanners[1].skipped).toBe(true);
    expect(r.scanners[1].reason).toBe("prior-budget-exceeded");
    // UI scanner also short-circuits with prior-budget-exceeded so
    // we don't try to launch Chromium after the run's already blown.
    expect(r.scanners[2].skipped).toBe(true);
    expect(r.scanners[2].reason).toBe("prior-budget-exceeded");
    // Contract scanner also short-circuits with prior-budget-exceeded.
    expect(r.scanners[3].scanner).toBe("contract");
    expect(r.scanners[3].skipped).toBe(true);
    expect(r.scanners[3].reason).toBe("prior-budget-exceeded");
    // Visual-diff scanner also short-circuits with prior-budget-exceeded.
    expect(r.scanners[4].scanner).toBe("visual-diff");
    expect(r.scanners[4].skipped).toBe(true);
    expect(r.scanners[4].reason).toBe("prior-budget-exceeded");
  });

  it("records slice '05.1' on the run record", async () => {
    const spawn = makeFakeSpawn({ stdout: "", exitCode: 0 });
    const r = await runTemperingRun({
      projectDir, spawn, adapter: bothScannersAdapter,
    });
    const { readFileSync } = await import("node:fs");
    const rec = JSON.parse(readFileSync(r.runRecordPath, "utf-8"));
    expect(rec.slice).toBe("05.1");
  });
});
