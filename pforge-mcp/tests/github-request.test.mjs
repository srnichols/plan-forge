/**
 * #446 — one place decides which environment variable carries a GitHub token and how a request sends it, so
 * the update check and the update download cannot disagree about whether a request is authenticated.
 *
 * `pforge self-update` made its check with no token at all, so a machine whose address had used up GitHub's
 * 60 requests an hour could not update even with GITHUB_TOKEN set. GH_TOKEN, which the GitHub CLI reads, was
 * never read anywhere.
 */

import { describe, expect, it, vi } from "vitest";

import { GITHUB_TOKEN_ENV_VARS, describeRateLimit, fetchGitHub, githubApiHeaders, readRateLimit, resolveGitHubToken } from "../github-request.mjs";

const response = (status) => ({ ok: status >= 200 && status < 300, status });

// A response that carries headers, which is what a rate-limit answer is recognised by.
const withHeaders = (status, headers = {}) => {
  const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
  return { ok: status >= 200 && status < 300, status, headers: { get: (name) => lower[name.toLowerCase()] ?? null } };
};

describe("resolveGitHubToken", () => {
  it("reads GITHUB_TOKEN", () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: "ghp_one" })).toBe("ghp_one");
  });

  it("reads GH_TOKEN, which the GitHub CLI uses", () => {
    expect(resolveGitHubToken({ GH_TOKEN: "ghp_two" })).toBe("ghp_two");
  });

  it("prefers GITHUB_TOKEN when both are set", () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: "ghp_one", GH_TOKEN: "ghp_two" })).toBe("ghp_one");
  });

  it("falls through an empty or blank GITHUB_TOKEN to GH_TOKEN", () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: "", GH_TOKEN: "ghp_two" })).toBe("ghp_two");
    expect(resolveGitHubToken({ GITHUB_TOKEN: "  \n", GH_TOKEN: "ghp_two" })).toBe("ghp_two");
  });

  it("returns null when no token is set", () => {
    expect(resolveGitHubToken({})).toBeNull();
    expect(resolveGitHubToken({ GITHUB_TOKEN: "", GH_TOKEN: " " })).toBeNull();
    expect(resolveGitHubToken(undefined)).toBeNull();
  });

  it("trims what a .env file or a shell leaves around a token, which would make the header invalid", () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: "  ghp_one\r\n" })).toBe("ghp_one");
  });

  it("ignores a value that is not a string", () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: 12345, GH_TOKEN: null })).toBeNull();
  });

  it("reads no other variable, so a token meant for something else is never sent to GitHub", () => {
    expect(resolveGitHubToken({ COPILOT_GITHUB_TOKEN: "ghp_x", GITHUB_PAT: "ghp_y", NPM_TOKEN: "npm_z" })).toBeNull();
  });

  it("names the variables in one frozen list, GITHUB_TOKEN first", () => {
    expect(GITHUB_TOKEN_ENV_VARS).toEqual(["GITHUB_TOKEN", "GH_TOKEN"]);
    expect(Object.isFrozen(GITHUB_TOKEN_ENV_VARS)).toBe(true);
  });
});

describe("githubApiHeaders", () => {
  it("sends the media type and user agent GitHub requires, and nothing else without a token", () => {
    expect(githubApiHeaders({ userAgent: "plan-forge-test" })).toEqual({
      accept: "application/vnd.github+json",
      "user-agent": "plan-forge-test",
    });
  });

  it("adds the token as an authorization header", () => {
    expect(githubApiHeaders({ userAgent: "plan-forge-test", token: "ghp_one" })).toEqual({
      accept: "application/vnd.github+json",
      "user-agent": "plan-forge-test",
      authorization: "token ghp_one",
    });
  });
});

describe("fetchGitHub", () => {
  const URL = "https://api.github.com/repos/srnichols/plan-forge/releases/latest";

  it("sends the token and reports the request as authenticated", async () => {
    const fetchImpl = vi.fn(async () => response(200));
    const out = await fetchGitHub(URL, { fetchImpl, env: { GH_TOKEN: "ghp_two" }, userAgent: "plan-forge-test" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(URL);
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("token ghp_two");
    expect(out).toMatchObject({ res: { status: 200 }, authenticated: true, tokenRejected: false });
  });

  it("sends no authorization header without a token", async () => {
    const fetchImpl = vi.fn(async () => response(200));
    const out = await fetchGitHub(URL, { fetchImpl, env: {}, userAgent: "plan-forge-test" });
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("authorization");
    expect(out).toMatchObject({ authenticated: false, tokenRejected: false });
  });

  it("repeats a request GitHub rejected with 401 once, without the token, so a stale token cannot break what works anonymously", async () => {
    const fetchImpl = vi.fn(async (_url, init) => response(init.headers.authorization ? 401 : 200));
    const out = await fetchGitHub(URL, { fetchImpl, env: { GITHUB_TOKEN: "ghp_stale" }, userAgent: "plan-forge-test" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("token ghp_stale");
    expect(fetchImpl.mock.calls[1][1].headers).not.toHaveProperty("authorization");
    expect(out).toMatchObject({ res: { status: 200 }, authenticated: false, tokenRejected: true });
  });

  it("does not repeat a 401 that carried no token", async () => {
    const fetchImpl = vi.fn(async () => response(401));
    const out = await fetchGitHub(URL, { fetchImpl, env: {}, userAgent: "plan-forge-test" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ res: { status: 401 }, tokenRejected: false });
  });

  it.each([403, 404, 429, 500])("does not repeat a %i, which is not a rejected credential", async (status) => {
    const fetchImpl = vi.fn(async () => response(status));
    const out = await fetchGitHub(URL, { fetchImpl, env: { GITHUB_TOKEN: "ghp_one" }, userAgent: "plan-forge-test" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ res: { status }, authenticated: true, tokenRejected: false });
  });

  it("hands the abort signal and the redirect mode to every request it makes", async () => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn(async (_url, init) => response(init.headers.authorization ? 401 : 200));
    await fetchGitHub(URL, { fetchImpl, env: { GITHUB_TOKEN: "ghp_stale" }, userAgent: "plan-forge-test", signal, redirect: "follow" });
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init.signal).toBe(signal);
      expect(init.redirect).toBe("follow");
    }
  });

  it("leaves redirect handling to fetch when the caller does not ask for one", async () => {
    const fetchImpl = vi.fn(async () => response(200));
    await fetchGitHub(URL, { fetchImpl, env: {}, userAgent: "plan-forge-test" });
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty("redirect");
  });

  it("lets a network failure reach the caller, which knows how to describe it", async () => {
    const fetchImpl = async () => { throw new TypeError("fetch failed"); };
    await expect(fetchGitHub(URL, { fetchImpl, env: {}, userAgent: "plan-forge-test" })).rejects.toThrow("fetch failed");
  });
});

// GitHub says a request was refused for its rate in a few ways: the primary quota (403 or 429 with
// x-ratelimit-remaining: 0), and a secondary limit (403 or 429 with Retry-After). A 403 with neither is a refusal for
// some other reason, such as a token without access, and must not be reported as a limit.
describe("readRateLimit", () => {
  const RESET_EPOCH = 1793264400; // 2026-10-29T09:00:00Z

  it("reads the limit and the reset time from a 403 whose quota is used up", () => {
    const res = withHeaders(403, { "x-ratelimit-limit": 60, "x-ratelimit-remaining": 0, "x-ratelimit-reset": RESET_EPOCH });
    expect(readRateLimit(res)).toEqual({ limit: 60, resetAt: "2026-10-29T09:00:00.000Z", retryAfterSeconds: null });
  });

  it("reads Retry-After from a 403 that carries one, which is how a secondary limit answers", () => {
    expect(readRateLimit(withHeaders(403, { "retry-after": 30 }))).toEqual({ limit: null, resetAt: null, retryAfterSeconds: 30 });
  });

  it("calls every 429 a rate limit, with or without headers", () => {
    expect(readRateLimit(withHeaders(429))).toEqual({ limit: null, resetAt: null, retryAfterSeconds: null });
    expect(readRateLimit(withHeaders(429, { "x-ratelimit-remaining": 25 }))).not.toBeNull();
    expect(readRateLimit({ status: 429 })).not.toBeNull();
  });

  it("does not call a 403 a rate limit when GitHub says there is quota left, or says nothing", () => {
    expect(readRateLimit(withHeaders(403, { "x-ratelimit-remaining": 25, "x-ratelimit-limit": 60 }))).toBeNull();
    expect(readRateLimit(withHeaders(403))).toBeNull();
    expect(readRateLimit({ status: 403 })).toBeNull();
  });

  it("does not call a response that succeeded one, even when it spent the last request", () => {
    expect(readRateLimit(withHeaders(200, { "x-ratelimit-remaining": 0, "x-ratelimit-reset": RESET_EPOCH }))).toBeNull();
  });

  it.each([401, 404, 500, 503])("does not call a %i a rate limit", (status) => {
    expect(readRateLimit(withHeaders(status, { "x-ratelimit-remaining": 0 }))).toBeNull();
  });

  it("keeps a header it cannot read as unknown rather than guessing", () => {
    const res = withHeaders(403, { "x-ratelimit-remaining": 0, "x-ratelimit-limit": "lots", "x-ratelimit-reset": "soon", "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" });
    expect(readRateLimit(res)).toEqual({ limit: null, resetAt: null, retryAfterSeconds: null });
  });

  it("tolerates no response and a response with no headers", () => {
    expect(readRateLimit(undefined)).toBeNull();
    expect(readRateLimit(null)).toBeNull();
    expect(readRateLimit({ ok: false })).toBeNull();
  });
});

describe("describeRateLimit", () => {
  const RESET = "2026-10-29T09:00:00.000Z";
  const NOW = Date.parse("2026-10-29T08:19:00.000Z"); // 41 minutes before the reset

  it("says the limit, when it resets, and how long that is, for a request that carried no token", () => {
    const text = describeRateLimit({ limit: 60, resetAt: RESET, authenticated: false }, { now: NOW });
    expect(text).toMatch(/rate limit/i);
    expect(text).toContain("60 requests an hour");
    expect(text).toContain("09:00 UTC");
    expect(text).toContain("in about 41 minutes");
  });

  it("tells a request that carried no token to set GITHUB_TOKEN or GH_TOKEN", () => {
    const text = describeRateLimit({ resetAt: RESET, authenticated: false }, { now: NOW });
    expect(text).toContain("GITHUB_TOKEN");
    expect(text).toContain("GH_TOKEN");
    expect(text).toMatch(/5,?000 requests an hour/);
  });

  it("does not tell a request whose token was accepted to set one, because that cannot help", () => {
    const text = describeRateLimit({ limit: 5000, resetAt: RESET, authenticated: true }, { now: NOW });
    expect(text).not.toMatch(/set GITHUB_TOKEN|set GH_TOKEN|GITHUB_TOKEN or GH_TOKEN/i);
    expect(text).toContain("09:00 UTC");
    expect(text).toMatch(/try again/i);
  });

  it("says the token was rejected, and that it needs replacing, when the repeat without it was limited", () => {
    const text = describeRateLimit({ resetAt: RESET, authenticated: false, tokenRejected: true }, { now: NOW });
    expect(text).toMatch(/rejected/i);
    expect(text).toMatch(/expired or revoked/i);
    expect(text).toContain("GITHUB_TOKEN");
    expect(text).toContain("GH_TOKEN");
  });

  it("says how long to wait when GitHub gave Retry-After and no reset time", () => {
    expect(describeRateLimit({ retryAfterSeconds: 30, authenticated: false })).toMatch(/30 seconds/);
    expect(describeRateLimit({ retryAfterSeconds: 120, authenticated: false })).toMatch(/2 minutes/);
  });

  it("says 1 minute, not 1 minutes", () => {
    const text = describeRateLimit({ resetAt: RESET, authenticated: true }, { now: Date.parse("2026-10-29T08:59:00.000Z") });
    expect(text).toContain("in about 1 minute");
    expect(text).not.toContain("1 minutes");
  });

  it("leaves out how long it is when the reset time has passed", () => {
    const text = describeRateLimit({ resetAt: RESET, authenticated: false }, { now: Date.parse("2026-10-29T09:30:00.000Z") });
    expect(text).toContain("09:00 UTC");
    expect(text).not.toContain("in about");
  });

  it("still says what happened and what to do when GitHub gave neither a reset time nor a Retry-After", () => {
    const text = describeRateLimit({ authenticated: false });
    expect(text).toMatch(/rate limit/i);
    expect(text).toContain("GITHUB_TOKEN");
    expect(text).toMatch(/try again/i);
  });

  it("copes with being given nothing at all", () => {
    expect(describeRateLimit()).toMatch(/rate limit/i);
    expect(describeRateLimit({})).toMatch(/rate limit/i);
  });
});
