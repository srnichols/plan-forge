/**
 * Tests for github-copilot-tools.mjs (Phase-33, Slice 1).
 *
 * Uses vi.stubGlobal("fetch", ...) with fixture-backed responses.
 * Mocks node:child_process to prevent real `gh` subprocess invocations.
 */

import { createRequire } from "node:module";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  resolveGitHubToken,
  sendTurn,
  _resetTokenCache,
} from "../github-copilot-tools.mjs";

// Prevent real `gh auth token` subprocess from ever running
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => { throw new Error("gh: not available in tests"); }),
}));

const require = createRequire(import.meta.url);
const toolCallFixture   = require("./fixtures/response-tool-call.json");
const rateLimitFixture  = require("./fixtures/response-rate-limit.json");

const REPLY_FIXTURE = {
  choices: [{ message: { role: "assistant", content: "Four.", tool_calls: undefined } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

function makeFetch(status, body, headers = {}) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => headers[k] ?? null },
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

describe("resolveGitHubToken", () => {
  const origToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    _resetTokenCache();
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it("tier-1: returns the token passed directly", () => {
    const result = resolveGitHubToken({ token: "ghp_direct" });
    expect(result).toBe("ghp_direct");
  });

  it("tier-2: returns GITHUB_TOKEN env var when no arg passed", () => {
    process.env.GITHUB_TOKEN = "ghp_from_env";
    const result = resolveGitHubToken();
    expect(result).toBe("ghp_from_env");
  });

  it("returns null when useSubprocess:false and no token or env", () => {
    // Spy on existsSync so no secrets.json is found in the test cwd
    const fs = require("node:fs");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const result = resolveGitHubToken({ useSubprocess: false });
    expect(result).toBeNull();
  });
});

describe("sendTurn", () => {
  beforeEach(() => {
    _resetTokenCache();
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.unstubAllGlobals();
  });

  it("throws when no token is available", async () => {
    delete process.env.GITHUB_TOKEN;
    _resetTokenCache();
    const fs = require("node:fs");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    await expect(sendTurn({ messages: [{ role: "user", content: "hi" }], tools: [], model: "gpt-4o-mini" }))
      .rejects.toThrow("GitHub Copilot: no token available");
    vi.restoreAllMocks();
  });

  it("2xx reply → returns type:reply with content", async () => {
    vi.stubGlobal("fetch", makeFetch(200, REPLY_FIXTURE));
    const result = await sendTurn({ messages: [{ role: "user", content: "hi" }], tools: [], model: "gpt-4o-mini" });
    expect(result.type).toBe("reply");
    expect(result.content).toBe("Four.");
    expect(result.tokensIn).toBe(10);
  });

  it("2xx tool_calls → returns type:tool_calls with toolCalls array", async () => {
    vi.stubGlobal("fetch", makeFetch(200, toolCallFixture));
    const result = await sendTurn({ messages: [{ role: "user", content: "hi" }], tools: [], model: "gpt-4o-mini" });
    expect(result.type).toBe("tool_calls");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("calculator");
    expect(result.toolCalls[0].args).toEqual({ expression: "2+2" });
  });

  it("429 → returns {type:'rate_limited'} without throwing", async () => {
    vi.stubGlobal("fetch", makeFetch(429, rateLimitFixture, { "retry-after": "60" }));
    const result = await sendTurn({ messages: [{ role: "user", content: "hi" }], tools: [], model: "gpt-4o" });
    expect(result.type).toBe("rate_limited");
    expect(result.retryAfter).toBe("60");
    expect(typeof result.raw).toBe("string");
  });

  it("≥500 → throws an error", async () => {
    vi.stubGlobal("fetch", makeFetch(500, { error: "internal" }));
    await expect(
      sendTurn({ messages: [{ role: "user", content: "hi" }], tools: [], model: "gpt-4o" }),
    ).rejects.toThrow("GitHub Copilot API error 500");
  });
});
