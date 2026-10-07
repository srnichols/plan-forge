import { describe, expect, it } from "vitest";

import {
  CHANNELS,
  LIMITS,
  ROLES,
  STYLES,
  UNTRUSTED_KINDS,
  buildUsage,
  normalizeTurnInput,
} from "../src/turn-input.mjs";

describe("normalizeTurnInput", () => {
  it("returns the original reference on the legacy fast path", () => {
    const input = { message: "hello" };
    const result = normalizeTurnInput(input);
    expect(result).toEqual({ ok: true, input, truncated: {} });
    expect(result.input).toBe(input);
  });

  it("does not mutate a frozen input", () => {
    const caller = Object.freeze({ role: "owner", channel: "chat" });
    const input = Object.freeze({ message: "hello", caller });
    expect(normalizeTurnInput(input)).toMatchObject({ ok: true, input: { caller } });
    expect(input.caller).toBe(caller);
  });

  it.each(ROLES)("accepts caller role %s", (role) => {
    expect(normalizeTurnInput({ caller: { role, channel: CHANNELS[0] } }).ok).toBe(true);
  });

  it.each(CHANNELS)("accepts caller channel %s", (channel) => {
    expect(normalizeTurnInput({ caller: { role: ROLES[0], channel } }).ok).toBe(true);
  });

  it.each(STYLES)("accepts response style %s", (style) => {
    expect(normalizeTurnInput({ responseFormat: { style } }).ok).toBe(true);
  });

  it.each(UNTRUSTED_KINDS)("accepts untrusted context kind %s", (kind) => {
    expect(normalizeTurnInput({ untrustedContext: [{ kind, text: "x" }] }).ok).toBe(true);
  });

  it.each(["untrustedContext", "contextBlocks"])("accepts an empty %s array", (field) => {
    const result = normalizeTurnInput({ [field]: [] });
    expect(result.ok).toBe(true);
    expect(result.truncated).toEqual({});
  });

  it.each([
    [{ caller: { role: "invalid", channel: "chat" } }, "caller.role"],
    [{ caller: { role: "owner", channel: "invalid" } }, "caller.channel"],
    [{ responseFormat: { style: "invalid" } }, "responseFormat.style"],
    [{ responseFormat: { style: null } }, "responseFormat.style"],
    [{ untrustedContext: [{ kind: "invalid", text: "x" }] }, "untrustedContext[0]"],
  ])("rejects invalid enums with the offending field", (input, field) => {
    expect(normalizeTurnInput(input)).toMatchObject({ ok: false, error: "INVALID_INPUT", field });
  });

  it.each(["surface", "projectId", "topic"])("requires caller.%s to be a string when present", (field) => {
    expect(normalizeTurnInput({
      caller: { role: "owner", channel: "chat", [field]: 1 },
    }).field).toBe(`caller.${field}`);
  });

  it.each(["untrustedContext", "contextBlocks"])("requires %s to be an array", (field) => {
    expect(normalizeTurnInput({ [field]: "not-an-array" })).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      field,
    });
  });

  it.each([
    [199, false],
    [200, true],
    [20000, true],
    [20001, false],
    [1.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])("validates responseFormat.maxChars=%s", (maxChars, valid) => {
    const result = normalizeTurnInput({ responseFormat: { maxChars } });
    expect(result.ok).toBe(valid);
    if (!valid) expect(result.field).toBe("responseFormat.maxChars");
  });

  it.each([
    ["untrustedContext", LIMITS.untrustedBytes],
    ["contextBlocks", LIMITS.contextBytes],
  ])("preserves content below and at the %s byte cap", (field, cap) => {
    const makeInput = (size) => {
      const firstLength = Math.floor(size / 2);
      const entries = [
        field === "untrustedContext"
          ? { kind: "other", text: "x".repeat(firstLength) }
          : { title: "context", text: "x".repeat(firstLength) },
        field === "untrustedContext"
          ? { kind: "other", text: "x".repeat(size - firstLength) }
          : { title: "context", text: "x".repeat(size - firstLength) },
      ];
      return field === "untrustedContext" ? { untrustedContext: entries } : { contextBlocks: entries };
    };
    for (const size of [cap - 1, cap]) {
      const result = normalizeTurnInput(makeInput(size));
      expect(result.ok).toBe(true);
      expect(result.truncated).toEqual({});
      expect(result.input[field]).toHaveLength(2);
      expect(result.input[field].reduce((total, item) => total + Buffer.byteLength(item.text, "utf8"), 0)).toBe(size);
    }
  });

  it.each([
    ["untrustedContext", LIMITS.untrustedBytes, "untrusted"],
    ["contextBlocks", LIMITS.contextBytes, "context"],
  ])("truncates over-cap text within %s budget, including the marker", (field, cap, marker) => {
    const makeItem = (text) => field === "untrustedContext"
      ? { kind: "other", text }
      : { title: "context", text };
    const items = [makeItem("a".repeat(Math.floor(cap / 2))), makeItem("b".repeat(cap))];
    const input = field === "untrustedContext" ? { untrustedContext: items } : { contextBlocks: items };
    const result = normalizeTurnInput(input);
    const outputItems = result.input[field];
    const totalBytes = outputItems.reduce((total, item) => total + Buffer.byteLength(item.text, "utf8"), 0);
    expect(result.truncated).toEqual({ [marker]: true });
    expect(totalBytes).toBeLessThanOrEqual(cap);
    expect(outputItems.at(-1).text).toContain("…(truncated)");
  });

  it.each([
    ["untrustedContext", LIMITS.untrustedBytes],
    ["contextBlocks", LIMITS.contextBytes],
  ])("truncates multibyte text on a code-point boundary for %s", (field, cap) => {
    const item = field === "untrustedContext"
      ? { kind: "other", text: `${"界".repeat(cap / 3)}🙂` }
      : { title: "context", text: `${"界".repeat(cap / 3)}🙂` };
    const input = field === "untrustedContext" ? { untrustedContext: [item] } : { contextBlocks: [item] };
    const result = normalizeTurnInput(input);
    const outputText = result.input[field][0].text;
    expect(outputText).not.toContain("\uFFFD");
    expect(Buffer.byteLength(outputText, "utf8")).toBeLessThanOrEqual(cap);
    expect(result.truncated).toEqual({ [field === "untrustedContext" ? "untrusted" : "context"]: true });
  });

  it.each([
    ["untrustedContext", { kind: "other", text: "x" }, { kind: "invalid", text: "late" }],
    ["contextBlocks", { title: "context", text: "x" }, { title: 1, text: "late" }],
  ])("validates entries after the truncation point in %s", (field, validItem, invalidItem) => {
    const cap = field === "untrustedContext" ? LIMITS.untrustedBytes : LIMITS.contextBytes;
    const first = { ...validItem, text: "x".repeat(cap + 1) };
    const input = field === "untrustedContext"
      ? { untrustedContext: [first, invalidItem] }
      : { contextBlocks: [first, invalidItem] };
    const result = normalizeTurnInput(input);
    expect(result).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      field: `${field}[1]`,
    });
  });

  it.each(["caller", "responseFormat", "untrustedContext", "contextBlocks", "proposeActions"])(
    "rejects explicit null for %s",
    (field) => {
      const result = normalizeTurnInput({ [field]: null });
      expect(result).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    },
  );

  it("validates optional item source fields as strings", () => {
    expect(normalizeTurnInput({ untrustedContext: [{ kind: "other", text: "x", source: 1 }] }).field).toBe("untrustedContext[0]");
    expect(normalizeTurnInput({ contextBlocks: [{ title: "x", text: "y", source: 1 }] }).field).toBe("contextBlocks[0]");
  });

  it("preserves false and rejects non-boolean proposeActions", () => {
    expect(normalizeTurnInput({ proposeActions: false }).input.proposeActions).toBe(false);
    expect(normalizeTurnInput({ proposeActions: "yes" })).toMatchObject({
      ok: false,
      error: "INVALID_INPUT",
      field: "proposeActions",
    });
  });
});

describe("buildUsage", () => {
  it("maps unknown numeric values to null and preserves real zero", () => {
    expect(buildUsage({ tokensIn: undefined, tokensOut: Number.POSITIVE_INFINITY, costUSD: Number.NaN })).toEqual({
      tokensIn: null,
      tokensOut: null,
      costUSD: null,
      model: null,
      provider: null,
    });
    expect(buildUsage({ tokensIn: 0, tokensOut: 0, costUSD: 0, model: null, provider: null })).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      costUSD: 0,
      model: null,
      provider: null,
    });
    expect(buildUsage({ model: "model-a", provider: "provider-a" })).toMatchObject({
      model: "model-a",
      provider: "provider-a",
    });
  });
});
