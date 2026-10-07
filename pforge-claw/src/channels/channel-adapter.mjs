import { ClawError } from "../errors.mjs";

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
 * All identifiers are strings.
 *
 * Limits: frozen { maxMessageLength:4096, chunkLength:3800,
 * maxCallbackDataBytes:64, maxFileBytes:20*1024*1024,
 * parseMode:"MarkdownV2" }.
 *
 * Message reference: { chatId, messageId, threadId }.
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
        maxFileBytes: 20 * 1024 * 1024,
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
