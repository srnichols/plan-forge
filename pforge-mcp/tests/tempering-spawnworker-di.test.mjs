/**
 * Phase-28.5 Slice 1 — spawnWorker DI forwarding tests.
 *
 * Validates that:
 *   1. runTemperingRun accepts a `spawnWorker` option
 *   2. runTemperingRun forwards spawnWorker to the visual-diff scanner
 *   3. runPostSliceTemperingHook accepts and forwards spawnWorker
 *   4. server.mjs imports spawnWorker from orchestrator.mjs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runTemperingRun } from "../tempering/runner.mjs";
import {
  runPostSliceTemperingHook,
  resetPostSliceTemperingFired,
} from "../orchestrator.mjs";

// ─── Helpers ────────────────────────────────────────────────────────────

function makeProject() {
  const dir = resolve(tmpdir(), `spawn-di-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  // Seed a package.json so detectStack returns "node"
  writeFileSync(resolve(dir, "package.json"), JSON.stringify({ name: "test" }));
  return dir;
}

function seedTemperingConfig(projectDir, cfg = {}) {
  mkdirSync(resolve(projectDir, ".forge", "tempering"), { recursive: true });
  writeFileSync(
    resolve(projectDir, ".forge", "tempering", "config.json"),
    JSON.stringify(cfg),
    "utf-8",
  );
}

/** Minimal adapter that makes unit+integration scanners pass without subprocesses. */
function noopAdapter() {
  return {
    unitCommand: () => ["echo", ["ok"]],
    integrationCommand: () => null,
    parseResult: () => ({ pass: 1, fail: 0, skipped: 0 }),
  };
}

/** Spawn stub that immediately resolves with exit 0. */
function fakeSpawn(cmd, args, opts) {
  const EventEmitter = require("node:events");
  const { Readable } = require("node:stream");
  const child = new EventEmitter();
  child.stdout = new Readable({ read() { this.push(null); } });
  child.stderr = new Readable({ read() { this.push(null); } });
  child.pid = 1;
  child.kill = () => {};
  process.nextTick(() => child.emit("close", 0));
  return child;
}

// ─── runTemperingRun: spawnWorker acceptance ────────────────────────────

describe("runTemperingRun — spawnWorker DI param", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeProject();
  });
  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("accepts spawnWorker without error", async () => {
    const mockSpawnWorker = vi.fn();
    const r = await runTemperingRun({
      projectDir,
      spawn: fakeSpawn,
      adapter: noopAdapter(),
      spawnWorker: mockSpawnWorker,
    });
    expect(r.ok).toBe(true);
  });

  it("forwards spawnWorker to visual-diff scanner impl", async () => {
    const mockSpawnWorker = vi.fn();
    let received = null;

    const r = await runTemperingRun({
      projectDir,
      spawn: fakeSpawn,
      adapter: noopAdapter(),
      spawnWorker: mockSpawnWorker,
      visualDiffScannerImpl: async (ctx) => {
        received = ctx.spawnWorker;
        return {
          scanner: "visual-diff",
          verdict: "pass",
          pass: 0, fail: 0,
          durationMs: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
    });
    expect(r.ok).toBe(true);
    expect(received).toBe(mockSpawnWorker);
  });

  it("passes null spawnWorker when not provided", async () => {
    let received = "NOT_SET";

    await runTemperingRun({
      projectDir,
      spawn: fakeSpawn,
      adapter: noopAdapter(),
      visualDiffScannerImpl: async (ctx) => {
        received = ctx.spawnWorker;
        return {
          scanner: "visual-diff",
          verdict: "pass",
          pass: 0, fail: 0,
          durationMs: 0,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };
      },
    });
    expect(received).toBeNull();
  });
});

// ─── runPostSliceTemperingHook: spawnWorker forwarding ──────────────────

describe("runPostSliceTemperingHook — spawnWorker forwarding", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeProject();
    resetPostSliceTemperingFired();
  });
  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("forwards spawnWorker to the injected runner", async () => {
    const mockSpawnWorker = vi.fn();
    let receivedSpawnWorker = null;

    const r = await runPostSliceTemperingHook({
      commitMessage: "feat(temper): add spawnWorker DI",
      cwd: projectDir,
      sliceRef: { plan: "Phase-28.5-PLAN.md", slice: "01" },
      spawnWorker: mockSpawnWorker,
      runTemperingRun: async (args) => {
        receivedSpawnWorker = args.spawnWorker;
        return { ok: true, verdict: "pass" };
      },
    });

    expect(r.triggered).toBe(true);
    expect(receivedSpawnWorker).toBe(mockSpawnWorker);
  });

  it("passes null spawnWorker when not provided", async () => {
    let receivedSpawnWorker = "NOT_SET";

    await runPostSliceTemperingHook({
      commitMessage: "feat(temper): test null spawnWorker",
      cwd: projectDir,
      sliceRef: { plan: "Phase-28.5-PLAN.md", slice: "02" },
      runTemperingRun: async (args) => {
        receivedSpawnWorker = args.spawnWorker;
        return { ok: true };
      },
    });

    expect(receivedSpawnWorker).toBeNull();
  });
});

// ─── Wiring: server.mjs imports spawnWorker ─────────────────────────────

describe("server.mjs spawnWorker import wiring", () => {
  it("imports spawnWorker from orchestrator.mjs", () => {
    const serverSrc = readFileSync(
      resolve(import.meta.dirname, "..", "server.mjs"),
      "utf-8",
    );
    expect(serverSrc).toMatch(/spawnWorker.*from\s*"\.\/orchestrator\.mjs"/);
  });

  it("passes spawnWorker to runTemperingRun call", () => {
    const serverSrc = readFileSync(
      resolve(import.meta.dirname, "..", "server.mjs"),
      "utf-8",
    );
    // The forge_tempering_run handler should forward spawnWorker
    expect(serverSrc).toMatch(/runTemperingRun\(\{[^}]*spawnWorker/s);
  });
});

// ─── Wiring: runner.mjs references spawnWorker ──────────────────────────

describe("runner.mjs spawnWorker references", () => {
  it("mentions spawnWorker at least 3 times", () => {
    const runnerSrc = readFileSync(
      resolve(import.meta.dirname, "..", "tempering", "runner.mjs"),
      "utf-8",
    );
    const count = (runnerSrc.match(/spawnWorker/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
