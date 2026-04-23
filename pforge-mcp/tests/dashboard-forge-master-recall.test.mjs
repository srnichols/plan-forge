/**
 * Plan Forge — Phase-38.2 Slice 3 tests
 *
 * Dashboard: Related conversations section renders from recall payload.
 *
 * Tests the forgeMasterRenderRelatedConversations function via Node's
 * vm module with minimal DOM stubs, consistent with the existing
 * dashboard test pattern (see: dashboard-live-session.test.mjs).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const FM_SRC = readFileSync(
  resolve(HERE, "..", "dashboard", "forge-master.js"),
  "utf-8",
);

// ─── DOM stub ────────────────────────────────────────────────────────────────

function makeElement(tag = "div") {
  const el = {
    _tag: tag,
    _children: [],
    id: "",
    className: "",
    innerHTML: "",
    textContent: "",
    appendChild(child) { this._children.push(child); return child; },
    querySelector(sel) {
      // Simple id/tag lookup for test purposes
      const idMatch = sel.match(/^#(.+)$/);
      if (idMatch) return this._children.find((c) => c.id === idMatch[1]) ?? null;
      return null;
    },
    scrollTop: 0,
    scrollHeight: 100,
  };
  return el;
}

function buildDom(elementMap = {}) {
  const elements = {};
  const document = {
    getElementById(id) { return elements[id] ?? null; },
    querySelector() { return null; },
    createElement(tag) { return makeElement(tag); },
  };

  for (const [id, tag] of Object.entries(elementMap)) {
    const el = makeElement(tag || "div");
    el.id = id;
    elements[id] = el;
  }

  return { document, elements };
}

// ─── Context runner ──────────────────────────────────────────────────────────

function runFmScript(domElements = {}) {
  const { document, elements } = buildDom(domElements);

  const ctx = createContext({
    document,
    window: { forgeMasterOnTabActivate() {}, forgeMasterNewChat() {}, forgeMasterSend() {}, forgeMasterFilterGallery() {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    crypto: { randomUUID: () => "test-uuid-1234" },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    console,
  });

  // Wrap in try/catch for any module-init failures (e.g. forgeMasterInit auto-called at DOMContentLoaded)
  try { runInContext(FM_SRC, ctx); } catch { /* ignore init errors in test env */ }

  return { ctx, elements };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("forgeMasterRenderRelatedConversations", () => {
  it("creates #fm-related-conversations element with correct count", () => {
    const { elements } = runFmScript({
      "fm-chat-stream": "div",
    });

    // Call the function via ctx
    const { document, elements: elems } = buildDom({ "fm-chat-stream": "div" });
    const ctx = createContext({
      document,
      window: { forgeMasterOnTabActivate() {}, forgeMasterNewChat() {}, forgeMasterSend() {}, forgeMasterFilterGallery() {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      crypto: { randomUUID: () => "test-uuid-1234" },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      console,
    });
    try { runInContext(FM_SRC, ctx); } catch { /* ignore */ }

    const fixtures = [
      { turnId: "s1:1", sessionId: "session-abc", timestamp: "2026-04-01T10:00:00Z", userMessage: "How do I configure quorum mode?", lane: "advisory", replyHash: "abc", score: 1.5 },
      { turnId: "s1:2", sessionId: "session-abc", timestamp: "2026-04-02T11:00:00Z", userMessage: "What is the forge status?", lane: "operational", replyHash: "def", score: 1.2 },
    ];

    // Call the function
    ctx.forgeMasterRenderRelatedConversations(fixtures);

    const stream = document.getElementById("fm-chat-stream");
    const relatedEl = stream._children.find((c) => c.id === "fm-related-conversations");
    expect(relatedEl).toBeDefined();
    expect(relatedEl.innerHTML).toContain("Related conversations (2)");
  });

  it("renders each recall hit with lane and message", () => {
    const { document } = buildDom({ "fm-chat-stream": "div" });
    const ctx = createContext({
      document,
      window: { forgeMasterOnTabActivate() {}, forgeMasterNewChat() {}, forgeMasterSend() {}, forgeMasterFilterGallery() {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      crypto: { randomUUID: () => "test-uuid-5678" },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      console,
    });
    try { runInContext(FM_SRC, ctx); } catch { /* ignore */ }

    const fixtures = [
      { turnId: "s2:1", sessionId: "session-xyz", timestamp: "2026-04-10T09:00:00Z", userMessage: "Why did slice 4 fail?", lane: "troubleshoot", replyHash: "ghi", score: 2.0 },
    ];

    ctx.forgeMasterRenderRelatedConversations(fixtures);

    const stream = document.getElementById("fm-chat-stream");
    const relatedEl = stream._children.find((c) => c.id === "fm-related-conversations");
    expect(relatedEl).toBeDefined();
    expect(relatedEl.innerHTML).toContain("troubleshoot");
    expect(relatedEl.innerHTML).toContain("slice 4 fail");
    expect(relatedEl.innerHTML).toContain("2026-04-10");
  });

  it("does not render section when relatedTurns is empty", () => {
    const { document } = buildDom({ "fm-chat-stream": "div" });
    const ctx = createContext({
      document,
      window: { forgeMasterOnTabActivate() {}, forgeMasterNewChat() {}, forgeMasterSend() {}, forgeMasterFilterGallery() {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      crypto: { randomUUID: () => "test-uuid-9999" },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      console,
    });
    try { runInContext(FM_SRC, ctx); } catch { /* ignore */ }

    ctx.forgeMasterRenderRelatedConversations([]);

    const stream = document.getElementById("fm-chat-stream");
    const relatedEl = stream._children.find((c) => c.id === "fm-related-conversations");
    expect(relatedEl).toBeUndefined();
  });

  it("is a no-op when fm-chat-stream element is absent", () => {
    const { document } = buildDom({}); // no fm-chat-stream
    const ctx = createContext({
      document,
      window: { forgeMasterOnTabActivate() {}, forgeMasterNewChat() {}, forgeMasterSend() {}, forgeMasterFilterGallery() {} },
      sessionStorage: { getItem: () => null, setItem: () => {} },
      crypto: { randomUUID: () => "test-uuid-0000" },
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      console,
    });
    try { runInContext(FM_SRC, ctx); } catch { /* ignore */ }

    const fixtures = [
      { turnId: "s3:1", sessionId: "s3", timestamp: "2026-04-15T00:00:00Z", userMessage: "test message", lane: "operational", replyHash: "jkl", score: 1.0 },
    ];
    // Should not throw
    expect(() => ctx.forgeMasterRenderRelatedConversations(fixtures)).not.toThrow();
  });
});
