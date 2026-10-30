/**
 * Plan Forge — Update Notifier (Phase UPDATE-01).
 *
 * Non-intrusive check against the GitHub Releases API for a newer Plan Forge
 * release. Runs at most once per 24h per project, honors an opt-out env var,
 * and *never* throws — network failure or API hiccup returns `null` from
 * `checkForUpdate` and the caller silently continues. `checkForUpdateWithReason`
 * is the same check with the answer to "why not" (#446), and a forced check
 * that GitHub does not answer falls back to a fresh cache entry.
 *
 * Separation of concerns:
 *   - This module does cache + semver + what an answer means.
 *   - How a GitHub request is authenticated, and how a rate limit reads and
 *     is worded, live in github-request.mjs, shared with update-from-github.mjs.
 *   - Dashboard rendering and REST exposure live in server.mjs / app.js.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describeRateLimit, fetchGitHub, readRateLimit } from "./github-request.mjs";

const RELEASES_URL = "https://api.github.com/repos/srnichols/plan-forge/releases/latest";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 4000;
const USER_AGENT = "plan-forge-update-check";
const MAX_ERROR_DETAIL_CHARS = 120;
// "YYYY-MM-DDTHH:MM" is the first 16 characters of an ISO 8601 timestamp.
const ISO_MINUTE_END = 16;
// What writeFreshCache puts in `source`: the entry is the version `pforge update` just installed, not a GitHub answer.
const INSTALL_SOURCE = "install";

export function cachePath(projectDir) {
  return resolve(projectDir, ".forge", "update-check.json");
}

/**
 * Read a JSON file, returning null on absence or malformed content.
 *
 * @param {string} path
 * @returns {object|null}
 */
function _readJsonOrNull(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Resolve the framework's own version — the version of the running install.
 *
 * Resolution order (first match wins):
 *   1. `<serverDir>/package.json` version — the install's own manifest
 *   2. `<serverDir>/../VERSION`  — repo root, unless the parent package is
 *      demonstrably someone else's (see below)
 *   3. `<serverDir>/VERSION`     — server.mjs at repo root (defensive)
 *   4. `<projectDir>/VERSION`    — caller-provided fallback (legacy callers)
 *   5. `"unknown"`               — never throws, never invents a number
 *
 * Issue #106: previously the MCP handshake hard-coded "2.12.3" and the
 * capabilities generator fell back to "2.14.0" when VERSION was missing.
 * Both produced stale or fictitious version strings in the boot log,
 * dashboard, and `/api/version` endpoint after self-update. This helper
 * collapses all framework-version reads to a single source of truth.
 *
 * Issue #250: `<serverDir>/../VERSION` is the install root for a standalone
 * checkout but is `<host>/VERSION` when Plan Forge is vendored at
 * `<host>/pforge-mcp`, so it reported the host app's version and the update
 * check concluded the install was ahead of latest. `package.json` goes first
 * because it is always co-located with server.mjs and cannot be the host's.
 * The parent VERSION is additionally rejected when a parent `package.json`
 * exists and does not name plan-forge — an absent one is still trusted, which
 * is what every #106 fixture models.
 *
 * @param {{ serverDir: string, projectDir?: string|null }} opts
 * @returns {string} bare version string ("2.81.0", "2.82.0-dev", or "unknown")
 */
export function resolveFrameworkVersion({ serverDir, projectDir = null } = {}) {
  if (!serverDir || typeof serverDir !== "string") return "unknown";

  const ownPkg = _readJsonOrNull(resolve(serverDir, "package.json"));
  if (typeof ownPkg?.version === "string" && ownPkg.version.trim()) {
    return ownPkg.version.trim().replace(/^v/i, "");
  }

  const parentPkg = _readJsonOrNull(resolve(serverDir, "..", "package.json"));
  const parentIsForeign = parentPkg !== null && parentPkg.name !== "plan-forge";

  const candidates = [];
  if (!parentIsForeign) candidates.push(resolve(serverDir, "..", "VERSION"));
  candidates.push(resolve(serverDir, "VERSION"));
  if (projectDir && typeof projectDir === "string" && !parentIsForeign) {
    candidates.push(resolve(projectDir, "VERSION"));
  }
  for (const path of candidates) {
    try {
      if (existsSync(path)) {
        const v = readFileSync(path, "utf-8").trim();
        if (v) return v.replace(/^v/i, "");
      }
    } catch { /* keep looking */ }
  }
  return "unknown";
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

function updateCheckSuppressed(env) {
  return env.PFORGE_NO_UPDATE_CHECK === "1" || env.PFORGE_NO_UPDATE_CHECK === "true";
}

function cachedUpdatePayload(cached, currentVersion) {
  return {
    ...cached,
    current: currentVersion,
    isNewer: compareVersions(currentVersion, cached.latest) < 0,
    fromCache: true,
  };
}

function versionFileNewerThanCache(projectDir) {
  const versionFile = resolve(projectDir, "VERSION");
  const cacheFile = cachePath(projectDir);
  if (!existsSync(versionFile) || !existsSync(cacheFile)) return false;
  return statSync(versionFile).mtimeMs > statSync(cacheFile).mtimeMs;
}

// A date that does not parse gives NaN, which fails both comparisons: an entry with no usable time is no entry.
function ageWithinTtl(checkedAt, ttlMs) {
  const age = Date.now() - new Date(checkedAt).getTime();
  return age >= 0 && age < ttlMs;
}

function readFreshCachedUpdate(projectDir, currentVersion, ttlMs, { githubAnswerOnly = false } = {}) {
  const cached = readCache(projectDir);
  if (!cached?.checkedAt || !isReleaseVersion(cached.latest)) return null;
  if (githubAnswerOnly && !isGitHubAnswer(cached)) return null;
  if (!ageWithinTtl(cached.checkedAt, ttlMs)) return null;
  try {
    return versionFileNewerThanCache(projectDir) ? null : cachedUpdatePayload(cached, currentVersion);
  } catch {
    return cachedUpdatePayload(cached, currentVersion);
  }
}

function isReleaseVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+/.test(value);
}

// What an entry says about where it came from. `pforge update` writes "the version I just installed" (writeFreshCache) so
// the next unforced check need not ask GitHub; that is not what GitHub would say after a pinned older tag or from a -dev
// sibling clone. Only an entry GitHub's answer left, for a version that has a release tag, can stand in for a check that
// could not be made. Entries from before the marker existed carry none, and are what a check left.
function isGitHubAnswer(cached) {
  return cached.source !== INSTALL_SOURCE && /^\d+\.\d+\.\d+$/.test(cached.latest);
}

// What a user is told when a check did not get an answer. `kind` is for callers to branch on; `message` is the sentence,
// complete with what to do, so no caller words it again. Nothing here ever holds the token.
function unanswered(kind, message, details = {}) {
  return { kind, ...details, message };
}

function reasonForResponse(res, { authenticated, tokenRejected, ignoredTokenVariable }) {
  const status = typeof res?.status === "number" ? res.status : null;
  const rejected = tokenRejected ? { tokenRejected: true } : {};
  const limit = readRateLimit(res);
  if (limit) {
    return unanswered("rate-limited", describeRateLimit({ ...limit, authenticated, tokenRejected, ignoredTokenVariable }), { status, authenticated, ...rejected, ...limit });
  }
  const says = status === null ? "an error" : `HTTP ${status}`;
  return unanswered("http", `GitHub answered ${says}. Try again shortly.`, { status, ...rejected });
}

function reasonForThrown(err) {
  if (err?.name === "AbortError") {
    return unanswered("timeout", `GitHub did not answer within ${FETCH_TIMEOUT_MS / 1000} seconds. Try again shortly, or check the network connection.`);
  }
  const detail = String(err?.cause?.message ?? err?.message ?? "").slice(0, MAX_ERROR_DETAIL_CHARS);
  return unanswered("network", `GitHub could not be reached${detail ? ` (${detail})` : ""}. Check the network connection and try again.`);
}

function notARelease() {
  return unanswered("malformed", "GitHub's answer did not name a release version. Try again shortly.");
}

async function readJson(res) {
  try { return await res.json(); } catch { return null; }
}

async function requestLatestRelease({ fetchImpl, env }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const request = await fetchGitHub(RELEASES_URL, { fetchImpl, env, userAgent: USER_AGENT, signal: controller.signal });
    if (!request.res?.ok) return { reason: reasonForResponse(request.res, request) };
    return { json: await readJson(request.res) };
  } catch (err) {
    return { reason: reasonForThrown(err) };
  } finally {
    clearTimeout(timer);
  }
}

function buildUpdatePayload(currentVersion, json) {
  const tag = typeof json?.tag_name === "string" ? json.tag_name : null;
  if (!tag) return null;
  const latest = tag.replace(/^v/i, "").trim();
  if (!/^\d+\.\d+\.\d+/.test(latest)) return null;
  return {
    current: currentVersion,
    latest,
    isNewer: compareVersions(currentVersion, latest) < 0,
    url: typeof json.html_url === "string" ? json.html_url : `https://github.com/srnichols/plan-forge/releases/tag/${tag}`,
    publishedAt: typeof json.published_at === "string" ? json.published_at : null,
    checkedAt: new Date().toISOString(),
    fromCache: false,
  };
}

/**
 * Check GitHub for a newer release and say why when it could not be done.
 *
 * Returns `{ result, reason }`:
 *   - `result`: the payload below, or null when there is no answer to give.
 *       {
 *         current: "2.37.0",
 *         latest:  "2.38.0",
 *         isNewer: true,
 *         url:     "https://github.com/.../releases/tag/v2.38.0",
 *         publishedAt: "2026-04-25T12:34:56Z",
 *         checkedAt:   "2026-04-19T01:00:00Z",
 *         fromCache: false,
 *       }
 *   - `reason`: null when GitHub (or the cache, for an unforced check) answered. Otherwise why GitHub was not asked or
 *     did not answer: `{ kind, message, ... }` with `kind` one of `suppressed`, `no-version`, `network`, `timeout`,
 *     `rate-limited` (with `resetAt`, `limit`, `retryAfterSeconds`, `quotaSpent`, `authenticated`, `tokenRejected`), `http` (with
 *     `status`) or `malformed`. `message` is a sentence for the user.
 *
 * A forced check that GitHub does not answer falls back to a cache entry that is still inside the TTL, so a rate limit
 * does not throw away an answer the last check left (`result.fromCache` is true and `reason` says why GitHub was not
 * asked). Only an answer from GitHub counts: not the entry `pforge update` writes for the version it installed
 * (`source: "install"`), and not a version that has no release tag. The cache entry is left as it was: one failure does
 * not renew an old answer.
 *
 * Never throws.
 *
 * @param {object} opts
 * @param {string} opts.currentVersion
 * @param {string} opts.projectDir
 * @param {boolean} [opts.force=false]   Bypass the TTL.
 * @param {number}  [opts.ttlMs]         Override cache TTL (for tests).
 * @param {typeof fetch} [opts.fetchImpl] Inject fetch (for tests).
 * @param {NodeJS.ProcessEnv} [opts.env] Inject env (for tests).
 */
export async function checkForUpdateWithReason({
  currentVersion,
  projectDir,
  force = false,
  ttlMs = DEFAULT_TTL_MS,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const refusal = reasonNotToCheck({ currentVersion, projectDir, env });
  if (refusal) return { result: null, reason: refusal };
  if (!force) {
    const cached = readFreshCachedUpdate(projectDir, currentVersion, ttlMs);
    if (cached) return { result: cached, reason: null };
  }
  return askGitHub({ currentVersion, projectDir, ttlMs, fetchImpl, env });
}

function reasonNotToCheck({ currentVersion, projectDir, env }) {
  if (updateCheckSuppressed(env)) {
    return unanswered("suppressed", "PFORGE_NO_UPDATE_CHECK is set, which turns update checks off. Unset it to check for a release.");
  }
  if (!currentVersion || !projectDir) {
    return unanswered("no-version", "Plan Forge's installed version is not known, so there is nothing to compare a release with.");
  }
  return null;
}

// Asks GitHub. When it does not answer, a cache entry that GitHub's answer left, and that is still inside the TTL, is used
// instead: a forced check, which skipped the cache to get a fresher answer, would otherwise throw away a good one. An
// unforced check has already read the cache and found nothing usable, so it gains nothing here.
async function askGitHub({ currentVersion, projectDir, ttlMs, fetchImpl, env }) {
  const live = typeof fetchImpl === "function"
    ? await requestLatestRelease({ fetchImpl, env })
    : { reason: unanswered("network", "GitHub could not be reached (this Node.js has no fetch).") };
  const payload = live.reason ? null : buildUpdatePayload(currentVersion, live.json);
  if (payload) {
    writeCache(projectDir, payload);
    return { result: payload, reason: null };
  }
  return {
    result: readFreshCachedUpdate(projectDir, currentVersion, ttlMs, { githubAnswerOnly: true }),
    reason: live.reason ?? notARelease(),
  };
}

/**
 * The payload of `checkForUpdateWithReason`, or null when there is none. Kept for the callers that only need the answer.
 * Never throws.
 */
export async function checkForUpdate(options = {}) {
  return (await checkForUpdateWithReason(options)).result;
}

const utcMinute = (iso) => `${new Date(iso).toISOString().slice(0, ISO_MINUTE_END).replace("T", " ")} UTC`;

/**
 * The check `pforge self-update` makes, as the object pforge.sh and pforge.ps1 print from. Always forced, as
 * self-update promises. Both shells call this and print what it says, so the wording lives here and nowhere else.
 *
 *   answered:                  the payload, as `checkForUpdate` returns it
 *   answered from the cache:   the payload with `fromCache: true`, `liveCheckFailed` (the reason GitHub was not asked)
 *                              and `notice` (the sentence that says which check the answer is from)
 *   no answer:                 `{ checkFailed: true, reason }`
 *
 * @param {{ currentVersion: string, projectDir: string, ttlMs?: number, fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} options
 */
export async function runSelfUpdateCheck({ currentVersion, projectDir, ttlMs, fetchImpl, env } = {}) {
  const { result, reason } = await checkForUpdateWithReason({ currentVersion, projectDir, force: true, ttlMs, fetchImpl, env });
  if (!result) return { checkFailed: true, reason };
  if (!reason) return result;
  return { ...result, liveCheckFailed: reason, notice: `Using the release check made at ${utcMinute(result.checkedAt)} instead.` };
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
 * The entry says it is the installer's (`source: "install"`): it is the version just installed, which after a pinned
 * older tag or from a -dev sibling clone is not what GitHub would say, so a forced check that GitHub does not answer
 * does not take it for a release check.
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
    source: INSTALL_SOURCE,
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
