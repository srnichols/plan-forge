import { ClawError } from "../../errors.mjs";

// D1 duplicates bridge.mjs helpers; these move to pforge-sdk with the shared channel contracts.
const MARKDOWN_V2_SPECIAL = /[_*[\]()~`>#+=|{}.!\\-]/g;
const DEFAULT_CHUNK_LENGTH = 3800;
const TELEGRAM_LIMIT = 4096;
const CALLBACK_LIMIT = 64;
const MAX_BUTTONS_PER_ROW = 8;
const MAX_BUTTONS = 100;

export function escapeMdV2(value) {
  return String(value).replace(MARKDOWN_V2_SPECIAL, "\\$&");
}

function safeBoundary(text, end) {
  if (end > 0 && end < text.length) {
    const prior = text.charCodeAt(end - 1);
    const next = text.charCodeAt(end);
    if (prior >= 0xd800 && prior <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return end - 1;
  }
  return end;
}

function findPreferredBreak(text, start, end) {
  const midpoint = start + Math.floor((end - start) / 2);
  const paragraph = text.lastIndexOf("\n\n", end - 1);
  if (paragraph >= midpoint) return paragraph + 2;
  const newline = text.lastIndexOf("\n", end - 1);
  return newline >= midpoint ? newline + 1 : end;
}

export function chunkText(value, limit = DEFAULT_CHUNK_LENGTH) {
  const text = String(value);
  if (!Number.isInteger(limit) || limit < 1) throw new ClawError("TELEGRAM_CHUNK_LIMIT_INVALID");
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = safeBoundary(text, Math.min(start + limit, text.length));
    if (end < text.length) end = safeBoundary(text, findPreferredBreak(text, start, end));
    if (end <= start) end = safeBoundary(text, Math.min(start + limit + 1, text.length));
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function splitEscapedChunk(text, limit) {
  const parts = [];
  let part = "";
  let length = 0;
  for (const character of text) {
    const escaped = escapeMdV2(character);
    if (length + escaped.length > limit && part) {
      parts.push(part);
      part = "";
      length = 0;
    }
    part += escaped;
    length += escaped.length;
  }
  if (part) parts.push(part);
  return parts;
}

export function chunkForTelegram(value, { limit = TELEGRAM_LIMIT } = {}) {
  if (typeof value !== "string" || value.length === 0) throw new ClawError("TELEGRAM_EMPTY_TEXT");
  if (!Number.isInteger(limit) || limit < 1 || limit > TELEGRAM_LIMIT) {
    throw new ClawError("TELEGRAM_CHUNK_LIMIT_INVALID");
  }
  return chunkText(value, DEFAULT_CHUNK_LENGTH)
    .flatMap((chunk) => splitEscapedChunk(chunk, limit));
}

export function button(text, data) {
  const callbackData = typeof data === "string" ? data : "";
  const bytes = Buffer.byteLength(callbackData, "utf8");
  if (bytes < 1 || bytes > CALLBACK_LIMIT) {
    throw new ClawError("CALLBACK_DATA_TOO_LONG", { bytes });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ClawError("TELEGRAM_BUTTON_TEXT_EMPTY");
  }
  return { text, callback_data: callbackData };
}

export function keyboard(rows) {
  if (!Array.isArray(rows)) throw new ClawError("TELEGRAM_KEYBOARD_INVALID");
  let count = 0;
  const inlineKeyboard = rows.map((row) => {
    if (!Array.isArray(row) || row.length > MAX_BUTTONS_PER_ROW) {
      throw new ClawError("TELEGRAM_KEYBOARD_INVALID");
    }
    count += row.length;
    if (count > MAX_BUTTONS) throw new ClawError("TELEGRAM_KEYBOARD_INVALID");
    return row.map((item) => {
      if (!item || typeof item.text !== "string" || item.text.trim().length === 0) {
        throw new ClawError("TELEGRAM_BUTTON_TEXT_EMPTY");
      }
      const result = item.callback_data === undefined
        ? button(item.text, item.data)
        : button(item.text, item.callback_data);
      return result;
    });
  });
  return { inline_keyboard: inlineKeyboard };
}
