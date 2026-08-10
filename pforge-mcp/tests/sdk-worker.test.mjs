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
