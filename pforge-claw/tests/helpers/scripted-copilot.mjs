import path from "node:path";
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

async function waitForBarrier(barrier, signal) {
  if (!barrier || signal?.aborted) return;
  await new Promise((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    signal?.addEventListener("abort", finish, { once: true });
    barrier.promise.then(finish);
    if (signal?.aborted) finish();
  });
}

/**
 * Create an agent-runtime-contract fixture that emits scripted lane events.
 * @param {{events?:Array<object>,result?:object,scriptsByJobType?:Record<string,Array<object>>,
 * beforeRun?:Function,onRun?:Function}} options
 */
export function createScriptedCopilot({
  events = [],
  result = {},
  scriptsByJobType = {},
  beforeRun,
  onRun,
} = {}) {
  for (const hook of [beforeRun, onRun]) {
    if (hook !== undefined && typeof hook !== "function") throw new TypeError("scripted runtime hooks must be functions");
  }
  const permissionRequests = [];
  const heldJobs = new Map();
  const activeJobs = new Set();
  const runWindows = [];
  const sessionFactory = createSessionFactory({
    defaultEvents: events,
    scriptsByJobType,
  });
  const runtime = assertAgentRuntime({
    id: "copilot-sdk",
    async run(turn) {
      const jobId = turn.jobId ?? turn.job?.id
        ?? (typeof turn.cwd === "string" ? path.basename(turn.cwd) : null);
      const barrier = jobId ? heldJobs.get(jobId) : null;
      if (jobId) {
        activeJobs.add(jobId);
        runWindows.push({
          jobId,
          cwd: turn.cwd,
          projectId: path.basename(path.dirname(turn.cwd ?? "")),
        });
      }
      try {
        await beforeRun?.(turn);
        await waitForBarrier(barrier, turn.signal);
        if (!turn.signal?.aborted) await onRun?.(turn);
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
      } finally {
        if (jobId) activeJobs.delete(jobId);
        if (barrier && heldJobs.get(jobId) === barrier) heldJobs.delete(jobId);
      }
    },
  });
  return {
    runtime,
    permissionRequests,
    createSession: sessionFactory.createSession,
    sessionFactory,
    injectDisconnectAfter: sessionFactory.injectDisconnectAfter,
    emitCanary: sessionFactory.emitCanary,
    hold(jobId) {
      if (typeof jobId !== "string" || !jobId) throw new TypeError("jobId must be a non-empty string");
      if (heldJobs.has(jobId)) throw new Error(`Job ${jobId} already has an execution barrier`);
      let release;
      const promise = new Promise((resolve) => { release = resolve; });
      heldJobs.set(jobId, { promise, release });
      return () => {
        if (!heldJobs.has(jobId)) return;
        this.release(jobId);
      };
    },
    release(jobId) {
      const barrier = heldJobs.get(jobId);
      if (!barrier) throw new Error(`Job ${jobId} has no execution barrier`);
      heldJobs.delete(jobId);
      barrier.release();
    },
    releaseAll() {
      for (const jobId of [...heldJobs.keys()]) this.release(jobId);
    },
    activeJobs,
    runWindows,
    get seq() { return sessionFactory.seq; },
  };
}
