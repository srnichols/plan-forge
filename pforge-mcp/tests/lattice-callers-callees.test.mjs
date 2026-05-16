/**
 * lattice-callers-callees.test.mjs — Tests for latticeCallers + latticeCallees (Slice 5).
 *
 * Tests write chunk/edge fixture JSONL directly into a temp .forge/lattice/ dir so
 * they are fully independent of latticeIndex and run without tree-sitter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { latticeCallers, latticeCallees } from '../lattice.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = resolve(tmpdir(), `lattice-cc-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function seedIndex(root, chunks = [], edges = []) {
  const latticeDir = join(root, '.forge', 'lattice');
  mkdirSync(latticeDir, { recursive: true });
  writeFileSync(
    join(latticeDir, 'chunks.jsonl'),
    chunks.map((c) => JSON.stringify(c)).join('\n') + (chunks.length > 0 ? '\n' : ''),
    'utf8',
  );
  writeFileSync(
    join(latticeDir, 'edges.jsonl'),
    edges.map((e) => JSON.stringify(e)).join('\n') + (edges.length > 0 ? '\n' : ''),
    'utf8',
  );
}

function makeChunk(id, name, overrides = {}) {
  return {
    id,
    filePath: 'src/foo.js',
    language: 'js',
    kind: 'function',
    name,
    startByte: 0,
    endByte: 20,
    startLine: 1,
    endLine: 1,
    contentHash: 'sha256:abc',
    declares: [],
    references: [],
    ...overrides,
  };
}

function makeEdge(callerChunkId, calleeName) {
  return { callerChunkId, calleeName };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => { tmpDir = makeTempDir(); });
afterEach(() => { cleanup(tmpDir); });

// ═══════════════════════════════════════════════════════════════════════════════
// latticeCallers
// ═══════════════════════════════════════════════════════════════════════════════

describe('latticeCallers — validation', () => {
  it('returns empty result with message when name is omitted', () => {
    const result = latticeCallers({ deps: { cwd: tmpDir } });
    expect(result.chunks).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.message).toMatch(/"name"/i);
  });

  it('returns empty result with message when name is empty string', () => {
    const result = latticeCallers({ name: '', deps: { cwd: tmpDir } });
    expect(result.chunks).toEqual([]);
    expect(result.message).toMatch(/"name"/i);
  });
});

describe('latticeCallers — empty index', () => {
  it('returns empty chunks when index does not exist', () => {
    const result = latticeCallers({ name: 'doSomething', deps: { cwd: tmpDir } });
    expect(result.chunks).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
    expect(typeof result.message).toBe('string');
  });

  it('message mentions latticeIndex when no callers found', () => {
    const result = latticeCallers({ name: 'phantom', deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/index/i);
  });
});

describe('latticeCallers — finding callers', () => {
  it('returns the caller chunk when one edge points to the given name', () => {
    const callerChunk = makeChunk('aaaa000000000001', 'callerFn');
    const edges = [makeEdge('aaaa000000000001', 'helperFn')];
    seedIndex(tmpDir, [callerChunk], edges);

    const result = latticeCallers({ name: 'helperFn', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].id).toBe('aaaa000000000001');
    expect(result.chunks[0].name).toBe('callerFn');
  });

  it('returns multiple callers when several chunks reference the same name', () => {
    const c1 = makeChunk('aaaa000000000001', 'fnA');
    const c2 = makeChunk('aaaa000000000002', 'fnB');
    const c3 = makeChunk('aaaa000000000003', 'fnC');
    const edges = [
      makeEdge('aaaa000000000001', 'sharedHelper'),
      makeEdge('aaaa000000000002', 'sharedHelper'),
      makeEdge('aaaa000000000003', 'unrelated'),
    ];
    seedIndex(tmpDir, [c1, c2, c3], edges);

    const result = latticeCallers({ name: 'sharedHelper', deps: { cwd: tmpDir } });
    expect(result.total).toBe(2);
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain('fnA');
    expect(names).toContain('fnB');
    expect(names).not.toContain('fnC');
  });

  it('returns empty when no edge matches the given callee name', () => {
    const chunk = makeChunk('aaaa000000000001', 'fn');
    const edges = [makeEdge('aaaa000000000001', 'otherFn')];
    seedIndex(tmpDir, [chunk], edges);

    const result = latticeCallers({ name: 'nonexistent', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
    expect(result.chunks).toHaveLength(0);
  });

  it('deduplicates callerChunkId — same chunk listed once even with multiple edges to same name', () => {
    const c = makeChunk('aaaa000000000001', 'fnA');
    const edges = [
      makeEdge('aaaa000000000001', 'helper'),
      makeEdge('aaaa000000000001', 'helper'), // duplicate edge
    ];
    seedIndex(tmpDir, [c], edges);

    const result = latticeCallers({ name: 'helper', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
  });
});

describe('latticeCallers — limit', () => {
  it('respects the limit parameter', () => {
    const chunks = Array.from({ length: 8 }, (_, i) =>
      makeChunk(`aaaa00000000000${i}`, `caller${i}`),
    );
    const edges = chunks.map((c) => makeEdge(c.id, 'target'));
    seedIndex(tmpDir, chunks, edges);

    const result = latticeCallers({ name: 'target', limit: 3, deps: { cwd: tmpDir } });
    expect(result.chunks).toHaveLength(3);
    expect(result.total).toBe(8);
    expect(result.truncated).toBe(true);
  });

  it('truncated is false when results fit within limit', () => {
    const chunk = makeChunk('aaaa000000000001', 'fn');
    const edges = [makeEdge('aaaa000000000001', 'dep')];
    seedIndex(tmpDir, [chunk], edges);

    const result = latticeCallers({ name: 'dep', limit: 25, deps: { cwd: tmpDir } });
    expect(result.truncated).toBe(false);
  });
});

describe('latticeCallers — result shape', () => {
  it('result has chunks, total, truncated, message fields', () => {
    seedIndex(tmpDir);
    const result = latticeCallers({ name: 'something', deps: { cwd: tmpDir } });
    expect(result).toHaveProperty('chunks');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('truncated');
    expect(result).toHaveProperty('message');
  });

  it('message includes caller count when results are found', () => {
    const chunk = makeChunk('aaaa000000000001', 'fn');
    seedIndex(tmpDir, [chunk], [makeEdge('aaaa000000000001', 'dep')]);

    const result = latticeCallers({ name: 'dep', deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/1/);
    expect(result.message).toContain('dep');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// latticeCallees
// ═══════════════════════════════════════════════════════════════════════════════

describe('latticeCallees — validation', () => {
  it('returns empty result with message when neither chunkId nor name is given', () => {
    const result = latticeCallees({ deps: { cwd: tmpDir } });
    expect(result.chunks).toEqual([]);
    expect(result.unresolvedNames).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.message).toMatch(/"chunkId"/i);
  });
});

describe('latticeCallees — empty index', () => {
  it('returns empty result when no index exists (by chunkId)', () => {
    const result = latticeCallees({ chunkId: 'abc123', deps: { cwd: tmpDir } });
    expect(result.chunks).toEqual([]);
    expect(result.unresolvedNames).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns "no chunk found" message when name matches nothing (by name)', () => {
    const result = latticeCallees({ name: 'unknownFn', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
    expect(result.message).toMatch(/no chunk found/i);
    expect(result.message).toContain('unknownFn');
  });
});

describe('latticeCallees — by chunkId', () => {
  it('returns resolved callee chunks when callee names match known chunks', () => {
    const caller = makeChunk('aaaa000000000001', 'callerFn');
    const callee = makeChunk('bbbb000000000001', 'helperFn');
    const edges = [makeEdge('aaaa000000000001', 'helperFn')];
    seedIndex(tmpDir, [caller, callee], edges);

    const result = latticeCallees({ chunkId: 'aaaa000000000001', deps: { cwd: tmpDir } });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].name).toBe('helperFn');
    expect(result.unresolvedNames).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('puts unresolvable callee names into unresolvedNames', () => {
    const caller = makeChunk('aaaa000000000001', 'callerFn');
    // No chunk exists for 'externalLib'
    const edges = [makeEdge('aaaa000000000001', 'externalLib')];
    seedIndex(tmpDir, [caller], edges);

    const result = latticeCallees({ chunkId: 'aaaa000000000001', deps: { cwd: tmpDir } });
    expect(result.chunks).toHaveLength(0);
    expect(result.unresolvedNames).toContain('externalLib');
    expect(result.total).toBe(1);
  });

  it('returns empty when chunkId has no outgoing edges', () => {
    const chunk = makeChunk('aaaa000000000001', 'isolated');
    seedIndex(tmpDir, [chunk], []);

    const result = latticeCallees({ chunkId: 'aaaa000000000001', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
    expect(result.chunks).toHaveLength(0);
    expect(result.unresolvedNames).toHaveLength(0);
  });

  it('mixes resolved and unresolved callees', () => {
    const caller = makeChunk('aaaa000000000001', 'main');
    const known  = makeChunk('bbbb000000000001', 'knownHelper');
    const edges = [
      makeEdge('aaaa000000000001', 'knownHelper'),
      makeEdge('aaaa000000000001', 'unknownExternal'),
    ];
    seedIndex(tmpDir, [caller, known], edges);

    const result = latticeCallees({ chunkId: 'aaaa000000000001', deps: { cwd: tmpDir } });
    expect(result.total).toBe(2);
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].name).toBe('knownHelper');
    expect(result.unresolvedNames).toContain('unknownExternal');
  });
});

describe('latticeCallees — by name', () => {
  it('resolves the source chunk by name and returns its callees', () => {
    const caller = makeChunk('aaaa000000000001', 'processRequest');
    const callee = makeChunk('bbbb000000000001', 'validateInput');
    const edges = [makeEdge('aaaa000000000001', 'validateInput')];
    seedIndex(tmpDir, [caller, callee], edges);

    const result = latticeCallees({ name: 'processRequest', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].name).toBe('validateInput');
  });

  it('returns "no chunk found" message for a name not in the index', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'fn')], []);

    const result = latticeCallees({ name: 'nope', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
    expect(result.message).toMatch(/no chunk found/i);
  });

  it('collects callees from all matching source chunks when name is ambiguous', () => {
    // Two chunks share the name (overloads / different files)
    const c1 = makeChunk('aaaa000000000001', 'render', { filePath: 'a.js' });
    const c2 = makeChunk('aaaa000000000002', 'render', { filePath: 'b.js' });
    const callee = makeChunk('bbbb000000000001', 'formatOutput');
    const edges = [
      makeEdge('aaaa000000000001', 'formatOutput'),
      makeEdge('aaaa000000000002', 'formatOutput'),
    ];
    seedIndex(tmpDir, [c1, c2, callee], edges);

    const result = latticeCallees({ name: 'render', deps: { cwd: tmpDir } });
    // De-duplicated: formatOutput appears only once
    expect(result.total).toBe(1);
    expect(result.chunks[0].name).toBe('formatOutput');
  });
});

describe('latticeCallees — limit', () => {
  it('respects the limit parameter for resolved chunks', () => {
    const caller = makeChunk('aaaa000000000001', 'bigFn');
    const callees = Array.from({ length: 10 }, (_, i) =>
      makeChunk(`bbbb00000000000${i}`, `helper${i}`),
    );
    const edges = callees.map((c) => makeEdge('aaaa000000000001', c.name));
    seedIndex(tmpDir, [caller, ...callees], edges);

    const result = latticeCallees({ chunkId: 'aaaa000000000001', limit: 3, deps: { cwd: tmpDir } });
    expect(result.chunks).toHaveLength(3);
    expect(result.total).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('truncated is false when resolved count fits within limit', () => {
    const caller = makeChunk('aaaa000000000001', 'fn');
    const callee = makeChunk('bbbb000000000001', 'dep');
    seedIndex(tmpDir, [caller, callee], [makeEdge('aaaa000000000001', 'dep')]);

    const result = latticeCallees({ chunkId: 'aaaa000000000001', limit: 25, deps: { cwd: tmpDir } });
    expect(result.truncated).toBe(false);
  });
});

describe('latticeCallees — result shape', () => {
  it('result has chunks, unresolvedNames, total, truncated, message fields', () => {
    const result = latticeCallees({ chunkId: 'anything', deps: { cwd: tmpDir } });
    expect(result).toHaveProperty('chunks');
    expect(result).toHaveProperty('unresolvedNames');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('truncated');
    expect(result).toHaveProperty('message');
  });

  it('message includes resolved/unresolved counts', () => {
    const caller = makeChunk('aaaa000000000001', 'main');
    const known  = makeChunk('bbbb000000000001', 'knownFn');
    const edges = [
      makeEdge('aaaa000000000001', 'knownFn'),
      makeEdge('aaaa000000000001', 'external'),
    ];
    seedIndex(tmpDir, [caller, known], edges);

    const result = latticeCallees({ chunkId: 'aaaa000000000001', deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/resolved/i);
    expect(result.message).toMatch(/unresolved/i);
  });
});
