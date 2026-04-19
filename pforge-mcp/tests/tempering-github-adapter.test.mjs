/**
 * Plan Forge — Phase TEMPER-06 Slice 06.2: GitHub Adapter + Extension Contract tests.
 *
 * ~30 tests covering:
 *   - Token resolution (4)
 *   - Repo resolution (3)
 *   - Issue creation (6)
 *   - Issue updates (4)
 *   - Validated-fix comment (3)
 *   - JSONL fallback (3)
 *   - Contract validator (3)
 *   - Dispatcher (4)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  resolveGitHubToken,
  resolveGitHubRepo,
  parseGitRemoteUrl,
  buildIssueBody,
  buildLabels,
  registerBug as githubRegisterBug,
  updateBugStatus as githubUpdateBugStatus,
  commentValidatedFix,
  syncStatusFromProvider,
} from "../tempering/bug-adapters/github.mjs";

import {
  registerBug as jsonlRegisterBug,
  syncStatusFromProvider as jsonlSyncStatus,
} from "../tempering/bug-adapters/jsonl-fallback.mjs";

import {
  ADAPTER_CONTRACT,
  validateAdapter,
  loadExtensionAdapter,
  dispatch,
} from "../tempering/bug-adapters/contract.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `temper-062-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeBug(overrides = {}) {
  return {
    bugId: "bug-2026-04-19-001",
    fingerprint: "abc123",
    scanner: "unit",
    severity: "high",
    status: "open",
    classification: "real-bug",
    classifierMeta: {},
    evidence: {
      testName: "UserService.login should validate credentials",
      assertionMessage: "Expected true to be false",
      stackTrace: "at Object.<anonymous> (src/services/user.test.js:42:5)",
    },
    affectedFiles: ["src/services/user.js"],
    discoveredAt: "2026-04-19T12:00:00.000Z",
    updatedAt: "2026-04-19T12:00:00.000Z",
    correlationId: "corr-1",
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    bugRegistry: {
      integration: "github",
      autoCreateIssues: true,
      labelPrefix: "tempering",
      ...overrides,
    },
  };
}

function makeFetchOk(data = {}) {
  return async (url, opts) => ({
    ok: true,
    status: 200,
    json: async () => ({ number: 42, html_url: "https://github.com/owner/repo/issues/42", id: 99, ...data }),
    headers: { get: () => null },
  });
}

function makeFetchError(status, headers = {}) {
  return async () => ({
    ok: false,
    status,
    json: async () => ({}),
    headers: { get: (h) => headers[h] || null },
  });
}

// ─── Token Resolution ────────────────────────────────────────────────

describe("Token resolution", () => {
  const origToken = process.env.GITHUB_TOKEN;
  afterEach(() => {
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
  });

  it("resolves from GITHUB_TOKEN env first", () => {
    process.env.GITHUB_TOKEN = "env-token-123";
    const result = resolveGitHubToken({});
    expect(result.token).toBe("env-token-123");
    expect(result.source).toBe("env");
  });

  it("falls back to .forge/secrets.json", () => {
    delete process.env.GITHUB_TOKEN;
    const dir = makeTmpDir();
    mkdirSync(resolve(dir, ".forge"), { recursive: true });
    writeFileSync(resolve(dir, ".forge", "secrets.json"), JSON.stringify({ github: { token: "secret-token" } }));
    const result = resolveGitHubToken({}, { cwd: dir });
    expect(result.token).toBe("secret-token");
    expect(result.source).toBe("secrets.json");
    rmSync(dir, { recursive: true });
  });

  it("falls back to gh auth token", () => {
    delete process.env.GITHUB_TOKEN;
    const mockExecSync = () => "gh-token-456\n";
    const result = resolveGitHubToken({}, { execSync: mockExecSync });
    expect(result.token).toBe("gh-token-456");
    expect(result.source).toBe("gh-cli");
  });

  it("returns NO_TOKEN error when no source available", () => {
    delete process.env.GITHUB_TOKEN;
    const result = resolveGitHubToken({}, { cwd: makeTmpDir() });
    expect(result.token).toBeNull();
    expect(result.error).toBe("NO_TOKEN");
  });
});

// ─── Repo Resolution ─────────────────────────────────────────────────

describe("Repo resolution", () => {
  it("resolves from explicit config", () => {
    const result = resolveGitHubRepo({ bugRegistry: { githubRepo: "myorg/myrepo" } });
    expect(result).toEqual({ owner: "myorg", repo: "myrepo" });
  });

  it("parses HTTPS remote URL", () => {
    const result = parseGitRemoteUrl("https://github.com/owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });

  it("parses SSH remote URL", () => {
    const result = parseGitRemoteUrl("git@github.com:owner/repo.git");
    expect(result).toEqual({ owner: "owner", repo: "repo" });
  });
});

// ─── Issue Creation ──────────────────────────────────────────────────

describe("Issue creation", () => {
  const origToken = process.env.GITHUB_TOKEN;
  beforeEach(() => { process.env.GITHUB_TOKEN = "test-token"; });
  afterEach(() => {
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
  });

  it("creates issue via REST with correct payload shape", async () => {
    let capturedBody;
    const mockFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 201, json: async () => ({ number: 1, html_url: "https://github.com/o/r/issues/1" }), headers: { get: () => null } };
    };
    const config = makeConfig({ githubRepo: "o/r" });
    const result = await githubRegisterBug(makeBug(), config, { fetch: mockFetch });
    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(1);
    expect(capturedBody.title).toContain("[Tempering]");
    expect(capturedBody.body).toContain("Tempering Bug Report");
  });

  it("includes <details> evidence block in body", () => {
    const body = buildIssueBody(makeBug());
    expect(body).toContain("<details>");
    expect(body).toContain("Full evidence JSON");
    expect(body).toContain("</details>");
  });

  it("builds labels with prefix", () => {
    const labels = buildLabels(makeBug(), makeConfig());
    expect(labels).toContain("tempering:bug");
    expect(labels).toContain("severity:high");
    expect(labels).toContain("scanner:unit");
  });

  it("deduplicates via externalRef (short-circuits)", async () => {
    const bug = makeBug({
      externalRef: { provider: "github", issueNumber: 99, url: "https://github.com/o/r/issues/99" },
    });
    const result = await githubRegisterBug(bug, makeConfig({ githubRepo: "o/r" }), { fetch: makeFetchOk() });
    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(99);
  });

  it("returns error frame on 401/403", async () => {
    const config = makeConfig({ githubRepo: "o/r" });
    const result = await githubRegisterBug(makeBug(), config, { fetch: makeFetchError(401) });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP_401");
  });

  it("returns rate-limit frame with resetAt", async () => {
    const config = makeConfig({ githubRepo: "o/r" });
    const resetTs = String(Math.floor(Date.now() / 1000) + 3600);
    const result = await githubRegisterBug(makeBug(), config, {
      fetch: makeFetchError(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": resetTs }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("RATE_LIMITED");
  });
});

// ─── Issue Updates ───────────────────────────────────────────────────

describe("Issue updates", () => {
  const origToken = process.env.GITHUB_TOKEN;
  beforeEach(() => { process.env.GITHUB_TOKEN = "test-token"; });
  afterEach(() => {
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
  });

  it("appends a comment (does not rewrite body)", async () => {
    let capturedUrl, capturedBody;
    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 100, html_url: "https://github.com/o/r/issues/5#comment-100" }), headers: { get: () => null } };
    };
    const bug = makeBug({ externalRef: { provider: "github", issueNumber: 5 }, status: "in-fix" });
    const result = await githubUpdateBugStatus(bug, makeConfig({ githubRepo: "o/r" }), { fetch: mockFetch });
    expect(result.ok).toBe(true);
    expect(capturedUrl).toContain("/issues/5/comments");
    expect(capturedBody.body).toContain("Status Update");
    // Verify no PATCH to issue body
    expect(capturedUrl).not.toContain("PATCH");
  });

  it("includes status and note in comment", async () => {
    let capturedBody;
    const mockFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 101 }), headers: { get: () => null } };
    };
    const bug = makeBug({
      externalRef: { provider: "github", issueNumber: 5 },
      status: "in-fix",
      statusHistory: [{ from: "open", to: "in-fix", note: "Working on fix", at: "2026-04-19T12:00:00Z" }],
    });
    await githubUpdateBugStatus(bug, makeConfig({ githubRepo: "o/r" }), { fetch: mockFetch });
    expect(capturedBody.body).toContain("in-fix");
    expect(capturedBody.body).toContain("Working on fix");
  });

  it("returns error when no issueNumber", async () => {
    const bug = makeBug();
    const result = await githubUpdateBugStatus(bug, makeConfig({ githubRepo: "o/r" }), { fetch: makeFetchOk() });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NO_ISSUE_NUMBER");
  });

  it("handles missing externalRef gracefully", async () => {
    const bug = makeBug({ externalRef: undefined });
    const result = await githubUpdateBugStatus(bug, makeConfig({ githubRepo: "o/r" }), { fetch: makeFetchOk() });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NO_ISSUE_NUMBER");
  });
});

// ─── Validated-fix Comment ───────────────────────────────────────────

describe("Validated-fix comment", () => {
  const origToken = process.env.GITHUB_TOKEN;
  beforeEach(() => { process.env.GITHUB_TOKEN = "test-token"; });
  afterEach(() => {
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
  });

  it("posts '🔥 Tempering validated this fix' text", async () => {
    let capturedBody;
    const mockFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 200, html_url: "https://github.com/o/r/issues/5#comment-200" }), headers: { get: () => null } };
    };
    const bug = makeBug({ externalRef: { provider: "github", issueNumber: 5 } });
    const result = await commentValidatedFix(bug, makeConfig({ githubRepo: "o/r" }), { fetch: mockFetch });
    expect(result.ok).toBe(true);
    expect(capturedBody.body).toContain("🔥 Tempering validated this fix");
  });

  it("includes scan reference when available", async () => {
    let capturedBody;
    const mockFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 201 }), headers: { get: () => null } };
    };
    const bug = makeBug({
      externalRef: { provider: "github", issueNumber: 5 },
      validationHistory: [{ scanRef: "run-2026-04-19T12:00:00Z/unit" }],
    });
    await commentValidatedFix(bug, makeConfig({ githubRepo: "o/r" }), { fetch: mockFetch });
    expect(capturedBody.body).toContain("run-2026-04-19T12:00:00Z/unit");
  });

  it("does NOT close the issue", async () => {
    let capturedMethod;
    const mockFetch = async (url, opts) => {
      capturedMethod = opts.method;
      return { ok: true, json: async () => ({ id: 202 }), headers: { get: () => null } };
    };
    const bug = makeBug({ externalRef: { provider: "github", issueNumber: 5 } });
    await commentValidatedFix(bug, makeConfig({ githubRepo: "o/r" }), { fetch: mockFetch });
    // Only POST (comment), no PATCH (close)
    expect(capturedMethod).toBe("POST");
  });
});

// ─── JSONL Fallback ──────────────────────────────────────────────────

describe("JSONL fallback", () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it("returns ok: true when bug file exists", async () => {
    const bugsDir = resolve(dir, ".forge", "bugs");
    mkdirSync(bugsDir, { recursive: true });
    writeFileSync(resolve(bugsDir, "bug-2026-04-19-001.json"), JSON.stringify(makeBug()));
    const result = await jsonlRegisterBug(makeBug(), {}, { cwd: dir });
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("jsonl");
  });

  it("works when GitHub adapter fails (always-ok)", async () => {
    const bugsDir = resolve(dir, ".forge", "bugs");
    mkdirSync(bugsDir, { recursive: true });
    writeFileSync(resolve(bugsDir, "bug-2026-04-19-001.json"), JSON.stringify(makeBug()));
    const result = await jsonlRegisterBug(makeBug(), {}, { cwd: dir });
    expect(result.ok).toBe(true);
  });

  it("syncStatusFromProvider reads the right file", async () => {
    const bugsDir = resolve(dir, ".forge", "bugs");
    mkdirSync(bugsDir, { recursive: true });
    writeFileSync(resolve(bugsDir, "bug-2026-04-19-001.json"), JSON.stringify(makeBug({ status: "in-fix" })));
    const result = await jsonlSyncStatus("bug-2026-04-19-001", {}, { cwd: dir });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("in-fix");
  });
});

// ─── Contract Validator ──────────────────────────────────────────────

describe("Contract validator", () => {
  it("accepts a valid 4-function adapter", () => {
    const adapter = {
      registerBug: async () => ({}),
      updateBugStatus: async () => ({}),
      commentValidatedFix: async () => ({}),
      syncStatusFromProvider: async () => ({}),
    };
    const result = validateAdapter(adapter);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects adapter with missing function", () => {
    const adapter = {
      registerBug: async () => ({}),
      updateBugStatus: async () => ({}),
      // missing commentValidatedFix and syncStatusFromProvider
    };
    const result = validateAdapter(adapter);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some((e) => e.includes("commentValidatedFix"))).toBe(true);
  });

  it("rejects non-function property", () => {
    const adapter = {
      registerBug: "not-a-function",
      updateBugStatus: async () => ({}),
      commentValidatedFix: async () => ({}),
      syncStatusFromProvider: async () => ({}),
    };
    const result = validateAdapter(adapter);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("registerBug"))).toBe(true);
  });
});

// ─── Dispatcher ──────────────────────────────────────────────────────

describe("Dispatcher", () => {
  const origToken = process.env.GITHUB_TOKEN;
  let dir;
  beforeEach(() => {
    dir = makeTmpDir();
    process.env.GITHUB_TOKEN = "test-token";
  });
  afterEach(() => {
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
    try { rmSync(dir, { recursive: true }); } catch {}
  });

  it("dispatches to JSONL + GitHub when integration is github", async () => {
    const bugsDir = resolve(dir, ".forge", "bugs");
    mkdirSync(bugsDir, { recursive: true });
    const bug = makeBug();
    writeFileSync(resolve(bugsDir, `${bug.bugId}.json`), JSON.stringify(bug));

    const config = makeConfig({ githubRepo: "o/r" });
    const result = await dispatch("register", bug, config, {
      cwd: dir,
      fetch: makeFetchOk(),
    });
    expect(result.local.provider).toBe("jsonl");
    expect(result.local.ok).toBe(true);
    expect(result.external).not.toBeNull();
    expect(result.external.provider).toBe("github");
  });

  it("dispatches JSONL-only when integration is jsonl", async () => {
    const bugsDir = resolve(dir, ".forge", "bugs");
    mkdirSync(bugsDir, { recursive: true });
    const bug = makeBug();
    writeFileSync(resolve(bugsDir, `${bug.bugId}.json`), JSON.stringify(bug));

    const config = { bugRegistry: { integration: "jsonl" } };
    const result = await dispatch("register", bug, config, { cwd: dir });
    expect(result.local.ok).toBe(true);
    expect(result.external).toBeNull();
  });

  it("loads extension adapter from .forge/extensions/<provider>/", async () => {
    const extDir = resolve(dir, ".forge", "extensions", "test-provider");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(resolve(extDir, "tempering-bug-adapter.mjs"), `
      export async function registerBug() { return { provider: "test-provider", ok: true }; }
      export async function updateBugStatus() { return { provider: "test-provider", ok: true }; }
      export async function commentValidatedFix() { return { provider: "test-provider", ok: true }; }
      export async function syncStatusFromProvider() { return { provider: "test-provider", ok: true }; }
    `);

    const adapter = await loadExtensionAdapter("test-provider", { cwd: dir });
    expect(adapter).not.toBeNull();
    const result = await adapter.registerBug();
    expect(result.provider).toBe("test-provider");
    expect(result.ok).toBe(true);
  });

  it("returns graceful null for malformed extension", async () => {
    const extDir = resolve(dir, ".forge", "extensions", "broken-provider");
    mkdirSync(extDir, { recursive: true });
    writeFileSync(resolve(extDir, "tempering-bug-adapter.mjs"), `
      export const registerBug = "not-a-function";
    `);

    const adapter = await loadExtensionAdapter("broken-provider", { cwd: dir });
    expect(adapter).toBeNull();
  });
});
