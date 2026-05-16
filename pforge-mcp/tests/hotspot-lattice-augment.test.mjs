/**
 * hotspot-lattice-augment.test.mjs — Tests for augmentHotspots (Slice 8).
 *
 * Tests write chunk/edge fixture JSONL directly into a temp .forge/lattice/ dir
 * so they are fully independent of latticeIndex and run without tree-sitter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { augmentHotspots } from '../forge-tools/hotspot.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = resolve(tmpdir(), `hotspot-aug-test-${randomUUID()}`);
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

function makeChunk(id, filePath, name, overrides = {}) {
  return {
    id,
    filePath,
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

// ─── No Lattice index ─────────────────────────────────────────────────────────

describe('augmentHotspots — no Lattice index', () => {
  it('returns hotspots unchanged when chunks.jsonl is absent', () => {
    const hotspots = [{ file: 'src/foo.js', commits: 42 }];
    const result = augmentHotspots(hotspots, { deps: { cwd: tmpDir } });

    expect(result).toEqual(hotspots);
    expect(result[0]).not.toHaveProperty('callerCount');
    expect(result[0]).not.toHaveProperty('calleeCount');
    expect(result[0]).not.toHaveProperty('inBlastOf');
  });

  it('returns an empty array unchanged when hotspots is empty', () => {
    const result = augmentHotspots([], { deps: { cwd: tmpDir } });
    expect(result).toEqual([]);
  });

  it('returns original array reference when index is absent and input is non-empty', () => {
    const hotspots = [{ file: 'src/a.js', commits: 5 }, { file: 'src/b.js', commits: 3 }];
    const result = augmentHotspots(hotspots, { deps: { cwd: tmpDir } });
    expect(result).toStrictEqual(hotspots);
  });
});

// ─── With Lattice index — shape ───────────────────────────────────────────────

describe('augmentHotspots — adds Lattice fields', () => {
  it('adds callerCount, calleeCount, inBlastOf to each entry when index exists', () => {
    seedIndex(
      tmpDir,
      [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')],
      [],
    );
    const hotspots = [{ file: 'src/foo.js', commits: 10 }];
    const result = augmentHotspots(hotspots, { deps: { cwd: tmpDir } });

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('callerCount');
    expect(result[0]).toHaveProperty('calleeCount');
    expect(result[0]).toHaveProperty('inBlastOf');
    expect(result[0].commits).toBe(10); // original field preserved
  });

  it('preserves all original hotspot fields alongside Lattice fields', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/x.js', 'xFn')], []);
    const hotspots = [{ file: 'src/x.js', commits: 7, since: '6 months ago' }];
    const result = augmentHotspots(hotspots, { deps: { cwd: tmpDir } });

    expect(result[0].file).toBe('src/x.js');
    expect(result[0].commits).toBe(7);
    expect(result[0].since).toBe('6 months ago');
  });

  it('callerCount is 0 when no external chunks call into this file', () => {
    seedIndex(
      tmpDir,
      [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')],
      [],
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 5 }], { deps: { cwd: tmpDir } });
    expect(result[0].callerCount).toBe(0);
  });

  it('calleeCount is 0 when file calls no external chunks', () => {
    seedIndex(
      tmpDir,
      [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')],
      [],
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 5 }], { deps: { cwd: tmpDir } });
    expect(result[0].calleeCount).toBe(0);
  });

  it('inBlastOf is an empty array when file has no outgoing cross-file edges', () => {
    seedIndex(
      tmpDir,
      [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')],
      [],
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 5 }], { deps: { cwd: tmpDir } });
    expect(result[0].inBlastOf).toEqual([]);
  });
});

// ─── With Lattice index — callerCount ────────────────────────────────────────

describe('augmentHotspots — callerCount', () => {
  it('counts distinct external files that call into the hotspot file', () => {
    // bar.js calls fooFn which lives in foo.js
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('bbbb000000000001', 'src/bar.js', 'barFn'),
      ],
      [makeEdge('bbbb000000000001', 'fooFn')],
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 3 }], { deps: { cwd: tmpDir } });
    expect(result[0].callerCount).toBe(1); // bar.js calls foo.js
  });

  it('counts each distinct caller file only once even with multiple edges', () => {
    // bar.js has two chunks both calling fooFn
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('bbbb000000000001', 'src/bar.js', 'barFn1'),
        makeChunk('bbbb000000000002', 'src/bar.js', 'barFn2'),
      ],
      [
        makeEdge('bbbb000000000001', 'fooFn'),
        makeEdge('bbbb000000000002', 'fooFn'),
      ],
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 3 }], { deps: { cwd: tmpDir } });
    expect(result[0].callerCount).toBe(1); // bar.js once (two edges, same file)
  });

  it('counts multiple distinct caller files separately', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('bbbb000000000001', 'src/bar.js', 'barFn'),
        makeChunk('cccc000000000001', 'src/baz.js', 'bazFn'),
      ],
      [
        makeEdge('bbbb000000000001', 'fooFn'),
        makeEdge('cccc000000000001', 'fooFn'),
      ],
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 3 }], { deps: { cwd: tmpDir } });
    expect(result[0].callerCount).toBe(2); // bar.js and baz.js
  });

  it('does not count self-referential edges in callerCount', () => {
    // foo.js calling itself should not count as an external caller
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('aaaa000000000002', 'src/foo.js', 'fooHelper'),
      ],
      [makeEdge('aaaa000000000002', 'fooFn')], // both in foo.js — self-call
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 5 }], { deps: { cwd: tmpDir } });
    expect(result[0].callerCount).toBe(0);
  });
});

// ─── With Lattice index — calleeCount ────────────────────────────────────────

describe('augmentHotspots — calleeCount', () => {
  it('counts distinct external files that this file calls into', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('bbbb000000000001', 'src/util.js', 'utilFn'),
      ],
      [makeEdge('aaaa000000000001', 'utilFn')], // foo.js calls util.js
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 5 }], { deps: { cwd: tmpDir } });
    expect(result[0].calleeCount).toBe(1); // util.js
  });

  it('does not count self-referential edges in calleeCount', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('aaaa000000000002', 'src/foo.js', 'fooHelper'),
      ],
      [makeEdge('aaaa000000000001', 'fooHelper')], // self-call within foo.js
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 5 }], { deps: { cwd: tmpDir } });
    expect(result[0].calleeCount).toBe(0);
  });
});

// ─── With Lattice index — inBlastOf ──────────────────────────────────────────

describe('augmentHotspots — inBlastOf', () => {
  it('lists external files that this hotspot calls into', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/app.js', 'appFn'),
        makeChunk('bbbb000000000001', 'src/lib.js', 'libFn'),
      ],
      [makeEdge('aaaa000000000001', 'libFn')], // app.js → lib.js
    );
    const result = augmentHotspots([{ file: 'src/app.js', commits: 8 }], { deps: { cwd: tmpDir } });
    expect(result[0].inBlastOf).toContain('src/lib.js');
  });

  it('does not include the hotspot file itself in inBlastOf', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('aaaa000000000002', 'src/foo.js', 'fooHelper'),
      ],
      [makeEdge('aaaa000000000001', 'fooHelper')],
    );
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 5 }], { deps: { cwd: tmpDir } });
    expect(result[0].inBlastOf).not.toContain('src/foo.js');
  });

  it('inBlastOf is an array', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')], []);
    const result = augmentHotspots([{ file: 'src/foo.js', commits: 1 }], { deps: { cwd: tmpDir } });
    expect(Array.isArray(result[0].inBlastOf)).toBe(true);
  });
});

// ─── Multiple hotspot entries ─────────────────────────────────────────────────

describe('augmentHotspots — multiple entries', () => {
  it('augments all hotspot entries independently', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/a.js', 'aFn'),
        makeChunk('bbbb000000000001', 'src/b.js', 'bFn'),
      ],
      [makeEdge('aaaa000000000001', 'bFn')], // a.js → b.js
    );
    const hotspots = [
      { file: 'src/a.js', commits: 10 },
      { file: 'src/b.js', commits: 7 },
    ];
    const result = augmentHotspots(hotspots, { deps: { cwd: tmpDir } });

    expect(result).toHaveLength(2);
    expect(result[0].calleeCount).toBe(1); // a.js calls b.js
    expect(result[0].callerCount).toBe(0);
    expect(result[1].callerCount).toBe(1); // b.js is called by a.js
    expect(result[1].calleeCount).toBe(0);
  });

  it('files not in the lattice index get zero counts and empty inBlastOf', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/a.js', 'aFn')], []);
    const hotspots = [
      { file: 'src/a.js', commits: 5 },
      { file: 'src/unknown.js', commits: 3 }, // not in index
    ];
    const result = augmentHotspots(hotspots, { deps: { cwd: tmpDir } });

    expect(result[1].callerCount).toBe(0);
    expect(result[1].calleeCount).toBe(0);
    expect(result[1].inBlastOf).toEqual([]);
  });
});
