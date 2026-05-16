/**
 * brain-capability-negotiation.test.mjs — Tests for the capability-negotiating
 * L3 client in brain.mjs.
 *
 * Covers: negotiateL3Capabilities, createL3Client, L3_CAPABILITY constants,
 * capability detection, safe no-ops when unavailable, tags/TTL forwarding.
 */
import { describe, it, expect, vi } from "vitest";
import {
  negotiateL3Capabilities,
  createL3Client,
  L3_CAPABILITY,
} from "../brain.mjs";

// ─── L3_CAPABILITY constants ──────────────────────────────────────────────────

describe("L3_CAPABILITY", () => {
  it("exports SEARCH, WRITE, DELETE, TAGS, TTL as frozen constants", () => {
    expect(L3_CAPABILITY.SEARCH).toBe("search");
    expect(L3_CAPABILITY.WRITE).toBe("write");
    expect(L3_CAPABILITY.DELETE).toBe("delete");
    expect(L3_CAPABILITY.TAGS).toBe("tags");
    expect(L3_CAPABILITY.TTL).toBe("ttl");
    expect(Object.isFrozen(L3_CAPABILITY)).toBe(true);
  });
});

// ─── negotiateL3Capabilities ──────────────────────────────────────────────────

describe("negotiateL3Capabilities", () => {
  it("no deps → all capabilities false", () => {
    const caps = negotiateL3Capabilities({});
    expect(caps.canSearch).toBe(false);
    expect(caps.canWrite).toBe(false);
    expect(caps.canDelete).toBe(false);
    expect(caps.canTags).toBe(false);
    expect(caps.canTTL).toBe(false);
  });

  it("undefined deps → all capabilities false", () => {
    const caps = negotiateL3Capabilities();
    expect(caps.canSearch).toBe(false);
    expect(caps.canWrite).toBe(false);
  });

  it("searchMemory is a function → canSearch: true, write/delete/tags/ttl: false", () => {
    const caps = negotiateL3Capabilities({ searchMemory: async () => null });
    expect(caps.canSearch).toBe(true);
    expect(caps.canWrite).toBe(false);
    expect(caps.canDelete).toBe(false);
    expect(caps.canTags).toBe(false);
    expect(caps.canTTL).toBe(false);
  });

  it("appendForgeJsonl is a function → canWrite, canDelete, canTags, canTTL all true", () => {
    const caps = negotiateL3Capabilities({ appendForgeJsonl: vi.fn() });
    expect(caps.canWrite).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canTags).toBe(true);
    expect(caps.canTTL).toBe(true);
    expect(caps.canSearch).toBe(false);
  });

  it("both searchMemory and appendForgeJsonl → all five capabilities true", () => {
    const caps = negotiateL3Capabilities({
      searchMemory: async () => null,
      appendForgeJsonl: vi.fn(),
    });
    expect(caps.canSearch).toBe(true);
    expect(caps.canWrite).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canTags).toBe(true);
    expect(caps.canTTL).toBe(true);
  });

  it("non-function searchMemory (e.g. null) → canSearch: false", () => {
    const caps = negotiateL3Capabilities({ searchMemory: null });
    expect(caps.canSearch).toBe(false);
  });

  it("has() method works correctly", () => {
    const caps = negotiateL3Capabilities({ searchMemory: async () => null });
    expect(caps.has(L3_CAPABILITY.SEARCH)).toBe(true);
    expect(caps.has(L3_CAPABILITY.WRITE)).toBe(false);
  });

  it("list() returns array of capability strings", () => {
    const caps = negotiateL3Capabilities({
      searchMemory: async () => null,
      appendForgeJsonl: vi.fn(),
    });
    const list = caps.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list).toContain("search");
    expect(list).toContain("write");
    expect(list.length).toBe(5);
  });

  it("list() returns empty array when no capabilities", () => {
    const caps = negotiateL3Capabilities({});
    expect(caps.list()).toEqual([]);
  });
});

// ─── createL3Client ───────────────────────────────────────────────────────────

describe("createL3Client", () => {
  // ── recall ──

  it("recall with no search capability → returns null without calling searchMemory", async () => {
    const searchMemory = vi.fn();
    const client = createL3Client({ appendForgeJsonl: vi.fn() }); // no searchMemory
    const result = await client.recall("cross.pattern.auth");
    expect(result).toBeNull();
    expect(searchMemory).not.toHaveBeenCalled();
  });

  it("recall with search capability → calls searchMemory and returns value", async () => {
    const searchMemory = vi.fn(async () => ({ pattern: "jwt" }));
    const client = createL3Client({ searchMemory });
    const result = await client.recall("cross.pattern.auth");
    expect(result).toEqual({ pattern: "jwt" });
    expect(searchMemory).toHaveBeenCalledWith("cross.pattern.auth");
  });

  it("recall → searchMemory throws → returns null (never propagates)", async () => {
    const client = createL3Client({ searchMemory: async () => { throw new Error("OpenBrain down"); } });
    const result = await client.recall("cross.any.key");
    expect(result).toBeNull();
  });

  it("recall → searchMemory returns null → returns null", async () => {
    const client = createL3Client({ searchMemory: async () => null });
    expect(await client.recall("cross.any.key")).toBeNull();
  });

  // ── remember ──

  it("remember with no write capability → returns { ok: false, skipped: true }", () => {
    const client = createL3Client({ searchMemory: async () => null }); // no appendForgeJsonl
    const result = client.remember("cross.pattern.auth", { data: 1 });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(typeof result.reason).toBe("string");
  });

  it("remember with write capability → queues to openbrain-queue.jsonl", () => {
    const appendForgeJsonl = vi.fn();
    const client = createL3Client({ appendForgeJsonl, cwd: "/tmp/test" });
    const result = client.remember("cross.pattern.auth", { data: 1 });
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true);
    expect(appendForgeJsonl).toHaveBeenCalledTimes(1);
    const [filename, record] = appendForgeJsonl.mock.calls[0];
    expect(filename).toBe("openbrain-queue.jsonl");
    expect(record.key).toBe("cross.pattern.auth");
    expect(record._status).toBe("pending");
  });

  it("remember → encodes object value as JSON string in record.content", () => {
    const appendForgeJsonl = vi.fn();
    const client = createL3Client({ appendForgeJsonl });
    client.remember("cross.x.y", { nested: true });
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(typeof record.content).toBe("string");
    expect(JSON.parse(record.content)).toEqual({ nested: true });
  });

  it("remember → passes string value through as-is in record.content", () => {
    const appendForgeJsonl = vi.fn();
    const client = createL3Client({ appendForgeJsonl });
    client.remember("cross.x.y", "raw string value");
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(record.content).toBe("raw string value");
  });

  it("remember → includes tags when canTags is true and opts.tags provided", () => {
    const appendForgeJsonl = vi.fn();
    const client = createL3Client({ appendForgeJsonl });
    client.remember("cross.x.y", "val", { tags: ["auth", "jwt"] });
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(record.tags).toEqual(["auth", "jwt"]);
  });

  it("remember → includes expiresAt when canTTL is true and opts.ttlMs provided", () => {
    const appendForgeJsonl = vi.fn();
    const client = createL3Client({ appendForgeJsonl });
    const before = Date.now();
    client.remember("cross.x.y", "val", { ttlMs: 3600000 });
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(typeof record.expiresAt).toBe("string");
    const expiresAt = new Date(record.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600000);
  });

  it("remember → no tags field when opts.tags not provided", () => {
    const appendForgeJsonl = vi.fn();
    const client = createL3Client({ appendForgeJsonl });
    client.remember("cross.x.y", "val");
    const record = appendForgeJsonl.mock.calls[0][1];
    expect(record.tags).toBeUndefined();
  });

  it("remember → appendForgeJsonl throws → returns { ok: false, error }", () => {
    const client = createL3Client({ appendForgeJsonl: () => { throw new Error("disk full"); } });
    const result = client.remember("cross.x.y", "val");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("disk full");
  });

  // ── forget ──

  it("forget with no delete capability → returns { ok: false, skipped: true }", () => {
    const client = createL3Client({ searchMemory: async () => null });
    const result = client.forget("cross.x.y");
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(typeof result.reason).toBe("string");
  });

  it("forget with delete capability → queues delete record", () => {
    const appendForgeJsonl = vi.fn();
    const client = createL3Client({ appendForgeJsonl });
    const result = client.forget("cross.x.y");
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true);
    expect(appendForgeJsonl).toHaveBeenCalledTimes(1);
    const [filename, record] = appendForgeJsonl.mock.calls[0];
    expect(filename).toBe("openbrain-queue.jsonl");
    expect(record._action).toBe("delete");
    expect(record.key).toBe("cross.x.y");
    expect(record._status).toBe("pending");
  });

  it("forget → appendForgeJsonl throws → returns { ok: false, error }", () => {
    const client = createL3Client({ appendForgeJsonl: () => { throw new Error("write error"); } });
    const result = client.forget("cross.x.y");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("write error");
  });

  // ── capabilities property ──

  it("client.capabilities reflects negotiated surface", () => {
    const client = createL3Client({ searchMemory: async () => null });
    expect(client.capabilities.canSearch).toBe(true);
    expect(client.capabilities.canWrite).toBe(false);
  });

  it("fully-equipped client exposes all capabilities as true", () => {
    const client = createL3Client({ searchMemory: async () => null, appendForgeJsonl: vi.fn() });
    const caps = client.capabilities;
    expect(caps.canSearch).toBe(true);
    expect(caps.canWrite).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canTags).toBe(true);
    expect(caps.canTTL).toBe(true);
  });

  it("empty client exposes all capabilities as false (safe zero-capability state)", () => {
    const client = createL3Client({});
    const caps = client.capabilities;
    expect(caps.canSearch).toBe(false);
    expect(caps.canWrite).toBe(false);
    expect(caps.canDelete).toBe(false);
    expect(caps.canTags).toBe(false);
    expect(caps.canTTL).toBe(false);
  });
});
