/* @vitest-environment jsdom */
/**
 * Tests for Forge-Master related-conversations (recall) panel — Phase-38.2 Slice 3.
 *
 * Verifies that forgeMasterRenderRelatedConversations renders a
 * #fm-related-conversations <details> section in #fm-chat-stream when
 * relatedTurns are present, and is a no-op when the list is empty.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function seedDOM() {
  document.body.innerHTML = `
    <div id="fm-chat-stream"></div>
    <div id="fm-tool-trace"></div>
    <textarea id="fm-composer"></textarea>
  `;
}

function loadModule() {
  // Evaluate the dashboard module in the current window context.
  const src = readFileSync(resolve(__dirname, "../dashboard/forge-master.js"), "utf-8");
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "crypto", "sessionStorage", src);
  fn(window, document, window.crypto, window.sessionStorage);
}

const FIXTURE_TURNS = [
  {
    turnId: "session-a:1",
    sessionId: "session-a",
    timestamp: "2026-04-20T10:00:00Z",
    userMessage: "How do I configure the forge status command?",
    lane: "operational",
    replyHash: "deadbeef",
    score: 3.14,
  },
  {
    turnId: "session-b:2",
    sessionId: "session-b",
    timestamp: "2026-04-21T12:00:00Z",
    userMessage: "What is the quorum mode setting?",
    lane: "advisory",
    replyHash: "cafebabe",
    score: 2.71,
  },
];

describe("forgeMasterRenderRelatedConversations", () => {
  beforeEach(() => {
    seedDOM();
    loadModule();
  });

  it("renders #fm-related-conversations <details> element when relatedTurns is non-empty", () => {
    window.forgeMasterRenderRelatedConversations(FIXTURE_TURNS);

    const el = document.getElementById("fm-related-conversations");
    expect(el).not.toBeNull();
    expect(el.tagName.toLowerCase()).toBe("details");
  });

  it("renders a <summary> containing the correct count", () => {
    window.forgeMasterRenderRelatedConversations(FIXTURE_TURNS);

    const summary = document.querySelector("#fm-related-conversations summary");
    expect(summary).not.toBeNull();
    expect(summary.textContent).toContain("2");
  });

  it("renders each turn's userMessage in the panel", () => {
    window.forgeMasterRenderRelatedConversations(FIXTURE_TURNS);

    const el = document.getElementById("fm-related-conversations");
    expect(el.innerHTML).toContain("How do I configure the forge status command?");
    expect(el.innerHTML).toContain("What is the quorum mode setting?");
  });

  it("renders lane and date for each turn", () => {
    window.forgeMasterRenderRelatedConversations(FIXTURE_TURNS);

    const el = document.getElementById("fm-related-conversations");
    expect(el.innerHTML).toContain("operational");
    expect(el.innerHTML).toContain("advisory");
    expect(el.innerHTML).toContain("2026-04-20");
    expect(el.innerHTML).toContain("2026-04-21");
  });

  it("is appended to #fm-chat-stream", () => {
    window.forgeMasterRenderRelatedConversations(FIXTURE_TURNS);

    const stream = document.getElementById("fm-chat-stream");
    const el = stream.querySelector("#fm-related-conversations");
    expect(el).not.toBeNull();
  });

  it("does not render when relatedTurns is empty", () => {
    window.forgeMasterRenderRelatedConversations([]);

    const el = document.getElementById("fm-related-conversations");
    expect(el).toBeNull();
  });

  it("does not render when relatedTurns is null", () => {
    window.forgeMasterRenderRelatedConversations(null);

    const el = document.getElementById("fm-related-conversations");
    expect(el).toBeNull();
  });

  it("updates existing #fm-related-conversations on a second call", () => {
    window.forgeMasterRenderRelatedConversations([FIXTURE_TURNS[0]]);
    // Call again with both turns — should update in place
    window.forgeMasterRenderRelatedConversations(FIXTURE_TURNS);

    const allEls = document.querySelectorAll("#fm-related-conversations");
    // Only one element should exist (updated, not duplicated)
    expect(allEls.length).toBe(1);
    // Both turns should be present after update
    const el = document.getElementById("fm-related-conversations");
    expect(el.innerHTML).toContain("What is the quorum mode setting?");
  });
});
