/**
 * Plan Forge — Issues #157 + #159 regression tests
 *
 * #157 — orchestrator: detectWorkers() doesn't recognise standalone GitHub Copilot CLI
 * #159 — ci/probe: detectWorkers misreports 'gh-copilot not found' when the binary
 *        is present but unexecutable (e.g. corrupt VS Code shim)
 *
 * Verifies:
 *   1. classifyProbeFailure() distinguishes the four canonical failure modes
 *      (missing / unexecutable / auth / timeout) instead of conflating them
 *      into "not found on PATH".
 *   2. detectWorkers() honours probe.fallback when the primary fails with
 *      a recoverable category (missing or unexecutable).
 *   3. Auth / timeout failures on the primary probe are surfaced verbatim —
 *      the fallback is NOT tried because retrying against a different binary
 *      doesn't help when the user already has the primary installed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process BEFORE importing orchestrator so execFileSync is the spy.
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
  })),
}));

import { execFileSync } from "node:child_process";
import { classifyProbeFailure, detectWorkers, resetCliWorkersCache } from "../orchestrator.mjs";

// ─── classifyProbeFailure unit tests (issue #159) ────────────────────────────

describe("classifyProbeFailure — issue #159 disambiguates failure modes", () => {
  it("(missing) — ENOENT becomes 'missing'", () => {
    const err = Object.assign(new Error("spawn copilot ENOENT"), { code: "ENOENT" });
    const cls = classifyProbeFailure(err, "copilot");
    expect(cls.category).toBe("missing");
    expect(cls.hint).toMatch(/not found on PATH/i);
  });

  it("(missing) — Windows 'is not recognized' becomes 'missing'", () => {
    const err = new Error("'copilot' is not recognized as an internal or external command");
    const cls = classifyProbeFailure(err, "copilot");
    expect(cls.category).toBe("missing");
  });

  it("(unexecutable) — Windows '%1 is not a valid Win32 application' becomes 'unexecutable'", () => {
    // This is the exact symptom of VS Code Copilot Chat's empty copilot.bat shim.
    const err = new Error("fork/exec C:\\Users\\x\\AppData\\Roaming\\Code\\User\\globalStorage\\github.copilot-chat\\copilotCli\\copilot.bat: %1 is not a valid Win32 application.");
    const cls = classifyProbeFailure(err, "copilot");
    expect(cls.category).toBe("unexecutable");
    expect(cls.hint).toMatch(/corrupt|shim|empty/i);
    expect(cls.hint).toMatch(/where\.exe copilot/);
  });

  it("(unexecutable) — Linux 'Exec format error' becomes 'unexecutable'", () => {
    const err = new Error("/usr/local/bin/copilot: Exec format error");
    const cls = classifyProbeFailure(err, "copilot");
    expect(cls.category).toBe("unexecutable");
  });

  it("(auth) — gh copilot 'No authentication information found' becomes 'auth'", () => {
    const err = Object.assign(new Error("Command failed: gh copilot --version"), {
      stderr: "Error: No authentication information found.\nRun 'gh auth login' to authenticate.",
      status: 1,
    });
    const cls = classifyProbeFailure(err, "gh copilot");
    expect(cls.category).toBe("auth");
    expect(cls.hint).toMatch(/gh auth login|COPILOT_GITHUB_TOKEN/i);
  });

  it("(auth) — standalone copilot '/login' guidance becomes 'auth'", () => {
    const err = Object.assign(new Error("Command failed"), {
      stderr: "Please log in. Start `copilot` and run the `/login` command.",
      status: 1,
    });
    const cls = classifyProbeFailure(err, "copilot");
    expect(cls.category).toBe("auth");
  });

  it("(timeout) — ETIMEDOUT becomes 'timeout'", () => {
    const err = Object.assign(new Error("Command timed out"), { code: "ETIMEDOUT" });
    const cls = classifyProbeFailure(err, "copilot");
    expect(cls.category).toBe("timeout");
    expect(cls.hint).toMatch(/timed out/i);
  });

  it("(exec-failed) — generic non-zero exit falls through to 'exec-failed'", () => {
    const err = Object.assign(new Error("Command failed: copilot --version"), {
      stderr: "some unexpected error",
      status: 42,
    });
    const cls = classifyProbeFailure(err, "copilot");
    expect(cls.category).toBe("exec-failed");
    expect(cls.hint).toMatch(/exit 42/);
  });
});

// ─── detectWorkers fallback behaviour (issue #157) ────────────────────────────

/**
 * Build an execSync mock that routes by command prefix. detectWorkers() probes
 * EVERY worker in worker-capabilities.json (gh-copilot, claude, codex,
 * copilot-coding-agent), so mocking only the gh-copilot calls leaves the
 * other workers throwing on undefined return. Default the non-gh-copilot
 * probes to a generic ENOENT so they're cleanly "missing" and don't
 * interfere with the assertions about gh-copilot.
 *
 * @param {object} ghCopilotPlan - { primary?: 'success'|'enoent'|'win32'|'auth'|'timeout', fallback?: 'success'|'enoent' }
 */
function mockProbes(ghCopilotPlan = {}) {
  const enoent = () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; };
  const win32 = () => { throw new Error("fork/exec copilot.bat: %1 is not a valid Win32 application."); };
  const auth = () => {
    const e = new Error("Command failed");
    e.stderr = "Error: No authentication information found.";
    e.status = 1;
    throw e;
  };
  const timeout = () => { const e = new Error("Command timed out"); e.code = "ETIMEDOUT"; throw e; };

  // copilot success returns:
  let copilotVersionCalls = 0;
  const copilotSuccess = (cmd) => {
    if (cmd.includes("--version")) {
      copilotVersionCalls++;
      return "GitHub Copilot CLI 1.0.41.\n";
    }
    return "Usage: copilot [options]\n  -p, --prompt <prompt>\n  --allow-all\n";
  };

  let ghCopilotVersionCalls = 0;
  const ghCopilotSuccess = (cmd) => {
    if (cmd.includes("copilot --version")) {
      ghCopilotVersionCalls++;
      return "GitHub Copilot CLI v1.2.5\n";
    }
    return "Usage: gh copilot -- -p <prompt> --yolo -p, --no-ask-user --output-format text\n";
  };

  execFileSync.mockImplementation((file, args) => {
    const cmd = [file, ...(args || [])].join(" ");
    // Standalone copilot probe (primary for gh-copilot worker)
    if (/^copilot\s/.test(cmd)) {
      switch (ghCopilotPlan.primary) {
        case "success": return copilotSuccess(cmd);
        case "win32": return win32();
        case "auth": return auth();
        case "timeout": return timeout();
        case "enoent":
        default: return enoent();
      }
    }
    // Legacy gh copilot probe (fallback for gh-copilot worker)
    if (/^gh\s+copilot/.test(cmd)) {
      switch (ghCopilotPlan.fallback) {
        case "success": return ghCopilotSuccess(cmd);
        case "enoent":
        default: return enoent();
      }
    }
    // Other workers (claude, codex, gh auth status for copilot-coding-agent) —
    // default to "missing" so they're consistently unavailable in tests.
    return enoent();
  });
}

describe("detectWorkers — issue #157 honours probe.fallback for gh-copilot", () => {
  beforeEach(() => { vi.clearAllMocks(); resetCliWorkersCache(); });
  afterEach(() => { vi.restoreAllMocks(); resetCliWorkersCache(); });

  it("(157-A) primary 'copilot' missing → falls back to 'gh copilot' which succeeds", () => {
    mockProbes({ primary: "enoent", fallback: "success" });
    const workers = detectWorkers();
    const gh = workers.find((w) => w.name === "gh-copilot");
    expect(gh).toBeDefined();
    expect(gh.available).toBe(true);
    expect(gh.usingFallback).toBe(true);
  });

  it("(157-B) primary 'copilot' present and capable → no fallback attempt", () => {
    mockProbes({ primary: "success" });
    const workers = detectWorkers();
    const gh = workers.find((w) => w.name === "gh-copilot");
    expect(gh.available).toBe(true);
    expect(gh.usingFallback).toBe(false);
    expect(gh.probedCommand).toBe("copilot");
  });

  it("(157-C) BOTH primary and fallback missing → reports primary failure with fallback note", () => {
    mockProbes({ primary: "enoent", fallback: "enoent" });
    const workers = detectWorkers();
    const gh = workers.find((w) => w.name === "gh-copilot");
    expect(gh.available).toBe(false);
    expect(gh.failureCategory).toBe("missing");
    expect(gh.reason).toMatch(/Fallback.*also failed/i);
  });

  it("(159-A) primary fails with 'not a valid Win32 application' → fallback IS tried", () => {
    mockProbes({ primary: "win32", fallback: "success" });
    const workers = detectWorkers();
    const gh = workers.find((w) => w.name === "gh-copilot");
    expect(gh.available).toBe(true);
    expect(gh.usingFallback).toBe(true);
  });

  it("(159-B) primary fails with auth error → fallback NOT tried (terminal)", () => {
    mockProbes({ primary: "auth", fallback: "success" });
    const workers = detectWorkers();
    const gh = workers.find((w) => w.name === "gh-copilot");
    expect(gh.available).toBe(false);
    expect(gh.failureCategory).toBe("auth");
    // Verify fallback was NOT attempted: no `gh copilot --version` call
    // should appear, even though the mock would have returned success for it.
    const fallbackCalls = execFileSync.mock.calls.filter((c) => /^gh\s+copilot\s+--version/.test([c[0], ...(c[1] || [])].join(" ")));
    expect(fallbackCalls.length).toBe(0);
  });

  it("(159-C) primary fails with timeout → fallback NOT tried", () => {
    mockProbes({ primary: "timeout", fallback: "success" });
    const workers = detectWorkers();
    const gh = workers.find((w) => w.name === "gh-copilot");
    expect(gh.available).toBe(false);
    expect(gh.failureCategory).toBe("timeout");
    const fallbackCalls = execFileSync.mock.calls.filter((c) => /^gh\s+copilot\s+--version/.test([c[0], ...(c[1] || [])].join(" ")));
    expect(fallbackCalls.length).toBe(0);
  });
});

// ─── Cache-bust regression (Phase-50 follow-up, 2026-05-19) ──────────────────
//
// Symptom that motivated this test:
//   After a 4+ minute slice completed, the next slice's back-off retry loop
//   (1s/3s/5s) all returned "No CLI workers available" — even though `gh`
//   itself was healthy. Root cause: the first failed probe poisoned the
//   60-second _cliWorkersCache, and the retry loop re-read the cache instead
//   of re-probing. Fix: orchestrator.mjs calls resetCliWorkersCache() before
//   each runProbe() inside the back-off loop.
//
// These tests pin the cache contract so a future "optimisation" can't
// silently break the retry-recovery path again.

describe("detectWorkers — _cliWorkersCache TTL & resetCliWorkersCache() contract", () => {
  beforeEach(() => { vi.clearAllMocks(); resetCliWorkersCache(); });
  afterEach(() => { vi.restoreAllMocks(); resetCliWorkersCache(); });

  it("(cache-A) failed probe is cached — second call within TTL does NOT re-spawn execSync", () => {
    mockProbes({ primary: "enoent", fallback: "enoent" });
    const first = detectWorkers();
    expect(first.find((w) => w.name === "gh-copilot").available).toBe(false);
    const callCountAfterFirst = execFileSync.mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0); // probed at least once

    // Second call (no reset) should hit the cache — zero new execFileSync calls.
    const second = detectWorkers();
    expect(second.find((w) => w.name === "gh-copilot").available).toBe(false);
    expect(execFileSync.mock.calls.length).toBe(callCountAfterFirst);
  });

  it("(cache-B) resetCliWorkersCache() forces re-probe — recovers when binary becomes available", () => {
    // First call: gh-copilot is missing. Result gets cached.
    mockProbes({ primary: "enoent", fallback: "enoent" });
    const first = detectWorkers();
    expect(first.find((w) => w.name === "gh-copilot").available).toBe(false);
    const callsAfterFirst = execFileSync.mock.calls.length;

    // Now the binary becomes available (simulates: stale handle released,
    // transient PATH issue resolved, etc.). Without the reset, the cache
    // would keep returning "unavailable" for 60 seconds.
    mockProbes({ primary: "success" });

    // Without reset → cached failure persists, no new execFileSync calls.
    const stillCached = detectWorkers();
    expect(stillCached.find((w) => w.name === "gh-copilot").available).toBe(false);
    expect(execFileSync.mock.calls.length).toBe(callsAfterFirst);

    // With reset → re-probes and now sees the binary.
    resetCliWorkersCache();
    const recovered = detectWorkers();
    expect(recovered.find((w) => w.name === "gh-copilot").available).toBe(true);
    expect(execFileSync.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
