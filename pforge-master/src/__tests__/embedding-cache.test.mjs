import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addEntry,
  query,
  evictLRU,
  save,
  load,
  size,
  cosineSimilarity,
  MAX_ENTRIES,
  __resetCacheForTests,
} from '../embedding/cache.mjs';

/** Deterministic fake embedder — maps text to a unit vector at a fixed slot. */
const DIM = 8;
function fakeEmbed(text) {
  const v = new Float32Array(DIM);
  let slot = 0;
  for (let i = 0; i < text.length; i++) slot = (slot + text.charCodeAt(i)) % DIM;
  v[slot] = 1;
  return Promise.resolve(v);
}

/** Embed that returns a known vector directly. */
function vectorEmbed(vec) {
  return () => Promise.resolve(vec);
}

let tmpDir;

beforeEach(() => {
  __resetCacheForTests();
  tmpDir = mkdtempSync(join(tmpdir(), 'ec-test-'));
});

afterEach(() => {
  __resetCacheForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Cosine similarity ────────────────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical unit vectors', () => {
    const v = new Float32Array([0, 1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 6);
  });

  it('returns 0 for zero-magnitude vector (no NaN)', () => {
    const zero = new Float32Array(4);
    const v = new Float32Array([1, 0, 0, 0]);
    expect(cosineSimilarity(zero, v)).toBe(0);
    expect(Number.isNaN(cosineSimilarity(zero, v))).toBe(false);
  });
});

// ── Threshold filtering ──────────────────────────────────────────────

describe('query — threshold filtering', () => {
  it('returns matches above threshold', async () => {
    // Add entry with a known vector, then query with the same text
    await addEntry({
      text: 'show build status',
      classification: { lane: 'operational' },
      confidence: 0.9,
      _embed: fakeEmbed,
    });

    const results = await query('show build status', {
      threshold: 0.85,
      topK: 5,
      _embed: fakeEmbed,
    });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThanOrEqual(0.85);
    expect(results[0].classification.lane).toBe('operational');
  });

  it('filters out matches below threshold', async () => {
    // a and b produce orthogonal vectors
    const embedA = vectorEmbed(new Float32Array([1, 0, 0, 0]));
    const embedB = vectorEmbed(new Float32Array([0, 1, 0, 0]));

    await addEntry({
      text: 'alpha',
      classification: { lane: 'build' },
      confidence: 0.8,
      _embed: embedA,
    });

    const results = await query('beta', {
      threshold: 0.85,
      topK: 5,
      _embed: embedB,
    });
    expect(results).toHaveLength(0);
  });

  it('sorts results by score descending and respects topK', async () => {
    // Three entries at different similarity levels
    const base = new Float32Array([1, 0, 0, 0]);
    const high = new Float32Array([0.95, 0.31, 0, 0]); // cos ≈ 0.95
    const mid = new Float32Array([0.87, 0.49, 0, 0]);  // cos ≈ 0.87
    const low = new Float32Array([0.5, 0.87, 0, 0]);   // cos ≈ 0.50

    await addEntry({ text: 'mid', classification: { lane: 'b' }, confidence: 0.7, _embed: vectorEmbed(mid) });
    await addEntry({ text: 'high', classification: { lane: 'a' }, confidence: 0.9, _embed: vectorEmbed(high) });
    await addEntry({ text: 'low', classification: { lane: 'c' }, confidence: 0.5, _embed: vectorEmbed(low) });

    const results = await query('q', {
      threshold: 0.80,
      topK: 2,
      _embed: vectorEmbed(base),
    });

    expect(results).toHaveLength(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].classification.lane).toBe('a'); // high
    expect(results[1].classification.lane).toBe('b'); // mid
  });

  it('returns empty array when cache is empty', async () => {
    const results = await query('anything', { _embed: fakeEmbed });
    expect(results).toHaveLength(0);
  });
});

// ── LRU eviction ─────────────────────────────────────────────────────

describe('LRU eviction', () => {
  it('evicts oldest entry when cache reaches MAX_ENTRIES', async () => {
    // Fill cache to MAX_ENTRIES
    for (let i = 0; i < MAX_ENTRIES; i++) {
      await addEntry({
        text: `entry-${i}`,
        classification: { lane: 'test' },
        confidence: 0.9,
        _embed: fakeEmbed,
      });
    }
    expect(size()).toBe(MAX_ENTRIES);

    // Adding one more should evict the oldest
    await addEntry({
      text: 'entry-overflow',
      classification: { lane: 'overflow' },
      confidence: 0.95,
      _embed: fakeEmbed,
    });
    expect(size()).toBe(MAX_ENTRIES);
  });

  it('evicts entry 501 correctly — oldest entry removed', async () => {
    // Add 500 entries; entry-0 is the first (oldest lastUsed)
    for (let i = 0; i < MAX_ENTRIES; i++) {
      await addEntry({
        text: `e-${i}`,
        classification: { lane: 'x', index: i },
        confidence: 0.5,
        _embed: fakeEmbed,
      });
    }

    // The very first entry should be evictable
    const evictedId = evictLRU();
    expect(evictedId).toBe(1); // first entry added
    expect(size()).toBe(MAX_ENTRIES - 1);
  });

  it('evictLRU returns null on empty cache', () => {
    expect(evictLRU()).toBeNull();
  });
});

// ── Save / Load round-trip ───────────────────────────────────────────

describe('save / load persistence', () => {
  it('round-trips entries through binary + sidecar', async () => {
    const filePath = join(tmpDir, 'sub', 'cache.bin');

    await addEntry({
      text: 'build log command',
      classification: { lane: 'operational', via: 'keyword' },
      confidence: 0.92,
      _embed: fakeEmbed,
    });
    await addEntry({
      text: 'fix broken test',
      classification: { lane: 'troubleshoot', via: 'router' },
      confidence: 0.78,
      _embed: fakeEmbed,
    });

    await save(filePath);

    // Reset and reload
    __resetCacheForTests();
    expect(size()).toBe(0);

    await load(filePath);
    expect(size()).toBe(2);

    // Query with same embedder should still match
    const results = await query('build log command', {
      threshold: 0.99,
      topK: 1,
      _embed: fakeEmbed,
    });
    expect(results).toHaveLength(1);
    expect(results[0].classification.lane).toBe('operational');
    expect(results[0].confidence).toBe(0.92);
  });

  it('preserves vector fidelity after save/load', async () => {
    const filePath = join(tmpDir, 'fidelity.bin');
    const knownVec = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);

    await addEntry({
      text: 'known',
      classification: { lane: 'test' },
      confidence: 1.0,
      _embed: vectorEmbed(knownVec),
    });

    await save(filePath);
    __resetCacheForTests();
    await load(filePath);

    // Query with exact same vector should get cosine ≈ 1.0
    const results = await query('q', {
      threshold: 0.999,
      topK: 1,
      _embed: vectorEmbed(knownVec),
    });
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(1.0, 4);
  });

  it('creates parent directories on save', async () => {
    const deep = join(tmpDir, 'a', 'b', 'c', 'cache.bin');
    await addEntry({
      text: 'deep',
      classification: { lane: 'x' },
      confidence: 0.5,
      _embed: fakeEmbed,
    });
    await save(deep);
    __resetCacheForTests();
    await load(deep);
    expect(size()).toBe(1);
  });

  it('handles empty cache save/load', async () => {
    const filePath = join(tmpDir, 'empty.bin');
    await save(filePath);
    await load(filePath);
    expect(size()).toBe(0);
  });

  it('load replaces existing cache contents', async () => {
    const filePath = join(tmpDir, 'replace.bin');

    await addEntry({ text: 'a', classification: { lane: 'x' }, confidence: 0.5, _embed: fakeEmbed });
    await save(filePath);

    // Add more entries, then reload — should revert to 1
    await addEntry({ text: 'b', classification: { lane: 'y' }, confidence: 0.6, _embed: fakeEmbed });
    await addEntry({ text: 'c', classification: { lane: 'z' }, confidence: 0.7, _embed: fakeEmbed });
    expect(size()).toBe(3);

    await load(filePath);
    expect(size()).toBe(1);
  });
});

// ── addEntry basics ──────────────────────────────────────────────────

describe('addEntry', () => {
  it('returns unique ids', async () => {
    const id1 = await addEntry({ text: 'a', classification: { lane: 'x' }, confidence: 0.5, _embed: fakeEmbed });
    const id2 = await addEntry({ text: 'b', classification: { lane: 'y' }, confidence: 0.6, _embed: fakeEmbed });
    expect(id1).not.toBe(id2);
  });

  it('increments size', async () => {
    expect(size()).toBe(0);
    await addEntry({ text: 'a', classification: { lane: 'x' }, confidence: 0.5, _embed: fakeEmbed });
    expect(size()).toBe(1);
  });
});
