/**
 * Plan Forge — Update Notifier (Phase UPDATE-01).
 *
 * Non-intrusive check against the GitHub Releases API for a newer Plan Forge
 * release. Runs at most once per 24h per project, honors an opt-out env var,
 * and *never* throws — network failure or API hiccup returns `null` and the
 * caller silently continues.
 *
 * Separation of concerns:
 *   - This module does HTTP + cache + semver only.
 *   - Dashboard rendering and REST exposure live in server.mjs / app.js.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RELEASES_URL = "https://api.github.com/repos/srnichols/plan-forge/releases/latest";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 4000;

export function cachePath(projectDir) {
  return resolve(projectDir, ".forge", "update-check.json");
}

/**
 * Compare two semver-like version strings. Returns:
 *   -1  if `a` < `b`
 *    0  if equal
 *    1  if `a` > `b`
 * Tolerates leading `v` and `-dev` / `-rc.*` suffixes (suffix is treated as
 * older than the bare release per semver precedence).
 */
export function compareVersions(a, b) {
  const parse = (v) => {
    const clean = String(v || "").trim().replace(/^v/i, "");
    const [core, pre] = clean.split("-", 2);
    const parts = core.split(".").map((p) => Number.parseInt(p, 10));
    while (parts.length < 3) parts.push(0);
    return { parts: parts.slice(0, 3), pre: pre || null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const da = pa.parts[i] || 0;
    const db = pb.parts[i] || 0;
    if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  // Pre-release precedence: any pre-release is lower than no pre-release
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) return pa.pre < pb.pre ? -1 : pa.pre > pb.pre ? 1 : 0;
  return 0;
}

function readCache(projectDir) {
  const path = cachePath(projectDir);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); }
  catch { return null; }
}

function writeCache(projectDir, payload) {
  const path = cachePath(projectDir);
  try {
    mkdirSync(resolve(projectDir, ".forge"), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2), "utf-8");
  } catch { /* best-effort; cache is not critical */ }
}

/**
 * Check GitHub for a newer release. Returns:
 *   {
 *     current: "2.37.0",
 *     latest:  "2.38.0",
 *     isNewer: true,
 *     url:     "https://github.com/.../releases/tag/v2.38.0",
 *     publishedAt: "2026-04-25T12:34:56Z",
 *     checkedAt:   "2026-04-19T01:00:00Z",
 *     fromCache: false,
 *   }
 *
 * Returns `null` when the check is suppressed (env var), the network is
 * unavailable, or the response is malformed. Never throws.
 *
 * @param {object} opts
 * @param {string} opts.currentVersion
 * @param {string} opts.projectDir
 * @param {boolean} [opts.force=false]   Bypass the TTL.
 * @param {number}  [opts.ttlMs]         Override cache TTL (for tests).
 * @param {typeof fetch} [opts.fetchImpl] Inject fetch (for tests).
 * @param {NodeJS.ProcessEnv} [opts.env] Inject env (for tests).
 */
export async function checkForUpdate({
  currentVersion,
  projectDir,
  force = false,
  ttlMs = DEFAULT_TTL_MS,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  if (env.PFORGE_NO_UPDATE_CHECK === "1" || env.PFORGE_NO_UPDATE_CHECK === "true") {
    return null;
  }
  if (!currentVersion || !projectDir) return null;

  // Serve from cache when fresh
  if (!force) {
    const cached = readCache(projectDir);
    if (cached && cached.checkedAt) {
      const age = Date.now() - new Date(cached.checkedAt).getTime();
      if (Number.isFinite(age) && age >= 0 && age < ttlMs) {
        // Defense-in-depth (Fix D): if VERSION was touched after the cache
        // was written, treat the cache as stale so a manual version bump or
        // tarball extraction always triggers a fresh network check.
        const versionFile = resolve(projectDir, "VERSION");
        const cacheFile = cachePath(projectDir);
        try {
          if (existsSync(versionFile) && existsSync(cacheFile)) {
            if (statSync(versionFile).mtimeMs > statSync(cacheFile).mtimeMs) {
              // VERSION is newer — fall through to network refresh.
            } else {
              return { ...cached, current: currentVersion, isNewer: compareVersions(currentVersion, cached.latest) < 0, fromCache: true };
            }
          } else {
            return { ...cached, current: currentVersion, isNewer: compareVersions(currentVersion, cached.latest) < 0, fromCache: true };
          }
        } catch {
          return { ...cached, current: currentVersion, isNewer: compareVersions(currentVersion, cached.latest) < 0, fromCache: true };
        }
      }
    }
  }

  if (typeof fetchImpl !== "function") return null;

  let json;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetchImpl(RELEASES_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "plan-forge-update-check",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res || !res.ok) return null;
    json = await res.json();
  } catch { return null; }

  const tag = typeof json?.tag_name === "string" ? json.tag_name : null;
  if (!tag) return null;
  const latest = tag.replace(/^v/i, "").trim();
  if (!/^\d+\.\d+\.\d+/.test(latest)) return null;

  const payload = {
    current: currentVersion,
    latest,
    isNewer: compareVersions(currentVersion, latest) < 0,
    url: typeof json.html_url === "string" ? json.html_url : `https://github.com/srnichols/plan-forge/releases/tag/${tag}`,
    publishedAt: typeof json.published_at === "string" ? json.published_at : null,
    checkedAt: new Date().toISOString(),
    fromCache: false,
  };
  writeCache(projectDir, payload);
  return payload;
}

/**
 * Detect a "corrupt install" — a client running from a release tarball whose
 * VERSION file ends in `-dev` despite a matching bare release existing on GitHub.
 *
 * Root cause: tags v2.50.0, v2.51.0, v2.52.0 were published with VERSION=`X.Y.Z-dev`
 * baked into the tarball. Any client who installed those releases sees `-dev`
 * locally and never heals on their own because `pforge update` skips same-hash
 * files and some paths read version from `.forge.json` templateVersion.
 *
 * Detection rule (conservative — only flags known-bad states):
 *   - current ends in `-dev`
 *   - AND a bare release with core ≥ current's core exists on GitHub
 *
 * A genuine `-dev` working branch ahead of the latest release (e.g. local
 * 2.54.0-dev while latest is 2.53.1) returns { isCorrupt: false } because its
 * core (2.54.0) is newer than latest (2.53.1).
 *
 * Returns:
 *   { isCorrupt: boolean, reason: string|null, current: string, latest: string|null, recommendedAction: string|null }
 *
 * Never throws. `latest` may be null if GitHub is unreachable — in that case
 * isCorrupt is false (err on the side of not alarming offline users).
 */
/**
 * Write a fresh cache entry after a successful self-update so the next
 * `checkForUpdate` returns `isNewer: false` without hitting the network.
 *
 * @param {string} projectDir  Project root (parent of `.forge/`).
 * @param {string} version     The version just installed.
 */
export function writeFreshCache(projectDir, version) {
  if (!projectDir || !version) return;
  const v = String(version).trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+/.test(v)) return;
  writeCache(projectDir, {
    latest: v,
    checkedAt: new Date().toISOString(),
    url: `https://github.com/srnichols/plan-forge/releases/tag/v${v}`,
    publishedAt: null,
  });
}

export function detectCorruptInstall({ currentVersion, latestVersion } = {}) {
  const result = {
    isCorrupt: false,
    reason: null,
    current: currentVersion || null,
    latest: latestVersion || null,
    recommendedAction: null,
  };
  if (!currentVersion || typeof currentVersion !== "string") return result;

  const cur = String(currentVersion).trim();
  if (!/-dev\b/i.test(cur)) return result;

  if (!latestVersion || typeof latestVersion !== "string") return result;
  const latest = String(latestVersion).trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+/.test(latest)) return result;

  // Compare bare cores: if latest >= current's core, current-dev is stale.
  const curCore = cur.replace(/^v/i, "").split("-")[0];
  if (!/^\d+\.\d+\.\d+/.test(curCore)) return result;

  // If latest bare release is newer than OR equal to current's core → corrupt.
  // (Equal means: current says "X.Y.Z-dev" and GitHub has released "X.Y.Z" — stale bytes.)
  const cmp = compareVersions(curCore, latest);
  if (cmp <= 0) {
    result.isCorrupt = true;
    result.reason = `Local VERSION '${cur}' ends in '-dev' but a matching bare release exists on GitHub (latest=v${latest}). This indicates a corrupt install from a broken release tarball (v2.50.0/v2.51.0/v2.52.0 shipped with '-dev' VERSION baked in).`;
    result.recommendedAction = `Run: pforge self-update --force`;
  }
  return result;
}
