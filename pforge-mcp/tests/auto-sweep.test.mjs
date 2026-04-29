/**
 * Plan Forge — Phase-33.3 Slice 1: Bug #119 runAutoSweep buffer + timeout
 *
 * Verifies:
 *   (a) Success path handles output > 1_500_000 chars without throwing.
 *   (b) ENOBUFS path returns { ran: false, clean: false, markerCount: 0, output: "" }
 *       with the documented error string.
 *   (c) RangeError is treated identically to ENOBUFS.
 *   (d) Other execSync errors are surfaced as { ran: true, clean: false }.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock child_process BEFORE importing orchestrator ────────────────────────

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
  })),
}));

import { execSync } from "node:child_process";
import { runAutoSweep } from "../orchestrator.mjs";

describe("runAutoSweep — Bug #119 buffer + timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) success path: handles output > 1_500_000 chars without throwing", () => {
    const bigOutput = "x".repeat(1_500_001);
    execSync.mockReturnValueOnce(bigOutput);

    const result = runAutoSweep("/fake/cwd");

    expect(result.ran).toBe(true);
    expect(result.output).toBe(bigOutput.trim());
    expect(result.markerCount).toBe(0);

    // Verify execSync was called with 64 MB maxBuffer and 120s timeout
    const [, opts] = execSync.mock.calls[0];
    expect(opts.maxBuffer).toBe(64 * 1024 * 1024);
    expect(opts.timeout).toBe(120_000);
  });

  it("(b) ENOBUFS path: returns degraded payload with documented error string", () => {
    const err = new Error("stdout maxBuffer exceeded");
    err.code = "ENOBUFS";
    execSync.mockImplementationOnce(() => { throw err; });

    const result = runAutoSweep("/fake/cwd");

    expect(result.ran).toBe(false);
    expect(result.clean).toBe(false);
    expect(result.markerCount).toBe(0);
    expect(result.output).toBe("");
    expect(result.error).toBe("ENOBUFS: sweep output exceeded 64MB buffer");
  });

  it("(c) RangeError path: returns same degraded payload as ENOBUFS", () => {
    execSync.mockImplementationOnce(() => { throw new RangeError("Array buffer allocation failed"); });

    const result = runAutoSweep("/fake/cwd");

    expect(result.ran).toBe(false);
    expect(result.clean).toBe(false);
    expect(result.markerCount).toBe(0);
    expect(result.output).toBe("");
    expect(result.error).toBe("ENOBUFS: sweep output exceeded 64MB buffer");
  });

  it("(d) other errors fall through to existing { ran: true, clean: false } path", () => {
    const err = new Error("pforge.sh not found");
    err.stderr = "bash: pforge.sh: No such file";
    execSync.mockImplementationOnce(() => { throw err; });

    const result = runAutoSweep("/fake/cwd");

    expect(result.ran).toBe(true);
    expect(result.clean).toBe(false);
    expect(result.error).toBe("bash: pforge.sh: No such file");
  });
});
