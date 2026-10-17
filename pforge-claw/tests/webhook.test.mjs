import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore } from "../src/state/store.mjs";
import { createHttpServer, registerHealthRoutes } from "../src/http.mjs";
import { createTelegramClient } from "../src/channels/telegram/client.mjs";
import {
  createSecretCheck,
  createWebhookReceiver,
  syncWebhookMode,
  WEBHOOK_PATH,
} from "../src/channels/telegram/webhook.mjs";
import { startFakeTelegram } from "./helpers/fake-telegram.mjs";
import webhookFeature from "../src/features/webhook.mjs";

const directories = [];
const closeables = [];
const WEBHOOK_SECRET = "webhook-secret-canary";
const BOT_TOKEN = "telegram-token-canary";

afterEach(async () => {
  for (const close of closeables.splice(0).reverse()) await close();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-webhook-"));
  directories.push(directory);
  return directory;
}

function makeUpdate(updateId = 1) {
  return {
    update_id: updateId,
    message: {
      message_id: 4,
      chat: { id: 42 },
      from: { id: 7 },
      text: "hello",
    },
  };
}

async function makeReceiverServer({ store, onUpdate = vi.fn(), onError } = {}) {
  const http = createHttpServer({ port: 0 });
  const receiver = createWebhookReceiver({ store, onUpdate, onError });
  http.route("POST", WEBHOOK_PATH, (args) => receiver(args), {
    authorize: createSecretCheck(() => WEBHOOK_SECRET),
  });
  const { port } = await http.listen();
  closeables.push(() => http.close());
  return { http, port, onUpdate };
}

async function post(port, body, secret = WEBHOOK_SECRET) {
  return fetch(`http://127.0.0.1:${port}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }),
    },
    body,
  });
}

function postDuplicateHeaders(port, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path: WEBHOOK_PATH,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": [WEBHOOK_SECRET, "another-value"],
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        text: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

function updateRecords(store) {
  return store.fold("updates", (records, record) => [...records, record], []);
}

describe("Telegram webhook receiver", () => {
  it.each([
    ["missing", null],
    ["wrong", "wrong-secret"],
    ["different length", "x"],
  ])("rejects a %s secret without reading into the update handler", async (_label, secret) => {
    const directory = await tempDirectory();
    const store = createStore(directory);
    const onUpdate = vi.fn();
    const { port } = await makeReceiverServer({ store, onUpdate });
    const response = await post(port, JSON.stringify(makeUpdate()), secret);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(updateRecords(store)).toEqual([]);
  });

  it("rejects a duplicated secret header", async () => {
    const directory = await tempDirectory();
    const store = createStore(directory);
    const onUpdate = vi.fn();
    const { port } = await makeReceiverServer({ store, onUpdate });
    const response = await postDuplicateHeaders(port, JSON.stringify(makeUpdate()));
    expect(response.status).toBe(401);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(updateRecords(store)).toEqual([]);
  });

  it("accepts a valid update and persists the normalized input", async () => {
    const directory = await tempDirectory();
    const store = createStore(directory);
    const onUpdate = vi.fn();
    const { port } = await makeReceiverServer({ store, onUpdate });
    const response = await post(port, JSON.stringify(makeUpdate()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      adapter: "telegram", updateId: "1", kind: "message", chatId: "42", userId: "7", text: "hello",
    }));
    expect(updateRecords(store)).toEqual([
      expect.objectContaining({ updateId: "1", adapter: "telegram", via: "webhook" }),
    ]);
  });

  it("deduplicates sequential and concurrent deliveries", async () => {
    const directory = await tempDirectory();
    const store = createStore(directory);
    let release;
    const onUpdate = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const { port } = await makeReceiverServer({ store, onUpdate });

    const first = post(port, JSON.stringify(makeUpdate(5)));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
    const concurrent = await post(port, JSON.stringify(makeUpdate(5)));
    expect(await concurrent.json()).toEqual({ ok: true, duplicate: true });
    release();
    expect((await first).status).toBe(200);
    const sequential = await post(port, JSON.stringify(makeUpdate(5)));
    expect(await sequential.json()).toEqual({ ok: true, duplicate: true });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(updateRecords(store)).toHaveLength(1);
  });

  it("returns 400 for malformed or invalid updates", async () => {
    const directory = await tempDirectory();
    const store = createStore(directory);
    const { port } = await makeReceiverServer({ store });
    for (const body of ["{", JSON.stringify({ update_id: "bad" })]) {
      const response = await post(port, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "TELEGRAM_BAD_UPDATE" });
    }
  });

  it("records handler failures and acknowledges them to Telegram", async () => {
    const directory = await tempDirectory();
    const store = createStore(directory);
    const error = new Error("handler failure");
    const onError = vi.fn();
    const { port } = await makeReceiverServer({
      store,
      onUpdate: vi.fn().mockRejectedValue(error),
      onError,
    });
    const response = await post(port, JSON.stringify(makeUpdate()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(onError).toHaveBeenCalledWith(error);
    expect(updateRecords(store)).toEqual([
      expect.objectContaining({ updateId: "1", adapter: "telegram", via: "webhook", failed: true }),
    ]);
  });

  it("returns 500 when persisting an update fails", async () => {
    const store = {
      fold: () => [],
      append: () => { throw Object.assign(new Error("disk full"), { code: "STORE_WRITE_FAILED" }); },
    };
    const { port } = await makeReceiverServer({ store });
    const response = await post(port, JSON.stringify(makeUpdate()));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "HTTP_HANDLER_FAILED" });
  });
});

describe("Telegram webhook mode synchronization", () => {
  it("switches between poll and webhook repeatedly with idempotent API requests", async () => {
    const fake = await startFakeTelegram();
    closeables.push(() => fake.close());
    const client = createTelegramClient({ getToken: () => BOT_TOKEN, apiBase: fake.apiBase });
    await syncWebhookMode({ client, mode: "webhook", url: "https://claw.example/telegram/webhook", secret: WEBHOOK_SECRET });
    await syncWebhookMode({ client, mode: "webhook", url: "https://claw.example/telegram/webhook", secret: WEBHOOK_SECRET });
    await syncWebhookMode({ client, mode: "poll" });
    await syncWebhookMode({ client, mode: "poll" });
    expect(fake.calls.map(({ method }) => method)).toEqual([
      "setWebhook", "setWebhook", "deleteWebhook", "deleteWebhook",
    ]);
    expect(fake.calls[0].args).toMatchObject({
      url: "https://claw.example/telegram/webhook",
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    expect(fake.calls[2].args).toEqual({ drop_pending_updates: false });
  });

  it("rejects invalid webhook configuration and modes without exposing secrets", async () => {
    const client = {
      setWebhook: vi.fn(async () => { throw new Error(`${BOT_TOKEN}:${WEBHOOK_SECRET}`); }),
      deleteWebhook: vi.fn(),
    };
    await expect(syncWebhookMode({ client, mode: "webhook", url: "http://claw.example/hook", secret: WEBHOOK_SECRET }))
      .rejects.toMatchObject({ code: "WEBHOOK_CONFIG_INVALID" });
    await expect(syncWebhookMode({ client, mode: "webhook", url: "https://claw.example/hook" }))
      .rejects.toMatchObject({ code: "WEBHOOK_CONFIG_INVALID" });
    await expect(syncWebhookMode({ client, mode: "webhook", url: "https://claw.example/hook", secret: WEBHOOK_SECRET }))
      .rejects.toMatchObject({ code: "WEBHOOK_SYNC_FAILED" });
    await expect(syncWebhookMode({ client, mode: "other" })).rejects.toMatchObject({ code: "WEBHOOK_MODE_INVALID" });
    expect(JSON.stringify(client.setWebhook.mock.results)).not.toContain(WEBHOOK_SECRET);
    expect(JSON.stringify(client.setWebhook.mock.results)).not.toContain(BOT_TOKEN);
  });
});

describe("dispatcher health routes", () => {
  it("serves liveness without probes and readiness with cached sanitized probe results", async () => {
    const http = createHttpServer({ port: 0 });
    const probe = vi.fn(async () => {});
    const unregister = registerHealthRoutes(http, { probes: { store: probe } });
    const { port } = await http.listen();
    closeables.push(async () => { unregister(); await http.close(); });
    const base = `http://127.0.0.1:${port}`;
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(probe).not.toHaveBeenCalled();
    const ready = await fetch(`${base}/readyz`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready", checks: { store: "ok" } });
    await fetch(`${base}/readyz`);
    expect(probe).toHaveBeenCalledOnce();
  });

  it("reports storage and Telegram probe failures without error details", async () => {
    const fake = await startFakeTelegram();
    closeables.push(() => fake.close());
    fake.failNext("getMe", { status: 500 });
    const client = createTelegramClient({ getToken: () => BOT_TOKEN, apiBase: fake.apiBase });
    const http = createHttpServer({ port: 0 });
    const unregister = registerHealthRoutes(http, {
      probes: {
        store: () => { throw new Error(`${WEBHOOK_SECRET}:${BOT_TOKEN}`); },
        telegram: () => client.getMe(),
      },
    });
    const { port } = await http.listen();
    closeables.push(async () => { unregister(); await http.close(); });
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(JSON.parse(body)).toEqual({ status: "not_ready", checks: { store: "fail", telegram: "fail" } });
    expect(body).not.toContain(WEBHOOK_SECRET);
    expect(body).not.toContain(BOT_TOKEN);
  });

  it("times out hanging probes and reports store.writeJsonAtomic failures", async () => {
    const http = createHttpServer({ port: 0 });
    const unregister = registerHealthRoutes(http, {
      timeoutMs: 10,
      probes: {
        store: () => { throw new Error("disk unavailable"); },
        hanging: () => new Promise(() => {}),
      },
    });
    const { port } = await http.listen();
    closeables.push(async () => { unregister(); await http.close(); });
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      checks: { store: "fail", hanging: "fail" },
    });
  });

  it("uses loopback by default and reference-counts shared listeners", async () => {
    const defaultHttp = createHttpServer({ port: 0 });
    await defaultHttp.listen();
    expect(defaultHttp.server.address().address).toBe("127.0.0.1");
    await defaultHttp.close();

    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
    const first = createHttpServer({ port });
    const second = createHttpServer({ port });
    expect(first.server).toBe(second.server);
    first.route("GET", "/first", ({ response }) => response.end("first"));
    second.route("GET", "/second", ({ response }) => response.end("second"));
    await first.listen();
    await second.listen();
    await first.close();
    const response = await fetch(`http://127.0.0.1:${port}/second`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("second");
    await second.close();
    expect(second.server.listening).toBe(false);
  });
});

describe("webhook feature startup rollback", () => {
  async function featureContext({ port, secret, onTelegramUpdate } = {}) {
    const home = await tempDirectory();
    const fake = await startFakeTelegram();
    closeables.push(() => fake.close());
    const store = createStore(path.join(home, "state"));
    return {
      home,
      store,
      config: {
        http: { bind: "127.0.0.1", port },
        channels: {
          telegram: {
            mode: "webhook",
            botTokenSecret: "BOT",
            apiBase: fake.apiBase,
            webhook: { url: "https://claw.example/telegram/webhook", secretTokenSecret: "WEBHOOK" },
          },
        },
      },
      secrets: {
        getSecret: (name) => ({ BOT: BOT_TOKEN, WEBHOOK: secret }[name] ?? null),
        redact: (text) => text,
      },
      logger: { error: vi.fn() },
      fake,
      ...(onTelegramUpdate ? { onTelegramUpdate } : {}),
    };
  }

  async function freePort() {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    return port;
  }

  it("fails closed for missing secrets or update sinks and releases its server handle", async () => {
    for (const [secret, onTelegramUpdate, code] of [
      [undefined, vi.fn(), "WEBHOOK_SECRET_MISSING"],
      [WEBHOOK_SECRET, undefined, "WEBHOOK_NO_UPDATE_SINK"],
    ]) {
      const port = await freePort();
      const ctx = await featureContext({ port, secret, onTelegramUpdate });
      await expect(webhookFeature.start(ctx)).rejects.toMatchObject({ code });
      expect(webhookFeature.snapshot()).toEqual({ mode: null, listening: false });
      const probe = createHttpServer({ port });
      await expect(probe.listen()).resolves.toMatchObject({ port });
      await probe.close();
    }
  });

  it("starts in webhook mode, serves health, and stops without clearing Telegram webhook", async () => {
    const port = await freePort();
    const ctx = await featureContext({
      port,
      secret: WEBHOOK_SECRET,
      onTelegramUpdate: async () => { throw new Error(`${BOT_TOKEN}:${WEBHOOK_SECRET}`); },
    });
    await webhookFeature.start(ctx);
    expect(webhookFeature.snapshot()).toEqual({ mode: "webhook", listening: true });
    vi.spyOn(ctx.store, "writeJsonAtomic").mockImplementation(() => {
      throw new Error(`${BOT_TOKEN}:${WEBHOOK_SECRET}`);
    });
    const base = `http://127.0.0.1:${port}`;
    const ready = await fetch(`${base}/readyz`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({
      status: "not_ready",
      checks: { store: "fail", telegram: "ok" },
    });
    const response = await post(port, JSON.stringify(makeUpdate()));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).not.toContain(WEBHOOK_SECRET);
    expect(body).not.toContain(BOT_TOKEN);
    expect(JSON.stringify(ctx.logger.error.mock.calls)).not.toContain(WEBHOOK_SECRET);
    expect(JSON.stringify(ctx.logger.error.mock.calls)).not.toContain(BOT_TOKEN);
    expect(ctx.fake.calls.map(({ method }) => method)).toEqual(["setWebhook", "getMe"]);
    await webhookFeature.stop();
    expect(webhookFeature.snapshot()).toEqual({ mode: null, listening: false });
  });
});
