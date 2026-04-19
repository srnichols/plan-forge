/**
 * Visual-diff scanner tests (TEMPER-04 Slice 04.1).
 *
 * Exercises baselines.mjs (storage, promotion, diffImages) and the
 * visual-diff scanner (3-band classification, LLM analyzer mocking,
 * cost cap, hub events). Fixtures generated programmatically via pngjs.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";

import {
  listBaselines,
  getBaseline,
  getScreenshotManifest,
  promoteBaseline,
  diffImages,
  hashUrl,
} from "../tempering/baselines.mjs";
import { runVisualDiffScan } from "../tempering/scanners/visual-diff.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-visual-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Create a solid-color PNG buffer. */
function makePng(width, height, r = 255, g = 0, b = 0, a = 255) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

/** Create a PNG with a block of different color at top-left corner. */
function makePngWithBlock(width, height, blockSize, blockR = 0, blockG = 0, blockB = 255) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x < blockSize && y < blockSize) {
        png.data[idx] = blockR;
        png.data[idx + 1] = blockG;
        png.data[idx + 2] = blockB;
      } else {
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
      }
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function makeHub() {
  const events = [];
  return {
    broadcast(evt) { events.push(evt); },
    events,
  };
}

function setupBaseline(tmp, urlHash, pngBuf) {
  const dir = resolve(tmp, ".forge", "tempering", "baselines");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${urlHash}.png`), pngBuf);
}

function setupScreenshot(tmp, runId, urlHash, pngBuf) {
  const dir = resolve(tmp, ".forge", "tempering", "artifacts", runId, "ui-playwright");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${urlHash}.png`), pngBuf);
}

function setupManifest(tmp, entries) {
  const dir = resolve(tmp, ".forge", "tempering");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "screenshot-manifest.json"), JSON.stringify(entries), "utf-8");
}

// ─── baselines.mjs (8 tests) ─────────────────────────────────────────

describe("baselines.mjs", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("listBaselines returns empty when no baselines dir", () => {
    expect(listBaselines(tmp)).toEqual([]);
  });

  it("listBaselines returns baselines with metadata", () => {
    const hash = hashUrl("http://localhost:3000");
    const png = makePng(10, 10);
    setupBaseline(tmp, hash, png);
    const list = listBaselines(tmp);
    expect(list).toHaveLength(1);
    expect(list[0].urlHash).toBe(hash);
    expect(list[0].updatedAt).toBeTruthy();
  });

  it("getBaseline returns buffer for existing baseline", () => {
    const hash = hashUrl("http://localhost:3000/page");
    const png = makePng(10, 10, 0, 255, 0);
    setupBaseline(tmp, hash, png);
    const buf = getBaseline(hash, tmp);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("getBaseline returns null for missing baseline", () => {
    expect(getBaseline("nonexistent", tmp)).toBeNull();
  });

  it("promoteBaseline promotes screenshot to baselines dir", () => {
    const hash = hashUrl("http://localhost:3000");
    const png = makePng(10, 10);
    setupScreenshot(tmp, "run-test-1", hash, png);

    const result = promoteBaseline({ urlHash: hash, url: "http://localhost:3000", runId: "run-test-1" }, tmp);
    expect(result.ok).toBe(true);
    expect(result.urlHash).toBe(hash);
    expect(existsSync(result.baselinePath)).toBe(true);
    expect(existsSync(result.sidecarPath)).toBe(true);

    const sidecar = JSON.parse(readFileSync(result.sidecarPath, "utf-8"));
    expect(sidecar.promotedBy).toBe("forge_tempering_approve_baseline");
  });

  it("promoteBaseline is idempotent (re-promote overwrites)", () => {
    const hash = hashUrl("http://localhost:3000");
    const png1 = makePng(10, 10, 255, 0, 0);
    const png2 = makePng(10, 10, 0, 255, 0);
    setupScreenshot(tmp, "run-1", hash, png1);
    promoteBaseline({ urlHash: hash, runId: "run-1" }, tmp);

    // Setup new screenshot and re-promote
    setupScreenshot(tmp, "run-2", hash, png2);
    const result = promoteBaseline({ urlHash: hash, runId: "run-2" }, tmp);
    expect(result.ok).toBe(true);
    expect(result.previousHash).toBeTruthy();
  });

  it("promoteBaseline rejects missing urlHash", () => {
    expect(() => promoteBaseline({}, tmp)).toThrow("INVALID_URL_HASH");
  });

  it("diffImages returns 0% for identical images", () => {
    const png = makePng(20, 20, 128, 128, 128);
    const result = diffImages(png, png);
    expect(result.diffPercent).toBe(0);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(400);
    expect(Buffer.isBuffer(result.diffBuffer)).toBe(true);
  });

  it("diffImages returns >0% for different images", () => {
    const white = makePng(20, 20, 255, 255, 255);
    const black = makePng(20, 20, 0, 0, 0);
    const result = diffImages(white, black);
    expect(result.diffPercent).toBeGreaterThan(0);
    expect(result.diffPixels).toBeGreaterThan(0);
  });

  it("diffImages handles dimension mismatch", () => {
    const base = makePng(20, 20, 255, 255, 255);
    const curr = makePng(30, 30, 255, 255, 255);
    // Should not throw — resizes current to baseline dimensions
    const result = diffImages(base, curr);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });
});

// ─── Scanner logic (12 tests) ─────────────────────────────────────────

describe("visual-diff scanner", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  const baseConfig = {
    visualAnalyzer: { enabled: true, ignorableDiff: 0.001, failureDiff: 0.02, mode: "single", models: ["claude-opus-4.7"] },
    scanners: { "visual-diff": true },
  };

  it("no manifest → skipped", async () => {
    const r = await runVisualDiffScan({
      config: baseConfig,
      projectDir: tmp,
      runId: "run-test",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("no-screenshot-manifest");
  });

  it("no baseline → page skipped with needs-baseline", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), makePng(10, 10));

    const r = await runVisualDiffScan({
      config: baseConfig,
      projectDir: tmp,
      runId: "run-test",
    });
    expect(r.verdict).toBe("pass");
    expect(r.regressions[0].reason).toBe("needs-baseline");
  });

  it("0% diff → pass", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const png = makePng(20, 20, 128, 128, 128);
    setupBaseline(tmp, hash, png);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), png);

    const r = await runVisualDiffScan({
      config: baseConfig,
      projectDir: tmp,
      runId: "run-test",
    });
    expect(r.verdict).toBe("pass");
    expect(r.pass).toBe(1);
    expect(r.fail).toBe(0);
  });

  it("large diff (>2%) → fail without LLM", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const white = makePng(20, 20, 255, 255, 255);
    const black = makePng(20, 20, 0, 0, 0);
    setupBaseline(tmp, hash, white);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), black);

    const hub = makeHub();
    const r = await runVisualDiffScan({
      config: baseConfig,
      projectDir: tmp,
      runId: "run-test",
      hub,
    });
    expect(r.verdict).toBe("fail");
    expect(r.fail).toBeGreaterThanOrEqual(1);
    const regression = hub.events.find((e) => e.type === "tempering-visual-regression-detected");
    expect(regression).toBeDefined();
    expect(regression.data.band).toBe("fail");
  });

  it("investigate band + LLM confirms regression → fail", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    // Create images with small (but >0.1%) diff
    const base = makePng(100, 100, 255, 255, 255);
    const curr = makePngWithBlock(100, 100, 5, 0, 0, 0); // 25px block on 10000px = 0.25%
    setupBaseline(tmp, hash, base);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), curr);

    const spawnWorker = vi.fn().mockResolvedValue({
      text: JSON.stringify({ regression: true, severity: "medium", explanation: "button moved" }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const hub = makeHub();
    const r = await runVisualDiffScan({
      config: { ...baseConfig, visualAnalyzer: { ...baseConfig.visualAnalyzer, ignorableDiff: 0.001, failureDiff: 0.05 } },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
      hub,
    });
    expect(r.fail).toBeGreaterThanOrEqual(1);
    expect(spawnWorker).toHaveBeenCalled();
  });

  it("investigate band + LLM says acceptable → pass", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const base = makePng(100, 100, 255, 255, 255);
    const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
    setupBaseline(tmp, hash, base);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), curr);

    const spawnWorker = vi.fn().mockResolvedValue({
      text: JSON.stringify({ regression: false, severity: "low", explanation: "anti-aliasing change" }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const r = await runVisualDiffScan({
      config: { ...baseConfig, visualAnalyzer: { ...baseConfig.visualAnalyzer, ignorableDiff: 0.001, failureDiff: 0.05 } },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    expect(r.pass).toBeGreaterThanOrEqual(1);
  });

  it("malformed LLM JSON → inconclusive", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const base = makePng(100, 100, 255, 255, 255);
    const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
    setupBaseline(tmp, hash, base);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), curr);

    const spawnWorker = vi.fn().mockResolvedValue({
      text: "not json at all",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const r = await runVisualDiffScan({
      config: { ...baseConfig, visualAnalyzer: { ...baseConfig.visualAnalyzer, ignorableDiff: 0.001, failureDiff: 0.05 } },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    const reg = r.regressions.find((r) => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
  });

  it("LLM timeout → inconclusive", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const base = makePng(100, 100, 255, 255, 255);
    const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
    setupBaseline(tmp, hash, base);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), curr);

    const spawnWorker = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves

    const r = await runVisualDiffScan({
      config: {
        ...baseConfig,
        visualAnalyzer: { ...baseConfig.visualAnalyzer, ignorableDiff: 0.001, failureDiff: 0.05, analyzerTimeoutMs: 50 },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    const reg = r.regressions.find((r) => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
    expect(reg.explanation).toMatch(/timeout/i);
  });

  it("missing API key → inconclusive with reason", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const base = makePng(100, 100, 255, 255, 255);
    const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
    setupBaseline(tmp, hash, base);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), curr);

    const r = await runVisualDiffScan({
      config: { ...baseConfig, visualAnalyzer: { ...baseConfig.visualAnalyzer, ignorableDiff: 0.001, failureDiff: 0.05 } },
      projectDir: tmp,
      runId: "run-test",
      // No spawnWorker, no API keys
      env: {},
    });
    const reg = r.regressions.find((r) => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
    expect(reg.explanation).toMatch(/API key|spawnWorker/i);
  });

  it("cost cap → budget-exceeded with partial results", async () => {
    const urls = ["http://a.com", "http://b.com", "http://c.com"];
    const entries = [];
    for (const url of urls) {
      const hash = hashUrl(url);
      const base = makePng(100, 100, 255, 255, 255);
      const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
      setupBaseline(tmp, hash, base);
      const path = resolve(tmp, `${hash}.png`);
      writeFileSync(path, curr);
      entries.push({ url, urlHash: hash, path });
    }
    setupManifest(tmp, entries);

    let callCount = 0;
    const spawnWorker = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        text: JSON.stringify({ regression: false, severity: "low", explanation: "ok" }),
        usage: { inputTokens: 500000, outputTokens: 500000 }, // Huge token count to bust budget
      };
    });

    const r = await runVisualDiffScan({
      config: {
        ...baseConfig,
        visualAnalyzer: { ...baseConfig.visualAnalyzer, ignorableDiff: 0.001, failureDiff: 0.05, maxCostUsd: 0.01 },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    expect(r.verdict).toBe("budget-exceeded");
    expect(r.details?.budgetExceeded).toBe(true);
  });

  it("config threshold override respected", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const base = makePng(100, 100, 255, 255, 255);
    const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
    setupBaseline(tmp, hash, base);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), curr);

    // Set failureDiff very low so ~0.25% diff triggers auto-fail (band 3)
    const r = await runVisualDiffScan({
      config: {
        ...baseConfig,
        visualAnalyzer: { ...baseConfig.visualAnalyzer, ignorableDiff: 0.0001, failureDiff: 0.001 },
      },
      projectDir: tmp,
      runId: "run-test",
    });
    expect(r.fail).toBeGreaterThanOrEqual(1);
    expect(r.verdict).toBe("fail");
  });

  it("hub event emitted on regression with correct payload", async () => {
    const url = "http://localhost:3000";
    const hash = hashUrl(url);
    const white = makePng(20, 20, 255, 255, 255);
    const black = makePng(20, 20, 0, 0, 0);
    setupBaseline(tmp, hash, white);
    setupManifest(tmp, [{ url, urlHash: hash, path: resolve(tmp, "current.png") }]);
    writeFileSync(resolve(tmp, "current.png"), black);

    const hub = makeHub();
    await runVisualDiffScan({
      config: baseConfig,
      projectDir: tmp,
      runId: "run-test",
      hub,
    });
    const evt = hub.events.find((e) => e.type === "tempering-visual-regression-detected");
    expect(evt).toBeDefined();
    expect(evt.data.url).toBe(url);
    expect(evt.data.urlHash).toBe(hash);
    expect(typeof evt.data.diffPercent).toBe("number");
  });

  it("scanner disabled → skipped", async () => {
    setupManifest(tmp, [{ url: "http://a.com", urlHash: "abc" }]);
    const r = await runVisualDiffScan({
      config: { visualAnalyzer: { enabled: false } },
      projectDir: tmp,
      runId: "run-test",
    });
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("scanner-disabled");
  });
});

// ─── Approve-baseline tool (5 tests) ─────────────────────────────────

describe("approve-baseline tool", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("success — promotes screenshot to baselines", () => {
    const hash = hashUrl("http://localhost:3000");
    setupScreenshot(tmp, "run-1", hash, makePng(10, 10));
    const r = promoteBaseline({ urlHash: hash, url: "http://localhost:3000", runId: "run-1" }, tmp);
    expect(r.ok).toBe(true);
    expect(existsSync(r.baselinePath)).toBe(true);
  });

  it("unknown hash → error", () => {
    expect(() => promoteBaseline({ urlHash: "doesnotexist" }, tmp)).toThrow("NO_SCREENSHOT");
  });

  it("idempotent re-promote", () => {
    const hash = hashUrl("http://localhost:3000");
    setupScreenshot(tmp, "run-1", hash, makePng(10, 10));
    promoteBaseline({ urlHash: hash, runId: "run-1" }, tmp);
    const r2 = promoteBaseline({ urlHash: hash, runId: "run-1" }, tmp);
    expect(r2.ok).toBe(true);
    expect(r2.previousHash).toBeTruthy();
  });

  it("path validation rejects traversal", () => {
    expect(() => getBaseline("../../etc/passwd", tmp)).toThrow(/traversal/i);
  });

  it("tempering-baseline-promoted event shape (tested via dashboard case)", () => {
    // The dashboard case handler is a string match test — here we just
    // verify the promoteBaseline return shape has the fields the event needs.
    const hash = hashUrl("http://localhost:3000");
    setupScreenshot(tmp, "run-1", hash, makePng(10, 10));
    const r = promoteBaseline({ urlHash: hash, url: "http://localhost:3000", runId: "run-1" }, tmp);
    expect(r).toHaveProperty("urlHash");
    expect(r).toHaveProperty("baselinePath");
    expect(r).toHaveProperty("sidecarPath");
  });
});

// ─── Runner integration (5 tests) ─────────────────────────────────────

describe("runner integration — visual-diff", () => {
  it("app.js handles tempering-visual-regression-detected event", () => {
    const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");
    expect(appJs).toContain("tempering-visual-regression-detected");
    expect(appJs).toContain("handleTemperingVisualRegression");
  });

  it("app.js handles tempering-baseline-promoted event", () => {
    const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");
    expect(appJs).toContain("tempering-baseline-promoted");
    expect(appJs).toContain("Baseline promoted");
  });

  it("server.mjs registers forge_tempering_approve_baseline tool", () => {
    const serverMjs = readFileSync(resolve(__dirname, "..", "server.mjs"), "utf-8");
    expect(serverMjs).toContain("forge_tempering_approve_baseline");
  });

  it("capabilities.mjs has TOOL_METADATA for forge_tempering_approve_baseline", () => {
    const capMjs = readFileSync(resolve(__dirname, "..", "capabilities.mjs"), "utf-8");
    expect(capMjs).toContain("forge_tempering_approve_baseline");
    expect(capMjs).toContain("addedIn: \"2.45.0\"");
  });

  it("runner.mjs includes visual-diff scanner phase", () => {
    const runnerMjs = readFileSync(resolve(__dirname, "..", "tempering", "runner.mjs"), "utf-8");
    expect(runnerMjs).toContain("visual-diff");
    expect(runnerMjs).toContain("visualDiffScannerImpl");
  });
});
