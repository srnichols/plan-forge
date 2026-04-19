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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
        return { ...cached, current: currentVersion, isNewer: compareVersions(currentVersion, cached.latest) < 0, fromCache: true };
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
