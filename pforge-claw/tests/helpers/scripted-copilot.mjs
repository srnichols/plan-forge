import { assertAgentRuntime } from "../../src/runtime/agent-runtime.mjs";

export function createSessionFactory({
  scriptsByJobType = {},
  defaultEvents = [],
} = {}) {
  let seq = 0;
  let disconnectAfter = null;
  const emitted = [];

  async function createSession({ sessionConfig }) {
    const events = scriptsByJobType[sessionConfig.jobType] ?? defaultEvents;
    const session = {
      async sendAndWait() {
        for (const scripted of events) {
          seq += 1;
          if (disconnectAfter !== null && seq > disconnectAfter) {
            throw new Error("SCRIPTED_DISCONNECT");
          }
          const event = {
            type: scripted.type,
            data: { ...(scripted.data ?? {}), seq },
          };
          emitted.push(event);
          sessionConfig.onEvent?.(event);
        }
      },
      async disconnect() {},
    };
    return { client: { async stop() {} }, session };
  }

  return {
    createSession,
    emitted,
    get seq() { return seq; },
    injectDisconnectAfter(sequence) {
      if (!Number.isInteger(sequence) || sequence < 0) throw new TypeError("sequence must be a non-negative integer");
      disconnectAfter = sequence;
    },
    emitCanary(secret, sessionConfig) {
      if (typeof secret !== "string" || !secret) throw new TypeError("secret must be a non-empty string");
      const event = { type: "assistant.message_delta", data: { deltaContent: secret, seq: ++seq } };
      emitted.push(event);
      sessionConfig?.onEvent?.(event);
      return event;
    },
  };
}

export async function createSession(options) {
  return createSessionFactory().createSession(options);
}

/**
 * Create an agent-runtime-contract fixture that emits scripted lane events.
 * @param {{events?:Array<object>,result?:object,scriptsByJobType?:Record<string,Array<object>>}} options
 */
export function createScriptedCopilot({
  events = [],
  result = {},
  scriptsByJobType = {},
} = {}) {
  const permissionRequests = [];
  const sessionFactory = createSessionFactory({
    defaultEvents: events,
    scriptsByJobType,
  });
  const runtime = assertAgentRuntime({
    id: "copilot-sdk",
    async run(turn) {
      const scriptedEvents = scriptsByJobType[turn.jobType] ?? events;
      for (const event of scriptedEvents) {
        turn.emit?.(event.type, event.data ?? {});
        sessionFactory.emitted.push(event);
      }
      if (turn.signal?.aborted) {
        return { ok: false, status: "cancelled", usage: { inputTokens: null, outputTokens: null, costUSD: null } };
      }
      if (typeof turn.onPermissionRequest === "function") {
        permissionRequests.push(await turn.onPermissionRequest({
          toolName: "fixture-tool",
          arguments: {},
        }));
      }
      return {
        ok: true,
        status: "succeeded",
        usage: { inputTokens: 10, outputTokens: 5, costUSD: 0 },
        ...result,
      };
    },
  });
  return {
    runtime,
    permissionRequests,
    createSession: sessionFactory.createSession,
    sessionFactory,
    injectDisconnectAfter: sessionFactory.injectDisconnectAfter,
    emitCanary: sessionFactory.emitCanary,
    get seq() { return sessionFactory.seq; },
  };
}
