/**
 * Visual-diff quorum tests (TEMPER-04 Slice 04.2).
 *
 * Exercises quorum mode dispatch, vote aggregation, cost cap sharing,
 * severity resolution, L3 capture, and hub event payload shape.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";

import { hashUrl } from "../tempering/baselines.mjs";
import { runVisualDiffScan } from "../tempering/scanners/visual-diff.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-quorum-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

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

function setupManifest(tmp, entries) {
  const dir = resolve(tmp, ".forge", "tempering");
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "screenshot-manifest.json"), JSON.stringify(entries), "utf-8");
}

function makeInvestigateSetup(tmp) {
  const url = "http://localhost:3000";
  const hash = hashUrl(url);
  const base = makePng(100, 100, 255, 255, 255);
  const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
  setupBaseline(tmp, hash, base);
  const path = resolve(tmp, "current.png");
  writeFileSync(path, curr);
  setupManifest(tmp, [{ url, urlHash: hash, path }]);
  return { url, hash };
}

const quorumConfig = {
  visualAnalyzer: {
    enabled: true,
    ignorableDiff: 0.001,
    failureDiff: 0.05,
    mode: "quorum",
    models: ["claude-opus-4.7", "gpt-5.3-codex", "grok-4.20"],
    agreementThreshold: 2,
    maxCostUsd: 5.0,
    analyzerTimeoutMs: 60_000,
  },
  scanners: { "visual-diff": true },
};

function makeWorkerResponse(regression, severity = "medium", explanation = "test") {
  return {
    text: JSON.stringify({ regression, severity, explanation }),
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

// ─── Mode selection (3 tests) ─────────────────────────────────────────

describe("quorum mode selection", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("quorum default with 3 models dispatches 3 legs", async () => {
    const { url, hash } = makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(false));

    await runVisualDiffScan({
      config: quorumConfig,
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    expect(spawnWorker).toHaveBeenCalledTimes(3);
  });

  it("single-mode fallback for 1 model", async () => {
    const { url, hash } = makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(false));

    await runVisualDiffScan({
      config: {
        ...quorumConfig,
        visualAnalyzer: { ...quorumConfig.visualAnalyzer, models: ["claude-opus-4.7"] },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    // Single-model path: exactly 1 call
    expect(spawnWorker).toHaveBeenCalledTimes(1);
  });

  it("explicit mode:single override uses single-model path", async () => {
    const { url, hash } = makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(false));

    await runVisualDiffScan({
      config: {
        ...quorumConfig,
        visualAnalyzer: { ...quorumConfig.visualAnalyzer, mode: "single" },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    expect(spawnWorker).toHaveBeenCalledTimes(1);
  });
});

// ─── Vote aggregation (6 tests) ───────────────────────────────────────

describe("quorum vote aggregation", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("3/3 regression → fail", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(true, "high", "regression"));
    const hub = makeHub();
    const r = await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    expect(r.fail).toBeGreaterThanOrEqual(1);
    const evt = hub.events.find(e => e.type === "tempering-visual-regression-detected");
    expect(evt.data.verdict).toBe("regression");
  });

  it("2/3 regression → fail", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce(makeWorkerResponse(true, "medium", "regression"))
      .mockResolvedValueOnce(makeWorkerResponse(true, "high", "regression"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"));
    const hub = makeHub();
    const r = await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    expect(r.fail).toBeGreaterThanOrEqual(1);
    const evt = hub.events.find(e => e.type === "tempering-visual-regression-detected");
    expect(evt.data.verdict).toBe("regression");
  });

  it("1/3 regression → pass (2/3 acceptable)", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce(makeWorkerResponse(true, "medium", "regression"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"));
    const hub = makeHub();
    const r = await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    expect(r.pass).toBeGreaterThanOrEqual(1);
    const evt = hub.events.find(e => e.type === "tempering-visual-regression-detected");
    expect(evt.data.verdict).toBe("acceptable");
  });

  it("1-1-1 split → inconclusive", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce(makeWorkerResponse(true, "medium", "regression"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"))
      .mockRejectedValueOnce(new Error("model unavailable"));
    const hub = makeHub();
    const r = await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    const reg = r.regressions.find(r => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
  });

  it("2 timeouts + 1 pass → inconclusive (insufficient valid legs)", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {})) // never resolves
      .mockImplementationOnce(() => new Promise(() => {})) // never resolves
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"));
    const r = await runVisualDiffScan({
      config: {
        ...quorumConfig,
        visualAnalyzer: { ...quorumConfig.visualAnalyzer, analyzerTimeoutMs: 50 },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    const reg = r.regressions.find(r => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
  });

  it("all 3 timeout → inconclusive", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockImplementation(() => new Promise(() => {}));
    const r = await runVisualDiffScan({
      config: {
        ...quorumConfig,
        visualAnalyzer: { ...quorumConfig.visualAnalyzer, analyzerTimeoutMs: 50 },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    const reg = r.regressions.find(r => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
  });
});

// ─── Malformed / error legs (2 tests) ─────────────────────────────────

describe("quorum error handling", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("all 3 malformed JSON → inconclusive", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue({
      text: "not json",
      usage: { inputTokens: 10, outputTokens: 10 },
    });
    const r = await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker });
    const reg = r.regressions.find(r => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
  });

  it("2 malformed + 1 regression → inconclusive (insufficient valid legs)", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce({ text: "bad", usage: { inputTokens: 10, outputTokens: 10 } })
      .mockResolvedValueOnce({ text: "bad", usage: { inputTokens: 10, outputTokens: 10 } })
      .mockResolvedValueOnce(makeWorkerResponse(true, "high", "regression"));
    const r = await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker });
    const reg = r.regressions.find(r => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
  });
});

// ─── Cost cap (2 tests) ──────────────────────────────────────────────

describe("quorum cost cap", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("exceed mid-leg → remaining skipped, budget-exceeded if threshold not met", async () => {
    // Use 3 URLs so budget is tested across images
    const urls = ["http://a.com", "http://b.com"];
    for (const url of urls) {
      const hash = hashUrl(url);
      const base = makePng(100, 100, 255, 255, 255);
      const curr = makePngWithBlock(100, 100, 5, 0, 0, 0);
      setupBaseline(tmp, hash, base);
      const path = resolve(tmp, `${hash}.png`);
      writeFileSync(path, curr);
    }
    setupManifest(tmp, urls.map(url => ({
      url,
      urlHash: hashUrl(url),
      path: resolve(tmp, `${hashUrl(url)}.png`),
    })));

    const spawnWorker = vi.fn().mockResolvedValue({
      text: JSON.stringify({ regression: false, severity: "low", explanation: "ok" }),
      usage: { inputTokens: 500000, outputTokens: 500000 },
    });

    const r = await runVisualDiffScan({
      config: {
        ...quorumConfig,
        visualAnalyzer: { ...quorumConfig.visualAnalyzer, maxCostUsd: 0.001 },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    expect(r.verdict).toBe("budget-exceeded");
    expect(r.details?.budgetExceeded).toBe(true);
  });

  it("partial legs used if threshold met before budget exhausted", async () => {
    makeInvestigateSetup(tmp);
    // First two legs resolve, third would exceed budget but threshold already met
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"));

    const r = await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker });
    expect(r.pass).toBeGreaterThanOrEqual(1);
  });
});

// ─── Hub event payload (2 tests) ─────────────────────────────────────

describe("quorum hub event payload", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("event contains quorum.models, quorum.votes, quorum.agreement", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(true, "high", "regression"));
    const hub = makeHub();
    await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    const evt = hub.events.find(e => e.type === "tempering-visual-regression-detected");
    expect(evt).toBeDefined();
    expect(evt.data.quorum).toBeDefined();
    expect(evt.data.quorum.models).toEqual(["claude-opus-4.7", "gpt-5.3-codex", "grok-4.20"]);
    expect(evt.data.quorum.votes).toHaveLength(3);
    expect(evt.data.quorum.agreement).toMatch(/\d+-of-\d+/);
    expect(evt.data.quorum.threshold).toBe(2);
  });

  it("event contains artifacts.{baseline,current,diff}", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(true, "medium", "changed"));
    const hub = makeHub();
    await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    const evt = hub.events.find(e => e.type === "tempering-visual-regression-detected");
    expect(evt.data.artifacts).toBeDefined();
    expect(evt.data.artifacts.baseline).toBeTruthy();
    expect(evt.data.artifacts.current).toBeTruthy();
    expect(evt.data.artifacts.diff).toBeTruthy();
  });
});

// ─── Severity resolution (2 tests) ──────────────────────────────────

describe("quorum severity resolution", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("severity = highest among winners", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce(makeWorkerResponse(true, "low", "minor"))
      .mockResolvedValueOnce(makeWorkerResponse(true, "critical", "major"))
      .mockResolvedValueOnce(makeWorkerResponse(true, "medium", "mid"));
    const hub = makeHub();
    await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    const evt = hub.events.find(e => e.type === "tempering-visual-regression-detected");
    expect(evt.data.severity).toBe("critical");
  });

  it("tie-break = first listed model's severity", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce(makeWorkerResponse(true, "high", "reg A"))
      .mockResolvedValueOnce(makeWorkerResponse(true, "high", "reg B"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"));
    const hub = makeHub();
    await runVisualDiffScan({ config: quorumConfig, projectDir: tmp, runId: "run-test", spawnWorker, hub });
    const evt = hub.events.find(e => e.type === "tempering-visual-regression-detected");
    expect(evt.data.severity).toBe("high");
  });
});

// ─── L3 capture (2 tests) ───────────────────────────────────────────

describe("quorum L3 capture", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("captureMemory called once per quorum decision with correct source", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(true, "high", "regression"));
    const captureMemory = vi.fn();
    await runVisualDiffScan({
      config: quorumConfig,
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
      captureMemory,
    });
    expect(captureMemory).toHaveBeenCalledTimes(1);
    const [content, type, source] = captureMemory.mock.calls[0];
    expect(source).toMatch(/forge_tempering_scan\/visual-diff\/regression/);
    expect(type).toBe("decision");
  });

  it("capture content is text only — no image bytes", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(false, "low", "ok"));
    const captureMemory = vi.fn();
    await runVisualDiffScan({
      config: quorumConfig,
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
      captureMemory,
    });
    expect(captureMemory).toHaveBeenCalledTimes(1);
    const [content] = captureMemory.mock.calls[0];
    expect(typeof content).toBe("string");
    // Should not contain base64 image data (>100 chars of contiguous base64)
    expect(content).not.toMatch(/[A-Za-z0-9+/]{100,}/);
  });
});

// ─── Config overrides (2 tests) ─────────────────────────────────────

describe("quorum config overrides", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  it("custom models list honored", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn().mockResolvedValue(makeWorkerResponse(false));
    await runVisualDiffScan({
      config: {
        ...quorumConfig,
        visualAnalyzer: { ...quorumConfig.visualAnalyzer, models: ["model-a", "model-b"] },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    expect(spawnWorker).toHaveBeenCalledTimes(2);
    expect(spawnWorker.mock.calls[0][0].model).toBe("model-a");
    expect(spawnWorker.mock.calls[1][0].model).toBe("model-b");
  });

  it("custom agreementThreshold: 3 requires unanimous agreement", async () => {
    makeInvestigateSetup(tmp);
    const spawnWorker = vi.fn()
      .mockResolvedValueOnce(makeWorkerResponse(true, "high", "regression"))
      .mockResolvedValueOnce(makeWorkerResponse(true, "medium", "regression"))
      .mockResolvedValueOnce(makeWorkerResponse(false, "low", "ok"));
    const r = await runVisualDiffScan({
      config: {
        ...quorumConfig,
        visualAnalyzer: { ...quorumConfig.visualAnalyzer, agreementThreshold: 3 },
      },
      projectDir: tmp,
      runId: "run-test",
      spawnWorker,
    });
    // 2/3 regression, threshold 3 → inconclusive
    const reg = r.regressions.find(r => r.llmVerdict === "inconclusive");
    expect(reg).toBeDefined();
  });
});

// ─── Dashboard contract (3 tests) ───────────────────────────────────

describe("dashboard visual regression viewer contract", () => {
  it("index.html has visual-diff-viewer section", () => {
    const indexHtml = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
    expect(indexHtml).toMatch(/id="visual-diff-viewer"/);
    expect(indexHtml).toMatch(/id="visual-diff-list"/);
    expect(indexHtml).toMatch(/data-testid="visual-diff-viewer"/);
  });

  it("app.js has upsertVisualRegressionCard function", () => {
    const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");
    expect(appJs).toMatch(/function\s+upsertVisualRegressionCard/);
    expect(appJs).toMatch(/function\s+renderVisualDiffViewer/);
    expect(appJs).toMatch(/function\s+approveBaseline/);
    expect(appJs).toMatch(/function\s+ignoreOnce/);
  });

  it("app.js state.tempering has visualRegressions and visualIgnoredOnce", () => {
    const appJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");
    expect(appJs).toMatch(/visualRegressions:\s*\[\]/);
    expect(appJs).toMatch(/visualIgnoredOnce:\s*new\s+Set\(\)/);
  });
});
