/**
 * lattice-query.test.mjs — Tests for latticeQuery (Slice 5).
 *
 * Tests write chunk fixture JSONL directly into a temp .forge/lattice/ dir so
 * they are fully independent of latticeIndex and run without tree-sitter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { latticeQuery, scoreChunk, tokenizeForSearch } from '../lattice.mjs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempDir() {
  const dir = resolve(tmpdir(), `lattice-query-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Write chunk + edge JSONL fixtures directly into the lattice dir. */
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

function makeChunk(overrides = {}) {
  return {
    id: randomUUID().replace(/-/g, '').slice(0, 16),
    filePath: 'src/foo.js',
    language: 'js',
    kind: 'function',
    name: 'foo',
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

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => { tmpDir = makeTempDir(); });
afterEach(() => { cleanup(tmpDir); });

// ─── Empty index ──────────────────────────────────────────────────────────────

describe('latticeQuery — empty index', () => {
  it('returns empty chunks when index does not exist', () => {
    const result = latticeQuery({ deps: { cwd: tmpDir } });
    expect(result.chunks).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('message suggests running latticeIndex when no results', () => {
    const result = latticeQuery({ query: 'anything', deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/latticeIndex/i);
  });
});

// ─── Empty query returns all chunks ──────────────────────────────────────────

describe('latticeQuery — no filter returns all chunks', () => {
  it('returns all chunks when query is empty', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', name: 'alpha', filePath: 'a.js' }),
      makeChunk({ id: '0000000000000002', name: 'beta',  filePath: 'b.js' }),
      makeChunk({ id: '0000000000000003', name: 'gamma', filePath: 'c.js' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ query: '', deps: { cwd: tmpDir } });
    expect(result.chunks).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('has the expected shape: chunks, total, truncated, message', () => {
    seedIndex(tmpDir, [makeChunk()]);
    const result = latticeQuery({ deps: { cwd: tmpDir } });
    expect(result).toHaveProperty('chunks');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('truncated');
    expect(result).toHaveProperty('message');
  });
});

// ─── Query string filtering ───────────────────────────────────────────────────

describe('latticeQuery — query string', () => {
  it('finds chunks whose name contains the query substring', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', name: 'getUserById' }),
      makeChunk({ id: '0000000000000002', name: 'createUser' }),
      makeChunk({ id: '0000000000000003', name: 'deletePost' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ query: 'user', deps: { cwd: tmpDir } });
    expect(result.total).toBe(2);
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain('getUserById');
    expect(names).toContain('createUser');
    expect(names).not.toContain('deletePost');
  });

  it('is case-insensitive', () => {
    seedIndex(tmpDir, [makeChunk({ id: '0000000000000001', name: 'getUserById' })]);
    const result = latticeQuery({ query: 'GETUSER', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
  });

  it('finds chunks whose filePath contains the query substring', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', name: 'fn1', filePath: 'src/auth/login.js' }),
      makeChunk({ id: '0000000000000002', name: 'fn2', filePath: 'src/users/profile.js' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ query: 'auth', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].filePath).toBe('src/auth/login.js');
  });

  it('returns empty with descriptive message when no name/filePath match', () => {
    seedIndex(tmpDir, [makeChunk({ name: 'alpha' })]);
    const result = latticeQuery({ query: 'zzznomatch', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
    expect(result.chunks).toHaveLength(0);
    expect(result.message).toContain('zzznomatch');
  });
});

// ─── Language filter ──────────────────────────────────────────────────────────

describe('latticeQuery — language filter', () => {
  it('returns only chunks with the given language', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', language: 'js' }),
      makeChunk({ id: '0000000000000002', language: 'py' }),
      makeChunk({ id: '0000000000000003', language: 'ts' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ language: 'py', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].language).toBe('py');
  });

  it('returns empty when no chunks match the language', () => {
    seedIndex(tmpDir, [makeChunk({ language: 'js' })]);
    const result = latticeQuery({ language: 'sql', deps: { cwd: tmpDir } });
    expect(result.total).toBe(0);
  });
});

// ─── Kind filter ──────────────────────────────────────────────────────────────

describe('latticeQuery — kind filter', () => {
  it('returns only chunks with the given kind', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', kind: 'function' }),
      makeChunk({ id: '0000000000000002', kind: 'class' }),
      makeChunk({ id: '0000000000000003', kind: 'function' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ kind: 'class', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].kind).toBe('class');
  });
});

// ─── filePath filter ──────────────────────────────────────────────────────────

describe('latticeQuery — filePath filter', () => {
  it('returns only chunks whose filePath contains the filter string', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', filePath: 'src/auth/token.js' }),
      makeChunk({ id: '0000000000000002', filePath: 'src/users/model.js' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ filePath: 'auth', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].filePath).toBe('src/auth/token.js');
  });

  it('is case-insensitive for filePath filter', () => {
    seedIndex(tmpDir, [makeChunk({ id: '0000000000000001', filePath: 'src/Auth/token.js' })]);
    const result = latticeQuery({ filePath: 'auth', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
  });
});

// ─── Combined filters ─────────────────────────────────────────────────────────

describe('latticeQuery — combined filters', () => {
  it('ANDs all filters together', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', name: 'parseToken', language: 'js', kind: 'function', filePath: 'auth.js' }),
      makeChunk({ id: '0000000000000002', name: 'parseToken', language: 'py', kind: 'function', filePath: 'auth.py' }),
      makeChunk({ id: '0000000000000003', name: 'buildToken', language: 'js', kind: 'function', filePath: 'auth.js' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ query: 'parse', language: 'js', kind: 'function', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].language).toBe('js');
    expect(result.chunks[0].name).toBe('parseToken');
  });
});

// ─── Limit + truncation ───────────────────────────────────────────────────────

describe('latticeQuery — limit', () => {
  it('respects the limit parameter', () => {
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk({ id: String(i).padStart(16, '0'), name: `fn${i}` }),
    );
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ limit: 3, deps: { cwd: tmpDir } });
    expect(result.chunks).toHaveLength(3);
    expect(result.total).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('truncated is false when results fit within limit', () => {
    seedIndex(tmpDir, [makeChunk(), makeChunk({ id: '0000000000000002', name: 'bar' })]);
    const result = latticeQuery({ limit: 25, deps: { cwd: tmpDir } });
    expect(result.truncated).toBe(false);
    expect(result.chunks).toHaveLength(2);
  });

  it('message mentions limit when results are truncated', () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk({ id: String(i).padStart(16, '0'), name: `fn${i}` }),
    );
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ limit: 2, deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/2/);
  });
});

// ─── message field ────────────────────────────────────────────────────────────

describe('latticeQuery — message field', () => {
  it('message includes the found count when results exist', () => {
    const chunks = [makeChunk(), makeChunk({ id: '0000000000000002', name: 'bar' })];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ deps: { cwd: tmpDir } });
    expect(result.message).toMatch(/2/);
  });

  it('message mentions the query when no results found', () => {
    seedIndex(tmpDir, [makeChunk({ name: 'alpha' })]);
    const result = latticeQuery({ query: 'omega', deps: { cwd: tmpDir } });
    expect(result.message).toContain('omega');
  });
});

// ─── tokenizeForSearch ────────────────────────────────────────────────────────

describe('tokenizeForSearch', () => {
  it('returns empty map for empty input', () => {
    expect(tokenizeForSearch('').size).toBe(0);
    expect(tokenizeForSearch(null).size).toBe(0);
  });

  it('splits camelCase identifiers into component words', () => {
    const tokens = tokenizeForSearch('getUserById');
    expect(tokens.has('get')).toBe(true);
    expect(tokens.has('user')).toBe(true);
    expect(tokens.has('by')).toBe(true);
    expect(tokens.has('id')).toBe(true);
  });

  it('splits PascalCase identifiers', () => {
    const tokens = tokenizeForSearch('UserService');
    expect(tokens.has('user')).toBe(true);
    expect(tokens.has('service')).toBe(true);
  });

  it('splits acronym-prefixed names like XMLParser', () => {
    const tokens = tokenizeForSearch('XMLParser');
    expect(tokens.has('xml')).toBe(true);
    expect(tokens.has('parser')).toBe(true);
  });

  it('splits file paths on slashes and dots', () => {
    const tokens = tokenizeForSearch('src/auth/login.js');
    expect(tokens.has('src')).toBe(true);
    expect(tokens.has('auth')).toBe(true);
    expect(tokens.has('login')).toBe(true);
    expect(tokens.has('js')).toBe(true);
  });

  it('is case-insensitive (all lowercase output)', () => {
    const tokens = tokenizeForSearch('GetUserByID');
    for (const k of tokens.keys()) expect(k).toBe(k.toLowerCase());
  });
});

// ─── scoreChunk ───────────────────────────────────────────────────────────────

describe('scoreChunk', () => {
  it('returns 0 for empty query', () => {
    expect(scoreChunk('', { name: 'getUserById', filePath: 'auth.js' })).toBe(0);
    expect(scoreChunk(null, { name: 'getUserById' })).toBe(0);
  });

  it('returns 0 when no query tokens match the chunk', () => {
    const score = scoreChunk('unrelated', { name: 'deletePost', filePath: 'posts.js' });
    expect(score).toBe(0);
  });

  it('returns >0 when chunk name contains a query token', () => {
    const score = scoreChunk('user', { name: 'getUserById', filePath: 'user.js' });
    expect(score).toBeGreaterThan(0);
  });

  it('returns higher score for exact name match than partial path match', () => {
    const nameMatch = scoreChunk('auth', { name: 'getUserAuth', filePath: 'src/middleware.js' });
    const pathOnly = scoreChunk('auth', { name: 'buildRequest', filePath: 'src/auth/config.js' });
    expect(nameMatch).toBeGreaterThan(pathOnly);
  });

  it('returns value in [0, 1]', () => {
    const score = scoreChunk('user', { name: 'user', filePath: 'user.js' });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('handles chunks without name or filePath gracefully', () => {
    expect(() => scoreChunk('user', {})).not.toThrow();
    expect(scoreChunk('user', {})).toBe(0);
  });
});

// ─── latticeQuery — scoring and ranking ──────────────────────────────────────

describe('latticeQuery — scoring and ranking', () => {
  it('adds a score field to each chunk when query is provided', () => {
    seedIndex(tmpDir, [makeChunk({ name: 'getUserById' })]);
    const result = latticeQuery({ query: 'user', deps: { cwd: tmpDir } });
    expect(result.chunks[0]).toHaveProperty('score');
    expect(typeof result.chunks[0].score).toBe('number');
  });

  it('ranks more-relevant chunks before less-relevant chunks', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', name: 'unrelated',   filePath: 'src/users/profile.js' }),
      makeChunk({ id: '0000000000000002', name: 'getUserById', filePath: 'src/other.js' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ query: 'user', deps: { cwd: tmpDir } });
    expect(result.chunks).toHaveLength(2);
    // The chunk with "user" in its name should rank first
    expect(result.chunks[0].name).toBe('getUserById');
  });

  it('does not add score field when no query is provided', () => {
    seedIndex(tmpDir, [makeChunk({ name: 'alpha' })]);
    const result = latticeQuery({ deps: { cwd: tmpDir } });
    expect(result.chunks[0]).not.toHaveProperty('score');
  });

  it('returns chunks sorted by score descending', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', name: 'logEvent',       filePath: 'logger.js' }),
      makeChunk({ id: '0000000000000002', name: 'getUserAuth',    filePath: 'auth.js' }),
      makeChunk({ id: '0000000000000003', name: 'authenticate',   filePath: 'auth.js' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ query: 'auth', deps: { cwd: tmpDir } });
    // authenticate and getUserAuth should rank above logEvent
    const scores = result.chunks.map((c) => c.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });

  it('preserves existing filter behavior alongside scoring', () => {
    const chunks = [
      makeChunk({ id: '0000000000000001', name: 'getUser', language: 'js' }),
      makeChunk({ id: '0000000000000002', name: 'getUser', language: 'py' }),
    ];
    seedIndex(tmpDir, chunks);

    const result = latticeQuery({ query: 'user', language: 'js', deps: { cwd: tmpDir } });
    expect(result.total).toBe(1);
    expect(result.chunks[0].language).toBe('js');
  });
});
