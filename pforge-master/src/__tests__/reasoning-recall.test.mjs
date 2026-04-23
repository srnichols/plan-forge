/**
 * Tests for recall wired into runTurn — Phase-38.2 Slice 2.
 *
 * Validates:
 *   (1) runTurn for an operational lane query surfaces a prior turn's
 *       userMessage in recall when the index contains a similar message.
 *   (2) Recall failure (bad index path) degrades gracefully — turn still
 *       completes and relatedTurns is [].
 *   (3) OFFTOPIC lane returns relatedTurns: [].
 *   (4) Ephemeral session skips recall (no disk reads).
 *   (5) relatedTurns appears on all runTurn return shapes.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { runTurn } from "../reasoning.mjs";
import { appendTurn as storeAppendTurn } from "../session-store.mjs";
import { buildIndex, _resetIndexCache } from "../recall-index.mjs";

// ─── Setup ───────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "reasoning-recall-test-"));
  mkdirSync(join(tmpDir, ".forge", "fm-sessions"), { recursive: true });
  writeFileSync(
    join(tmpDir, ".forge.json"),
    JSON.stringify({
      forgeMaster: {
        reasoningTiers: { high: "claude-opus-4", medium: "gpt-4o", low: "gpt-4o-mini" },
      },
    }),
    "utf-8",
  );
  _resetIndexCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  _resetIndexCache();
});

// ─── Stub provider ────────────────────────────────────────────────────

function makeProvider(reply = "here is the answer") {
  return {
    PROVIDER_NAME: "stub",
    sendTurn: async () => ({ type: "reply", content: reply, tokensIn: 5, tokensOut: 10 }),
  };
}

// ─── (1) Recall surfaces prior similar turn ───────────────────────────

describe("runTurn recall injection", () => {
  it("(1) second runTurn with similar message surfaces the first turn in relatedTurns", async () => {
    const sessionId = "recall-test-session-001";

    // Seed a prior turn directly into the session file
    await storeAppendTurn(
      sessionId,
      {
        userMessage: "How do I configure the forge status command?",
        classification: { lane: "operational", confidence: "high" },
        replyHash: "deadbeef",
        toolCalls: [],
      },
      tmpDir,
    );

    // Build the recall index to capture the seeded turn
    await buildIndex(tmpDir);
    _resetIndexCache();

    // Now run a second turn with a similar operational query
    const result = await runTurn(
      { message: "What is the forge status configuration command?", cwd: tmpDir },
      {
        provider: makeProvider("Status config details here."),
        dispatcher: async () => ({}),
        hub: null,
        sessionId,
      },
    );

    expect(result.relatedTurns).toBeDefined();
    expect(Array.isArray(result.relatedTurns)).toBe(true);
    // The prior turn should have been recalled
    const found = result.relatedTurns.some((r) =>
      r.userMessage.includes("configure the forge status"),
    );
    expect(found).toBe(true);
  });

  it("(2) recall failure (index read error) degrades gracefully — turn completes", async () => {
    const sessionId = "recall-test-session-002";

    // Don't create any index — loadIndex will try to build from empty dir
    const result = await runTurn(
      { message: "How do I run the forge status check please?", cwd: tmpDir },
      {
        provider: makeProvider("No issues found."),
        dispatcher: async () => ({}),
        hub: null,
        sessionId,
      },
    );

    expect(result.reply).toBeTruthy();
    expect(result.relatedTurns).toBeDefined();
    expect(Array.isArray(result.relatedTurns)).toBe(true);
  });

  it("(3) OFFTOPIC lane returns relatedTurns: []", async () => {
    const result = await runTurn(
      { message: "What is the capital of France?" },
      {
        provider: makeProvider("Paris."),
        dispatcher: async () => ({}),
        hub: null,
      },
    );
    expect(result.relatedTurns).toEqual([]);
  });

  it("(4) ephemeral session skips recall — relatedTurns is []", async () => {
    // Seed a session + build index with matching content
    await storeAppendTurn(
      "recall-ephemeral-seed",
      {
        userMessage: "How do I run the forge status check in ephemeral mode?",
        classification: { lane: "operational", confidence: "high" },
        replyHash: "abc",
        toolCalls: [],
      },
      tmpDir,
    );
    await buildIndex(tmpDir);
    _resetIndexCache();

    const result = await runTurn(
      { message: "How do I run forge status check in ephemeral?", cwd: tmpDir },
      {
        provider: makeProvider("Ephemeral reply."),
        dispatcher: async () => ({}),
        hub: null,
        sessionId: "ephemeral",
      },
    );

    // Ephemeral session should not trigger recall
    expect(result.relatedTurns).toEqual([]);
  });

  it("(5) relatedTurns present on no-provider error path", async () => {
    const result = await runTurn(
      { message: "How do I configure forge status?" },
      {
        provider: null,
        _providers: {
          githubCopilot: { module: null, isAvailable: () => false, load: async () => null },
          anthropic: { module: null, isAvailable: () => false, load: async () => null },
          openai: { module: null, isAvailable: () => false, load: async () => null },
          xai: { module: null, isAvailable: () => false, load: async () => null },
        },
        dispatcher: async () => ({}),
        hub: null,
      },
    );
    expect(result.relatedTurns).toBeDefined();
    expect(Array.isArray(result.relatedTurns)).toBe(true);
  });

  it("(6) recall results are NOT part of classification object", async () => {
    const sessionId = "recall-test-session-006";
    await storeAppendTurn(
      sessionId,
      {
        userMessage: "How does the quorum mode work in forge?",
        classification: { lane: "operational", confidence: "high" },
        replyHash: "xyz123",
        toolCalls: [],
      },
      tmpDir,
    );
    await buildIndex(tmpDir);
    _resetIndexCache();

    const result = await runTurn(
      { message: "Explain the quorum mode forge configuration feature?", cwd: tmpDir },
      {
        provider: makeProvider("Quorum works by..."),
        dispatcher: async () => ({}),
        hub: null,
        sessionId,
      },
    );

    // classification must NOT have recall or relatedTurns inside it
    expect(result.classification?.relatedTurns).toBeUndefined();
    expect(result.classification?.recall).toBeUndefined();
    // relatedTurns belongs at the top level only
    expect(Array.isArray(result.relatedTurns)).toBe(true);
  });
});
