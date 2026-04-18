/**
 * Tests for G3.x and GX.x memory-architecture gap closures (v2.36.0-beta.4).
 *
 * Pure-helper coverage:
 *   G3.2 — cosineSimilarity / dedupeThoughtsBySimilarity / tokenize
 *   G3.3 — buildWatcherSearchPrompt
 *   G3.4 — loadKeywordSearchMap
 *   G3.5 — stampThoughtExpiry / filterUnexpiredThoughts
 *   G3.6 — buildCaptureTelemetry
 *   G3.7 — buildCacheEntry / isCacheEntryFresh
 *   GX.3 — buildMemoryReport
 *   GX.4 — validateSourceFormat
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tokenize,
  cosineSimilarity,
  dedupeThoughtsBySimilarity,
  buildWatcherSearchPrompt,
  loadKeywordSearchMap,
  stampThoughtExpiry,
  filterUnexpiredThoughts,
  buildCaptureTelemetry,
  buildCacheEntry,
  isCacheEntryFresh,
  buildMemoryReport,
  validateSourceFormat,
} from "../memory.mjs";

function tmpProject() {
  const dir = mkdtempSync(join(tmpdir(), "pforge-g3-"));
  return dir;
}

// ─── G3.2 — Similarity dedupe ──────────────────────────────────────────

describe("G3.2 tokenize", () => {
  it("counts lowercase word tokens", () => {
    const t = tokenize("Hello world hello");
    expect(t.get("hello")).toBe(2);
    expect(t.get("world")).toBe(1);
  });
  it("returns empty map for null/empty/non-string", () => {
    expect(tokenize(null).size).toBe(0);
    expect(tokenize("").size).toBe(0);
    expect(tokenize(42).size).toBe(0);
  });
});

describe("G3.2 cosineSimilarity", () => {
  it("returns 1 for identical content", () => {
    expect(cosineSimilarity("foo bar baz", "foo bar baz")).toBeCloseTo(1, 5);
  });
  it("returns 0 for disjoint content", () => {
    expect(cosineSimilarity("apple", "zebra")).toBe(0);
  });
  it("returns intermediate value for partial overlap", () => {
    const s = cosineSimilarity("alpha beta gamma", "alpha beta delta");
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(1);
  });
  it("accepts pre-tokenized maps", () => {
    expect(cosineSimilarity(tokenize("a b"), tokenize("a b"))).toBeCloseTo(1, 5);
  });
  it("handles empty bags", () => {
    expect(cosineSimilarity("", "x")).toBe(0);
  });
});

describe("G3.2 dedupeThoughtsBySimilarity", () => {
  it("keeps first occurrence and drops near-duplicates", () => {
    const thoughts = [
      { content: "drift score dropped due to API changes" },
      { content: "drift score dropped due to API changes" }, // exact dup
      { content: "completely different content about caching strategy" },
    ];
    const { kept, dropped } = dedupeThoughtsBySimilarity(thoughts, { threshold: 0.9 });
    expect(kept.length).toBe(2);
    expect(dropped.length).toBe(1);
    expect(dropped[0].similarity).toBeGreaterThanOrEqual(0.9);
  });
  it("threshold 1 only drops exact duplicates", () => {
    const thoughts = [
      { content: "alpha beta gamma" },
      { content: "alpha beta delta" }, // similar but not identical
    ];
    const { kept, dropped } = dedupeThoughtsBySimilarity(thoughts, { threshold: 1 });
    expect(kept.length).toBe(2);
    expect(dropped.length).toBe(0);
  });
  it("passes through thoughts with no content untouched", () => {
    const thoughts = [{ content: "" }, { content: null }, { foo: "bar" }];
    const { kept, dropped } = dedupeThoughtsBySimilarity(thoughts);
    expect(kept.length).toBe(3);
    expect(dropped.length).toBe(0);
  });
  it("returns empty for non-array input", () => {
    const r = dedupeThoughtsBySimilarity(null);
    expect(r.kept).toEqual([]);
    expect(r.dropped).toEqual([]);
  });
});

// ─── G3.3 — Watcher search prompt ──────────────────────────────────────

describe("G3.3 buildWatcherSearchPrompt", () => {
  it("emits a search-instruction block for an anomaly with a code", () => {
    const out = buildWatcherSearchPrompt({ code: "quorum-dissent", message: "x" }, "rummag");
    expect(out).toContain("search_thoughts");
    expect(out).toContain("quorum-dissent");
    expect(out).toContain("rummag");
    expect(out).toContain("PRIOR FINDINGS");
  });
  it("returns empty string when projectName is missing", () => {
    expect(buildWatcherSearchPrompt({ code: "x" }, "")).toBe("");
  });
  it("returns empty string when anomaly has no code", () => {
    expect(buildWatcherSearchPrompt({ message: "x" }, "p")).toBe("");
    expect(buildWatcherSearchPrompt(null, "p")).toBe("");
  });
});

// ─── G3.4 — Configurable keyword map ───────────────────────────────────

describe("G3.4 loadKeywordSearchMap", () => {
  it("returns defaults when no .forge.json exists", () => {
    const dir = tmpProject();
    try {
      const map = loadKeywordSearchMap(dir);
      expect(map.length).toBeGreaterThan(0);
      expect(map[0].pattern).toBeInstanceOf(RegExp);
      expect(typeof map[0].query).toBe("string");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("uses custom map from .forge.json openbrain.keywordMap", () => {
    const dir = tmpProject();
    try {
      writeFileSync(
        join(dir, ".forge.json"),
        JSON.stringify({
          openbrain: {
            keywordMap: [
              { pattern: "\\bcustom\\b", flags: "i", query: "custom domain" },
            ],
          },
        }),
      );
      const map = loadKeywordSearchMap(dir);
      expect(map.length).toBe(1);
      expect(map[0].query).toBe("custom domain");
      expect(map[0].pattern.test("Some custom thing")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("falls back to defaults when custom map is empty/invalid", () => {
    const dir = tmpProject();
    try {
      writeFileSync(
        join(dir, ".forge.json"),
        JSON.stringify({ openbrain: { keywordMap: [] } }),
      );
      const map = loadKeywordSearchMap(dir);
      expect(map.length).toBeGreaterThan(1); // defaults restored
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("skips invalid regex entries without throwing", () => {
    const dir = tmpProject();
    try {
      writeFileSync(
        join(dir, ".forge.json"),
        JSON.stringify({
          openbrain: {
            keywordMap: [
              { pattern: "[invalid(", query: "bad" },
              { pattern: "\\bok\\b", query: "fine" },
            ],
          },
        }),
      );
      const map = loadKeywordSearchMap(dir);
      expect(map.length).toBe(1);
      expect(map[0].query).toBe("fine");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── G3.5 — TTL / expiresAt ────────────────────────────────────────────

describe("G3.5 stampThoughtExpiry", () => {
  it("stamps expiresAt for short-lived types", () => {
    const t = stampThoughtExpiry({ type: "gotcha", content: "x" }, { now: 0 });
    expect(t.expiresAt).toBeTruthy();
    expect(Date.parse(t.expiresAt)).toBeGreaterThan(0);
  });
  it("does not stamp pattern (no expiry)", () => {
    const t = stampThoughtExpiry({ type: "pattern", content: "x" });
    expect(t.expiresAt).toBeUndefined();
  });
  it("preserves caller-supplied expiresAt", () => {
    const t = stampThoughtExpiry({ type: "gotcha", expiresAt: "2099-01-01T00:00:00Z" });
    expect(t.expiresAt).toBe("2099-01-01T00:00:00Z");
  });
  it("respects type-specific overrides", () => {
    const t = stampThoughtExpiry({ type: "gotcha" }, { now: 0, overrides: { gotcha: 1 } });
    const expected = new Date(86400000).toISOString();
    expect(t.expiresAt).toBe(expected);
  });
});

describe("G3.5 filterUnexpiredThoughts", () => {
  it("drops expired thoughts and keeps current/permanent ones", () => {
    const now = 1_000_000_000;
    const thoughts = [
      { content: "stale", expiresAt: new Date(now - 1000).toISOString() },
      { content: "fresh", expiresAt: new Date(now + 1000).toISOString() },
      { content: "permanent" },
    ];
    const out = filterUnexpiredThoughts(thoughts, now);
    expect(out.length).toBe(2);
    expect(out.map((t) => t.content)).toEqual(["fresh", "permanent"]);
  });
  it("returns empty for non-array", () => {
    expect(filterUnexpiredThoughts(null)).toEqual([]);
  });
});

// ─── G3.6 — Capture telemetry ──────────────────────────────────────────

describe("G3.6 buildCaptureTelemetry", () => {
  it("shapes a versioned record with content length and dedup flag", () => {
    const r = buildCaptureTelemetry({
      tool: "forge_watch",
      type: "gotcha",
      source: "forge_watch/quorum-dissent",
      content: "hello",
      project: "demo",
      deduped: true,
    });
    expect(r._v).toBe(1);
    expect(r.tool).toBe("forge_watch");
    expect(r.contentLen).toBe(5);
    expect(r.deduped).toBe(true);
    expect(r.timestamp).toBeTruthy();
  });
  it("defaults missing fields gracefully", () => {
    const r = buildCaptureTelemetry({});
    expect(r.tool).toBe("unknown");
    expect(r.type).toBe("unknown");
    expect(r.contentLen).toBe(0);
    expect(r.deduped).toBe(false);
  });
});

// ─── G3.7 — Search-result cache ────────────────────────────────────────

describe("G3.7 cache helpers", () => {
  it("buildCacheEntry stamps _v, key, results, and ttl", () => {
    const e = buildCacheEntry({ key: "k", query: "q", project: "p", limit: 5, results: [{ a: 1 }] });
    expect(e._v).toBe(1);
    expect(e.key).toBe("k");
    expect(e.results.length).toBe(1);
    expect(e.ttlMs).toBe(60 * 60 * 1000);
  });
  it("isCacheEntryFresh returns true within ttl", () => {
    const now = Date.now();
    const e = { cachedAt: new Date(now - 60_000).toISOString(), ttlMs: 120_000 };
    expect(isCacheEntryFresh(e, now)).toBe(true);
  });
  it("isCacheEntryFresh returns false past ttl", () => {
    const now = Date.now();
    const e = { cachedAt: new Date(now - 120_000).toISOString(), ttlMs: 60_000 };
    expect(isCacheEntryFresh(e, now)).toBe(false);
  });
  it("isCacheEntryFresh returns false for missing/invalid cachedAt", () => {
    expect(isCacheEntryFresh({})).toBe(false);
    expect(isCacheEntryFresh({ cachedAt: "not-a-date" })).toBe(false);
    expect(isCacheEntryFresh(null)).toBe(false);
  });
});

// ─── GX.4 — Source format validation ───────────────────────────────────

describe("GX.4 validateSourceFormat", () => {
  it("accepts plain tool form", () => {
    expect(validateSourceFormat("forge_watch").valid).toBe(true);
  });
  it("accepts tool/subsystem form", () => {
    expect(validateSourceFormat("forge_watch/quorum-dissent").valid).toBe(true);
    expect(validateSourceFormat("forge_drift_report/score_drop").valid).toBe(true);
  });
  it("rejects missing tool prefix", () => {
    expect(validateSourceFormat("watch").valid).toBe(false);
  });
  it("rejects uppercase tool", () => {
    expect(validateSourceFormat("Forge_Watch").valid).toBe(false);
  });
  it("rejects too many slashes", () => {
    expect(validateSourceFormat("forge_x/y/z").valid).toBe(false);
  });
  it("rejects subsystem with invalid chars", () => {
    expect(validateSourceFormat("forge_x/Bad Sub").valid).toBe(false);
  });
  it("rejects empty/non-string", () => {
    expect(validateSourceFormat("").valid).toBe(false);
    expect(validateSourceFormat(null).valid).toBe(false);
    expect(validateSourceFormat(42).valid).toBe(false);
  });
});

// ─── GX.3 — Memory report aggregator ──────────────────────────────────

describe("GX.3 buildMemoryReport", () => {
  it("returns shaped report with empty .forge dir absent", () => {
    const dir = tmpProject();
    try {
      const r = buildMemoryReport(dir);
      expect(r._v).toBe(1);
      expect(r.cwd).toBe(dir);
      expect(r.forgeDirExists).toBe(false);
      expect(Array.isArray(r.l2Files)).toBe(true);
      expect(r.queue).toEqual({ pending: 0, delivered: 0, failed: 0, deferred: 0, dlq: 0 });
      expect(r.telemetry.total).toBe(0);
      expect(r.cache.totalEntries).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("aggregates queue records by status", () => {
    const dir = tmpProject();
    try {
      const forge = join(dir, ".forge");
      mkdirSync(forge, { recursive: true });
      const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const queue = [
        { _v: 1, _status: "pending", payload: 1 },
        { _v: 1, _status: "delivered", payload: 2 },
        { _v: 1, _status: "failed", payload: 3 },
        { _v: 1, _status: "pending", _nextAttemptAt: future, payload: 4 }, // deferred
      ];
      writeFileSync(
        join(forge, "openbrain-queue.jsonl"),
        queue.map((q) => JSON.stringify(q)).join("\n") + "\n",
      );
      const r = buildMemoryReport(dir);
      expect(r.queue.pending).toBe(1);
      expect(r.queue.delivered).toBe(1);
      expect(r.queue.failed).toBe(1);
      expect(r.queue.deferred).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("counts capture telemetry by tool/type and dedup", () => {
    const dir = tmpProject();
    try {
      const tDir = join(dir, ".forge", "telemetry");
      mkdirSync(tDir, { recursive: true });
      const records = [
        { tool: "forge_watch", type: "gotcha", deduped: false },
        { tool: "forge_watch", type: "gotcha", deduped: true },
        { tool: "forge_drift_report", type: "lesson", deduped: false },
      ];
      writeFileSync(
        join(tDir, "memory-captures.jsonl"),
        records.map((r) => JSON.stringify(r)).join("\n") + "\n",
      );
      const r = buildMemoryReport(dir);
      expect(r.telemetry.total).toBe(3);
      expect(r.telemetry.dedupedCount).toBe(1);
      expect(r.telemetry.byTool.forge_watch).toBe(2);
      expect(r.telemetry.byType.gotcha).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("flags orphan files under .forge/", () => {
    const dir = tmpProject();
    try {
      const forge = join(dir, ".forge");
      mkdirSync(forge, { recursive: true });
      writeFileSync(join(forge, "stranger.jsonl"), "{}\n");
      writeFileSync(join(forge, "drift-history.jsonl"), "{}\n"); // known
      const r = buildMemoryReport(dir);
      expect(r.orphans).toContain("stranger.jsonl");
      expect(r.orphans).not.toContain("drift-history.jsonl");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("ignores .bak files in orphan audit", () => {
    const dir = tmpProject();
    try {
      const forge = join(dir, ".forge");
      mkdirSync(forge, { recursive: true });
      writeFileSync(join(forge, "drift-history.json.bak-2026-04-18"), "{}\n");
      const r = buildMemoryReport(dir);
      expect(r.orphans).not.toContain("drift-history.json.bak-2026-04-18");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
