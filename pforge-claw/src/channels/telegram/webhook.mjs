import { createHash, timingSafeEqual } from "node:crypto";
import { ClawError } from "../../errors.mjs";
import { normalize, windowReducer } from "./poller.mjs";

export const WEBHOOK_PATH = "/telegram/webhook";
const DEFAULT_WINDOW_SIZE = 1000;
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export function createSecretCheck(getSecret) {
  return (request) => {
    const header = request.headers[SECRET_HEADER];
    const secret = getSecret?.();
    if (typeof secret !== "string" || secret.length === 0
      || typeof header !== "string" || header.length === 0 || header.includes(",")
      || (request.headersDistinct?.[SECRET_HEADER]?.length ?? 1) !== 1) return false;
    const expected = createHash("sha256").update(secret).digest();
    const actual = createHash("sha256").update(header).digest();
    return timingSafeEqual(expected, actual);
  };
}

export function createWebhookReceiver({ store, onUpdate, onError, window = DEFAULT_WINDOW_SIZE } = {}) {
  if (!store || typeof store.fold !== "function" || typeof store.append !== "function"
    || typeof onUpdate !== "function" || !Number.isInteger(window) || window < 1) {
    throw new ClawError("WEBHOOK_CONFIGURATION_INVALID");
  }
  let rememberedIds = store.fold("updates", (ids, record) => windowReducer(ids, record, window), []);
  const seen = new Set(rememberedIds.map(String));
  const processing = new Set();

  function remember(updateId) {
    if (seen.has(updateId)) return;
    seen.add(updateId);
    rememberedIds.push(updateId);
    while (rememberedIds.length > window) seen.delete(rememberedIds.shift());
  }

  function respond(response, status, body) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }

  return async ({ response, body }) => {
    let update;
    try {
      update = JSON.parse(body);
    } catch {
      respond(response, 400, { error: "TELEGRAM_BAD_UPDATE" });
      return;
    }
    if (!Number.isInteger(update?.update_id)) {
      respond(response, 400, { error: "TELEGRAM_BAD_UPDATE" });
      return;
    }
    let normalized;
    try {
      normalized = normalize(update);
    } catch {
      respond(response, 400, { error: "TELEGRAM_BAD_UPDATE" });
      return;
    }

    const updateId = String(update.update_id);
    if (seen.has(updateId) || processing.has(updateId)) {
      respond(response, 200, { ok: true, duplicate: true });
      return;
    }
    processing.add(updateId);
    try {
      try {
        await onUpdate(normalized);
      } catch (error) {
        try {
          await onError?.(error);
        } finally {
          try {
            store.append("updates", { updateId, adapter: "telegram", via: "webhook", failed: true });
          } catch (persistError) {
            throw Object.assign(new Error("WEBHOOK_PERSIST_FAILED"), { cause: persistError });
          }
          remember(updateId);
        }
        respond(response, 200, { ok: true });
        return;
      }
      try {
        store.append("updates", { updateId, adapter: "telegram", via: "webhook" });
      } catch (error) {
        throw Object.assign(new Error("WEBHOOK_PERSIST_FAILED"), { cause: error });
      }
      remember(updateId);
      respond(response, 200, { ok: true });
    } finally {
      processing.delete(updateId);
    }
  };
}

export async function syncWebhookMode({ client, mode, url, secret } = {}) {
  if (!client) throw new ClawError("WEBHOOK_CONFIGURATION_INVALID");
  if (mode === "webhook") {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new ClawError("WEBHOOK_CONFIG_INVALID");
    }
    if (parsedUrl.protocol !== "https:" || typeof secret !== "string" || secret.length === 0) {
      throw new ClawError("WEBHOOK_CONFIG_INVALID");
    }
    try {
      await client.setWebhook({
        url,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });
    } catch {
      throw new ClawError("WEBHOOK_SYNC_FAILED");
    }
    return;
  }
  if (mode === "poll") {
    try {
      await client.deleteWebhook({ drop_pending_updates: false });
    } catch {
      throw new ClawError("WEBHOOK_SYNC_FAILED");
    }
    return;
  }
  throw new ClawError("WEBHOOK_MODE_INVALID");
}
