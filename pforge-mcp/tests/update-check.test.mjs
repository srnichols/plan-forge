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
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { cachePath, compareVersions, checkForUpdate } from "../update-check.mjs";
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
});
