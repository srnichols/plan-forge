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

  // fetch rejects a header value with a newline in it by throwing an error that quotes the whole header, which prints the
  // token. A value that cannot be a token is no token: the request goes out without one.
  it.each([
    ["a newline inside", "ghp_abc\ndef"],
    ["a carriage return inside", "ghp_abc\rdef"],
    ["a space inside", "ghp_abc def"],
    ["a tab inside", "ghp_abc\tdef"],
    ["a NUL inside", "ghp_abc\u0000def"],
    ["another control character inside", "ghp_abc\u001bdef"],
    ["DEL inside", "ghp_abc\u007fdef"],
    ["a character outside ASCII", "ghp_abc\u2019def"],
    ["a character outside the first 256", "ghp_\u4e2d\u6587"],
  ])("does not use a value with %s", (_what, value) => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: value })).toBeNull();
    expect(resolveGitHubToken({ GH_TOKEN: value })).toBeNull();
  });

  it("falls through a value that cannot be a token to the next variable, as it does a blank one", () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: "ghp_abc def", GH_TOKEN: "ghp_two" })).toBe("ghp_two");
    expect(resolveGitHubToken({ GITHUB_TOKEN: "ghp_one", GH_TOKEN: "ghp_abc\ndef" })).toBe("ghp_one");
  });

  it("accepts the tokens GitHub issues", () => {
    for (const token of ["ghp_" + "A1b2".repeat(9), "github_pat_" + "11ABCDEFG0_".repeat(6), "ghs_16C7e42F292c6912E7710c838347Ae178B4a", "0123456789abcdef0123456789abcdef01234567"]) {
      expect(resolveGitHubToken({ GITHUB_TOKEN: token })).toBe(token);
    }
  });

  // The property the rule exists for, checked against the real Headers class rather than a list of bad characters:
  // whatever the rule accepts, fetch accepts as a header value; and a value it refuses is one fetch would reject.
  it("only ever returns a value that is a valid header, for every printable ASCII character", () => {
    for (let code = 0x21; code <= 0x7e; code++) {
      const token = `a${String.fromCharCode(code)}b`;
      expect(resolveGitHubToken({ GITHUB_TOKEN: token }), `U+${code.toString(16)}`).toBe(token);
      expect(() => new Headers(githubApiHeaders({ userAgent: "plan-forge-test", token })), `U+${code.toString(16)}`).not.toThrow();
    }
  });

  it("refuses every character that would make Headers throw", () => {
    for (let code = 0; code <= 0xff; code++) {
      const char = String.fromCharCode(code);
      const token = `a${char}b`;
      let accepted = true;
      try { new Headers({ authorization: `token ${token}` }); } catch { accepted = false; }
      if (!accepted) expect(resolveGitHubToken({ GITHUB_TOKEN: token }), `U+${code.toString(16)}`).toBeNull();
    }
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

  // GitHub sends the quota headers on every response, so a secondary limit arrives with a Retry-After AND the headers of a
  // request that was not short of quota: the reset time there is the hourly quota's, not a time to wait for.
  it("does not read a reset time from a secondary limit, whose quota headers say there is quota left", () => {
    const res = withHeaders(403, { "retry-after": 60, "x-ratelimit-limit": 5000, "x-ratelimit-remaining": 4800, "x-ratelimit-reset": RESET_EPOCH });
    expect(readRateLimit(res)).toEqual({ limit: 5000, resetAt: null, retryAfterSeconds: 60 });
  });

  it("reads the reset time when the quota is spent, even if Retry-After is sent too", () => {
    const res = withHeaders(403, { "retry-after": 60, "x-ratelimit-limit": 60, "x-ratelimit-remaining": 0, "x-ratelimit-reset": RESET_EPOCH });
    expect(readRateLimit(res)).toEqual({ limit: 60, resetAt: "2026-10-29T09:00:00.000Z", retryAfterSeconds: 60 });
  });

  it("keeps the reset time of a 429 that says nothing about the quota left", () => {
    expect(readRateLimit(withHeaders(429, { "x-ratelimit-reset": RESET_EPOCH }))).toEqual({ limit: null, resetAt: "2026-10-29T09:00:00.000Z", retryAfterSeconds: null });
  });

  it("does not read a reset time from a 429 that says there is quota left", () => {
    expect(readRateLimit(withHeaders(429, { "x-ratelimit-remaining": 25, "x-ratelimit-reset": RESET_EPOCH })).resetAt).toBeNull();
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

  // What a real secondary limit looks like once readRateLimit has read it: a Retry-After, the hourly limit, no reset time.
  it("words a secondary limit as a wait, not as an hourly quota that is used up, and does not offer a token for it", () => {
    for (const authenticated of [false, true]) {
      const text = describeRateLimit({ limit: 5000, resetAt: null, retryAfterSeconds: 60, authenticated }, { now: NOW });
      expect(text).toMatch(/wait about 1 minute/);
      expect(text).not.toMatch(/used up|requests an hour|until/);
      expect(text).not.toMatch(/GITHUB_TOKEN|GH_TOKEN/);
      expect(text).toMatch(/try again after that wait/i);
    }
  });

  it("goes by Retry-After, as GitHub tells callers to, when it is sent with a reset time", () => {
    const text = describeRateLimit({ limit: 60, resetAt: RESET, retryAfterSeconds: 45, authenticated: false }, { now: NOW });
    expect(text).toMatch(/wait about 45 seconds/);
    expect(text).not.toContain("09:00 UTC");
  });

  it("still says a rejected token needs replacing when the limit it ran into was a secondary one", () => {
    const text = describeRateLimit({ retryAfterSeconds: 30, authenticated: false, tokenRejected: true });
    expect(text).toMatch(/rejected/i);
    expect(text).toMatch(/wait about 30 seconds/);
  });

  it("says 1 minute, not 1 minutes", () => {
    const text = describeRateLimit({ resetAt: RESET, authenticated: true }, { now: Date.parse("2026-10-29T08:59:00.000Z") });
    expect(text).toContain("in about 1 minute");
    expect(text).not.toContain("1 minutes");
  });

  it("never says 0 minutes, however close the reset is", () => {
    const text = describeRateLimit({ resetAt: RESET, authenticated: true }, { now: Date.parse("2026-10-29T08:59:40.000Z") });
    expect(text).toContain("in about 1 minute");
    expect(text).not.toContain("0 minutes");
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
