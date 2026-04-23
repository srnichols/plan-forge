/**
 * Stage 1.5 embedding-cache wiring in classify() — Phase-38.8, Slice 3.
 *
 * Verifies that classify() checks the embedding cache between keyword
 * scoring (stage 1) and the router-model call (stage 2), and that
 * successful classifications are written back to the cache.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { classify, LANES, LANE_TOOLS } from "../intent-router.mjs";
import {
  addEntry,
  query,
  __resetCacheForTests,
} from "../embedding/cache.mjs";

/** Deterministic fake embedder — maps text to a unit vector at a fixed slot. */
const DIM = 8;
function fakeEmbed(text) {
  const v = new Float32Array(DIM);
  let slot = 0;
  for (let i = 0; i < text.length; i++) slot = (slot + text.charCodeAt(i)) % DIM;
  v[slot] = 1;
  return Promise.resolve(v);
}

/** Embed that always returns a known vector. */
function vectorEmbed(vec) {
  return (/* text */) => Promise.resolve(vec);
}

/**
 * Stage-2 stub that throws — used to confirm stage-2 is skipped when the
 * embedding cache returns a hit.
 */
const throwingCallApiWorker = vi.fn(async () => {
  throw new Error("stage-2 should not be called");
});
const stubbedDetectApiProvider = () => "stub-provider";

beforeEach(() => {
  __resetCacheForTests();
  throwingCallApiWorker.mockClear();
});

// ── Stage 1.5: cache hit returns early ──────────────────────────────

describe("stage 1.5 — embedding-cache hit", () => {
  it("returns via embedding-cache and skips stage-2 when cache matches", async () => {
    // Prime the cache with a known classification
    await addEntry({
      text: "show me recent forge runs",
      classification: { lane: LANES.OPERATIONAL, confidence: "high" },
      confidence: 0.95,
      _embed: fakeEmbed,
    });

    // Classify with the same text — should hit the cache
    const result = await classify("show me recent forge runs", {
      callApiWorker: throwingCallApiWorker,
      detectApiProvider: stubbedDetectApiProvider,
      _embed: fakeEmbed,
      // embeddingFallback defaults to true
    });

    expect(result.lane).toBe(LANES.OPERATIONAL);
    expect(result.via).toBe("embedding-cache");
    expect(result.reason).toBe("embedding-cache");
    expect(result.confidence).toBe("high");
    expect(result.suggestedTools).toEqual(LANE_TOOLS[LANES.OPERATIONAL]);

    // stage-2 must NOT have been called
    expect(throwingCallApiWorker).not.toHaveBeenCalled();
  });

  it("falls through to stage-2 when cache has no match", async () => {
    // Empty cache — no hit possible
    const result = await classify("something totally unique and ambiguous", {
      callApiWorker: throwingCallApiWorker,
      detectApiProvider: stubbedDetectApiProvider,
      _embed: fakeEmbed,
    });

    // Should have attempted stage-2 (which throws → graceful fallback)
    // Result will be keyword_weak or no_signals since stage-2 throws
    expect(result.via).toBeUndefined();
    expect(result.reason).not.toBe("embedding-cache");
  });
});

// ── embeddingFallback opt-out ───────────────────────────────────────

describe("embeddingFallback: false", () => {
  it("skips embedding cache when embeddingFallback is false", async () => {
    // Prime cache
    await addEntry({
      text: "something totally unique and ambiguous",
      classification: { lane: LANES.TROUBLESHOOT, confidence: "medium" },
      confidence: 0.75,
      _embed: fakeEmbed,
    });

    const result = await classify("something totally unique and ambiguous", {
      callApiWorker: throwingCallApiWorker,
      detectApiProvider: stubbedDetectApiProvider,
      embeddingFallback: false,
      _embed: fakeEmbed,
    });

    // Should NOT return embedding-cache result
    expect(result.via).toBeUndefined();
    expect(result.reason).not.toBe("embedding-cache");
  });
});

// ── Error resilience ────────────────────────────────────────────────

describe("embedding cache error resilience", () => {
  it("continues to stage-2 when embedding cache throws", async () => {
    // Prime cache so query() doesn't short-circuit on empty cache
    await addEntry({
      text: "dummy",
      classification: { lane: LANES.OPERATIONAL, confidence: "high" },
      confidence: 0.9,
      _embed: fakeEmbed,
    });

    const brokenEmbed = async () => {
      throw new Error("embedding provider unavailable");
    };

    // Suppress the expected console.warn
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await classify("something totally unique and ambiguous", {
      callApiWorker: throwingCallApiWorker,
      detectApiProvider: stubbedDetectApiProvider,
      _embed: brokenEmbed,
    });

    // Should not crash — should fall through to stage-2 or fallback
    expect(result).toBeDefined();
    expect(result.lane).toBeDefined();
    expect(result.reason).not.toBe("embedding-cache");

    // Warning should have been logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("embedding cache query failed"),
      expect.any(String),
    );

    warnSpy.mockRestore();
  });
});

// ── Cache write-back (fire-and-forget) ──────────────────────────────

describe("cache write-back after classification", () => {
  it("caches keyword_match classifications for later retrieval", async () => {
    // Classify a message that matches keywords (e.g., "forge plan status")
    const result = await classify("what is my forge plan status?", {
      _embed: fakeEmbed,
      embeddingFallback: false, // skip cache read so we test the write path
    });

    expect(result.reason).toBe("keyword_match");

    // Allow fire-and-forget addEntry to complete
    await new Promise((r) => setTimeout(r, 50));

    // Cache should now have an entry — query for it
    const hits = await query("what is my forge plan status?", {
      threshold: 0.85,
      topK: 1,
      _embed: fakeEmbed,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].classification.lane).toBe(result.lane);
    expect(hits[0].classification.confidence).toBe(result.confidence);
  });
});
