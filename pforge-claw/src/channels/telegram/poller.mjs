import { createStore } from "../../state/store.mjs";
import { ClawError } from "../../errors.mjs";
import { assertChannelAdapter, CHANNEL_MAX_FILE_BYTES } from "../channel-adapter.mjs";
import { createTelegramClient } from "./client.mjs";
import { chunkForTelegram, formatMdV2 } from "./format.mjs";
import { createChatLimiter } from "./rate-limiter.mjs";

const DEFAULT_TIMEOUT_SEC = 50, DEFAULT_WINDOW_SIZE = 1000;
const DEFAULT_BASE_BACKOFF_MS = 1000, DEFAULT_MAX_BACKOFF_MS = 30_000;
const MAX_HANDLER_ATTEMPTS = 5, SNAPSHOT_EVERY = 500;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096, TELEGRAM_CHUNK_LENGTH = 3800;
const TELEGRAM_MAX_CALLBACK_BYTES = 64;
const MAX_FILE_ID_CHARS = 256, MAX_MIME_TYPE_CHARS = 128;
const MAX_LINK_ENTITIES = 100, MAX_LINK_URL_CHARS = 2048;
const ATTACHMENT_KINDS = Object.freeze({ voice: "voice", audio: "voice", document: "file" });
const FORWARD_ORIGIN_TYPES = new Set(["user", "hidden_user", "chat", "channel", "legacy"]);
const LINK_ENTITY_TYPES = new Set(["url", "text_link"]);
const MIME_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;
const SNAPSHOT_INITIAL = [];
const FATAL_CODES = new Set(["TELEGRAM_UNAUTHORIZED", "TELEGRAM_CONFLICT"]);

export const TELEGRAM_LIMITS = Object.freeze({
  maxMessageLength: TELEGRAM_MAX_MESSAGE_LENGTH, chunkLength: TELEGRAM_CHUNK_LENGTH,
  maxCallbackDataBytes: TELEGRAM_MAX_CALLBACK_BYTES, maxFileBytes: CHANNEL_MAX_FILE_BYTES,
  parseMode: "MarkdownV2",
});

export function windowReducer(state, record, limit = DEFAULT_WINDOW_SIZE) {
  const ids = state.filter((updateId) => updateId !== record.updateId);
  ids.push(record.updateId);
  return ids.slice(-limit);
}

function identifier(value) {
  return value === undefined || value === null ? null : String(value);
}

function envelopeFor({ updateId, kind, message, from }) {
  return {
    v: 1, adapter: "telegram", updateId, kind,
    chatId: identifier(message?.chat?.id),
    threadId: identifier(message?.message_thread_id),
    userId: identifier(from?.id),
    messageId: identifier(message?.message_id),
    text: null, callbackId: null, data: null, files: [],
  };
}

function normalizeAttachment(file, kind) {
  if (typeof file?.file_id !== "string" || file.file_id.length === 0
    || file.file_id.length > MAX_FILE_ID_CHARS) return null;
  const mimeType = file.mime_type;
  const hasMimeType = typeof mimeType === "string" && mimeType.length <= MAX_MIME_TYPE_CHARS
    && MIME_TYPE_PATTERN.test(mimeType);
  return { kind, fileId: file.file_id, ...(hasMimeType ? { mimeType } : {}) };
}

function normalizeFiles(message) {
  const files = Object.entries(ATTACHMENT_KINDS)
    .map(([field, kind]) => normalizeAttachment(message[field], kind))
    .filter(Boolean);
  const photo = normalizeAttachment(Array.isArray(message.photo) ? message.photo.at(-1) : null, "photo");
  if (photo) files.push(photo);
  return files;
}

function normalizeForward(message) {
  const forwarded = message.is_automatic_forward === true
    || Object.keys(message).some((key) => key.startsWith("forward_"));
  if (!forwarded) return {};
  const type = message.forward_origin?.type;
  return { forwarded: true, forwardOrigin: { type: FORWARD_ORIGIN_TYPES.has(type) ? type : "legacy" } };
}

function isLinkUrl(url) {
  if (typeof url !== "string" || url.length > MAX_LINK_URL_CHARS) return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function normalizeLinkEntity(entity, textLength) {
  if (!LINK_ENTITY_TYPES.has(entity?.type)) return null;
  const { offset, length } = entity;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(length)
    || length <= 0 || offset + length > textLength) return null;
  if (entity.type === "text_link" && !isLinkUrl(entity.url)) return null;
  return {
    type: entity.type, offset, length,
    ...(entity.type === "text_link" ? { url: entity.url } : {}),
  };
}

function normalizeEntities(message, text) {
  const supplied = typeof message.text === "string" ? message.entities : message.caption_entities;
  if (!Array.isArray(supplied) || typeof text !== "string") return {};
  const entities = [];
  for (const entity of supplied) {
    const selected = normalizeLinkEntity(entity, text.length);
    if (!selected) continue;
    entities.push(selected);
    if (entities.length === MAX_LINK_ENTITIES) break;
  }
  return entities.length > 0 ? { entities } : {};
}

function normalizeMessage(message, updateId) {
  const text = typeof message.text === "string" ? message.text
    : typeof message.caption === "string" ? message.caption : null;
  return {
    ...envelopeFor({ updateId, kind: "message", message, from: message.from }),
    text, files: normalizeFiles(message),
    ...normalizeEntities(message, text), ...normalizeForward(message),
  };
}

function normalizeCallback(callback, updateId) {
  return {
    ...envelopeFor({ updateId, kind: "callback", message: callback.message, from: callback.from }),
    callbackId: identifier(callback.id),
    data: typeof callback.data === "string" ? callback.data : null,
  };
}

export function normalize(update) {
  const updateId = Number.isInteger(update?.update_id) ? String(update.update_id) : null;
  if (update?.message) return normalizeMessage(update.message, updateId);
  if (update?.callback_query) return normalizeCallback(update.callback_query, updateId);
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
    const escaped = formatMdV2(secrets.redact(String(text ?? "")));
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
    setMenu: (commands, options = {}) => client.setMyCommands(commands, options),
    download: ({ fileId, maxBytes } = {}) => client.downloadFile(fileId, { maxBytes }),
    typing,
  };
  return assertChannelAdapter(adapter);
}
