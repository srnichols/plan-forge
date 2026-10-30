/**
 * Plan Forge — Update Notifier tests (Phase UPDATE-01).
 *
 * Covers:
 *   - compareVersions: core semver ordering
 *   - checkForUpdate: cache TTL, env-var opt-out, network failure tolerance,
 *     malformed-response tolerance, cache-write semantics
 *   - /api/update-status REST endpoint shape
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { cachePath, compareVersions, checkForUpdate, checkForUpdateWithReason, detectCorruptInstall, runSelfUpdateCheck, writeFreshCache } from "../update-check.mjs";
import { createExpressApp } from "../server.mjs";

// ─── compareVersions ────────────────────────────────────────────

describe("compareVersions", () => {
  it("orders basic patch / minor / major", () => {
    expect(compareVersions("2.37.0", "2.37.1")).toBe(-1);
    expect(compareVersions("2.37.0", "2.38.0")).toBe(-1);
    expect(compareVersions("2.37.0", "3.0.0")).toBe(-1);
    expect(compareVersions("2.38.0", "2.37.0")).toBe(1);
  });
  it("treats equal versions as 0", () => {
    expect(compareVersions("2.37.0", "2.37.0")).toBe(0);
    expect(compareVersions("v2.37.0", "2.37.0")).toBe(0);
  });
  it("tolerates leading v prefix", () => {
    expect(compareVersions("v2.37.0", "v2.38.0")).toBe(-1);
  });
  it("puts pre-release below the release", () => {
    expect(compareVersions("2.37.0-rc.1", "2.37.0")).toBe(-1);
    expect(compareVersions("2.37.0", "2.37.0-rc.1")).toBe(1);
  });
  it("handles garbage input without throwing", () => {
    expect(() => compareVersions("", "")).not.toThrow();
    expect(() => compareVersions(null, undefined)).not.toThrow();
    expect(compareVersions("x", "y")).toBe(0);
  });
});

// ─── checkForUpdate ─────────────────────────────────────────────

function makeFakeFetch(payload, { status = 200 } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  });
}

// A GitHub response that carries headers, for the rate-limit cases (makeFakeFetch's responses have none).
function makeResponse(status, { body = {}, headers = {} } = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => lower[name.toLowerCase()] ?? null }, json: async () => body };
}

const reply = (status, options) => async () => makeResponse(status, options);

// A fetch that records every request's headers and answers with `respond(headers)`.
function recordingFetch(respond) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const headers = init?.headers ?? {};
    requests.push({ url, headers });
    return respond(headers);
  };
  return { fetchImpl, requests };
}

describe("checkForUpdate", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pforge-update-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns null when PFORGE_NO_UPDATE_CHECK=1", async () => {
    const fetchImpl = makeFakeFetch({ tag_name: "v9.9.9" });
    const out = await checkForUpdate({
      currentVersion: "2.37.0",
      projectDir: dir,
      fetchImpl,
      env: { PFORGE_NO_UPDATE_CHECK: "1" },
    });
    expect(out).toBeNull();
  });

  it("returns null when currentVersion is missing", async () => {
    const out = await checkForUpdate({ currentVersion: "", projectDir: dir, fetchImpl: makeFakeFetch({}) });
    expect(out).toBeNull();
  });

  it("reports isNewer=true when remote is newer", async () => {
    const fetchImpl = makeFakeFetch({
      tag_name: "v2.38.0",
      html_url: "https://github.com/srnichols/plan-forge/releases/tag/v2.38.0",
      published_at: "2026-05-01T00:00:00Z",
    });
    const out = await checkForUpdate({
      currentVersion: "2.37.0",
      projectDir: dir,
      fetchImpl,
      env: {},
    });
    expect(out).not.toBeNull();
    expect(out.isNewer).toBe(true);
    expect(out.latest).toBe("2.38.0");
    expect(out.url).toMatch(/2\.38\.0/);
    expect(out.fromCache).toBe(false);
  });

  it("reports isNewer=false when local is equal or newer", async () => {
    const fetchImpl = makeFakeFetch({ tag_name: "v2.37.0" });
    const out = await checkForUpdate({
      currentVersion: "2.37.0",
      projectDir: dir,
      fetchImpl,
      env: {},
    });
    expect(out.isNewer).toBe(false);
  });

  it("writes a cache file after a successful check", async () => {
    const fetchImpl = makeFakeFetch({ tag_name: "v2.38.0" });
    await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl, env: {} });
    expect(existsSync(cachePath(dir))).toBe(true);
    const saved = JSON.parse(readFileSync(cachePath(dir), "utf-8"));
    expect(saved.latest).toBe("2.38.0");
  });

  it("serves from cache within the TTL without calling fetch", async () => {
    // Prime the cache
    const prime = makeFakeFetch({ tag_name: "v2.38.0" });
    await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl: prime, env: {} });
    // Second call with a *throwing* fetch — if cache works, fetch is never called.
    let fetchCalled = false;
    const explode = async () => { fetchCalled = true; throw new Error("should not hit network"); };
    const second = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl: explode, env: {} });
    expect(fetchCalled).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.latest).toBe("2.38.0");
  });

  it("refreshes past the TTL", async () => {
    mkdirSync(resolve(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(dir), JSON.stringify({
      latest: "2.36.0",
      checkedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), // 48h ago
    }), "utf-8");
    const fetchImpl = makeFakeFetch({ tag_name: "v2.38.0" });
    const out = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl, env: {} });
    expect(out.latest).toBe("2.38.0");
    expect(out.fromCache).toBe(false);
  });

  it("force=true bypasses the cache", async () => {
    mkdirSync(resolve(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(dir), JSON.stringify({
      latest: "2.36.0",
      checkedAt: new Date().toISOString(),
    }), "utf-8");
    const fetchImpl = makeFakeFetch({ tag_name: "v9.9.9" });
    const out = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl, env: {}, force: true });
    expect(out.latest).toBe("9.9.9");
    expect(out.fromCache).toBe(false);
  });

  it("returns null on network failure", async () => {
    const boom = async () => { throw new Error("ECONNREFUSED"); };
    const out = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl: boom, env: {} });
    expect(out).toBeNull();
  });

  it("returns null on HTTP error status", async () => {
    const fetchImpl = makeFakeFetch({}, { status: 500 });
    const out = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl, env: {} });
    expect(out).toBeNull();
  });

  it("returns null on malformed response (no tag_name)", async () => {
    const fetchImpl = makeFakeFetch({ not_a_release: true });
    const out = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl, env: {} });
    expect(out).toBeNull();
  });

  it("returns null when tag_name is not a valid semver", async () => {
    const fetchImpl = makeFakeFetch({ tag_name: "not-a-version" });
    const out = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl, env: {} });
    expect(out).toBeNull();
  });

  it("tolerates a malformed cache file", async () => {
    mkdirSync(resolve(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(dir), "not json", "utf-8");
    const fetchImpl = makeFakeFetch({ tag_name: "v2.38.0" });
    const out = await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl, env: {} });
    expect(out.latest).toBe("2.38.0");
    expect(out.fromCache).toBe(false);
  });
});

// ─── VERSION mtime invalidates cache (Fix D) ─────────────────

describe("VERSION mtime invalidates cache", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pforge-mtime-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("bypasses cache when VERSION is newer than the cache file", async () => {
    // 1. Write a VERSION file
    writeFileSync(join(dir, "VERSION"), "2.37.0\n", "utf-8");

    // 2. Prime the cache (will create .forge/update-check.json)
    const prime = makeFakeFetch({ tag_name: "v2.38.0" });
    await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl: prime, env: {} });
    expect(existsSync(cachePath(dir))).toBe(true);

    // 3. Wait briefly, then touch VERSION so its mtime is strictly newer
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(join(dir, "VERSION"), "2.39.0\n", "utf-8");

    // 4. Call checkForUpdate with a spy fetch — cache should be bypassed
    let fetchCalled = false;
    const spyFetch = async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ tag_name: "v2.39.0" }) };
    };
    const out = await checkForUpdate({
      currentVersion: "2.39.0",
      projectDir: dir,
      fetchImpl: spyFetch,
      env: {},
    });
    expect(fetchCalled).toBe(true);
    expect(out.fromCache).toBe(false);
    expect(out.latest).toBe("2.39.0");
  });

  it("serves from cache when VERSION is older than the cache file", async () => {
    // 1. Write VERSION first
    writeFileSync(join(dir, "VERSION"), "2.37.0\n", "utf-8");
    await new Promise((r) => setTimeout(r, 50));

    // 2. Prime the cache (written after VERSION, so cache is newer)
    const prime = makeFakeFetch({ tag_name: "v2.38.0" });
    await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl: prime, env: {} });

    // 3. Call again — cache should still be served
    let fetchCalled = false;
    const explode = async () => { fetchCalled = true; throw new Error("should not call fetch"); };
    const out = await checkForUpdate({
      currentVersion: "2.37.0",
      projectDir: dir,
      fetchImpl: explode,
      env: {},
    });
    expect(fetchCalled).toBe(false);
    expect(out.fromCache).toBe(true);
  });

  it("serves from cache when no VERSION file exists", async () => {
    // No VERSION file in dir — the cache should still work normally
    const prime = makeFakeFetch({ tag_name: "v2.38.0" });
    await checkForUpdate({ currentVersion: "2.37.0", projectDir: dir, fetchImpl: prime, env: {} });

    let fetchCalled = false;
    const explode = async () => { fetchCalled = true; throw new Error("should not call fetch"); };
    const out = await checkForUpdate({
      currentVersion: "2.37.0",
      projectDir: dir,
      fetchImpl: explode,
      env: {},
    });
    expect(fetchCalled).toBe(false);
    expect(out.fromCache).toBe(true);
  });
});

// ─── /api/update-status endpoint ───────────────────────────────

describe("/api/update-status", () => {
  let server;
  let baseUrl;
  beforeAll(async () => {
    const app = createExpressApp();
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => { if (server) await new Promise((r) => server.close(r)); });

  it("responds with a JSON envelope (never 5xx on offline check)", async () => {
    // We set PFORGE_NO_UPDATE_CHECK to guarantee no network is touched in CI.
    const prev = process.env.PFORGE_NO_UPDATE_CHECK;
    process.env.PFORGE_NO_UPDATE_CHECK = "1";
    try {
      const res = await fetch(`${baseUrl}/api/update-status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("available");
      expect(typeof body.available).toBe("boolean");
    } finally {
      if (prev === undefined) delete process.env.PFORGE_NO_UPDATE_CHECK;
      else process.env.PFORGE_NO_UPDATE_CHECK = prev;
    }
  });

  // #446 — a check that could not be made used to answer `{ available: false }`, which the dashboard shows as "Up to date".
  it("says a check could not be made, and why, instead of answering as if the install were current", async () => {
    const prev = process.env.PFORGE_NO_UPDATE_CHECK;
    process.env.PFORGE_NO_UPDATE_CHECK = "1";
    try {
      const body = await (await fetch(`${baseUrl}/api/update-status?force=1`)).json();
      expect(body).toMatchObject({ available: false, checkFailed: true, failure: { kind: "suppressed" } });
      expect(body.failure.message).toContain("PFORGE_NO_UPDATE_CHECK");
      expect(typeof body.current).toBe("string");
      // `reason` stays what it always was on this endpoint: a short string, and only when there is no version file.
      expect(body).not.toHaveProperty("reason");
    } finally {
      if (prev === undefined) delete process.env.PFORGE_NO_UPDATE_CHECK;
      else process.env.PFORGE_NO_UPDATE_CHECK = prev;
    }
  });
});

// ─── writeFreshCache (Fix A — self-update invalidates cache) ──────────

describe("writeFreshCache", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pforge-freshcache-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("writes a cache file with the supplied version", () => {
    writeFreshCache(dir, "2.62.0");
    expect(existsSync(cachePath(dir))).toBe(true);
    const saved = JSON.parse(readFileSync(cachePath(dir), "utf-8"));
    expect(saved.latest).toBe("2.62.0");
    expect(saved.checkedAt).toBeTruthy();
    expect(saved.url).toMatch(/v2\.62\.0/);
  });

  it("strips leading v prefix", () => {
    writeFreshCache(dir, "v2.62.0");
    const saved = JSON.parse(readFileSync(cachePath(dir), "utf-8"));
    expect(saved.latest).toBe("2.62.0");
  });

  it("self-update cache is served by checkForUpdate as isNewer=false", async () => {
    writeFreshCache(dir, "2.62.0");
    let fetchCalled = false;
    const explode = async () => { fetchCalled = true; throw new Error("should not hit network"); };
    const out = await checkForUpdate({
      currentVersion: "2.62.0",
      projectDir: dir,
      fetchImpl: explode,
      env: {},
    });
    expect(fetchCalled).toBe(false);
    expect(out).not.toBeNull();
    expect(out.fromCache).toBe(true);
    expect(out.isNewer).toBe(false);
  });

  it("no-ops on missing inputs", () => {
    expect(() => writeFreshCache(null, "2.62.0")).not.toThrow();
    expect(() => writeFreshCache(dir, "")).not.toThrow();
    expect(() => writeFreshCache(dir, "garbage")).not.toThrow();
    expect(existsSync(cachePath(dir))).toBe(false);
  });
});

// ─── self-update wrapper fallback shape (meta-bug: silent "Already current") ───
//
// Regression for the case where a client on v2.66.0 ran `pforge self-update`,
// the GitHub API check failed (rate limit / timeout / network), and the
// wrapper script silently printed "Already current (v2.66.0)" because its
// fallback collapsed `null` into `{ isNewer: false }`. pforge.sh and pforge.ps1
// now print what runSelfUpdateCheck returns, and a failed check is
// `{ checkFailed: true, reason }` so the shell/powershell sides can branch.
// These tests call the function the shells call, not a copy of what it does.

describe("self-update wrapper fallback", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pforge-selfupdate-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const run = (options) => runSelfUpdateCheck({ currentVersion: "2.66.0", projectDir: dir, env: {}, ...options });

  it("emits checkFailed marker when the request cannot be made (network error)", async () => {
    const boom = async () => { throw new Error("ECONNREFUSED"); };
    const shape = await run({ fetchImpl: boom });
    expect(shape.checkFailed).toBe(true);
    expect(shape.isNewer).toBeUndefined();
    expect(shape.reason.kind).toBe("network");
  });

  it("emits checkFailed marker when GitHub returns HTTP 403 (rate limit)", async () => {
    const shape = await run({ fetchImpl: reply(403, { headers: { "x-ratelimit-remaining": 0 } }) });
    expect(shape).toMatchObject({ checkFailed: true, reason: { kind: "rate-limited" } });
    expect(shape.isNewer).toBeUndefined();
  });

  it("emits checkFailed marker for a 403 with no sign of a rate limit, as before, with the status as the reason", async () => {
    const shape = await run({ fetchImpl: makeFakeFetch({}, { status: 403 }) });
    expect(shape).toMatchObject({ checkFailed: true, reason: { kind: "http", status: 403 } });
  });

  it("emits checkFailed marker for a suppressed check, and says why", async () => {
    const shape = await run({ fetchImpl: makeFakeFetch({ tag_name: "v9.9.9" }), env: { PFORGE_NO_UPDATE_CHECK: "1" } });
    expect(shape).toMatchObject({ checkFailed: true, reason: { kind: "suppressed" } });
    expect(shape.reason.message).toContain("PFORGE_NO_UPDATE_CHECK");
  });

  it("emits checkFailed marker when the installed version is unknown, because there is nothing to compare with", async () => {
    const shape = await run({ currentVersion: "", fetchImpl: makeFakeFetch({ tag_name: "v9.9.9" }) });
    expect(shape).toMatchObject({ checkFailed: true, reason: { kind: "no-version" } });
  });

  it("passes through a successful check unchanged (no checkFailed marker)", async () => {
    const ok = makeFakeFetch({ tag_name: "v2.80.1" });
    const shape = await run({ fetchImpl: ok });
    expect(shape.checkFailed).toBeUndefined();
    expect(shape.isNewer).toBe(true);
    expect(shape.latest).toBe("2.80.1");
    expect(shape.fromCache).toBe(false);
    expect(shape).not.toHaveProperty("liveCheckFailed");
    expect(shape).not.toHaveProperty("notice");
  });

  it("always asks GitHub, as `pforge self-update` promises, even when the cache is fresh", async () => {
    mkdirSync(resolve(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(dir), JSON.stringify({ latest: "2.0.0", checkedAt: new Date().toISOString() }), "utf-8");
    const shape = await run({ fetchImpl: makeFakeFetch({ tag_name: "v2.80.1" }) });
    expect(shape).toMatchObject({ latest: "2.80.1", fromCache: false });
  });

  it("answers from a fresh cache entry when GitHub cannot be asked, and carries what to tell the user", async () => {
    const checkedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    mkdirSync(resolve(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(dir), JSON.stringify({ latest: "2.80.1", checkedAt, url: "https://example.test/r" }), "utf-8");
    const shape = await run({ fetchImpl: reply(403, { headers: { "x-ratelimit-remaining": 0, "x-ratelimit-reset": 1793264400 } }) });
    expect(shape).toMatchObject({ latest: "2.80.1", isNewer: true, fromCache: true, liveCheckFailed: { kind: "rate-limited" } });
    expect(shape).not.toHaveProperty("checkFailed");
    expect(shape.notice).toBe(`Using the release check made at ${checkedAt.slice(0, 16).replace("T", " ")} UTC instead.`);
  });

  it("survives being written out as JSON and read back, which is how the shells receive it", async () => {
    const failed = await run({ fetchImpl: reply(403, { headers: { "x-ratelimit-remaining": 0, "x-ratelimit-reset": 1793264400 } }) });
    expect(JSON.parse(JSON.stringify(failed))).toEqual(failed);
    const ok = await run({ fetchImpl: makeFakeFetch({ tag_name: "v2.80.1" }) });
    expect(JSON.parse(JSON.stringify(ok))).toEqual(ok);
  });
});

// ─── #446: a check that cannot reach GitHub says why, and does not throw away what it already knew ───
//
// `pforge self-update` forces its check. With the address's 60 unauthenticated requests an hour used up it got a 403,
// reported "unreachable, rate-limited, or timed out", ignored a good cache entry from an hour before, and sent no
// token even when the user had set one. checkForUpdate keeps its contract (a payload, or null); checkForUpdateWithReason
// is the same check with the answer to "why not".

describe("update check authentication (#446)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pforge-update-auth-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const ok = () => makeResponse(200, { body: { tag_name: "v3.35.5" } });

  it.each([
    ["GITHUB_TOKEN", { GITHUB_TOKEN: "ghp_one" }, "token ghp_one"],
    ["GH_TOKEN", { GH_TOKEN: "ghp_two" }, "token ghp_two"],
  ])("sends %s as the authorization header", async (_name, env, expected) => {
    const { fetchImpl, requests } = recordingFetch(ok);
    const out = await checkForUpdate({ currentVersion: "3.35.4", projectDir: dir, fetchImpl, env, force: true });
    expect(out.latest).toBe("3.35.5");
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.authorization).toBe(expected);
  });

  it("sends no authorization header when no token is set", async () => {
    const { fetchImpl, requests } = recordingFetch(ok);
    await checkForUpdate({ currentVersion: "3.35.4", projectDir: dir, fetchImpl, env: {}, force: true });
    expect(requests[0].headers).not.toHaveProperty("authorization");
    expect(requests[0].headers).toMatchObject({ accept: "application/vnd.github+json", "user-agent": "plan-forge-update-check" });
  });

  it("repeats the request without the token when GitHub rejects it, so a stale token does not make the check worse", async () => {
    const { fetchImpl, requests } = recordingFetch((headers) => (headers.authorization ? makeResponse(401, { body: { message: "Bad credentials" } }) : ok()));
    const out = await checkForUpdate({ currentVersion: "3.35.4", projectDir: dir, fetchImpl, env: { GITHUB_TOKEN: "ghp_stale" }, force: true });
    expect(out.latest).toBe("3.35.5");
    expect(requests.map((r) => Boolean(r.headers.authorization))).toEqual([true, false]);
  });

  it("never writes the token to the cache file", async () => {
    const { fetchImpl } = recordingFetch(ok);
    await checkForUpdate({ currentVersion: "3.35.4", projectDir: dir, fetchImpl, env: { GITHUB_TOKEN: "ghp_secret_value" }, force: true });
    expect(readFileSync(cachePath(dir), "utf-8")).not.toContain("ghp_secret_value");
  });
});

describe("checkForUpdateWithReason (#446)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pforge-update-reason-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const CURRENT = "3.35.4";
  const RESET_EPOCH = 1793264400; // 2026-10-29T09:00:00Z
  const exhausted = () => makeResponse(403, { body: { message: "API rate limit exceeded for 203.0.113.7." }, headers: { "x-ratelimit-limit": 60, "x-ratelimit-remaining": 0, "x-ratelimit-reset": RESET_EPOCH } });
  const write = (payload) => {
    mkdirSync(resolve(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(dir), JSON.stringify(payload), "utf-8");
  };
  const check = (options) => checkForUpdateWithReason({ currentVersion: CURRENT, projectDir: dir, force: true, env: {}, ...options });

  it("returns the payload and no reason for a check that worked", async () => {
    const out = await check({ fetchImpl: reply(200, { body: { tag_name: "v3.35.5" } }) });
    expect(out.reason).toBeNull();
    expect(out.result).toMatchObject({ latest: "3.35.5", isNewer: true, fromCache: false });
  });

  it("reports an address whose quota is used up as rate-limited, with when it resets and whether a token was sent", async () => {
    const out = await check({ fetchImpl: exhausted });
    expect(out.result).toBeNull();
    expect(out.reason).toMatchObject({ kind: "rate-limited", status: 403, authenticated: false, limit: 60, resetAt: new Date(RESET_EPOCH * 1000).toISOString() });
  });

  it("reports the same 403 as rate-limited when a token was sent, and says so, because then a token is no cure", async () => {
    const out = await check({ fetchImpl: exhausted, env: { GITHUB_TOKEN: "ghp_one" } });
    expect(out.reason).toMatchObject({ kind: "rate-limited", authenticated: true });
  });

  it.each([429, 403])("reports a %i with no quota left as rate-limited", async (status) => {
    const out = await check({ fetchImpl: reply(status, { headers: { "x-ratelimit-remaining": 0, "x-ratelimit-reset": RESET_EPOCH } }) });
    expect(out.reason.kind).toBe("rate-limited");
  });

  it("reports a secondary rate limit, which has a Retry-After and no quota header, as rate-limited", async () => {
    const out = await check({ fetchImpl: reply(403, { body: { message: "You have exceeded a secondary rate limit." }, headers: { "retry-after": 30 } }) });
    expect(out.reason.kind).toBe("rate-limited");
    expect(out.reason.retryAfterSeconds).toBe(30);
  });

  it("does not call a 403 that is not about a rate limit one", async () => {
    const out = await check({ fetchImpl: reply(403, { body: { message: "Resource not accessible by integration" } }) });
    expect(out.reason).toMatchObject({ kind: "http", status: 403 });
  });

  it("answers from the repeat without the token when GitHub rejects the one it was sent", async () => {
    const { fetchImpl } = recordingFetch((headers) => (headers.authorization ? makeResponse(401) : makeResponse(200, { body: { tag_name: "v3.35.5" } })));
    const out = await check({ fetchImpl, env: { GH_TOKEN: "ghp_stale" } });
    expect(out.result.latest).toBe("3.35.5");
    expect(out.reason).toBeNull();
  });

  it("remembers that the token was rejected when the repeat without it is rate-limited, because then the cure is a new token, not 'a token'", async () => {
    const { fetchImpl } = recordingFetch((headers) => (headers.authorization ? makeResponse(401) : exhausted()));
    const out = await check({ fetchImpl, env: { GH_TOKEN: "ghp_stale" } });
    expect(out.reason).toMatchObject({ kind: "rate-limited", authenticated: false, tokenRejected: true });
  });

  it("does not say a token was rejected when none was sent", async () => {
    const out = await check({ fetchImpl: exhausted });
    expect(out.reason.tokenRejected).toBeFalsy();
  });

  it("reports an HTTP error as http, with its status", async () => {
    const out = await check({ fetchImpl: reply(500) });
    expect(out.reason).toMatchObject({ kind: "http", status: 500 });
  });

  it("tolerates a failed response with neither a status nor headers, as a bare test double or an odd proxy gives", async () => {
    const out = await check({ fetchImpl: async () => ({ ok: false }) });
    expect(out.result).toBeNull();
    expect(out.reason.kind).toBe("http");
    expect(out.reason.message).toMatch(/GitHub/);
    expect(out.reason.message).not.toContain("undefined");
    expect(out.reason.status).toBeNull();
  });

  it("tolerates no response at all", async () => {
    const out = await check({ fetchImpl: async () => undefined });
    expect(out.result).toBeNull();
    expect(out.reason.kind).toBe("http");
  });

  it("reports an answer that is not JSON as malformed, not as a network failure", async () => {
    const notJson = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new SyntaxError("Unexpected token '<'"); } });
    const out = await check({ fetchImpl: notJson });
    expect(out.result).toBeNull();
    expect(out.reason.kind).toBe("malformed");
  });

  it("reports a Node.js with no fetch as a network failure, and says so", async () => {
    const out = await check({ fetchImpl: null });
    expect(out.result).toBeNull();
    expect(out.reason.kind).toBe("network");
    expect(out.reason.message).toContain("no fetch");
  });

  it("reports a request that cannot be made as network, and one that runs out of time as timeout", async () => {
    const network = await check({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
    expect(network.reason.kind).toBe("network");
    expect(network.reason.message).toContain("fetch failed");
    const aborted = await check({ fetchImpl: async () => { const e = new Error("The operation was aborted"); e.name = "AbortError"; throw e; } });
    expect(aborted.reason.kind).toBe("timeout");
  });

  it("says why a network request failed when the cause is nested, as fetch reports a DNS failure", async () => {
    const error = new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.github.com") });
    const { reason } = await check({ fetchImpl: async () => { throw error; } });
    expect(reason.message).toContain("getaddrinfo ENOTFOUND api.github.com");
  });

  it("reports a reply that holds no release as malformed", async () => {
    const out = await check({ fetchImpl: reply(200, { body: { not_a_release: true } }) });
    expect(out.reason.kind).toBe("malformed");
  });

  it("reports a suppressed check as suppressed, so a caller does not call it a failure of GitHub", async () => {
    const out = await check({ fetchImpl: reply(200), env: { PFORGE_NO_UPDATE_CHECK: "1" } });
    expect(out.result).toBeNull();
    expect(out.reason.kind).toBe("suppressed");
  });

  it("does not ask GitHub at all for a suppressed check", async () => {
    const { fetchImpl, requests } = recordingFetch(() => makeResponse(200, { body: { tag_name: "v3.35.5" } }));
    await check({ fetchImpl, env: { PFORGE_NO_UPDATE_CHECK: "true" } });
    expect(requests).toHaveLength(0);
  });

  it("reports an unknown installed version as no-version, because there is nothing to compare a release with", async () => {
    const out = await check({ currentVersion: "", fetchImpl: reply(200, { body: { tag_name: "v3.35.5" } }) });
    expect(out.result).toBeNull();
    expect(out.reason.kind).toBe("no-version");
  });

  describe("what the reason tells the user", () => {
    it("says a rate limit with no token is cured by GITHUB_TOKEN or GH_TOKEN, and when it resets", async () => {
      const { reason } = await check({ fetchImpl: exhausted });
      expect(reason.message).toMatch(/rate limit/i);
      expect(reason.message).toContain("GITHUB_TOKEN");
      expect(reason.message).toContain("GH_TOKEN");
      expect(reason.message).toContain("09:00 UTC");
    });

    it("does not tell a user whose token was accepted to set one", async () => {
      const { reason } = await check({ fetchImpl: exhausted, env: { GITHUB_TOKEN: "ghp_one" } });
      expect(reason.message).toMatch(/rate limit/i);
      expect(reason.message).not.toMatch(/GITHUB_TOKEN|GH_TOKEN/);
    });

    // GitHub documents a limit that reports quota left and gives no Retry-After as "wait at least one minute". The hourly
    // quota is not what ran out, so the text must not say it is or offer a token for it.
    it("words a 429 that reports quota left, and gives no Retry-After, as GitHub's minimum wait, not as an hourly quota used up", async () => {
      const limited = reply(429, { headers: { "x-ratelimit-limit": 60, "x-ratelimit-remaining": 25, "x-ratelimit-reset": RESET_EPOCH } });
      for (const env of [{}, { GITHUB_TOKEN: "ghp_one" }]) {
        const { reason } = await check({ fetchImpl: limited, env });
        expect(reason).toMatchObject({ kind: "rate-limited", quotaSpent: false, resetAt: null, retryAfterSeconds: null });
        expect(reason.message).toMatch(/wait at least a minute/);
        expect(reason.message).not.toMatch(/used up|requests an hour|until|09:00|GITHUB_TOKEN|GH_TOKEN/);
      }
    });

    // The variable is skipped, not sent, and not echoed: the message names it and never carries its value.
    describe("when a token variable is set to a value that cannot be a token", () => {
      const PASTED = "Authorization: token ghp_REVIEWSECRET0123456789";

      it("says which variable was not sent, instead of telling the user to set it, and never carries the value", async () => {
        const { reason } = await check({ fetchImpl: exhausted, env: { GITHUB_TOKEN: PASTED } });
        expect(reason.kind).toBe("rate-limited");
        expect(reason.message).toContain("GITHUB_TOKEN is set to a value that cannot be a token");
        expect(reason.message).toContain("09:00 UTC");
        expect(reason.message).not.toMatch(/Set GITHUB_TOKEN or GH_TOKEN/);
        expect(JSON.stringify(reason)).not.toContain("REVIEWSECRET");
        expect(JSON.stringify(reason)).not.toContain("Authorization");
      });

      it("names the other variable when that is the one", async () => {
        const { reason } = await check({ fetchImpl: exhausted, env: { GH_TOKEN: "ghp_abc def" } });
        expect(reason.message).toContain("GH_TOKEN is set to a value that cannot be a token");
      });

      it("says nothing of it when a usable token was sent", async () => {
        const { reason } = await check({ fetchImpl: exhausted, env: { GITHUB_TOKEN: PASTED, GH_TOKEN: "ghp_one" } });
        expect(reason.message).not.toContain("cannot be a token");
      });

      it("says nothing of it when the check did not run into a rate limit", async () => {
        const { reason } = await check({ fetchImpl: reply(500), env: { GITHUB_TOKEN: PASTED } });
        expect(reason.message).not.toContain("cannot be a token");
      });
    });

    // GitHub sends its quota headers on every response, a secondary limit's too, so the reset time that comes with a
    // Retry-After is the hourly quota's. Waiting for it would be waiting for an hour when GitHub asked for a minute.
    it("words a secondary limit as the wait GitHub asked for, though its quota headers say there is quota left", async () => {
      const secondary = reply(403, {
        body: { message: "You have exceeded a secondary rate limit." },
        headers: { "retry-after": 60, "x-ratelimit-limit": 5000, "x-ratelimit-remaining": 4800, "x-ratelimit-reset": RESET_EPOCH },
      });
      const { reason } = await check({ fetchImpl: secondary });
      expect(reason).toMatchObject({ kind: "rate-limited", retryAfterSeconds: 60, resetAt: null });
      expect(reason.message).toMatch(/wait about 1 minute/);
      expect(reason.message).not.toMatch(/used up|until|09:00|GITHUB_TOKEN|GH_TOKEN/);
    });

    it("says the token was rejected when it was, and that the limit is the anonymous one", async () => {
      const { fetchImpl } = recordingFetch((headers) => (headers.authorization ? makeResponse(401) : exhausted()));
      const { reason } = await check({ fetchImpl, env: { GH_TOKEN: "ghp_stale" } });
      expect(reason.message).toMatch(/rejected/i);
    });

    it("tells a dead network from a rate limit, so the user does not wait for a limit that is not there", async () => {
      const { reason } = await check({ fetchImpl: async () => { throw new TypeError("fetch failed"); } });
      expect(reason.message).toMatch(/could not be reached/i);
      expect(reason.message).not.toMatch(/rate limit/i);
    });

    it("says how long it waited when it ran out of time", async () => {
      const { reason } = await check({ fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; } });
      expect(reason.message).toMatch(/did not answer within 4 seconds/i);
    });

    it("says an HTTP error's status, and that it is GitHub's answer", async () => {
      const { reason } = await check({ fetchImpl: reply(502) });
      expect(reason.message).toContain("HTTP 502");
    });

    it("says a reply with no release in it is not a release", async () => {
      const { reason } = await check({ fetchImpl: reply(200, { body: {} }) });
      expect(reason.message).toMatch(/did not name a release/i);
    });

    it("says an update check that was turned off was turned off, and by what", async () => {
      const { reason } = await check({ fetchImpl: reply(200), env: { PFORGE_NO_UPDATE_CHECK: "1" } });
      expect(reason.message).toContain("PFORGE_NO_UPDATE_CHECK");
    });

    it("never carries the token, whatever went wrong", async () => {
      const env = { GITHUB_TOKEN: "ghp_secret_value_1234567890" };
      const failures = [
        exhausted,
        reply(500),
        reply(200, { body: {} }),
        async () => { throw new TypeError("fetch failed"); },
        async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
      ];
      for (const fetchImpl of failures) {
        const out = await check({ fetchImpl, env });
        expect(JSON.stringify(out)).not.toContain("ghp_secret_value_1234567890");
      }
    });

    it("never carries the token in the wrapper the shells print from either", async () => {
      const shape = await runSelfUpdateCheck({ currentVersion: CURRENT, projectDir: dir, fetchImpl: exhausted, env: { GH_TOKEN: "ghp_secret_value_1234567890" } });
      expect(JSON.stringify(shape)).not.toContain("ghp_secret_value_1234567890");
    });

    // The real header validation, without a network: a fetch that builds the Headers fetch builds, and throws what fetch
    // throws. fetch quotes the whole header in that error, so a token it rejects must never reach it.
    describe("with a token that is not a valid header value", () => {
      const SECRET = "ghp_REVIEWSECRET0123456789";
      const validatingFetch = (answer) => async (_url, init) => {
        new Headers(init.headers);
        return answer;
      };
      const ok = () => makeResponse(200, { body: { tag_name: "v3.35.5" } });

      it.each([
        ["a newline", `${SECRET}\nabcdef`],
        ["a carriage return", `${SECRET}\rabcdef`],
        ["a NUL", `${SECRET}\u0000abcdef`],
        ["a space", `${SECRET} abcdef`],
      ])("goes on without it, and does not print it, when it has %s", async (_what, token) => {
        const out = await check({ fetchImpl: validatingFetch(ok()), env: { GITHUB_TOKEN: token } });
        expect(out.reason).toBeNull();
        expect(out.result).toMatchObject({ latest: "3.35.5", fromCache: false });
        expect(JSON.stringify(out)).not.toContain(SECRET);
      });

      it("sends the request without an authorization header", async () => {
        const seen = [];
        const fetchImpl = async (_url, init) => { new Headers(init.headers); seen.push(init.headers); return ok(); };
        await check({ fetchImpl, env: { GH_TOKEN: `${SECRET}\nabcdef` } });
        expect(seen).toHaveLength(1);
        expect(seen[0]).not.toHaveProperty("authorization");
      });

      it("uses the other variable when it holds a token that can be sent", async () => {
        const seen = [];
        const fetchImpl = async (_url, init) => { new Headers(init.headers); seen.push(init.headers); return ok(); };
        await check({ fetchImpl, env: { GITHUB_TOKEN: `${SECRET}\nabcdef`, GH_TOKEN: "ghp_good" } });
        expect(seen[0].authorization).toBe("token ghp_good");
      });
    });
  });

  describe("a forced check that cannot reach GitHub", () => {
    const fresh = (overrides = {}) => ({ latest: "3.35.5", checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), url: "https://example.test/v3.35.5", publishedAt: null, ...overrides });

    it("answers from a cache entry that is inside the TTL, and says it did", async () => {
      write(fresh());
      const out = await check({ fetchImpl: exhausted });
      expect(out.result).toMatchObject({ latest: "3.35.5", isNewer: true, fromCache: true });
      expect(out.reason).toMatchObject({ kind: "rate-limited" });
    });

    it("tells the caller how old the entry it answered from is", async () => {
      const checkedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
      write(fresh({ checkedAt }));
      const out = await check({ fetchImpl: reply(500) });
      expect(out.result.checkedAt).toBe(checkedAt);
    });

    it("computes isNewer for the version it was asked about, not the one the entry was written for", async () => {
      write(fresh({ current: "3.0.0", isNewer: true }));
      const out = await check({ currentVersion: "3.35.5", fetchImpl: reply(500) });
      expect(out.result).toMatchObject({ current: "3.35.5", latest: "3.35.5", isNewer: false });
    });

    it("does not answer from an entry past the TTL, so a failed check is not mistaken for a current one", async () => {
      write(fresh({ checkedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }));
      const out = await check({ fetchImpl: exhausted });
      expect(out.result).toBeNull();
      expect(out.reason.kind).toBe("rate-limited");
    });

    it("does not answer from an entry that has no time or no version", async () => {
      write({ latest: "3.35.5" });
      expect((await check({ fetchImpl: exhausted })).result).toBeNull();
      write({ checkedAt: new Date().toISOString() });
      expect((await check({ fetchImpl: exhausted })).result).toBeNull();
    });

    it("does not answer from an entry whose time is not a date", async () => {
      for (const checkedAt of ["yesterday", "2026-13-45T99:99:99Z", "", "NaN", {}, []]) {
        write(fresh({ checkedAt }));
        expect((await check({ fetchImpl: exhausted })).result, `checkedAt: ${JSON.stringify(checkedAt)}`).toBeNull();
      }
    });

    it("does not answer from an entry whose version is not a release version", async () => {
      for (const latest of ["garbage", "3", "3.35", "", null, 335]) {
        write({ latest, checkedAt: new Date().toISOString() });
        expect((await check({ fetchImpl: exhausted })).result, `latest: ${JSON.stringify(latest)}`).toBeNull();
      }
    });

    it("does not answer from an entry that says it was checked in the future", async () => {
      write(fresh({ checkedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }));
      expect((await check({ fetchImpl: exhausted })).result).toBeNull();
    });

    it("does not answer from the cache when the VERSION file was changed after it was written", async () => {
      write(fresh());
      const later = new Date(Date.now() + 60 * 1000);
      writeFileSync(join(dir, "VERSION"), "3.35.5\n", "utf-8");
      utimesSync(join(dir, "VERSION"), later, later);
      expect((await check({ fetchImpl: exhausted })).result).toBeNull();
    });

    it("leaves the cache entry as it was, so one failure does not renew an old answer", async () => {
      const entry = fresh();
      write(entry);
      await check({ fetchImpl: exhausted });
      expect(JSON.parse(readFileSync(cachePath(dir), "utf-8"))).toEqual(entry);
    });

    it("still returns null from checkForUpdate for a failed check with no cache, as before", async () => {
      const out = await checkForUpdate({ currentVersion: CURRENT, projectDir: dir, fetchImpl: exhausted, env: {}, force: true });
      expect(out).toBeNull();
    });

    it("answers checkForUpdate from the cache too, because it is the same check", async () => {
      write(fresh());
      const out = await checkForUpdate({ currentVersion: CURRENT, projectDir: dir, fetchImpl: exhausted, env: {}, force: true });
      expect(out).toMatchObject({ latest: "3.35.5", fromCache: true });
    });

    // What `pforge update` leaves in the cache after it installs a release (writeFreshCache) is "the version I just
    // installed", not an answer from GitHub. After a pinned older tag, or from a sibling clone at a -dev version, it can
    // say "current" when GitHub holds a newer release, or name a version that has no tag.
    describe("an entry the installer wrote", () => {
      it("is marked as the installer's, so it can be told from what GitHub answered", () => {
        writeFreshCache(dir, "3.35.4");
        expect(JSON.parse(readFileSync(cachePath(dir), "utf-8"))).toMatchObject({ latest: "3.35.4", source: "install" });
      });

      it("is not used as the answer of a forced check that GitHub does not answer", async () => {
        writeFreshCache(dir, CURRENT);
        const out = await check({ fetchImpl: exhausted });
        expect(out.result).toBeNull();
        expect(out.reason.kind).toBe("rate-limited");
      });

      it("makes a rate-limited `pforge self-update` stop, not say 'Already current'", async () => {
        writeFreshCache(dir, CURRENT);
        const shape = await runSelfUpdateCheck({ currentVersion: CURRENT, projectDir: dir, fetchImpl: exhausted, env: {} });
        expect(shape).toMatchObject({ checkFailed: true, reason: { kind: "rate-limited" } });
        expect(shape).not.toHaveProperty("latest");
        expect(shape).not.toHaveProperty("notice");
      });

      it("is still what an unforced check answers from, which is what it is written for", async () => {
        writeFreshCache(dir, CURRENT);
        const { fetchImpl, requests } = recordingFetch(() => makeResponse(200, { body: { tag_name: "v9.9.9" } }));
        const out = await checkForUpdateWithReason({ currentVersion: CURRENT, projectDir: dir, force: false, env: {}, fetchImpl });
        expect(out.result).toMatchObject({ latest: CURRENT, isNewer: false, fromCache: true });
        expect(requests).toHaveLength(0);
      });
    });

    it.each(["3.36.0-dev", "3.36.0-rc.1", "3.36.0-beta.4"])("does not answer from an entry whose version %s has no release tag to install", async (latest) => {
      write(fresh({ latest }));
      const out = await check({ fetchImpl: exhausted });
      expect(out.result).toBeNull();
    });

    it("still answers from an entry GitHub's answer left, which carries no marker, as every entry before this one did", async () => {
      write({ latest: "3.35.5", checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), url: "https://example.test/v3.35.5", publishedAt: "2026-10-28T12:00:00Z", current: "3.35.4", isNewer: true, fromCache: false });
      const out = await check({ fetchImpl: exhausted });
      expect(out.result).toMatchObject({ latest: "3.35.5", isNewer: true, fromCache: true });
    });

    it("answers from the entry a successful check wrote, on the next forced check that cannot reach GitHub", async () => {
      const first = await check({ fetchImpl: reply(200, { body: { tag_name: "v3.35.5" } }) });
      expect(first.result).toMatchObject({ latest: "3.35.5", fromCache: false });
      const second = await check({ fetchImpl: exhausted });
      expect(second.result).toMatchObject({ latest: "3.35.5", isNewer: true, fromCache: true });
      expect(second.reason.kind).toBe("rate-limited");
    });
  });
});

// ─── detectCorruptInstall (v2.53.1 self-heal) ───────────────────

describe("detectCorruptInstall", () => {
  it("flags the known v2.50.0-dev corrupt tarball state", () => {
    const r = detectCorruptInstall({ currentVersion: "2.50.0-dev", latestVersion: "2.53.1" });
    expect(r.isCorrupt).toBe(true);
    expect(r.recommendedAction).toMatch(/pforge self-update/i);
  });

  it("flags v2.51.0-dev and v2.52.0-dev (broken tarball cohort)", () => {
    expect(detectCorruptInstall({ currentVersion: "2.51.0-dev", latestVersion: "2.53.1" }).isCorrupt).toBe(true);
    expect(detectCorruptInstall({ currentVersion: "2.52.0-dev", latestVersion: "2.53.1" }).isCorrupt).toBe(true);
  });

  it("flags current-dev-of-shipped version (e.g. 2.53.1-dev while 2.53.1 is released)", () => {
    const r = detectCorruptInstall({ currentVersion: "2.53.1-dev", latestVersion: "2.53.1" });
    expect(r.isCorrupt).toBe(true);
  });

  it("does NOT flag a genuine dev branch ahead of latest (2.54.0-dev > v2.53.1)", () => {
    const r = detectCorruptInstall({ currentVersion: "2.54.0-dev", latestVersion: "2.53.1" });
    expect(r.isCorrupt).toBe(false);
  });

  it("does NOT flag clean released versions", () => {
    expect(detectCorruptInstall({ currentVersion: "2.53.0", latestVersion: "2.53.1" }).isCorrupt).toBe(false);
    expect(detectCorruptInstall({ currentVersion: "2.53.1", latestVersion: "2.53.1" }).isCorrupt).toBe(false);
  });

  it("returns isCorrupt=false when latest is unknown (offline)", () => {
    const r = detectCorruptInstall({ currentVersion: "2.50.0-dev", latestVersion: null });
    expect(r.isCorrupt).toBe(false);
  });

  it("tolerates missing inputs without throwing", () => {
    expect(detectCorruptInstall({}).isCorrupt).toBe(false);
    expect(detectCorruptInstall({ currentVersion: "" }).isCorrupt).toBe(false);
    expect(detectCorruptInstall({ currentVersion: "garbage", latestVersion: "2.53.1" }).isCorrupt).toBe(false);
  });

  it("strips leading 'v' prefix on latest", () => {
    const r = detectCorruptInstall({ currentVersion: "2.50.0-dev", latestVersion: "v2.53.1" });
    expect(r.isCorrupt).toBe(true);
  });
});
