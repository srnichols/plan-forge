import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClawError } from "../src/errors.mjs";
import {
  COPILOT_TOKEN_SECRET,
  createCopilotRuntime,
  createUsageAccumulator,
  denyAllPermissions,
  mapSdkEvent,
  NULL_USAGE,
  toSessionMcpServers,
} from "../src/runtime/copilot-session.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SESSION_SOURCE = readFileSync(
  path.join(TEST_DIRECTORY, "../src/runtime/copilot-session.mjs"),
  "utf8",
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSessionFactory({ events = [], sendError, stoppedError, onSend } = {}) {
  const calls = {};
  calls.createSession = async ({ clientOptions, sessionConfig }) => {
    calls.clientOptions = clientOptions;
    calls.sessionConfig = sessionConfig;
    for (const event of events) sessionConfig.onEvent(event);
    return {
      client: {
        stop: async () => {
          calls.stopped = true;
          if (stoppedError) throw stoppedError;
        },
        forceStop: async () => {
          calls.forceStopped = true;
        },
      },
      session: {
        sendAndWait: async (...args) => {
          calls.sendArgs = args;
          if (onSend) await onSend(calls.session);
          if (sendError) throw sendError;
        },
        abort: () => {
          calls.aborted = true;
          calls.abortSignal?.resolve();
        },
        disconnect: async () => {
          calls.disconnected = true;
        },
      },
    };
  };
  return calls;
}

function validTurn(overrides = {}) {
  return {
    jobId: "job-a",
    prompt: "Run the requested task.",
    model: "configured-model",
    cwd: "C:\\workspace\\project",
    mcpServers: { forge: { type: "stdio", command: "node", args: [] } },
    emit: () => {},
    ...overrides,
  };
}

describe("SDK event mapping", () => {
  it.each([
    ["assistant.message_delta", { text: "progress" }, "progress"],
    ["assistant.message", { content: "message" }, "progress"],
    ["tool.execution_start", { toolName: "read" }, "log"],
    ["tool.execution_complete", { toolName: "read", success: true }, "log"],
    ["assistant.usage", { tokensIn: 1 }, "cost"],
    ["user_input.requested", { kind: "question" }, "needs-input"],
    ["elicitation.requested", { kind: "form" }, "needs-input"],
    ["session.error", { code: "SESSION_FAILED" }, "log"],
  ])("maps %s", (type, data, expectedType) => {
    expect(mapSdkEvent({ type, data }).type).toBe(expectedType);
  });

  it("drops unrelated events and truncates progress", () => {
    expect(mapSdkEvent({ type: "session.idle" })).toBeNull();
    expect(mapSdkEvent({
      type: "assistant.message",
      data: { content: "x".repeat(2500) },
    }).data.text).toHaveLength(2000);
    expect(mapSdkEvent({
      type: "assistant.message_delta",
      data: { deltaContent: "stream chunk" },
    })).toEqual({ type: "progress", data: { text: "stream chunk" } });
    expect(mapSdkEvent({
      type: "assistant.usage",
      data: { inputTokens: 7, outputTokens: 5 },
    }).data).toEqual({ tokensIn: 7, tokensOut: 5, model: null });
  });

  it("accumulates reported usage without converting missing values to zero", () => {
    const usage = createUsageAccumulator();
    expect(usage.result()).toEqual(NULL_USAGE);
    usage.add({ type: "assistant.usage", data: { tokensIn: 4, model: "model-a" } });
    expect(usage.result()).toEqual({ tokensIn: 4, tokensOut: null, model: "model-a" });
    usage.add({ type: "assistant.usage", data: { tokensIn: 0, tokensOut: 3, model: "model-b" } });
    expect(usage.result()).toEqual({ tokensIn: 4, tokensOut: 3, model: "model-b" });
    usage.add({ type: "assistant.usage", data: { tokensIn: 2 } });
    expect(usage.result()).toEqual({ tokensIn: 6, tokensOut: 3, model: "model-b" });
    usage.add({ type: "assistant.usage", data: { inputTokens: 2, outputTokens: 1 } });
    expect(usage.result()).toEqual({ tokensIn: 8, tokensOut: 4, model: "model-b" });
  });
});

describe("Copilot session runtime", () => {
  it("forwards model, MCP config, permissions, events, and token credentials", async () => {
    const calls = makeSessionFactory({
      events: [
        { type: "assistant.message_delta", data: { text: "hello" } },
        { type: "assistant.usage", data: { tokensIn: 3, tokensOut: 2, model: "model-a" } },
      ],
    });
    const emitted = [];
    const runtime = createCopilotRuntime({
      createSession: calls.createSession,
      secrets: { get: (name) => name === COPILOT_TOKEN_SECRET ? "canary-token-xyz" : null },
    });
    const turn = validTurn({ emit: (...event) => emitted.push(event) });
    const result = await runtime.run(turn);
    expect(calls.clientOptions).toEqual({
      workingDirectory: turn.cwd,
      gitHubToken: "canary-token-xyz",
    });
    expect(calls.sessionConfig).toMatchObject({
      model: turn.model,
      workingDirectory: turn.cwd,
      mcpServers: turn.mcpServers,
    });
    expect(calls.sendArgs[0]).toEqual({ prompt: turn.prompt });
    expect(emitted).toEqual([
      ["progress", { text: "hello" }],
      ["cost", { tokensIn: 3, tokensOut: 2, model: "model-a" }],
    ]);
    expect(result).toMatchObject({
      ok: true,
      status: "succeeded",
      usage: { tokensIn: 3, tokensOut: 2, model: "model-a" },
    });
    expect(JSON.stringify(result)).not.toContain("canary-token-xyz");
  });

  it("uses logged-in authentication by default and rejects permission requests", async () => {
    const calls = makeSessionFactory();
    const runtime = createCopilotRuntime({ createSession: calls.createSession });
    await runtime.run(validTurn());
    expect(calls.clientOptions).toEqual({
      workingDirectory: "C:\\workspace\\project",
      useLoggedInUser: true,
    });
    expect(calls.sessionConfig.onPermissionRequest({ kind: "write" })).toEqual({
      kind: "reject",
      feedback: "no permission policy configured",
    });
    expect(denyAllPermissions({ kind: "shell" }).kind).toBe("reject");
  });

  it("passes an injected permission policy and BYOK provider through", async () => {
    const calls = makeSessionFactory();
    const policy = () => ({ kind: "reject", feedback: "custom" });
    const provider = { type: "openai", baseUrl: "https://byok.example", apiKey: "canary-key-xyz" };
    const runtime = createCopilotRuntime({
      createSession: calls.createSession,
      provider,
      secrets: { get: () => "unused-token" },
    });
    await runtime.run(validTurn({ onPermissionRequest: policy }));
    expect(calls.clientOptions).toEqual({ workingDirectory: "C:\\workspace\\project" });
    expect(calls.sessionConfig.provider).toBe(provider);
    expect(calls.sessionConfig.onPermissionRequest).toBe(policy);
  });

  it("fails early for missing model or MCP config", async () => {
    let calls = 0;
    const runtime = createCopilotRuntime({
      createSession: async () => {
        calls += 1;
        return {};
      },
    });
    await expect(runtime.run(validTurn({ model: undefined }))).rejects.toMatchObject({
      code: "MODEL_MISSING",
    });
    await expect(runtime.run(validTurn({ mcpServers: {} }))).rejects.toMatchObject({
      code: "MCP_ENTRY_MISSING",
    });
    expect(calls).toBe(0);
    expect(() => toSessionMcpServers({ launch: {} })).toThrow("MCP_ENTRY_MISSING");
  });

  it("preserves runtime errors, cleans up, and force-stops when stop fails", async () => {
    const original = new ClawError("SESSION_BROKE");
    const calls = makeSessionFactory({ sendError: original, stoppedError: new Error("cleanup") });
    const runtime = createCopilotRuntime({ createSession: calls.createSession });
    const result = await runtime.run(validTurn());
    expect(result).toMatchObject({ ok: false, status: "failed", error: "SESSION_BROKE" });
    expect(calls.disconnected).toBe(true);
    expect(calls.stopped).toBe(true);
    expect(calls.forceStopped).toBe(true);
  });

  it("returns cancelled when the active session is aborted", async () => {
    const send = deferred();
    const aborted = deferred();
    const calls = makeSessionFactory({
      onSend: async (session) => {
        calls.abortSignal = aborted;
        await Promise.race([send.promise, aborted.promise]);
        void session;
      },
    });
    const controller = new AbortController();
    const runtime = createCopilotRuntime({ createSession: calls.createSession });
    const resultPromise = runtime.run(validTurn({ signal: controller.signal }));
    await Promise.resolve();
    controller.abort();
    const result = await resultPromise;
    expect(calls.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, status: "cancelled", usage: NULL_USAGE });
  });

  it("handles pre-aborted turns and absent usage events", async () => {
    const calls = makeSessionFactory();
    const runtime = createCopilotRuntime({ createSession: calls.createSession });
    const controller = new AbortController();
    controller.abort();
    expect(await runtime.run(validTurn({ signal: controller.signal }))).toMatchObject({
      status: "cancelled",
      usage: NULL_USAGE,
    });
    expect((await runtime.run(validTurn())).usage).toEqual(NULL_USAGE);
  });
});

describe("Guard: copilot session contains no forbidden execution shortcuts", () => {
  it("keeps both forbidden tokens out of the runtime source", () => {
    expect(SESSION_SOURCE).not.toContain(["approve", "All"].join(""));
    expect(SESSION_SOURCE).not.toContain(["for", "InProcess"].join(""));
  });
});
