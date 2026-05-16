/**
 * lattice-blast.test.mjs — Tests for latticeBlast BFS traversal (Slice 6).
 *
 * Tests write chunk/edge fixture JSONL directly into a temp .forge/lattice/ dir so
 * they are fully independent of latticeIndex and run without tree-sitter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { latticeBlast } from '../lattice.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = resolve(tmpdir(), `lattice-blast-test-${randomUUID()}`);
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

// ─── Validation ───────────────────────────────────────────────────────────────

describe('latticeBlast — validation', () => {
  it('returns empty result with message when neither chunkId nor name is given', () => {
    const result = latticeBlast({ deps: { cwd: tmpDir } });
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.unresolvedNames).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.message).toMatch(/"chunkId"/i);
  });

  it('returns "no chunk found" when chunkId is not in the index', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'fn')], []);
    const result = latticeBlast({ chunkId: 'nonexistent', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
    expect(result.message).toMatch(/no chunk found/i);
  });

  it('returns "no chunk found" when name is not in the index', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'fn')], []);
    const result = latticeBlast({ name: 'ghost', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
    expect(result.message).toMatch(/no chunk found/i);
  });
});

// ─── Result shape ─────────────────────────────────────────────────────────────

describe('latticeBlast — result shape', () => {
  it('result has nodes, edges, unresolvedNames, total, truncated, message', () => {
    const chunk = makeChunk('aaaa000000000001', 'fn');
    seedIndex(tmpDir, [chunk], []);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', deps: { cwd: tmpDir } });
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(result).toHaveProperty('unresolvedNames');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('truncated');
    expect(result).toHaveProperty('message');
  });

  it('each node includes a numeric distance field', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const edges = [makeEdge('aaaa000000000001', 'b')];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    const nodeA = result.nodes.find((n) => n.id === 'aaaa000000000001');
    const nodeB = result.nodes.find((n) => n.id === 'bbbb000000000001');
    expect(nodeA?.distance).toBe(0);
    expect(nodeB?.distance).toBe(1);
  });

  it('seed chunk is always in nodes at distance 0', () => {
    const chunk = makeChunk('aaaa000000000001', 'root');
    seedIndex(tmpDir, [chunk], []);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', deps: { cwd: tmpDir } });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('aaaa000000000001');
    expect(result.nodes[0].distance).toBe(0);
  });
});

// ─── Empty index ──────────────────────────────────────────────────────────────

describe('latticeBlast — empty index', () => {
  it('returns empty result when index does not exist', () => {
    const result = latticeBlast({ name: 'anything', deps: { cwd: tmpDir } });
    expect(result.nodes).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.message).toMatch(/no chunk found/i);
  });
});

// ─── direction: callees ───────────────────────────────────────────────────────

describe('latticeBlast — direction: callees', () => {
  it('traverses outgoing callee edges', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const c = makeChunk('cccc000000000001', 'c');
    // a → b → c
    const edges = [
      makeEdge('aaaa000000000001', 'b'),
      makeEdge('bbbb000000000001', 'c'),
    ];
    seedIndex(tmpDir, [a, b, c], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', depth: 3, deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('aaaa000000000001');
    expect(ids).toContain('bbbb000000000001');
    expect(ids).toContain('cccc000000000001');
    expect(result.total).toBe(3);
  });

  it('does not traverse incoming caller edges in callees direction', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    // b calls a (b → a), traversing from a in callees direction should not find b
    const edges = [makeEdge('bbbb000000000001', 'a')];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('aaaa000000000001');
    expect(ids).not.toContain('bbbb000000000001');
  });

  it('stops at depth boundary', () => {
    // chain: a → b → c → d
    const chunks = [
      makeChunk('aaaa000000000001', 'a'),
      makeChunk('bbbb000000000001', 'b'),
      makeChunk('cccc000000000001', 'c'),
      makeChunk('dddd000000000001', 'd'),
    ];
    const edges = [
      makeEdge('aaaa000000000001', 'b'),
      makeEdge('bbbb000000000001', 'c'),
      makeEdge('cccc000000000001', 'd'),
    ];
    seedIndex(tmpDir, chunks, edges);

    // depth: 2 — should reach b and c but not d
    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', depth: 2, deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('aaaa000000000001');
    expect(ids).toContain('bbbb000000000001');
    expect(ids).toContain('cccc000000000001');
    expect(ids).not.toContain('dddd000000000001');
  });
});

// ─── direction: callers ───────────────────────────────────────────────────────

describe('latticeBlast — direction: callers', () => {
  it('traverses incoming caller edges', () => {
    const caller = makeChunk('aaaa000000000001', 'caller');
    const target = makeChunk('bbbb000000000001', 'target');
    const edges = [makeEdge('aaaa000000000001', 'target')];
    seedIndex(tmpDir, [caller, target], edges);

    const result = latticeBlast({ chunkId: 'bbbb000000000001', direction: 'callers', deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('bbbb000000000001');
    expect(ids).toContain('aaaa000000000001');
    expect(result.total).toBe(2);
  });

  it('does not traverse outgoing callee edges in callers direction', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    // a calls b — from a in callers direction, should not find b
    const edges = [makeEdge('aaaa000000000001', 'b')];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callers', deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('aaaa000000000001');
    expect(ids).not.toContain('bbbb000000000001');
  });

  it('traverses caller chain to given depth', () => {
    // c ← b ← a   (a calls b, b calls c — from c, callers direction finds b then a)
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const c = makeChunk('cccc000000000001', 'c');
    const edges = [
      makeEdge('aaaa000000000001', 'b'),
      makeEdge('bbbb000000000001', 'c'),
    ];
    seedIndex(tmpDir, [a, b, c], edges);

    const result = latticeBlast({ chunkId: 'cccc000000000001', direction: 'callers', depth: 3, deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('cccc000000000001');
    expect(ids).toContain('bbbb000000000001');
    expect(ids).toContain('aaaa000000000001');
  });
});

// ─── direction: both ──────────────────────────────────────────────────────────

describe('latticeBlast — direction: both', () => {
  it('traverses both callee and caller edges from seed', () => {
    const upstream = makeChunk('aaaa000000000001', 'upstream');
    const seed     = makeChunk('bbbb000000000001', 'seed');
    const downstream = makeChunk('cccc000000000001', 'downstream');
    // upstream calls seed; seed calls downstream
    const edges = [
      makeEdge('aaaa000000000001', 'seed'),
      makeEdge('bbbb000000000001', 'downstream'),
    ];
    seedIndex(tmpDir, [upstream, seed, downstream], edges);

    const result = latticeBlast({ chunkId: 'bbbb000000000001', direction: 'both', depth: 1, deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('bbbb000000000001'); // seed
    expect(ids).toContain('aaaa000000000001'); // caller
    expect(ids).toContain('cccc000000000001'); // callee
    expect(result.total).toBe(3);
  });

  it('default direction is both', () => {
    const upstream = makeChunk('aaaa000000000001', 'upstream');
    const seed     = makeChunk('bbbb000000000001', 'seed');
    const downstream = makeChunk('cccc000000000001', 'downstream');
    const edges = [
      makeEdge('aaaa000000000001', 'seed'),
      makeEdge('bbbb000000000001', 'downstream'),
    ];
    seedIndex(tmpDir, [upstream, seed, downstream], edges);

    const result = latticeBlast({ chunkId: 'bbbb000000000001', deps: { cwd: tmpDir } });
    expect(result.nodes.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Seed by name ─────────────────────────────────────────────────────────────

describe('latticeBlast — seed by name', () => {
  it('resolves seed by name and traverses its callees', () => {
    const a = makeChunk('aaaa000000000001', 'processRequest');
    const b = makeChunk('bbbb000000000001', 'validate');
    const edges = [makeEdge('aaaa000000000001', 'validate')];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ name: 'processRequest', direction: 'callees', deps: { cwd: tmpDir } });
    const ids = result.nodes.map((n) => n.id);
    expect(ids).toContain('aaaa000000000001');
    expect(ids).toContain('bbbb000000000001');
  });

  it('enqueues all chunks sharing a name as seed nodes', () => {
    // Two files both have a 'render' function — both should be seed distance 0
    const r1 = makeChunk('aaaa000000000001', 'render', { filePath: 'a.js' });
    const r2 = makeChunk('aaaa000000000002', 'render', { filePath: 'b.js' });
    const child = makeChunk('bbbb000000000001', 'child');
    const edges = [makeEdge('aaaa000000000001', 'child')];
    seedIndex(tmpDir, [r1, r2, child], edges);

    const result = latticeBlast({ name: 'render', direction: 'callees', deps: { cwd: tmpDir } });
    const seeds = result.nodes.filter((n) => n.distance === 0);
    expect(seeds.map((n) => n.id)).toContain('aaaa000000000001');
    expect(seeds.map((n) => n.id)).toContain('aaaa000000000002');
  });
});

// ─── Cycle handling ───────────────────────────────────────────────────────────

describe('latticeBlast — cycle handling', () => {
  it('does not enter an infinite loop on cyclic call graphs', () => {
    // a → b → a (mutual recursion)
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const edges = [
      makeEdge('aaaa000000000001', 'b'),
      makeEdge('bbbb000000000001', 'a'),
    ];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', depth: 10, deps: { cwd: tmpDir } });
    // Should terminate and return exactly both nodes, each visited once
    expect(result.nodes).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('self-referential chunk does not cause infinite loop', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const edges = [makeEdge('aaaa000000000001', 'a')]; // self-loop
    seedIndex(tmpDir, [a], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', depth: 5, deps: { cwd: tmpDir } });
    expect(result.nodes).toHaveLength(1);
  });
});

// ─── Unresolved names ─────────────────────────────────────────────────────────

describe('latticeBlast — unresolvedNames', () => {
  it('captures callee names not found in the index', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const edges = [makeEdge('aaaa000000000001', 'externalLib')];
    seedIndex(tmpDir, [a], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    expect(result.unresolvedNames).toContain('externalLib');
  });

  it('does not include unresolved names as graph nodes', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const edges = [makeEdge('aaaa000000000001', 'unknownFn')];
    seedIndex(tmpDir, [a], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    expect(result.nodes.every((n) => n.name !== 'unknownFn')).toBe(true);
    // total counts graph nodes, not unresolved
    expect(result.total).toBe(1);
  });

  it('unresolvedNames is empty when all callees resolve', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const edges = [makeEdge('aaaa000000000001', 'b')];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    expect(result.unresolvedNames).toHaveLength(0);
  });
});

// ─── Traversed edges ─────────────────────────────────────────────────────────

describe('latticeBlast — edges', () => {
  it('returned edges connect real node ids', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const edges = [makeEdge('aaaa000000000001', 'b')];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ from: 'aaaa000000000001', to: 'bbbb000000000001' });
  });

  it('deduplicates edges when the same connection is traversed multiple times', () => {
    // Two paths from a to c: a→b→c and a→c
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const c = makeChunk('cccc000000000001', 'c');
    const edges = [
      makeEdge('aaaa000000000001', 'b'),
      makeEdge('aaaa000000000001', 'c'),
      makeEdge('bbbb000000000001', 'c'),
    ];
    seedIndex(tmpDir, [a, b, c], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', depth: 2, deps: { cwd: tmpDir } });
    const edgeKeys = result.edges.map((e) => `${e.from}→${e.to}`);
    // No duplicate edge keys
    expect(edgeKeys.length).toBe(new Set(edgeKeys).size);
  });
});

// ─── Limit + truncation ───────────────────────────────────────────────────────

describe('latticeBlast — limit', () => {
  it('respects the limit parameter', () => {
    // Build a star graph: seed calls 20 children
    const seed = makeChunk('seed000000000001', 'seed');
    const children = Array.from({ length: 20 }, (_, i) =>
      makeChunk(`child${String(i).padStart(11, '0')}`, `child${i}`),
    );
    const edges = children.map((c) => makeEdge('seed000000000001', c.name));
    seedIndex(tmpDir, [seed, ...children], edges);

    const result = latticeBlast({ chunkId: 'seed000000000001', direction: 'callees', limit: 5, deps: { cwd: tmpDir } });
    expect(result.nodes).toHaveLength(5);
    expect(result.total).toBe(21); // seed + 20 children
    expect(result.truncated).toBe(true);
  });

  it('truncated is false when all nodes fit within limit', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const edges = [makeEdge('aaaa000000000001', 'b')];
    seedIndex(tmpDir, [a, b], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', limit: 50, deps: { cwd: tmpDir } });
    expect(result.truncated).toBe(false);
    expect(result.nodes).toHaveLength(2);
  });

  it('message mentions limit when results are truncated', () => {
    const seed = makeChunk('seed000000000001', 'seed');
    const children = Array.from({ length: 10 }, (_, i) =>
      makeChunk(`child${String(i).padStart(11, '0')}`, `child${i}`),
    );
    const edges = children.map((c) => makeEdge('seed000000000001', c.name));
    seedIndex(tmpDir, [seed, ...children], edges);

    const result = latticeBlast({ chunkId: 'seed000000000001', direction: 'callees', limit: 3, deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/3/);
  });
});

// ─── Message field ────────────────────────────────────────────────────────────

describe('latticeBlast — message field', () => {
  it('message includes node count when traversal succeeds', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    seedIndex(tmpDir, [a, b], [makeEdge('aaaa000000000001', 'b')]);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/2/);
  });

  it('message includes direction', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    seedIndex(tmpDir, [a], []);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/callees/i);
  });

  it('message includes depth', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    seedIndex(tmpDir, [a], []);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', depth: 7, deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/7/);
  });

  it('message mentions missing neighbors when seed is isolated', () => {
    const a = makeChunk('aaaa000000000001', 'a');
    seedIndex(tmpDir, [a], []);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', depth: 3, deps: { cwd: tmpDir } });
    // No callees — message should indicate no neighbors
    expect(result.message.toLowerCase()).toMatch(/no.*neighbor|traversed 1 node/);
  });
});

// ─── Node ordering ────────────────────────────────────────────────────────────

describe('latticeBlast — node ordering', () => {
  it('nodes are ordered by ascending distance (BFS level)', () => {
    // a → b → c  (chain)
    const a = makeChunk('aaaa000000000001', 'a');
    const b = makeChunk('bbbb000000000001', 'b');
    const c = makeChunk('cccc000000000001', 'c');
    const edges = [
      makeEdge('aaaa000000000001', 'b'),
      makeEdge('bbbb000000000001', 'c'),
    ];
    seedIndex(tmpDir, [a, b, c], edges);

    const result = latticeBlast({ chunkId: 'aaaa000000000001', direction: 'callees', depth: 3, deps: { cwd: tmpDir } });
    const distances = result.nodes.map((n) => n.distance);
    // Distances must be non-decreasing
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
    }
  });
});
