import { ClawError } from "../../errors.mjs";

const DEFAULT_PER_CHAT_MS = 1000;
const DEFAULT_GROUP_LIMIT = 20;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

export function createChatLimiter({
  perChatMs = DEFAULT_PER_CHAT_MS,
  perGroupPerMinute = DEFAULT_GROUP_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
  isGroup = (chatId) => Number(chatId) < 0,
  now = Date.now,
  sleep,
} = {}) {
  const states = new Map();
  let closed = false;
  let wakeClosed;
  const closeSignal = new Promise((resolve) => { wakeClosed = resolve; });

  function cancelExpiry(state) {
    if (state.expiryTimer === null) return;
    clearTimeout(state.expiryTimer);
    state.expiryTimer = null;
  }

  function stateFor(chatId) {
    const key = String(chatId);
    if (!states.has(key)) {
      states.set(key, {
        key, queue: [], running: false, lastSentAt: null, sentAt: [], pauseUntil: 0, expiryTimer: null,
      });
    }
    const state = states.get(key);
    cancelExpiry(state);
    return state;
  }

  function cleanup(state) {
    cancelExpiry(state);
    if (state.running || state.queue.length > 0) return;
    const current = now();
    state.sentAt = state.sentAt.filter((timestamp) => current - timestamp < windowMs);
    const chatExpiry = state.lastSentAt === null ? current : state.lastSentAt + perChatMs;
    const groupExpiry = state.sentAt.length > 0 ? state.sentAt.at(-1) + windowMs : current;
    const expiresAt = Math.max(chatExpiry, groupExpiry, state.pauseUntil);
    if (closed || expiresAt <= current) {
      states.delete(state.key);
      return;
    }
    state.expiryTimer = setTimeout(() => cleanup(state), Math.min(expiresAt - current, MAX_TIMER_DELAY_MS));
    state.expiryTimer.unref?.();
  }

  function eligibleAt(state, group) {
    const current = now();
    state.sentAt = state.sentAt.filter((timestamp) => current - timestamp < windowMs);
    const chatReady = state.lastSentAt === null ? current : state.lastSentAt + perChatMs;
    const groupReady = group && state.sentAt.length >= perGroupPerMinute
      ? state.sentAt[0] + windowMs
      : current;
    return Math.max(current, state.pauseUntil, chatReady, groupReady);
  }

  async function waitForEligibility(state, item) {
    while (!closed) {
      const delay = eligibleAt(state, item.group) - now();
      if (delay <= 0) return true;
      await waitDelay(delay);
    }
    return false;
  }

  async function waitDelay(milliseconds) {
    if (sleep) {
      await Promise.race([sleep(milliseconds), closeSignal]);
      return;
    }
    let timer;
    try {
      await Promise.race([
        new Promise((resolve) => { timer = setTimeout(resolve, Math.min(milliseconds, MAX_TIMER_DELAY_MS)); }),
        closeSignal,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function recordSuccess(state, item) {
    const sent = now();
    state.lastSentAt = sent;
    if (item.group) state.sentAt.push(sent);
  }

  function recordFailure(state, error) {
    const retryAfterMs = error?.details?.retryAfterMs;
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      state.pauseUntil = Math.max(state.pauseUntil, now() + retryAfterMs);
    }
  }

  function startDrain(state) {
    state.running = true;
    state.drainPromise = drain(state);
  }

  async function drain(state) {
    try {
      while (state.queue.length > 0 && !closed) {
        const item = state.queue[0];
        if (!(await waitForEligibility(state, item))) break;
        state.queue.shift();
        try {
          const value = await item.fn();
          recordSuccess(state, item);
          for (const waiter of item.waiters) waiter.resolve(value);
        } catch (error) {
          recordFailure(state, error);
          for (const waiter of item.waiters) waiter.reject(error);
        }
      }
    } finally {
      state.running = false;
      if (state.queue.length > 0 && !closed) {
        startDrain(state);
      } else {
        cleanup(state);
      }
    }
  }

  function enqueue(chatId, fn, { key, group } = {}) {
    if (closed) return Promise.reject(new ClawError("LIMITER_CLOSED"));
    if (typeof fn !== "function") return Promise.reject(new ClawError("LIMITER_BAD_TASK"));
    const state = stateFor(chatId);
    const deferred = makeDeferred();
    const coalesced = key === undefined ? null : state.queue.find((item) => item.key === key);
    if (coalesced) {
      coalesced.fn = fn;
      coalesced.group = group ?? coalesced.group;
      coalesced.waiters.push(deferred);
    } else {
      state.queue.push({
        fn,
        key,
        group: group ?? isGroup(String(chatId)),
        waiters: [deferred],
      });
    }
    if (!state.running) {
      startDrain(state);
    }
    return deferred.promise;
  }

  function pause(chatId, milliseconds) {
    if (closed) throw new ClawError("LIMITER_CLOSED");
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new ClawError("LIMITER_PAUSE_INVALID");
    }
    const state = stateFor(chatId);
    state.pauseUntil = Math.max(state.pauseUntil, now() + milliseconds);
    if (!state.running && state.queue.length > 0) {
      startDrain(state);
    } else cleanup(state);
  }

  async function close() {
    if (closed) {
      await Promise.all([...states.values()].map((state) => state.drainPromise).filter(Boolean));
      return;
    }
    closed = true;
    wakeClosed();
    for (const state of states.values()) {
      cancelExpiry(state);
      for (const item of state.queue.splice(0)) {
        for (const waiter of item.waiters) waiter.reject(new ClawError("LIMITER_CLOSED"));
      }
      cleanup(state);
    }
    await Promise.all([...states.values()].map((state) => state.drainPromise).filter(Boolean));
    states.clear();
  }

  return {
    enqueue,
    pause,
    close,
    size: () => [...states.values()].reduce((sum, state) => sum + state.queue.length, 0),
  };
}
