/**
 * Tests for pforge-mcp/orchestrator/sdk-worker.mjs
 * Phase-60 Slice 2 — SDK-backed worker (COPILOT_SERVABLE path, behind the switch).
 *
 * Uses an injected fake createSession — no network, no runtime spawn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runSdkSession, buildPermissionHandler, extractSdkOutput, extractSdkTokens,
  buildSdkClientInfo, ORCHESTRATOR_MESSAGE_SOURCE,
} from "../orchestrator/sdk-worker.mjs";

// ─── Fake session factory helpers ─────────────────────────────────────────────

/**
 * Build a fake createSession that behaves like @github/copilot-sdk: the session's
 * sendAndWait() emits the real event types (assistant.message, assistant.usage)
 * and the factory returns { session, client } so cleanup can be asserted.
 * @param {object} opts
 * @param {string}   [opts.assistantText]  Final assistant.message content.
 * @param {object}   [opts.finalUsage]     assistant.usage data (SDK field names).
 * @param {boolean}  [opts.runThrows]      If true, sendAndWait() rejects.
 * @param {boolean}  [opts.createThrows]   If true, createSession rejects.
 * @param {string}   [opts.sdkModel]       Model reported in assistant.usage.
 */
function makeCreateSession({
  assistantText = "slice work done",
  finalUsage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, duration: 300 },
  runThrows = false,
  createThrows = false,
  sdkModel = null,
} = {}) {
  return vi.fn(async ({ model, onEvent }) => {
    if (createThrows) {
      const err = new Error("SDK import failed");
      err.code = "SDK_IMPORT_FAILED";
      throw err;
    }

    const session = {
      sendAndWait: vi.fn(async () => {
        if (runThrows) throw new Error("session.sendAndWait failure");
        onEvent({ type: "assistant.usage", data: { model: sdkModel || model, ...finalUsage } });
        onEvent({ type: "assistant.message", data: { content: assistantText } });
        return { data: { content: assistantText } };
      }),
      disconnect: vi.fn(async () => {}),
    };
    return { session, client: { stop: vi.fn(async () => {}) } };
  });
}

// ─── runSdkSession — happy path ───────────────────────────────────────────────

describe("runSdkSession — happy path", () => {
  it("returns worker=sdk, exitCode=0, and assistant text in output", async () => {
    const createSession = makeCreateSession({ assistantText: "file written" });
    const result = await runSdkSession({
      prompt: "do the work",
      model: "gpt-5.3-codex",
      cwd: "/project",
      createSession,
    });

    expect(result.exitCode).toBe(0);
    expect(result.worker).toBe("sdk");
    expect(result.output).toContain("file written");
    expect(result.timedOut).toBe(false);
    expect(result.looksLikeHelpText).toBe(false);
  });

  it("disconnects the session and stops the client after the turn", async () => {
    let handle;
    const createSession = vi.fn(async (opts) => {
      handle = await makeCreateSession()(opts);
      return handle;
    });
    await runSdkSession({ prompt: "x", model: "gpt-5.3-codex", cwd: "/p", createSession });
    expect(handle.session.disconnect).toHaveBeenCalledTimes(1);
    expect(handle.client.stop).toHaveBeenCalledTimes(1);
  });

  it("still stops the client when the turn fails", async () => {
    let handle;
    const createSession = vi.fn(async (opts) => {
      handle = await makeCreateSession({ runThrows: true })(opts);
      return handle;
    });
    await runSdkSession({ prompt: "x", model: "gpt-5.3-codex", cwd: "/p", createSession });
    expect(handle.client.stop).toHaveBeenCalledTimes(1);
  });

  it("passes the model and the slice's working directory to createSession", async () => {
    const createSession = makeCreateSession();
    await runSdkSession({ prompt: "p", model: "gpt-5.5", cwd: "/p", createSession });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.5", cwd: "/p" }),
    );
  });

  it("sends the prompt with the turn timeout", async () => {
    let handle;
    const createSession = vi.fn(async (opts) => {
      handle = await makeCreateSession()(opts);
      return handle;
    });
    await runSdkSession({ prompt: "do it", model: "m", cwd: "/p", timeout: 1234, createSession });
    expect(handle.session.sendAndWait).toHaveBeenCalledWith({ prompt: "do it", source: ORCHESTRATOR_MESSAGE_SOURCE }, 1234);
  });
});

// ─── runSdkSession — SDK fallback (sdkError) ─────────────────────────────────

describe("runSdkSession — SDK import / session creation failure", () => {
  it("throws with sdkError=true when createSession rejects", async () => {
    const createSession = makeCreateSession({ createThrows: true });
    let caught;
    try {
      await runSdkSession({ prompt: "p", model: "gpt-5.3-codex", cwd: "/p", createSession });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.sdkError).toBe(true);
    expect(caught.message).toContain("session creation failed");
  });
});

// ─── runSdkSession — session.run failure ─────────────────────────────────────

describe("runSdkSession — turn failure", () => {
  it("returns exitCode=1 and error in stderr when sendAndWait() throws", async () => {
    const createSession = makeCreateSession({ runThrows: true });
    const result = await runSdkSession({ prompt: "p", model: "gpt-5.3-codex", cwd: "/p", createSession });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("session.sendAndWait failure");
    expect(result.worker).toBe("sdk");
  });
});

// ─── buildPermissionHandler ───────────────────────────────────────────────────
// Requests and results use the SDK's PermissionHandler shapes.

describe("buildPermissionHandler", () => {
  it("approves file writes to non-forbidden paths", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: [".forge/secrets.json"], cwd: "/project" });
    expect(handle({ kind: "write", fileName: "/project/src/index.mjs" })).toEqual({ kind: "approve-once" });
  });

  it("rejects writes to a forbidden path, given absolute or project-relative", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: ["pforge-mcp/server.mjs"], cwd: "/project" });
    const abs = handle({ kind: "write", fileName: "/project/pforge-mcp/server.mjs" });
    expect(abs.kind).toBe("reject");
    expect(abs.feedback).toMatch(/Forbidden Actions/);
    expect(handle({ kind: "write", fileName: "pforge-mcp/server.mjs" }).kind).toBe("reject");
  });

  it("rejects writes inside a forbidden directory, with Windows separators", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: ["pforge-master/"], cwd: "C:\\project" });
    expect(handle({ kind: "write", fileName: "C:\\project\\pforge-master\\server.mjs" }).kind).toBe("reject");
  });

  it("approves read operations unconditionally", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: ["everything"], cwd: "/project" });
    expect(handle({ kind: "read", path: "/project/everything/secret.txt" }).kind).toBe("approve-once");
  });

  it("approves a non-destructive shell command", () => {
    const handle = buildPermissionHandler();
    expect(handle({ kind: "shell", fullCommandText: "npx vitest run" }).kind).toBe("approve-once");
  });

  it("rejects a destructive rm shell command", () => {
    const handle = buildPermissionHandler();
    expect(handle({ kind: "shell", fullCommandText: "rm -rf ." }).kind).toBe("reject");
  });

  it("has no approveAll reference", () => {
    // Guard: buildPermissionHandler source must not use approveAll
    const src = buildPermissionHandler.toString();
    expect(src).not.toContain("approveAll");
  });
});

// ─── extractSdkTokens ────────────────────────────────────────────────────────

describe("extractSdkTokens", () => {
  it("maps assistant.usage data to the extractTokens shape", () => {
    const events = [
      { type: "assistant.usage", data: { model: "gpt-5.3-codex", inputTokens: 200, outputTokens: 80, cacheReadTokens: 20, cacheWriteTokens: 5, duration: 400 } },
    ];
    const tokens = extractSdkTokens(events, "gpt-5.3-codex", Date.now() - 500);
    expect(tokens.tokens_in).toBe(200);
    expect(tokens.tokens_out).toBe(80);
    expect(tokens.cached).toBe(20);
    expect(tokens.cache_read_tokens).toBe(20);
    expect(tokens.cache_creation_input_tokens).toBe(5);
    expect(tokens.apiDurationMs).toBe(400);
    expect(tokens.sessionDurationMs).toBeGreaterThanOrEqual(0);
    expect(tokens.model).toBe("gpt-5.3-codex");
  });

  it("emits null — never 0 — for counts when the SDK reported no usage (bug #190 convention)", () => {
    const tokens = extractSdkTokens([{ type: "session.idle", data: {} }], "gpt-5.3-codex", Date.now());
    expect(tokens.tokens_in).toBeNull();
    expect(tokens.tokens_out).toBeNull();
    expect(tokens.cached).toBeNull();
    expect(tokens.reasoning_tokens).toBeNull();
    expect(tokens.apiDurationMs).toBeNull();
  });

  it("returns null model when no events report it and model arg is null", () => {
    const tokens = extractSdkTokens([], null, Date.now());
    expect(tokens.model).toBeNull();
  });

  it("picks up the model assistant.usage reports", () => {
    const events = [{ type: "assistant.usage", data: { model: "gpt-5.5", inputTokens: 1 } }];
    expect(extractSdkTokens(events, "gpt-5.3-codex", Date.now()).model).toBe("gpt-5.5");
  });

  it("sums usage across the model calls of one turn", () => {
    const events = [
      { type: "assistant.usage", data: { model: "m", inputTokens: 50, outputTokens: 25, cacheReadTokens: 10 } },
      { type: "assistant.usage", data: { model: "m", inputTokens: 100, outputTokens: 50, cacheReadTokens: 40 } },
    ];
    const tokens = extractSdkTokens(events, "m", Date.now());
    expect([tokens.tokens_in, tokens.tokens_out, tokens.cache_read_tokens]).toEqual([150, 75, 50]);
  });
});

describe("extractSdkOutput", () => {
  it("joins final assistant messages, falling back to streamed deltas", () => {
    expect(extractSdkOutput([
      { type: "assistant.message", data: { content: "first" } },
      { type: "assistant.message", data: { content: "second" } },
    ])).toBe("first\nsecond");
    expect(extractSdkOutput([
      { type: "assistant.message_delta", data: { deltaContent: "par" } },
      { type: "assistant.message_delta", data: { deltaContent: "tial" } },
    ])).toBe("partial");
  });
});

// ─── runSdkSession — BYOK provider config (Phase-60 Slice 4) ─────────────────
// Per testing.instructions.md: happy path per supported type, one key-absent case,
// and one unsupported-type case. Do NOT use real keys — use fake strings only.

describe("runSdkSession — BYOK provider config — happy path", () => {
  it("openai: passes provider.type and provider.apiKey to createSession", async () => {
    const createSession = makeCreateSession();
    const savedKey = process.env.TEST_FAKE_OPENAI_KEY;
    process.env.TEST_FAKE_OPENAI_KEY = "sk-test-fake";
    try {
      const result = await runSdkSession({
        prompt: "p", model: "gpt-5.5", cwd: "/p",
        provider: { type: "openai", envKey: "TEST_FAKE_OPENAI_KEY" },
        createSession,
      });
      expect(result.exitCode).toBe(0);
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({ type: "openai", apiKey: "sk-test-fake" }),
        }),
      );
    } finally {
      if (savedKey === undefined) delete process.env.TEST_FAKE_OPENAI_KEY;
      else process.env.TEST_FAKE_OPENAI_KEY = savedKey;
    }
  });

  it("azure: passes provider.type and provider.apiKey to createSession", async () => {
    const createSession = makeCreateSession();
    const savedKey = process.env.TEST_FAKE_AZURE_KEY;
    process.env.TEST_FAKE_AZURE_KEY = "azure-test-fake";
    try {
      const result = await runSdkSession({
        prompt: "p", model: "azure/eastus-gpt4o", cwd: "/p",
        provider: { type: "azure", envKey: "TEST_FAKE_AZURE_KEY" },
        createSession,
      });
      expect(result.exitCode).toBe(0);
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({ type: "azure", apiKey: "azure-test-fake" }),
        }),
      );
    } finally {
      if (savedKey === undefined) delete process.env.TEST_FAKE_AZURE_KEY;
      else process.env.TEST_FAKE_AZURE_KEY = savedKey;
    }
  });

  it("anthropic: passes provider.type and provider.apiKey to createSession", async () => {
    const createSession = makeCreateSession();
    const savedKey = process.env.TEST_FAKE_ANTHROPIC_KEY;
    process.env.TEST_FAKE_ANTHROPIC_KEY = "sk-ant-test-fake";
    try {
      const result = await runSdkSession({
        prompt: "p", model: "claude-opus-4.7", cwd: "/p",
        provider: { type: "anthropic", envKey: "TEST_FAKE_ANTHROPIC_KEY" },
        createSession,
      });
      expect(result.exitCode).toBe(0);
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({ type: "anthropic", apiKey: "sk-ant-test-fake" }),
        }),
      );
    } finally {
      if (savedKey === undefined) delete process.env.TEST_FAKE_ANTHROPIC_KEY;
      else process.env.TEST_FAKE_ANTHROPIC_KEY = savedKey;
    }
  });
});

describe("runSdkSession — BYOK provider config — key-absent path", () => {
  it("returns BYOK_KEY_MISSING when the env var is undefined", async () => {
    const createSession = makeCreateSession();
    const savedKey = process.env.PFORGE_TEST_MISSING_KEY;
    delete process.env.PFORGE_TEST_MISSING_KEY;
    try {
      const result = await runSdkSession({
        prompt: "p", model: "gpt-5.5", cwd: "/p",
        provider: { type: "openai", envKey: "PFORGE_TEST_MISSING_KEY" },
        createSession,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("BYOK_KEY_MISSING");
      expect(result.provider).toBe("openai");
      // createSession must NOT be called when the key is absent
      expect(createSession).not.toHaveBeenCalled();
    } finally {
      if (savedKey !== undefined) process.env.PFORGE_TEST_MISSING_KEY = savedKey;
    }
  });

  it("returns BYOK_KEY_MISSING when the env var is an empty string", async () => {
    const createSession = makeCreateSession();
    const savedKey = process.env.PFORGE_TEST_EMPTY_KEY;
    process.env.PFORGE_TEST_EMPTY_KEY = "";
    try {
      const result = await runSdkSession({
        prompt: "p", model: "gpt-5.5", cwd: "/p",
        provider: { type: "openai", envKey: "PFORGE_TEST_EMPTY_KEY" },
        createSession,
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("BYOK_KEY_MISSING");
      expect(createSession).not.toHaveBeenCalled();
    } finally {
      if (savedKey === undefined) delete process.env.PFORGE_TEST_EMPTY_KEY;
      else process.env.PFORGE_TEST_EMPTY_KEY = savedKey;
    }
  });
});

describe("runSdkSession — BYOK provider config — unsupported provider type", () => {
  it("returns BYOK_UNSUPPORTED_PROVIDER for an unknown type without calling createSession", async () => {
    const createSession = makeCreateSession();
    const result = await runSdkSession({
      prompt: "p", model: "some-model", cwd: "/p",
      provider: { type: "bedrock", envKey: "AWS_ACCESS_KEY" },
      createSession,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("BYOK_UNSUPPORTED_PROVIDER");
    expect(result.provider).toBe("bedrock");
    expect(createSession).not.toHaveBeenCalled();
  });
});

// ─── Guard: forbidden tokens absent from sdk-worker source ───────────────────

describe("sdk-worker source guard", () => {
  it("runSdkSession does not reference approveAll", () => {
    // Behavioural proxy: the injected handler is built by buildPermissionHandler,
    // which we can inspect as a string. runSdkSession itself never calls approveAll.
    const src = runSdkSession.toString();
    expect(src).not.toContain("approveAll");
  });

  it("runSdkSession does not reference forInProcess", () => {
    const src = runSdkSession.toString();
    expect(src).not.toContain("forInProcess");
  });
});

// ─── Guard: SDK path does no stdout parsing ───────────────────────────────────
// The SDK worker derives telemetry from typed onEvent callbacks, not from
// stdout/stderr regex parsing. parseStderrStats and parseGrokStreamingJson
// belong to the spawn path (worker-spawn.mjs) and must never leak into
// sdk-worker.mjs. This describe block is the canonical regression guard.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkWorkerSrc = readFileSync(join(__dirname, "../orchestrator/sdk-worker.mjs"), "utf8");
const workerSpawnSrc = readFileSync(join(__dirname, "../orchestrator/worker-spawn.mjs"), "utf8");

describe("Guard: the SDK path does no stdout parsing", () => {
  it("sdk-worker.mjs does not reference parseStderrStats", () => {
    expect(sdkWorkerSrc).not.toContain("parseStderrStats");
  });

  it("sdk-worker.mjs does not reference parseGrokStreamingJson", () => {
    expect(sdkWorkerSrc).not.toContain("parseGrokStreamingJson");
  });

  it("worker-spawn.mjs retains parseGrokStreamingJson (spawn path must keep it)", () => {
    expect(workerSpawnSrc).toContain("parseGrokStreamingJson");
  });

  it("worker-spawn.mjs retains parseStderrStats (spawn path must keep it)", () => {
    expect(workerSpawnSrc).toContain("parseStderrStats");
  });
});

// ─── Session continuity, provenance, client info (enhancements 3 + 8) ─────────

/** Fake factory recording each request; `failResume` makes resume attempts throw. */
function makeSessionFactory({ failResume = false, serverId = "server-assigned-id" } = {}) {
  const requests = [];
  const factory = vi.fn(async (request) => {
    requests.push(request);
    if (failResume && request.resume) throw new Error("session not found");
    const session = {
      sessionId: request.sessionId || serverId,
      sendAndWait: vi.fn(async () => {
        request.onEvent({ type: "assistant.message", data: { content: "ok" } });
      }),
      disconnect: vi.fn(async () => {}),
    };
    return { session, client: { stop: vi.fn(async () => {}) } };
  });
  return { factory, requests };
}

describe("runSdkSession — session continuity", () => {
  const SESSION = "0cb916db-26aa-40f2-86b5-1ba81b225fd2";

  it("creates the session with the pinned ID on a first attempt", async () => {
    const { factory, requests } = makeSessionFactory();
    const r = await runSdkSession({ prompt: "p", model: "gpt-6-luna", cwd: "/p", session: { id: SESSION, resume: false }, createSession: factory });
    expect(requests[0]).toMatchObject({ sessionId: SESSION, resume: false });
    expect(r.sessionId).toBe(SESSION);
    expect(r.resumed).toBe(false);
  });

  it("resumes the pinned session on a retry", async () => {
    const { factory, requests } = makeSessionFactory();
    const r = await runSdkSession({ prompt: "p", model: "gpt-6-luna", cwd: "/p", session: { id: SESSION, resume: true }, createSession: factory });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ sessionId: SESSION, resume: true });
    expect(r.sessionId).toBe(SESSION);
    expect(r.resumed).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  it("falls back to a fresh session when the resume fails", async () => {
    const { factory, requests } = makeSessionFactory({ failResume: true });
    const r = await runSdkSession({ prompt: "p", model: "gpt-6-luna", cwd: "/p", session: { id: SESSION, resume: true }, createSession: factory });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ sessionId: null, resume: false });
    expect(r.sessionId).toBe("server-assigned-id");
    expect(r.resumed).toBe(false);
    expect(r.exitCode).toBe(0);
  });

  it("surfaces an sdkError when the fresh-session fallback also fails", async () => {
    const factory = vi.fn(async () => { throw new Error("runtime down"); });
    await expect(runSdkSession({ prompt: "p", model: "m", cwd: "/p", session: { id: SESSION, resume: true }, createSession: factory }))
      .rejects.toMatchObject({ sdkError: true });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failed fresh session", async () => {
    const factory = vi.fn(async () => { throw new Error("runtime down"); });
    await expect(runSdkSession({ prompt: "p", model: "m", cwd: "/p", session: { id: SESSION, resume: false }, createSession: factory }))
      .rejects.toMatchObject({ sdkError: true });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("reports the server-assigned ID when no session was pinned", async () => {
    const { factory, requests } = makeSessionFactory();
    const r = await runSdkSession({ prompt: "p", model: "m", cwd: "/p", createSession: factory });
    expect(requests[0]).toMatchObject({ sessionId: null, resume: false });
    expect(r.sessionId).toBe("server-assigned-id");
  });
});

describe("runSdkSession — provenance and auto tier", () => {
  it("tags the slice prompt with the orchestrator message source", async () => {
    let session;
    const factory = vi.fn(async (request) => {
      const handle = await makeSessionFactory().factory(request);
      session = handle.session;
      return handle;
    });
    await runSdkSession({ prompt: "slice prompt", model: "m", cwd: "/p", createSession: factory });
    expect(ORCHESTRATOR_MESSAGE_SOURCE).toMatch(/^agent-/);
    expect(session.sendAndWait).toHaveBeenCalledWith({ prompt: "slice prompt", source: ORCHESTRATOR_MESSAGE_SOURCE }, expect.any(Number));
  });

  it("passes the auto tier only when the model is auto", async () => {
    const { factory, requests } = makeSessionFactory();
    await runSdkSession({ prompt: "p", model: "auto", cwd: "/p", autoTier: "intelligence", createSession: factory });
    await runSdkSession({ prompt: "p", model: "gpt-6-luna", cwd: "/p", autoTier: "intelligence", createSession: factory });
    expect(requests[0].autoTier).toBe("intelligence");
    expect(requests[1].autoTier).toBeNull();
  });
});

describe("buildSdkClientInfo", () => {
  it("identifies Plan Forge with its framework version", () => {
    const info = buildSdkClientInfo();
    expect(info.applicationName).toBe("plan-forge");
    expect(info.integrationName).toBe("pforge-orchestrator");
    expect(info.applicationVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.isFrozen(info)).toBe(true);
  });
});
