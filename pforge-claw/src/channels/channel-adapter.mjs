import { ClawError } from "../errors.mjs";

export const CHANNEL_MAX_FILE_BYTES = 20_971_520;

export const CHANNEL_ADAPTER_METHODS = Object.freeze([
  "start",
  "stop",
  "send",
  "edit",
  "answerCallback",
  "setMenu",
  "download",
  "typing",
]);

/**
 * Update envelope: { v:1, adapter, updateId, kind:"message"|"callback",
 * chatId, threadId, userId, messageId, text, callbackId, data, files }.
 * Identifiers are strings or null when absent.
 * files contains only { kind:"voice"|"photo"|"file", fileId, mimeType? }.
 * Audio uses kind:"voice"; photos select the latest size. Attachment IDs
 * are bounded to 256 characters, MIME types to 128.
 * Optional entities contains at most 100 URL/text_link entries with
 * { type, offset, length, url? }; link targets are bounded to 2048 characters.
 * Optional forwarded:true / forwardOrigin:{type} never retains sender identities.
 *
 * Limits: frozen { maxMessageLength:4096, chunkLength:3800,
 * maxCallbackDataBytes:64, maxFileBytes:20*1024*1024,
 * parseMode:"MarkdownV2" }.
 *
 * Message reference: { chatId, messageId, threadId }.
 * setMenu(commands, {scope}={}) preserves the supplied channel scope; omitting
 * options retains the default menu. Telegram chat menus union their topics.
 * download({fileId,maxBytes?}) returns {fileId,filePath,bytes:Buffer};
 * filePath is remote metadata, not a local path. maxBytes cannot exceed the
 * adapter limit. The consumer owns any byte-to-local-file bridge and cleanup.
 */
export function assertChannelAdapter(adapter) {
  const missing = CHANNEL_ADAPTER_METHODS.filter((method) => typeof adapter?.[method] !== "function");
  if (!adapter?.limits || typeof adapter.limits !== "object" || Array.isArray(adapter.limits)) {
    missing.push("limits");
  }
  if (missing.length > 0) throw new ClawError("CHANNEL_ADAPTER_INVALID", { missing });
  return adapter;
}

export function runChannelAdapterContract({ describe, it, expect, makeAdapter }) {
  describe("channel adapter contract", () => {
    it("exposes the complete adapter surface and limits", () => {
      const adapter = assertChannelAdapter(makeAdapter());
      expect(adapter.limits).toEqual(expect.objectContaining({
        maxMessageLength: 4096,
        chunkLength: 3800,
        maxCallbackDataBytes: 64,
        maxFileBytes: CHANNEL_MAX_FILE_BYTES,
        parseMode: "MarkdownV2",
      }));
    });

    it("starts and stops without exposing transport details", async () => {
      const adapter = assertChannelAdapter(makeAdapter());
      const running = adapter.start();
      await adapter.stop();
      await running;
    });

    it("sends text as an array of message references", async () => {
      const adapter = assertChannelAdapter(makeAdapter());
      const refs = await adapter.send({ chatId: "42", text: "contract" });
      expect(Array.isArray(refs)).toBe(true);
      for (const ref of refs) expect(ref).toEqual(expect.objectContaining({
        chatId: "42",
        messageId: expect.any(String),
      }));
      await adapter.stop();
    });
  });
}
