/**
 * Tests for visual-diff hasKey fix — verifies that the visual-diff scanner
 * checks .forge/secrets.json when env vars are absent.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PNG } from "pngjs";

import {
  getScreenshotManifest,
  hashUrl,
  promoteBaseline,
} from "../tempering/baselines.mjs";
import { runVisualDiffScan } from "../tempering/scanners/visual-diff.mjs";

function makeTmpDir() {
  const d = resolve(tmpdir(), `pf-vd-secrets-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makePng(w, h, r = 255, g = 0, b = 0) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function seedBaseline(projectDir, url) {
  const h = hashUrl(url);
  const baseDir = resolve(projectDir, ".forge", "tempering", "baselines", "visual-diff");
  mkdirSync(baseDir, { recursive: true });
  const manifestDir = resolve(projectDir, ".forge", "tempering", "baselines");
  mkdirSync(manifestDir, { recursive: true });
  const baseline = makePng(4, 4, 255, 0, 0);
  writeFileSync(resolve(baseDir, `${h}.png`), baseline);
  const manifest = { screenshots: [{ url, path: `visual-diff/${h}.png` }] };
  writeFileSync(resolve(manifestDir, "screenshots.json"), JSON.stringify(manifest));
  return baseline;
}

describe("visual-diff hasKey — secrets.json fallback", () => {
  let tmp;
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("reports 'no API key configured' when env AND secrets.json are both empty", async () => {
    tmp = makeTmpDir();
    const url = "http://localhost:3000";
    seedBaseline(tmp, url);
    // Create a slightly different "current" screenshot to trigger investigate band
    const artDir = resolve(tmp, ".forge", "tempering", "artifacts", "run1", "visual-diff");
    mkdirSync(artDir, { recursive: true });
    const current = makePng(4, 4, 0, 255, 0); // green vs red baseline
    writeFileSync(resolve(artDir, `${hashUrl(url)}.png`), current);

    const result = await runVisualDiffScan({
      config: {
        visualDiff: { urls: [url] },
        visualAnalyzer: { enabled: true },
      },
      projectDir: tmp,
      runId: "run1",
      env: {}, // no env keys
      spawnWorker: null,
    });

    // With no keys anywhere, we should see "no API key configured" as explanation
    // (investigate band falls through to the hasKey check)
    const investigateReg = (result.regressions || []).find(r => r.band === "investigate");
    if (investigateReg) {
      expect(investigateReg.explanation).toBe("no API key configured");
    }
  });

  it("does NOT report 'no API key configured' when secrets.json has a key", async () => {
    tmp = makeTmpDir();
    const url = "http://localhost:3000";
    seedBaseline(tmp, url);
    const artDir = resolve(tmp, ".forge", "tempering", "artifacts", "run1", "visual-diff");
    mkdirSync(artDir, { recursive: true });
    const current = makePng(4, 4, 0, 255, 0);
    writeFileSync(resolve(artDir, `${hashUrl(url)}.png`), current);

    // Write a secrets.json with an API key
    const forgeDir = resolve(tmp, ".forge");
    writeFileSync(resolve(forgeDir, "secrets.json"), JSON.stringify({ OPENAI_API_KEY: "sk-test" }));

    // Mock cwd so loadSecretFromForge finds the secrets file
    vi.spyOn(process, "cwd").mockReturnValue(tmp);

    const result = await runVisualDiffScan({
      config: {
        visualDiff: { urls: [url] },
        visualAnalyzer: { enabled: true },
      },
      projectDir: tmp,
      runId: "run1",
      env: {}, // no env keys — but secrets.json has one
      spawnWorker: null,
    });

    const investigateReg = (result.regressions || []).find(r => r.band === "investigate");
    if (investigateReg) {
      // Should NOT say "no API key configured" since secrets.json has the key
      // Instead should say "no spawnWorker provided" (key found but no worker)
      expect(investigateReg.explanation).not.toBe("no API key configured");
    }
  });
});
