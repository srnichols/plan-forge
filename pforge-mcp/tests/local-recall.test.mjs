/**
 * local-recall.test.mjs — Tests for the local semantic recall module.
 *
 * Covers:
 *   - readLocalThoughts: empty dir, single source, multi-source, cap
 *   - buildIdf: IDF weights for small corpus
 *   - tfIdfVector: TF-IDF weighting from token map
 *   - vecCosineSimilarity: empty vectors, identical, orthogonal
 *   - isNeuralEmbeddingAvailable: returns boolean (false in test env)
 *   - searchLocalThoughts: empty corpus, no match, ranked results, limit
 *   - buildCorpusIndex: serialisable shape, round-trip
 *   - persistIndex / loadCachedIndex: write + reload + staleness detection
 *   - clearPersistedIndex: deletes cache file
 *   - getIndexStatus: diagnostic shape
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  readLocalThoughts,
  buildIdf,
  tfIdfVector,
  vecCosineSimilarity,
  isNeuralEmbeddingAvailable,
  searchLocalThoughts,
  _resetNeuralProbeCache,
  buildCorpusIndex,
  persistIndex,
  loadCachedIndex,
  clearPersistedIndex,
  getIndexStatus,
} from "../local-recall.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `local-recall-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeThoughts(tmpDir, fileName, thoughts) {
  const forgeDir = resolve(tmpDir, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  const lines = thoughts.map((t) => JSON.stringify(t)).join("\n");
  writeFileSync(resolve(forgeDir, fileName), lines, "utf-8");
}

const SAMPLE_THOUGHTS = [
  { content: "Decision: use JWT authentication token for API security", source: "slice-1" },
  { content: "Decision: implement database migration strategy", source: "slice-2" },
  { content: "Decision: add retry logic for network calls", source: "slice-3" },
];

// ─── readLocalThoughts ───────────────────────────────────────────────────────

describe("readLocalThoughts", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns [] when .forge/ does not exist", () => {
    const result = readLocalThoughts(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns [] when .forge/ exists but no source files are present", () => {
    mkdirSync(resolve(tmpDir, ".forge"), { recursive: true });
    const result = readLocalThoughts(tmpDir);
    expect(result).toEqual([]);
  });

  it("reads records from openbrain-queue.jsonl", () => {
    const thoughts = [
      { content: "Decision: use JWT", _enqueuedAt: "2026-01-01T00:00:00.000Z" },
      { content: "Decision: add retry logic", _enqueuedAt: "2026-01-02T00:00:00.000Z" },
    ];
    writeThoughts(tmpDir, "openbrain-queue.jsonl", thoughts);

    const result = readLocalThoughts(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Decision: use JWT");
  });

  it("skips malformed JSON lines gracefully", () => {
    const forgeDir = resolve(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "openbrain-queue.jsonl"), [
      JSON.stringify({ content: "valid thought" }),
      "not valid json",
      JSON.stringify({ content: "another valid thought" }),
    ].join("\n"), "utf-8");

    const result = readLocalThoughts(tmpDir);
    expect(result).toHaveLength(2);
  });

  it("aggregates records from multiple source files", () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", [{ content: "from queue" }]);
    writeThoughts(tmpDir, "openbrain-dlq.jsonl", [{ content: "from dlq" }]);

    const result = readLocalThoughts(tmpDir);
    expect(result).toHaveLength(2);
    const contents = result.map((r) => r.content);
    expect(contents).toContain("from queue");
    expect(contents).toContain("from dlq");
  });

  it("respects max cap and does not exceed it", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ content: `thought ${i}` }));
    writeThoughts(tmpDir, "openbrain-queue.jsonl", many);
    writeThoughts(tmpDir, "openbrain-dlq.jsonl", many);

    const result = readLocalThoughts(tmpDir, { max: 15 });
    expect(result.length).toBeLessThanOrEqual(15);
  });

  it("respects explicit sources filter", () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", [{ content: "queue thought" }]);
    writeThoughts(tmpDir, "openbrain-dlq.jsonl", [{ content: "dlq thought" }]);

    const result = readLocalThoughts(tmpDir, { sources: ["openbrain-queue.jsonl"] });
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("queue thought");
  });
});

// ─── buildIdf ────────────────────────────────────────────────────────────────

describe("buildIdf", () => {
  it("returns an empty map for an empty corpus", () => {
    const idf = buildIdf([]);
    expect(idf.size).toBe(0);
  });

  it("assigns higher IDF to rare terms", async () => {
    const { tokenize } = await import("../memory.mjs");
    const corpus = [
      tokenize("decision authentication"),
      tokenize("decision database"),
      tokenize("decision cache"),
      tokenize("authentication token jwt"),
    ];
    const idf = buildIdf(corpus);
    // "decision" appears 3/4 docs, "jwt" appears 1/4 → jwt should have higher IDF
    const idfDecision = idf.get("decision") ?? 0;
    const idfJwt = idf.get("jwt") ?? 0;
    expect(idfJwt).toBeGreaterThan(idfDecision);
  });

  it("returns positive values for all tokens", async () => {
    const { tokenize } = await import("../memory.mjs");
    const corpus = [tokenize("hello world"), tokenize("hello there")];
    const idf = buildIdf(corpus);
    for (const v of idf.values()) {
      expect(v).toBeGreaterThan(0);
    }
  });
});

// ─── tfIdfVector ─────────────────────────────────────────────────────────────

describe("tfIdfVector", () => {
  it("returns a Map", async () => {
    const { tokenize } = await import("../memory.mjs");
    const idf = buildIdf([tokenize("hello world")]);
    const vec = tfIdfVector("hello", idf);
    expect(vec instanceof Map).toBe(true);
  });

  it("returns empty Map for empty text", async () => {
    const { tokenize } = await import("../memory.mjs");
    const idf = buildIdf([tokenize("hello world")]);
    expect(tfIdfVector("", idf).size).toBe(0);
  });

  it("produces non-zero weights for known tokens", async () => {
    const { tokenize } = await import("../memory.mjs");
    const corpus = [tokenize("auth jwt token"), tokenize("database schema")];
    const idf = buildIdf(corpus);
    const vec = tfIdfVector("auth jwt token", idf);
    for (const v of vec.values()) {
      expect(v).toBeGreaterThan(0);
    }
  });
});

// ─── vecCosineSimilarity ─────────────────────────────────────────────────────

describe("vecCosineSimilarity", () => {
  it("returns 0 for empty vectors", () => {
    expect(vecCosineSimilarity(new Map(), new Map())).toBe(0);
  });

  it("returns 0 when one vector is empty", () => {
    const a = new Map([["hello", 1]]);
    expect(vecCosineSimilarity(a, new Map())).toBe(0);
  });

  it("returns 1.0 for identical vectors", () => {
    const a = new Map([["hello", 2], ["world", 3]]);
    const b = new Map([["hello", 2], ["world", 3]]);
    const sim = vecCosineSimilarity(a, b);
    expect(sim).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for orthogonal vectors (no shared tokens)", () => {
    const a = new Map([["apple", 1]]);
    const b = new Map([["orange", 1]]);
    expect(vecCosineSimilarity(a, b)).toBe(0);
  });

  it("returns value in [0, 1] for overlapping vectors", () => {
    const a = new Map([["auth", 1], ["jwt", 1], ["token", 1]]);
    const b = new Map([["auth", 1], ["rbac", 1], ["role", 1]]);
    const sim = vecCosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

// ─── isNeuralEmbeddingAvailable ──────────────────────────────────────────────

describe("isNeuralEmbeddingAvailable", () => {
  beforeEach(() => _resetNeuralProbeCache());

  it("returns a boolean", async () => {
    const result = await isNeuralEmbeddingAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("caches result on second call (same value)", async () => {
    const first = await isNeuralEmbeddingAvailable();
    const second = await isNeuralEmbeddingAvailable();
    expect(first).toBe(second);
  });
});

// ─── buildCorpusIndex ────────────────────────────────────────────────────────

describe("buildCorpusIndex", () => {
  it("returns serialisable shape with tokenMaps and idf arrays", () => {
    const idx = buildCorpusIndex(SAMPLE_THOUGHTS);
    expect(Array.isArray(idx.tokenMaps)).toBe(true);
    expect(Array.isArray(idx.idf)).toBe(true);
    expect(idx.tokenMaps).toHaveLength(SAMPLE_THOUGHTS.length);
    // Each tokenMap is an array of [token, count] pairs
    for (const tMap of idx.tokenMaps) {
      expect(Array.isArray(tMap)).toBe(true);
    }
  });

  it("round-trips through JSON serialization", () => {
    const idx = buildCorpusIndex(SAMPLE_THOUGHTS);
    const json = JSON.stringify(idx);
    const parsed = JSON.parse(json);
    expect(parsed.tokenMaps).toHaveLength(SAMPLE_THOUGHTS.length);
    expect(Array.isArray(parsed.idf)).toBe(true);
  });

  it("returns empty arrays for empty thought list", () => {
    const idx = buildCorpusIndex([]);
    expect(idx.tokenMaps).toHaveLength(0);
    expect(idx.idf).toHaveLength(0);
  });
});

// ─── persistIndex / loadCachedIndex ──────────────────────────────────────────

describe("persistIndex + loadCachedIndex", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("persistIndex is non-fatal when .forge/ does not exist", () => {
    const idx = buildCorpusIndex(SAMPLE_THOUGHTS);
    expect(() => persistIndex(tmpDir, idx)).not.toThrow();
  });

  it("round-trips: persist then load returns hydrated Maps", () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);
    const idx = buildCorpusIndex(SAMPLE_THOUGHTS);
    persistIndex(tmpDir, idx, { corpusSize: SAMPLE_THOUGHTS.length });

    const loaded = loadCachedIndex(tmpDir);
    expect(loaded).not.toBeNull();
    expect(Array.isArray(loaded.tokenMaps)).toBe(true);
    expect(loaded.tokenMaps[0]).toBeInstanceOf(Map);
    expect(loaded.idf).toBeInstanceOf(Map);
    expect(loaded.idf.size).toBeGreaterThan(0);
  });

  it("returns null when cache file does not exist", () => {
    mkdirSync(resolve(tmpDir, ".forge"), { recursive: true });
    expect(loadCachedIndex(tmpDir)).toBeNull();
  });

  it("returns null for version mismatch", () => {
    const forgeDir = resolve(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(
      resolve(forgeDir, "local-recall-index.json"),
      JSON.stringify({ version: 999, builtAt: Date.now(), corpusSize: 0, sourceMtimes: {}, index: { tokenMaps: [], idf: [] } }),
      "utf-8"
    );
    expect(loadCachedIndex(tmpDir)).toBeNull();
  });

  it("returns null for malformed cache file", () => {
    const forgeDir = resolve(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "local-recall-index.json"), "not json", "utf-8");
    expect(loadCachedIndex(tmpDir)).toBeNull();
  });

  it("detects stale index when source JSONL is modified after build", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);

    // Build and persist with a past builtAt
    const forgeDir = resolve(tmpDir, ".forge");
    const srcPath = resolve(forgeDir, "openbrain-queue.jsonl");
    const idx = buildCorpusIndex(SAMPLE_THOUGHTS);

    // Write index with builtAt in the distant past
    const record = {
      version: 1,
      builtAt: 1000, // epoch + 1 second — guaranteed older than any real file
      corpusSize: SAMPLE_THOUGHTS.length,
      sourceMtimes: { "openbrain-queue.jsonl": 1000 },
      index: idx,
    };
    writeFileSync(resolve(forgeDir, "local-recall-index.json"), JSON.stringify(record), "utf-8");

    // Touch the source file to make it newer than builtAt
    const now = new Date();
    utimesSync(srcPath, now, now);

    // Should detect stale
    expect(loadCachedIndex(tmpDir)).toBeNull();
  });
});

// ─── clearPersistedIndex ─────────────────────────────────────────────────────

describe("clearPersistedIndex", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("is non-fatal when cache does not exist", () => {
    mkdirSync(resolve(tmpDir, ".forge"), { recursive: true });
    expect(() => clearPersistedIndex(tmpDir)).not.toThrow();
  });

  it("deletes the cache file when it exists", () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);
    const idx = buildCorpusIndex(SAMPLE_THOUGHTS);
    persistIndex(tmpDir, idx, { corpusSize: SAMPLE_THOUGHTS.length });

    const cachePath = resolve(tmpDir, ".forge", "local-recall-index.json");
    expect(existsSync(cachePath)).toBe(true);

    clearPersistedIndex(tmpDir);
    expect(existsSync(cachePath)).toBe(false);
  });
});

// ─── getIndexStatus ──────────────────────────────────────────────────────────

describe("getIndexStatus", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => cleanup(tmpDir));

  it("returns exists:false when .forge/ has no cache", () => {
    mkdirSync(resolve(tmpDir, ".forge"), { recursive: true });
    const status = getIndexStatus(tmpDir);
    expect(status.exists).toBe(false);
    expect(status.version).toBeNull();
    expect(status.builtAt).toBeNull();
  });

  it("returns exists:true with metadata after persist", () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);
    const idx = buildCorpusIndex(SAMPLE_THOUGHTS);
    persistIndex(tmpDir, idx, { corpusSize: SAMPLE_THOUGHTS.length });

    const status = getIndexStatus(tmpDir);
    expect(status.exists).toBe(true);
    expect(status.version).toBe(1);
    expect(typeof status.builtAt).toBe("string");
    expect(status.corpusSize).toBe(SAMPLE_THOUGHTS.length);
    expect(typeof status.stale).toBe("boolean");
    expect(typeof status.cacheFile).toBe("string");
  });

  it("reports stale:false for a fresh index with no source files newer", () => {
    const forgeDir = resolve(tmpDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const idx = buildCorpusIndex([]);
    persistIndex(tmpDir, idx, { corpusSize: 0 });

    const status = getIndexStatus(tmpDir);
    expect(status.stale).toBe(false);
  });
});

// ─── searchLocalThoughts ────────────────────────────────────────────────────

describe("searchLocalThoughts", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); _resetNeuralProbeCache(); });
  afterEach(() => cleanup(tmpDir));

  it("returns empty result for missing .forge/ directory", async () => {
    const result = await searchLocalThoughts("authentication", { cwd: tmpDir, forceBackend: "tfidf" });
    expect(result.hits).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.message).toContain("No local thoughts");
  });

  it("returns error result for empty query", async () => {
    const result = await searchLocalThoughts("", { cwd: tmpDir, forceBackend: "tfidf" });
    expect(result.hits).toEqual([]);
    expect(result.message).toContain("non-empty string");
  });

  it("returns empty result with helpful message when no thoughts match", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", [
      { content: "Decision: use JWT authentication", source: "slice-1" },
    ]);
    const result = await searchLocalThoughts("xyzzy completely unrelated term", {
      cwd: tmpDir,
      threshold: 0.9,
      forceBackend: "tfidf",
    });
    expect(result.hits).toEqual([]);
    expect(result.message).toContain("No thoughts matched");
  });

  it("returns ranked hits for matching query", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);
    const result = await searchLocalThoughts("JWT authentication API security", {
      cwd: tmpDir,
      forceBackend: "tfidf",
    });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.backend).toBe("tfidf");
    // JWT-related thought should rank first
    expect(result.hits[0].source).toBe("slice-1");
  });

  it("respects limit", async () => {
    const thoughts = Array.from({ length: 10 }, (_, i) => ({
      content: `Decision: pattern ${i} for authentication JWT`,
      source: `slice-${i}`,
    }));
    writeThoughts(tmpDir, "openbrain-queue.jsonl", thoughts);

    const result = await searchLocalThoughts("authentication JWT", {
      cwd: tmpDir,
      limit: 3,
      forceBackend: "tfidf",
    });
    expect(result.hits.length).toBeLessThanOrEqual(3);
  });

  it("includes expected hit fields in output", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", [
      { content: "Decision: implement caching with Redis", source: "test-source", project: "my-project", _enqueuedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const result = await searchLocalThoughts("caching Redis", {
      cwd: tmpDir,
      forceBackend: "tfidf",
    });
    expect(result.hits.length).toBeGreaterThan(0);
    const hit = result.hits[0];
    expect(hit).toHaveProperty("source");
    expect(hit).toHaveProperty("snippet");
    expect(hit).toHaveProperty("score");
    expect(typeof hit.score).toBe("number");
    expect(hit.score).toBeGreaterThan(0);
  });

  it("includes corpusSize and backend in result", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", [
      { content: "Decision: use Redis caching" },
    ]);
    const result = await searchLocalThoughts("Redis", {
      cwd: tmpDir,
      forceBackend: "tfidf",
    });
    expect(result).toHaveProperty("corpusSize");
    expect(result).toHaveProperty("backend", "tfidf");
    expect(result).toHaveProperty("query", "Redis");
    expect(result).toHaveProperty("truncated");
    expect(result).toHaveProperty("message");
  });

  it("truncates long snippets to SNIPPET_CHARS + ellipsis", async () => {
    const longContent = "a".repeat(200);
    writeThoughts(tmpDir, "openbrain-queue.jsonl", [{ content: longContent, source: "s1" }]);
    const result = await searchLocalThoughts("a", {
      cwd: tmpDir,
      forceBackend: "tfidf",
      threshold: 0,
    });
    if (result.hits.length > 0) {
      expect(result.hits[0].snippet.endsWith("…")).toBe(true);
      expect(result.hits[0].snippet.length).toBeLessThanOrEqual(125);
    }
  });

  it("reads from liveguard-memories.jsonl when present", async () => {
    writeThoughts(tmpDir, "liveguard-memories.jsonl", [
      { content: "LiveGuard: deployment blocked — secrets scan failed", source: "liveguard" },
    ]);
    const result = await searchLocalThoughts("deployment secrets liveguard", {
      cwd: tmpDir,
      forceBackend: "tfidf",
    });
    expect(result.corpusSize).toBeGreaterThan(0);
  });

  it("builds and caches index on first call, reuses on second call", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);

    // First call should build and persist the cache
    const r1 = await searchLocalThoughts("authentication", { cwd: tmpDir, forceBackend: "tfidf" });

    const cachePath = resolve(tmpDir, ".forge", "local-recall-index.json");
    expect(existsSync(cachePath)).toBe(true);

    // Second call should use the cached index (same results)
    const r2 = await searchLocalThoughts("authentication", { cwd: tmpDir, forceBackend: "tfidf" });
    expect(r1.hits.length).toBe(r2.hits.length);
    if (r1.hits.length > 0) {
      expect(r1.hits[0].source).toBe(r2.hits[0].source);
    }
  });

  it("noCache:true skips the persisted index", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);

    // First call caches
    await searchLocalThoughts("authentication", { cwd: tmpDir, forceBackend: "tfidf" });
    // Second call with noCache bypasses it
    const result = await searchLocalThoughts("authentication", {
      cwd: tmpDir,
      forceBackend: "tfidf",
      noCache: true,
    });
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it("invalidates stale index and rebuilds after corpus changes", async () => {
    writeThoughts(tmpDir, "openbrain-queue.jsonl", SAMPLE_THOUGHTS);
    // First search primes the cache
    await searchLocalThoughts("JWT", { cwd: tmpDir, forceBackend: "tfidf" });

    // Forcibly set builtAt=1 in the cache to simulate staleness
    const cachePath = resolve(tmpDir, ".forge", "local-recall-index.json");
    const record = JSON.parse(readFileSync(cachePath, "utf-8"));
    record.builtAt = 1;
    writeFileSync(cachePath, JSON.stringify(record), "utf-8");

    // Touch the source file so it is newer than builtAt=1
    const srcPath = resolve(tmpDir, ".forge", "openbrain-queue.jsonl");
    const now = new Date();
    utimesSync(srcPath, now, now);

    // Next search should rebuild (no error, results still come back)
    const result = await searchLocalThoughts("JWT", { cwd: tmpDir, forceBackend: "tfidf" });
    expect(result.hits.length).toBeGreaterThan(0);
  });
});
