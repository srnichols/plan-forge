import { unlinkSync } from "node:fs";
import path from "node:path";
import { createTelegramClient } from "../channels/telegram/client.mjs";
import {
  createSecretCheck,
  createWebhookReceiver,
  syncWebhookMode,
  WEBHOOK_PATH,
} from "../channels/telegram/webhook.mjs";
import { ClawError } from "../errors.mjs";
import { createHttpServer, registerHealthRoutes } from "../http.mjs";
import { resolveHome } from "../config.mjs";

let runtime = null;

function removeReadyFile(file) {
  try {
    unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function safeErrorCode(error) {
  const code = String(error?.code ?? "");
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "TELEGRAM_UPDATE_FAILED";
}

async function rollback(state) {
  const errors = [];
  for (const cleanup of [...state.closeables].reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  state.closeables.length = 0;
  if (runtime === state) runtime = null;
  if (errors.length) throw new AggregateError(errors, "Webhook startup rollback was incomplete.");
}

async function start(ctx) {
  if (runtime) return;
  const state = { mode: ctx.config.channels?.telegram?.mode ?? "poll", http: null, closeables: [] };
  runtime = state;
  try {
    const cfg = ctx.config.channels?.telegram ?? {};
    const http = createHttpServer({
      bind: ctx.config.http?.bind ?? "127.0.0.1",
      port: ctx.config.http?.port ?? 3190,
    });
    state.http = http;
    state.closeables.push(() => http.close());
    const client = createTelegramClient({
      getToken: () => ctx.secrets.getSecret(cfg.botTokenSecret ?? "PFORGE_CLAW_TELEGRAM_TOKEN"),
      apiBase: cfg.apiBase,
      redact: ctx.secrets.redact,
    });
    const stateFile = path.join(ctx.home ?? resolveHome(), "state", ".readyz");
    const unregisterHealth = registerHealthRoutes(http, {
      probes: {
        store: async () => {
          try {
            ctx.store.writeJsonAtomic(".readyz", { ready: true });
          } finally {
            removeReadyFile(stateFile);
          }
        },
        telegram: () => client.getMe(),
      },
    });
    state.closeables.push(unregisterHealth);

    if (state.mode === "webhook") {
      const webhook = cfg.webhook ?? {};
      const secret = ctx.secrets.getSecret(webhook.secretTokenSecret);
      if (typeof secret !== "string" || secret.length === 0) {
        throw new ClawError("WEBHOOK_SECRET_MISSING");
      }
      if (typeof ctx.onTelegramUpdate !== "function") {
        throw new ClawError("WEBHOOK_NO_UPDATE_SINK");
      }
      const receiver = createWebhookReceiver({
        store: ctx.store,
        onUpdate: ctx.onTelegramUpdate,
        onError: (error) => ctx.logger?.error?.("Telegram webhook handler failed", {
          code: safeErrorCode(error),
        }),
      });
      const unregisterWebhook = http.route(
        "POST",
        WEBHOOK_PATH,
        (request) => receiver(request),
        { authorize: createSecretCheck(() => ctx.secrets.getSecret(webhook.secretTokenSecret)) },
      );
      state.closeables.push(unregisterWebhook);
      await http.listen();
      await syncWebhookMode({ client, mode: state.mode, url: webhook.url, secret });
      return;
    }

    await http.listen();
    await syncWebhookMode({ client, mode: state.mode });
  } catch (error) {
    try {
      await rollback(state);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Webhook startup failed and rollback was incomplete.");
    }
    throw error;
  }
}

async function stop() {
  if (!runtime) return;
  const state = runtime;
  await rollback(state);
}

function snapshot() {
  return {
    mode: runtime?.mode ?? null,
    listening: runtime?.http?.server.listening ?? false,
  };
}

export default {
  name: "webhook",
  available: true,
  start,
  stop,
  snapshot,
};
