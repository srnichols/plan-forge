/**
 * session-reader.test.mjs — Unit tests for pforge-sdk/src/session-reader.mjs
 *
 * Uses temporary directories for I/O tests so no real .forge/ state is required.
 * Run with: npx vitest run pforge-sdk/tests/session-reader.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FM_SESSIONS_DIR_RELATIVE,
  ACTIVE_FILE_SUFFIX,
  ARCHIVE_FILE_SUFFIX,
  fmSessionsDir,
  sessionFilePath,
  sessionArchivePath,
  parseSessionLine,
  listSessions,
  readSession,
  readAllSessionTurns,
  getLane,
  summarizeSession,
} from '../src/session-reader.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TURN_1 = {
  turn: 1,
  timestamp: '2026-05-20T10:00:00.000Z',
  userMessage: 'What is the plan status?',
  classification: 'operational',
  replyHash: 'aabbccdd11223344',
  toolCalls: [],
};

const TURN_2 = {
  turn: 2,
  timestamp: '2026-05-20T10:05:00.000Z',
  userMessage: 'Show me the drift report',
  classification: { lane: 'advisory', score: 0.85 },
  replyHash: 'eeff99887766',
  toolCalls: [{ tool: 'forge_drift_report', args: {} }],
};

const TURN_3 = {
  turn: 3,
  timestamp: '2026-05-20T10:10:00.000Z',
  userMessage: 'How much has this cost?',
  classification: 'advisory',
  replyHash: 'deadbeef12345678',
  toolCalls: [],
};

// ─── Workspace helpers ────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'pforge-sdk-session-reader-'));
  const sessionsPath = join(cwd, '.forge', 'fm-sessions');
  mkdirSync(sessionsPath, { recursive: true });
  return { cwd, sessionsPath };
}

function writeSession(sessionsPath, sessionId, turns) {
  const lines = turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
  writeFileSync(join(sessionsPath, `${sessionId}.jsonl`), lines, 'utf-8');
}

function writeArchive(sessionsPath, sessionId, turns) {
  const lines = turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
  writeFileSync(join(sessionsPath, `${sessionId}.archive.jsonl`), lines, 'utf-8');
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('FM_SESSIONS_DIR_RELATIVE', () => {
  it('is a non-empty string', () => {
    expect(typeof FM_SESSIONS_DIR_RELATIVE).toBe('string');
    expect(FM_SESSIONS_DIR_RELATIVE.length).toBeGreaterThan(0);
  });

  it('contains ".forge" and "fm-sessions"', () => {
    const normalized = FM_SESSIONS_DIR_RELATIVE.replace(/\\/g, '/');
    expect(normalized).toContain('.forge');
    expect(normalized).toContain('fm-sessions');
  });
});

describe('ACTIVE_FILE_SUFFIX', () => {
  it('ends with .jsonl', () => {
    expect(ACTIVE_FILE_SUFFIX).toBe('.jsonl');
  });
});

describe('ARCHIVE_FILE_SUFFIX', () => {
  it('ends with .archive.jsonl', () => {
    expect(ARCHIVE_FILE_SUFFIX).toBe('.archive.jsonl');
  });

  it('is longer than the active suffix', () => {
    expect(ARCHIVE_FILE_SUFFIX.length).toBeGreaterThan(ACTIVE_FILE_SUFFIX.length);
  });
});

// ─── Path helpers ─────────────────────────────────────────────────────────────

describe('fmSessionsDir', () => {
  it('returns an absolute path containing ".forge/fm-sessions"', () => {
    const d = fmSessionsDir({ cwd: '/workspace' });
    expect(d.replace(/\\/g, '/')).toContain('.forge/fm-sessions');
  });

  it('falls back to process.cwd() when cwd is omitted', () => {
    const d = fmSessionsDir();
    expect(d.length).toBeGreaterThan(0);
    expect(d.replace(/\\/g, '/')).toContain('.forge/fm-sessions');
  });

  it('uses the supplied cwd', () => {
    const d = fmSessionsDir({ cwd: '/my/project' });
    const n = d.replace(/\\/g, '/');
    expect(n).toContain('/my/project');
    expect(n).toContain('fm-sessions');
  });
});

describe('sessionFilePath', () => {
  it('produces a path ending with <sessionId>.jsonl', () => {
    const p = sessionFilePath({ sessionId: 'test-session', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toMatch(/test-session\.jsonl$/);
  });

  it('places the file under .forge/fm-sessions/', () => {
    const p = sessionFilePath({ sessionId: 'test-session', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toContain('.forge/fm-sessions/');
  });

  it('uses process.cwd() when cwd is omitted', () => {
    const p = sessionFilePath({ sessionId: 'my-session' });
    expect(p.replace(/\\/g, '/')).toContain('my-session.jsonl');
  });

  it('produces different paths for different session IDs', () => {
    const a = sessionFilePath({ sessionId: 'sess-a', cwd: '/w' });
    const b = sessionFilePath({ sessionId: 'sess-b', cwd: '/w' });
    expect(a).not.toBe(b);
  });
});

describe('sessionArchivePath', () => {
  it('produces a path ending with <sessionId>.archive.jsonl', () => {
    const p = sessionArchivePath({ sessionId: 'test-session', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toMatch(/test-session\.archive\.jsonl$/);
  });

  it('places the file under .forge/fm-sessions/', () => {
    const p = sessionArchivePath({ sessionId: 'test-session', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toContain('.forge/fm-sessions/');
  });

  it('differs from the active path', () => {
    const active = sessionFilePath({ sessionId: 'sess', cwd: '/w' });
    const archive = sessionArchivePath({ sessionId: 'sess', cwd: '/w' });
    expect(active).not.toBe(archive);
    expect(archive.replace(/\\/g, '/')).toContain('archive');
  });
});

// ─── parseSessionLine ─────────────────────────────────────────────────────────

describe('parseSessionLine', () => {
  it('parses a valid JSON object line', () => {
    const line = JSON.stringify(TURN_1);
    const result = parseSessionLine(line);
    expect(result).not.toBeNull();
    expect(result.turn).toBe(1);
    expect(result.userMessage).toBe('What is the plan status?');
  });

  it('returns null for an empty string', () => {
    expect(parseSessionLine('')).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(parseSessionLine('   ')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseSessionLine('not json')).toBeNull();
  });

  it('returns null for a JSON array', () => {
    expect(parseSessionLine('[1,2,3]')).toBeNull();
  });

  it('returns null for a JSON primitive', () => {
    expect(parseSessionLine('"a string"')).toBeNull();
    expect(parseSessionLine('42')).toBeNull();
    expect(parseSessionLine('true')).toBeNull();
  });

  it('returns null for a null JSON value', () => {
    expect(parseSessionLine('null')).toBeNull();
  });

  it('returns null for a non-string input', () => {
    expect(parseSessionLine(null)).toBeNull();
    expect(parseSessionLine(undefined)).toBeNull();
    expect(parseSessionLine(42)).toBeNull();
  });

  it('preserves all fields from the parsed object', () => {
    const line = JSON.stringify(TURN_2);
    const result = parseSessionLine(line);
    expect(result.turn).toBe(2);
    expect(result.classification).toEqual({ lane: 'advisory', score: 0.85 });
    expect(result.toolCalls).toHaveLength(1);
  });

  it('is pure — same input produces same result', () => {
    const line = JSON.stringify(TURN_1);
    expect(parseSessionLine(line)).toEqual(parseSessionLine(line));
  });
});

// ─── listSessions ─────────────────────────────────────────────────────────────

describe('listSessions', () => {
  let cwd;
  let sessionsPath;

  beforeEach(() => {
    ({ cwd, sessionsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when .forge/fm-sessions/ does not exist', () => {
    rmSync(sessionsPath, { recursive: true, force: true });
    expect(listSessions({ cwd })).toEqual([]);
  });

  it('returns empty array when directory is empty', () => {
    expect(listSessions({ cwd })).toEqual([]);
  });

  it('returns session IDs for active JSONL files', () => {
    writeSession(sessionsPath, 'my-session', [TURN_1]);
    const ids = listSessions({ cwd });
    expect(ids).toContain('my-session');
  });

  it('does not include archive-only files as session IDs', () => {
    writeArchive(sessionsPath, 'archived-only', [TURN_1]);
    const ids = listSessions({ cwd });
    expect(ids).not.toContain('archived-only');
  });

  it('includes session IDs that have both active and archive files', () => {
    writeSession(sessionsPath, 'has-both', [TURN_2]);
    writeArchive(sessionsPath, 'has-both', [TURN_1]);
    const ids = listSessions({ cwd });
    expect(ids).toContain('has-both');
  });

  it('returns multiple session IDs', () => {
    writeSession(sessionsPath, 'sess-a', [TURN_1]);
    writeSession(sessionsPath, 'sess-b', [TURN_2]);
    const ids = listSessions({ cwd });
    expect(ids).toContain('sess-a');
    expect(ids).toContain('sess-b');
    expect(ids).toHaveLength(2);
  });

  it('ignores non-.jsonl files', () => {
    writeFileSync(join(sessionsPath, 'README.md'), '# Sessions');
    writeFileSync(join(sessionsPath, 'index.json'), '{}');
    writeSession(sessionsPath, 'valid-session', [TURN_1]);
    const ids = listSessions({ cwd });
    expect(ids).toEqual(['valid-session']);
  });
});

// ─── readSession ──────────────────────────────────────────────────────────────

describe('readSession', () => {
  let cwd;
  let sessionsPath;

  beforeEach(() => {
    ({ cwd, sessionsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when the file does not exist', () => {
    expect(readSession({ sessionId: 'nonexistent', cwd })).toEqual([]);
  });

  it('returns empty array when sessionId is empty', () => {
    expect(readSession({ sessionId: '', cwd })).toEqual([]);
  });

  it('returns empty array when sessionId is not a string', () => {
    expect(readSession({ sessionId: null, cwd })).toEqual([]);
    expect(readSession({ sessionId: 42, cwd })).toEqual([]);
  });

  it('returns empty array when called with no arguments', () => {
    expect(readSession()).toEqual([]);
  });

  it('returns parsed turn records', () => {
    writeSession(sessionsPath, 'sess-1', [TURN_1, TURN_2]);
    const turns = readSession({ sessionId: 'sess-1', cwd });
    expect(turns).toHaveLength(2);
    expect(turns[0].turn).toBe(1);
    expect(turns[1].turn).toBe(2);
  });

  it('skips malformed lines silently', () => {
    const path = join(sessionsPath, 'corrupt.jsonl');
    writeFileSync(path, `${JSON.stringify(TURN_1)}\nnot-valid-json\n${JSON.stringify(TURN_2)}\n`, 'utf-8');
    const turns = readSession({ sessionId: 'corrupt', cwd });
    expect(turns).toHaveLength(2);
  });

  it('respects the max option', () => {
    writeSession(sessionsPath, 'multi', [TURN_1, TURN_2, TURN_3]);
    const turns = readSession({ sessionId: 'multi', cwd, max: 2 });
    expect(turns).toHaveLength(2);
    expect(turns[0].turn).toBe(2);
    expect(turns[1].turn).toBe(3);
  });

  it('returns empty array when max is 0', () => {
    writeSession(sessionsPath, 'multi', [TURN_1, TURN_2]);
    expect(readSession({ sessionId: 'multi', cwd, max: 0 })).toEqual([]);
  });

  it('returns all records when max exceeds count', () => {
    writeSession(sessionsPath, 'small', [TURN_1]);
    const turns = readSession({ sessionId: 'small', cwd, max: 100 });
    expect(turns).toHaveLength(1);
  });

  it('does not include archive turns', () => {
    writeArchive(sessionsPath, 'sess-2', [TURN_1]);
    writeSession(sessionsPath, 'sess-2', [TURN_2, TURN_3]);
    const turns = readSession({ sessionId: 'sess-2', cwd });
    expect(turns).toHaveLength(2);
    expect(turns.some((t) => t.turn === 1)).toBe(false);
  });
});

// ─── readAllSessionTurns ──────────────────────────────────────────────────────

describe('readAllSessionTurns', () => {
  let cwd;
  let sessionsPath;

  beforeEach(() => {
    ({ cwd, sessionsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when neither file exists', () => {
    expect(readAllSessionTurns({ sessionId: 'ghost', cwd })).toEqual([]);
  });

  it('returns empty array when sessionId is not provided', () => {
    expect(readAllSessionTurns()).toEqual([]);
    expect(readAllSessionTurns({ sessionId: '', cwd })).toEqual([]);
  });

  it('returns only active turns when no archive exists', () => {
    writeSession(sessionsPath, 'active-only', [TURN_2, TURN_3]);
    const turns = readAllSessionTurns({ sessionId: 'active-only', cwd });
    expect(turns).toHaveLength(2);
  });

  it('returns only archive turns when no active file exists', () => {
    writeArchive(sessionsPath, 'archive-only', [TURN_1]);
    const turns = readAllSessionTurns({ sessionId: 'archive-only', cwd });
    expect(turns).toHaveLength(1);
    expect(turns[0].turn).toBe(1);
  });

  it('combines archive and active turns', () => {
    writeArchive(sessionsPath, 'both', [TURN_1]);
    writeSession(sessionsPath, 'both', [TURN_2, TURN_3]);
    const turns = readAllSessionTurns({ sessionId: 'both', cwd });
    expect(turns).toHaveLength(3);
  });

  it('sorts combined turns by turn number ascending', () => {
    writeArchive(sessionsPath, 'combined', [TURN_1]);
    writeSession(sessionsPath, 'combined', [TURN_2, TURN_3]);
    const turns = readAllSessionTurns({ sessionId: 'combined', cwd });
    expect(turns[0].turn).toBe(1);
    expect(turns[1].turn).toBe(2);
    expect(turns[2].turn).toBe(3);
  });

  it('deduplicates turns with the same turn number (prefers active)', () => {
    // Rotation window: same turn appears in both archive and active
    writeArchive(sessionsPath, 'dedup', [TURN_1, TURN_2]);
    writeSession(sessionsPath, 'dedup', [TURN_2, TURN_3]); // TURN_2 duplicated
    const turns = readAllSessionTurns({ sessionId: 'dedup', cwd });
    expect(turns).toHaveLength(3);
    const turn2s = turns.filter((t) => t.turn === 2);
    expect(turn2s).toHaveLength(1);
  });

  it('respects the max option', () => {
    writeArchive(sessionsPath, 'maxtest', [TURN_1]);
    writeSession(sessionsPath, 'maxtest', [TURN_2, TURN_3]);
    const turns = readAllSessionTurns({ sessionId: 'maxtest', cwd, max: 2 });
    expect(turns).toHaveLength(2);
    expect(turns[0].turn).toBe(2);
    expect(turns[1].turn).toBe(3);
  });

  it('returns empty array when max is 0', () => {
    writeSession(sessionsPath, 'x', [TURN_1, TURN_2]);
    expect(readAllSessionTurns({ sessionId: 'x', cwd, max: 0 })).toEqual([]);
  });
});

// ─── getLane ──────────────────────────────────────────────────────────────────

describe('getLane', () => {
  it('returns a string classification directly', () => {
    expect(getLane({ classification: 'advisory' })).toBe('advisory');
  });

  it('returns lane from an object classification', () => {
    expect(getLane({ classification: { lane: 'operational', score: 0.9 } })).toBe('operational');
  });

  it('returns empty string when classification is absent', () => {
    expect(getLane({})).toBe('');
  });

  it('returns empty string when classification is null', () => {
    expect(getLane({ classification: null })).toBe('');
  });

  it('returns empty string when classification is a number', () => {
    expect(getLane({ classification: 42 })).toBe('');
  });

  it('returns empty string for null turn', () => {
    expect(getLane(null)).toBe('');
  });

  it('returns empty string for undefined turn', () => {
    expect(getLane(undefined)).toBe('');
  });

  it('returns empty string when object classification has no lane property', () => {
    expect(getLane({ classification: { score: 0.5 } })).toBe('');
  });

  it('returns empty string when object classification.lane is a number', () => {
    expect(getLane({ classification: { lane: 42 } })).toBe('');
  });

  it('is pure — same input produces same result', () => {
    const turn = { classification: 'advisory' };
    expect(getLane(turn)).toBe(getLane(turn));
  });
});

// ─── summarizeSession ─────────────────────────────────────────────────────────

describe('summarizeSession', () => {
  it('returns zero counts for empty turns array', () => {
    const summary = summarizeSession([]);
    expect(summary.turnCount).toBe(0);
    expect(summary.lanes).toEqual([]);
    expect(summary.latestTimestamp).toBeNull();
    expect(summary.latestUserMessage).toBeNull();
  });

  it('returns zero counts for null', () => {
    const summary = summarizeSession(null);
    expect(summary.turnCount).toBe(0);
  });

  it('counts the number of turns', () => {
    const summary = summarizeSession([TURN_1, TURN_2, TURN_3]);
    expect(summary.turnCount).toBe(3);
  });

  it('extracts unique lanes', () => {
    const summary = summarizeSession([TURN_1, TURN_2, TURN_3]);
    expect(summary.lanes).toContain('operational');
    expect(summary.lanes).toContain('advisory');
  });

  it('extracts lane from object classification', () => {
    const summary = summarizeSession([TURN_2]);
    expect(summary.lanes).toContain('advisory');
  });

  it('returns lanes sorted alphabetically', () => {
    const summary = summarizeSession([TURN_1, TURN_2]);
    const sorted = [...summary.lanes].sort();
    expect(summary.lanes).toEqual(sorted);
  });

  it('returns the latest timestamp', () => {
    const summary = summarizeSession([TURN_1, TURN_2, TURN_3]);
    expect(summary.latestTimestamp).toBe('2026-05-20T10:10:00.000Z');
  });

  it('returns the last non-empty userMessage as latestUserMessage', () => {
    const summary = summarizeSession([TURN_1, TURN_2, TURN_3]);
    expect(summary.latestUserMessage).toBe('How much has this cost?');
  });

  it('returns null latestTimestamp when no turn has timestamp', () => {
    const summary = summarizeSession([{ turn: 1, userMessage: 'hello' }]);
    expect(summary.latestTimestamp).toBeNull();
  });

  it('deduplicates lanes', () => {
    const t1 = { ...TURN_1, classification: 'advisory' };
    const t2 = { ...TURN_2, classification: 'advisory' };
    const summary = summarizeSession([t1, t2]);
    const advisoryCount = summary.lanes.filter((l) => l === 'advisory').length;
    expect(advisoryCount).toBe(1);
  });

  it('ignores turns with empty userMessage for latestUserMessage', () => {
    const turns = [
      { ...TURN_1, userMessage: 'first' },
      { ...TURN_2, userMessage: '' },
    ];
    const summary = summarizeSession(turns);
    expect(summary.latestUserMessage).toBe('first');
  });
});

// ─── Integration: round-trip ──────────────────────────────────────────────────

describe('round-trip: write then read', () => {
  let cwd;
  let sessionsPath;

  beforeEach(() => {
    ({ cwd, sessionsPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('listSessions → readSession pipeline works end-to-end', () => {
    writeSession(sessionsPath, 'session-A', [TURN_1, TURN_2]);
    writeSession(sessionsPath, 'session-B', [TURN_3]);

    const ids = listSessions({ cwd });
    expect(ids.length).toBe(2);

    const firstTurns = readSession({ sessionId: ids[0], cwd });
    expect(firstTurns.length).toBeGreaterThan(0);
  });

  it('readAllSessionTurns combines archive + active correctly', () => {
    writeArchive(sessionsPath, 'full-history', [TURN_1]);
    writeSession(sessionsPath, 'full-history', [TURN_2, TURN_3]);

    const all = readAllSessionTurns({ sessionId: 'full-history', cwd });
    expect(all).toHaveLength(3);

    const summary = summarizeSession(all);
    expect(summary.turnCount).toBe(3);
    expect(summary.latestTimestamp).toBe('2026-05-20T10:10:00.000Z');
  });

  it('summarizeSession reflects all turns including archived', () => {
    writeArchive(sessionsPath, 'merged', [TURN_1]);
    writeSession(sessionsPath, 'merged', [TURN_2, TURN_3]);

    const turns = readAllSessionTurns({ sessionId: 'merged', cwd });
    const summary = summarizeSession(turns);

    expect(summary.turnCount).toBe(3);
    expect(summary.lanes).toContain('operational');
    expect(summary.lanes).toContain('advisory');
  });

  it('single session with only one turn round-trips correctly', () => {
    writeSession(sessionsPath, 'solo', [TURN_1]);
    const turns = readSession({ sessionId: 'solo', cwd });
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe('What is the plan status?');

    const summary = summarizeSession(turns);
    expect(summary.turnCount).toBe(1);
    expect(summary.lanes).toContain('operational');
  });
});
