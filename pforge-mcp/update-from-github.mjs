/**
 * Plan Forge — Update from GitHub (Phase AUTO-UPDATE-01, Slice 1).
 *
 * Shared helpers for `pforge update --from-github`. Both pforge.ps1 and
 * pforge.sh invoke this module via `node pforge-mcp/update-from-github.mjs`
 * with a JSON payload on stdin. Keeps download, verify, and audit logic
 * testable in JS instead of duplicated across shells.
 *
 * Separation of concerns:
 *   - This module handles: tag resolution, tarball download, gzip verify,
 *     SHA-256, size cap, audit log, config loading.
 *   - Shell scripts handle: argument parsing, tar extraction, file-copy
 *     (existing flow), cleanup, user prompts.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, createReadStream } from "node:fs";
import { resolve, join } from "node:path";

const RELEASES_URL = "https://api.github.com/repos/srnichols/plan-forge/releases/latest";
const TAGS_URL = "https://api.github.com/repos/srnichols/plan-forge/tags?per_page=100";
const TARBALL_BASE = "https://api.github.com/repos/srnichols/plan-forge/tarball";
const DEFAULT_MAX_TARBALL_BYTES = 52_428_800; // 50 MB
const DEFAULT_CACHE_DIR = ".forge/cache";
const CONNECT_TIMEOUT_MS = 4_000;
const TOTAL_TIMEOUT_MS = 30_000;

// ─── Error codes ─────────────────────────────────────────────────────
export class UpdateError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "UpdateError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

// ─── Config ──────────────────────────────────────────────────────────
export function loadFromGitHubConfig(projectDir) {
  const configPath = resolve(projectDir, ".forge.json");
  let cacheDir = DEFAULT_CACHE_DIR;
  let maxTarballBytes = DEFAULT_MAX_TARBALL_BYTES;

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      const fg = config?.update?.fromGitHub;
      if (fg?.cacheDir && typeof fg.cacheDir === "string") cacheDir = fg.cacheDir;
      if (fg?.maxTarballBytes && typeof fg.maxTarballBytes === "number" && fg.maxTarballBytes > 0) {
        maxTarballBytes = fg.maxTarballBytes;
      }
    } catch { /* use defaults */ }
  }

  const resolved = resolve(projectDir, cacheDir);
  return { cacheDir: resolved, maxTarballBytes };
}

// ─── Tag resolution ──────────────────────────────────────────────────
export async function resolveTag({ tag, fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (tag && /^HEAD$/i.test(tag)) {
    throw new UpdateError("ERR_NO_HEAD_TAG", "Tag 'HEAD' is not allowed — this command is for releases, not dev builds.");
  }
  if (tag && !/^latest$/i.test(tag)) {
    return tag;
  }

  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "plan-forge-update",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `token ${env.GITHUB_TOKEN}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  let res;
  try {
    res = await fetchImpl(RELEASES_URL, { headers, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new UpdateError("ERR_NETWORK_TIMEOUT", "Timed out connecting to GitHub API.", err);
    }
    throw new UpdateError("ERR_NETWORK", `Network error: ${err.message}`, err);
  }
  clearTimeout(timer);

  if (res.status === 403) {
    throw new UpdateError("ERR_RATE_LIMITED", "GitHub API rate limit exceeded. Set GITHUB_TOKEN env var for higher limits.");
  }
  if (!res.ok) {
    throw new UpdateError("ERR_API", `GitHub API returned ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const tagName = json?.tag_name;
  if (!tagName || typeof tagName !== "string") {
    throw new UpdateError("ERR_API", "GitHub API response missing tag_name.");
  }
  return tagName;
}

// ─── Semver comparison ──────────────────────────────────────────────
// Parses "v1.2.3" / "1.2.3" into [1,2,3]. Returns null for non-semver tags
// (e.g., pre-release suffixes "v1.2.3-beta" are parsed as [1,2,3] and the
// suffix is preserved separately so stable > pre-release).
function parseSemver(tag) {
  if (typeof tag !== "string") return null;
  const m = tag.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] || null,
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Stable (no pre) ranks higher than pre-release.
  if (!a.pre && b.pre) return 1;
  if (a.pre && !b.pre) return -1;
  if (a.pre && b.pre) return a.pre < b.pre ? -1 : a.pre > b.pre ? 1 : 0;
  return 0;
}

// ─── Drift detection ─────────────────────────────────────────────────
// Fetches /tags and returns the newest stable semver tag. Used to detect
// the case where tags have been pushed but no GitHub Release was cut —
// /releases/latest then silently returns an older version than HEAD.
// Returns null on network failure or no parseable tags (non-fatal).
export async function fetchNewestSemverTag({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "plan-forge-update",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `token ${env.GITHUB_TOKEN}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  let res;
  try {
    res = await fetchImpl(TAGS_URL, { headers, signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return null;
  }
  clearTimeout(timer);

  if (!res.ok) return null;
  let tags;
  try { tags = await res.json(); } catch { return null; }
  if (!Array.isArray(tags)) return null;

  let newest = null;
  let newestName = null;
  for (const t of tags) {
    const parsed = parseSemver(t?.name);
    if (!parsed) continue;
    // Skip pre-releases — we only want stable tags for drift comparison.
    if (parsed.pre) continue;
    if (!newest || compareSemver(parsed, newest) > 0) {
      newest = parsed;
      newestName = t.name;
    }
  }
  return newestName;
}

// Returns { drift: boolean, newestTag, releaseTag, message }. Non-null only
// when a newer stable tag exists than the resolved Release tag.
export async function checkLatestDrift(resolvedReleaseTag, opts = {}) {
  const releaseSemver = parseSemver(resolvedReleaseTag);
  if (!releaseSemver) return null;
  const newestTag = await fetchNewestSemverTag(opts);
  if (!newestTag) return null;
  const newestSemver = parseSemver(newestTag);
  if (!newestSemver) return null;
  if (compareSemver(newestSemver, releaseSemver) <= 0) return null;
  return {
    drift: true,
    newestTag,
    releaseTag: resolvedReleaseTag,
    message: `GitHub tag ${newestTag} exists but the latest published Release is ${resolvedReleaseTag}. ` +
             `The source repo pushed tags without cutting Releases — you are getting an older version. ` +
             `Re-run with --tag ${newestTag} to fetch the newest tag, or ask the maintainer to publish the missing Release(s).`,
  };
}

// ─── URL builder ─────────────────────────────────────────────────────
export function buildTarballUrl(tag) {
  return `${TARBALL_BASE}/${tag}`;
}

// ─── Gzip verification ──────────────────────────────────────────────
export function verifyGzip(buffer) {
  if (!buffer || buffer.length < 2) return false;
  return buffer[0] === 0x1f && buffer[1] === 0x8b;
}

// ─── SHA-256 ─────────────────────────────────────────────────────────
export function computeSha256(filePath) {
  const hash = createHash("sha256");
  const data = readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

// ─── Tarball download ────────────────────────────────────────────────
export async function downloadTarball({
  tag,
  cacheDir,
  maxTarballBytes = DEFAULT_MAX_TARBALL_BYTES,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const destPath = join(cacheDir, `update-${tag.replace(/[^a-zA-Z0-9._-]/g, "_")}.tar.gz`);
  const url = buildTarballUrl(tag);

  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "plan-forge-update",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `token ${env.GITHUB_TOKEN}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  let res;
  try {
    res = await fetchImpl(url, { headers, signal: controller.signal, redirect: "follow" });
  } catch (err) {
    clearTimeout(timer);
    _cleanupPartial(destPath);
    if (err.name === "AbortError") {
      throw new UpdateError("ERR_NETWORK_TIMEOUT", "Timed out downloading tarball.", err);
    }
    throw new UpdateError("ERR_NETWORK", `Network error during download: ${err.message}`, err);
  }

  if (res.status === 404) {
    clearTimeout(timer);
    throw new UpdateError("ERR_TAG_NOT_FOUND", `Tag '${tag}' not found on GitHub.`);
  }
  if (res.status === 403) {
    clearTimeout(timer);
    throw new UpdateError("ERR_RATE_LIMITED", "GitHub API rate limit exceeded. Set GITHUB_TOKEN env var for higher limits.");
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new UpdateError("ERR_DOWNLOAD", `Download failed with status ${res.status}: ${res.statusText}`);
  }

  // Stream the response body, enforcing the size cap
  const chunks = [];
  let totalBytes = 0;

  try {
    if (res.body && typeof res.body[Symbol.asyncIterator] === "function") {
      for await (const chunk of res.body) {
        totalBytes += chunk.length;
        if (totalBytes > maxTarballBytes) {
          controller.abort();
          clearTimeout(timer);
          _cleanupPartial(destPath);
          throw new UpdateError(
            "ERR_TARBALL_TOO_LARGE",
            `Tarball exceeds ${maxTarballBytes} bytes (received ${totalBytes} so far). Aborting.`
          );
        }
        chunks.push(chunk);
      }
    } else {
      // Fallback: read as arrayBuffer (works in all fetch implementations)
      const ab = await res.arrayBuffer();
      totalBytes = ab.byteLength;
      if (totalBytes > maxTarballBytes) {
        clearTimeout(timer);
        throw new UpdateError(
          "ERR_TARBALL_TOO_LARGE",
          `Tarball is ${totalBytes} bytes, exceeds ${maxTarballBytes} byte limit.`
        );
      }
      chunks.push(Buffer.from(ab));
    }
  } catch (err) {
    clearTimeout(timer);
    _cleanupPartial(destPath);
    if (err instanceof UpdateError) throw err;
    if (err.name === "AbortError") {
      throw new UpdateError("ERR_NETWORK_TIMEOUT", "Timed out downloading tarball.", err);
    }
    throw new UpdateError("ERR_NETWORK", `Download stream error: ${err.message}`, err);
  }
  clearTimeout(timer);

  const buffer = Buffer.concat(chunks);

  if (!verifyGzip(buffer)) {
    throw new UpdateError("ERR_INVALID_GZIP", "Downloaded file is not valid gzip (magic bytes mismatch).");
  }

  writeFileSync(destPath, buffer);
  const sha256 = computeSha256(destPath);

  return { path: destPath, sha256, sizeBytes: totalBytes };
}

function _cleanupPartial(path) {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* best-effort */ }
}

// ─── Audit log ───────────────────────────────────────────────────────
export function appendAuditLog(projectDir, entry) {
  const logPath = resolve(projectDir, ".forge", "update-audit.log");
  mkdirSync(resolve(projectDir, ".forge"), { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    from: "github",
    ...entry,
  });
  appendFileSync(logPath, line + "\n", "utf-8");
}

// ─── CLI entry point ─────────────────────────────────────────────────
// Invoked by pforge.ps1/pforge.sh as:
//   node pforge-mcp/update-from-github.mjs <action> [--tag <tag>] [--project-dir <dir>]
//
// Actions:
//   resolve-tag   → prints resolved tag to stdout
//   download      → downloads tarball, prints JSON {path, sha256, sizeBytes}
//   audit         → appends audit log entry (reads JSON from stdin)

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  let tag = null;
  let projectDir = process.cwd();

  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--tag" && args[i + 1]) { tag = args[++i]; continue; }
    if (args[i] === "--project-dir" && args[i + 1]) { projectDir = args[++i]; continue; }
  }

  try {
    if (action === "resolve-tag") {
      const wasLatest = !tag || /^latest$/i.test(tag);
      const resolved = await resolveTag({ tag });
      const out = { ok: true, tag: resolved };
      // Only probe for drift when caller asked for "latest" — if they
      // pinned an explicit tag, they already know what they want.
      if (wasLatest) {
        try {
          const drift = await checkLatestDrift(resolved);
          if (drift) out.warning = drift;
        } catch { /* drift check is advisory — never fail resolve-tag over it */ }
      }
      process.stdout.write(JSON.stringify(out) + "\n");
    } else if (action === "download") {
      const config = loadFromGitHubConfig(projectDir);
      if (!tag) { process.stderr.write("ERROR: --tag required for download\n"); process.exit(1); }
      const result = await downloadTarball({
        tag,
        cacheDir: config.cacheDir,
        maxTarballBytes: config.maxTarballBytes,
      });
      process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
    } else if (action === "audit") {
      // Read entry from stdin
      const chunks = [];
      process.stdin.setEncoding("utf-8");
      for await (const chunk of process.stdin) { chunks.push(chunk); }
      const entry = JSON.parse(chunks.join(""));
      appendAuditLog(projectDir, entry);
      process.stdout.write(JSON.stringify({ ok: true }) + "\n");
    } else {
      process.stderr.write(`Unknown action: ${action}\nUsage: update-from-github.mjs <resolve-tag|download|audit>\n`);
      process.exit(1);
    }
  } catch (err) {
    const out = {
      ok: false,
      code: err.code || "ERR_UNKNOWN",
      message: err.message,
    };
    process.stdout.write(JSON.stringify(out) + "\n");
    process.exit(1);
  }
}

// Run CLI if invoked directly
const _thisFile = new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1");
const _argFile = process.argv[1] ? resolve(process.argv[1]) : "";
const isMainModule = _argFile && resolve(_thisFile) === _argFile;
if (isMainModule) {
  main();
}
