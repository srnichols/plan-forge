import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../src/state/store.mjs";
import { ClawError } from "../src/errors.mjs";
import { createPoller, createTelegramAdapter, normalize } from "../src/channels/telegram/poller.mjs";
import { startFakeTelegram } from "./helpers/fake-telegram.mjs";

const TOKEN = "test-token-canary";
const directories = [];
const servers = [];

function makeDirectory() {
  const directory = mkdtempSync(join(process.cwd(), ".claw-telegram-"));
  directories.push(directory);
  return directory;
}

async function makeFake() {
  const fake = await startFakeTelegram();
  servers.push(fake);
  return fake;
}

function makeAdapter({ fake, directory, onUpdate = vi.fn(), onError = vi.fn(), signals = new EventEmitter(), now, sleep } = {}) {
  return createTelegramAdapter({
    config: { channels: { telegram: { apiBase: fake.apiBase } } },
    secrets: { getSecret: () => TOKEN, redact: (value) => String(value).split(TOKEN).join("[redacted]") },
    stateDir: directory,
    onUpdate,
    onError,
    signals,
    ...(now ? { now } : {}),
    ...(sleep ? { sleep } : {}),
  });
}

function readOffset(directory) {
  return JSON.parse(readFileSync(join(directory, "offsets.json"), "utf8"));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("Telegram update normalization", () => {
  it("normalizes messages, callbacks, topics and attachment ids", () => {
    expect(normalize({
      update_id: 3,
      message: {
        message_id: 5,
        message_thread_id: 8,
        chat: { id: -42 },
        from: { id: 9 },
        caption: "photo",
        document: { file_id: "document-id" },
        photo: [{ file_id: "small" }, { file_id: "large" }],
      },
    })).toEqual({
      v: 1,
      adapter: "telegram",
      updateId: "3",
      kind: "message",
      chatId: "-42",
      threadId: "8",
      userId: "9",
      messageId: "5",
      text: "photo",
      callbackId: null,
      data: null,
      files: [{ kind: "file", fileId: "document-id" }, { kind: "photo", fileId: "large" }],
    });
    expect(normalize({
      update_id: 4,
      callback_query: {
        id: "callback",
        from: { id: 10 },
        data: "approve",
        message: { message_id: 6, message_thread_id: 11, chat: { id: 42 } },
      },
    })).toMatchObject({
      updateId: "4",
      kind: "callback",
      chatId: "42",
      threadId: "11",
      callbackId: "callback",
      data: "approve",
    });
  });

  it("marks modern and legacy forwards without keeping sender identities", () => {
      const modern = normalize({
        update_id: 10,
        message: {
          message_id: 20,
          chat: { id: -100 },
          from: { id: 42, first_name: "Current" },
          text: "forwarded content",
          forward_origin: {
            type: "channel",
            date: 123,
            chat: { id: -200, title: "Original" },
            message_id: 5,
          },
        },
      });
      expect(modern).toMatchObject({
        userId: "42", forwarded: true, forwardOrigin: { type: "channel" },
      });
      expect(modern).not.toHaveProperty("forward_origin");
      expect(JSON.stringify(modern)).not.toMatch(/Original|-200|first_name/);

      const legacy = normalize({
        update_id: 11,
        message: {
          chat: { id: -100 },
          from: { id: 43, username: "current-user" },
          text: "legacy forward",
          forward_from: { id: 900, first_name: "Original" },
          forward_sender_name: "Hidden Sender",
        },
      });
      expect(legacy).toMatchObject({
        userId: "43", forwarded: true, forwardOrigin: { type: "legacy" },
      });
      expect(JSON.stringify(legacy)).not.toMatch(/900|Original|Hidden Sender/);
  });

  it.each(["voice", "audio"])("normalizes actual %s metadata into the frozen voice envelope", (kind) => {
    const envelope = normalize({
      update_id: 0,
      message: {
        message_id: 0, chat: { id: 0 }, from: { id: 0 },
        [kind]: { file_id: "voice-id", mime_type: "audio/ogg", file_size: 5, duration: 2, title: "not-retained" },
      },
    });
    expect(envelope).toMatchObject({
      updateId: "0", messageId: "0", chatId: "0", userId: "0", threadId: null,
      files: [{ kind: "voice", fileId: "voice-id", mimeType: "audio/ogg" }],
    });
    expect(envelope.files[0]).toEqual({ kind: "voice", fileId: "voice-id", mimeType: "audio/ogg" });
  });

  it("retains only bounded media metadata and leaves absent MIME types absent", () => {
    const envelope = normalize({
      update_id: 1,
      message: {
        voice: { file_id: "voice-id" },
        audio: { file_id: "x".repeat(257), mime_type: "audio/mpeg" },
        document: { file_id: "document-id", mime_type: "x".repeat(129), file_name: "not-retained" },
        photo: [{ file_id: "older", width: 1 }, { file_id: "latest", width: 4 }],
      },
    });
    expect(envelope.files).toEqual([
      { kind: "voice", fileId: "voice-id" },
      { kind: "file", fileId: "document-id" },
      { kind: "photo", fileId: "latest" },
    ]);
    expect(JSON.stringify(envelope)).not.toMatch(/file_name|width|not-retained/);
  });

  it("normalizes only necessary URL and text_link entities, including caption entities", () => {
    const text = "https://example.test source";
    const url = { type: "url", offset: 0, length: 20 };
    const link = { type: "text_link", offset: 21, length: 6, url: "https://example.test/article" };
    const entities = [
      { ...url, extra: "discard" },
      { ...link, user: { id: 900, username: "original-sender" } },
      { type: "text_mention", offset: 21, length: 6, user: { id: 901 } },
      { type: "bold", offset: 21, length: 6 },
    ];
    expect(normalize({ update_id: 1, message: { text, entities } }).entities).toEqual([url, link]);
    const captioned = normalize({ update_id: 2, message: { caption: text, caption_entities: entities } });
    expect(captioned.text).toBe(text);
    expect(captioned.entities).toEqual([url, link]);
    expect(JSON.stringify(captioned)).not.toMatch(/original-sender|discard|900|901|text_mention/);
  });

  it("bounds link entities and discards malformed metadata instead of raw objects", () => {
    const valid = { type: "text_link", offset: 0, length: 1, url: "https://example.test" };
    const entities = [
      { ...valid, offset: -1 },
      { ...valid, length: 0 },
      { ...valid, offset: 10 },
      { ...valid, offset: "0" },
      { ...valid, url: "javascript:untrusted()" },
      { ...valid, url: `https://example.test/${"x".repeat(2048)}` },
      ...Array.from({ length: 101 }, () => valid),
    ];
    const envelope = normalize({ update_id: 1, message: { text: "x", entities } });
    expect(envelope.entities).toHaveLength(100);
    expect(envelope.entities.every((entity) => JSON.stringify(entity) === JSON.stringify(valid))).toBe(true);
    expect(normalize({ update_id: 2, message: { text: "x", entities: [{}] } })).not.toHaveProperty("entities");
  });

  it("keeps missing and explicit-null identifiers null for messages and callbacks", () => {
    expect(normalize({
      message: { message_id: null, message_thread_id: null, chat: { id: null }, from: { id: null } },
    })).toMatchObject({ updateId: null, chatId: null, threadId: null, userId: null, messageId: null });
    expect(normalize({
      callback_query: { id: null, from: { id: null }, message: { message_id: null, chat: { id: null } } },
    })).toMatchObject({
      updateId: null, kind: "callback", chatId: null, threadId: null, userId: null, messageId: null, callbackId: null,
    });
  });

  it("preserves only recognized forward types and the true forward flag", () => {
    const malformed = normalize({
      update_id: 1,
      message: { text: "forward", forward_origin: { type: { sender: "hidden" }, sender_user: { id: 99 } } },
    });
    expect(malformed).toMatchObject({ forwarded: true, forwardOrigin: { type: "legacy" } });
    expect(JSON.stringify(malformed)).not.toMatch(/hidden|sender_user|99/);
    expect(normalize({ update_id: 2, message: { text: "ordinary", is_automatic_forward: false } }))
      .not.toHaveProperty("forwarded");
    expect(normalize({ update_id: 3, message: { text: "automatic", is_automatic_forward: true } }))
      .toMatchObject({ forwarded: true, forwardOrigin: { type: "legacy" } });
  });
});

describe("Telegram long poll receiver", () => {
  it("persists after a handler completes and resumes the offset after restart", async () => {
    const fake = await makeFake();
    const directory = makeDirectory();
    let finish;
    const handler = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const adapter = makeAdapter({ fake, directory, onUpdate: handler });
    const running = adapter.start();
    const update = fake.pushMessage({ text: "hold" });
    await fake.waitForCall("getUpdates");
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(existsSync(join(directory, "offsets.json"))).toBe(false);
    expect(existsSync(join(directory, "updates.jsonl"))).toBe(false);
    finish();
    await vi.waitFor(() => expect(readOffset(directory).telegram).toBe(update.update_id + 1));
    await adapter.stop();
    await running;

    const restartedHandler = vi.fn();
    const restarted = makeAdapter({ fake, directory, onUpdate: restartedHandler });
    const restartedRun = restarted.start();
    await fake.waitForCall("getUpdates", { count: 2 });
    expect(fake.calls.filter((call) => call.method === "getUpdates").at(-1).args.offset)
      .toBe(update.update_id + 1);
    expect(restartedHandler).not.toHaveBeenCalled();
    await restarted.stop();
    await restartedRun;
  });

  it("repairs an old saved offset for a duplicate without invoking or appending", async () => {
    const fake = await makeFake();
    const directory = makeDirectory();
    const store = createStore(directory);
    store.append("updates", { updateId: "1", adapter: "telegram" });
    store.writeJsonAtomic("offsets.json", { v: 1, telegram: 1 });
    const handler = vi.fn();
    const adapter = createTelegramAdapter({
      config: { channels: { telegram: { apiBase: fake.apiBase } } },
      secrets: { getSecret: () => TOKEN, redact: (value) => value },
      store,
      onUpdate: handler,
      signals: new EventEmitter(),
    });
    fake.pushMessage();
    const running = adapter.start();
    await fake.waitForCall("getUpdates");
    await vi.waitFor(() => expect(readOffset(directory).telegram).toBe(2));
    expect(handler).not.toHaveBeenCalled();
    expect(readFileSync(join(directory, "updates.jsonl"), "utf8").trim().split(/\r?\n/)).toHaveLength(1);
    await adapter.stop();
    await running;
  });

  it("does not advance a failed handler until maxHandlerAttempts is reached", async () => {
    const fake = await makeFake();
    const directory = makeDirectory();
    const handler = vi.fn().mockRejectedValue(new Error("handler failed"));
    let failFirstAttempt;
    handler.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      failFirstAttempt = reject;
    }));
    const onError = vi.fn();
    const adapter = createTelegramAdapter({
      config: { channels: { telegram: { apiBase: fake.apiBase } } },
      secrets: { getSecret: () => TOKEN, redact: (value) => value },
      stateDir: directory,
      onUpdate: handler,
      onError,
      signals: new EventEmitter(),
    });
    fake.pushMessage();
    const running = adapter.start();
    await fake.waitForCall("getUpdates");
    await vi.waitFor(() => expect(failFirstAttempt).toBeTypeOf("function"));
    expect(existsSync(join(directory, "offsets.json"))).toBe(false);
    expect(existsSync(join(directory, "updates.jsonl"))).toBe(false);
    failFirstAttempt(new Error("first attempt failed"));
    await vi.waitFor(() => expect(readOffset(directory).telegram).toBe(2));
    expect(handler).toHaveBeenCalledTimes(5);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(join(directory, "updates.jsonl"), "utf8"))).toMatchObject({
      updateId: "1",
      failed: true,
    });
    await adapter.stop();
    await running;
  });

  it("uses exponential loop backoff and resets only after successful polling", async () => {
    const directory = makeDirectory();
    const signals = new EventEmitter();
    const store = createStore(directory);
    const waits = [];
    let calls = 0;
    const client = {
      getUpdates: (_offset, { signal }) => {
        calls += 1;
        if (calls <= 3) return Promise.reject(new Error("transient"));
        return new Promise((_, reject) => signal.addEventListener(
          "abort",
          () => reject(new ClawError("TELEGRAM_ABORTED")),
          { once: true },
        ));
      },
    };
    const poller = createPoller({
      client,
      store,
      onUpdate: vi.fn(),
      onError: vi.fn(),
      signals,
      sleep: async (milliseconds) => { waits.push(milliseconds); },
    });
    const running = poller.start();
    await vi.waitFor(() => expect(waits).toEqual([1000, 2000, 4000]));
    await poller.stop();
    await running;
    expect(calls).toBe(4);
  });

  it.each(["TELEGRAM_UNAUTHORIZED", "TELEGRAM_CONFLICT"])("%s stops the polling loop", async (code) => {
    const directory = makeDirectory();
    const signals = new EventEmitter();
    const poller = createPoller({
      client: { getUpdates: async () => { throw new ClawError(code); } },
      store: createStore(directory),
      onUpdate: vi.fn(),
      signals,
    });
    await expect(poller.start()).rejects.toMatchObject({ code });
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("stops quickly during a held long poll and removes SIGTERM listeners", async () => {
    const fake = await makeFake();
    const directory = makeDirectory();
    const signals = new EventEmitter();
    const adapter = makeAdapter({ fake, directory, signals });
    const running = adapter.start();
    await fake.waitForCall("getUpdates");
    expect(signals.listenerCount("SIGTERM")).toBe(1);
    signals.emit("SIGTERM");
    await running;
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("stop aborts a held getUpdates request", async () => {
    const fake = await makeFake();
    const directory = makeDirectory();
    const adapter = makeAdapter({ fake, directory });
    const running = adapter.start();
    await fake.waitForCall("getUpdates");
    await expect(adapter.stop()).resolves.toBeUndefined();
    await expect(running).resolves.toBeUndefined();
  });

  it("does not advance past corrupt offset state", () => {
    const directory = makeDirectory();
    const store = createStore(directory);
    store.writeJsonAtomic("offsets.json", { v: 2, telegram: "bad" });
    expect(() => createPoller({
      client: { getUpdates: vi.fn() },
      store,
      onUpdate: vi.fn(),
      signals: new EventEmitter(),
    })).toThrowError("OFFSETS_CORRUPT");
  });

  it("preserves per-chat FIFO, independent chats and queued edit coalescing", async () => {
    const fake = await makeFake();
    const directory = makeDirectory();
    let clock = 0;
    const adapter = makeAdapter({
      fake,
      directory,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    });
    const sends = [
      adapter.send({ chatId: "42", text: "first" }),
      adapter.send({ chatId: "42", text: "second" }),
      adapter.send({ chatId: "7", text: "independent" }),
    ];
    await Promise.all(sends);
    const chatCalls = fake.calls
      .filter((call) => call.method === "sendMessage" && call.args.chat_id === "42")
      .map((call) => call.args.text);
    expect(chatCalls).toEqual(["first", "second"]);
    const sendCalls = fake.calls.filter((call) => call.method === "sendMessage");
    expect(sendCalls.findIndex((call) => call.args.text === "independent"))
      .toBeLessThan(sendCalls.findIndex((call) => call.args.text === "second"));

    const firstEdit = adapter.edit({ chatId: "42", messageId: "5", text: "older" });
    const secondEdit = adapter.edit({ chatId: "42", messageId: "5", text: "newer" });
    await expect(firstEdit).resolves.toMatchObject({ text: "newer" });
    await expect(secondEdit).resolves.toMatchObject({ text: "newer" });
    expect(fake.calls.filter((call) => call.method === "editMessageText")).toHaveLength(1);
    await adapter.stop();
  });
});
