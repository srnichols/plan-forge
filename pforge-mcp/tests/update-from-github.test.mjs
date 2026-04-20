/**
 * Tests for pforge-mcp/update-from-github.mjs — Phase AUTO-UPDATE-01, Slice 1.
 *
 * All network calls are mocked. No internet required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import {
  resolveTag,
  buildTarballUrl,
  verifyGzip,
  computeSha256,
  downloadTarball,
  appendAuditLog,
  loadFromGitHubConfig,
  UpdateError,
} from "../update-from-github.mjs";

const TMP_DIR = resolve(import.meta.dirname || ".", ".tmp-ufg-test");

function makeFetch(status, body, opts = {}) {
  const { headers = {}, isStream = false, asyncIterable = false } = opts;
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : `Status ${status}`,
    headers: { get: (k) => headers[k] || null },
    json: async () => body,
    arrayBuffer: async () => {
      if (typeof body === "string") return new TextEncoder().encode(body).buffer;
      if (Buffer.isBuffer(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      return new TextEncoder().encode(JSON.stringify(body)).buffer;
    },
    body: asyncIterable
      ? { [Symbol.asyncIterator]: async function* () { yield Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)); } }
      : null,
  });
}

function makeGzipBuffer(size = 100) {
  const buf = Buffer.alloc(size);
  buf[0] = 0x1f;
  buf[1] = 0x8b;
  return buf;
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

// ─── resolveTag ──────────────────────────────────────────────────────

describe("resolveTag", () => {
  it("calls /releases/latest and returns tag_name", async () => {
    const fetch = makeFetch(200, { tag_name: "v2.50.0" });
    const tag = await resolveTag({ fetchImpl: fetch, env: {} });
    expect(tag).toBe("v2.50.0");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("releases/latest");
  });

  it("uses explicit --tag verbatim (not 'latest' or 'HEAD')", async () => {
    const fetch = makeFetch(200, {});
    const tag = await resolveTag({ tag: "v2.49.1", fetchImpl: fetch, env: {} });
    expect(tag).toBe("v2.49.1");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects HEAD with ERR_NO_HEAD_TAG", async () => {
    await expect(resolveTag({ tag: "HEAD", fetchImpl: makeFetch(200, {}), env: {} }))
      .rejects.toThrow(UpdateError);
    await expect(resolveTag({ tag: "HEAD", fetchImpl: makeFetch(200, {}), env: {} }))
      .rejects.toMatchObject({ code: "ERR_NO_HEAD_TAG" });
  });

  it("treats --tag latest as 'resolve latest'", async () => {
    const fetch = makeFetch(200, { tag_name: "v2.51.0" });
    const tag = await resolveTag({ tag: "latest", fetchImpl: fetch, env: {} });
    expect(tag).toBe("v2.51.0");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("includes GITHUB_TOKEN as Authorization header when set", async () => {
    const fetch = makeFetch(200, { tag_name: "v2.50.0" });
    await resolveTag({ fetchImpl: fetch, env: { GITHUB_TOKEN: "ghp_test123" } });
    const headers = fetch.mock.calls[0][1].headers;
    expect(headers.authorization).toBe("token ghp_test123");
  });

  it("throws ERR_RATE_LIMITED on 403", async () => {
    const fetch = makeFetch(403, {});
    await expect(resolveTag({ fetchImpl: fetch, env: {} }))
      .rejects.toMatchObject({ code: "ERR_RATE_LIMITED" });
  });
});

// ─── buildTarballUrl ─────────────────────────────────────────────────

describe("buildTarballUrl", () => {
  it("returns /tarball/<tag> format", () => {
    const url = buildTarballUrl("v2.50.0");
    expect(url).toBe("https://api.github.com/repos/srnichols/plan-forge/tarball/v2.50.0");
  });
});

// ─── verifyGzip ──────────────────────────────────────────────────────

describe("verifyGzip", () => {
  it("accepts valid gzip magic bytes", () => {
    expect(verifyGzip(makeGzipBuffer())).toBe(true);
  });

  it("rejects non-gzip data", () => {
    expect(verifyGzip(Buffer.from("not gzip"))).toBe(false);
  });

  it("rejects empty/null buffer", () => {
    expect(verifyGzip(null)).toBe(false);
    expect(verifyGzip(Buffer.alloc(0))).toBe(false);
    expect(verifyGzip(Buffer.alloc(1))).toBe(false);
  });
});

// ─── computeSha256 ───────────────────────────────────────────────────

describe("computeSha256", () => {
  it("computes correct SHA-256 hash", () => {
    const file = join(TMP_DIR, "testfile.bin");
    writeFileSync(file, "hello world");
    const hash = computeSha256(file);
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });
});

// ─── downloadTarball ─────────────────────────────────────────────────

describe("downloadTarball", () => {
  it("downloads, verifies gzip, computes SHA-256", async () => {
    const gzipBuf = makeGzipBuffer(200);
    const fetch = makeFetch(200, gzipBuf, { asyncIterable: true });
    const result = await downloadTarball({
      tag: "v2.50.0",
      cacheDir: join(TMP_DIR, "cache"),
      fetchImpl: fetch,
      env: {},
    });
    expect(result.path).toContain("update-v2.50.0.tar.gz");
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sizeBytes).toBe(200);
    expect(existsSync(result.path)).toBe(true);
  });

  it("enforces 50 MB cap — rejects oversized tarball", async () => {
    const bigBuf = makeGzipBuffer(200);
    const fetch = makeFetch(200, bigBuf, { asyncIterable: true });
    await expect(downloadTarball({
      tag: "v2.50.0",
      cacheDir: join(TMP_DIR, "cache"),
      maxTarballBytes: 100,
      fetchImpl: fetch,
      env: {},
    })).rejects.toMatchObject({ code: "ERR_TARBALL_TOO_LARGE" });
  });

  it("honors maxTarballBytes config override", async () => {
    const gzipBuf = makeGzipBuffer(500);
    const fetch = makeFetch(200, gzipBuf, { asyncIterable: true });
    const result = await downloadTarball({
      tag: "v2.50.0",
      cacheDir: join(TMP_DIR, "cache"),
      maxTarballBytes: 1000,
      fetchImpl: fetch,
      env: {},
    });
    expect(result.sizeBytes).toBe(500);
  });

  it("uses cacheDir correctly", async () => {
    const customCache = join(TMP_DIR, "my-cache");
    const gzipBuf = makeGzipBuffer(50);
    const fetch = makeFetch(200, gzipBuf, { asyncIterable: true });
    const result = await downloadTarball({
      tag: "v2.50.0",
      cacheDir: customCache,
      fetchImpl: fetch,
      env: {},
    });
    expect(result.path).toContain("my-cache");
    expect(existsSync(result.path)).toBe(true);
  });

  it("404 on tag → ERR_TAG_NOT_FOUND, no partial write", async () => {
    const fetch = makeFetch(404, {});
    const cacheDir = join(TMP_DIR, "cache404");
    await expect(downloadTarball({
      tag: "v99.99.99",
      cacheDir,
      fetchImpl: fetch,
      env: {},
    })).rejects.toMatchObject({ code: "ERR_TAG_NOT_FOUND" });
    // No partial file
    const files = existsSync(cacheDir) ? require("node:fs").readdirSync(cacheDir) : [];
    expect(files.length).toBe(0);
  });

  it("rejects invalid gzip download", async () => {
    const badBuf = Buffer.from("not gzip content at all");
    const fetch = makeFetch(200, badBuf, { asyncIterable: true });
    await expect(downloadTarball({
      tag: "v2.50.0",
      cacheDir: join(TMP_DIR, "cache-bad"),
      fetchImpl: fetch,
      env: {},
    })).rejects.toMatchObject({ code: "ERR_INVALID_GZIP" });
  });

  it("network failure → clear error, no retry", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(downloadTarball({
      tag: "v2.50.0",
      cacheDir: join(TMP_DIR, "cache-fail"),
      fetchImpl: fetch,
      env: {},
    })).rejects.toMatchObject({ code: "ERR_NETWORK" });
  });
});

// ─── loadFromGitHubConfig ────────────────────────────────────────────

describe("loadFromGitHubConfig", () => {
  it("returns defaults when .forge.json is missing", () => {
    const config = loadFromGitHubConfig(TMP_DIR);
    expect(config.maxTarballBytes).toBe(52_428_800);
    expect(config.cacheDir).toContain(".forge");
    expect(config.cacheDir).toContain("cache");
  });

  it("reads maxTarballBytes override", () => {
    const forgeDir = join(TMP_DIR, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(join(TMP_DIR, ".forge.json"), JSON.stringify({
      update: { fromGitHub: { maxTarballBytes: 10_000_000 } }
    }));
    const config = loadFromGitHubConfig(TMP_DIR);
    expect(config.maxTarballBytes).toBe(10_000_000);
  });

  it("reads cacheDir override", () => {
    writeFileSync(join(TMP_DIR, ".forge.json"), JSON.stringify({
      update: { fromGitHub: { cacheDir: "custom/cache" } }
    }));
    const config = loadFromGitHubConfig(TMP_DIR);
    expect(config.cacheDir).toContain("custom");
  });
});

// ─── appendAuditLog ──────────────────────────────────────────────────

describe("appendAuditLog", () => {
  it("appends JSONL line to .forge/update-audit.log", () => {
    appendAuditLog(TMP_DIR, {
      tag: "v2.50.0",
      sha256: "abc123",
      sizeBytes: 1000,
      source: "manual",
      filesChanged: 5,
      outcome: "success",
    });
    const logPath = join(TMP_DIR, ".forge", "update-audit.log");
    expect(existsSync(logPath)).toBe(true);
    const line = readFileSync(logPath, "utf-8").trim();
    const parsed = JSON.parse(line);
    expect(parsed.from).toBe("github");
    expect(parsed.tag).toBe("v2.50.0");
    expect(parsed.sha256).toBe("abc123");
    expect(parsed.outcome).toBe("success");
    expect(parsed.ts).toBeDefined();
  });

  it("appends multiple lines", () => {
    appendAuditLog(TMP_DIR, { tag: "v1", outcome: "success" });
    appendAuditLog(TMP_DIR, { tag: "v2", outcome: "failed", error: "test" });
    const logPath = join(TMP_DIR, ".forge", "update-audit.log");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).tag).toBe("v1");
    expect(JSON.parse(lines[1]).tag).toBe("v2");
  });
});
