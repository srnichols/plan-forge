/**
 * chunker-pureJs.test.mjs — Tests for the pure-JS chunker implementation.
 *
 * Covers capability metadata, the file-level chunk contract, language
 * detection, JS/TS function and class extraction, and Python construct
 * extraction. All emitted chunks are verified against validateChunk().
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';

import { chunkFile, languages, kinds, version } from '../src/chunker-pureJs.mjs';
import { validateChunk } from '../src/chunker.mjs';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'chunker');

function fixture(name) {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

// ─── Capability metadata ──────────────────────────────────────────────────────

describe('chunker-pureJs — capability metadata', () => {
  it('exports the expected languages', () => {
    expect(languages).toEqual(['js', 'ts', 'mjs', 'py', 'sql', 'md']);
  });

  it('exports the expected kinds', () => {
    expect(kinds).toEqual(['file', 'function', 'class']);
  });

  it('exports a semver version string starting with "1."', () => {
    expect(version).toMatch(/^1\./);
  });
});

// ─── All chunks pass validateChunk ────────────────────────────────────────────

describe('chunker-pureJs — all chunks satisfy the CodeChunker contract', () => {
  const cases = [
    ['sample.js', 'js'],
    ['sample.py', 'py'],
    ['sample.md', 'md'],
    ['empty.js', 'js'],
  ];

  for (const [fname, lang] of cases) {
    it(`all chunks from ${fname} pass validateChunk`, () => {
      const content = fixture(fname);
      const chunks = chunkFile({ filePath: fname, content, language: lang });
      for (const chunk of chunks) {
        const result = validateChunk(chunk);
        expect(result, `chunk "${chunk.name || '(file)'}" failed: ${JSON.stringify(result)}`).toEqual({ ok: true });
      }
    });
  }
});

// ─── File chunk ───────────────────────────────────────────────────────────────

describe('chunker-pureJs — file chunk', () => {
  it('always emits a file-kind chunk as the first element', () => {
    const content = fixture('sample.js');
    const chunks = chunkFile({ filePath: 'sample.js', content });
    expect(chunks[0].kind).toBe('file');
    expect(chunks[0].name).toBe('');
  });

  it('file chunk spans the entire file (startByte=0, endByte=byteLength)', () => {
    const content = fixture('sample.js');
    const chunks = chunkFile({ filePath: 'sample.js', content });
    expect(chunks[0].startByte).toBe(0);
    expect(chunks[0].endByte).toBe(Buffer.byteLength(content, 'utf8'));
  });

  it('returns only a file chunk for markdown files', () => {
    const content = fixture('sample.md');
    const chunks = chunkFile({ filePath: 'sample.md', content, language: 'md' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('file');
  });

  it('returns only a file chunk for empty JS files', () => {
    const content = fixture('empty.js');
    const chunks = chunkFile({ filePath: 'empty.js', content, language: 'js' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('file');
  });

  it('returns only a file chunk for SQL files', () => {
    const content = 'SELECT * FROM users;\n';
    const chunks = chunkFile({ filePath: 'query.sql', content, language: 'sql' });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('file');
  });

  it('contentHash is stable — same content produces the same hash', () => {
    const content = fixture('sample.js');
    const a = chunkFile({ filePath: 'sample.js', content });
    const b = chunkFile({ filePath: 'sample.js', content });
    expect(a[0].contentHash).toBe(b[0].contentHash);
  });

  it('contentHash changes when content changes', () => {
    const a = chunkFile({ filePath: 'x.js', content: 'function a() {}' });
    const b = chunkFile({ filePath: 'x.js', content: 'function b() {}' });
    expect(a[0].contentHash).not.toBe(b[0].contentHash);
  });
});

// ─── Language detection ───────────────────────────────────────────────────────

describe('chunker-pureJs — language detection from extension', () => {
  it.each([
    ['foo.js', 'js'],
    ['foo.ts', 'ts'],
    ['foo.mjs', 'mjs'],
    ['foo.py', 'py'],
    ['foo.sql', 'sql'],
    ['foo.md', 'md'],
  ])('detects language %s → %s', (filePath, expected) => {
    const chunks = chunkFile({ filePath, content: '' });
    expect(chunks[0].language).toBe(expected);
  });

  it('honours an explicit language override', () => {
    const chunks = chunkFile({ filePath: 'foo.txt', content: '', language: 'md' });
    expect(chunks[0].language).toBe('md');
  });
});

// ─── JS function detection ────────────────────────────────────────────────────

describe('chunker-pureJs — JS function detection', () => {
  const content = fixture('sample.js');
  const chunks = chunkFile({ filePath: 'sample.js', content, language: 'js' });
  const funcChunks = chunks.filter((c) => c.kind === 'function');

  it('detects at least two function-kind chunks', () => {
    expect(funcChunks.length).toBeGreaterThanOrEqual(2);
  });

  it('detects the "add" function by name', () => {
    expect(funcChunks.some((c) => c.name === 'add')).toBe(true);
  });

  it('detects the "multiply" arrow function', () => {
    expect(funcChunks.some((c) => c.name === 'multiply')).toBe(true);
  });

  it('detects the async "fetchData" function', () => {
    expect(funcChunks.some((c) => c.name === 'fetchData')).toBe(true);
  });

  it('each function chunk includes its name in declares', () => {
    for (const chunk of funcChunks) {
      expect(chunk.declares).toContain(chunk.name);
    }
  });

  it('each function chunk has startLine >= 1', () => {
    for (const chunk of funcChunks) {
      expect(chunk.startLine).toBeGreaterThanOrEqual(1);
    }
  });

  it('each function chunk has endLine >= startLine', () => {
    for (const chunk of funcChunks) {
      expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine);
    }
  });

  it('each function chunk has endByte > startByte', () => {
    for (const chunk of funcChunks) {
      expect(chunk.endByte).toBeGreaterThan(chunk.startByte);
    }
  });
});

// ─── JS class detection ───────────────────────────────────────────────────────

describe('chunker-pureJs — JS class detection', () => {
  const content = fixture('sample.js');
  const chunks = chunkFile({ filePath: 'sample.js', content, language: 'js' });
  const classChunks = chunks.filter((c) => c.kind === 'class');

  it('detects the Calculator class', () => {
    expect(classChunks.some((c) => c.name === 'Calculator')).toBe(true);
  });

  it('each class chunk includes its name in declares', () => {
    for (const chunk of classChunks) {
      expect(chunk.declares).toContain(chunk.name);
    }
  });

  it('Calculator class chunk spans multiple lines', () => {
    const calc = classChunks.find((c) => c.name === 'Calculator');
    expect(calc.endLine).toBeGreaterThan(calc.startLine);
  });
});

// ─── Inline JS detection ─────────────────────────────────────────────────────

describe('chunker-pureJs — inline JS construct detection', () => {
  it('detects a simple function declaration', () => {
    const content = 'function greet(name) {\n  return "Hello " + name;\n}\n';
    const chunks = chunkFile({ filePath: 'greet.js', content, language: 'js' });
    expect(chunks.some((c) => c.kind === 'function' && c.name === 'greet')).toBe(true);
  });

  it('detects an exported function declaration', () => {
    const content = 'export function helper(x) {\n  return x;\n}\n';
    const chunks = chunkFile({ filePath: 'helper.mjs', content, language: 'mjs' });
    expect(chunks.some((c) => c.kind === 'function' && c.name === 'helper')).toBe(true);
  });

  it('detects a class declaration', () => {
    const content = 'class Greeter {\n  greet() { return "hi"; }\n}\n';
    const chunks = chunkFile({ filePath: 'greeter.js', content, language: 'js' });
    expect(chunks.some((c) => c.kind === 'class' && c.name === 'Greeter')).toBe(true);
  });

  it('detects an async function', () => {
    const content = 'async function load(id) {\n  return null;\n}\n';
    const chunks = chunkFile({ filePath: 'loader.js', content, language: 'js' });
    expect(chunks.some((c) => c.kind === 'function' && c.name === 'load')).toBe(true);
  });

  it('detects a const arrow function with block body', () => {
    const content = 'const square = (n) => {\n  return n * n;\n};\n';
    const chunks = chunkFile({ filePath: 'math.js', content, language: 'js' });
    expect(chunks.some((c) => c.kind === 'function' && c.name === 'square')).toBe(true);
  });

  it('all inline chunks pass validateChunk', () => {
    const content = 'export function calc(a, b) {\n  return a + b;\n}\n';
    const chunks = chunkFile({ filePath: 'calc.mjs', content, language: 'mjs' });
    for (const chunk of chunks) {
      expect(validateChunk(chunk)).toEqual({ ok: true });
    }
  });
});

// ─── Python detection ─────────────────────────────────────────────────────────

describe('chunker-pureJs — Python construct detection', () => {
  const content = fixture('sample.py');
  const chunks = chunkFile({ filePath: 'sample.py', content, language: 'py' });

  it('detects the top-level "add" function', () => {
    expect(chunks.some((c) => c.kind === 'function' && c.name === 'add')).toBe(true);
  });

  it('detects the top-level "multiply" function', () => {
    expect(chunks.some((c) => c.kind === 'function' && c.name === 'multiply')).toBe(true);
  });

  it('detects the Calculator class', () => {
    expect(chunks.some((c) => c.kind === 'class' && c.name === 'Calculator')).toBe(true);
  });

  it('each function chunk includes its name in declares', () => {
    for (const chunk of chunks.filter((c) => c.kind === 'function')) {
      expect(chunk.declares).toContain(chunk.name);
    }
  });

  it('Calculator class chunk spans multiple lines', () => {
    const calc = chunks.find((c) => c.kind === 'class' && c.name === 'Calculator');
    expect(calc.endLine).toBeGreaterThan(calc.startLine);
  });

  it('all Python chunks pass validateChunk', () => {
    for (const chunk of chunks) {
      expect(validateChunk(chunk)).toEqual({ ok: true });
    }
  });

  it('detects async def', () => {
    const src = 'async def fetch(url):\n    return None\n';
    const cs = chunkFile({ filePath: 'fetch.py', content: src, language: 'py' });
    expect(cs.some((c) => c.kind === 'function' && c.name === 'fetch')).toBe(true);
  });
});
