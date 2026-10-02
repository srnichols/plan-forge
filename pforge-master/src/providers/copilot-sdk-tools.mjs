/**
 * Plan Forge — Forge-Master GitHub Copilot SDK provider.
 *
 * Restores the zero-vendor-key path for Forge-Master by using the Copilot SDK
 * runtime that ships with the sibling pforge-mcp package. The SDK owns the
 * tool loop, so this adapter exposes runLoop() instead of a turn-level
 * Chat-Completions sendTurn().
 *
 * @module forge-master/providers/copilot-sdk-tools
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PFORGE_MCP_PACKAGE = resolve(__dirname, "..", "..", "..", "pforge-mcp", "package.json");
const DEFAULT_MODEL = "claude-sonnet-5.5";
const DEFAULT_MAX_TOOL_CALLS = 5;
const SEND_TIMEOUT_MS = 120_000;
const COPILOT_TOKEN_ENV = ["COPILOT_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];

let sdkEntryCache;
let sdkModulePromise;

function resolveSdkEntry() {
  if (sdkEntryCache !== undefined) return sdkEntryCache;
  try {
    sdkEntryCache = createRequire(PFORGE_MCP_PACKAGE).resolve("@github/copilot-sdk");
  } catch {
    sdkEntryCache = null;
  }
  return sdkEntryCache;
}

async function loadSdkModule() {
  const entry = resolveSdkEntry();
  if (!entry) {
    throw Object.assign(new Error("@github/copilot-sdk is not installed in pforge-mcp"), {
      code: "COPILOT_SDK_UNAVAILABLE",
    });
  }
  sdkModulePromise ??= import(pathToFileURL(entry).href);
  return sdkModulePromise;
}

function hasTokenEnv(env = process.env) {
  return COPILOT_TOKEN_ENV.some((name) => typeof env[name] === "string" && env[name].trim().length > 0);
}

function hasExecutableOnPath(command, env = process.env) {
  const pathValue = env.PATH || env.Path || env.path || "";
  if (!pathValue) return false;
  const extensions = process.platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = resolve(dir, process.platform === "win32" ? `${command}${ext}` : command);
      if (existsSync(candidate)) return true;
    }
  }
  return false;
}

function hasCopilotCredentialSource(env = process.env) {
  return hasTokenEnv(env) || hasExecutableOnPath("copilot", env) || hasExecutableOnPath("gh", env);
}

function resolveGitHubToken(env = process.env) {
  for (const name of COPILOT_TOKEN_ENV) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function isAvailable({ env = process.env } = {}) {
  return Boolean(resolveSdkEntry()) && hasCopilotCredentialSource(env);
}

export function _resetSdkCacheForTests() {
  sdkEntryCache = undefined;
  sdkModulePromise = undefined;
}

function denyAllPermissions(request) {
  const kind = request?.kind || "unknown";
  return { kind: "reject", feedback: `Forge-Master denies SDK permission requests (${kind}).` };
}

function buildAvailableTools(toolNames, ToolSet) {
  const set = new ToolSet();
  for (const name of toolNames) set.addCustom(name);
  return set;
}

function summarizeToolResult(result) {
  if (result == null) return "no result";
  if (typeof result === "string") return result;
  if (typeof result.error === "string") return result.error;
  if (typeof result.summary === "string") return result.summary;
  if (typeof result.result === "string") return result.result;
  try { return JSON.stringify(result); } catch { return String(result); }
}

function makeToolResult(summary, ok) {
  return {
    textResultForLlm: summary,
    resultType: ok ? "success" : "failure",
    ...(ok ? {} : { error: summary }),
  };
}

function toPrompt(messages) {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg) => {
      if (msg.role === "tool_result") return `Tool result (${msg.toolCallId || "unknown"}): ${msg.content || ""}`;
      return `${msg.role || "user"}: ${msg.content || ""}`;
    })
    .join("\n\n");
}

function extractUsage(events, fallbackModel) {
  let tokensIn = 0;
  let tokensOut = 0;
  let model = fallbackModel || DEFAULT_MODEL;
  for (const event of events) {
    if (event?.type !== "assistant.usage") continue;
    const data = event.data || {};
    if (Number.isFinite(data.inputTokens)) tokensIn += data.inputTokens;
    if (Number.isFinite(data.outputTokens)) tokensOut += data.outputTokens;
    if (typeof data.model === "string") model = data.model;
  }
  return { tokensIn, tokensOut, model };
}

function extractReply(response, events) {
  const direct = response?.data?.content ?? response?.content;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const messages = events
    .filter((event) => event?.type === "assistant.message" && typeof event.data?.content === "string")
    .map((event) => event.data.content);
  if (messages.length > 0) return messages.join("\n");
  const deltas = events
    .filter((event) => event?.type === "assistant.message_delta" && typeof event.data?.deltaContent === "string")
    .map((event) => event.data.deltaContent);
  return deltas.join("");
}

async function defaultCreateSession({ model, system, tools, availableTools, onPermissionRequest, onEvent, workingDirectory, CopilotClientClass = null }) {
  const { CopilotClient } = CopilotClientClass ? { CopilotClient: CopilotClientClass } : await loadSdkModule();
  const token = resolveGitHubToken();
  const client = new CopilotClient({
    ...(token ? { gitHubToken: token, useLoggedInUser: false } : { useLoggedInUser: true }),
    workingDirectory,
  });
  try {
    const session = await client.createSession({
      model,
      tools,
      availableTools,
      excludedTools: ["builtin:*", "mcp:*"],
      toolSearch: { enabled: false },
      systemMessage: { mode: "append", content: system || "" },
      skipCustomInstructions: true,
      enableSessionStore: false,
      onPermissionRequest,
      onEvent,
      workingDirectory,
    });
    return { client, session };
  } catch (err) {
    if (typeof client.stop === "function") {
      try { await client.stop(); } catch {
        if (typeof client.forceStop === "function") {
          try { await client.forceStop(); } catch { /* ignore cleanup */ }
        }
      }
    } else if (typeof client.forceStop === "function") {
      try { await client.forceStop(); } catch { /* ignore cleanup */ }
    }
    throw err;
  }
}

function buildSdkTools({ defineTool, toolSchemas, dispatchTool, maxToolCalls, calls }) {
  let reservedToolCalls = 0;
  return toolSchemas.map((schema) => defineTool(schema.name, {
    description: schema.description || `Plan Forge tool: ${schema.name}`,
    parameters: schema.parameters || { type: "object", properties: {}, additionalProperties: true },
    skipPermission: true,
    defer: "never",
    handler: async (args) => {
      if (reservedToolCalls >= maxToolCalls) {
        const result = { error: "tool_budget_exceeded", summary: "tool budget exceeded — call was not executed" };
        calls.push({ name: schema.name, args: args || {}, result });
        return makeToolResult(result.summary, false);
      }
      reservedToolCalls++;
      const result = await dispatchTool(schema.name, args || {});
      calls.push({ name: schema.name, args: args || {}, result });
      return makeToolResult(summarizeToolResult(result), !result?.error);
    },
  }));
}

function validateRunLoopInput({ dispatchTool, signal }) {
  if (typeof dispatchTool !== "function") {
    throw Object.assign(new Error("dispatchTool is required"), { code: "COPILOT_SDK_BAD_INPUT" });
  }
  if (signal?.aborted) throw Object.assign(new Error("Copilot SDK turn aborted"), { code: "ABORT_ERR" });
}

async function buildRunLoopContext({ sdk, tools, dispatchTool, maxToolCalls, model }) {
  const sdkModule = sdk || await loadSdkModule();
  const calls = [];
  const events = [];
  const selectedModel = model || DEFAULT_MODEL;
  const toolNames = tools.map((tool) => tool.name);
  const sdkTools = buildSdkTools({
    defineTool: sdkModule.defineTool,
    toolSchemas: tools,
    dispatchTool,
    maxToolCalls,
    calls,
  });
  const availableTools = buildAvailableTools(toolNames, sdkModule.ToolSet);
  const onEvent = (event) => events.push(event);
  return { calls, events, selectedModel, sdkTools, availableTools, onEvent };
}

function buildCreateSessionRequest({ selectedModel, system, sdkTools, availableTools, onEvent, cwd }) {
  return {
    model: selectedModel,
    system,
    tools: sdkTools,
    availableTools,
    excludedTools: ["builtin:*", "mcp:*"],
    toolSearch: { enabled: false },
    onPermissionRequest: denyAllPermissions,
    onEvent,
    workingDirectory: cwd,
  };
}

async function startSdkSession({ createSession, request }) {
  try {
    return await createSession(request);
  } catch (err) {
    throw Object.assign(new Error(`Copilot SDK session start failed: ${err?.message ?? err}`), {
      code: "COPILOT_SDK_SESSION_FAILED",
      cause: err,
    });
  }
}

async function sendPromptAndBuildResult({ session, messages, events, calls, selectedModel }) {
  const response = await session.sendAndWait({ prompt: toPrompt(messages) }, SEND_TIMEOUT_MS);
  const usage = extractUsage(events, selectedModel);
  return {
    reply: extractReply(response, events),
    toolCalls: calls,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    model: usage.model,
  };
}

async function cleanupSdkHandle({ session, client }) {
  if (typeof session?.disconnect === "function") {
    try { await session.disconnect(); } catch { /* ignore cleanup */ }
  } else if (typeof session?.close === "function") {
    try { await session.close(); } catch { /* ignore cleanup */ }
  }
  if (typeof client?.stop === "function") {
    try { await client.stop(); } catch { /* ignore cleanup */ }
  }
}

function normalizeRunLoopOptions(options) {
  return {
    system: options.system ?? "",
    messages: options.messages ?? [],
    tools: options.tools ?? [],
    dispatchTool: options.dispatchTool,
    maxToolCalls: options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS,
    model: options.model ?? DEFAULT_MODEL,
    signal: options.signal,
    cwd: options.cwd ?? process.cwd(),
    createSession: options.createSession ?? defaultCreateSession,
    sdk: options.sdk ?? null,
  };
}

export async function runLoop(options = {}) {
  const {
    system,
    messages,
    tools,
    dispatchTool,
    maxToolCalls,
    model,
    signal,
    cwd,
    createSession,
    sdk,
  } = normalizeRunLoopOptions(options);
  validateRunLoopInput({ dispatchTool, signal });
  const context = await buildRunLoopContext({ sdk, tools, dispatchTool, maxToolCalls, model });
  const request = buildCreateSessionRequest({ ...context, system, cwd });
  const handle = await startSdkSession({ createSession, request });

  const session = handle?.session ?? handle;
  const client = handle?.client ?? null;
  try {
    return await sendPromptAndBuildResult({ session, messages, ...context });
  } finally {
    await cleanupSdkHandle({ session, client });
  }
}

export { denyAllPermissions as _denyAllPermissions };
export { defaultCreateSession as _defaultCreateSessionForTests, extractUsage as _extractUsageForTests };

export const DEFAULT_COPILOT_MODEL = DEFAULT_MODEL;
export const PROVIDER_NAME = "githubCopilot";
