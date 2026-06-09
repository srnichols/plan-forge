/**
 * Plan Forge — orchestrator-defect regression: libuv UV_HANDLE_CLOSING abort.
 *
 * Root cause: orchestrator.mjs wired the Node "exit" event into the same loop
 * that calls child.kill() on every tracked worker child. The "exit" handler
 * runs after the libuv event loop has drained, when child-process handles are
 * already in the closing state — calling child.kill() (a libuv handle op) at
 * that point trips `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` in
 * src/win/async.c and aborts the process. This reproduced reliably when >=2
 * parallel Full-Auto workers failed auth and the run aborted fast while several
 * child handles were still mid-close.
 *
 * Verifies:
 *   (1) killTrackedChildren() signals every tracked child exactly once.
 *   (2) killTrackedChildren() is idempotent (one-shot shutdown guard).
 *   (3) killTrackedChildren() swallows kill() errors (handle already gone).
 *   (4) installChildCleanupHandlers() wires SIGINT/SIGTERM/SIGHUP — NOT "exit".
 *   (5) orchestrator.mjs no longer registers a child-killing "exit" handler.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import {
  killTrackedChildren,
  installChildCleanupHandlers,
  __resetChildShutdownGuard,
} from "../orchestrator/worker-spawn.mjs";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

function makeFakeChild() {
  return { killed: false, signal: null, kill(sig) { this.killed = true; this.signal = sig; } };
}

describe("child cleanup — UV_HANDLE_CLOSING regression", () => {
  beforeEach(() => {
    __resetChildShutdownGuard();
    global.__pforgeChildren = new Set();
  });

  afterEach(() => {
    delete global.__pforgeChildren;
  });

  it("(1) signals every tracked child once", () => {
    const a = makeFakeChild();
    const b = makeFakeChild();
    global.__pforgeChildren.add(a);
    global.__pforgeChildren.add(b);

    const count = killTrackedChildren();

    expect(count).toBe(2);
    expect(a.killed).toBe(true);
    expect(a.signal).toBe("SIGTERM");
    expect(b.killed).toBe(true);
  });

  it("(2) is idempotent — second call signals nothing", () => {
    global.__pforgeChildren.add(makeFakeChild());
    expect(killTrackedChildren()).toBe(1);
    expect(killTrackedChildren()).toBe(0);
  });

  it("(3) swallows kill() errors from already-gone handles", () => {
    const exploding = { kill() { throw new Error("handle gone"); } };
    const healthy = makeFakeChild();
    global.__pforgeChildren.add(exploding);
    global.__pforgeChildren.add(healthy);

    expect(() => killTrackedChildren()).not.toThrow();
    expect(healthy.killed).toBe(true);
  });

  it("(4) installs SIGINT/SIGTERM/SIGHUP handlers but never an exit handler", () => {
    const wired = [];
    const fakeProc = { once(sig) { wired.push(sig); } };

    installChildCleanupHandlers(fakeProc);

    expect(wired).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(wired).not.toContain("exit");
  });

  it("(5) orchestrator.mjs does not register a child-killing exit handler", () => {
    const src = readFileSync(resolve(__dirname, "..", "orchestrator.mjs"), "utf8");
    // The old, crash-prone pattern wired "exit" into the kill loop.
    expect(src).not.toMatch(/process\.on\(\s*["']exit["']/);
    expect(src).not.toMatch(/\["']?exit["']?,\s*["']SIGINT["']/);
    // It must delegate to the safe installer instead.
    expect(src).toContain("installChildCleanupHandlers()");
  });
});
