/**
 * Tempering baselines — storage, promotion, diff helpers (TEMPER-04 Slice 04.1).
 *
 * Baselines are the "expected" screenshots that the visual-diff scanner
 * compares against. They live under `.forge/tempering/baselines/` with
 * one PNG per URL hash and a JSON sidecar recording promotion metadata.
 *
 * @module tempering/baselines
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { resolve, relative, normalize } from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { hashUrl } from "./artifacts.mjs";

// Re-export for convenience — scanners import from baselines.mjs
export { hashUrl };

// ─── Directories ──────────────────────────────────────────────────────

function baselinesDir(cwd) {
  return resolve(cwd, ".forge", "tempering", "baselines");
}

function artifactsDir(cwd) {
  return resolve(cwd, ".forge", "tempering", "artifacts");
}

// ─── Path safety ──────────────────────────────────────────────────────

function assertSafePath(target, root) {
  const norm = normalize(resolve(target));
  const normRoot = normalize(resolve(root));
  if (!norm.startsWith(normRoot)) {
    throw new Error(`Path traversal rejected: ${target}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * List all baselines currently stored.
 * @param {string} cwd — project root
 * @returns {Array<{urlHash: string, path: string, updatedAt: string|null}>}
 */
export function listBaselines(cwd) {
  const dir = baselinesDir(cwd);
  if (!existsSync(dir)) return [];
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".png")) continue;
      const urlHash = entry.replace(/\.png$/, "");
      const fullPath = resolve(dir, entry);
      let updatedAt = null;
      try { updatedAt = statSync(fullPath).mtime.toISOString(); } catch { /* best-effort */ }
      results.push({ urlHash, path: fullPath, updatedAt });
    }
  } catch { /* dir unreadable */ }
  return results;
}

/**
 * Read a baseline PNG buffer by URL hash.
 * @param {string} urlHash
 * @param {string} cwd
 * @returns {Buffer|null}
 */
export function getBaseline(urlHash, cwd) {
  const dir = baselinesDir(cwd);
  const target = resolve(dir, `${urlHash}.png`);
  assertSafePath(target, dir);
  if (!existsSync(target)) return null;
  return readFileSync(target);
}

/**
 * Read the TEMPER-03 screenshot manifest.
 * @param {string} cwd
 * @returns {Array<{url: string, urlHash: string, path: string}>|null}
 */
export function getScreenshotManifest(cwd) {
  const candidates = [
    resolve(cwd, ".forge", "tempering", "screenshot-manifest.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      if (!Array.isArray(raw)) continue;
      return raw.map((entry) => ({
        url: entry.url,
        urlHash: entry.urlHash || hashUrl(entry.url),
        path: entry.path || entry.screenshotPath || null,
      }));
    } catch { continue; }
  }
  return null;
}

/**
 * Promote the current screenshot for a URL to the baselines directory.
 * Idempotent — re-promoting the same content overwrites + updates sidecar.
 *
 * @param {object} opts
 * @param {string} [opts.urlHash]
 * @param {string} [opts.url]
 * @param {string} [opts.runId]
 * @param {string} [opts.screenshotPath] — explicit path to promote
 * @param {string} cwd
 * @returns {{ok: boolean, urlHash: string, baselinePath: string, sidecarPath: string, previousHash?: string}}
 */
export function promoteBaseline(opts, cwd) {
  const { url, runId, screenshotPath } = opts || {};
  const urlHash = opts?.urlHash || (url ? hashUrl(url) : null);
  if (!urlHash) throw new Error("INVALID_URL_HASH: urlHash or url required");

  const dir = baselinesDir(cwd);
  assertSafePath(resolve(dir, `${urlHash}.png`), dir);

  // Find the screenshot to promote
  let srcPath = screenshotPath;
  if (!srcPath) {
    const artRoot = artifactsDir(cwd);
    if (existsSync(artRoot)) {
      const runs = readdirSync(artRoot)
        .filter((d) => { try { return statSync(resolve(artRoot, d)).isDirectory(); } catch { return false; } })
        .sort()
        .reverse();
      for (const run of runs) {
        if (runId && run !== runId) continue;
        for (const scanner of ["ui-playwright", "visual-diff"]) {
          const candidate = resolve(artRoot, run, scanner, `${urlHash}.png`);
          if (existsSync(candidate)) { srcPath = candidate; break; }
        }
        if (srcPath) break;
      }
    }
  }

  if (!srcPath || !existsSync(srcPath)) {
    throw new Error(`NO_SCREENSHOT: No screenshot found for hash ${urlHash}`);
  }

  // Read previous hash for sidecar
  const baselinePath = resolve(dir, `${urlHash}.png`);
  let previousHash = null;
  if (existsSync(baselinePath)) {
    try {
      previousHash = createHash("sha256").update(readFileSync(baselinePath)).digest("hex").slice(0, 16);
    } catch { /* no previous */ }
  }

  // Write baseline
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  copyFileSync(srcPath, baselinePath);

  // Write sidecar
  const sidecarPath = resolve(dir, `${urlHash}.json`);
  const sidecar = {
    urlHash,
    url: url || null,
    promotedAt: new Date().toISOString(),
    promotedBy: "forge_tempering_approve_baseline",
    previousHash,
    runId: runId || null,
    sourcePath: srcPath,
  };
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n", "utf-8");

  return { ok: true, urlHash, baselinePath, sidecarPath, previousHash };
}

/**
 * Pixel-diff two PNG buffers using pixelmatch + pngjs.
 *
 * @param {Buffer} baselineBuf
 * @param {Buffer} currentBuf
 * @param {object} [opts]
 * @param {number} [opts.threshold=0.1] — pixelmatch color distance threshold
 * @returns {{diffPercent: number, diffPixels: number, totalPixels: number, diffBuffer: Buffer, width: number, height: number}}
 */
export function diffImages(baselineBuf, currentBuf, opts = {}) {
  const baseline = PNG.sync.read(baselineBuf);
  const current = PNG.sync.read(currentBuf);

  // Normalize dimensions — resize current to baseline if mismatch
  let currentData = current.data;
  let width = baseline.width;
  let height = baseline.height;

  if (current.width !== baseline.width || current.height !== baseline.height) {
    const resized = new PNG({ width, height });
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (x < current.width && y < current.height) {
          const srcIdx = (y * current.width + x) * 4;
          resized.data[idx] = current.data[srcIdx];
          resized.data[idx + 1] = current.data[srcIdx + 1];
          resized.data[idx + 2] = current.data[srcIdx + 2];
          resized.data[idx + 3] = current.data[srcIdx + 3];
        } else {
          resized.data[idx] = 255;
          resized.data[idx + 1] = 255;
          resized.data[idx + 2] = 255;
          resized.data[idx + 3] = 255;
        }
      }
    }
    currentData = resized.data;
  }

  const diff = new PNG({ width, height });
  const totalPixels = width * height;
  const diffPixels = pixelmatch(
    baseline.data,
    currentData,
    diff.data,
    width,
    height,
    { threshold: opts.threshold ?? 0.1 },
  );

  const diffPercent = totalPixels > 0 ? diffPixels / totalPixels : 0;
  const diffBuffer = PNG.sync.write(diff);

  return { diffPercent, diffPixels, totalPixels, diffBuffer, width, height };
}
