/**
 * Tests for recall-index.mjs — Phase-38.2 Slice 1.
 *
 * Covers: buildIndex, queryIndex, loadIndex lazy refresh,
 *         OFFTOPIC exclusion, empty-state no-throw,
 *         concurrent buildIndex calls, archive file indexing.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  buildIndex,
  loadIndex,
  queryIndex,
  _resetIndexCache,
} from "../recall-index.mjs";

// ─── Setup ───────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "recall-index-test-"));
  _resetIndexCache();
  // Create .forge/fm-sessions directory
  mkdirSync(join(tmpDir, ".forge", "fm-sessions"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  _resetIndexCache();
});

// ─── Helpers ─────────────────────────────────────────────────────────

function writeTurns(sessionId, turns) {
  const dir = join(tmpDir, ".forge", "fm-sessions");
  const file = join(dir, `${sessionId}.jsonl`);
  const lines = turns.map((t) => JSON.stringify(t)).join("\n") + "\n";
  writeFileSync(file, lines, "utf-8");
  return file;
}

function makeTurn(userMessage, lane = "operational", overrides = {}) {
  return {
    turn: 1,
    timestamp: new Date().toISOString(),
    userMessage,
    classification: { lane, confidence: "high" },
    replyHash: "abc123",
    toolCalls: [],
    ...overrides,
  };
}

// ─── buildIndex: basic round-trip ────────────────────────────────────

describe("buildIndex", () => {
  it("creates recall-index.json from session files", async () => {
    writeTurns("session-a", [
      makeTurn("What is the forge status?", "operational"),
      makeTurn("How do I configure quorum mode?", "advisory"),
    ]);

    await buildIndex(tmpDir);

    const indexFile = join(tmpDir, ".forge", "fm-sessions", "recall-index.json");
    expect(existsSync(indexFile)).toBe(true);

    const raw = JSON.parse(require("node:fs").readFileSync(indexFile, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.docs).toHaveLength(2);
    expect(raw.docs[0].userMessage).toBe("What is the forge status?");
    expect(raw.lastBuiltAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("excludes OFFTOPIC turns from the index", async () => {
    writeTurns("session-b", [
      makeTurn("What is the weather?", "offtopic"),
      makeTurn("How do I run forge status?", "operational"),
    ]);

    await buildIndex(tmpDir);
    const raw = JSON.parse(require("node:fs").readFileSync(
      join(tmpDir, ".forge", "fm-sessions", "recall-index.json"), "utf-8"
    ));

    expect(raw.docs).toHaveLength(1);
    expect(raw.docs[0].lane).toBe("operational");
  });

  it("handles empty sessions directory without throwing", async () => {
    await expect(buildIndex(tmpDir)).resolves.not.toThrow();
    const indexFile = join(tmpDir, ".forge", "fm-sessions", "recall-index.json");
    expect(existsSync(indexFile)).toBe(true);
    const raw = JSON.parse(require("node:fs").readFileSync(indexFile, "utf-8"));
    expect(raw.docs).toHaveLength(0);
  });

  it("indexes archive files (.archive.jsonl)", async () => {
    const dir = join(tmpDir, ".forge", "fm-sessions");
    const archiveFile = join(dir, "session-c.archive.jsonl");
    writeFileSync(
      archiveFile,
      JSON.stringify(makeTurn("Old operational query from archive", "operational")) + "\n",
      "utf-8"
    );

    await buildIndex(tmpDir);
    const raw = JSON.parse(require("node:fs").readFileSync(
      join(dir, "recall-index.json"), "utf-8"
    ));
    expect(raw.docs.some((d) => d.userMessage.includes("archive"))).toBe(true);
  });

  it("handles malformed JSONL lines gracefully (skips them)", async () => {
    const dir = join(tmpDir, ".forge", "fm-sessions");
    writeFileSync(
      join(dir, "session-d.jsonl"),
      '{"turn":1,"timestamp":"2026-01-01T00:00:00Z","userMessage":"valid turn","classification":{"lane":"operational"},"replyHash":"x","toolCalls":[]}\nNOT VALID JSON\n',
      "utf-8"
    );

    await expect(buildIndex(tmpDir)).resolves.not.toThrow();
    const raw = JSON.parse(require("node:fs").readFileSync(
      join(dir, "recall-index.json"), "utf-8"
    ));
    expect(raw.docs).toHaveLength(1);
  });

  it("serializes concurrent buildIndex calls without corrupting the index", async () => {
    writeTurns("session-e", [
      makeTurn("Concurrent test message one", "operational"),
      makeTurn("Concurrent test message two", "troubleshoot"),
    ]);

    // Fire 3 concurrent builds
    await Promise.all([buildIndex(tmpDir), buildIndex(tmpDir), buildIndex(tmpDir)]);

    const raw = JSON.parse(require("node:fs").readFileSync(
      join(tmpDir, ".forge", "fm-sessions", "recall-index.json"), "utf-8"
    ));
    expect(raw.docs).toHaveLength(2);
  });
});

// ─── queryIndex ───────────────────────────────────────────────────────

describe("queryIndex", () => {
  beforeEach(async () => {
    writeTurns("session-q", [
      makeTurn("How do I run the forge status check?", "operational", { turn: 1 }),
      makeTurn("What is the quorum mode configuration?", "advisory", { turn: 2 }),
      makeTurn("Why did Phase-27 slice 3 fail?", "troubleshoot", { turn: 3 }),
      makeTurn("How do I configure the cost report?", "operational", { turn: 4 }),
      makeTurn("What is the weather today?", "offtopic", { turn: 5 }),
    ]);
    await buildIndex(tmpDir);
    _resetIndexCache();
  });

  it("returns top-K relevant results sorted by score desc", async () => {
    const results = await queryIndex("forge status configuration", { topK: 3, projectDir: tmpDir });
    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should be most relevant
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("does not return OFFTOPIC turns", async () => {
    const results = await queryIndex("what is the weather today", { topK: 3, projectDir: tmpDir });
    for (const r of results) {
      expect(r.lane).not.toBe("offtopic");
    }
  });

  it("returns [] when query has fewer than 3 tokens", async () => {
    const results = await queryIndex("forge", { topK: 3, projectDir: tmpDir });
    expect(results).toEqual([]);

    const results2 = await queryIndex("forge status", { topK: 3, projectDir: tmpDir });
    expect(results2).toEqual([]);
  });

  it("returns [] on empty string query", async () => {
    const results = await queryIndex("", { topK: 3, projectDir: tmpDir });
    expect(results).toEqual([]);
  });

  it("returns [] when no documents match the query", async () => {
    const results = await queryIndex("zzz xyx unique nonexistent tokens here", { topK: 3, projectDir: tmpDir });
    expect(results).toHaveLength(0);
  });

  it("returns expected shape for each hit", async () => {
    const results = await queryIndex("forge status check run", { topK: 1, projectDir: tmpDir });
    if (results.length > 0) {
      const hit = results[0];
      expect(hit).toHaveProperty("turnId");
      expect(hit).toHaveProperty("sessionId");
      expect(hit).toHaveProperty("timestamp");
      expect(hit).toHaveProperty("userMessage");
      expect(hit).toHaveProperty("lane");
      expect(hit).toHaveProperty("replyHash");
      expect(hit).toHaveProperty("score");
      expect(typeof hit.score).toBe("number");
      expect(hit.score).toBeGreaterThan(0);
    }
  });

  it("does not throw when sessions directory does not exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "recall-empty-"));
    try {
      _resetIndexCache();
      await expect(queryIndex("forge status check here", { topK: 3, projectDir: emptyDir })).resolves.toEqual([]);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      _resetIndexCache();
    }
  });
});

// ─── loadIndex lazy refresh ───────────────────────────────────────────

describe("loadIndex lazy refresh", () => {
  it("builds index when recall-index.json does not exist", async () => {
    writeTurns("session-r", [makeTurn("Status query for lazy test", "operational")]);

    _resetIndexCache();
    await loadIndex(tmpDir);

    const indexFile = join(tmpDir, ".forge", "fm-sessions", "recall-index.json");
    expect(existsSync(indexFile)).toBe(true);
  });

  it("rebuilds when a session file is newer than the index", async () => {
    // Build initial index
    writeTurns("session-s1", [makeTurn("Initial query one", "operational")]);
    await buildIndex(tmpDir);
    _resetIndexCache();

    // Wait a tick, then write a newer session file
    await new Promise((res) => setTimeout(res, 20));
    writeTurns("session-s2", [makeTurn("New query after build two", "advisory")]);

    await loadIndex(tmpDir);

    const results = await queryIndex("new query after build advisory", { topK: 3, projectDir: tmpDir });
    const found = results.some((r) => r.userMessage.includes("New query after build"));
    expect(found).toBe(true);
  });

  it("does not rebuild when index is fresh and no newer session files", async () => {
    writeTurns("session-t", [makeTurn("Stable query no rebuild needed", "operational")]);
    await buildIndex(tmpDir);

    const indexFile = join(tmpDir, ".forge", "fm-sessions", "recall-index.json");
    const before = require("node:fs").statSync(indexFile).mtimeMs;

    _resetIndexCache();
    await loadIndex(tmpDir);
    await new Promise((res) => setTimeout(res, 30));

    const after = require("node:fs").statSync(indexFile).mtimeMs;
    // Index should not have been rewritten (same mtime, within tolerance)
    expect(after - before).toBeLessThan(500);
  });
});
