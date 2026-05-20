/**
 * run-reader.test.mjs — Unit tests for pforge-sdk/src/run-reader.mjs
 *
 * Uses temporary directories for I/O tests so no real .forge/ state is required.
 * Run with: npx vitest run pforge-sdk/tests/run-reader.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  RUNS_DIR_RELATIVE,
  INDEX_FILE_RELATIVE,
  runsDir,
  runDir,
  runIndexPath,
  listRuns,
  readRunMeta,
  readRunSummary,
  readRunIndex,
  parseEventLine,
} from '../src/run-reader.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_RUN_META = {
  plan: 'docs/plans/Phase-55-PLAN.md',
  traceId: 'trace-abc123',
  startTime: '2026-05-19T18:30:01.000Z',
  model: 'gpt-4.1',
  modelRouting: null,
  mode: 'auto',
  quorumMode: 'auto',
  quorumPreset: null,
  sliceCount: 3,
  executionOrder: [1, 2, 3],
};

const SAMPLE_SUMMARY = {
  plan: 'docs/plans/Phase-55-PLAN.md',
  phase: 'Phase-55-PLAN',
  startTime: '2026-05-19T18:30:01.000Z',
  endTime: '2026-05-19T18:35:22.000Z',
  mode: 'auto',
  quorumMode: 'auto',
  quorumPreset: null,
  model: 'gpt-4.1',
  sliceCount: 3,
  results: { passed: 3, failed: 0, skipped: 0, total: 3 },
  totalDuration: 321000,
  status: 'completed',
  cost: { total: 0.012 },
  sliceResults: [],
};

const SAMPLE_INDEX_ENTRIES = [
  { runId: '20260519-183001', plan: 'Phase-55-PLAN.md', status: 'completed' },
  { runId: '20260518-102233', plan: 'Phase-54-PLAN.md', status: 'failed' },
];

/** Build a temporary workspace with realistic .forge/runs/ content. */
function makeTmpWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'pforge-sdk-run-reader-'));
  const runsPath = join(cwd, '.forge', 'runs');
  mkdirSync(runsPath, { recursive: true });
  return { cwd, runsPath };
}

/** Create a run directory with the given JSON payloads. */
function makeRunDir(runsPath, runId, { meta, summary } = {}) {
  const dir = join(runsPath, runId);
  mkdirSync(dir, { recursive: true });
  if (meta) writeFileSync(join(dir, 'run.json'), JSON.stringify(meta, null, 2));
  if (summary) writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  return dir;
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('RUNS_DIR_RELATIVE', () => {
  it('is a non-empty string', () => {
    expect(typeof RUNS_DIR_RELATIVE).toBe('string');
    expect(RUNS_DIR_RELATIVE.length).toBeGreaterThan(0);
  });

  it('ends with "runs"', () => {
    expect(RUNS_DIR_RELATIVE.replace(/\\/g, '/')).toMatch(/runs$/);
  });

  it('contains .forge', () => {
    expect(RUNS_DIR_RELATIVE.replace(/\\/g, '/')).toContain('.forge');
  });
});

describe('INDEX_FILE_RELATIVE', () => {
  it('is a non-empty string', () => {
    expect(typeof INDEX_FILE_RELATIVE).toBe('string');
    expect(INDEX_FILE_RELATIVE.length).toBeGreaterThan(0);
  });

  it('ends with index.jsonl', () => {
    expect(INDEX_FILE_RELATIVE.replace(/\\/g, '/')).toMatch(/index\.jsonl$/);
  });

  it('contains .forge/runs', () => {
    expect(INDEX_FILE_RELATIVE.replace(/\\/g, '/')).toContain('.forge/runs');
  });
});

// ─── Path helpers ─────────────────────────────────────────────────────────────

describe('runsDir', () => {
  it('returns an absolute path containing .forge/runs', () => {
    const d = runsDir({ cwd: '/workspace' });
    expect(d.replace(/\\/g, '/')).toContain('.forge/runs');
  });

  it('falls back to process.cwd() when cwd is omitted', () => {
    const d = runsDir();
    expect(d.length).toBeGreaterThan(0);
    expect(d.replace(/\\/g, '/')).toContain('.forge/runs');
  });

  it('uses the supplied cwd', () => {
    const d = runsDir({ cwd: '/my/project' });
    expect(d.replace(/\\/g, '/')).toContain('/my/project');
  });
});

describe('runDir', () => {
  it('appends the runId under .forge/runs/', () => {
    const d = runDir({ runId: '20260519-183001', cwd: '/workspace' });
    const normalised = d.replace(/\\/g, '/');
    expect(normalised).toContain('.forge/runs/20260519-183001');
  });

  it('uses process.cwd() when cwd is omitted', () => {
    const d = runDir({ runId: 'my-run' });
    expect(d.replace(/\\/g, '/')).toContain('.forge/runs/my-run');
  });
});

describe('runIndexPath', () => {
  it('ends with index.jsonl', () => {
    expect(runIndexPath({ cwd: '/workspace' }).replace(/\\/g, '/')).toMatch(/index\.jsonl$/);
  });

  it('is consistent with RUNS_DIR_RELATIVE + index.jsonl', () => {
    const p = runIndexPath({ cwd: '/workspace' });
    const normalised = p.replace(/\\/g, '/');
    expect(normalised).toContain('.forge/runs/index.jsonl');
  });
});

// ─── listRuns ─────────────────────────────────────────────────────────────────

describe('listRuns', () => {
  let cwd;
  let runsPath;

  beforeEach(() => {
    ({ cwd, runsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when runs dir does not exist', () => {
    rmSync(runsPath, { recursive: true, force: true });
    expect(listRuns({ cwd })).toEqual([]);
  });

  it('returns empty array when runs dir is empty', () => {
    expect(listRuns({ cwd })).toEqual([]);
  });

  it('returns run IDs sorted newest-first', () => {
    mkdirSync(join(runsPath, '20260518-102233'));
    mkdirSync(join(runsPath, '20260519-183001'));
    mkdirSync(join(runsPath, '20260517-080000'));

    const ids = listRuns({ cwd });
    expect(ids).toEqual(['20260519-183001', '20260518-102233', '20260517-080000']);
  });

  it('skips non-directory entries (e.g. index.jsonl)', () => {
    mkdirSync(join(runsPath, '20260519-183001'));
    writeFileSync(join(runsPath, 'index.jsonl'), '');

    const ids = listRuns({ cwd });
    expect(ids).toEqual(['20260519-183001']);
  });

  it('returns run IDs as strings', () => {
    mkdirSync(join(runsPath, '20260519-183001'));
    const ids = listRuns({ cwd });
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
  });
});

// ─── readRunMeta ──────────────────────────────────────────────────────────────

describe('readRunMeta', () => {
  let cwd;
  let runsPath;

  beforeEach(() => {
    ({ cwd, runsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when run directory does not exist', () => {
    expect(readRunMeta({ runId: 'nonexistent', cwd })).toBeNull();
  });

  it('returns null when run.json does not exist', () => {
    mkdirSync(join(runsPath, '20260519-183001'));
    expect(readRunMeta({ runId: '20260519-183001', cwd })).toBeNull();
  });

  it('returns null when run.json is malformed JSON', () => {
    const dir = makeRunDir(runsPath, '20260519-183001');
    writeFileSync(join(dir, 'run.json'), 'not valid json {{{');
    expect(readRunMeta({ runId: '20260519-183001', cwd })).toBeNull();
  });

  it('returns parsed object from run.json', () => {
    makeRunDir(runsPath, '20260519-183001', { meta: SAMPLE_RUN_META });
    const meta = readRunMeta({ runId: '20260519-183001', cwd });
    expect(meta).toMatchObject({ plan: SAMPLE_RUN_META.plan, sliceCount: 3 });
  });

  it('returned object has expected top-level fields', () => {
    makeRunDir(runsPath, '20260519-183001', { meta: SAMPLE_RUN_META });
    const meta = readRunMeta({ runId: '20260519-183001', cwd });
    expect(meta.traceId).toBe('trace-abc123');
    expect(meta.model).toBe('gpt-4.1');
    expect(meta.mode).toBe('auto');
    expect(Array.isArray(meta.executionOrder)).toBe(true);
  });
});

// ─── readRunSummary ───────────────────────────────────────────────────────────

describe('readRunSummary', () => {
  let cwd;
  let runsPath;

  beforeEach(() => {
    ({ cwd, runsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when run directory does not exist', () => {
    expect(readRunSummary({ runId: 'nonexistent', cwd })).toBeNull();
  });

  it('returns null when summary.json does not exist', () => {
    mkdirSync(join(runsPath, '20260519-183001'));
    expect(readRunSummary({ runId: '20260519-183001', cwd })).toBeNull();
  });

  it('returns null when summary.json is malformed', () => {
    const dir = makeRunDir(runsPath, '20260519-183001');
    writeFileSync(join(dir, 'summary.json'), '{ broken json');
    expect(readRunSummary({ runId: '20260519-183001', cwd })).toBeNull();
  });

  it('returns parsed summary object', () => {
    makeRunDir(runsPath, '20260519-183001', { summary: SAMPLE_SUMMARY });
    const s = readRunSummary({ runId: '20260519-183001', cwd });
    expect(s).toMatchObject({ status: 'completed', phase: 'Phase-55-PLAN' });
  });

  it('summary results object has expected shape', () => {
    makeRunDir(runsPath, '20260519-183001', { summary: SAMPLE_SUMMARY });
    const s = readRunSummary({ runId: '20260519-183001', cwd });
    expect(s.results.passed).toBe(3);
    expect(s.results.failed).toBe(0);
    expect(s.results.total).toBe(3);
  });
});

// ─── readRunIndex ─────────────────────────────────────────────────────────────

describe('readRunIndex', () => {
  let cwd;
  let runsPath;

  beforeEach(() => {
    ({ cwd, runsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when index.jsonl does not exist', () => {
    expect(readRunIndex({ cwd })).toEqual([]);
  });

  it('returns empty array when index.jsonl is empty', () => {
    writeFileSync(join(runsPath, 'index.jsonl'), '');
    expect(readRunIndex({ cwd })).toEqual([]);
  });

  it('returns empty array when index.jsonl contains only blank lines', () => {
    writeFileSync(join(runsPath, 'index.jsonl'), '\n\n\n');
    expect(readRunIndex({ cwd })).toEqual([]);
  });

  it('parses each JSONL line into an object', () => {
    const content = SAMPLE_INDEX_ENTRIES.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(join(runsPath, 'index.jsonl'), content);
    const index = readRunIndex({ cwd });
    expect(index).toHaveLength(2);
    expect(index[0].runId).toBe('20260519-183001');
    expect(index[1].status).toBe('failed');
  });

  it('silently skips malformed JSONL lines', () => {
    const content = [
      JSON.stringify(SAMPLE_INDEX_ENTRIES[0]),
      'invalid json !!!',
      JSON.stringify(SAMPLE_INDEX_ENTRIES[1]),
    ].join('\n');
    writeFileSync(join(runsPath, 'index.jsonl'), content);
    const index = readRunIndex({ cwd });
    expect(index).toHaveLength(2);
  });

  it('returns objects (not strings)', () => {
    writeFileSync(join(runsPath, 'index.jsonl'), JSON.stringify(SAMPLE_INDEX_ENTRIES[0]) + '\n');
    const index = readRunIndex({ cwd });
    expect(typeof index[0]).toBe('object');
    expect(index[0]).not.toBeNull();
  });
});

// ─── parseEventLine ───────────────────────────────────────────────────────────

describe('parseEventLine — valid lines', () => {
  it('parses a minimal event line', () => {
    const r = parseEventLine('[2026-05-19T18:30:01.000Z] slice-started: {}');
    expect(r).toEqual({ ts: '2026-05-19T18:30:01.000Z', type: 'slice-started', data: {} });
  });

  it('parses a line with JSON data payload', () => {
    const r = parseEventLine('[2026-05-19T18:30:02.000Z] slice-started: {"sliceId":1,"sliceName":"Setup"}');
    expect(r).not.toBeNull();
    expect(r.ts).toBe('2026-05-19T18:30:02.000Z');
    expect(r.type).toBe('slice-started');
    expect(r.data.sliceId).toBe(1);
    expect(r.data.sliceName).toBe('Setup');
  });

  it('parses a line with an empty data field', () => {
    const r = parseEventLine('[2026-05-19T18:30:03.000Z] run-started: ');
    expect(r).not.toBeNull();
    expect(r.type).toBe('run-started');
    expect(r.data).toEqual({});
  });

  it('returns a { ts, type, data } shaped object', () => {
    const r = parseEventLine('[2026-05-19T18:30:04.000Z] gate-passed: {"gate":"npm test"}');
    expect(r).toHaveProperty('ts');
    expect(r).toHaveProperty('type');
    expect(r).toHaveProperty('data');
  });

  it('handles event types with dots (e.g. nested namespaces)', () => {
    const r = parseEventLine('[2026-05-19T18:30:05.000Z] quorum.leg-started: {"leg":0}');
    expect(r).not.toBeNull();
    expect(r.type).toBe('quorum.leg-started');
  });
});

describe('parseEventLine — invalid / edge cases', () => {
  it('returns null for an empty string', () => {
    expect(parseEventLine('')).toBeNull();
  });

  it('returns null for a non-string input', () => {
    expect(parseEventLine(null)).toBeNull();
    expect(parseEventLine(42)).toBeNull();
    expect(parseEventLine(undefined)).toBeNull();
  });

  it('returns null for a line without the expected format', () => {
    expect(parseEventLine('plain log message')).toBeNull();
    expect(parseEventLine('{ "json": true }')).toBeNull();
  });

  it('data defaults to {} when the JSON payload is malformed', () => {
    const r = parseEventLine('[2026-05-19T18:30:06.000Z] gate-failed: not valid json {{{');
    expect(r).not.toBeNull();
    expect(r.data).toEqual({});
  });

  it('is pure — calling with the same input always returns the same output', () => {
    const line = '[2026-05-19T18:30:07.000Z] slice-completed: {"sliceId":2}';
    const r1 = parseEventLine(line);
    const r2 = parseEventLine(line);
    expect(r1).toEqual(r2);
  });
});

// ─── Integration: round-trip run write + read ─────────────────────────────────

describe('round-trip: write then read', () => {
  let cwd;
  let runsPath;

  beforeEach(() => {
    ({ cwd, runsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('listRuns → readRunMeta → readRunSummary pipeline produces consistent data', () => {
    makeRunDir(runsPath, '20260519-183001', { meta: SAMPLE_RUN_META, summary: SAMPLE_SUMMARY });
    makeRunDir(runsPath, '20260518-102233', { meta: { ...SAMPLE_RUN_META, sliceCount: 1 }, summary: { ...SAMPLE_SUMMARY, status: 'failed' } });

    const ids = listRuns({ cwd });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('20260519-183001');

    const meta = readRunMeta({ runId: ids[0], cwd });
    const summary = readRunSummary({ runId: ids[0], cwd });

    expect(meta.plan).toBe(summary.plan);
    expect(summary.status).toBe('completed');
  });
});
