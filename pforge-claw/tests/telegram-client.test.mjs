import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramClient, DEFAULT_API_BASE } from "../src/channels/telegram/client.mjs";
import { startFakeTelegram } from "./helpers/fake-telegram.mjs";

const TOKEN = "test-token-canary";

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function expectTokenHidden(error) {
  expect(JSON.stringify(error)).not.toContain(TOKEN);
  expect(error.stack).not.toContain(TOKEN);
  expect(String(error)).not.toContain(TOKEN);
}

describe("Telegram client", () => {
  afterEach(() => vi.useRealTimers());

  it("uses Telegram request field names and the documented API base", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, result: { message_id: 2 } }));
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl, apiBase: "https://api.telegram.org///" });
    await client.getUpdates(4, { timeout: 3 });
    await client.sendMessage({ chatId: "42", text: "hello", threadId: "8", parseMode: "MarkdownV2" });
    expect(DEFAULT_API_BASE).toBe("https://api.telegram.org");
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      offset: 4,
      timeout: 3,
      allowed_updates: ["message", "callback_query"],
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
      chat_id: "42",
      message_thread_id: "8",
      parse_mode: "MarkdownV2",
    });
  });

  it("keeps explicit chat and chat_member command scopes separate from the default", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, result: true }));
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl });
    const commands = [{ command: "ask", description: "Ask" }];
    await client.setMyCommands(commands, { scope: { type: "chat", chat_id: "-42" } });
    await client.setMyCommands(commands, { scope: { type: "chat_member", chat_id: "-42", user_id: "9" } });
    await client.setMyCommands(commands);
    expect(fetchImpl.mock.calls.map(([_url, options]) => JSON.parse(options.body))).toEqual([
      { commands, scope: { type: "chat", chat_id: "-42" } },
      { commands, scope: { type: "chat_member", chat_id: "-42", user_id: "9" } },
      { commands },
    ]);
  });

  it("retries 429 responses after their bounded delay", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(429, { ok: false, parameters: { retry_after: 1 } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { id: 1 } }));
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl });
    const pending = client.getMe();
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ id: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caps retry delay and reports exhaustion", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => jsonResponse(429, {
      ok: false,
      parameters: { retry_after: 100 },
    }));
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl, maxRetries: 1 });
    const pending = client.getMe();
    const rejected = expect(pending).rejects.toMatchObject({
      code: "TELEGRAM_RATE_LIMITED",
      details: { retryAfterMs: 60_000 },
    });
    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves immediate retry exhaustion for a non-comparable retry budget", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { ok: false, parameters: { retry_after: 1 } }));
    const sleep = vi.fn(async () => { throw new Error("unexpected retry"); });
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl, sleep, maxRetries: NaN });
    await expect(client.getMe()).rejects.toMatchObject({
      code: "TELEGRAM_RATE_LIMITED", details: { retryAfterMs: 1000 },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry unauthorized responses and requires the token before fetching", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false }));
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl });
    await expect(client.getMe()).rejects.toMatchObject({ code: "TELEGRAM_UNAUTHORIZED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const missing = createTelegramClient({ getToken: () => null, fetchImpl });
    await expect(missing.getMe()).rejects.toMatchObject({ code: "TELEGRAM_TOKEN_MISSING" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["network", async () => { throw new Error(`network leaked ${TOKEN}`); }],
    ["API", async () => jsonResponse(400, { ok: false, description: `bad token ${TOKEN}` })],
    ["non-JSON", async () => new Response("bad", { status: 500 })],
  ])("never exposes the token in %s errors", async (_label, fetchImpl) => {
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl });
    try {
      await client.getMe();
      throw new Error("expected client error");
    } catch (error) {
      expectTokenHidden(error);
    }
  });

  it("does not expose the token on a failed file download and enforces streamed size", async () => {
    const networkFailure = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { file_path: "docs/a.bin", file_size: 1 } }))
      .mockRejectedValueOnce(new Error(`download leaked ${TOKEN}`));
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl: networkFailure });
    try {
      await client.downloadFile("f1");
      throw new Error("expected download error");
    } catch (error) {
      expectTokenHidden(error);
    }

    const oversized = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { file_path: "docs/a.bin", file_size: 1 } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const bounded = createTelegramClient({ getToken: () => TOKEN, fetchImpl: oversized });
    await expect(bounded.downloadFile("f1", { maxBytes: 2 })).rejects.toMatchObject({
      code: "TELEGRAM_FILE_TOO_LARGE",
    });
  });

  it.each([-1, Infinity, NaN, 1.5, 20 * 1024 * 1024 + 1, "2", null])(
    "rejects an invalid download byte bound %s before any fetch",
    async (maxBytes) => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, result: {} }));
      const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl });
      await expect(client.downloadFile("f1", { maxBytes })).rejects.toMatchObject({
        code: "TELEGRAM_FILE_LIMIT_INVALID",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("rejects oversized declared files before downloading and allows an empty zero-bound file", async () => {
    const oversized = vi.fn(async () => jsonResponse(200, {
      ok: true, result: { file_path: "docs/a.bin", file_size: 3 },
    }));
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl: oversized });
    await expect(client.downloadFile("f1", { maxBytes: 2 })).rejects.toMatchObject({
      code: "TELEGRAM_FILE_TOO_LARGE",
    });
    expect(oversized).toHaveBeenCalledTimes(1);

    const empty = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { file_path: "docs/empty.bin", file_size: 0 } }))
      .mockResolvedValueOnce(new Response(new Uint8Array()));
    const zeroBound = createTelegramClient({ getToken: () => TOKEN, fetchImpl: empty });
    await expect(zeroBound.downloadFile("empty", { maxBytes: 0 })).resolves.toEqual({
      fileId: "empty", filePath: "docs/empty.bin", bytes: Buffer.alloc(0),
    });
  });

  it("bounds non-streaming downloads and hides errors while consuming streamed bytes", async () => {
    const fallback = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { file_path: "docs/a.bin" } }))
      .mockResolvedValueOnce({ status: 200, ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl: fallback });
    await expect(client.downloadFile("f1", { maxBytes: 2 })).rejects.toMatchObject({
      code: "TELEGRAM_FILE_TOO_LARGE",
    });
    const failingStream = new ReadableStream({
      pull(controller) { controller.error(new Error(`stream leaked ${TOKEN}`)); },
    });
    const streamFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, result: { file_path: "docs/a.bin" } }))
      .mockResolvedValueOnce(new Response(failingStream));
    const streamClient = createTelegramClient({ getToken: () => TOKEN, fetchImpl: streamFetch });
    try {
      await streamClient.downloadFile("f1");
      throw new Error("expected stream error");
    } catch (error) {
      expect(error.code).toBe("TELEGRAM_NETWORK");
      expectTokenHidden(error);
    }
  });

  it.each(["../secret", "/absolute", "https://example.test/file", "docs/%2e%2e/secret", ""])(
    "rejects a malformed Telegram file path %s without a download",
    async (filePath) => {
      const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, result: { file_path: filePath } }));
      const client = createTelegramClient({ getToken: () => TOKEN, fetchImpl });
      await expect(client.downloadFile("f1")).rejects.toMatchObject({ code: "TELEGRAM_FILE_PATH_INVALID" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("reads a rotated token for each method call and validates apiBase", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true, result: true }));
    const tokens = ["first-token", "second-token"];
    const client = createTelegramClient({ getToken: () => tokens.shift(), fetchImpl });
    await client.getMe();
    await client.getMe();
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://api.telegram.org/botfirst-token/getMe",
      "https://api.telegram.org/botsecond-token/getMe",
    ]);
    expect(() => createTelegramClient({ getToken: () => TOKEN, apiBase: "file:///tmp" }))
      .toThrowError("TELEGRAM_API_BASE_INVALID");
  });

  it("round-trips through the local fake Telegram server", async () => {
    const fake = await startFakeTelegram();
    try {
      fake.addFile("f1", Buffer.from([4, 5, 6]));
      const client = createTelegramClient({ getToken: () => TOKEN, apiBase: fake.apiBase });
      await expect(client.getMe()).resolves.toMatchObject({ username: "fake_bot" });
      await client.sendMessage({ chatId: "42", text: "hello" });
      const file = await client.downloadFile("f1");
      expect(file).toMatchObject({ fileId: "f1", filePath: "documents/f1.bin", bytes: Buffer.from([4, 5, 6]) });
      expect(fake.calls.map(({ method }) => method)).toEqual(["getMe", "sendMessage", "getFile"]);
    } finally {
      await fake.close();
    }
  });
});
