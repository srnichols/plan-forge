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
      const resolved = await resolveTag({ tag });
      process.stdout.write(JSON.stringify({ ok: true, tag: resolved }) + "\n");
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
