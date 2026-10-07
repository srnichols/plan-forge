import { ClawError } from "../../errors.mjs";

export const DEFAULT_API_BASE = "https://api.telegram.org";
const MAX_RETRY_AFTER_MS = 60_000;
const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_UPDATES = Object.freeze(["message", "callback_query"]);

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
  return redact(withoutToken);
}

export function createTelegramClient({
  getToken,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxRetries = 3,
  redact = (value) => value,
} = {}) {
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

  async function request(method, params = {}, { signal } = {}) {
    let retries = 0;
    while (true) {
      const token = await getToken?.();
      if (typeof token !== "string" || token.length === 0) {
        throw new ClawError("TELEGRAM_TOKEN_MISSING", {});
      }
      let response;
      try {
        response = await fetchImpl(`${base}/bot${token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(params),
          signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") throw new ClawError("TELEGRAM_ABORTED", { method });
        throw new ClawError("TELEGRAM_NETWORK", {
          method,
          cause: error?.code ?? error?.name ?? "Error",
        });
      }

      if (response.status === 401) throw makeApiError("TELEGRAM_UNAUTHORIZED", method, response.status);
      if (response.status === 409) throw makeApiError("TELEGRAM_CONFLICT", method, response.status);
      let body;
      try {
        body = await response.json();
      } catch {
        throw makeApiError("TELEGRAM_BAD_RESPONSE", method, response.status);
      }
      if (response.status === 429) {
        const retryAfterMs = Math.min(retryAfterSeconds(response, body) * 1000, MAX_RETRY_AFTER_MS);
        if (retries < maxRetries) {
          retries += 1;
          await sleep(retryAfterMs);
          continue;
        }
        throw makeApiError("TELEGRAM_RATE_LIMITED", method, response.status, { retryAfterMs });
      }
      if (body?.ok !== true) {
        const description = safeDescription(body?.description, token, redact);
        throw makeApiError("TELEGRAM_API", method, response.status, {
          errorCode: Number.isFinite(body?.error_code) ? body.error_code : null,
          description,
        });
      }
      return body.result;
    }
  }

  const getMe = () => request("getMe");
  const getUpdates = (offset, { timeout = 50, signal } = {}) => request("getUpdates", {
    ...(offset === undefined || offset === null ? {} : { offset }),
    timeout,
    allowed_updates: [...ALLOWED_UPDATES],
  }, { signal });
  const sendMessage = ({ chatId, text, threadId, replyMarkup, parseMode } = {}) => request("sendMessage", {
    chat_id: chatId,
    text,
    ...(threadId === undefined || threadId === null ? {} : { message_thread_id: threadId }),
    ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
    ...(parseMode === undefined ? {} : { parse_mode: parseMode }),
  });
  const editMessageText = ({ chatId, messageId, text, threadId, parseMode, replyMarkup } = {}) =>
    request("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(threadId === undefined || threadId === null ? {} : { message_thread_id: threadId }),
      ...(parseMode === undefined ? {} : { parse_mode: parseMode }),
      ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
    });
  const answerCallbackQuery = ({ callbackId, text, showAlert, url, cacheTime } = {}) =>
    request("answerCallbackQuery", {
      callback_query_id: callbackId,
      ...(text === undefined ? {} : { text }),
      ...(showAlert === undefined ? {} : { show_alert: showAlert }),
      ...(url === undefined ? {} : { url }),
      ...(cacheTime === undefined ? {} : { cache_time: cacheTime }),
    });
  const sendChatAction = ({ chatId, action = "typing", threadId } = {}) => request("sendChatAction", {
    chat_id: chatId,
    action,
    ...(threadId === undefined || threadId === null ? {} : { message_thread_id: threadId }),
  });
  const setMyCommands = (commands) => request("setMyCommands", { commands });
  const setWebhook = (options = {}) => request("setWebhook", options);
  const deleteWebhook = (options = {}) => request("deleteWebhook", options);
  const getFile = (fileId) => request("getFile", { file_id: fileId });

  async function downloadFile(fileId, { maxBytes = DEFAULT_MAX_FILE_BYTES, signal } = {}) {
    const file = await getFile(fileId);
    const filePath = file?.file_path;
    if (typeof filePath !== "string" || filePath.includes("..")) {
      throw new ClawError("TELEGRAM_FILE_PATH_INVALID");
    }
    if (Number.isFinite(file?.file_size) && file.file_size > maxBytes) {
      throw new ClawError("TELEGRAM_FILE_TOO_LARGE", { maxBytes });
    }
    const token = await getToken?.();
    if (typeof token !== "string" || token.length === 0) {
      throw new ClawError("TELEGRAM_TOKEN_MISSING", {});
    }
    let response;
    try {
      response = await fetchImpl(`${base}/file/bot${token}/${filePath}`, {
        method: "GET",
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new ClawError("TELEGRAM_ABORTED", { method: "downloadFile" });
      throw new ClawError("TELEGRAM_NETWORK", {
        method: "downloadFile",
        cause: error?.code ?? error?.name ?? "Error",
      });
    }
    if (response.status === 401) throw makeApiError("TELEGRAM_UNAUTHORIZED", "downloadFile", response.status);
    if (response.status === 409) throw makeApiError("TELEGRAM_CONFLICT", "downloadFile", response.status);
    if (!response.ok) throw makeApiError("TELEGRAM_API", "downloadFile", response.status);
    const chunks = [];
    let bytes = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new ClawError("TELEGRAM_FILE_TOO_LARGE", { maxBytes });
          }
          chunks.push(Buffer.from(value));
        }
      } catch (error) {
        if (error instanceof ClawError) throw error;
        if (error?.name === "AbortError") throw new ClawError("TELEGRAM_ABORTED", { method: "downloadFile" });
        throw new ClawError("TELEGRAM_NETWORK", {
          method: "downloadFile",
          cause: error?.code ?? error?.name ?? "Error",
        });
      }
    } else {
      let data;
      try {
        data = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (error?.name === "AbortError") throw new ClawError("TELEGRAM_ABORTED", { method: "downloadFile" });
        throw new ClawError("TELEGRAM_NETWORK", {
          method: "downloadFile",
          cause: error?.code ?? error?.name ?? "Error",
        });
      }
      bytes = data.length;
      if (bytes > maxBytes) throw new ClawError("TELEGRAM_FILE_TOO_LARGE", { maxBytes });
      chunks.push(data);
    }
    return { fileId, filePath, bytes: Buffer.concat(chunks) };
  }

  return {
    getMe,
    getUpdates,
    sendMessage,
    editMessageText,
    answerCallbackQuery,
    sendChatAction,
    setMyCommands,
    setWebhook,
    deleteWebhook,
    getFile,
    downloadFile,
  };
}
