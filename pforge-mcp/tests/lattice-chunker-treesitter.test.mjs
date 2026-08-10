/**
 * lattice-chunker-treesitter.test.mjs — Tests for the tree-sitter chunker.
 *
 * Capability exports and fallback behaviour are tested unconditionally so they
 * pass even when tree-sitter is not installed (the expected CI state for this
 * opt-in package).
 *
 * Tests that require a working tree-sitter + grammar installation are guarded
 * with `it.skipIf(!hasTreeSitter)` so the full suite stays green in stock CI.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  chunkFile,
  languages,
  kinds,
  version,
  _resetForTesting,
} from '../lattice-chunker-treesitter.mjs';

import { validateChunk } from 'pforge-sdk/chunker';

// ─── Tree-sitter availability probe ──────────────────────────────────────────

let hasTreeSitter = false;
try {
  await import('tree-sitter');
  hasTreeSitter = true;
} catch {
  // opt-in package; absence is expected
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../pforge-sdk/tests/fixtures/chunker',
);

function fixture(name) {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

// ─── Capability metadata ──────────────────────────────────────────────────────

describe('lattice-chunker-treesitter — capability metadata', () => {
  it('exports a languages array that includes js, ts, mjs, py', () => {
    expect(languages).toEqual(expect.arrayContaining(['js', 'ts', 'mjs', 'py']));
  });

  it('exports a kinds array that includes "method" (beyond pure-JS)', () => {
    expect(kinds).toContain('method');
    expect(kinds).toContain('function');
    expect(kinds).toContain('class');
    expect(kinds).toContain('file');
  });

  it('exports a semver version string starting with "1."', () => {
    expect(version).toMatch(/^1\./);
  });

  it('exports chunkFile as an async function', () => {
    expect(typeof chunkFile).toBe('function');
    // Async functions return a Promise
    const result = chunkFile({ filePath: 'probe.js', content: '' });
    expect(result).toBeInstanceOf(Promise);
    return result; // let vitest clean up
  });
});

// ─── Fallback behaviour (runs when tree-sitter is absent — the CI default) ───

describe('lattice-chunker-treesitter — fallback path', () => {
  beforeEach(() => {
    // Reset so each test starts with a clean lazy-load state. When tree-sitter
    // is absent this means re-triggering the fallback path.
    _resetForTesting();
  });

  it('returns at least a file-kind chunk for any JS input', async () => {
    const content = fixture('sample.js');
    const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].kind).toBe('file');
  });

  it('all chunks pass validateChunk for sample.js', async () => {
    const content = fixture('sample.js');
    const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
    for (const chunk of chunks) {
      const result = validateChunk(chunk);
      expect(result, `chunk "${chunk.name || '(file)'}" failed: ${JSON.stringify(result)}`).toEqual({
        ok: true,
      });
    }
  });

  it('all chunks pass validateChunk for sample.py', async () => {
    const content = fixture('sample.py');
    const chunks = await chunkFile({ filePath: 'sample.py', content, language: 'py' });
    for (const chunk of chunks) {
      const result = validateChunk(chunk);
      expect(result, `chunk "${chunk.name || '(file)'}" failed: ${JSON.stringify(result)}`).toEqual({
        ok: true,
      });
    }
  });

  it('all chunks pass validateChunk for an empty JS file', async () => {
    const chunks = await chunkFile({ filePath: 'empty.js', content: '', language: 'js' });
    for (const chunk of chunks) {
      expect(validateChunk(chunk)).toEqual({ ok: true });
    }
  });

  it('emits exactly one warning to stderr when tree-sitter is not installed', async () => {
    if (hasTreeSitter) {
      // When tree-sitter IS installed the fallback is never taken; skip this check.
      return;
    }

    const original = process.stderr.write.bind(process.stderr);
    const calls = [];
    // Capture stderr.write calls
    process.stderr.write = (...args) => {
      calls.push(args[0]);
      return true;
    };

    try {
      await chunkFile({ filePath: 'a.js', content: 'function a() {}', language: 'js' });
      await chunkFile({ filePath: 'b.js', content: 'function b() {}', language: 'js' });
    } finally {
      process.stderr.write = original;
    }

    const warnings = calls.filter((m) => typeof m === 'string' && m.includes('lattice-chunker-treesitter'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('falling back to pure-JS chunker');
  });
});

// ─── High-fidelity tests (skipped when tree-sitter grammars are absent) ───────

describe('lattice-chunker-treesitter — high-fidelity JS parsing', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it.skipIf(!hasTreeSitter)(
    'detects top-level function declarations by name',
    async () => {
      const content = fixture('sample.js');
      const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
      const funcChunks = chunks.filter((c) => c.kind === 'function');
      expect(funcChunks.some((c) => c.name === 'add')).toBe(true);
      expect(funcChunks.some((c) => c.name === 'fetchData')).toBe(true);
    },
  );

  it.skipIf(!hasTreeSitter)(
    'detects the Calculator class',
    async () => {
      const content = fixture('sample.js');
      const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
      const classChunks = chunks.filter((c) => c.kind === 'class');
      expect(classChunks.some((c) => c.name === 'Calculator')).toBe(true);
    },
  );

  it.skipIf(!hasTreeSitter)(
    'emits method-kind chunks for methods inside classes',
    async () => {
      const content = fixture('sample.js');
      const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
      const methodChunks = chunks.filter((c) => c.kind === 'method');
      // Calculator has constructor and add method
      expect(methodChunks.length).toBeGreaterThanOrEqual(1);
      expect(methodChunks.some((c) => c.name === 'add')).toBe(true);
    },
  );

  it.skipIf(!hasTreeSitter)(
    'produces more chunk kinds than pure-JS (method-kind from class body)',
    async () => {
      const content = fixture('sample.js');
      const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
      const hasMethod = chunks.some((c) => c.kind === 'method');
      expect(hasMethod).toBe(true);
    },
  );

  it.skipIf(!hasTreeSitter)(
    'all chunks from sample.js pass validateChunk (high-fidelity path)',
    async () => {
      const content = fixture('sample.js');
      const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
      for (const chunk of chunks) {
        const result = validateChunk(chunk);
        expect(result, `chunk "${chunk.name || '(file)'}" failed: ${JSON.stringify(result)}`).toEqual({
          ok: true,
        });
      }
    },
  );

  it.skipIf(!hasTreeSitter)(
    'chunks have non-decreasing byte ranges (no byte-range inversions)',
    async () => {
      const content = fixture('sample.js');
      const chunks = await chunkFile({ filePath: 'sample.js', content, language: 'js' });
      for (const chunk of chunks) {
        expect(chunk.endByte).toBeGreaterThanOrEqual(chunk.startByte);
        expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
      }
    },
  );

  it.skipIf(!hasTreeSitter)(
    'detects const/arrow functions',
    async () => {
      const content = 'const multiply = (a, b) => {\n  return a * b;\n};\n';
      const chunks = await chunkFile({ filePath: 'math.js', content, language: 'js' });
      expect(chunks.some((c) => c.kind === 'function' && c.name === 'multiply')).toBe(true);
    },
  );
});

// ─── High-fidelity Python (skipped when grammars absent) ─────────────────────

describe('lattice-chunker-treesitter — high-fidelity Python parsing', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it.skipIf(!hasTreeSitter)(
    'detects Python functions',
    async () => {
      const content = fixture('sample.py');
      const chunks = await chunkFile({ filePath: 'sample.py', content, language: 'py' });
      expect(chunks.some((c) => c.kind === 'function' && c.name === 'add')).toBe(true);
    },
  );

  it.skipIf(!hasTreeSitter)(
    'detects Python class methods',
    async () => {
      const content = fixture('sample.py');
      const chunks = await chunkFile({ filePath: 'sample.py', content, language: 'py' });
      const methodChunks = chunks.filter((c) => c.kind === 'method');
      expect(methodChunks.length).toBeGreaterThanOrEqual(1);
    },
  );

  it.skipIf(!hasTreeSitter)(
    'all Python chunks pass validateChunk (high-fidelity path)',
    async () => {
      const content = fixture('sample.py');
      const chunks = await chunkFile({ filePath: 'sample.py', content, language: 'py' });
      for (const chunk of chunks) {
        const result = validateChunk(chunk);
        expect(result, `chunk "${chunk.name || '(file)'}" failed: ${JSON.stringify(result)}`).toEqual({
          ok: true,
        });
      }
    },
  );
});

// ─── Contract conformance (parallel to chunker-pureJs contract tests) ─────────

describe('lattice-chunker-treesitter — contract conformance (fixture sweep)', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  const cases = [
    ['sample.js', 'js'],
    ['sample.py', 'py'],
    ['sample.md', 'md'],
    ['empty.js', 'js'],
  ];

  for (const [fname, lang] of cases) {
    it(`all chunks from ${fname} pass validateChunk`, async () => {
      const content = fixture(fname);
      const chunks = await chunkFile({ filePath: fname, content, language: lang });
      expect(Array.isArray(chunks)).toBe(true);
      for (const chunk of chunks) {
        const result = validateChunk(chunk);
        expect(result, `chunk "${chunk.name || '(file)'}" failed: ${JSON.stringify(result)}`).toEqual({
          ok: true,
        });
      }
    });
  }
});
