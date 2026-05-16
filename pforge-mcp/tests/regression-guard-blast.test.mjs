/**
 * regression-guard-blast.test.mjs — Tests for computeBlastRadius (Slice 8).
 *
 * Tests write chunk/edge fixture JSONL directly into a temp .forge/lattice/ dir
 * so they are fully independent of latticeIndex and run without tree-sitter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { computeBlastRadius } from '../forge-tools/regression-guard.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = resolve(tmpdir(), `rg-blast-test-${randomUUID()}`);
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

describe('computeBlastRadius — no Lattice index', () => {
  it('returns null when chunks.jsonl is absent', () => {
    const result = computeBlastRadius(['src/foo.js'], { deps: { cwd: tmpDir } });
    expect(result).toBeNull();
  });

  it('returns null regardless of changedFiles content when index is absent', () => {
    expect(computeBlastRadius([], { deps: { cwd: tmpDir } })).toBeNull();
    expect(computeBlastRadius(['a.js', 'b.js'], { deps: { cwd: tmpDir } })).toBeNull();
  });
});

// ─── Empty / trivial cases ────────────────────────────────────────────────────

describe('computeBlastRadius — empty inputs', () => {
  it('returns empty blast when changedFiles is empty', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')], []);
    const result = computeBlastRadius([], { deps: { cwd: tmpDir } });

    expect(result).not.toBeNull();
    expect(result.files).toEqual([]);
    expect(result.tests).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('returns empty blast when no chunks match the changed files', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')], []);
    const result = computeBlastRadius(['src/notInIndex.js'], { deps: { cwd: tmpDir } });

    expect(result.files).toEqual([]);
    expect(result.tests).toEqual([]);
  });

  it('result includes depth from options', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')], []);
    const result = computeBlastRadius([], { depth: 5, deps: { cwd: tmpDir } });
    expect(result.depth).toBe(5);
  });

  it('result defaults depth to 3 when not specified', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')], []);
    const result = computeBlastRadius(['src/foo.js'], { deps: { cwd: tmpDir } });
    expect(result.depth).toBe(3);
  });
});

// ─── Blast radius — callers of changed file ───────────────────────────────────

describe('computeBlastRadius — caller traversal', () => {
  it('includes direct callers of a changed file in the blast radius', () => {
    // app.js calls fooFn; if foo.js changes, app.js is in blast radius
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('bbbb000000000001', 'src/app.js', 'appFn'),
      ],
      [makeEdge('bbbb000000000001', 'fooFn')], // app.js → foo.js
    );
    const result = computeBlastRadius(['src/foo.js'], { deps: { cwd: tmpDir } });

    expect(result.files).toContain('src/app.js');
  });

  it('excludes the changed file itself from the blast result', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn'),
        makeChunk('bbbb000000000001', 'src/app.js', 'appFn'),
      ],
      [makeEdge('bbbb000000000001', 'fooFn')],
    );
    const result = computeBlastRadius(['src/foo.js'], { deps: { cwd: tmpDir } });

    expect(result.files).not.toContain('src/foo.js');
    expect(result.tests).not.toContain('src/foo.js');
  });

  it('includes callers across multiple changed files', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/lib1.js', 'lib1Fn'),
        makeChunk('bbbb000000000001', 'src/lib2.js', 'lib2Fn'),
        makeChunk('cccc000000000001', 'src/consumer1.js', 'c1Fn'),
        makeChunk('dddd000000000001', 'src/consumer2.js', 'c2Fn'),
      ],
      [
        makeEdge('cccc000000000001', 'lib1Fn'), // consumer1 → lib1
        makeEdge('dddd000000000001', 'lib2Fn'), // consumer2 → lib2
      ],
    );
    const result = computeBlastRadius(
      ['src/lib1.js', 'src/lib2.js'],
      { deps: { cwd: tmpDir } },
    );

    expect(result.files).toContain('src/consumer1.js');
    expect(result.files).toContain('src/consumer2.js');
  });
});

// ─── Test file separation ─────────────────────────────────────────────────────

describe('computeBlastRadius — test file separation', () => {
  it('puts *.test.mjs files in tests array, not files', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/util.js', 'utilFn'),
        makeChunk('bbbb000000000001', 'tests/util.test.mjs', 'testFn'),
      ],
      [makeEdge('bbbb000000000001', 'utilFn')], // test file calls util
    );
    const result = computeBlastRadius(['src/util.js'], { deps: { cwd: tmpDir } });

    expect(result.tests).toContain('tests/util.test.mjs');
    expect(result.files).not.toContain('tests/util.test.mjs');
  });

  it('puts *.spec.js files in tests array', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/svc.js', 'svcFn'),
        makeChunk('bbbb000000000001', 'src/svc.spec.js', 'specFn'),
      ],
      [makeEdge('bbbb000000000001', 'svcFn')],
    );
    const result = computeBlastRadius(['src/svc.js'], { deps: { cwd: tmpDir } });

    expect(result.tests).toContain('src/svc.spec.js');
    expect(result.files).not.toContain('src/svc.spec.js');
  });

  it('puts files in a tests/ directory in the tests array', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/core.js', 'coreFn'),
        makeChunk('bbbb000000000001', 'tests/core.mjs', 'testFn'),
      ],
      [makeEdge('bbbb000000000001', 'coreFn')],
    );
    const result = computeBlastRadius(['src/core.js'], { deps: { cwd: tmpDir } });

    expect(result.tests).toContain('tests/core.mjs');
    expect(result.files).not.toContain('tests/core.mjs');
  });

  it('regular source files stay in the files array', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/lib.js', 'libFn'),
        makeChunk('bbbb000000000001', 'src/consumer.js', 'consumerFn'),
      ],
      [makeEdge('bbbb000000000001', 'libFn')],
    );
    const result = computeBlastRadius(['src/lib.js'], { deps: { cwd: tmpDir } });

    expect(result.files).toContain('src/consumer.js');
    expect(result.tests).not.toContain('src/consumer.js');
  });
});

// ─── Result shape ─────────────────────────────────────────────────────────────

describe('computeBlastRadius — result shape', () => {
  it('always returns { files, tests, depth, truncated } when index exists', () => {
    seedIndex(tmpDir, [makeChunk('aaaa000000000001', 'src/foo.js', 'fooFn')], []);
    const result = computeBlastRadius(['src/foo.js'], { deps: { cwd: tmpDir } });

    expect(result).toHaveProperty('files');
    expect(result).toHaveProperty('tests');
    expect(result).toHaveProperty('depth');
    expect(result).toHaveProperty('truncated');
    expect(Array.isArray(result.files)).toBe(true);
    expect(Array.isArray(result.tests)).toBe(true);
    expect(typeof result.depth).toBe('number');
    expect(typeof result.truncated).toBe('boolean');
  });

  it('truncated is false when no traversal exceeds the limit', () => {
    seedIndex(
      tmpDir,
      [
        makeChunk('aaaa000000000001', 'src/lib.js', 'libFn'),
        makeChunk('bbbb000000000001', 'src/app.js', 'appFn'),
      ],
      [makeEdge('bbbb000000000001', 'libFn')],
    );
    const result = computeBlastRadius(['src/lib.js'], { deps: { cwd: tmpDir } });
    expect(result.truncated).toBe(false);
  });
});
