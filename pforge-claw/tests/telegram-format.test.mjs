import { describe, expect, it } from "vitest";
import { ClawError } from "../src/errors.mjs";
import {
  button,
  chunkForTelegram,
  chunkText,
  escapeMdV2,
  formatMdV2,
  keyboard,
} from "../src/channels/telegram/format.mjs";

describe("Telegram MarkdownV2 formatting", () => {
  it.each(["_", "*", "[", "]", "(", ")", "~", "`", ">", "#", "+", "=", "|", "{", "}", ".", "!", "\\", "-"])(
    "escapes %s",
    (character) => expect(escapeMdV2(character)).toBe(`\\${character}`),
  );

  it("prefers paragraph and newline boundaries in the latter half of a chunk", () => {
    expect(chunkText(`${"a".repeat(20)}\n\n${"b".repeat(10)}`, 24)[0]).toBe(`${"a".repeat(20)}\n\n`);
    expect(chunkText(`${"a".repeat(20)}\n${"b".repeat(10)}`, 24)[0]).toBe(`${"a".repeat(20)}\n`);
  });

  it("hard cuts without exceeding the limit and keeps surrogate pairs together", () => {
    const chunks = chunkText(`${"x".repeat(5)}😀${"y".repeat(5)}`, 6);
    expect(chunks.every((chunk) => chunk.length <= 6)).toBe(true);
    expect(chunks.join("")).toBe(`${"x".repeat(5)}😀${"y".repeat(5)}`);
    expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    expect(chunks.every((chunk) => !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true);
  });

  it("keeps escaped all-special text under Telegram's message limit", () => {
    const chunks = chunkForTelegram("_*[]()~`>#+=|{}.!\\-".repeat(500));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  });

  it("rejects empty text and uses UTF-8 byte lengths for callback data", () => {
    expect(() => chunkForTelegram("")).toThrowError("TELEGRAM_EMPTY_TEXT");
    expect(button("Go", "a".repeat(64))).toEqual({ text: "Go", callback_data: "a".repeat(64) });
    expect(() => button("Go", "a".repeat(65))).toThrowError("CALLBACK_DATA_TOO_LONG");
    expect(button("Go", "😀".repeat(16))).toEqual({ text: "Go", callback_data: "😀".repeat(16) });
    const callbackData = "private-nonce-" + "x".repeat(60);
    try {
      button("Go", callbackData);
      throw new Error("expected callback-data validation");
    } catch (error) {
      expect(error).toBeInstanceOf(ClawError);
      expect(error.code).toBe("CALLBACK_DATA_TOO_LONG");
      expect(error.details).toEqual({ bytes: Buffer.byteLength(callbackData, "utf8") });
      expect(JSON.stringify(error)).not.toContain(callbackData);
      expect(String(error)).not.toContain(callbackData);
    }
  });

  it("validates keyboard row and total bounds", () => {
    expect(keyboard([[{ text: "Go", data: "ok" }]])).toEqual({
      inline_keyboard: [[{ text: "Go", callback_data: "ok" }]],
    });
    expect(() => keyboard([[{ text: "", data: "ok" }]])).toThrowError("TELEGRAM_BUTTON_TEXT_EMPTY");
    expect(() => keyboard([Array.from({ length: 9 }, (_, index) => ({ text: String(index), data: "x" }))]))
      .toThrowError("TELEGRAM_KEYBOARD_INVALID");
    expect(() => keyboard(Array.from({ length: 13 }, (_, row) =>
      Array.from({ length: 8 }, (_, column) => ({ text: `${row}-${column}`, data: "x" })))))
      .toThrowError("TELEGRAM_KEYBOARD_INVALID");
  });
});

describe("formatMdV2 (channel-owned escaping + clickable links)", () => {
  it("escapes plain text exactly once and renders bare https URLs as inline links", () => {
    expect(formatMdV2("Done. PR: https://example.com/pr/42")).toBe(
      "Done\\. PR: [https://example\\.com/pr/42](https://example.com/pr/42)",
    );
  });

  it("keeps trailing punctuation outside the link and never links non-https schemes", () => {
    expect(formatMdV2("See https://example.com/a.")).toBe("See [https://example\\.com/a](https://example.com/a)\\.");
    expect(formatMdV2("http://example.com")).toBe("http://example\\.com");
  });

  it("does not let a URL break out of the link target with ) or \\", () => {
    const rendered = formatMdV2("x https://example.com/a)b");
    expect(rendered).toBe("x [https://example\\.com/a](https://example.com/a)\\)b");
  });
});