/**
 * Plan Forge -- Phase-34.1 Slice 1: Windows bash dispatch in runGate
 *
 * Covers:
 *   - runGate on Linux always uses execSync (never execFileSync)
 *   - runGate on Windows with a non-Unix-tool command uses execSync
 *   - runGate on Windows with a Unix tool routes through bash when bash is found
 *   - runGate on Windows with a Unix tool returns a helpful error when bash is not found
 *   - resolveBashPath caches its result and does not re-probe on subsequent calls
 *   - resolveBashPath PFORGE_BASH_PATH env override takes priority over cached probe
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockExecSync = vi.fn();
const mockExecFileSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execSync: (...args) => mockExecSync(...args),
    execFileSync: (...args) => mockExecFileSync(...args),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: (...args) => mockExistsSync(...args),
  };
});

import { runGate, resolveBashPath, __resetBashPathCache } from "../orchestrator.mjs";

function stubPlatform(platform) {
  vi.stubGlobal("process", { ...process, platform });
}

describe("runGate -- platform dispatch", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    mockExecFileSync.mockReset();
    mockExistsSync.mockReset();
    mockExecSync.mockReturnValue("execSync-output");
    mockExecFileSync.mockReturnValue("execFileSync-output");
    mockExistsSync.mockReturnValue(false);
    __resetBashPathCache();
    delete process.env.PFORGE_BASH_PATH;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PFORGE_BASH_PATH;
  });

  it("on Linux always uses execSync, never execFileSync", () => {
    stubPlatform("linux");
    mockExecSync.mockReturnValue("grep output");

    const result = runGate("grep foo bar.txt", "/tmp");

    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledOnce();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("on Windows with a non-Unix-tool command (npm) uses execSync", () => {
    stubPlatform("win32");
    mockExecSync.mockReturnValue("npm output");

    const result = runGate("npm test", "C:\\project");

    expect(result.success).toBe(true);
    expect(mockExecSync).toHaveBeenCalledOnce();
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it("on Windows with a Unix tool routes through bash when bash is found", () => {
    stubPlatform("win32");
    const bashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockExistsSync.mockImplementation((p) => p === bashPath);
    mockExecFileSync.mockReturnValue("grep result\n");

    const result = runGate("grep -q foo bar.txt", "C:\\project");

    expect(result.success).toBe(true);
    expect(result.output).toBe("grep result");
    const dispatchCall = mockExecFileSync.mock.calls.find((c) => c[1] && c[1][0] === "-c");
    expect(dispatchCall).toBeTruthy();
    expect(dispatchCall[0]).toBe(bashPath);
    expect(dispatchCall[1]).toEqual(["-c", "grep -q foo bar.txt"]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("on Windows with a Unix tool returns helpful error when bash is not found", () => {
    stubPlatform("win32");
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => { throw new Error("not found"); });

    const result = runGate("grep foo bar.txt", "C:\\project");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bash/i);
    expect(result.error).toMatch(/grep/);
    expect(result.error).toMatch(/PFORGE_BASH_PATH/);
  });

  it("on Windows, path-prefixed Unix tool (/usr/bin/grep) is dispatched through bash", () => {
    stubPlatform("win32");
    const bashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockExistsSync.mockImplementation((p) => p === bashPath);
    mockExecFileSync.mockReturnValue("output\n");

    const result = runGate("/usr/bin/grep -q pattern file", "C:\\project");

    expect(result.success).toBe(true);
    const dispatchCall = mockExecFileSync.mock.calls.find((c) => c[1] && c[1][0] === "-c");
    expect(dispatchCall).toBeTruthy();
    expect(dispatchCall[0]).toBe(bashPath);
  });

  // Issue #172 — `bash -c "..."` gates must route through resolveBashPath()
  // (Git Bash) instead of `where bash` lookup (which picks WSL bash on
  // modern Windows and silently breaks node/pwsh/npx calls inside the wrap).
  it("on Windows, literal `bash -c \"...\"` gates route through resolveBashPath() (Git Bash)", () => {
    stubPlatform("win32");
    const bashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockExistsSync.mockImplementation((p) => p === bashPath);
    mockExecFileSync.mockReturnValue("v22.1.0\n");

    const result = runGate('bash -c "node --version"', "C:\\project");

    expect(result.success).toBe(true);
    const dispatchCall = mockExecFileSync.mock.calls.find((c) => c[1] && c[1][0] === "-c");
    expect(dispatchCall).toBeTruthy();
    expect(dispatchCall[0]).toBe(bashPath);
    // The redundant `bash` token is stripped — only the inner body is passed,
    // not double-wrapped as `bash -c "bash -c '...'"`.
    expect(dispatchCall[1]).toEqual(["-c", "node --version"]);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("on Windows, `bash -c` with single-quoted body strips the outer quotes too", () => {
    stubPlatform("win32");
    const bashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockExistsSync.mockImplementation((p) => p === bashPath);
    mockExecFileSync.mockReturnValue("");

    const result = runGate("bash -c 'pwsh -NoProfile -Command Get-Date'", "C:\\project");

    expect(result.success).toBe(true);
    const dispatchCall = mockExecFileSync.mock.calls.find((c) => c[1] && c[1][0] === "-c");
    expect(dispatchCall[1]).toEqual(["-c", "pwsh -NoProfile -Command Get-Date"]);
  });

  it("on Windows, `bash -c` falls back to wrapping the whole command if regex doesn't match", () => {
    stubPlatform("win32");
    const bashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockExistsSync.mockImplementation((p) => p === bashPath);
    mockExecFileSync.mockReturnValue("");

    // No -c flag — pass the whole command through, don't strip
    const result = runGate("bash some-script.sh", "C:\\project");

    expect(result.success).toBe(true);
    const dispatchCall = mockExecFileSync.mock.calls.find((c) => c[1] && c[1][0] === "-c");
    expect(dispatchCall[1]).toEqual(["-c", "bash some-script.sh"]);
  });
});

describe("resolveBashPath -- caching and env override", () => {
  let tmpDir = null;

  beforeEach(() => {
    mockExecSync.mockReset();
    mockExecFileSync.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(false);
    mockExecFileSync.mockImplementation(() => { throw new Error("not found"); });
    __resetBashPathCache();
    delete process.env.PFORGE_BASH_PATH;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PFORGE_BASH_PATH;
    if (tmpDir) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      tmpDir = null;
    }
  });

  it("caches probe result -- existsSync not called again on second invocation", () => {
    stubPlatform("win32");
    const bashPath = "C:\\Program Files\\Git\\bin\\bash.exe";
    mockExistsSync.mockImplementation((p) => p === bashPath);

    const first = resolveBashPath();
    const callsAfterFirst = mockExistsSync.mock.calls.length;
    const second = resolveBashPath();

    expect(first).toBe(bashPath);
    expect(second).toBe(first);
    // No additional existsSync calls on second invocation (PFORGE_BASH_PATH not set)
    expect(mockExistsSync.mock.calls.length).toBe(callsAfterFirst);
  });

  it("PFORGE_BASH_PATH env takes priority over cached null result", () => {
    stubPlatform("win32");
    // First probe: nothing found -> caches null
    const first = resolveBashPath();
    expect(first).toBeNull();

    // Set env var to a real temp file so existsSync returns true for it
    tmpDir = mkdtempSync(join(tmpdir(), "pforge-gate-"));
    const fakeBash = join(tmpDir, "bash.exe");
    writeFileSync(fakeBash, "");
    process.env.PFORGE_BASH_PATH = fakeBash;
    // Allow existsSync to pass through for the real temp file path
    mockExistsSync.mockImplementation((p) => p === fakeBash);

    const second = resolveBashPath();
    expect(second).toBe(fakeBash);
  });
});
