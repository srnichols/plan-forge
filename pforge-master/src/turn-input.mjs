export const ROLES = Object.freeze(["owner", "approver", "viewer"]);
export const CHANNELS = Object.freeze(["dashboard", "vscode", "chat", "api"]);
export const STYLES = Object.freeze(["standard", "brief"]);
export const UNTRUSTED_KINDS = Object.freeze(["forward", "link", "transcript", "file", "other"]);
export const LIMITS = Object.freeze({ untrustedBytes: 8192, contextBytes: 4096, minChars: 200, maxChars: 20000 });
export const NEW_TURN_FIELDS = Object.freeze(["caller", "responseFormat", "untrustedContext", "contextBlocks", "proposeActions"]);

const TRUNCATION_MARKER = "\n…(truncated)";
const TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER, "utf8");
const UTF8_CONTINUATION_MASK = 0xc0;
const UTF8_CONTINUATION_PREFIX = 0x80;

function fail(field, message) {
  return { ok: false, error: "INVALID_INPUT", field, message };
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateItems(items, field, kindValues, requiresTitle) {
  if (!Array.isArray(items)) return fail(field, "array required");
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const itemField = `${field}[${index}]`;
    if (!isPlainObject(item)) return fail(itemField, "object required");
    if (kindValues && !kindValues.includes(item.kind)) {
      return fail(itemField, `kind must be ${kindValues.join("|")}`);
    }
    if (requiresTitle && typeof item.title !== "string") return fail(itemField, "title must be a string");
    if (typeof item.text !== "string") return fail(itemField, "text must be a string");
    if (item.source !== undefined && typeof item.source !== "string") {
      return fail(itemField, "source must be a string");
    }
  }
  return { ok: true };
}

function utf8Prefix(text, maxBytes) {
  const bytes = Buffer.from(text, "utf8");
  let end = Math.min(maxBytes, bytes.length);
  while (end > 0 && end < bytes.length && (bytes[end] & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION_PREFIX) end--;
  return bytes.subarray(0, end).toString("utf8");
}

function capItems(items, maxBytes) {
  const totalBytes = items.reduce((total, item) => total + Buffer.byteLength(item.text, "utf8"), 0);
  if (totalBytes <= maxBytes) return { items: items.map((item) => ({ ...item })), truncated: false };

  const contentLimit = maxBytes - TRUNCATION_MARKER_BYTES;
  let usedBytes = 0;
  const capped = [];
  for (const item of items) {
    const itemBytes = Buffer.byteLength(item.text, "utf8");
    const remaining = contentLimit - usedBytes;
    if (itemBytes <= remaining) {
      capped.push({ ...item });
      usedBytes += itemBytes;
      continue;
    }

    const text = `${utf8Prefix(item.text, remaining)}${TRUNCATION_MARKER}`;
    if (remaining === 0 && capped.length > 0) {
      const lastIndex = capped.length - 1;
      capped[lastIndex] = { ...capped[lastIndex], text: `${capped[lastIndex].text}${TRUNCATION_MARKER}` };
    } else {
      capped.push({ ...item, text });
    }
    break;
  }
  return { items: capped, truncated: true };
}

function normalizeCaller(caller) {
  if (!isPlainObject(caller)) return fail("caller", "object required");
  if (!ROLES.includes(caller.role)) return fail("caller.role", `must be ${ROLES.join("|")}`);
  if (!CHANNELS.includes(caller.channel)) return fail("caller.channel", `must be ${CHANNELS.join("|")}`);
  for (const field of ["surface", "projectId", "topic"]) {
    if (caller[field] !== undefined && typeof caller[field] !== "string") {
      return fail(`caller.${field}`, "must be a string");
    }
  }
  return { ok: true, value: { ...caller } };
}

function normalizeResponseFormat(format) {
  if (!isPlainObject(format)) return fail("responseFormat", "object required");
  const style = format.style === undefined ? "standard" : format.style;
  if (!STYLES.includes(style)) return fail("responseFormat.style", `must be ${STYLES.join("|")}`);
  if (format.maxChars !== undefined &&
      !(Number.isInteger(format.maxChars) && format.maxChars >= LIMITS.minChars && format.maxChars <= LIMITS.maxChars)) {
    return fail("responseFormat.maxChars", `integer ${LIMITS.minChars}-${LIMITS.maxChars}`);
  }
  return { ok: true, value: { ...format, style } };
}

function normalizeContextItems({ items, field, kindValues, requiresTitle, byteLimit, truncatedKey }) {
  const valid = validateItems(items, field, kindValues, requiresTitle);
  if (!valid.ok) return valid;
  const capped = capItems(items, byteLimit);
  return {
    ok: true,
    value: capped.items,
    ...(capped.truncated ? { truncated: truncatedKey } : {}),
  };
}

const NORMALIZERS = [
  { field: "caller", normalize: normalizeCaller },
  { field: "responseFormat", normalize: normalizeResponseFormat },
  {
    field: "untrustedContext",
    normalize: (items) => normalizeContextItems({
      items,
      field: "untrustedContext",
      kindValues: UNTRUSTED_KINDS,
      requiresTitle: false,
      byteLimit: LIMITS.untrustedBytes,
      truncatedKey: "untrusted",
    }),
  },
  {
    field: "contextBlocks",
    normalize: (items) => normalizeContextItems({
      items,
      field: "contextBlocks",
      kindValues: null,
      requiresTitle: true,
      byteLimit: LIMITS.contextBytes,
      truncatedKey: "context",
    }),
  },
];

export function normalizeTurnInput(input) {
  if (input === null || typeof input !== "object") return fail("input", "object required");
  if (!NEW_TURN_FIELDS.some((field) => input[field] !== undefined)) {
    return { ok: true, input, truncated: {} };
  }
  if (!isPlainObject(input)) return fail("input", "plain object required");

  const normalized = { ...input };
  const truncated = {};
  for (const { field, normalize } of NORMALIZERS) {
    if (input[field] === undefined) continue;
    const result = normalize(input[field]);
    if (!result.ok) return result;
    normalized[field] = result.value;
    if (result.truncated) truncated[result.truncated] = true;
  }
  if (input.proposeActions !== undefined && typeof input.proposeActions !== "boolean") {
    return fail("proposeActions", "boolean required");
  }

  return { ok: true, input: normalized, truncated };
}

export function invalidInputResult(err) {
  return {
    ok: false,
    error: "INVALID_INPUT",
    field: err.field,
    message: err.message,
    reply: "",
    toolCalls: [],
  };
}

export function buildUsage({ tokensIn, tokensOut, costUSD, model, provider }) {
  return {
    tokensIn: Number.isFinite(tokensIn) ? tokensIn : null,
    tokensOut: Number.isFinite(tokensOut) ? tokensOut : null,
    costUSD: Number.isFinite(costUSD) ? costUSD : null,
    model: model ?? null,
    provider: provider ?? null,
  };
}
