/**
 * chunker.test.mjs — Contract tests for pforge-sdk/src/chunker.mjs
 *
 * Covers validateChunk() and chunkerCapability() exhaustively.
 */

import { describe, it, expect } from 'vitest';
import { validateChunk, chunkerCapability, CHUNK_KINDS } from '../src/chunker.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_HASH = 'sha256:' + 'a'.repeat(64);

/** A fully-valid chunk record. Individual tests override one field at a time. */
function validRecord(overrides = {}) {
  return {
    filePath: 'src/foo.mjs',
    language: 'js',
    kind: 'function',
    name: 'myFunc',
    startByte: 0,
    endByte: 100,
    startLine: 1,
    endLine: 10,
    contentHash: VALID_HASH,
    declares: ['myFunc'],
    references: ['helperA', 'helperB'],
    ...overrides,
  };
}

// ─── validateChunk ────────────────────────────────────────────────────────────

describe('validateChunk — happy path', () => {
  it('returns { ok: true } for a fully-valid record', () => {
    expect(validateChunk(validRecord())).toEqual({ ok: true });
  });

  it('accepts every valid kind', () => {
    for (const kind of CHUNK_KINDS) {
      expect(validateChunk(validRecord({ kind }))).toEqual({ ok: true });
    }
  });

  it('accepts startByte === endByte (zero-length chunk)', () => {
    expect(validateChunk(validRecord({ startByte: 50, endByte: 50 }))).toEqual({ ok: true });
  });

  it('accepts startLine === endLine (single-line chunk)', () => {
    expect(validateChunk(validRecord({ startLine: 5, endLine: 5 }))).toEqual({ ok: true });
  });

  it('accepts an empty name string (file-kind)', () => {
    expect(validateChunk(validRecord({ kind: 'file', name: '' }))).toEqual({ ok: true });
  });

  it('accepts empty declares and references arrays', () => {
    expect(validateChunk(validRecord({ declares: [], references: [] }))).toEqual({ ok: true });
  });

  it('accepts startByte === 0', () => {
    expect(validateChunk(validRecord({ startByte: 0, endByte: 0 }))).toEqual({ ok: true });
  });
});

describe('validateChunk — invalid record type', () => {
  it.each([null, undefined, 42, 'string', [1, 2], true])(
    'rejects non-object: %s',
    (input) => {
      const result = validateChunk(input);
      expect(result.ok).toBe(false);
      expect(result.errors[0].code).toBe('ERR_CHUNK_INVALID_RECORD');
    },
  );
});

describe('validateChunk — filePath', () => {
  it('rejects missing filePath', () => {
    const { filePath: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_MISSING_FILE_PATH')).toBe(true);
  });

  it('rejects empty filePath', () => {
    const result = validateChunk(validRecord({ filePath: '' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_MISSING_FILE_PATH')).toBe(true);
  });

  it('rejects numeric filePath', () => {
    const result = validateChunk(validRecord({ filePath: 42 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_MISSING_FILE_PATH')).toBe(true);
  });
});

describe('validateChunk — language', () => {
  it('rejects missing language', () => {
    const { language: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_MISSING_LANGUAGE')).toBe(true);
  });

  it('rejects empty language string', () => {
    const result = validateChunk(validRecord({ language: '' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_MISSING_LANGUAGE')).toBe(true);
  });
});

describe('validateChunk — kind', () => {
  it('rejects missing kind', () => {
    const { kind: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_KIND')).toBe(true);
  });

  it('rejects unknown kind value', () => {
    const result = validateChunk(validRecord({ kind: 'namespace' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_KIND')).toBe(true);
  });

  it('rejects numeric kind', () => {
    const result = validateChunk(validRecord({ kind: 1 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_KIND')).toBe(true);
  });
});

describe('validateChunk — name', () => {
  it('rejects missing name', () => {
    const { name: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_MISSING_NAME')).toBe(true);
  });

  it('rejects numeric name', () => {
    const result = validateChunk(validRecord({ name: 99 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_MISSING_NAME')).toBe(true);
  });
});

describe('validateChunk — startByte / endByte', () => {
  it('rejects negative startByte', () => {
    const result = validateChunk(validRecord({ startByte: -1 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_START_BYTE')).toBe(true);
  });

  it('rejects float startByte', () => {
    const result = validateChunk(validRecord({ startByte: 1.5 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_START_BYTE')).toBe(true);
  });

  it('rejects missing startByte', () => {
    const { startByte: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_START_BYTE')).toBe(true);
  });

  it('rejects negative endByte', () => {
    const result = validateChunk(validRecord({ endByte: -5 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_END_BYTE')).toBe(true);
  });

  it('rejects endByte < startByte', () => {
    const result = validateChunk(validRecord({ startByte: 50, endByte: 10 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_BYTE_RANGE')).toBe(true);
  });
});

describe('validateChunk — startLine / endLine', () => {
  it('rejects startLine === 0 (must be 1-indexed)', () => {
    const result = validateChunk(validRecord({ startLine: 0 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_START_LINE')).toBe(true);
  });

  it('rejects negative startLine', () => {
    const result = validateChunk(validRecord({ startLine: -3 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_START_LINE')).toBe(true);
  });

  it('rejects missing startLine', () => {
    const { startLine: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_START_LINE')).toBe(true);
  });

  it('rejects endLine < startLine', () => {
    const result = validateChunk(validRecord({ startLine: 10, endLine: 5 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_LINE_RANGE')).toBe(true);
  });

  it('rejects endLine === 0', () => {
    const result = validateChunk(validRecord({ endLine: 0 }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_END_LINE')).toBe(true);
  });
});

describe('validateChunk — contentHash', () => {
  it('rejects missing contentHash', () => {
    const { contentHash: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_CONTENT_HASH')).toBe(true);
  });

  it('rejects wrong hash prefix', () => {
    const result = validateChunk(validRecord({ contentHash: 'md5:' + 'a'.repeat(32) }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_CONTENT_HASH')).toBe(true);
  });

  it('rejects hash with too few hex chars', () => {
    const result = validateChunk(validRecord({ contentHash: 'sha256:' + 'a'.repeat(63) }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_CONTENT_HASH')).toBe(true);
  });

  it('rejects hash with uppercase hex chars', () => {
    const result = validateChunk(validRecord({ contentHash: 'sha256:' + 'A'.repeat(64) }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_CONTENT_HASH')).toBe(true);
  });

  it('accepts a valid sha256 hash', () => {
    const hash = 'sha256:' + '0'.repeat(32) + 'f'.repeat(32);
    expect(validateChunk(validRecord({ contentHash: hash }))).toEqual({ ok: true });
  });
});

describe('validateChunk — declares', () => {
  it('rejects missing declares', () => {
    const { declares: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_DECLARES')).toBe(true);
  });

  it('rejects non-array declares', () => {
    const result = validateChunk(validRecord({ declares: 'myFunc' }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_DECLARES')).toBe(true);
  });

  it('rejects declares with non-string entries', () => {
    const result = validateChunk(validRecord({ declares: ['good', 42] }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_DECLARES')).toBe(true);
  });
});

describe('validateChunk — references', () => {
  it('rejects missing references', () => {
    const { references: _, ...rec } = validRecord();
    const result = validateChunk(rec);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_REFERENCES')).toBe(true);
  });

  it('rejects non-array references', () => {
    const result = validateChunk(validRecord({ references: null }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_REFERENCES')).toBe(true);
  });

  it('rejects references with non-string entries', () => {
    const result = validateChunk(validRecord({ references: [true] }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERR_CHUNK_INVALID_REFERENCES')).toBe(true);
  });
});

describe('validateChunk — multiple errors', () => {
  it('reports all errors when multiple fields are missing', () => {
    const result = validateChunk({});
    expect(result.ok).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain('ERR_CHUNK_MISSING_FILE_PATH');
    expect(codes).toContain('ERR_CHUNK_MISSING_LANGUAGE');
    expect(codes).toContain('ERR_CHUNK_INVALID_KIND');
    expect(codes).toContain('ERR_CHUNK_MISSING_NAME');
    expect(codes).toContain('ERR_CHUNK_INVALID_START_BYTE');
    expect(codes).toContain('ERR_CHUNK_INVALID_END_BYTE');
    expect(codes).toContain('ERR_CHUNK_INVALID_START_LINE');
    expect(codes).toContain('ERR_CHUNK_INVALID_END_LINE');
    expect(codes).toContain('ERR_CHUNK_INVALID_CONTENT_HASH');
    expect(codes).toContain('ERR_CHUNK_INVALID_DECLARES');
    expect(codes).toContain('ERR_CHUNK_INVALID_REFERENCES');
  });
});

// ─── chunkerCapability ────────────────────────────────────────────────────────

describe('chunkerCapability', () => {
  it('passes through all three fields from the impl', () => {
    const impl = { languages: ['js', 'ts'], kinds: ['file', 'function'], version: '1.0.0' };
    expect(chunkerCapability(impl)).toEqual({ languages: ['js', 'ts'], kinds: ['file', 'function'], version: '1.0.0' });
  });

  it('matches expected pure-JS impl capability shape', () => {
    const pureJsImpl = {
      languages: ['js', 'ts', 'mjs', 'py', 'sql', 'md'],
      kinds: ['file', 'function', 'class'],
      version: '1.0.0',
    };
    const cap = chunkerCapability(pureJsImpl);
    expect(cap.languages).toEqual(['js', 'ts', 'mjs', 'py', 'sql', 'md']);
    expect(cap.kinds).toEqual(['file', 'function', 'class']);
    expect(cap.version).toMatch(/^1\./);
  });

  it('defaults missing fields to safe values', () => {
    expect(chunkerCapability({})).toEqual({ languages: [], kinds: [], version: '0.0.0' });
  });

  it('defaults non-array languages to empty array', () => {
    const cap = chunkerCapability({ languages: 'js', kinds: ['file'], version: '1.0.0' });
    expect(cap.languages).toEqual([]);
  });

  it('defaults non-array kinds to empty array', () => {
    const cap = chunkerCapability({ languages: ['js'], kinds: 'file', version: '1.0.0' });
    expect(cap.kinds).toEqual([]);
  });

  it('defaults non-string version to 0.0.0', () => {
    const cap = chunkerCapability({ languages: [], kinds: [], version: 42 });
    expect(cap.version).toBe('0.0.0');
  });
});

// ─── CHUNK_KINDS ──────────────────────────────────────────────────────────────

describe('CHUNK_KINDS', () => {
  it('contains exactly the six canonical kinds', () => {
    expect(CHUNK_KINDS).toEqual(['file', 'module', 'class', 'function', 'method', 'block']);
  });
});

// ─── validateChunk — exact results (meta-bug #383) ────────────────────────────
// Every error code and message, in the order the contract reports them, so that
// the validator can be split into per-field checks without changing what callers see.

const CHUNK_ERRORS = {
  FILE_PATH: { code: 'ERR_CHUNK_MISSING_FILE_PATH', message: 'filePath is required and must be a non-empty string' },
  LANGUAGE: { code: 'ERR_CHUNK_MISSING_LANGUAGE', message: 'language is required and must be a non-empty string' },
  KIND: { code: 'ERR_CHUNK_INVALID_KIND', message: 'kind must be one of: file, module, class, function, method, block' },
  NAME: { code: 'ERR_CHUNK_MISSING_NAME', message: 'name is required and must be a string' },
  START_BYTE: { code: 'ERR_CHUNK_INVALID_START_BYTE', message: 'startByte must be a non-negative integer' },
  END_BYTE: { code: 'ERR_CHUNK_INVALID_END_BYTE', message: 'endByte must be a non-negative integer' },
  BYTE_RANGE: { code: 'ERR_CHUNK_INVALID_BYTE_RANGE', message: 'endByte must be >= startByte' },
  START_LINE: { code: 'ERR_CHUNK_INVALID_START_LINE', message: 'startLine must be a positive integer (1-indexed)' },
  END_LINE: { code: 'ERR_CHUNK_INVALID_END_LINE', message: 'endLine must be a positive integer (1-indexed)' },
  LINE_RANGE: { code: 'ERR_CHUNK_INVALID_LINE_RANGE', message: 'endLine must be >= startLine' },
  HASH: { code: 'ERR_CHUNK_INVALID_CONTENT_HASH', message: 'contentHash must match pattern sha256:<64 lowercase hex chars>' },
  DECLARES: { code: 'ERR_CHUNK_INVALID_DECLARES', message: 'declares must be an array of strings' },
  DECLARES_ENTRIES: { code: 'ERR_CHUNK_INVALID_DECLARES', message: 'all entries in declares must be strings' },
  REFERENCES: { code: 'ERR_CHUNK_INVALID_REFERENCES', message: 'references must be an array of strings' },
  REFERENCES_ENTRIES: { code: 'ERR_CHUNK_INVALID_REFERENCES', message: 'all entries in references must be strings' },
};

const EVERY_CHUNK_ERROR = [
  'FILE_PATH', 'LANGUAGE', 'KIND', 'NAME', 'START_BYTE', 'END_BYTE', 'START_LINE', 'END_LINE', 'HASH', 'DECLARES', 'REFERENCES',
];

const sparseDeclares = [];
sparseDeclares[1] = 'a';

// [name, record, expected error keys in order — empty when the record is valid]
const CHUNK_CASES = [
  ['an empty object breaks every rule, in contract order', {}, EVERY_CHUNK_ERROR],
  ['a Map is an object with none of the fields', new Map(), EVERY_CHUNK_ERROR],
  ['an object with no prototype is read like any other', Object.create(null), EVERY_CHUNK_ERROR],
  [
    'every field wrong at once, in contract order',
    {
      filePath: '', language: '', kind: 'x', name: 1, startByte: 'a', endByte: 'b',
      startLine: 'c', endLine: 'd', contentHash: 'e', declares: 'f', references: 'g',
    },
    EVERY_CHUNK_ERROR,
  ],
  ['a class instance with valid fields passes', Object.assign(new (class Rec {})(), validRecord()), []],
  ['unknown properties are ignored', validRecord({ extra: 1, provenance: {} }), []],
  ['a frozen record passes (nothing is written to it)', Object.freeze(validRecord()), []],
  ['negative zero offsets pass', validRecord({ startByte: -0, endByte: -0 }), []],
  ['NaN and Infinity are not integers', validRecord({ startByte: NaN, endByte: Infinity }), ['START_BYTE', 'END_BYTE']],
  ['two invalid byte offsets give no range error', validRecord({ startByte: -1, endByte: -2 }), ['START_BYTE', 'END_BYTE']],
  ['a fractional start hides the byte range check', validRecord({ startByte: 1.5, endByte: 0 }), ['START_BYTE']],
  ['a negative start hides the byte range check', validRecord({ startByte: -1, endByte: 5 }), ['START_BYTE']],
  ['a missing start hides the byte range check', validRecord({ startByte: undefined }), ['START_BYTE']],
  ['an end before the start is a byte range error', validRecord({ startByte: 10, endByte: 5 }), ['BYTE_RANGE']],
  ['a numeric string end is not an integer', validRecord({ endByte: '5' }), ['END_BYTE']],
  ['line 0 is invalid for both ends', validRecord({ startLine: 0, endLine: 0 }), ['START_LINE', 'END_LINE']],
  ['two invalid lines give no range error', validRecord({ startLine: 0, endLine: -3 }), ['START_LINE', 'END_LINE']],
  ['a fractional start line hides the line range check', validRecord({ startLine: 2.5, endLine: 1 }), ['START_LINE']],
  ['an end line before the start line is a line range error', validRecord({ startLine: 5, endLine: 4 }), ['LINE_RANGE']],
  ['kind is case-sensitive', validRecord({ kind: 'Function' }), ['KIND']],
  ['a null name is not a string', validRecord({ name: null }), ['NAME']],
  ['an upper-case hash is rejected', validRecord({ contentHash: 'sha256:' + 'A'.repeat(64) }), ['HASH']],
  ['a hash one character too long is rejected', validRecord({ contentHash: VALID_HASH + 'a' }), ['HASH']],
  ['a hash with a leading space is rejected', validRecord({ contentHash: ` ${VALID_HASH}` }), ['HASH']],
  ['a numeric hash is rejected', validRecord({ contentHash: 12345 }), ['HASH']],
  ['declares as a string is not an array', validRecord({ declares: 'abc' }), ['DECLARES']],
  ['declares with one non-string entry', validRecord({ declares: ['a', 1] }), ['DECLARES_ENTRIES']],
  ['a hole in declares is skipped, as Array.some skips it', validRecord({ declares: sparseDeclares }), []],
  ['references as an object is not an array', validRecord({ references: {} }), ['REFERENCES']],
  ['references with a null entry', validRecord({ references: ['a', null] }), ['REFERENCES_ENTRIES']],
  ['declares and references can both be wrong', validRecord({ declares: {}, references: [1] }), ['DECLARES', 'REFERENCES_ENTRIES']],
];

describe('validateChunk — exact error lists (#383)', () => {
  it.each(CHUNK_CASES)('%s', (_name, record, keys) => {
    const expected = keys.length === 0 ? { ok: true } : { ok: false, errors: keys.map((key) => CHUNK_ERRORS[key]) };
    expect(validateChunk(record)).toStrictEqual(expected);
  });

  it.each([null, undefined, 42, 'string', [1, 2], true])('reports the exact record error for %s', (input) => {
    expect(validateChunk(input)).toStrictEqual({
      ok: false,
      errors: [{ code: 'ERR_CHUNK_INVALID_RECORD', message: 'chunk record must be a plain object' }],
    });
  });
});
