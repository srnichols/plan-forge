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
  fetchNewestSemverTag,
  checkLatestDrift,
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

  // #446 — the check and the download read the same token variables and describe a rate limit the same way.
  it("includes GH_TOKEN, which the GitHub CLI uses, as Authorization header when GITHUB_TOKEN is not set", async () => {
    const fetch = makeFetch(200, { tag_name: "v2.50.0" });
    await resolveTag({ fetchImpl: fetch, env: { GH_TOKEN: "ghp_gh_cli" } });
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("token ghp_gh_cli");
  });

  it("repeats the request without a token that GitHub rejects with 401, so a stale token does not block an update", async () => {
    const fetch = vi.fn(async (_url, init) => ({
      ok: !init.headers.authorization,
      status: init.headers.authorization ? 401 : 200,
      statusText: "",
      headers: { get: () => null },
      json: async () => ({ tag_name: "v2.50.0" }),
    }));
    const tag = await resolveTag({ fetchImpl: fetch, env: { GITHUB_TOKEN: "ghp_stale" } });
    expect(tag).toBe("v2.50.0");
    expect(fetch.mock.calls.map(([, init]) => Boolean(init.headers.authorization))).toEqual([true, false]);
  });

  it("throws ERR_RATE_LIMITED on 429, which GitHub also uses for a limit", async () => {
    await expect(resolveTag({ fetchImpl: makeFetch(429, {}), env: {} })).rejects.toMatchObject({ code: "ERR_RATE_LIMITED" });
  });

  it("says when the limit resets and that GITHUB_TOKEN or GH_TOKEN raises it, when GitHub sent its rate-limit headers", async () => {
    const fetch = makeFetch(403, {}, { headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793264400" } });
    const error = await resolveTag({ fetchImpl: fetch, env: {} }).catch((e) => e);
    expect(error.code).toBe("ERR_RATE_LIMITED");
    expect(error.message).toContain("09:00 UTC");
    expect(error.message).toContain("GITHUB_TOKEN");
    expect(error.message).toContain("GH_TOKEN");
  });

  it("does not tell a caller whose token was accepted to set one", async () => {
    const fetch = makeFetch(403, {}, { headers: { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793264400" } });
    const error = await resolveTag({ fetchImpl: fetch, env: { GITHUB_TOKEN: "ghp_good" } }).catch((e) => e);
    expect(error.code).toBe("ERR_RATE_LIMITED");
    expect(error.message).not.toMatch(/GITHUB_TOKEN|GH_TOKEN/);
  });

  it("never puts the token in an error", async () => {
    const error = await resolveTag({ fetchImpl: makeFetch(403, {}), env: { GITHUB_TOKEN: "ghp_secret_value_1234567890" } }).catch((e) => e);
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain("ghp_secret_value_1234567890");
  });

  // A pinned tag has to name a version. `pforge self-update --force` built "v" from a check that had failed, resolve-tag
  // answered ok with it, and the download then said "Tag 'v' not found on GitHub".
  it.each(["v", "V", " ", "v1", "1.2", "v1.2.3.4", "main", "pre-phase-29", "v2.50.0 ", "../v2.50.0", "v2.50.0/../../x", "v2.50.0?x=1"])(
    "rejects the pinned tag %j, which names no release, with ERR_INVALID_TAG and without asking GitHub",
    async (tag) => {
      const fetch = makeFetch(200, { tag_name: "v2.50.0" });
      const error = await resolveTag({ tag, fetchImpl: fetch, env: {} }).catch((e) => e);
      expect(error).toBeInstanceOf(UpdateError);
      expect(error.code).toBe("ERR_INVALID_TAG");
      expect(error.message).toContain("latest");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["v2.49.1", "2.49.1", "v2.36.0-beta.4", "v2.10.0-plans", "v10.0.0"])("still accepts the pinned tag %s verbatim", async (tag) => {
    const fetch = makeFetch(200, {});
    expect(await resolveTag({ tag, fetchImpl: fetch, env: {} })).toBe(tag);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still answers HEAD with ERR_NO_HEAD_TAG, not ERR_INVALID_TAG, because that message says why", async () => {
    await expect(resolveTag({ tag: "HEAD", fetchImpl: makeFetch(200, {}), env: {} })).rejects.toMatchObject({ code: "ERR_NO_HEAD_TAG" });
  });
});

// ─── buildTarballUrl ─────────────────────────────────────────────────

describe("buildTarballUrl", () => {
  it("returns /tarball/<tag> format", () => {
    const url = buildTarballUrl("v2.50.0");
    expect(url).toBe("https://api.github.com/repos/srnichols/plan-forge/tarball/v2.50.0");
  });
});

// ─── fetchNewestSemverTag / checkLatestDrift ────────────────────────

describe("fetchNewestSemverTag", () => {
  it("returns the highest stable semver tag", async () => {
    const tags = [
      { name: "v2.80.1" },
      { name: "v2.80.0" },
      { name: "v2.75.1" },
      { name: "v2.79.0" },
      { name: "not-a-semver" },
    ];
    const fetch = makeFetch(200, tags);
    const newest = await fetchNewestSemverTag({ fetchImpl: fetch, env: {} });
    expect(newest).toBe("v2.80.1");
  });

  it("skips pre-release tags", async () => {
    const tags = [
      { name: "v3.0.0-beta.1" },
      { name: "v2.80.1" },
    ];
    const fetch = makeFetch(200, tags);
    const newest = await fetchNewestSemverTag({ fetchImpl: fetch, env: {} });
    expect(newest).toBe("v2.80.1");
  });

  it("returns null on network failure (non-fatal)", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("boom"));
    const newest = await fetchNewestSemverTag({ fetchImpl: fetch, env: {} });
    expect(newest).toBeNull();
  });

  it("sends GH_TOKEN as an Authorization header, like the release request does (#446)", async () => {
    const fetch = makeFetch(200, [{ name: "v2.80.1" }]);
    await fetchNewestSemverTag({ fetchImpl: fetch, env: { GH_TOKEN: "ghp_gh_cli" } });
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("token ghp_gh_cli");
  });
});

describe("checkLatestDrift", () => {
  it("reports drift when tags are ahead of release", async () => {
    const fetch = makeFetch(200, [{ name: "v2.80.1" }, { name: "v2.79.0" }]);
    const drift = await checkLatestDrift("v2.75.1", { fetchImpl: fetch, env: {} });
    expect(drift).not.toBeNull();
    expect(drift.newestTag).toBe("v2.80.1");
    expect(drift.releaseTag).toBe("v2.75.1");
    expect(drift.message).toContain("v2.80.1");
    expect(drift.message).toContain("v2.75.1");
  });

  it("returns null when release matches newest tag", async () => {
    const fetch = makeFetch(200, [{ name: "v2.80.1" }, { name: "v2.79.0" }]);
    const drift = await checkLatestDrift("v2.80.1", { fetchImpl: fetch, env: {} });
    expect(drift).toBeNull();
  });

  it("returns null when release is ahead of stable tags (pre-release scenario)", async () => {
    const fetch = makeFetch(200, [{ name: "v2.80.0" }]);
    const drift = await checkLatestDrift("v2.81.0", { fetchImpl: fetch, env: {} });
    expect(drift).toBeNull();
  });

  it("returns null on API failure (advisory check must not break update)", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network"));
    const drift = await checkLatestDrift("v2.80.1", { fetchImpl: fetch, env: {} });
    expect(drift).toBeNull();
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

  // #446 — the download reads the same token variables as the check, follows GitHub's redirect to the tarball, and tells a
  // rate limit from a missing tag.
  it("sends GH_TOKEN and follows the redirect to the tarball", async () => {
    const fetch = makeFetch(200, makeGzipBuffer(50), { asyncIterable: true });
    await downloadTarball({ tag: "v2.50.0", cacheDir: join(TMP_DIR, "cache-token"), fetchImpl: fetch, env: { GH_TOKEN: "ghp_gh_cli" } });
    const init = fetch.mock.calls[0][1];
    expect(init.headers.authorization).toBe("token ghp_gh_cli");
    expect(init.redirect).toBe("follow");
  });

  it("repeats the request without a token that GitHub rejects with 401", async () => {
    const buffer = makeGzipBuffer(50);
    const fetch = vi.fn(async (_url, init) => ({
      ok: !init.headers.authorization,
      status: init.headers.authorization ? 401 : 200,
      statusText: "",
      headers: { get: () => null },
      body: init.headers.authorization ? null : { [Symbol.asyncIterator]: async function* () { yield buffer; } },
    }));
    const result = await downloadTarball({ tag: "v2.50.0", cacheDir: join(TMP_DIR, "cache-401"), fetchImpl: fetch, env: { GITHUB_TOKEN: "ghp_stale" } });
    expect(result.sizeBytes).toBe(50);
    expect(fetch.mock.calls.map(([, init]) => Boolean(init.headers.authorization))).toEqual([true, false]);
  });

  it.each([403, 429])("a %i → ERR_RATE_LIMITED that names what raises the limit, not ERR_TAG_NOT_FOUND", async (status) => {
    const error = await downloadTarball({ tag: "v2.50.0", cacheDir: join(TMP_DIR, "cache-limit"), fetchImpl: makeFetch(status, {}), env: {} }).catch((e) => e);
    expect(error.code).toBe("ERR_RATE_LIMITED");
    expect(error.message).toContain("GITHUB_TOKEN");
    expect(error.message).toContain("GH_TOKEN");
  });

  it("says when the limit resets, from GitHub's rate-limit headers", async () => {
    const fetch = makeFetch(403, {}, { headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1793264400" } });
    const error = await downloadTarball({ tag: "v2.50.0", cacheDir: join(TMP_DIR, "cache-reset"), fetchImpl: fetch, env: {} }).catch((e) => e);
    expect(error.message).toContain("09:00 UTC");
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
