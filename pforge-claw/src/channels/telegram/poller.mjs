import { createStore } from "../../state/store.mjs";
import { ClawError } from "../../errors.mjs";
import { assertChannelAdapter } from "../channel-adapter.mjs";
import { createTelegramClient } from "./client.mjs";
import { chunkForTelegram, escapeMdV2 } from "./format.mjs";
import { createChatLimiter } from "./rate-limiter.mjs";

const DEFAULT_TIMEOUT_SEC = 50, DEFAULT_WINDOW_SIZE = 1000;
const DEFAULT_BASE_BACKOFF_MS = 1000, DEFAULT_MAX_BACKOFF_MS = 30_000;
const MAX_HANDLER_ATTEMPTS = 5, SNAPSHOT_EVERY = 500;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096, TELEGRAM_CHUNK_LENGTH = 3800;
const TELEGRAM_MAX_CALLBACK_BYTES = 64, TELEGRAM_MAX_FILE_BYTES = 20 * 1024 * 1024;
const SNAPSHOT_INITIAL = [];
const FATAL_CODES = new Set(["TELEGRAM_UNAUTHORIZED", "TELEGRAM_CONFLICT"]);

export const TELEGRAM_LIMITS = Object.freeze({
  maxMessageLength: TELEGRAM_MAX_MESSAGE_LENGTH, chunkLength: TELEGRAM_CHUNK_LENGTH,
  maxCallbackDataBytes: TELEGRAM_MAX_CALLBACK_BYTES, maxFileBytes: TELEGRAM_MAX_FILE_BYTES,
  parseMode: "MarkdownV2",
});

export function windowReducer(state, record, limit = DEFAULT_WINDOW_SIZE) {
  const ids = state.filter((updateId) => updateId !== record.updateId);
  ids.push(record.updateId);
  return ids.slice(-limit);
}

export function normalize(update) {
  const updateId = Number.isInteger(update?.update_id) ? String(update.update_id) : null;
  if (update?.message) {
    const message = update.message;
    const files = [];
    if (message.document?.file_id) files.push(String(message.document.file_id));
    const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
    if (photo?.file_id) files.push(String(photo.file_id));
    return {
      v: 1, adapter: "telegram", updateId, kind: "message",
      chatId: message.chat?.id === undefined ? null : String(message.chat.id),
      threadId: message.message_thread_id === undefined ? null : String(message.message_thread_id),
      userId: message.from?.id === undefined ? null : String(message.from.id),
      messageId: message.message_id === undefined ? null : String(message.message_id),
      text: message.text ?? message.caption ?? null, callbackId: null, data: null, files,
    };
  }
  const callback = update?.callback_query;
  if (callback) {
    const message = callback.message;
    return {
      v: 1, adapter: "telegram", updateId, kind: "callback",
      chatId: message?.chat?.id === undefined ? null : String(message.chat.id),
      threadId: message?.message_thread_id === undefined ? null : String(message.message_thread_id),
      userId: callback.from?.id === undefined ? null : String(callback.from.id),
      messageId: message?.message_id === undefined ? null : String(message.message_id),
      text: null, callbackId: callback.id === undefined ? null : String(callback.id),
      data: callback.data ?? null, files: [],
    };
  }
  throw new ClawError("TELEGRAM_UPDATE_INVALID");
}
function validateOffset(value) {
  if (value === null) return null;
  if (value?.v !== 1 || !Number.isInteger(value.telegram)) {
    throw new ClawError("OFFSETS_CORRUPT");
  }
  return value.telegram;
}
function loadOffset(store) {
  let stored;
  try {
    stored = store.readJson("offsets.json", null);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ClawError("OFFSETS_CORRUPT");
  }
  return validateOffset(stored);
}
function makeAbortableSleep(sleep, signal, milliseconds) {
  if (signal.aborted) return Promise.resolve();
  return Promise.race([
    sleep(milliseconds),
    new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })),
  ]);
}
export function createPoller({
  client, store, onUpdate, onError = () => {}, timeoutSec = DEFAULT_TIMEOUT_SEC,
  window = DEFAULT_WINDOW_SIZE, backoff = {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  signals = process, maxHandlerAttempts = MAX_HANDLER_ATTEMPTS, limiter,
} = {}) {
  const { baseMs = DEFAULT_BASE_BACKOFF_MS, maxMs = DEFAULT_MAX_BACKOFF_MS } = backoff;
  if (!client || !store || typeof onUpdate !== "function") {
    throw new ClawError("POLLER_CONFIGURATION_INVALID");
  }
  if (!Number.isInteger(window) || window < 1 || !Number.isInteger(maxHandlerAttempts) || maxHandlerAttempts < 1) {
    throw new ClawError("POLLER_CONFIGURATION_INVALID");
  }
  let offset = loadOffset(store);
  const dedupeIds = store.fold("updates", (ids, record) => windowReducer(ids, record, window), []);
  const seen = new Set(dedupeIds);
  let started = false;
  let stopping = false;
  let task = null;
  let activePoll = null;
  let backoffAbort = null;
  let appendsSinceSnapshot = 0;
  let stopPromise = null;

  function remember(updateId) {
    if (seen.has(updateId)) return;
    seen.add(updateId);
    dedupeIds.push(updateId);
    while (dedupeIds.length > window) seen.delete(dedupeIds.shift());
  }

  function persist(updateId, failed = false) {
    store.append("updates", { updateId, adapter: "telegram", ...(failed ? { failed: true } : {}) });
    remember(updateId);
    appendsSinceSnapshot += 1;
    offset = Number(updateId) + 1;
    store.writeJsonAtomic("offsets.json", { v: 1, telegram: offset });
    if (appendsSinceSnapshot >= SNAPSHOT_EVERY) {
      // The snapshot bounds restart's in-memory dedupe window; the append-only log is not compacted.
      store.snapshot("updates", (ids, record) => windowReducer(ids, record, window), []);
      appendsSinceSnapshot = 0;
    }
  }

  async function processUpdate(update) {
    if (!Number.isInteger(update?.update_id)) throw new ClawError("TELEGRAM_UPDATE_INVALID");
    const updateId = String(update.update_id);
    if (seen.has(updateId)) {
      if (offset === null || offset <= Number(updateId)) {
        offset = Number(updateId) + 1;
        store.writeJsonAtomic("offsets.json", { v: 1, telegram: offset });
      }
      return;
    }
    const normalized = normalize(update);
    let finalError;
    for (let attempt = 1; attempt <= maxHandlerAttempts; attempt += 1) {
      try {
        await onUpdate(normalized);
      } catch (error) {
        finalError = error;
        continue;
      }
      // A crash before append can redeliver this update; handlers must be idempotent by updateId.
      persist(updateId);
      return;
    }
    persist(updateId, true);
    await onError(finalError, normalized);
  }

  async function waitBackoff(milliseconds) {
    backoffAbort = new AbortController();
    try {
      await makeAbortableSleep(sleep, backoffAbort.signal, milliseconds);
    } finally {
      backoffAbort = null;
    }
  }

  async function run() {
    let delay = baseMs;
    try {
      while (!stopping) {
        let updates;
        activePoll = new AbortController();
        try {
          updates = await client.getUpdates(offset, { timeout: timeoutSec, signal: activePoll.signal });
        } catch (error) {
          if (stopping && error?.code === "TELEGRAM_ABORTED") break;
          if (FATAL_CODES.has(error?.code)) throw error;
          await onError(error);
          if (stopping) break;
          await waitBackoff(delay);
          delay = Math.min(delay * 2, maxMs);
          continue;
        } finally {
          activePoll = null;
        }
        delay = baseMs;
        if (!Array.isArray(updates)) throw new ClawError("TELEGRAM_BAD_RESPONSE");
        updates.sort((left, right) => left.update_id - right.update_id);
        for (const update of updates) {
          if (stopping) break;
          try {
            await processUpdate(update);
          } catch (error) {
            if (FATAL_CODES.has(error?.code)) throw error;
            await onError(error);
            if (stopping) break;
            await waitBackoff(delay);
            delay = Math.min(delay * 2, maxMs);
            break;
          }
        }
      }
    } finally {
      stopping = true;
      signals.off?.("SIGINT", onSigint);
      signals.off?.("SIGTERM", onSigterm);
      await limiter?.close();
    }
  }

  function signalStop() {
    void stop().catch((error) => onError(error));
  }

  const onSigint = signalStop;
  const onSigterm = signalStop;

  function start() {
    if (started) throw new ClawError("POLLER_ALREADY_STARTED");
    started = true;
    stopping = false;
    signals.on?.("SIGINT", onSigint);
    signals.on?.("SIGTERM", onSigterm);
    task = run();
    return task;
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    activePoll?.abort();
    backoffAbort?.abort();
    stopPromise = (async () => {
      try {
        if (task) await task;
      } finally {
        signals.off?.("SIGINT", onSigint);
        signals.off?.("SIGTERM", onSigterm);
        await limiter?.close();
      }
    })();
    return stopPromise;
  }

  return { start, stop, get offset() { return offset; } };
}
export function createTelegramAdapter({
  config, secrets, stateDir, store: suppliedStore, fetchImpl = fetch,
  now = Date.now, sleep, signals = process,
  onUpdate = config?.onUpdate,
  onError = config?.onError,
  isGroup,
} = {}) {
  if (typeof onUpdate !== "function") throw new ClawError("TELEGRAM_HANDLER_REQUIRED");
  if (!secrets || typeof secrets.getSecret !== "function") throw new ClawError("TELEGRAM_SECRETS_REQUIRED");
  const store = suppliedStore ?? (stateDir ? createStore(stateDir, { redact: secrets.redact }) : null);
  if (!store) throw new ClawError("TELEGRAM_STATE_DIR_MISSING");
  const client = createTelegramClient({
    getToken: () => secrets.getSecret(config?.channels?.telegram?.botTokenSecret ?? "PFORGE_CLAW_TELEGRAM_TOKEN"),
    apiBase: config?.channels?.telegram?.apiBase,
    fetchImpl,
    sleep,
    redact: secrets.redact,
  });
  const limiter = createChatLimiter({ now, sleep, ...(isGroup ? { isGroup } : {}) });
  const poller = createPoller({ client, store, onUpdate, onError, sleep, signals, limiter });

  async function send({ chatId, text, threadId, replyMarkup } = {}) {
    const safeText = secrets.redact(String(text ?? ""));
    const chunks = chunkForTelegram(safeText, { limit: TELEGRAM_LIMITS.maxMessageLength });
    const refs = [];
    for (const chunk of chunks) {
      const message = await limiter.enqueue(chatId, () => client.sendMessage({
        chatId, text: chunk, threadId, replyMarkup, parseMode: TELEGRAM_LIMITS.parseMode,
      }));
      refs.push({ chatId: String(chatId), messageId: String(message.message_id),
        threadId: threadId === undefined || threadId === null ? null : String(threadId) });
    }
    return refs;
  }

  async function edit({ chatId, messageId, text, threadId, replyMarkup } = {}) {
    const escaped = escapeMdV2(secrets.redact(String(text ?? "")));
    if (escaped.length > TELEGRAM_LIMITS.maxMessageLength) throw new ClawError("MESSAGE_TOO_LONG", { length: escaped.length });
    return limiter.enqueue(chatId, () => client.editMessageText({
      chatId, messageId, text: escaped, threadId, replyMarkup, parseMode: TELEGRAM_LIMITS.parseMode,
    }), { key: `edit:${chatId}:${messageId}` });
  }

  function typing({ chatId, threadId } = {}) {
    return limiter.enqueue(chatId, () => client.sendChatAction({ chatId, threadId }));
  }

  const adapter = {
    limits: TELEGRAM_LIMITS, start: () => poller.start(), stop: () => poller.stop(), send, edit,
    answerCallback: (args) => client.answerCallbackQuery(args),
    setMenu: (commands) => client.setMyCommands(commands),
    download: ({ fileId, maxBytes } = {}) => client.downloadFile(fileId, { maxBytes }),
    typing,
  };
  return assertChannelAdapter(adapter);
}
