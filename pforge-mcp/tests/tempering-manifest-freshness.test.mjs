/**
 * Manifest freshness tests (Phase-28.5 Slice 3).
 *
 * Verifies that visual-diff prefers current-run artifacts over stale
 * manifest paths, using mtime as the deciding signal when both exist.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";

import { hashUrl, getScreenshotManifest } from "../tempering/baselines.mjs";
import { runVisualDiffScan } from "../tempering/scanners/visual-diff.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-manifest-fresh-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makePng(width, height, r = 255, g = 0, b = 0) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
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

/** Set file mtime to a specific time. */
function setMtime(filePath, date) {
  utimesSync(filePath, date, date);
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("visual-diff manifest freshness", () => {
  let tmp;
  beforeEach(() => { tmp = makeTmpDir(); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  const URL = "http://localhost:3000/dashboard";
  const RUN_ID = "run-tuesday";

  it("prefers current-run artifact over stale manifest entry", async () => {
    const urlHash = hashUrl(URL);
    const oldPng = makePng(10, 10, 255, 0, 0);   // red — old/stale
    const newPng = makePng(10, 10, 255, 0, 0);   // same color (identical) — new

    // Baseline so diff can proceed
    setupBaseline(tmp, urlHash, oldPng);

    // Manifest entry pointing to a file with an old mtime
    const staleDir = resolve(tmp, "stale-screenshots");
    mkdirSync(staleDir, { recursive: true });
    const stalePath = resolve(staleDir, `${urlHash}.png`);
    writeFileSync(stalePath, oldPng);
    setMtime(stalePath, new Date("2024-01-01T00:00:00Z"));

    setupManifest(tmp, [{ url: URL, urlHash, path: stalePath }]);

    // Current-run artifact with a newer mtime
    setupScreenshot(tmp, RUN_ID, urlHash, newPng);
    const currentRunPath = resolve(
      tmp, ".forge", "tempering", "artifacts", RUN_ID, "ui-playwright", `${urlHash}.png`,
    );
    setMtime(currentRunPath, new Date("2025-06-15T00:00:00Z"));

    const result = await runVisualDiffScan({
      config: { visualAnalyzer: { enabled: true } },
      projectDir: tmp,
      runId: RUN_ID,
    });

    // Should not skip — the current-run artifact was found
    expect(result.verdict).not.toBe("skipped");
    const skipEntry = (result.regressions || []).find(
      (r) => r.urlHash === urlHash && r.reason === "no-current-screenshot",
    );
    expect(skipEntry).toBeUndefined();
  });

  it("uses current-run artifact when manifest path is missing", async () => {
    const urlHash = hashUrl(URL);
    const png = makePng(10, 10, 0, 255, 0);

    setupBaseline(tmp, urlHash, png);

    // Manifest points to a path that doesn't exist
    setupManifest(tmp, [{
      url: URL,
      urlHash,
      path: resolve(tmp, "nonexistent", `${urlHash}.png`),
    }]);

    // But current-run artifact does exist
    setupScreenshot(tmp, RUN_ID, urlHash, png);

    const result = await runVisualDiffScan({
      config: { visualAnalyzer: { enabled: true } },
      projectDir: tmp,
      runId: RUN_ID,
    });

    expect(result.verdict).not.toBe("skipped");
    const skipEntry = (result.regressions || []).find(
      (r) => r.urlHash === urlHash && r.reason === "no-current-screenshot",
    );
    expect(skipEntry).toBeUndefined();
  });

  it("skips when both manifest path and current-run artifact are missing", async () => {
    const urlHash = hashUrl(URL);
    const png = makePng(10, 10);

    setupBaseline(tmp, urlHash, png);

    // Manifest points to nonexistent file, no current-run artifact either
    setupManifest(tmp, [{
      url: URL,
      urlHash,
      path: resolve(tmp, "gone", `${urlHash}.png`),
    }]);

    const result = await runVisualDiffScan({
      config: { visualAnalyzer: { enabled: true } },
      projectDir: tmp,
      runId: RUN_ID,
    });

    const skipEntry = (result.regressions || []).find(
      (r) => r.urlHash === urlHash && r.reason === "no-current-screenshot",
    );
    expect(skipEntry).toBeDefined();
  });
});
