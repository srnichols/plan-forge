/**
 * Tests for openbrain-replay.mjs — round-trip + bulk replay utilities.
 *
 * Architecture-First: pure module with DI for the MCP client. No live network
 * calls in unit tests; integration test against the real tailnet endpoint
 * lives outside this file (run via `pforge brain test`).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readOpenBrainConfig,
  normalizeQueueRecord,
  normalizeMarkdownFile,
  roundTrip,
  replayRecords,
} from "../openbrain-replay.mjs";

// ─── Fixtures ──────────────────────────────────────────────────────────

function mkTmp() {
  return mkdtempSync(join(tmpdir(), "pforge-brain-replay-"));
}

function mockClient(overrides = {}) {
  const calls = [];
  const client = {
    calls,
    async capture(args) {
      calls.push({ tool: "capture_thought", args });
      if (overrides.captureImpl) return overrides.captureImpl(args, calls.length);
      return { id: `mock-id-${calls.length}` };
    },
    async search(args) {
      calls.push({ tool: "search_thoughts", args });
      if (overrides.searchImpl) return overrides.searchImpl(args, calls.length);
      // Default mock mimics OpenBrain's behavior: a semantic search for the
      // canary probe phrase should surface the most recently captured canary.
      // Echo back the latest capture_thought content (if any) so the marker
      // round-trip succeeds; falls back to query echo for non-canary searches.
      const lastCapture = [...calls].reverse().find((c) => c.tool === "capture_thought");
      const echoContent = lastCapture?.args?.content ?? `record containing ${args.query}`;
      return { results: [{ id: "hit-1", content: echoContent }] };
    },
    async close() { calls.push({ tool: "close" }); },
  };
  return client;
}

// ─── readOpenBrainConfig ───────────────────────────────────────────────

describe("readOpenBrainConfig", () => {
  let dir;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns null when no mcp.json exists", () => {
    expect(readOpenBrainConfig(dir)).toBeNull();
  });

  it("returns null when openbrain entry missing", () => {
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: { "plan-forge": { command: "node", args: ["server.mjs"] } },
    }));
    expect(readOpenBrainConfig(dir)).toBeNull();
  });

  it("reads SSE url + header-form key with env interpolation", () => {
    process.env.__TEST_OBKEY = "secret-from-env";
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        openbrain: {
          type: "sse",
          url: "https://openbrain.example/sse",
          headers: { "x-brain-key": "${env:__TEST_OBKEY}" },
        },
      },
    }));
    const cfg = readOpenBrainConfig(dir);
    expect(cfg).not.toBeNull();
    expect(cfg.url).toBe("https://openbrain.example/sse");
    expect(cfg.key).toBe("secret-from-env");
    delete process.env.__TEST_OBKEY;
  });

  it("reads SSE url + query-form key", () => {
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        openbrain: { type: "sse", url: "https://openbrain.example/sse?key=raw-key-123" },
      },
    }));
    const cfg = readOpenBrainConfig(dir);
    expect(cfg.url).toBe("https://openbrain.example/sse?key=raw-key-123");
    expect(cfg.key).toBe("raw-key-123");
  });

  it("resolves ${env:NAME} in the query-form key AND rewrites the url (issue #215)", () => {
    process.env.__TEST_OBKEY = "resolved-query-key";
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        openbrain: { type: "sse", url: "https://openbrain.example/sse?key=${env:__TEST_OBKEY}" },
      },
    }));
    const cfg = readOpenBrainConfig(dir);
    // The auth key must be the resolved env value, NOT the literal placeholder.
    expect(cfg.key).toBe("resolved-query-key");
    // The URL must carry the resolved key so the SSE transport never connects
    // with the literal `${env:...}` placeholder in the query string.
    expect(cfg.url).not.toContain("${env:");
    expect(new URL(cfg.url).searchParams.get("key")).toBe("resolved-query-key");
    delete process.env.__TEST_OBKEY;
  });

  it("does not invent a query key when the placeholder env var is unset (issue #215)", () => {
    delete process.env.__TEST_OBKEY_UNSET;
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        openbrain: { type: "sse", url: "https://openbrain.example/sse?key=${env:__TEST_OBKEY_UNSET}" },
      },
    }));
    const cfg = readOpenBrainConfig(dir);
    // Unresolved placeholder must NOT become the auth key (would 401).
    expect(cfg.key).not.toBe("${env:__TEST_OBKEY_UNSET}");
  });

  it("resolves ${env:NAME} in the url (auto-select endpoint)", () => {
    process.env.__TEST_OBURL = "https://brain.planforge.software/sse";
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        openbrain: {
          type: "sse",
          url: "${env:__TEST_OBURL}",
          headers: { "x-brain-key": "${env:__TEST_OBKEY}" },
        },
      },
    }));
    process.env.__TEST_OBKEY = "k";
    const cfg = readOpenBrainConfig(dir);
    expect(cfg).not.toBeNull();
    expect(cfg.url).toBe("https://brain.planforge.software/sse");
    delete process.env.__TEST_OBURL;
    delete process.env.__TEST_OBKEY;
  });

  it("returns null when url ${env:NAME} is unset (degrades to L2)", () => {
    delete process.env.__TEST_OBURL_UNSET;
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        openbrain: { type: "sse", url: "${env:__TEST_OBURL_UNSET}" },
      },
    }));
    expect(readOpenBrainConfig(dir)).toBeNull();
  });

  it("returns null for stdio-mode (no SSE URL)", () => {
    mkdirSync(join(dir, ".vscode"), { recursive: true });
    writeFileSync(join(dir, ".vscode", "mcp.json"), JSON.stringify({
      servers: { openbrain: { command: "node", args: ["../OpenBrain/dist/index.js"] } },
    }));
    expect(readOpenBrainConfig(dir)).toBeNull();
  });
});

// ─── normalizeQueueRecord ──────────────────────────────────────────────

describe("normalizeQueueRecord", () => {
  it("strips queue metadata and keeps capture fields", () => {
    const input = {
      _v: 1, _status: "delivered", _attempts: 0, _enqueuedAt: "x", _nextAttemptAt: "y", _deliveredAt: "z",
      content: "hello",
      project: "plan-forge",
      type: "lesson",
      source: "forge_alert_triage",
      created_by: "liveguard-auto",
      captured_at: "2026-04-24T03:50:09.606Z",
      expiresAt: "2027-04-24T03:50:09.606Z",
    };
    const out = normalizeQueueRecord(input);
    expect(out).toEqual({
      content: "hello",
      project: "plan-forge",
      source: "forge_alert_triage",
      created_by: "liveguard-auto",
      metadata: { type: "lesson", captured_at: "2026-04-24T03:50:09.606Z", expiresAt: "2027-04-24T03:50:09.606Z" },
    });
  });

  it("returns null for tombstone records (_action=delete)", () => {
    expect(normalizeQueueRecord({ _action: "delete", key: "abc" })).toBeNull();
  });

  it("returns null for records without content", () => {
    expect(normalizeQueueRecord({ project: "p" })).toBeNull();
    expect(normalizeQueueRecord({ content: "" })).toBeNull();
  });

  it("omits empty metadata", () => {
    const out = normalizeQueueRecord({ content: "x", project: "p", source: "s", created_by: "c" });
    expect(out.metadata).toBeUndefined();
  });
});

// ─── normalizeMarkdownFile ─────────────────────────────────────────────

describe("normalizeMarkdownFile", () => {
  let dir;
  beforeEach(() => { dir = mkTmp(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("emits one record per top-level H2 section (## heading)", () => {
    const md = [
      "# Title",
      "intro paragraph",
      "",
      "## First Section",
      "body of first",
      "more body",
      "",
      "## Second Section",
      "body of second",
    ].join("\n");
    const path = join(dir, "notes.md");
    writeFileSync(path, md);

    const records = normalizeMarkdownFile(path, { project: "homelab", source: "user-memory" });
    expect(records).toHaveLength(2);
    expect(records[0].content).toContain("First Section");
    expect(records[0].content).toContain("body of first");
    expect(records[0].project).toBe("homelab");
    expect(records[0].source).toBe("user-memory");
    expect(records[1].content).toContain("Second Section");
    expect(records[1].metadata.source_file).toBe("notes.md");
    expect(records[1].metadata.heading).toBe("Second Section");
  });

  it("falls back to the whole file when no H2 sections exist", () => {
    const md = "# Just a title\n\nbody only";
    const path = join(dir, "flat.md");
    writeFileSync(path, md);

    const records = normalizeMarkdownFile(path, { project: "p", source: "s" });
    expect(records).toHaveLength(1);
    expect(records[0].content).toContain("body only");
    expect(records[0].metadata.heading).toBe("Just a title");
  });

  it("trims sections to a reasonable size", () => {
    // 50 KB section — should be truncated to maxBytes (default 8192)
    const huge = "## Big\n" + "x".repeat(50_000);
    const path = join(dir, "big.md");
    writeFileSync(path, huge);

    const records = normalizeMarkdownFile(path, { project: "p", source: "s", maxBytes: 1024 });
    expect(records).toHaveLength(1);
    expect(records[0].content.length).toBeLessThanOrEqual(1100); // 1024 + truncation marker
    expect(records[0].metadata.truncated).toBe(true);
  });
});

// ─── roundTrip ─────────────────────────────────────────────────────────

describe("roundTrip", () => {
  it("captures a marker then searches for it; returns ok=true on hit", async () => {
    const client = mockClient();
    const r = await roundTrip(client, { project: "plan-forge" });
    expect(r.ok).toBe(true);
    expect(r.marker).toMatch(/^PFTEST-RT-[A-Z0-9]+$/);
    expect(r.hit).toBeTruthy();
    expect(r.searchedHits).toBeGreaterThan(0);
    expect(client.calls[0].tool).toBe("capture_thought");
    expect(client.calls[0].args.content).toContain(r.marker);
    expect(client.calls[1].tool).toBe("search_thoughts");
    // Query is the fixed probe phrase, NOT the random marker (issue #204).
    // Random alphanumeric markers don't embed well; the phrase does.
    expect(client.calls[1].args.query).not.toBe(r.marker);
    expect(client.calls[1].args.query).toMatch(/brain test/i);
    expect(client.calls[1].args.limit).toBeGreaterThanOrEqual(25);
  });

  it("returns ok=false when search returns no hits matching the marker", async () => {
    const client = mockClient({
      searchImpl: () => ({ results: [{ id: "x", content: "unrelated" }] }),
    });
    const r = await roundTrip(client, { project: "plan-forge" });
    expect(r.ok).toBe(false);
    expect(r.hit).toBeNull();
  });

  it("returns ok=false when capture throws", async () => {
    const client = mockClient({
      captureImpl: () => { throw new Error("boom"); },
    });
    const r = await roundTrip(client, { project: "plan-forge" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("boom");
  });
});

// ─── replayRecords ─────────────────────────────────────────────────────

describe("replayRecords", () => {
  it("sends each record via capture and returns counts", async () => {
    const client = mockClient();
    const records = [
      { content: "a", project: "p", source: "s" },
      { content: "b", project: "p", source: "s" },
      { content: "c", project: "p", source: "s" },
    ];
    const r = await replayRecords(client, records, { rate: 0 });
    expect(r.attempted).toBe(3);
    expect(r.sent).toBe(3);
    expect(r.failed).toBe(0);
    expect(client.calls.filter(c => c.tool === "capture_thought")).toHaveLength(3);
    expect(r.samples.length).toBeGreaterThan(0);
    expect(r.samples.length).toBeLessThanOrEqual(5);
  });

  it("dryRun=true reports counts without calling capture", async () => {
    const client = mockClient();
    const records = [{ content: "a" }, { content: "b" }];
    const r = await replayRecords(client, records, { dryRun: true });
    expect(r.attempted).toBe(2);
    expect(r.sent).toBe(0);
    expect(r.dryRun).toBe(true);
    expect(client.calls).toHaveLength(0);
  });

  it("skips null records (e.g. tombstones, missing content)", async () => {
    const client = mockClient();
    const r = await replayRecords(client, [{ content: "a" }, null, { content: "b" }], { rate: 0 });
    expect(r.attempted).toBe(2);
    expect(r.sent).toBe(2);
    expect(r.skipped).toBe(1);
  });

  it("retries transient failures and only marks failed after maxRetries", async () => {
    let attempt = 0;
    const client = mockClient({
      captureImpl: () => {
        attempt += 1;
        if (attempt < 3) throw new Error("HTTP_503");
        return { id: "ok" };
      },
    });
    const r = await replayRecords(client, [{ content: "a" }], { rate: 0, maxRetries: 3, retryDelayMs: 1 });
    expect(r.sent).toBe(1);
    expect(r.failed).toBe(0);
    expect(attempt).toBe(3);
  });

  it("records permanent failure after exhausting retries", async () => {
    const client = mockClient({
      captureImpl: () => { throw new Error("HTTP_401"); },
    });
    const r = await replayRecords(client, [{ content: "a" }], { rate: 0, maxRetries: 2, retryDelayMs: 1 });
    expect(r.sent).toBe(0);
    expect(r.failed).toBe(1);
    expect(r.failures[0].error).toContain("HTTP_401");
  });

  it("emits a progress callback on each record", async () => {
    const client = mockClient();
    const records = [{ content: "a" }, { content: "b" }, { content: "c" }];
    const events = [];
    await replayRecords(client, records, { rate: 0, onProgress: e => events.push(e) });
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({ index: 2, total: 3, status: "sent" });
  });
});
