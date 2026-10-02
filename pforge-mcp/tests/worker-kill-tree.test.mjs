/**
 * Worker timeout must free the slice even when the worker has children.
 *
 * On Windows the CLI worker runs as `cmd /d /s /c copilot ...`. The timeout
 * called child.kill("SIGTERM"), which ended cmd.exe but left copilot (and the
 * tools it started) running with the stdio pipes open, so "close" never fired
 * and the slice hung: Phase-PRESET-BUILD-CHECKS slice 3 ran 2h+ past its 30-min
 * timeout. killWorkerTree ends the whole tree; armWorkerTimeout also destroys
 * the pipes after a grace period so a surviving grandchild cannot hold the run.
 */

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { armWorkerTimeout, killWorkerTree } from "../orchestrator/worker-spawn.mjs";

function fakeChild({ pid = 4242 } = {}) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = vi.fn();
  child.stdout = { destroy: vi.fn() };
  child.stderr = { destroy: vi.fn() };
  return child;
}

function fakeSpawn({ fail = false } = {}) {
  const calls = [];
  const fn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const proc = new EventEmitter();
    if (fail) queueMicrotask(() => proc.emit("error", new Error("taskkill missing")));
    return proc;
  };
  return { fn, calls };
}

describe("killWorkerTree", () => {
  it("ends the whole tree with taskkill /T /F on Windows", () => {
    const child = fakeChild();
    const spawnFn = fakeSpawn();
    killWorkerTree(child, { platform: "win32", spawnFn: spawnFn.fn });

    expect(spawnFn.calls).toHaveLength(1);
    expect(spawnFn.calls[0].cmd).toBe("taskkill");
    expect(spawnFn.calls[0].args).toEqual(["/pid", "4242", "/T", "/F"]);
    expect(spawnFn.calls[0].opts).toMatchObject({ windowsHide: true, stdio: "ignore" });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("falls back to child.kill when taskkill cannot start", async () => {
    const child = fakeChild();
    killWorkerTree(child, { platform: "win32", spawnFn: fakeSpawn({ fail: true }).fn });
    await new Promise((r) => setTimeout(r, 0));
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("uses SIGTERM on other platforms", () => {
    const child = fakeChild();
    const spawnFn = fakeSpawn();
    killWorkerTree(child, { platform: "linux", spawnFn: spawnFn.fn });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawnFn.calls).toHaveLength(0);
  });

  it("uses SIGTERM when the child has no pid", () => {
    const child = fakeChild({ pid: null });
    const spawnFn = fakeSpawn();
    killWorkerTree(child, { platform: "win32", spawnFn: spawnFn.fn });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(spawnFn.calls).toHaveLength(0);
  });
});

describe("armWorkerTimeout", () => {
  it("marks the run timed out, kills the tree, then destroys the pipes after the grace period", () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const state = { timedOut: false };
      const killTree = vi.fn();
      armWorkerTimeout({ child, state, timeoutMs: 1000, graceMs: 500, killTree });

      vi.advanceTimersByTime(999);
      expect(state.timedOut).toBe(false);
      vi.advanceTimersByTime(1);
      expect(state.timedOut).toBe(true);
      expect(killTree).toHaveBeenCalledWith(child);
      expect(child.stdout.destroy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(child.stdout.destroy).toHaveBeenCalled();
      expect(child.stderr.destroy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing once cancelled", () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const state = { timedOut: false };
      const killTree = vi.fn();
      const cancel = armWorkerTimeout({ child, state, timeoutMs: 1000, graceMs: 500, killTree });
      cancel();
      vi.advanceTimersByTime(5000);
      expect(state.timedOut).toBe(false);
      expect(killTree).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the pipe teardown when the worker closes within the grace period", () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const cancel = armWorkerTimeout({ child, state: { timedOut: false }, timeoutMs: 100, graceMs: 500, killTree: vi.fn() });
      vi.advanceTimersByTime(100);
      cancel();
      vi.advanceTimersByTime(1000);
      expect(child.stdout.destroy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Reproduces the real hang: cmd.exe starts node, which starts another node; both
// inherit the pipes and outlive cmd.exe. Before the fix, "close" never fired.
// (Plain "node", not process.execPath: `cmd /s` mangles a path with spaces.)
describe.runIf(process.platform === "win32")("Windows worker tree (real processes)", () => {
  it("closes after the timeout even though grandchildren hold the pipes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pforge-killtree-"));
    writeFileSync(join(dir, "inner.js"), "setInterval(() => process.stdout.write('tick\\n'), 200);");
    writeFileSync(join(dir, "mid.js"),
      "require('child_process').spawn(process.execPath, [require('path').join(__dirname, 'inner.js')], { stdio: 'inherit' }); setInterval(() => {}, 1000);");
    const child = spawn("cmd", ["/d", "/s", "/c", "node", join(dir, "mid.js")], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let ticks = 0;
    child.stdout.on("data", (d) => { ticks += String(d).split("tick").length - 1; });
    const state = { timedOut: false };
    const closed = new Promise((resolve) => child.on("close", resolve));

    const cancel = armWorkerTimeout({ child, state, timeoutMs: 1500, graceMs: 3000 });
    const outcome = await Promise.race([closed.then(() => "closed"), new Promise((r) => setTimeout(() => r("hung"), 20_000))]);
    cancel();
    rmSync(dir, { recursive: true, force: true });

    expect(ticks, "the grandchild never started, so this test proves nothing").toBeGreaterThan(0);
    expect(state.timedOut).toBe(true);
    expect(outcome).toBe("closed");
  }, 30_000);
});
