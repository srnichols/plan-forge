import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CopilotSession } from "@github/copilot-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopilotRuntime, NULL_USAGE } from "../src/runtime/copilot-session.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIRECTORY = path.dirname(TEST_DIRECTORY);
const PROBE_DEADLINE_MS = 10_000;
const CLEANUP_DEADLINE_MS = 5_000;
const ownedChildren = new Set();

const CLOSED_TRANSPORT_PROBE = `
import { PassThrough } from "node:stream";
import { CopilotSession } from "@github/copilot-sdk";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-jsonrpc/node.js";
const { createCopilotRuntime } = await import(process.env.SDK_ABORT_RUNTIME_URL);
const input = new PassThrough();
const output = new PassThrough();
const transport = createMessageConnection(new StreamMessageReader(input), new StreamMessageWriter(output));
transport.dispose();
const session = new CopilotSession("fr04-inert-session", transport);
const controller = new AbortController();
const events = [];
const lifecycle = [];
const runtime = createCopilotRuntime({
  createSession: async ({ sessionConfig }) => {
    session.on(sessionConfig.onEvent);
    controller.abort();
    return {
      session,
      client: { stop: async () => { lifecycle.push("stop"); return []; } },
    };
  },
});
try {
  const result = await runtime.run({
    model: "configured-work-model",
    prompt: "Inspect an inert fixture.",
    cwd: process.cwd(),
    mcpServers: { forge: { type: "stdio", command: process.execPath, args: [] } },
    signal: controller.signal,
    emit: (...event) => events.push(event),
  });
  await new Promise((resolve) => setImmediate(resolve));
  process.stdout.write(JSON.stringify({
    result, events, lifecycle,
    installedAbort: session.abort === CopilotSession.prototype.abort,
    defaultUnhandledPolicy: process.listenerCount("unhandledRejection") === 0
      && !process.execArgv.some((arg) => arg.startsWith("--unhandled-rejections")),
  }));
} finally {
  input.destroy();
  output.destroy();
}
`;

async function runClosedTransportProbe() {
  const env = {
    SDK_ABORT_RUNTIME_URL: new URL("../src/runtime/copilot-session.mjs", import.meta.url).href,
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", CLOSED_TRANSPORT_PROBE], {
    cwd: PACKAGE_DIRECTORY,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    signal: AbortSignal.timeout(PROBE_DEADLINE_MS),
  });
  ownedChildren.add(child);
  let stdout = "";
  let stderr = "";
  let spawnError;
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { spawnError = error.code; });
  return new Promise((resolve) => {
    child.once("close", (code, signal) => {
      ownedChildren.delete(child);
      resolve({ code, signal, stdout, stderr, spawnError });
    });
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([...ownedChildren].map(async (child) => {
    const closed = once(child, "close");
    child.kill();
    await closed;
    ownedChildren.delete(child);
  }));
});

function createSdkFixture({
  abortRequest = async () => {},
  detachRequest = async () => ({ success: true }),
  stop = async () => [],
  forceStop = async () => {},
  cancelDuringCreate = false,
  emit,
} = {}) {
  const controller = new AbortController();
  const send = Promise.withResolvers();
  const started = Promise.withResolvers();
  const events = [];
  const calls = { requests: [], stopped: 0, forceStopped: 0 };
  let sessionConfig;
  const session = new CopilotSession("fr04-transport-fixture", {
    sendRequest(method) {
      calls.requests.push(method);
      if (method === "session.send") {
        started.resolve();
        return send.promise;
      }
      if (method === "session.abort") return abortRequest();
      if (method === "session.detach") return detachRequest();
      throw new Error("Unexpected inert transport request");
    },
  });
  const runtime = createCopilotRuntime({
    createSession: async (options) => {
      sessionConfig = options.sessionConfig;
      session.on(sessionConfig.onEvent);
      if (cancelDuringCreate) controller.abort();
      return {
        session,
        client: {
          stop: async () => { calls.stopped += 1; return stop(); },
          forceStop: async () => { calls.forceStopped += 1; return forceStop(); },
        },
      };
    },
  });
  return {
    calls, controller, events, send, started,
    event: (event) => sessionConfig.onEvent(event),
    run: () => runtime.run({
      model: "configured-work-model",
      prompt: "Inspect an inert fixture.",
      cwd: PACKAGE_DIRECTORY,
      mcpServers: { forge: { type: "stdio", command: process.execPath, args: [] } },
      signal: controller.signal,
      emit: emit ?? ((...event) => events.push(event)),
    }),
  };
}

describe("FR-04 installed SDK abort host safety", () => {
  // +2s test-runner tolerance above the owned probe deadline accommodates Windows process startup.
  it("keeps the host alive when installed SDK abort rejects on a disposed real transport", async () => {
    const probe = await runClosedTransportProbe();
    expect(probe.spawnError).toBeUndefined();
    expect(probe.signal).toBeNull();
    expect(probe.code, probe.stderr).toBe(0);
    const output = JSON.parse(probe.stdout);
    expect(output.installedAbort).toBe(true);
    expect(output.defaultUnhandledPolicy).toBe(true);
    expect(output.result).toEqual({
      ok: false,
      status: "cancelled",
      usage: NULL_USAGE,
      cleanupErrors: ["SDK_ABORT_FAILED", "SDK_DISCONNECT_FAILED"],
    });
    expect(output.events).toEqual([
      ["log", { level: "error", code: "SDK_ABORT_FAILED" }],
      ["log", { level: "error", code: "SDK_DISCONNECT_FAILED" }],
    ]);
    expect(output.lifecycle).toEqual(["stop"]);
    expect(ownedChildren.size).toBe(0);
  }, PROBE_DEADLINE_MS + 2_000);
});

describe("FR-04 bounded cancellation lifecycle", () => {
  it.each(["rejected promise", "synchronous transport throw"])(
    "preserves cancellation and sanitizes a %s from actual SDK abort",
    async (failure) => {
      const fixture = createSdkFixture({
        abortRequest: () => {
          const error = new Error("private-abort-transport-canary");
          if (failure === "synchronous transport throw") throw error;
          return Promise.reject(error);
        },
      });
      const pending = fixture.run();
      await fixture.started.promise;
      fixture.event({ type: "assistant.usage", data: { inputTokens: 0, model: "configured-work-model" } });
      fixture.controller.abort();
      const result = await pending;
      fixture.send.reject(new Error("private-late-send-canary"));
      await Promise.resolve();
      expect(result).toEqual({
        ok: false,
        status: "cancelled",
        usage: { tokensIn: 0, tokensOut: null, model: "configured-work-model" },
        cleanupErrors: ["SDK_ABORT_FAILED"],
      });
      expect(fixture.calls).toEqual({
        requests: ["session.send", "session.abort", "session.detach"],
        stopped: 1,
        forceStopped: 0,
      });
      expect(fixture.events).toEqual([
        ["cost", { tokensIn: 0, tokensOut: null, model: "configured-work-model" }],
        ["log", { level: "error", code: "SDK_ABORT_FAILED" }],
      ]);
      expect(JSON.stringify({ result, events: fixture.events })).not.toContain("canary");
    },
  );

  it("awaits the abort acknowledgement before disconnecting and stopping", async () => {
    const abort = Promise.withResolvers();
    const fixture = createSdkFixture({ abortRequest: () => abort.promise });
    const pending = fixture.run();
    await fixture.started.promise;
    fixture.controller.abort();
    await Promise.resolve();
    expect(fixture.calls.requests).toEqual(["session.send", "session.abort"]);
    expect(fixture.calls.stopped).toBe(0);
    abort.resolve();
    const result = await pending;
    fixture.send.reject(new Error("late-send-rejection"));
    await Promise.resolve();
    expect(result).toEqual({ ok: false, status: "cancelled", usage: NULL_USAGE });
    expect(fixture.calls.requests).toEqual(["session.send", "session.abort", "session.detach"]);
    expect(fixture.calls.stopped).toBe(1);
  });

  it("bounds an unacknowledged abort without waiting for send and handles its later rejection", async () => {
    vi.useFakeTimers();
    const abort = Promise.withResolvers();
    const fixture = createSdkFixture({ abortRequest: () => abort.promise });
    let settledResult;
    const pending = fixture.run().then((result) => { settledResult = result; return result; });
    await fixture.started.promise;
    fixture.controller.abort();
    await vi.advanceTimersByTimeAsync(CLEANUP_DEADLINE_MS);
    expect(settledResult).toEqual({
      ok: false, status: "cancelled", usage: NULL_USAGE, cleanupErrors: ["SDK_ABORT_FAILED"],
    });
    expect(fixture.calls.stopped).toBe(1);
    abort.reject(new Error("private-late-abort-canary"));
    fixture.send.reject(new Error("private-late-send-canary"));
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(settledResult);
    expect(fixture.events).toEqual([["log", { level: "error", code: "SDK_ABORT_FAILED" }]]);
  });

  it("requests abort only once when cancellation races with the session factory", async () => {
    const fixture = createSdkFixture({ cancelDuringCreate: true });
    expect(await fixture.run()).toEqual({ ok: false, status: "cancelled", usage: NULL_USAGE });
    expect(fixture.calls).toEqual({
      requests: ["session.abort", "session.detach"], stopped: 1, forceStopped: 0,
    });
  });

  it("fences late SDK callbacks during abort cleanup and after the cancelled result", async () => {
    const abort = Promise.withResolvers();
    const fixture = createSdkFixture({ abortRequest: () => abort.promise });
    const pending = fixture.run();
    await fixture.started.promise;
    fixture.event({ type: "assistant.message_delta", data: { deltaContent: "before cancellation" } });
    fixture.controller.abort();
    fixture.event({ type: "assistant.message", data: { content: "late response" } });
    fixture.event({ type: "assistant.usage", data: { inputTokens: 99, outputTokens: 42 } });
    abort.resolve();
    const result = await pending;
    fixture.event({ type: "assistant.message_delta", data: { deltaContent: "after cleanup" } });
    fixture.event({ type: "assistant.usage", data: { inputTokens: 1 } });
    fixture.send.reject(new Error("late-send-rejection"));
    await Promise.resolve();
    expect(result).toEqual({ ok: false, status: "cancelled", usage: NULL_USAGE });
    expect(fixture.events).toEqual([["progress", { text: "before cancellation" }]]);
  });

  it("retains the cancelled outcome through abort, disconnect, stop, and reporting failures", async () => {
    const fixture = createSdkFixture({
      abortRequest: async () => { throw new Error("private-abort-canary"); },
      detachRequest: async () => { throw new Error("private-detach-canary"); },
      stop: async () => [new Error("private-stop-canary")],
      forceStop: async () => { throw new Error("private-force-canary"); },
      emit: () => { throw new Error("private-sink-canary"); },
    });
    const pending = fixture.run();
    await fixture.started.promise;
    fixture.controller.abort();
    const result = await pending;
    fixture.send.reject(new Error("late-send-rejection"));
    await Promise.resolve();
    expect(result).toEqual({
      ok: false,
      status: "cancelled",
      usage: NULL_USAGE,
      cleanupErrors: [
        "SDK_ABORT_FAILED", "SDK_CLEANUP_REPORT_FAILED", "SDK_DISCONNECT_FAILED",
        "SDK_STOP_FAILED", "SDK_FORCE_STOP_FAILED",
      ],
    });
    expect(fixture.calls.stopped).toBe(1);
    expect(fixture.calls.forceStopped).toBe(1);
    expect(JSON.stringify(result)).not.toContain("canary");
  });
});
