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

/** Same default as the spawn path's worker timeout. */
const DEFAULT_SDK_TIMEOUT_MS = 1_200_000;

// ─── Default SDK factory (lazy import to avoid hard dependency) ───────────────

/**
 * Start a Copilot SDK client and session rooted at the slice's working directory.
 * Returns both handles so the caller can disconnect the session and stop the client;
 * a client left running keeps its CLI child process (and the Node event loop) alive.
 */
async function _defaultCreateSession({ model, cwd, onPermissionRequest, onEvent, provider = null }) {
  if (provider) {
    // A BYOK session needs a provider baseUrl this worker does not configure, and
    // the mapped providers (image generation, Foundry) are not agent workloads.
    // Declining here makes spawnWorker keep their direct API path.
    throw Object.assign(new Error(`BYOK provider "${provider.type}" is not supported through the Copilot SDK; using the direct API`), { code: "SDK_BYOK_UNSUPPORTED" });
  }
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
  const client = new CopilotClient({ useLoggedInUser: true, workingDirectory: cwd });
  try {
    const session = await client.createSession({ model, onPermissionRequest, onEvent, workingDirectory: cwd });
    return { session, client };
  } catch (err) {
    await _stopClient(client);
    throw err;
  }
}

async function _stopClient(client) {
  if (typeof client?.stop !== "function") return;
  try {
    await client.stop();
  } catch {
    if (typeof client.forceStop === "function") {
      try { await client.forceStop(); } catch { /* best effort */ }
    }
  }
}

async function _closeSession({ session, client }) {
  const close = session?.disconnect ?? session?.close;
  if (typeof close === "function") {
    try { await close.call(session); } catch { /* ignore close errors */ }
  }
  await _stopClient(client);
}

// ─── Permission handler ───────────────────────────────────────────────────────

const DESTRUCTIVE_SHELL = [/^(rm|del|rmdir|rd)\b/i, /\brf\b/];
const APPROVE = Object.freeze({ kind: "approve-once" });
const reject = (feedback) => ({ kind: "reject", feedback });

function _isForbiddenWrite(fileName, cwd, forbiddenSet) {
  const normalised = String(fileName || "").replace(/\\/g, "/");
  const root = String(cwd || "").replace(/\\/g, "/").replace(/\/$/, "");
  const relative = root && normalised.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? normalised.slice(root.length + 1) : normalised;
  for (const forbidden of forbiddenSet) {
    if (relative === forbidden || relative.startsWith(`${forbidden}/`)) return true;
  }
  return false;
}

/**
 * Build a deliberate permission handler that honours forbiddenPaths.
 * Rejects destructive shell commands and any write to a path in the active
 * slice's Forbidden Actions; approves everything else once.
 *
 * Blanket-approval of every permission is intentionally absent — it would
 * delete the dry-run / confirmation contract required by PROJECT-PRINCIPLES.md,
 * and also throws when managed settings are enabled.
 *
 * Requests and results follow @github/copilot-sdk's PermissionHandler:
 * `{ kind: "shell", fullCommandText }`, `{ kind: "write", fileName }`, … in,
 * `{ kind: "approve-once" }` or `{ kind: "reject", feedback }` out.
 *
 * @param {{ forbiddenPaths?: string[], cwd?: string }} opts
 * @returns {function} permission handler compatible with CopilotClient.createSession
 */
function buildPermissionHandler({ forbiddenPaths = [], cwd = "" } = {}) {
  const forbiddenSet = new Set(forbiddenPaths.map((p) => p.replace(/\\/g, "/").replace(/\/$/, "")));

  return function onPermissionRequest(request) {
    if (request?.kind === "shell") {
      const cmd = String(request.fullCommandText || "").trim();
      if (DESTRUCTIVE_SHELL.some((re) => re.test(cmd))) {
        return reject("Destructive shell command rejected by Plan Forge permission handler");
      }
      return APPROVE;
    }
    if (request?.kind === "write" && _isForbiddenWrite(request.fileName, cwd, forbiddenSet)) {
      return reject(`Write to ${request.fileName} rejected — path is in the active slice's Forbidden Actions`);
    }
    return APPROVE;
  };
}

// ─── Token extraction from SDK typed events ───────────────────────────────────

function _sumUsage(events) {
  const sums = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, duration: 0, model: null };
  for (const ev of events) {
    if (ev?.type !== "assistant.usage" || !ev.data) continue;
    const d = ev.data;
    sums.calls += 1;
    for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens", "duration"]) {
      if (Number.isFinite(d[key])) sums[key] += d[key];
    }
    if (typeof d.model === "string") sums.model = d.model;
  }
  return sums;
}

/**
 * Reduce the session's typed events into the extractTokens shape. The SDK emits
 * one `assistant.usage` event per model call; a slice makes several, so they are
 * summed. Fields are null when the SDK reported no usage at all — never 0 (bug #190).
 *
 * @param {object[]} events  Typed events collected from the session.
 * @param {string|null} model  Model name from the session request.
 * @param {number} sessionStartMs  Session wall-clock start (for sessionDurationMs).
 * @returns {object} Token/cost record compatible with extractTokens.
 */
function extractSdkTokens(events, model, sessionStartMs) {
  const u = _sumUsage(events);
  const reported = u.calls > 0;
  return {
    tokens_in: reported ? u.inputTokens : null,
    tokens_out: reported ? u.outputTokens : null,
    cached: reported ? u.cacheReadTokens : null,
    // Same fields the spawn path reports, so cost-service prices cached input alike (#307).
    cache_read_tokens: u.cacheReadTokens,
    cache_creation_input_tokens: u.cacheWriteTokens,
    reasoning_tokens: reported ? u.reasoningTokens : null,
    apiDurationMs: reported ? u.duration : null,
    sessionDurationMs: Date.now() - sessionStartMs,
    model: u.model || model || null,
  };
}

/** The assistant's final messages, or its streamed deltas when no final message arrived. */
function extractSdkOutput(events) {
  const messages = events
    .filter((ev) => ev?.type === "assistant.message" && typeof ev.data?.content === "string")
    .map((ev) => ev.data.content);
  if (messages.length > 0) return messages.join("\n");
  return events
    .filter((ev) => ev?.type === "assistant.message_delta" && typeof ev.data?.deltaContent === "string")
    .map((ev) => ev.data.deltaContent)
    .join("");
}

/**
 * Worker label for cost accounting: a Copilot SDK session is billed as Copilot
 * AI credits ("sdk"); a BYOK session is billed by the vendor ("sdk-byok").
 */
function sdkWorkerLabel(provider) {
  return provider ? "sdk-byok" : "sdk";
}

// ─── BYOK provider config support ────────────────────────────────────────────

/**
 * Supported BYOK provider types for DIRECT_API_ONLY models via the SDK.
 * Any value not in this set is rejected before the session is created.
 */
const SUPPORTED_BYOK_PROVIDERS = new Set(["openai", "azure", "anthropic"]);

/**
 * Resolve the API key for a BYOK provider config at call time.
 * Keys are read from process.env only — never from literals.
 * Returns null when the env var is absent or empty (key-absent path).
 *
 * @param {{ type: string, envKey: string }} provider
 * @returns {string|null}
 */
function _resolveByokKey(provider) {
  const val = process.env[provider.envKey];
  return (val != null && val !== "") ? val : null;
}

/**
 * Validate a BYOK provider config and attach its key (to a copy — the caller's
 * object is never mutated). Returns `{ provider }`, or `{ error }` holding the
 * structured result runSdkSession returns instead of starting a session.
 */
function _resolveByokProvider(provider) {
  if (provider == null) return { provider: null };
  if (!SUPPORTED_BYOK_PROVIDERS.has(provider.type)) {
    return { error: { ok: false, error: "BYOK_UNSUPPORTED_PROVIDER", provider: provider.type, supported: [...SUPPORTED_BYOK_PROVIDERS] } };
  }
  const apiKey = _resolveByokKey(provider);
  if (apiKey === null) return { error: { ok: false, error: "BYOK_KEY_MISSING", provider: provider.type } };
  return { provider: { ...provider, apiKey } };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a slice prompt through the @github/copilot-sdk CopilotClient.
 *
 * @param {object} opts
 * @param {string}   opts.prompt            The full slice prompt text.
 * @param {string}   opts.model             Model name (e.g. "gpt-5.3-codex").
 * @param {string}   opts.cwd               Working directory for the session.
 * @param {string[]} [opts.forbiddenPaths]  Paths from the slice's Forbidden Actions.
 * @param {object}   [opts.provider]        BYOK provider config for DIRECT_API_ONLY models.
 *                                          Shape: { type: "openai"|"azure"|"anthropic", envKey: string }
 *                                          The API key is read from process.env[envKey] at call time.
 *                                          If the key is absent, returns { ok: false, error: "BYOK_KEY_MISSING" }.
 * @param {number}   [opts.timeout]         Turn timeout in ms (default: the spawn path's 20 minutes).
 * @param {function} [opts.createSession]   Injected factory — defaults to the real SDK.
 *                                          Signature: ({ model, cwd, onPermissionRequest, onEvent, provider? }) → { session, client } or session.
 * @returns {Promise<object>} Worker result compatible with spawnWorker's return contract.
 */
export async function runSdkSession({
  prompt,
  model,
  cwd,
  forbiddenPaths = [],
  provider = null,
  timeout = DEFAULT_SDK_TIMEOUT_MS,
  createSession = _defaultCreateSession,
}) {
  // Validate and resolve provider config before doing any work.
  const byok = _resolveByokProvider(provider);
  if (byok.error) return byok.error;
  provider = byok.provider;
  const sessionStartMs = Date.now();
  const collectedEvents = [];
  const onPermissionRequest = buildPermissionHandler({ forbiddenPaths, cwd });
  const onEvent = (ev) => { collectedEvents.push(ev); };

  const { session, client } = await _openSession(createSession, { model, cwd, onPermissionRequest, onEvent, provider });
  const result = (exitCode, stderr, timedOut = false) =>
    _sdkResult({ events: collectedEvents, model, sessionStartMs, provider }, { exitCode, stderr, timedOut });

  try {
    await session.sendAndWait({ prompt }, timeout);
    return result(0, "");
  } catch (err) {
    // Turn failures (tool errors, permission rejections, timeouts) are reported
    // as non-zero exits rather than thrown so callers get a consistent result shape.
    const message = String(err?.message || err);
    return result(1, message, /timed? ?out|timeout/i.test(message));
  } finally {
    await _closeSession({ session, client });
  }
}

/**
 * Create the session. SDK-import / session-creation failures surface as
 * structured errors (sdkError) so spawnWorker can fall back to the spawn path.
 * The default factory returns { session, client }; test factories may return the session alone.
 */
async function _openSession(createSession, request) {
  let handle;
  try {
    handle = await createSession(request);
  } catch (err) {
    const wrapped = new Error(`[sdk-worker] session creation failed: ${err.message}`);
    wrapped.code = err.code || "SDK_SESSION_FAILED";
    wrapped.sdkError = true;
    throw wrapped;
  }
  return { session: handle?.session ?? handle, client: handle?.client ?? null };
}

/** Worker result in spawnWorker's return contract. */
function _sdkResult({ events, model, sessionStartMs, provider }, { exitCode, stderr, timedOut }) {
  const tokens = extractSdkTokens(events, model, sessionStartMs);
  return {
    output: extractSdkOutput(events),
    stderr,
    jsonlEvents: events,
    exitCode,
    timedOut,
    tokens,
    worker: sdkWorkerLabel(provider),
    model: tokens.model || model || "unknown",
    looksLikeHelpText: false,
  };
}

// ─── Exports for testing ──────────────────────────────────────────────────────

export { buildPermissionHandler, extractSdkOutput, extractSdkTokens, SUPPORTED_BYOK_PROVIDERS };
