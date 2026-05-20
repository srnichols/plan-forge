/**
 * thought-reader.test.mjs — Unit tests for pforge-sdk/src/thought-reader.mjs
 *
 * Uses temporary directories for I/O tests so no real .forge/ state is required.
 * Run with: npx vitest run pforge-sdk/tests/thought-reader.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FORGE_DIR_RELATIVE,
  THOUGHT_SOURCES,
  forgeDir,
  thoughtFilePath,
  listThoughtSources,
  parseThoughtLine,
  readThoughts,
  readAllThoughts,
} from '../src/thought-reader.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LIVEGUARD_RECORD = {
  _v: 1,
  content: 'Tempering scan on project: status=ok — gaps=0',
  project: 'plan-forge',
};

const QUEUE_ARCHIVE_RECORD = {
  _v: 1,
  _status: 'delivered',
  _attempts: 1,
  _enqueuedAt: '2026-05-19T18:30:00.000Z',
  _nextAttemptAt: '2026-05-19T18:30:00.000Z',
  content: 'Phase 55 slice 3 completed — all gates passed.',
  project: 'plan-forge',
};

const DLQ_RECORD = {
  _v: 1,
  _status: 'failed',
  _attempts: 3,
  content: 'Failed to deliver thought after 3 attempts.',
  project: 'plan-forge',
};

/** Build a temporary workspace with a `.forge/` directory. */
function makeTmpWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'pforge-sdk-thought-reader-'));
  const forgePath = join(cwd, '.forge');
  mkdirSync(forgePath, { recursive: true });
  return { cwd, forgePath };
}

/** Write JSONL records to a file in `.forge/`. */
function writeThoughtFile(forgePath, filename, records) {
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(join(forgePath, filename), lines, 'utf-8');
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('FORGE_DIR_RELATIVE', () => {
  it('is a non-empty string', () => {
    expect(typeof FORGE_DIR_RELATIVE).toBe('string');
    expect(FORGE_DIR_RELATIVE.length).toBeGreaterThan(0);
  });

  it('equals ".forge"', () => {
    expect(FORGE_DIR_RELATIVE).toBe('.forge');
  });
});

describe('THOUGHT_SOURCES', () => {
  it('is a frozen non-empty array', () => {
    expect(Array.isArray(THOUGHT_SOURCES)).toBe(true);
    expect(THOUGHT_SOURCES.length).toBeGreaterThan(0);
    expect(Object.isFrozen(THOUGHT_SOURCES)).toBe(true);
  });

  it('contains the four canonical source filenames', () => {
    expect(THOUGHT_SOURCES).toContain('openbrain-queue.jsonl');
    expect(THOUGHT_SOURCES).toContain('openbrain-queue.archive.jsonl');
    expect(THOUGHT_SOURCES).toContain('openbrain-dlq.jsonl');
    expect(THOUGHT_SOURCES).toContain('liveguard-memories.jsonl');
  });

  it('all entries are non-empty strings ending in .jsonl', () => {
    for (const src of THOUGHT_SOURCES) {
      expect(typeof src).toBe('string');
      expect(src.length).toBeGreaterThan(0);
      expect(src).toMatch(/\.jsonl$/);
    }
  });
});

// ─── Path helpers ─────────────────────────────────────────────────────────────

describe('forgeDir', () => {
  it('returns an absolute path containing ".forge"', () => {
    const d = forgeDir({ cwd: '/workspace' });
    expect(d.replace(/\\/g, '/')).toContain('.forge');
  });

  it('falls back to process.cwd() when cwd is omitted', () => {
    const d = forgeDir();
    expect(d.length).toBeGreaterThan(0);
    expect(d.replace(/\\/g, '/')).toContain('.forge');
  });

  it('uses the supplied cwd', () => {
    const d = forgeDir({ cwd: '/my/project' });
    expect(d.replace(/\\/g, '/')).toContain('/my/project');
    expect(d.replace(/\\/g, '/')).toContain('.forge');
  });
});

describe('thoughtFilePath', () => {
  it('appends source under .forge/', () => {
    const p = thoughtFilePath({ source: 'liveguard-memories.jsonl', cwd: '/workspace' });
    const n = p.replace(/\\/g, '/');
    expect(n).toContain('.forge/liveguard-memories.jsonl');
  });

  it('uses process.cwd() when cwd is omitted', () => {
    const p = thoughtFilePath({ source: 'openbrain-queue.jsonl' });
    expect(p.replace(/\\/g, '/')).toContain('.forge/openbrain-queue.jsonl');
  });

  it('produces different paths for different sources', () => {
    const a = thoughtFilePath({ source: 'openbrain-queue.jsonl', cwd: '/workspace' });
    const b = thoughtFilePath({ source: 'liveguard-memories.jsonl', cwd: '/workspace' });
    expect(a).not.toBe(b);
  });
});

// ─── listThoughtSources ───────────────────────────────────────────────────────

describe('listThoughtSources', () => {
  let cwd;
  let forgePath;

  beforeEach(() => {
    ({ cwd, forgePath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when .forge/ does not exist', () => {
    rmSync(forgePath, { recursive: true, force: true });
    expect(listThoughtSources({ cwd })).toEqual([]);
  });

  it('returns empty array when no source files are present', () => {
    expect(listThoughtSources({ cwd })).toEqual([]);
  });

  it('returns only the files that exist', () => {
    writeFileSync(join(forgePath, 'liveguard-memories.jsonl'), '');
    const present = listThoughtSources({ cwd });
    expect(present).toContain('liveguard-memories.jsonl');
    expect(present).not.toContain('openbrain-queue.jsonl');
  });

  it('respects a custom sources filter', () => {
    writeFileSync(join(forgePath, 'liveguard-memories.jsonl'), '');
    writeFileSync(join(forgePath, 'openbrain-queue.jsonl'), '');
    const present = listThoughtSources({ cwd, sources: ['liveguard-memories.jsonl'] });
    expect(present).toEqual(['liveguard-memories.jsonl']);
  });

  it('returns all default sources when they all exist', () => {
    for (const src of THOUGHT_SOURCES) {
      writeFileSync(join(forgePath, src), '');
    }
    const present = listThoughtSources({ cwd });
    expect(present).toHaveLength(THOUGHT_SOURCES.length);
  });
});

// ─── parseThoughtLine ─────────────────────────────────────────────────────────

describe('parseThoughtLine — valid lines', () => {
  it('parses a minimal thought record', () => {
    const r = parseThoughtLine('{"_v":1,"content":"test thought"}');
    expect(r).toEqual({ _v: 1, content: 'test thought' });
  });

  it('parses a liveguard-memory record', () => {
    const r = parseThoughtLine(JSON.stringify(LIVEGUARD_RECORD));
    expect(r).toMatchObject({ _v: 1, content: LIVEGUARD_RECORD.content });
    expect(r.project).toBe('plan-forge');
  });

  it('parses a queue-archive record with delivery metadata', () => {
    const r = parseThoughtLine(JSON.stringify(QUEUE_ARCHIVE_RECORD));
    expect(r).toMatchObject({ _status: 'delivered', _attempts: 1 });
    expect(r._enqueuedAt).toBe('2026-05-19T18:30:00.000Z');
  });

  it('parses a DLQ record', () => {
    const r = parseThoughtLine(JSON.stringify(DLQ_RECORD));
    expect(r).toMatchObject({ _status: 'failed', _attempts: 3 });
  });

  it('is pure — same input produces same output', () => {
    const line = JSON.stringify(LIVEGUARD_RECORD);
    expect(parseThoughtLine(line)).toEqual(parseThoughtLine(line));
  });
});

describe('parseThoughtLine — invalid / edge cases', () => {
  it('returns null for an empty string', () => {
    expect(parseThoughtLine('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(parseThoughtLine('   \t  ')).toBeNull();
  });

  it('returns null for non-string inputs', () => {
    expect(parseThoughtLine(null)).toBeNull();
    expect(parseThoughtLine(undefined)).toBeNull();
    expect(parseThoughtLine(42)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseThoughtLine('{ not valid json {')).toBeNull();
  });

  it('returns null for a JSON array (not an object)', () => {
    expect(parseThoughtLine('[1,2,3]')).toBeNull();
  });

  it('returns null for a JSON primitive', () => {
    expect(parseThoughtLine('"just a string"')).toBeNull();
    expect(parseThoughtLine('42')).toBeNull();
    expect(parseThoughtLine('true')).toBeNull();
  });

  it('returns null for JSON null', () => {
    expect(parseThoughtLine('null')).toBeNull();
  });
});

// ─── readThoughts ─────────────────────────────────────────────────────────────

describe('readThoughts', () => {
  let cwd;
  let forgePath;

  beforeEach(() => {
    ({ cwd, forgePath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when source file does not exist', () => {
    expect(readThoughts({ source: 'liveguard-memories.jsonl', cwd })).toEqual([]);
  });

  it('returns empty array when source file is empty', () => {
    writeFileSync(join(forgePath, 'liveguard-memories.jsonl'), '');
    expect(readThoughts({ source: 'liveguard-memories.jsonl', cwd })).toEqual([]);
  });

  it('returns empty array when source file contains only blank lines', () => {
    writeFileSync(join(forgePath, 'liveguard-memories.jsonl'), '\n\n\n');
    expect(readThoughts({ source: 'liveguard-memories.jsonl', cwd })).toEqual([]);
  });

  it('returns parsed records', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD, DLQ_RECORD]);
    const records = readThoughts({ source: 'liveguard-memories.jsonl', cwd });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ content: LIVEGUARD_RECORD.content });
    expect(records[1]).toMatchObject({ _status: 'failed' });
  });

  it('silently skips malformed JSONL lines', () => {
    const content = [
      JSON.stringify(LIVEGUARD_RECORD),
      'not valid json',
      JSON.stringify(DLQ_RECORD),
    ].join('\n') + '\n';
    writeFileSync(join(forgePath, 'liveguard-memories.jsonl'), content);
    const records = readThoughts({ source: 'liveguard-memories.jsonl', cwd });
    expect(records).toHaveLength(2);
  });

  it('respects the max option — returns the most-recent N records', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ _v: 1, content: `thought-${i}` }));
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', many);
    const records = readThoughts({ source: 'liveguard-memories.jsonl', cwd, max: 3 });
    expect(records).toHaveLength(3);
    expect(records[0].content).toBe('thought-7');
    expect(records[2].content).toBe('thought-9');
  });

  it('max: 0 returns an empty array', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD]);
    expect(readThoughts({ source: 'liveguard-memories.jsonl', cwd, max: 0 })).toEqual([]);
  });

  it('returns empty array when source is missing from opts', () => {
    expect(readThoughts({})).toEqual([]);
    expect(readThoughts()).toEqual([]);
  });
});

// ─── readAllThoughts ──────────────────────────────────────────────────────────

describe('readAllThoughts', () => {
  let cwd;
  let forgePath;

  beforeEach(() => {
    ({ cwd, forgePath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when .forge/ is empty', () => {
    expect(readAllThoughts({ cwd })).toEqual([]);
  });

  it('reads records from multiple sources', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD]);
    writeThoughtFile(forgePath, 'openbrain-queue.archive.jsonl', [QUEUE_ARCHIVE_RECORD]);
    const all = readAllThoughts({ cwd, sources: ['liveguard-memories.jsonl', 'openbrain-queue.archive.jsonl'] });
    expect(all).toHaveLength(2);
  });

  it('preserves source order in the combined result', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD]);
    writeThoughtFile(forgePath, 'openbrain-dlq.jsonl', [DLQ_RECORD]);
    const all = readAllThoughts({
      cwd,
      sources: ['liveguard-memories.jsonl', 'openbrain-dlq.jsonl'],
    });
    expect(all[0].content).toBe(LIVEGUARD_RECORD.content);
    expect(all[1].content).toBe(DLQ_RECORD.content);
  });

  it('uses THOUGHT_SOURCES by default', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD]);
    const all = readAllThoughts({ cwd });
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe(LIVEGUARD_RECORD.content);
  });

  it('respects the max option across all sources', () => {
    const recs = Array.from({ length: 5 }, (_, i) => ({ _v: 1, content: `r-${i}` }));
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', recs);
    writeThoughtFile(forgePath, 'openbrain-dlq.jsonl', recs);
    const all = readAllThoughts({
      cwd,
      sources: ['liveguard-memories.jsonl', 'openbrain-dlq.jsonl'],
      max: 4,
    });
    expect(all).toHaveLength(4);
  });

  it('max: 0 returns an empty array', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD]);
    expect(readAllThoughts({ cwd, max: 0 })).toEqual([]);
  });

  it('skips missing source files gracefully', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD]);
    const all = readAllThoughts({
      cwd,
      sources: ['does-not-exist.jsonl', 'liveguard-memories.jsonl'],
    });
    expect(all).toHaveLength(1);
  });
});

// ─── Integration: round-trip ──────────────────────────────────────────────────

describe('round-trip: write then read', () => {
  let cwd;
  let forgePath;

  beforeEach(() => {
    ({ cwd, forgePath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('listThoughtSources → readThoughts pipeline works end-to-end', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD, DLQ_RECORD]);
    writeThoughtFile(forgePath, 'openbrain-queue.archive.jsonl', [QUEUE_ARCHIVE_RECORD]);

    const present = listThoughtSources({ cwd });
    expect(present).toContain('liveguard-memories.jsonl');
    expect(present).toContain('openbrain-queue.archive.jsonl');

    const liveRecords = readThoughts({ source: present[0], cwd });
    expect(liveRecords.length).toBeGreaterThan(0);
    expect(typeof liveRecords[0].content).toBe('string');
  });

  it('readAllThoughts returns combined records from all sources', () => {
    writeThoughtFile(forgePath, 'liveguard-memories.jsonl', [LIVEGUARD_RECORD]);
    writeThoughtFile(forgePath, 'openbrain-dlq.jsonl', [DLQ_RECORD]);
    writeThoughtFile(forgePath, 'openbrain-queue.archive.jsonl', [QUEUE_ARCHIVE_RECORD]);

    const all = readAllThoughts({ cwd });
    expect(all.length).toBe(3);
    const contents = all.map((r) => r.content);
    expect(contents).toContain(LIVEGUARD_RECORD.content);
    expect(contents).toContain(DLQ_RECORD.content);
    expect(contents).toContain(QUEUE_ARCHIVE_RECORD.content);
  });
});
