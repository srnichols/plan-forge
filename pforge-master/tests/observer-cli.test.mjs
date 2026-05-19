/**
 * Tests for the observer-loop CLI surface (Phase-39, Slice 8).
 *
 * Covers: OBSERVER_PID_FILE, getObserverPidPath, getObserverStatus,
 * startObserverDaemon, stopObserverDaemon.
 *
 * Uses a temporary directory for cwd on each test to avoid touching the
 * real .forge/ directory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("startObserverDaemon", () => {
  it("creates the .forge directory if it does not exist", async () => {
    // Intercept the spawn so we don't actually launch a real process
    // We'll verify the .forge dir was created even if spawn succeeds/fails.
    // We rely on the fact that spawn will work since node exists.
    try {
      await startObserverDaemon({ cwd: tmpDir });
    } catch { /* spawn may or may not fail in test env — dir creation is what we check */ }
    expect(existsSync(join(tmpDir, ".forge"))).toBe(true);
  });

  it("writes a numeric PID to the PID file on start", async () => {
    await startObserverDaemon({ cwd: tmpDir });
    const pidPath = forgePidPath(tmpDir);
    expect(existsSync(pidPath)).toBe(true);
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    expect(Number.isFinite(pid)).toBe(true);
    expect(pid).toBeGreaterThan(0);
    // Clean up: kill the spawned daemon if it's still alive
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
  });

  it("does not spawn a second daemon if already running", async () => {
    // Write our own PID as if we're the daemon — getObserverStatus returns running: true
    writePid(tmpDir, process.pid);
    // startObserverDaemon should bail early; PID file should remain unchanged
    await startObserverDaemon({ cwd: tmpDir });
    const pid = parseInt(readFileSync(forgePidPath(tmpDir), "utf-8").trim(), 10);
    expect(pid).toBe(process.pid);
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
