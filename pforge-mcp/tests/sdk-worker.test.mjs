/**
 * Tests for pforge-mcp/orchestrator/sdk-worker.mjs
 * Phase-60 Slice 2 — SDK-backed worker (COPILOT_SERVABLE path, behind the switch).
 *
 * Uses an injected fake createSession — no network, no runtime spawn.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSdkSession, buildPermissionHandler, extractSdkTokens } from "../orchestrator/sdk-worker.mjs";

// ─── Fake session factory helpers ─────────────────────────────────────────────

/**
 * Build a minimal fake createSession that records calls and resolves the prompt.
 * @param {object} opts
 * @param {string}   [opts.assistantText]  Text emitted via assistant.message_delta.
 * @param {object}   [opts.finalUsage]     Usage payload on session.complete.
 * @param {boolean}  [opts.runThrows]      If true, session.run() rejects.
 * @param {boolean}  [opts.createThrows]   If true, createSession rejects.
 * @param {string}   [opts.sdkModel]       Model reported in session.complete.
 */
function makeCreateSession({
  assistantText = "slice work done",
  finalUsage = { input_tokens: 100, output_tokens: 50, cached_tokens: 10, api_duration_ms: 300 },
  runThrows = false,
  createThrows = false,
  sdkModel = null,
} = {}) {
  return vi.fn(async ({ model, onPermissionRequest, onEvent }) => {
    if (createThrows) {
      const err = new Error("SDK import failed");
      err.code = "SDK_IMPORT_FAILED";
      throw err;
    }

    // Emit events when run() is called.
    const session = {
      run: vi.fn(async (prompt) => {
        if (runThrows) throw new Error("session.run failure");
        // Simulate events the real SDK would emit.
        onEvent({ type: "assistant.message_delta", text: assistantText, usage: null });
        onEvent({
          type: "session.complete",
          model: sdkModel || model,
          usage: finalUsage,
        });
      }),
      close: vi.fn(async () => {}),
    };
    return session;
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

  it("closes the session after run completes", async () => {
    let capturedSession;
    const createSession = vi.fn(async (opts) => {
      capturedSession = {
        run: vi.fn(async () => {
          opts.onEvent({ type: "session.complete", model: opts.model, usage: {} });
        }),
        close: vi.fn(async () => {}),
      };
      return capturedSession;
    });
    await runSdkSession({ prompt: "x", model: "gpt-5.3-codex", cwd: "/p", createSession });
    expect(capturedSession.close).toHaveBeenCalledTimes(1);
  });

  it("passes the injected model to createSession", async () => {
    const createSession = makeCreateSession();
    await runSdkSession({ prompt: "p", model: "gpt-5.5", cwd: "/p", createSession });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.5" }),
    );
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

describe("runSdkSession — session.run failure", () => {
  it("returns exitCode=1 and error in stderr when run() throws", async () => {
    const createSession = makeCreateSession({ runThrows: true });
    const result = await runSdkSession({ prompt: "p", model: "gpt-5.3-codex", cwd: "/p", createSession });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("session.run failure");
    expect(result.worker).toBe("sdk");
  });
});

// ─── buildPermissionHandler ───────────────────────────────────────────────────

describe("buildPermissionHandler", () => {
  it("approves file writes to non-forbidden paths", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: ["/project/.forge/secrets.json"] });
    const result = handle({ type: "file-write", path: "/project/src/index.mjs" });
    expect(result.approved).toBe(true);
  });

  it("rejects file writes to a forbidden path", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: ["/project/pforge-mcp/server.mjs"] });
    const result = handle({ type: "file-write", path: "/project/pforge-mcp/server.mjs" });
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/Forbidden Actions/);
  });

  it("rejects file writes inside a forbidden directory", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: ["/project/pforge-master"] });
    const result = handle({ type: "file-write", path: "/project/pforge-master/server.mjs" });
    expect(result.approved).toBe(false);
  });

  it("approves read operations unconditionally", () => {
    const handle = buildPermissionHandler({ forbiddenPaths: ["/project/everything"] });
    expect(handle({ type: "file-read", path: "/project/everything/secret.txt" }).approved).toBe(true);
  });

  it("approves non-destructive shell-run", () => {
    const handle = buildPermissionHandler();
    expect(handle({ type: "shell-run", command: "npx vitest run" }).approved).toBe(true);
  });

  it("rejects destructive rm shell-run", () => {
    const handle = buildPermissionHandler();
    const result = handle({ type: "shell-run", command: "rm -rf ." });
    expect(result.approved).toBe(false);
  });

  it("has no approveAll reference", () => {
    // Guard: buildPermissionHandler source must not use approveAll
    const src = buildPermissionHandler.toString();
    expect(src).not.toContain("approveAll");
  });
});

// ─── extractSdkTokens ────────────────────────────────────────────────────────

describe("extractSdkTokens", () => {
  it("maps session.complete usage fields to extractTokens shape", () => {
    const events = [
      {
        type: "session.complete",
        model: "gpt-5.3-codex",
        usage: { input_tokens: 200, output_tokens: 80, cached_tokens: 20, api_duration_ms: 400 },
      },
    ];
    const tokens = extractSdkTokens(events, "gpt-5.3-codex", Date.now() - 500);
    expect(tokens.tokens_in).toBe(200);
    expect(tokens.tokens_out).toBe(80);
    expect(tokens.cached).toBe(20);
    expect(tokens.apiDurationMs).toBe(400);
    expect(tokens.sessionDurationMs).toBeGreaterThanOrEqual(0);
    expect(tokens.model).toBe("gpt-5.3-codex");
  });

  it("emits null — never 0 — for fields the SDK did not report (bug #190 convention)", () => {
    const events = [{ type: "session.complete", model: "gpt-5.3-codex", usage: {} }];
    const tokens = extractSdkTokens(events, "gpt-5.3-codex", Date.now());
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

  it("picks up model from session.complete when event reports it", () => {
    const events = [{ type: "session.complete", model: "gpt-5.5", usage: {} }];
    const tokens = extractSdkTokens(events, "gpt-5.3-codex", Date.now());
    expect(tokens.model).toBe("gpt-5.5");
  });

  it("accumulates incremental usage from assistant.message_delta", () => {
    const events = [
      { type: "assistant.message_delta", text: "...", usage: { input_tokens: 50, output_tokens: 25 } },
      { type: "session.complete", model: "m", usage: { input_tokens: 100, output_tokens: 50 } },
    ];
    // session.complete should win (last write wins in the reducer)
    const tokens = extractSdkTokens(events, "m", Date.now());
    expect(tokens.tokens_in).toBe(100);
    expect(tokens.tokens_out).toBe(50);
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
