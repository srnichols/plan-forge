/**
 * Plan Forge — Issue #197: background mode silent death on Windows.
 *
 * Repro: `pforge run-plan` (default background mode) emits `run-started` +
 * `slice-started`, then exits cleanly — no `slice-failed`, no stderr, no
 * stdout past the two initial events. Root cause: `Start-Process node
 * -WindowStyle Hidden` gives the process tree no attached console; `gh
 * copilot` CLI requires an attached console to survive startup, so it exits
 * immediately with no output, the worker promise resolves empty, and Node's
 * event loop drains cleanly.
 *
 * Fixes:
 *  A) pforge.ps1 — wrap node in a hidden `pwsh` host that allocates a console.
 *  B) orchestrator.mjs — `writeSilentExitRecord` exported helper writes a
 *     `slice-failed` event to events.log when the process exits mid-slice.
 *  C) orchestrator.mjs — `spawnWorker` annotates stderr when the worker exits
 *     non-zero with no output (TTY-failure fingerprint).
 *
 * Tests are unit-level. process.exit is not actually called; we invoke
 * writeSilentExitRecord directly. pforge.ps1 is tested via source inspection.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync as _readFileSync } from "node:fs";

import { writeSilentExitRecord } from "../orchestrator.mjs";

// ─── writeSilentExitRecord ────────────────────────────────────────────────────

describe("writeSilentExitRecord — Issue #197 silent-death guard", () => {
  let tmp;
  afterEach(() => {
    if (tmp) {
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
      tmp = null;
    }
  });

  it("returns false when sliceId is null (no active slice)", () => {
    expect(writeSilentExitRecord(null, "", "/some/dir")).toBe(false);
  });

  it("returns false when sliceId is undefined", () => {
    expect(writeSilentExitRecord(undefined, "", "/some/dir")).toBe(false);
  });

  it("returns false when sliceId is empty string", () => {
    expect(writeSilentExitRecord("", "", "/some/dir")).toBe(false);
  });

  it("returns true and writes slice-failed to events.log when sliceId is set", () => {
    tmp = mkdtempSync(join(tmpdir(), "pforge-test-197-"));
    const result = writeSilentExitRecord("3", "Add rate limiting", tmp);

    expect(result).toBe(true);

    const log = readFileSync(resolve(tmp, "events.log"), "utf-8");
    expect(log).toContain("slice-failed");
    expect(log).toContain('"sliceId":"3"');
    expect(log).toContain('"reason":"worker-exited-without-output"');
    expect(log).toContain("Issue #197");
  });

  it("includes title in the written event", () => {
    tmp = mkdtempSync(join(tmpdir(), "pforge-test-197-"));
    writeSilentExitRecord("5", "Deploy service", tmp);

    const log = readFileSync(resolve(tmp, "events.log"), "utf-8");
    expect(log).toContain('"title":"Deploy service"');
  });

  it("handles empty title gracefully", () => {
    tmp = mkdtempSync(join(tmpdir(), "pforge-test-197-"));
    const result = writeSilentExitRecord("1", "", tmp);

    expect(result).toBe(true);
    const log = readFileSync(resolve(tmp, "events.log"), "utf-8");
    expect(log).toContain('"title":""');
  });

  it("skips disk write when runDir is null but still returns true", () => {
    // runDir=null is valid when running without a run directory (e.g., early-exit paths).
    // appendEvent silently skips the write when logDir is null.
    const result = writeSilentExitRecord("2", "title", null);
    expect(result).toBe(true);
  });

  it("writes status: error and reason: worker-exited-without-output", () => {
    tmp = mkdtempSync(join(tmpdir(), "pforge-test-197-"));
    writeSilentExitRecord("7", "Publish to registry", tmp);

    const log = readFileSync(resolve(tmp, "events.log"), "utf-8");
    const line = log.split("\n").find((l) => l.includes("slice-failed"));
    expect(line).toBeDefined();
    const payload = JSON.parse(line.replace(/^\[.*?\] slice-failed: /, ""));
    expect(payload.status).toBe("error");
    expect(payload.reason).toBe("worker-exited-without-output");
  });

  it("event contains re-run hint directing to --foreground", () => {
    tmp = mkdtempSync(join(tmpdir(), "pforge-test-197-"));
    writeSilentExitRecord("4", "Migrate database", tmp);

    const log = readFileSync(resolve(tmp, "events.log"), "utf-8");
    expect(log).toContain("--foreground");
  });
});

// ─── pforge.ps1 source inspection ────────────────────────────────────────────

describe("pforge.ps1 background mode — Issue #197 console fix", () => {
  const ps1Path = resolve(import.meta.dirname, "../../pforge.ps1");
  let ps1;
  try {
    ps1 = _readFileSync(ps1Path, "utf-8");
  } catch {
    ps1 = null;
  }

  it("pforge.ps1 is readable", () => {
    expect(ps1).not.toBeNull();
  });

  it("background mode uses pwsh as the outer launcher (not node directly)", () => {
    // The fix wraps node inside a hidden pwsh host so gh copilot inherits a console.
    expect(ps1).toMatch(/Start-Process\s+-FilePath\s+'?pwsh'?/);
  });

  it("background mode still uses -WindowStyle Hidden", () => {
    expect(ps1).toMatch(/-WindowStyle\s+Hidden/);
  });

  it("node invocation is embedded in the inner pwsh -Command string", () => {
    // The pwsh -Command string should invoke node with the orchestrator args.
    expect(ps1).toMatch(/\$nodeInvocation|& node \$quotedNodeArgs|node.*\*>&1/);
  });

  it("combined log replaces the split stdout/stderr log files", () => {
    // Before the fix: orch-<stamp>.stdout.log + orch-<stamp>.stderr.log
    // After the fix:  orch-<stamp>.log (merged)
    expect(ps1).toMatch(/orch-\$stamp\.log/);
    // The old split log filenames should not appear
    expect(ps1).not.toMatch(/orch-\$stamp\.stdout\.log/);
    expect(ps1).not.toMatch(/orch-\$stamp\.stderr\.log/);
  });

  it("output is captured with Tee-Object so the file is written while the process runs", () => {
    expect(ps1).toMatch(/Tee-Object/);
  });

  it("Issue #197 is mentioned in a comment near the background mode section", () => {
    expect(ps1).toMatch(/Issue #197/);
  });
});

// ─── orchestrator.mjs spawnWorker TTY annotation ─────────────────────────────

describe("orchestrator.mjs spawnWorker — TTY-failure annotation (Issue #197)", () => {
  const orchPath = resolve(import.meta.dirname, "../orchestrator.mjs");
  let src;
  try {
    src = _readFileSync(orchPath, "utf-8");
  } catch {
    src = null;
  }

  it("orchestrator.mjs source is readable", () => {
    expect(src).not.toBeNull();
  });

  it("spawnWorker annotates stderr when worker exits non-zero with no output", () => {
    // Guard against silent TTY failures: worker exits with non-zero and no
    // stdout/stderr → inject a diagnostic message so the run log isn't empty.
    expect(src).toMatch(/!stdout && !stderr && code !== 0 && !timedOut/);
  });

  it("annotation message references console/TTY requirement", () => {
    expect(src).toMatch(/console\/TTY required/);
  });

  it("silent-death guard registers process.once('exit') in runPlan", () => {
    expect(src).toMatch(/process\.once\(["']exit["']\s*,\s*_silentDeathGuard\)/);
  });

  it("silent-death guard clears on run-completed", () => {
    expect(src).toMatch(/run-completed.*process\.off\(["']exit["']/s);
  });

  it("silent-death guard clears on run-aborted", () => {
    expect(src).toMatch(/run-aborted.*process\.off\(["']exit["']/s);
  });
});
