/**
 * bug-reader.test.mjs — Unit tests for pforge-sdk/src/bug-reader.mjs
 *
 * Uses temporary directories for I/O tests so no real .forge/ state is required.
 * Run with: npx vitest run pforge-sdk/tests/bug-reader.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUGS_DIR_RELATIVE,
  BUG_STATUSES,
  BUG_SEVERITIES,
  bugsDir,
  bugFilePath,
  parseBugId,
  listBugs,
  readBug,
  summarizeBugs,
} from '../src/bug-reader.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BUG_OPEN_CRITICAL = {
  bugId: 'bug-2026-05-20-001',
  fingerprint: 'aabbccdd11223344556677889900aabb',
  scanner: 'vitest',
  severity: 'critical',
  status: 'open',
  classification: 'real-bug',
  classifierMeta: null,
  evidence: { testName: 'should pass', assertionMessage: 'Expected true to be false' },
  affectedFiles: ['src/foo.mjs'],
  reproSteps: null,
  correlationId: 'run-001',
  sliceRef: 'S3',
  discoveredAt: '2026-05-20T10:00:00.000Z',
  updatedAt: '2026-05-20T10:00:00.000Z',
};

const BUG_INFIX_HIGH = {
  bugId: 'bug-2026-05-20-002',
  fingerprint: 'bbccddee22334455667788990011bbcc',
  scanner: 'eslint',
  severity: 'high',
  status: 'in-fix',
  classification: 'real-bug',
  classifierMeta: { confidence: 0.95 },
  evidence: { testName: 'linting', assertionMessage: 'complexity-error in service.mjs' },
  affectedFiles: ['src/service.mjs'],
  reproSteps: 'Run eslint src/service.mjs',
  correlationId: null,
  sliceRef: null,
  discoveredAt: '2026-05-19T08:00:00.000Z',
  updatedAt: '2026-05-20T09:00:00.000Z',
};

const BUG_FIXED_LOW = {
  bugId: 'bug-2026-05-19-001',
  fingerprint: 'ccddee001122334455667788990011cc',
  scanner: 'vitest',
  severity: 'low',
  status: 'fixed',
  classification: 'real-bug',
  classifierMeta: null,
  evidence: { testName: 'reads config', assertionMessage: null },
  affectedFiles: [],
  reproSteps: null,
  correlationId: null,
  sliceRef: null,
  discoveredAt: '2026-05-19T06:00:00.000Z',
  updatedAt: '2026-05-19T12:00:00.000Z',
};

// ─── Workspace helpers ────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'pforge-sdk-bug-reader-'));
  const bugsPath = join(cwd, '.forge', 'bugs');
  mkdirSync(bugsPath, { recursive: true });
  return { cwd, bugsPath };
}

function writeBugFile(bugsPath, bug) {
  writeFileSync(join(bugsPath, `${bug.bugId}.json`), JSON.stringify(bug, null, 2), 'utf-8');
}

let tmpDirs = [];

beforeEach(() => { tmpDirs = []; });
afterEach(() => {
  for (const d of tmpDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function workspace() {
  const w = makeTmpWorkspace();
  tmpDirs.push(w.cwd);
  return w;
}

// ─── BUGS_DIR_RELATIVE ────────────────────────────────────────────────────────

describe('BUGS_DIR_RELATIVE', () => {
  it('is a non-empty string', () => {
    expect(typeof BUGS_DIR_RELATIVE).toBe('string');
    expect(BUGS_DIR_RELATIVE.length).toBeGreaterThan(0);
  });

  it('contains ".forge" and "bugs"', () => {
    const n = BUGS_DIR_RELATIVE.replace(/\\/g, '/');
    expect(n).toContain('.forge');
    expect(n).toContain('bugs');
  });
});

// ─── BUG_STATUSES ─────────────────────────────────────────────────────────────

describe('BUG_STATUSES', () => {
  it('is a frozen array', () => {
    expect(Array.isArray(BUG_STATUSES)).toBe(true);
    expect(Object.isFrozen(BUG_STATUSES)).toBe(true);
  });

  it('contains exactly the known statuses', () => {
    expect(BUG_STATUSES).toContain('open');
    expect(BUG_STATUSES).toContain('in-fix');
    expect(BUG_STATUSES).toContain('fixed');
    expect(BUG_STATUSES).toContain('wont-fix');
    expect(BUG_STATUSES).toContain('duplicate');
  });

  it('has 5 entries', () => {
    expect(BUG_STATUSES.length).toBe(5);
  });
});

// ─── BUG_SEVERITIES ──────────────────────────────────────────────────────────

describe('BUG_SEVERITIES', () => {
  it('is a frozen array', () => {
    expect(Array.isArray(BUG_SEVERITIES)).toBe(true);
    expect(Object.isFrozen(BUG_SEVERITIES)).toBe(true);
  });

  it('contains the known severity levels', () => {
    expect(BUG_SEVERITIES).toContain('info');
    expect(BUG_SEVERITIES).toContain('low');
    expect(BUG_SEVERITIES).toContain('medium');
    expect(BUG_SEVERITIES).toContain('high');
    expect(BUG_SEVERITIES).toContain('critical');
  });

  it('orders info before critical', () => {
    expect(BUG_SEVERITIES.indexOf('info')).toBeLessThan(BUG_SEVERITIES.indexOf('critical'));
  });
});

// ─── bugsDir ──────────────────────────────────────────────────────────────────

describe('bugsDir', () => {
  it('returns an absolute path containing ".forge/bugs"', () => {
    const d = bugsDir({ cwd: '/workspace' });
    expect(d.replace(/\\/g, '/')).toContain('.forge/bugs');
  });

  it('falls back to process.cwd() when cwd is omitted', () => {
    const d = bugsDir();
    expect(d.length).toBeGreaterThan(0);
    expect(d.replace(/\\/g, '/')).toContain('.forge/bugs');
  });

  it('uses the supplied cwd', () => {
    const d = bugsDir({ cwd: '/my/project' });
    const n = d.replace(/\\/g, '/');
    expect(n).toContain('/my/project');
    expect(n).toContain('bugs');
  });
});

// ─── bugFilePath ──────────────────────────────────────────────────────────────

describe('bugFilePath', () => {
  it('produces a path ending with <bugId>.json', () => {
    const p = bugFilePath({ bugId: 'bug-2026-05-20-001', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toMatch(/bug-2026-05-20-001\.json$/);
  });

  it('places the file under .forge/bugs/', () => {
    const p = bugFilePath({ bugId: 'bug-2026-05-20-001', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toContain('.forge/bugs/');
  });

  it('uses process.cwd() when cwd is omitted', () => {
    const p = bugFilePath({ bugId: 'bug-2026-05-20-001' });
    expect(p.replace(/\\/g, '/')).toContain('bug-2026-05-20-001.json');
  });

  it('produces different paths for different bug IDs', () => {
    const a = bugFilePath({ bugId: 'bug-2026-05-20-001', cwd: '/w' });
    const b = bugFilePath({ bugId: 'bug-2026-05-20-002', cwd: '/w' });
    expect(a).not.toBe(b);
  });
});

// ─── parseBugId ──────────────────────────────────────────────────────────────

describe('parseBugId', () => {
  it('extracts the bug ID from a valid filename', () => {
    expect(parseBugId('bug-2026-05-20-001.json')).toBe('bug-2026-05-20-001');
  });

  it('handles 4-digit sequence numbers', () => {
    expect(parseBugId('bug-2026-05-20-1234.json')).toBe('bug-2026-05-20-1234');
  });

  it('returns null for non-string input', () => {
    expect(parseBugId(null)).toBeNull();
    expect(parseBugId(undefined)).toBeNull();
    expect(parseBugId(42)).toBeNull();
  });

  it('returns null for a file missing the .json extension', () => {
    expect(parseBugId('bug-2026-05-20-001')).toBeNull();
  });

  it('returns null for unrelated filenames', () => {
    expect(parseBugId('notes.json')).toBeNull();
    expect(parseBugId('digest-2026-05-20.json')).toBeNull();
    expect(parseBugId('.tmp')).toBeNull();
  });

  it('returns null for a filename with wrong date format', () => {
    expect(parseBugId('bug-2026-5-20-001.json')).toBeNull();
  });
});

// ─── listBugs ─────────────────────────────────────────────────────────────────

describe('listBugs — empty / missing directory', () => {
  it('returns [] when .forge/bugs/ does not exist', () => {
    const { cwd } = workspace();
    // Remove the bugs dir that makeTmpWorkspace created
    rmSync(join(cwd, '.forge', 'bugs'), { recursive: true, force: true });
    expect(listBugs({ cwd })).toEqual([]);
  });

  it('returns [] when the bugs directory is empty', () => {
    const { cwd } = workspace();
    expect(listBugs({ cwd })).toEqual([]);
  });
});

describe('listBugs — populated directory', () => {
  it('returns all bugs when no filter is applied', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    writeBugFile(bugsPath, BUG_FIXED_LOW);
    expect(listBugs({ cwd })).toHaveLength(3);
  });

  it('sorts newest-discovered first', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_FIXED_LOW);   // oldest
    writeBugFile(bugsPath, BUG_INFIX_HIGH);  // middle
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL); // newest
    const result = listBugs({ cwd });
    expect(result[0].bugId).toBe('bug-2026-05-20-001');
    expect(result[2].bugId).toBe('bug-2026-05-19-001');
  });

  it('filters by status', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    writeBugFile(bugsPath, BUG_FIXED_LOW);
    const openBugs = listBugs({ cwd, status: 'open' });
    expect(openBugs).toHaveLength(1);
    expect(openBugs[0].bugId).toBe('bug-2026-05-20-001');
  });

  it('filters by severity', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    writeBugFile(bugsPath, BUG_FIXED_LOW);
    const critical = listBugs({ cwd, severity: 'critical' });
    expect(critical).toHaveLength(1);
    expect(critical[0].bugId).toBe('bug-2026-05-20-001');
  });

  it('filters by scanner', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL); // vitest
    writeBugFile(bugsPath, BUG_INFIX_HIGH);    // eslint
    writeBugFile(bugsPath, BUG_FIXED_LOW);     // vitest
    const eslintBugs = listBugs({ cwd, scanner: 'eslint' });
    expect(eslintBugs).toHaveLength(1);
    expect(eslintBugs[0].scanner).toBe('eslint');
  });

  it('filters by since', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL); // 2026-05-20T10:00
    writeBugFile(bugsPath, BUG_INFIX_HIGH);    // 2026-05-19T08:00
    writeBugFile(bugsPath, BUG_FIXED_LOW);     // 2026-05-19T06:00
    const recent = listBugs({ cwd, since: '2026-05-20T00:00:00.000Z' });
    expect(recent).toHaveLength(1);
    expect(recent[0].bugId).toBe('bug-2026-05-20-001');
  });

  it('filters by until', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL); // 2026-05-20T10:00
    writeBugFile(bugsPath, BUG_INFIX_HIGH);    // 2026-05-19T08:00
    writeBugFile(bugsPath, BUG_FIXED_LOW);     // 2026-05-19T06:00
    const old = listBugs({ cwd, until: '2026-05-19T23:59:59.999Z' });
    expect(old).toHaveLength(2);
  });

  it('combines multiple filters (AND semantics)', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    writeBugFile(bugsPath, BUG_FIXED_LOW);
    const result = listBugs({ cwd, scanner: 'vitest', status: 'open' });
    expect(result).toHaveLength(1);
    expect(result[0].bugId).toBe('bug-2026-05-20-001');
  });

  it('returns [] when no bugs match the filter', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    expect(listBugs({ cwd, status: 'duplicate' })).toEqual([]);
  });

  it('skips non-bug JSON files silently', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeFileSync(join(bugsPath, 'notes.json'), '{"note":"ignored"}', 'utf-8');
    expect(listBugs({ cwd })).toHaveLength(1);
  });

  it('skips malformed JSON files silently', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeFileSync(join(bugsPath, 'bug-2026-05-20-002.json'), 'INVALID JSON', 'utf-8');
    expect(listBugs({ cwd })).toHaveLength(1);
  });

  it('skips JSON array files silently', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeFileSync(join(bugsPath, 'bug-2026-05-20-003.json'), '[1,2,3]', 'utf-8');
    expect(listBugs({ cwd })).toHaveLength(1);
  });
});

// ─── readBug ──────────────────────────────────────────────────────────────────

describe('readBug', () => {
  it('reads a valid bug by ID', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    const result = readBug({ bugId: 'bug-2026-05-20-001', cwd });
    expect(result).not.toBeNull();
    expect(result.bugId).toBe('bug-2026-05-20-001');
    expect(result.status).toBe('open');
    expect(result.severity).toBe('critical');
  });

  it('returns null for a missing file', () => {
    const { cwd } = workspace();
    expect(readBug({ bugId: 'bug-2026-05-20-999', cwd })).toBeNull();
  });

  it('returns null for an empty bugId', () => {
    const { cwd } = workspace();
    expect(readBug({ bugId: '', cwd })).toBeNull();
    expect(readBug({ bugId: '   ', cwd })).toBeNull();
  });

  it('returns null for a non-string bugId', () => {
    const { cwd } = workspace();
    expect(readBug({ bugId: null, cwd })).toBeNull();
    expect(readBug({ bugId: undefined, cwd })).toBeNull();
    expect(readBug({ bugId: 42, cwd })).toBeNull();
  });

  it('returns null when called with no args', () => {
    expect(readBug()).toBeNull();
  });

  it('rejects path-traversal bugIds', () => {
    const { cwd } = workspace();
    expect(readBug({ bugId: '../secrets', cwd })).toBeNull();
    expect(readBug({ bugId: '../../etc/passwd', cwd })).toBeNull();
  });

  it('returns null for a malformed JSON file', () => {
    const { cwd, bugsPath } = workspace();
    writeFileSync(join(bugsPath, 'bug-2026-05-20-001.json'), 'NOT JSON', 'utf-8');
    expect(readBug({ bugId: 'bug-2026-05-20-001', cwd })).toBeNull();
  });

  it('returns null for a bugId that does not match the expected pattern', () => {
    const { cwd } = workspace();
    expect(readBug({ bugId: 'arbitrary-name', cwd })).toBeNull();
  });

  it('preserves all fields from the bug record', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    const result = readBug({ bugId: 'bug-2026-05-20-002', cwd });
    expect(result.scanner).toBe('eslint');
    expect(result.classification).toBe('real-bug');
    expect(result.classifierMeta).toEqual({ confidence: 0.95 });
    expect(result.affectedFiles).toEqual(['src/service.mjs']);
  });
});

// ─── summarizeBugs ───────────────────────────────────────────────────────────

describe('summarizeBugs — empty input', () => {
  it('returns zero counts for an empty array', () => {
    const s = summarizeBugs([]);
    expect(s.total).toBe(0);
    expect(s.byStatus).toEqual({});
    expect(s.bySeverity).toEqual({});
    expect(s.scanners).toEqual([]);
  });

  it('returns zero counts for a non-array', () => {
    expect(summarizeBugs(null)).toEqual({ total: 0, byStatus: {}, bySeverity: {}, scanners: [] });
    expect(summarizeBugs(undefined)).toEqual({ total: 0, byStatus: {}, bySeverity: {}, scanners: [] });
    expect(summarizeBugs('bad')).toEqual({ total: 0, byStatus: {}, bySeverity: {}, scanners: [] });
  });
});

describe('summarizeBugs — populated', () => {
  it('counts total correctly', () => {
    const s = summarizeBugs([BUG_OPEN_CRITICAL, BUG_INFIX_HIGH, BUG_FIXED_LOW]);
    expect(s.total).toBe(3);
  });

  it('counts by status', () => {
    const s = summarizeBugs([BUG_OPEN_CRITICAL, BUG_INFIX_HIGH, BUG_FIXED_LOW]);
    expect(s.byStatus['open']).toBe(1);
    expect(s.byStatus['in-fix']).toBe(1);
    expect(s.byStatus['fixed']).toBe(1);
  });

  it('counts by severity', () => {
    const s = summarizeBugs([BUG_OPEN_CRITICAL, BUG_INFIX_HIGH, BUG_FIXED_LOW]);
    expect(s.bySeverity['critical']).toBe(1);
    expect(s.bySeverity['high']).toBe(1);
    expect(s.bySeverity['low']).toBe(1);
  });

  it('lists unique scanners, sorted', () => {
    const s = summarizeBugs([BUG_OPEN_CRITICAL, BUG_INFIX_HIGH, BUG_FIXED_LOW]);
    expect(s.scanners).toEqual(['eslint', 'vitest']);
  });

  it('deduplicates scanners', () => {
    const s = summarizeBugs([BUG_OPEN_CRITICAL, BUG_FIXED_LOW]); // both vitest
    expect(s.scanners).toEqual(['vitest']);
  });

  it('aggregates multiple bugs of same status', () => {
    const extra = { ...BUG_OPEN_CRITICAL, bugId: 'bug-2026-05-20-004', fingerprint: 'x' };
    const s = summarizeBugs([BUG_OPEN_CRITICAL, extra]);
    expect(s.byStatus['open']).toBe(2);
    expect(s.total).toBe(2);
  });

  it('skips non-object items in the array without throwing', () => {
    const s = summarizeBugs([BUG_OPEN_CRITICAL, null, undefined, 42, 'bad']);
    expect(s.total).toBe(5);
    expect(s.byStatus['open']).toBe(1);
  });
});

// ─── Round-trip integration ────────────────────────────────────────────────────

describe('round-trip', () => {
  it('listBugs then readBug returns the same data', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    const bugs = listBugs({ cwd });
    for (const bug of bugs) {
      const byId = readBug({ bugId: bug.bugId, cwd });
      expect(byId).not.toBeNull();
      expect(byId.bugId).toBe(bug.bugId);
    }
  });

  it('summarizeBugs reflects listBugs results', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    writeBugFile(bugsPath, BUG_FIXED_LOW);
    const bugs = listBugs({ cwd });
    const summary = summarizeBugs(bugs);
    expect(summary.total).toBe(bugs.length);
  });

  it('listBugs({status}) + summarizeBugs shows consistent counts', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    writeBugFile(bugsPath, BUG_INFIX_HIGH);
    writeBugFile(bugsPath, BUG_FIXED_LOW);
    const openBugs = listBugs({ cwd, status: 'open' });
    const s = summarizeBugs(openBugs);
    expect(s.total).toBe(openBugs.length);
    expect(s.byStatus['open']).toBe(openBugs.length);
  });

  it('write-read-filter round trip preserves all fields', () => {
    const { cwd, bugsPath } = workspace();
    writeBugFile(bugsPath, BUG_OPEN_CRITICAL);
    const [bug] = listBugs({ cwd, scanner: 'vitest', status: 'open' });
    expect(bug).toBeDefined();
    expect(bug.evidence.testName).toBe('should pass');
    expect(bug.affectedFiles).toEqual(['src/foo.mjs']);
    expect(bug.discoveredAt).toBe('2026-05-20T10:00:00.000Z');
  });
});
