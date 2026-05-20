/**
 * lattice-query.test.mjs — Unit tests for pforge-sdk/src/lattice-query.mjs
 *
 * All tests are pure unit tests — no filesystem I/O required.
 * Run with: npx vitest run pforge-sdk/tests/lattice-query.test.mjs
 */

import { describe, it, expect } from 'vitest';
import {
  tokenizeForSearch,
  scoreChunk,
  LatticeQueryBuilder,
} from '../src/lattice-query.mjs';

// ─── tokenizeForSearch ────────────────────────────────────────────────────────

describe('tokenizeForSearch', () => {
  it('returns a Map', () => {
    expect(tokenizeForSearch('hello world')).toBeInstanceOf(Map);
  });

  it('splits on whitespace', () => {
    const m = tokenizeForSearch('foo bar baz');
    expect(m.has('foo')).toBe(true);
    expect(m.has('bar')).toBe(true);
    expect(m.has('baz')).toBe(true);
  });

  it('lowercases all tokens', () => {
    const m = tokenizeForSearch('Hello World');
    expect(m.has('hello')).toBe(true);
    expect(m.has('world')).toBe(true);
  });

  it('splits camelCase boundaries', () => {
    const m = tokenizeForSearch('getUserById');
    expect(m.has('get')).toBe(true);
    expect(m.has('user')).toBe(true);
    expect(m.has('by')).toBe(true);
    expect(m.has('id')).toBe(true);
  });

  it('splits PascalCase boundaries', () => {
    const m = tokenizeForSearch('UserService');
    expect(m.has('user')).toBe(true);
    expect(m.has('service')).toBe(true);
  });

  it('splits on punctuation', () => {
    const m = tokenizeForSearch('src/user.mjs');
    expect(m.has('src')).toBe(true);
    expect(m.has('user')).toBe(true);
    expect(m.has('mjs')).toBe(true);
  });

  it('counts repeated tokens', () => {
    const m = tokenizeForSearch('user user user');
    expect(m.get('user')).toBe(3);
  });

  it('returns empty Map for empty string', () => {
    expect(tokenizeForSearch('').size).toBe(0);
  });

  it('returns empty Map for non-string input', () => {
    expect(tokenizeForSearch(null).size).toBe(0);
    expect(tokenizeForSearch(42).size).toBe(0);
    expect(tokenizeForSearch(undefined).size).toBe(0);
  });
});

// ─── scoreChunk ───────────────────────────────────────────────────────────────

describe('scoreChunk', () => {
  it('returns 0 for empty query', () => {
    expect(scoreChunk('', { name: 'foo', filePath: 'src/foo.mjs' })).toBe(0);
  });

  it('returns 0 for non-string query', () => {
    expect(scoreChunk(null, { name: 'foo' })).toBe(0);
    expect(scoreChunk(undefined, { name: 'foo' })).toBe(0);
  });

  it('returns a number in [0, 1]', () => {
    const s = scoreChunk('user', { name: 'getUserById', filePath: 'src/user.mjs' });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('perfect name match scores higher than zero', () => {
    const s = scoreChunk('user', { name: 'user', filePath: 'src/other.mjs' });
    expect(s).toBeGreaterThan(0);
  });

  it('no match returns 0', () => {
    const s = scoreChunk('xyzxyz', { name: 'foo', filePath: 'src/bar.mjs' });
    expect(s).toBe(0);
  });

  it('name match outweighs path match (name weighted 2×)', () => {
    const nameMatch = scoreChunk('user', { name: 'user', filePath: 'src/other.mjs' });
    const pathMatch = scoreChunk('user', { name: 'other', filePath: 'src/user.mjs' });
    // Name match is weighted 2×, so a full name match should score higher
    expect(nameMatch).toBeGreaterThan(pathMatch);
  });

  it('handles missing name and filePath gracefully', () => {
    const s = scoreChunk('user', {});
    expect(s).toBe(0);
  });

  it('camelCase query "getUserById" matches name token "user"', () => {
    const s = scoreChunk('getUserById', { name: 'user', filePath: '' });
    expect(s).toBeGreaterThan(0);
  });
});

// ─── LatticeQueryBuilder ──────────────────────────────────────────────────────

describe('LatticeQueryBuilder — constructor defaults', () => {
  it('produces default params with only limit set to 25', () => {
    const params = new LatticeQueryBuilder().build();
    expect(params.limit).toBe(25);
    expect(params.query).toBeUndefined();
    expect(params.language).toBeUndefined();
    expect(params.kind).toBeUndefined();
    expect(params.filePath).toBeUndefined();
  });
});

describe('LatticeQueryBuilder — chaining', () => {
  it('query() sets query and returns builder', () => {
    const b = new LatticeQueryBuilder();
    expect(b.query('drift')).toBe(b);
    expect(b.build().query).toBe('drift');
  });

  it('language() sets language and returns builder', () => {
    const b = new LatticeQueryBuilder();
    expect(b.language('javascript')).toBe(b);
    expect(b.build().language).toBe('javascript');
  });

  it('kind() sets kind and returns builder', () => {
    const b = new LatticeQueryBuilder();
    expect(b.kind('function')).toBe(b);
    expect(b.build().kind).toBe('function');
  });

  it('filePath() sets filePath and returns builder', () => {
    const b = new LatticeQueryBuilder();
    expect(b.filePath('src/auth')).toBe(b);
    expect(b.build().filePath).toBe('src/auth');
  });

  it('limit() sets limit and returns builder', () => {
    const b = new LatticeQueryBuilder();
    expect(b.limit(10)).toBe(b);
    expect(b.build().limit).toBe(10);
  });

  it('calling the same method twice overwrites the previous value', () => {
    const b = new LatticeQueryBuilder().query('first').query('second');
    expect(b.build().query).toBe('second');
  });

  it('chaining all methods produces full params', () => {
    const params = new LatticeQueryBuilder()
      .query('getUserById')
      .language('javascript')
      .kind('function')
      .filePath('src/auth')
      .limit(10)
      .build();

    expect(params).toEqual({
      query: 'getUserById',
      language: 'javascript',
      kind: 'function',
      filePath: 'src/auth',
      limit: 10,
    });
  });
});

describe('LatticeQueryBuilder — empty query omitted from build()', () => {
  it('empty string query is not included in params', () => {
    const params = new LatticeQueryBuilder().query('').build();
    expect(params.query).toBeUndefined();
  });
});

describe('LatticeQueryBuilder — limit() validation', () => {
  it('throws RangeError for non-integer limit', () => {
    const b = new LatticeQueryBuilder();
    expect(() => b.limit(1.5)).toThrow(RangeError);
  });

  it('throws RangeError for zero limit', () => {
    expect(() => new LatticeQueryBuilder().limit(0)).toThrow(RangeError);
  });

  it('throws RangeError for negative limit', () => {
    expect(() => new LatticeQueryBuilder().limit(-1)).toThrow(RangeError);
  });

  it('accepts limit of 1', () => {
    expect(new LatticeQueryBuilder().limit(1).build().limit).toBe(1);
  });
});

describe('LatticeQueryBuilder — describe()', () => {
  it('returns a non-empty string', () => {
    const d = new LatticeQueryBuilder().query('user').describe();
    expect(typeof d).toBe('string');
    expect(d.length).toBeGreaterThan(0);
  });

  it('includes query in description', () => {
    const d = new LatticeQueryBuilder().query('drift').describe();
    expect(d).toContain('drift');
  });

  it('includes language when set', () => {
    const d = new LatticeQueryBuilder().language('python').describe();
    expect(d).toContain('python');
  });

  it('includes kind when set', () => {
    const d = new LatticeQueryBuilder().kind('class').describe();
    expect(d).toContain('class');
  });

  it('includes filePath when set', () => {
    const d = new LatticeQueryBuilder().filePath('src/foo').describe();
    expect(d).toContain('src/foo');
  });

  it('always includes limit in description', () => {
    const d = new LatticeQueryBuilder().limit(42).describe();
    expect(d).toContain('42');
  });
});
