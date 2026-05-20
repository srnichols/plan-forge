/**
 * Tests for the observer-loop CLI surface (Phase-39, Slice 8).
 *
 * Covers: OBSERVER_PID_FILE, getObserverPidPath, getObserverStatus,
 * startObserverDaemon, stopObserverDaemon.
 *
 * Uses a temporary directory for cwd on each test to avoid touching the
 * real .forge/ directory.
 *
 * v3.8.2 hotfix: mocks node:child_process so startObserverDaemon does NOT
 * spawn real detached daemons during tests. Each unmocked run leaked 2 orphan
 * `node observer-loop.mjs daemon` processes that survived vitest teardown
 * (PID file lived in the tmpDir that vitest deleted, leaving no way to
 * reap the daemon). Mocking at the system boundary (spawn) is the
 * architecturally correct fix — tests assert the contract via the mock
 * rather than punching through to the real OS subprocess layer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Mock child_process BEFORE importing observer-loop ───────────────
// startObserverDaemon calls spawn(detached: true) → without this mock,
// every test run leaks a real long-lived node process.
//
// vi.hoisted() runs BEFORE vi.mock factories, so _mockSpawn / MOCK_CHILD_PID
// are safe to reference inside the factory (vi.mock itself is hoisted above
// all imports — a plain top-level const would not be initialised yet).
const { _mockSpawn, MOCK_CHILD_PID } = vi.hoisted(() => {
  const pid = 12345;
  return {
    MOCK_CHILD_PID: pid,
    _mockSpawn: vi.fn(() => ({ pid, unref: vi.fn() })),
  };
});
vi.mock("node:child_process", () => ({
  spawn: _mockSpawn,
}));

import {
  OBSERVER_PID_FILE,
  getObserverPidPath,
  getObserverStatus,
  startObserverDaemon,
  stopObserverDaemon,
} from "../src/observer-loop.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

let tmpDir;

function makeTmp() {
  return mkdtempSync(join(tmpdir(), "obs-cli-test-"));
}

function forgePidPath(dir) {
  return join(dir, ".forge", OBSERVER_PID_FILE);
}

function writePid(dir, pid) {
  const forgeDir = join(dir, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(forgePidPath(dir), String(pid));
}

beforeEach(() => { tmpDir = makeTmp(); });
afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ } });

// ─── OBSERVER_PID_FILE constant ───────────────────────────────────────

describe("OBSERVER_PID_FILE", () => {
  it("is a non-empty string", () => {
    expect(typeof OBSERVER_PID_FILE).toBe("string");
    expect(OBSERVER_PID_FILE.length).toBeGreaterThan(0);
  });

  it("ends with .pid", () => {
    expect(OBSERVER_PID_FILE.endsWith(".pid")).toBe(true);
  });

  it("contains 'observer'", () => {
    expect(OBSERVER_PID_FILE.toLowerCase()).toContain("observer");
  });
});

// ─── getObserverPidPath ───────────────────────────────────────────────

describe("getObserverPidPath", () => {
  it("returns a path inside .forge/", () => {
    const p = getObserverPidPath(tmpDir);
    expect(p).toContain(".forge");
    expect(p).toContain(OBSERVER_PID_FILE);
  });

  it("is an absolute path", () => {
    const p = getObserverPidPath(tmpDir);
    // Absolute path starts with / on Unix or drive letter on Windows
    expect(/^([A-Za-z]:[/\\]|\/)/.test(p)).toBe(true);
  });

  it("path is rooted in the supplied cwd", () => {
    const p = getObserverPidPath(tmpDir);
    expect(p.startsWith(tmpDir)).toBe(true);
  });
});

// ─── getObserverStatus ────────────────────────────────────────────────

describe("getObserverStatus", () => {
  it("returns { running: false } when .forge dir does not exist", async () => {
    const st = await getObserverStatus({ cwd: tmpDir });
    expect(st.running).toBe(false);
    expect(st.pid).toBeUndefined();
  });

  it("returns { running: false } when PID file does not exist", async () => {
    mkdirSync(join(tmpDir, ".forge"), { recursive: true });
    const st = await getObserverStatus({ cwd: tmpDir });
    expect(st.running).toBe(false);
  });

  it("returns { running: false } when PID file is empty", async () => {
    writePid(tmpDir, "");
    const st = await getObserverStatus({ cwd: tmpDir });
    expect(st.running).toBe(false);
  });

  it("returns { running: false } when PID file contains non-numeric content", async () => {
    writePid(tmpDir, "not-a-pid");
    const st = await getObserverStatus({ cwd: tmpDir });
    expect(st.running).toBe(false);
  });

  it("returns { running: false } for a PID that does not exist", async () => {
    // PID 999999999 is virtually guaranteed not to exist
    writePid(tmpDir, "999999999");
    const st = await getObserverStatus({ cwd: tmpDir });
    expect(st.running).toBe(false);
  });

  it("returns { running: true, pid } for the current process PID", async () => {
    writePid(tmpDir, process.pid);
    const st = await getObserverStatus({ cwd: tmpDir });
    expect(st.running).toBe(true);
    expect(st.pid).toBe(process.pid);
  });
});

// ─── stopObserverDaemon ───────────────────────────────────────────────

describe("stopObserverDaemon", () => {
  it("resolves without error when not running (no .forge dir)", async () => {
    await expect(stopObserverDaemon({ cwd: tmpDir })).resolves.toBeUndefined();
  });

  it("resolves without error when PID file is missing", async () => {
    mkdirSync(join(tmpDir, ".forge"), { recursive: true });
    await expect(stopObserverDaemon({ cwd: tmpDir })).resolves.toBeUndefined();
  });

  it("resolves without error when PID file is empty", async () => {
    writePid(tmpDir, "");
    await expect(stopObserverDaemon({ cwd: tmpDir })).resolves.toBeUndefined();
  });

  it("clears PID file after stopping a dead process", async () => {
    // Use a PID that is effectively dead (999999999)
    writePid(tmpDir, "999999999");
    await stopObserverDaemon({ cwd: tmpDir });
    const content = readFileSync(forgePidPath(tmpDir), "utf-8").trim();
    expect(content).toBe("");
  });
});

// ─── startObserverDaemon ──────────────────────────────────────────────
//
// child_process.spawn is mocked at module scope (top of file). The mock returns
// { pid: MOCK_CHILD_PID, unref: fn() } so startObserverDaemon completes without
// launching a real OS subprocess. Tests assert the contract via the mock + PID
// file rather than against a live daemon.

describe("startObserverDaemon", () => {
  beforeEach(() => { _mockSpawn.mockClear(); });

  it("creates the .forge directory if it does not exist", async () => {
    await startObserverDaemon({ cwd: tmpDir });
    expect(existsSync(join(tmpDir, ".forge"))).toBe(true);
  });

  it("invokes child_process.spawn with the daemon arg and detached:true", async () => {
    await startObserverDaemon({ cwd: tmpDir });
    expect(_mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = _mockSpawn.mock.calls[0];
    expect(cmd).toBe(process.execPath);
    expect(Array.isArray(args)).toBe(true);
    expect(args).toContain("daemon");
    expect(opts).toMatchObject({ detached: true, cwd: tmpDir });
  });

  it("writes the spawned PID to the PID file on start", async () => {
    await startObserverDaemon({ cwd: tmpDir });
    const pidPath = forgePidPath(tmpDir);
    expect(existsSync(pidPath)).toBe(true);
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    expect(pid).toBe(MOCK_CHILD_PID);
  });

  it("does not spawn a second daemon if already running", async () => {
    // Write our own PID as if we're the daemon — getObserverStatus returns running: true
    writePid(tmpDir, process.pid);
    // startObserverDaemon should bail early; PID file should remain unchanged
    // and spawn must NOT be called.
    await startObserverDaemon({ cwd: tmpDir });
    const pid = parseInt(readFileSync(forgePidPath(tmpDir), "utf-8").trim(), 10);
    expect(pid).toBe(process.pid);
    expect(_mockSpawn).not.toHaveBeenCalled();
  });
});

// ─── Module export completeness ───────────────────────────────────────

describe("observer-loop module exports", () => {
  it("exports all CLI-surface names", async () => {
    const mod = await import("../src/observer-loop.mjs");
    expect(typeof mod.OBSERVER_PID_FILE).toBe("string");
    expect(typeof mod.getObserverPidPath).toBe("function");
    expect(typeof mod.getObserverStatus).toBe("function");
    expect(typeof mod.startObserverDaemon).toBe("function");
    expect(typeof mod.stopObserverDaemon).toBe("function");
  });

  it("still exports core loop exports from prior slices", async () => {
    const mod = await import("../src/observer-loop.mjs");
    expect(typeof mod.startObserver).toBe("function");
    expect(typeof mod.DEFAULT_BATCH_WINDOW_MS).toBe("number");
    expect(typeof mod.MAX_RECONNECT_RETRIES).toBe("number");
    expect(mod.OBSERVER_SUBSCRIBED_EVENTS instanceof Set).toBe(true);
    expect(typeof mod.OBSERVER_NARRATION_EVENT_TYPE).toBe("string");
  });
});
