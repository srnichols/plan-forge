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
