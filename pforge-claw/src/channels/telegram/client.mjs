import { ClawError } from "../../errors.mjs";
import { CHANNEL_MAX_FILE_BYTES } from "../channel-adapter.mjs";

export const DEFAULT_API_BASE = "https://api.telegram.org";
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_FILE_PATH_CHARS = 1024;
const MAX_ERROR_DESCRIPTION_CHARS = 512;
const ALLOWED_UPDATES = Object.freeze(["message", "callback_query"]);
const FILE_PATH_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

function makeApiError(code, method, status, extra = {}) {
  return new ClawError(code, { method, status, ...extra });
}

function retryAfterSeconds(response, body) {
  const bodyValue = body?.parameters?.retry_after;
  if (Number.isFinite(bodyValue) && bodyValue >= 0) return bodyValue;
  const headerValue = Number(response.headers.get("retry-after"));
  return Number.isFinite(headerValue) && headerValue >= 0 ? headerValue : 1;
}

function safeDescription(description, token, redact) {
  const withoutToken = String(description ?? "").split(token).join("[redacted]");
  return String(redact(withoutToken)).slice(0, MAX_ERROR_DESCRIPTION_CHARS);
}

function validateApiBase(apiBase) {
  const base = String(apiBase).replace(/\/+$/, "");
  let parsedBase;
  try {
    parsedBase = new URL(base);
  } catch {
    throw new ClawError("TELEGRAM_API_BASE_INVALID");
  }
  if (!["http:", "https:"].includes(parsedBase.protocol)) {
    throw new ClawError("TELEGRAM_API_BASE_INVALID");
  }
  return base;
}

async function readToken(getToken) {
  const token = await getToken?.();
  if (typeof token !== "string" || token.length === 0) {
    throw new ClawError("TELEGRAM_TOKEN_MISSING");
  }
  return token;
}

function transportError(error, method) {
  if (error?.name === "AbortError") return new ClawError("TELEGRAM_ABORTED", { method });
  const cause = error?.code ?? error?.name;
  return new ClawError("TELEGRAM_NETWORK", {
    method,
    cause: typeof cause === "string" && /^[A-Z][A-Z0-9_]{0,63}$/i.test(cause) ? cause : "Error",
  });
}

async function fetchResponse({ fetchImpl, url, options, method }) {
  try {
    return await fetchImpl(url, options);
  } catch (error) {
    throw transportError(error, method);
  }
}

function assertResponseStatus(response, method) {
  if (response.status === 401) throw makeApiError("TELEGRAM_UNAUTHORIZED", method, response.status);
  if (response.status === 409) throw makeApiError("TELEGRAM_CONFLICT", method, response.status);
}

async function readResponseBody(response, method) {
  try {
    return await response.json();
  } catch {
    throw makeApiError("TELEGRAM_BAD_RESPONSE", method, response.status);
  }
}

function apiResult(body, { method, status, token, redact }) {
  if (body?.ok !== true) {
    throw makeApiError("TELEGRAM_API", method, status, {
      errorCode: Number.isFinite(body?.error_code) ? body.error_code : null,
      description: safeDescription(body?.description, token, redact),
    });
  }
  return body.result;
}

function requestMethods(request) {
  return {
    getMe: () => request("getMe"),
    getUpdates: (offset, { timeout = 50, signal } = {}) => request("getUpdates", {
      ...(offset === undefined || offset === null ? {} : { offset }),
      timeout,
      allowed_updates: [...ALLOWED_UPDATES],
    }, { signal }),
    sendMessage: ({ chatId, text, threadId, replyMarkup, parseMode } = {}) => request("sendMessage", {
      chat_id: chatId,
      text,
      ...(threadId === undefined || threadId === null ? {} : { message_thread_id: threadId }),
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
      ...(parseMode === undefined ? {} : { parse_mode: parseMode }),
    }),
    editMessageText: ({ chatId, messageId, text, threadId, parseMode, replyMarkup } = {}) =>
      request("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        ...(threadId === undefined || threadId === null ? {} : { message_thread_id: threadId }),
        ...(parseMode === undefined ? {} : { parse_mode: parseMode }),
        ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
      }),
    answerCallbackQuery: ({ callbackId, text, showAlert, url, cacheTime } = {}) =>
      request("answerCallbackQuery", {
        callback_query_id: callbackId,
        ...(text === undefined ? {} : { text }),
        ...(showAlert === undefined ? {} : { show_alert: showAlert }),
        ...(url === undefined ? {} : { url }),
        ...(cacheTime === undefined ? {} : { cache_time: cacheTime }),
      }),
    sendChatAction: ({ chatId, action = "typing", threadId } = {}) => request("sendChatAction", {
      chat_id: chatId,
      action,
      ...(threadId === undefined || threadId === null ? {} : { message_thread_id: threadId }),
    }),
    setMyCommands: (commands, { scope } = {}) => request("setMyCommands", {
      commands,
      ...(scope === undefined ? {} : { scope }),
    }),
    setWebhook: (options = {}) => request("setWebhook", options),
    deleteWebhook: (options = {}) => request("deleteWebhook", options),
    getFile: (fileId) => request("getFile", { file_id: fileId }),
  };
}

function assertByteLimit(maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > CHANNEL_MAX_FILE_BYTES) {
    throw new ClawError("TELEGRAM_FILE_LIMIT_INVALID");
  }
}

function assertFileSize(bytes, maxBytes) {
  if (Number.isFinite(bytes) && bytes > maxBytes) {
    throw new ClawError("TELEGRAM_FILE_TOO_LARGE", { maxBytes });
  }
}

function filePathFor(file, maxBytes) {
  const filePath = file?.file_path;
  if (typeof filePath !== "string" || filePath.length > MAX_FILE_PATH_CHARS
    || filePath === "." || filePath.includes("..") || !FILE_PATH_PATTERN.test(filePath)) {
    throw new ClawError("TELEGRAM_FILE_PATH_INVALID");
  }
  assertFileSize(file?.file_size, maxBytes);
  return filePath;
}

async function readStreamBytes(body, maxBytes) {
  const reader = body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        // A size violation remains authoritative even if stream cancellation fails.
        await reader.cancel().catch(() => undefined);
        throw new ClawError("TELEGRAM_FILE_TOO_LARGE", { maxBytes });
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes);
}

async function readDownloadBytes(response, maxBytes) {
  try {
    if (response.body?.getReader) return await readStreamBytes(response.body, maxBytes);
    const bytes = Buffer.from(await response.arrayBuffer());
    assertFileSize(bytes.length, maxBytes);
    return bytes;
  } catch (error) {
    if (error instanceof ClawError) throw error;
    throw transportError(error, "downloadFile");
  }
}

export function createTelegramClient({
  getToken,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxRetries = 3,
  redact = (value) => value,
} = {}) {
  const base = validateApiBase(apiBase);

  async function request(method, params = {}, { signal } = {}) {
    let retries = 0;
    while (true) {
      const token = await readToken(getToken);
      const response = await fetchResponse({
        fetchImpl, url: `${base}/bot${token}/${method}`, method,
        options: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params),
          signal,
        },
      });
      assertResponseStatus(response, method);
      const body = await readResponseBody(response, method);
      if (response.status === 429) {
        const retryAfterMs = Math.min(retryAfterSeconds(response, body) * 1000, MAX_RETRY_AFTER_MS);
        if (retries < maxRetries) {
          retries += 1;
          await sleep(retryAfterMs);
          continue;
        }
        throw makeApiError("TELEGRAM_RATE_LIMITED", method, response.status, { retryAfterMs });
      }
      return apiResult(body, { method, status: response.status, token, redact });
    }
  }

  const methods = requestMethods(request);

  async function downloadFile(fileId, { maxBytes = CHANNEL_MAX_FILE_BYTES, signal } = {}) {
    assertByteLimit(maxBytes);
    const filePath = filePathFor(await methods.getFile(fileId), maxBytes);
    const token = await readToken(getToken);
    const response = await fetchResponse({
      fetchImpl, url: `${base}/file/bot${token}/${filePath}`, method: "downloadFile",
      options: { method: "GET", redirect: "error", signal },
    });
    assertResponseStatus(response, "downloadFile");
    if (!response.ok) throw makeApiError("TELEGRAM_API", "downloadFile", response.status);
    return { fileId, filePath, bytes: await readDownloadBytes(response, maxBytes) };
  }

  return { ...methods, downloadFile };
}
