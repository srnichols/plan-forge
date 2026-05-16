/**
 * anvil-adoption.test.mjs — Phase ANVIL Slice 5
 *
 * Verifies that each of the four adopted read-only tools uses `withAnvil`
 * correctly: after the first call (cache miss) a second identical call must
 * return `anvil.hit === true` without re-invoking the underlying function.
 *
 * Tests use the exported `_*AnvilCompute` helpers from server.mjs, injecting
 * mock underlying functions and a tmp directory so they never touch real
 * .forge/ state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { withAnvil } from "../anvil.mjs";
import {
  _sweepAnvilCompute,
  _analyzeAnvilCompute,
  _temperingScanAnvilCompute,
  _hotspotAnvilCompute,
} from "../server.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = resolve(tmpdir(), `anvil-adopt-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// A bound `withAnvil` variant that forces the cache to write into `cwd`.
// This lets us test hit/miss without polluting the real .forge/ directory.
function boundWithAnvil(cwd) {
  return async (fn, opts) => withAnvil(fn, opts, { cwd });
}

// ─── forge_sweep ─────────────────────────────────────────────────────────────

describe("Anvil adoption — forge_sweep", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("second identical call is a cache hit", async () => {
    const mockSweep = vi.fn().mockReturnValue({ success: true, output: "✓ clean" });

    const deps = {
      _runPforge: mockSweep,
      _withAnvil: boundWithAnvil(tmpDir),
      _codeHash: "test-v1",
      _cwd: tmpDir,
    };

    // First call — cache miss
    const r1 = await _sweepAnvilCompute({}, deps);
    expect(r1.anvil.hit).toBe(false);
    expect(mockSweep).toHaveBeenCalledTimes(1);

    // Second call — cache hit
    const r2 = await _sweepAnvilCompute({}, deps);
    expect(r2.anvil.hit).toBe(true);
    expect(typeof r2.anvil.ageMs).toBe("number");
    // Underlying function NOT called again
    expect(mockSweep).toHaveBeenCalledTimes(1);
  });

  it("different cwd produces a cache miss", async () => {
    const tmpDir2 = makeTempDir();
    try {
      const mockSweep = vi.fn()
        .mockReturnValueOnce({ success: true, output: "clean dir1" })
        .mockReturnValueOnce({ success: true, output: "clean dir2" });

      const r1 = await _sweepAnvilCompute({}, {
        _runPforge: mockSweep, _withAnvil: boundWithAnvil(tmpDir), _codeHash: "v1", _cwd: tmpDir,
      });
      const r2 = await _sweepAnvilCompute({}, {
        _runPforge: mockSweep, _withAnvil: boundWithAnvil(tmpDir2), _codeHash: "v1", _cwd: tmpDir2,
      });

      expect(r1.anvil.hit).toBe(false);
      expect(r2.anvil.hit).toBe(false);
      expect(mockSweep).toHaveBeenCalledTimes(2);
    } finally {
      cleanup(tmpDir2);
    }
  });

  it("result includes existing fields alongside anvil metadata", async () => {
    const mockSweep = vi.fn().mockReturnValue({ success: true, output: "FOUND 2 deferred-work markers" });

    const deps = {
      _runPforge: mockSweep,
      _withAnvil: boundWithAnvil(tmpDir),
      _codeHash: "v1",
      _cwd: tmpDir,
    };

    const result = await _sweepAnvilCompute({}, deps);
    expect(result.success).toBe(true);
    expect(typeof result.output).toBe("string");
    expect(result.markersFound).toBeDefined();
    expect(result.anvil).toBeDefined();
  });
});

// ─── forge_analyze ───────────────────────────────────────────────────────────

describe("Anvil adoption — forge_analyze", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("second identical call is a cache hit", async () => {
    const mockAnalyze = vi.fn().mockReturnValue({ success: true, output: "Analysis OK" });

    const deps = {
      _runPforge: mockAnalyze,
      _withAnvil: boundWithAnvil(tmpDir),
      _codeHash: "test-v1",
      _cwd: tmpDir,
    };
    const args = { plan: "docs/plans/test.md" };

    // First call — cache miss
    const r1 = await _analyzeAnvilCompute(args, deps);
    expect(r1.anvil.hit).toBe(false);
    expect(mockAnalyze).toHaveBeenCalledTimes(1);

    // Second call — cache hit
    const r2 = await _analyzeAnvilCompute(args, deps);
    expect(r2.anvil.hit).toBe(true);
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
  });

  it("different plan produces a cache miss", async () => {
    const mockAnalyze = vi.fn()
      .mockReturnValueOnce({ success: true, output: "plan A" })
      .mockReturnValueOnce({ success: true, output: "plan B" });

    const baseArgs = { _runPforge: mockAnalyze, _withAnvil: boundWithAnvil(tmpDir), _codeHash: "v1", _cwd: tmpDir };

    const r1 = await _analyzeAnvilCompute({ plan: "plan-a.md" }, baseArgs);
    const r2 = await _analyzeAnvilCompute({ plan: "plan-b.md" }, baseArgs);

    expect(r1.anvil.hit).toBe(false);
    expect(r2.anvil.hit).toBe(false);
    expect(mockAnalyze).toHaveBeenCalledTimes(2);
  });
});

// ─── forge_tempering_scan ────────────────────────────────────────────────────

describe("Anvil adoption — forge_tempering_scan", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("second identical call is a cache hit", async () => {
    const mockScan = vi.fn().mockReturnValue({
      ok: true, scanId: "s1", stack: "node", status: "ok", coverageVsMinima: [],
    });

    const deps = {
      _handleScan: mockScan,
      _withAnvil: boundWithAnvil(tmpDir),
      _codeHash: "test-v1",
      _cwd: tmpDir,
      _hub: null,
    };

    // First call — cache miss
    const r1 = await _temperingScanAnvilCompute({}, deps);
    expect(r1.anvil.hit).toBe(false);
    expect(mockScan).toHaveBeenCalledTimes(1);

    // Second call — cache hit
    const r2 = await _temperingScanAnvilCompute({}, deps);
    expect(r2.anvil.hit).toBe(true);
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it("different correlationId produces a cache miss", async () => {
    const mockScan = vi.fn()
      .mockReturnValueOnce({ ok: true, scanId: "s1", stack: "node", status: "ok", coverageVsMinima: [] })
      .mockReturnValueOnce({ ok: true, scanId: "s2", stack: "node", status: "ok", coverageVsMinima: [] });

    const baseDeps = { _handleScan: mockScan, _withAnvil: boundWithAnvil(tmpDir), _codeHash: "v1", _cwd: tmpDir, _hub: null };

    const r1 = await _temperingScanAnvilCompute({ correlationId: "corr-a" }, baseDeps);
    const r2 = await _temperingScanAnvilCompute({ correlationId: "corr-b" }, baseDeps);

    expect(r1.anvil.hit).toBe(false);
    expect(r2.anvil.hit).toBe(false);
    expect(mockScan).toHaveBeenCalledTimes(2);
  });

  it("result preserves ok field alongside anvil metadata", async () => {
    const mockScan = vi.fn().mockReturnValue({ ok: true, scanId: "s1", stack: "node", status: "ok", coverageVsMinima: [] });

    const result = await _temperingScanAnvilCompute({}, {
      _handleScan: mockScan, _withAnvil: boundWithAnvil(tmpDir), _codeHash: "v1", _cwd: tmpDir, _hub: null,
    });
    expect(result.ok).toBe(true);
    expect(result.anvil).toBeDefined();
    expect(result.anvil.key).toHaveLength(64); // sha256 hex
  });
});

// ─── forge_hotspot ───────────────────────────────────────────────────────────

describe("Anvil adoption — forge_hotspot", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTempDir(); });
  afterEach(() => cleanup(tmpDir));

  it("second identical call is a cache hit", async () => {
    const mockExec = vi.fn().mockReturnValue("src/foo.js\nsrc/bar.js\nsrc/foo.js\n");

    const deps = {
      _execSync: mockExec,
      _withAnvil: boundWithAnvil(tmpDir),
      _codeHash: "test-v1",
      _cwd: tmpDir,
    };
    const args = { top: 5, since: "3 months ago" };

    // First call — cache miss
    const r1 = await _hotspotAnvilCompute(args, deps);
    expect(r1.anvil.hit).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(1);

    // Second call — cache hit
    const r2 = await _hotspotAnvilCompute(args, deps);
    expect(r2.anvil.hit).toBe(true);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("different since produces a cache miss", async () => {
    const mockExec = vi.fn()
      .mockReturnValueOnce("src/a.js\n")
      .mockReturnValueOnce("src/b.js\n");

    const baseDeps = { _execSync: mockExec, _withAnvil: boundWithAnvil(tmpDir), _codeHash: "v1", _cwd: tmpDir };

    const r1 = await _hotspotAnvilCompute({ since: "1 month ago", top: 5 }, baseDeps);
    const r2 = await _hotspotAnvilCompute({ since: "6 months ago", top: 5 }, baseDeps);

    expect(r1.anvil.hit).toBe(false);
    expect(r2.anvil.hit).toBe(false);
    expect(mockExec).toHaveBeenCalledTimes(2);
  });

  it("result shape matches existing schema: hotspots, totalFiles, showing", async () => {
    const mockExec = vi.fn().mockReturnValue("src/foo.js\nsrc/bar.js\nsrc/foo.js\n");

    const result = await _hotspotAnvilCompute({ top: 2, since: "3 months ago" }, {
      _execSync: mockExec, _withAnvil: boundWithAnvil(tmpDir), _codeHash: "v1", _cwd: tmpDir,
    });

    expect(Array.isArray(result.hotspots)).toBe(true);
    expect(typeof result.totalFiles).toBe("number");
    expect(typeof result.showing).toBe("number");
    expect(result.showing).toBeLessThanOrEqual(2);
    expect(result.anvil).toBeDefined();
  });
});
