/**
 * Tests for session-store.mjs — Phase-38.1 Slice 1.
 *
 * Covers: appendTurn, loadSession, rotateIfNeeded, purgeSession,
 *         missing-file no-throw, turn numbering, concurrent writes.
 */

import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  appendTurn,
  loadSession,
  purgeSession,
  rotateIfNeeded,
  hashReply,
  _resetLocks,
} from "../session-store.mjs";

// ─── Setup ───────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "session-store-test-"));
  _resetLocks();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────

function record(userMessage = "hello", overrides = {}) {
  return {
    userMessage,
    classification: { lane: "operational", confidence: "high" },
    replyHash: hashReply("some reply"),
    toolCalls: [],
    ...overrides,
  };
}

// ─── appendTurn + loadSession round-trip ─────────────────────────────

describe("appendTurn / loadSession", () => {
  it("creates session file on first append and returns 1 turn", async () => {
    await appendTurn("session-1", record("first message"), tmpDir);
    const turns = await loadSession("session-1", tmpDir);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe("first message");
  });

  it("assigns turn=1 on first record", async () => {
    await appendTurn("session-2", record(), tmpDir);
    const [t] = await loadSession("session-2", tmpDir);
    expect(t.turn).toBe(1);
  });

  it("assigns monotonically increasing turn numbers", async () => {
    await appendTurn("session-3", record("msg1"), tmpDir);
    await appendTurn("session-3", record("msg2"), tmpDir);
    await appendTurn("session-3", record("msg3"), tmpDir);
    const turns = await loadSession("session-3", tmpDir);
    expect(turns).toHaveLength(3);
    expect(turns.map((t) => t.turn)).toEqual([1, 2, 3]);
  });

  it("preserves the caller-provided record fields", async () => {
    await appendTurn("session-4", record("test", { replyHash: "abc123def456xyz" }), tmpDir);
    const [t] = await loadSession("session-4", tmpDir);
    expect(t.replyHash).toBe("abc123def456xyz");
    expect(t.classification).toEqual({ lane: "operational", confidence: "high" });
    expect(t.toolCalls).toEqual([]);
  });

  it("sets a UTC ISO-8601 timestamp", async () => {
    const before = Date.now();
    await appendTurn("session-ts", record(), tmpDir);
    const after = Date.now();
    const [t] = await loadSession("session-ts", tmpDir);
    const ts = new Date(t.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

// ─── loadSession missing-file no-throw ───────────────────────────────

describe("loadSession (missing file)", () => {
  it("returns [] when session file does not exist", async () => {
    const turns = await loadSession("no-such-session", tmpDir);
    expect(turns).toEqual([]);
  });

  it("returns [] for empty string sessionId — sanitization throws", async () => {
    await expect(loadSession("", tmpDir)).rejects.toThrow();
  });
});

// ─── rotateIfNeeded ───────────────────────────────────────────────────

describe("rotateIfNeeded", () => {
  it("does not rotate when turn count < 200", async () => {
    for (let i = 0; i < 10; i++) {
      await appendTurn("rot-session", record(`msg ${i}`), tmpDir);
    }
    await rotateIfNeeded("rot-session", tmpDir);
    const turns = await loadSession("rot-session", tmpDir);
    expect(turns).toHaveLength(10);
    // No archive file
    const archPath = join(tmpDir, ".forge", "fm-sessions", "rot-session.archive.jsonl");
    expect(existsSync(archPath)).toBe(false);
  });

  it("rotates when count hits 200: keeps newest 100 active, archives oldest 100", async () => {
    for (let i = 0; i < 200; i++) {
      await appendTurn("rot-200", record(`msg ${i}`), tmpDir);
    }

    const turns = await loadSession("rot-200", tmpDir);
    expect(turns).toHaveLength(100);

    // Active file has turns 101..200
    expect(turns[0].turn).toBe(101);
    expect(turns[turns.length - 1].turn).toBe(200);

    // Archive exists
    const archPath = join(tmpDir, ".forge", "fm-sessions", "rot-200.archive.jsonl");
    expect(existsSync(archPath)).toBe(true);

    // Read archive lines count
    const archText = await readFile(archPath, "utf-8");
    const archLines = archText.trim().split("\n").filter(Boolean);
    expect(archLines).toHaveLength(100);
  });

  it("turn numbers remain monotonic across rotation boundary", async () => {
    for (let i = 0; i < 201; i++) {
      await appendTurn("rot-mono", record(`msg ${i}`), tmpDir);
    }
    const turns = await loadSession("rot-mono", tmpDir);
    // After rotation at 200, active has turns 101-200, then turn 201 is appended
    expect(turns[turns.length - 1].turn).toBe(201);
  });
});

// ─── purgeSession ─────────────────────────────────────────────────────

describe("purgeSession", () => {
  it("deletes the active session file", async () => {
    await appendTurn("purge-1", record(), tmpDir);
    const path = join(tmpDir, ".forge", "fm-sessions", "purge-1.jsonl");
    expect(existsSync(path)).toBe(true);
    await purgeSession("purge-1", tmpDir);
    expect(existsSync(path)).toBe(false);
  });

  it("no error when session file does not exist", async () => {
    await expect(purgeSession("nonexistent", tmpDir)).resolves.not.toThrow();
  });

  it("deletes both active and archive files", async () => {
    // Write 200 turns to trigger archive creation
    for (let i = 0; i < 200; i++) {
      await appendTurn("purge-arch", record(`m ${i}`), tmpDir);
    }
    const active = join(tmpDir, ".forge", "fm-sessions", "purge-arch.jsonl");
    const archive = join(tmpDir, ".forge", "fm-sessions", "purge-arch.archive.jsonl");
    expect(existsSync(archive)).toBe(true);

    await purgeSession("purge-arch", tmpDir);
    expect(existsSync(active)).toBe(false);
    expect(existsSync(archive)).toBe(false);
  });
});

// ─── Input validation ─────────────────────────────────────────────────

describe("sessionId validation", () => {
  it("throws for sessionId with path traversal characters", async () => {
    await expect(appendTurn("../../etc/passwd", record(), tmpDir)).rejects.toThrow();
  });

  it("throws for sessionId with forward slash", async () => {
    await expect(appendTurn("a/b", record(), tmpDir)).rejects.toThrow();
  });

  it("accepts UUID-formatted sessionId", async () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    await appendTurn(id, record(), tmpDir);
    const turns = await loadSession(id, tmpDir);
    expect(turns).toHaveLength(1);
  });
});

// ─── Concurrent writes ────────────────────────────────────────────────

describe("concurrent appends", () => {
  it("serializes concurrent appendTurn calls for the same sessionId", async () => {
    const N = 20;
    await Promise.all(
      Array.from({ length: N }, (_, i) => appendTurn("concurrent-1", record(`msg ${i}`), tmpDir)),
    );
    const turns = await loadSession("concurrent-1", tmpDir);
    expect(turns).toHaveLength(N);
    // All turn numbers should be unique
    const nums = new Set(turns.map((t) => t.turn));
    expect(nums.size).toBe(N);
  });
});

// ─── hashReply ────────────────────────────────────────────────────────

describe("hashReply", () => {
  it("returns a 16-character hex string", () => {
    const h = hashReply("hello world");
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("returns consistent output for same input", () => {
    expect(hashReply("test")).toBe(hashReply("test"));
  });

  it("handles empty string", () => {
    expect(hashReply("")).toHaveLength(16);
  });
});
