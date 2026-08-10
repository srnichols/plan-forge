/**
 * Plan Forge — Phase-60 Slice 2: SDK-backed worker for COPILOT_SERVABLE models.
 *
 * Wraps @github/copilot-sdk CopilotClient/createSession to run a slice prompt
 * without spawning a CLI process. Selected by spawnWorker() only when
 * routing.copilotSdk === "prefer"; the existing spawn path is the fallback.
 *
 * Security constraints (see security.instructions.md):
 *  - onPermissionRequest uses a deliberate handler, not blanket approval.
 *  - RuntimeConnection.forStdio is used; the experimental in-process FFI is not.
 *  - Keys sourced from process.env / .forge/secrets.json, never logged.
 *  - OTel stays off by default (issue #238 opt-in rule).
 */

// ─── Default SDK factory (lazy import to avoid hard dependency) ───────────────

async function _defaultCreateSession({ model, onPermissionRequest, onEvent }) {
  let sdk;
  try {
    sdk = await import("@github/copilot-sdk");
  } catch (err) {
    throw Object.assign(
      new Error(`@github/copilot-sdk not available: ${err.message}`),
      { code: "SDK_IMPORT_FAILED" },
    );
  }
  const { CopilotClient } = sdk;
  const client = new CopilotClient({ useLoggedInUser: true });
  return client.createSession({ model, onPermissionRequest, onEvent });
}

// ─── Permission handler ───────────────────────────────────────────────────────

/**
 * Build a deliberate permission handler that honours forbiddenPaths.
 * Rejects any write to a path in the active slice's Forbidden Actions;
 * approves shell-run and file-read unconditionally (they are read-only or
 * already gated by the orchestrator's dry-run contract).
 *
 * Blanket-approval of every permission is intentionally absent — it would
 * delete the dry-run / confirmation contract required by PROJECT-PRINCIPLES.md,
 * and also throws when managed settings are enabled.
 *
 * @param {{ forbiddenPaths?: string[] }} opts
 * @returns {function} permission handler compatible with CopilotClient.createSession
 */
function buildPermissionHandler({ forbiddenPaths = [] } = {}) {
  const forbiddenSet = new Set(forbiddenPaths.map((p) => p.replace(/\\/g, "/")));

  return function onPermissionRequest({ type, path: targetPath, command }) {
    // Shell commands — honour the orchestrator's dry-run gate, not blanket-approve.
    if (type === "shell-run") {
      // Reject known destructive patterns; allow everything else.
      const cmd = (command || "").trim();
      if (/^(rm|del|rmdir|rd)\b/i.test(cmd) || /\brf\b/.test(cmd)) {
        return { approved: false, reason: "Destructive shell command rejected by Plan Forge permission handler" };
      }
      return { approved: true };
    }

    // File writes — check against the slice's Forbidden Actions list.
    if (type === "file-write" || type === "file-create" || type === "file-delete") {
      if (!targetPath) return { approved: true };
      const normalised = targetPath.replace(/\\/g, "/");
      for (const forbidden of forbiddenSet) {
        if (normalised === forbidden || normalised.startsWith(forbidden + "/")) {
          return {
            approved: false,
            reason: `Write to ${targetPath} rejected — path is in the active slice's Forbidden Actions`,
          };
        }
      }
      return { approved: true };
    }

    // Read operations — always allowed.
    return { approved: true };
  };
}

// ─── Token extraction from SDK typed events ───────────────────────────────────

/**
 * Reduce an array of typed SDK session events into the extractTokens shape.
 * Fields not reported by the SDK are emitted as null — never 0 (bug #190 convention).
 *
 * @param {object[]} events  Typed events collected from the session.
 * @param {string|null} model  Model name from the session request.
 * @param {number} sessionStartMs  Session wall-clock start (for sessionDurationMs).
 * @returns {object} Token/cost record compatible with extractTokens.
 */
function extractSdkTokens(events, model, sessionStartMs) {
  let tokens_in = null;
  let tokens_out = null;
  let cached = null;
  let reasoning_tokens = null;
  let apiDurationMs = null;
  let resolvedModel = model || null;

  for (const ev of events) {
    // assistant.message_delta carries incremental usage on some SDK versions.
    if (ev.type === "assistant.message_delta" && ev.usage) {
      if (ev.usage.input_tokens != null) tokens_in = ev.usage.input_tokens;
      if (ev.usage.output_tokens != null) tokens_out = ev.usage.output_tokens;
      if (ev.usage.cached_tokens != null) cached = ev.usage.cached_tokens;
      if (ev.usage.reasoning_tokens != null) reasoning_tokens = ev.usage.reasoning_tokens;
    }
    // session.complete carries final usage on most SDK versions.
    if (ev.type === "session.complete" && ev.usage) {
      if (ev.usage.input_tokens != null) tokens_in = ev.usage.input_tokens;
      if (ev.usage.output_tokens != null) tokens_out = ev.usage.output_tokens;
      if (ev.usage.cached_tokens != null) cached = ev.usage.cached_tokens;
      if (ev.usage.reasoning_tokens != null) reasoning_tokens = ev.usage.reasoning_tokens;
      if (ev.usage.api_duration_ms != null) apiDurationMs = ev.usage.api_duration_ms;
      if (ev.model) resolvedModel = ev.model;
    }
    // session.idle marks completion on older SDK builds.
    if (ev.type === "session.idle" && ev.model) {
      resolvedModel = ev.model;
    }
  }

  const sessionDurationMs = Date.now() - sessionStartMs;

  return {
    tokens_in,
    tokens_out,
    cached,
    reasoning_tokens,
    apiDurationMs,
    sessionDurationMs,
    model: resolvedModel,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a slice prompt through the @github/copilot-sdk CopilotClient.
 *
 * @param {object} opts
 * @param {string}   opts.prompt           The full slice prompt text.
 * @param {string}   opts.model            Model name (e.g. "gpt-5.3-codex").
 * @param {string}   opts.cwd              Working directory for the session.
 * @param {string[]} [opts.forbiddenPaths] Paths from the slice's Forbidden Actions.
 * @param {function} [opts.createSession]  Injected factory — defaults to the real SDK.
 *                                         Signature: ({ model, onPermissionRequest, onEvent }) → session.
 * @returns {Promise<object>} Worker result compatible with spawnWorker's return contract.
 */
export async function runSdkSession({
  prompt,
  model,
  cwd,
  forbiddenPaths = [],
  createSession = _defaultCreateSession,
}) {
  const sessionStartMs = Date.now();
  const collectedEvents = [];
  let outputText = "";

  const onPermissionRequest = buildPermissionHandler({ forbiddenPaths });

  function onEvent(ev) {
    collectedEvents.push(ev);
    // Accumulate assistant message text for the output field.
    if (ev.type === "assistant.message_delta" && typeof ev.text === "string") {
      outputText += ev.text;
    }
  }

  let session;
  try {
    session = await createSession({ model, onPermissionRequest, onEvent });
  } catch (err) {
    // Surface SDK-import / session-creation failures as structured errors so
    // spawnWorker can fall back to the spawn path with a single log line.
    const wrapped = new Error(`[sdk-worker] session creation failed: ${err.message}`);
    wrapped.code = err.code || "SDK_SESSION_FAILED";
    wrapped.sdkError = true;
    throw wrapped;
  }

  try {
    await session.run(prompt);
  } catch (err) {
    // Session.run failures (tool errors, permission rejections, etc.) are reported
    // as non-zero exits rather than thrown so callers get a consistent result shape.
    const tokens = extractSdkTokens(collectedEvents, model, sessionStartMs);
    return {
      output: outputText,
      stderr: String(err.message || err),
      jsonlEvents: collectedEvents,
      exitCode: 1,
      timedOut: false,
      tokens,
      worker: "sdk",
      model: tokens.model || model || "unknown",
      looksLikeHelpText: false,
    };
  } finally {
    if (typeof session.close === "function") {
      try { await session.close(); } catch { /* ignore close errors */ }
    }
  }

  const tokens = extractSdkTokens(collectedEvents, model, sessionStartMs);
  return {
    output: outputText,
    stderr: "",
    jsonlEvents: collectedEvents,
    exitCode: 0,
    timedOut: false,
    tokens,
    worker: "sdk",
    model: tokens.model || model || "unknown",
    looksLikeHelpText: false,
  };
}

// ─── Exports for testing ──────────────────────────────────────────────────────

export { buildPermissionHandler, extractSdkTokens };
