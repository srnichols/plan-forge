import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertChannelAdapter, runChannelAdapterContract } from "../src/channels/channel-adapter.mjs";
import { createTelegramAdapter } from "../src/channels/telegram/poller.mjs";
import { startFakeTelegram } from "./helpers/fake-telegram.mjs";

const TOKEN = "test-token-canary";
const directories = [];
let fake;

function makeAdapter({ fetchImpl, onUpdate = vi.fn(), now, sleep } = {}) {
  const stateDir = mkdtempSync(join(process.cwd(), ".claw-contract-"));
  directories.push(stateDir);
  return createTelegramAdapter({
    config: { channels: { telegram: { apiBase: fake.apiBase } } },
    secrets: { getSecret: () => TOKEN, redact: (value) => String(value).split(TOKEN).join("[redacted]") },
    stateDir,
    onUpdate,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(now ? { now } : {}),
    ...(sleep ? { sleep } : {}),
    signals: new (class {
      listeners = new Map();
      on(name, handler) { this.listeners.set(name, handler); }
      off(name) { this.listeners.delete(name); }
    })(),
  });
}

beforeAll(async () => {
  fake = await startFakeTelegram();
});

afterAll(async () => {
  await fake.close();
  directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

runChannelAdapterContract({ describe, it, expect, makeAdapter });

describe("channel adapter validation", () => {
  it("reports missing methods and limits", () => {
    try {
      assertChannelAdapter({ start() {} });
      throw new Error("expected adapter validation");
    } catch (error) {
      expect(error.code).toBe("CHANNEL_ADAPTER_INVALID");
      expect(error.details.missing).toContain("send");
      expect(error.details.missing).toContain("limits");
    }
  });

  it("accepts a complete channel adapter", () => {
    const adapter = makeAdapter();
    expect(assertChannelAdapter(adapter)).toBe(adapter);
  });
});

describe("FP06 actual adapter boundaries", () => {
  it("delivers typed media and caption links through the real client and store", async () => {
    const updates = [
      {
        update_id: 21,
        message: {
          message_id: 31, chat: { id: -42 }, from: { id: 9 }, message_thread_id: 8,
          voice: { file_id: "voice-id", mime_type: "audio/ogg", duration: 4, file_unique_id: "discard-me" },
        },
      },
      {
        update_id: 22,
        message: {
          message_id: 32, chat: { id: -42 }, from: { id: 9 },
          photo: [{ file_id: "small" }, { file_id: "large" }],
          caption: "source",
          caption_entities: [{ type: "text_link", offset: 0, length: 6, url: "https://example.test/photo" }],
        },
      },
      {
        update_id: 23,
        message: {
          message_id: 33, chat: { id: -42 }, from: { id: 9 },
          document: { file_id: "document-id", mime_type: "text/plain", file_name: "discard-name" },
        },
      },
    ];
    let delivered;
    const received = new Promise((resolve) => { delivered = resolve; });
    const envelopes = [];
    let polled = false;
    const fetchImpl = vi.fn(async (_url, { signal }) => {
      if (!polled) {
        polled = true;
        return new Response(JSON.stringify({ ok: true, result: updates }));
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    const adapter = makeAdapter({
      fetchImpl,
      onUpdate: (envelope) => {
        envelopes.push(envelope);
        if (envelopes.length === updates.length) delivered();
      },
    });
    const running = adapter.start();
    try {
      await received;
      expect(envelopes[0]).toMatchObject({
        updateId: "21", chatId: "-42", threadId: "8", userId: "9", messageId: "31",
        files: [{ kind: "voice", fileId: "voice-id", mimeType: "audio/ogg" }],
      });
      expect(envelopes[1]).toMatchObject({
        text: "source",
        files: [{ kind: "photo", fileId: "large" }],
        entities: [{ type: "text_link", offset: 0, length: 6, url: "https://example.test/photo" }],
      });
      expect(envelopes[2].files).toEqual([{ kind: "file", fileId: "document-id", mimeType: "text/plain" }]);
      expect(JSON.stringify(envelopes)).not.toMatch(/discard-me|discard-name|file_unique_id|file_name/);
    } finally {
      await adapter.stop();
      await running;
    }
  });

  it("preserves separate owner and member menu scopes in actual HTTP bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: true })));
    const adapter = makeAdapter({ fetchImpl });
    const ownerCommands = [{ command: "task", description: "Work" }, { command: "ask", description: "Ask" }];
    const viewerCommands = [{ command: "ask", description: "Ask" }];
    const ownerScope = { type: "chat", chat_id: "-42" };
    const viewerScope = { type: "chat_member", chat_id: "-42", user_id: "9" };
    try {
      await adapter.setMenu(ownerCommands, { scope: ownerScope });
      await adapter.setMenu(viewerCommands, { scope: viewerScope });
      expect(fetchImpl.mock.calls.map(([_url, options]) => JSON.parse(options.body))).toEqual([
        { commands: ownerCommands, scope: ownerScope },
        { commands: viewerCommands, scope: viewerScope },
      ]);
      expect(fetchImpl.mock.calls.every(([url]) => url.endsWith("/setMyCommands"))).toBe(true);
    } finally {
      await adapter.stop();
    }
  });

  it("spaces awaited sends and chunk sends after separately drained queues", async () => {
    let clock = 0;
    const calls = [];
    const fetchImpl = vi.fn(async (_url, options) => {
      calls.push({ at: clock, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
    });
    const adapter = makeAdapter({
      fetchImpl, now: () => clock, sleep: async (milliseconds) => { clock += milliseconds; },
    });
    const replyMarkup = { inline_keyboard: [[{ text: "Use", callback_data: "t:test:u" }]] };
    try {
      const first = await adapter.send({ chatId: "42", threadId: "8", text: "first" });
      const chunks = await adapter.send({
        chatId: "42", threadId: "8", text: `${TOKEN}${"x".repeat(5000)}`, replyMarkup,
      });
      expect(calls.map(({ at }) => at)).toEqual([0, 1000, 2000]);
      expect(first).toEqual([{ chatId: "42", messageId: "1", threadId: "8" }]);
      expect(chunks).toEqual([
        { chatId: "42", messageId: "2", threadId: "8" },
        { chatId: "42", messageId: "3", threadId: "8" },
      ]);
      expect(calls.slice(1).map(({ body }) => body)).toEqual([
        expect.objectContaining({ chat_id: "42", message_thread_id: "8", reply_markup: replyMarkup, parse_mode: "MarkdownV2" }),
        expect.objectContaining({ chat_id: "42", message_thread_id: "8", reply_markup: replyMarkup, parse_mode: "MarkdownV2" }),
      ]);
      expect(calls.every(({ body }) => body.text.length <= adapter.limits.maxMessageLength)).toBe(true);
      expect(JSON.stringify(calls)).not.toContain(TOKEN);
    } finally {
      await adapter.stop();
    }
  });

  it("returns bounded bytes without manufacturing a local audio path", async () => {
    const bytes = Buffer.from([4, 5, 6]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true, result: { file_path: "voice/note.ogg", file_size: bytes.length },
      })))
      .mockResolvedValueOnce(new Response(bytes));
    const adapter = makeAdapter({ fetchImpl });
    try {
      const downloaded = await adapter.download({ fileId: "voice-id", maxBytes: bytes.length });
      expect(downloaded).toEqual({ fileId: "voice-id", filePath: "voice/note.ogg", bytes });
      expect(Buffer.isBuffer(downloaded.bytes)).toBe(true);
      expect(downloaded).not.toHaveProperty("audioPath");
      expect(downloaded).not.toHaveProperty("path");
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ file_id: "voice-id" });
    } finally {
      await adapter.stop();
    }
  });
});
