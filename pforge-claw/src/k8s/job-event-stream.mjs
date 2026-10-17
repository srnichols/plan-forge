import { ClawError } from "../errors.mjs";
import { LANE_EVENT_TYPES } from "../enums.mjs";
import { L2_SYNC_INCOMPLETE } from "../memory/l2-sync.mjs";
import { L2_PACKET_KIND } from "../protocol/messages.mjs";

const FAILURE_DRAIN_CHECKPOINT_MS = 0;
const CONNECT_TIMEOUT_REASON = "worker-connect-timeout";

function createQueue() {
  const pending = [];
  let wake;
  return {
    push(value) {
      if (!wake) { pending.push(value); return; }
      const resolve = wake;
      wake = null;
      resolve(value);
    },
    take() {
      return pending.length ? Promise.resolve(pending.shift()) : new Promise((resolve) => { wake = resolve; });
    },
  };
}

function recordFailure(state, error, fallback) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : fallback;
  state.options.onError?.({ code, reason: code });
}

function terminal(state, data, event) {
  if (state.terminalSent) return;
  const isIncomplete = state.transferOpen && (state.failure || !event);
  const finalData = isIncomplete ? { ...data, status: "failed", reason: L2_SYNC_INCOMPLETE } : data;
  if (isIncomplete) state.options.onIncomplete?.();
  state.terminalSent = true;
  clearTimeout(state.connectTimer);
  clearTimeout(state.finalTimer);
  clearTimeout(state.closeTimer);
  state.queue.push(event
    ? { ...event, data: finalData }
    : {
      v: 1, jobId: state.options.jobId, seq: state.lastSeq + 1,
      ts: new Date(state.options.now()).toISOString(), type: "finished", data: finalData,
    });
}

function closeSource(state) {
  state.closing ??= Promise.resolve().then(() => state.options.source.return?.()).catch((error) => {
    recordFailure(state, error, "WORKER_STREAM_CLOSE");
    terminal(state, state.failure ?? { status: "failed", reason: "worker-stream-close" });
  });
  return state.closing;
}

function requestFailure(state, data) {
  if (state.terminalSent || state.failure) return;
  state.failure = data;
  // Already-buffered source.next() promises drain before this next-turn close, so watch failures cannot overtake artifacts.
  state.closeTimer = setTimeout(() => { void closeSource(state); }, FAILURE_DRAIN_CHECKPOINT_MS);
}

function createState(options) {
  const state = {
    options, queue: createQueue(), watcher: new AbortController(),
    lastSeq: 0, started: false, terminalSent: false, transferOpen: false,
    failure: null, closing: null, connectTimer: null, finalTimer: null, closeTimer: null,
  };
  state.connectTimer = setTimeout(() => {
    if (state.started || state.terminalSent) return;
    void options.onConnectionTimeout?.();
    requestFailure(state, { status: "failed", reason: CONNECT_TIMEOUT_REASON });
  }, options.connectTimeoutMs);
  state.connectTimer.unref?.();
  return state;
}

function markStarted(state) {
  state.started = true;
  clearTimeout(state.connectTimer);
  state.options.onStarted?.();
}

function validateWorkerEvent(event, jobId) {
  if (event?.jobId !== jobId || !Number.isSafeInteger(event.seq) || event.seq < 1
    || !LANE_EVENT_TYPES.includes(event.type)) throw new ClawError("WORKER_EVENT_INVALID");
}

function acceptWorkerEvent(state, event) {
  validateWorkerEvent(event, state.options.jobId);
  if (event.seq <= state.lastSeq) return true;
  state.lastSeq = event.seq;
  if (event.type === "started") markStarted(state);
  if (event.type === "artifact" && event.data?.kind === L2_PACKET_KIND) state.transferOpen = true;
  if (event.type === "finished") {
    terminal(state, state.failure ?? event.data, event);
    return false;
  }
  state.queue.push(event);
  return true;
}

async function pumpWorker(state) {
  try {
    while (!state.terminalSent) {
      const next = await state.options.source.next();
      if (next.done || !acceptWorkerEvent(state, next.value)) break;
    }
  } catch (error) {
    recordFailure(state, error, "WORKER_STREAM");
    state.failure ??= { status: "failed", reason: "worker-stream-failed" };
  } finally {
    if (!state.terminalSent) terminal(state, state.failure ?? { status: "failed", reason: "worker-stream-ended" });
  }
}

function watchStatus(state, object) {
  const failed = object?.status?.conditions?.find((condition) => condition.type === "Failed" && condition.status === "True");
  if (failed) {
    requestFailure(state, { status: "failed", reason: failed.reason === "DeadlineExceeded" ? "deadline" : "pod-failed" });
    return false;
  }
  const complete = object?.status?.conditions?.some((condition) => condition.type === "Complete" && condition.status === "True");
  if (complete && !state.finalTimer) {
    state.finalTimer = setTimeout(() => {
      requestFailure(state, { status: "failed", reason: "no-final-event" });
    }, state.options.finalTimeoutMs);
    state.finalTimer.unref?.();
  }
  return true;
}

async function pumpWatch(state) {
  try {
    for await (const event of state.options.watch({ signal: state.watcher.signal })) {
      if (state.watcher.signal.aborted || state.terminalSent || !watchStatus(state, event?.object)) break;
    }
  } catch (error) {
    if (state.watcher.signal.aborted) return;
    recordFailure(state, error, "K8S_WATCH");
    requestFailure(state, { status: "failed", reason: "watch-failed" });
  }
}

/**
 * Merge worker and Kubernetes status without allowing status failures to precede buffered LaneEvents.
 * The worker protocol, not a Kubernetes completion condition, owns success and application acknowledgement.
 * @param {{jobId: string, source: AsyncIterator<object>, watch: Function, now: Function,
 *   connectTimeoutMs: number, finalTimeoutMs: number, onStarted?: Function, onError?: Function,
 *   onIncomplete?: Function, onConnectionTimeout?: Function}} options
 * @returns {AsyncGenerator<object>}
 */
export async function* streamJobEvents(options) {
  const state = createState(options);
  void pumpWorker(state);
  void pumpWatch(state);
  try {
    while (true) {
      const event = await state.queue.take();
      yield event;
      if (event.type === "finished") return;
    }
  } finally {
    state.watcher.abort();
    clearTimeout(state.connectTimer);
    clearTimeout(state.finalTimer);
    clearTimeout(state.closeTimer);
    await closeSource(state);
  }
}
