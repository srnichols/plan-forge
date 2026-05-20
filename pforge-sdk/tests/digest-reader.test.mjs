/**
 * digest-reader.test.mjs — Unit tests for pforge-sdk/src/digest-reader.mjs
 *
 * Uses temporary directories for I/O tests so no real .forge/ state is required.
 * Run with: npx vitest run pforge-sdk/tests/digest-reader.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DIGESTS_DIR_RELATIVE,
  SEVERITY_LEVELS,
  digestsDir,
  digestFilePath,
  listDigests,
  readDigest,
  readLatestDigest,
  overallSeverity,
  getSectionsByMinSeverity,
} from '../src/digest-reader.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SECTION_INFO = {
  id: 'probe-deltas',
  title: 'Probe Lane-Match Deltas',
  severity: 'info',
  items: [],
};

const SECTION_WARN = {
  id: 'aging-bugs',
  title: 'Aging Meta-Bugs',
  severity: 'warn',
  items: [{ id: 'bug-001', title: 'Old bug', ageDays: 10, severity: 'medium' }],
};

const SECTION_ALERT = {
  id: 'stalled-phases',
  title: 'Stalled Phases',
  severity: 'alert',
  items: [{ name: 'Phase-99', startDate: '2026-01-01', ageDays: 140 }],
};

const DIGEST_ALL_INFO = {
  sections: [
    SECTION_INFO,
    { id: 'aging-bugs', title: 'Aging Meta-Bugs', severity: 'info', items: [] },
    { id: 'stalled-phases', title: 'Stalled Phases', severity: 'info', items: [] },
    { id: 'drift-trend', title: 'Drift Trend', severity: 'info', items: [] },
    { id: 'cost-anomaly', title: 'Cost Anomaly', severity: 'info', items: [] },
  ],
  generatedAt: '2026-05-20T06:00:00.000Z',
};

const DIGEST_WITH_WARN = {
  sections: [SECTION_INFO, SECTION_WARN],
  generatedAt: '2026-05-19T06:00:00.000Z',
};

const DIGEST_WITH_ALERT = {
  sections: [SECTION_INFO, SECTION_WARN, SECTION_ALERT],
  generatedAt: '2026-05-18T06:00:00.000Z',
};

// ─── Workspace helpers ────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'pforge-sdk-digest-reader-'));
  const digestPath = join(cwd, '.forge', 'digests');
  mkdirSync(digestPath, { recursive: true });
  return { cwd, digestPath };
}

function writeDigestFile(digestPath, date, digest) {
  writeFileSync(join(digestPath, `${date}.json`), JSON.stringify(digest, null, 2), 'utf-8');
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('DIGESTS_DIR_RELATIVE', () => {
  it('is a non-empty string', () => {
    expect(typeof DIGESTS_DIR_RELATIVE).toBe('string');
    expect(DIGESTS_DIR_RELATIVE.length).toBeGreaterThan(0);
  });

  it('contains ".forge" and "digests"', () => {
    const normalized = DIGESTS_DIR_RELATIVE.replace(/\\/g, '/');
    expect(normalized).toContain('.forge');
    expect(normalized).toContain('digests');
  });
});

describe('SEVERITY_LEVELS', () => {
  it('is a frozen array', () => {
    expect(Array.isArray(SEVERITY_LEVELS)).toBe(true);
    expect(Object.isFrozen(SEVERITY_LEVELS)).toBe(true);
  });

  it('contains info, warn, and alert in ascending order', () => {
    expect(SEVERITY_LEVELS[0]).toBe('info');
    expect(SEVERITY_LEVELS[1]).toBe('warn');
    expect(SEVERITY_LEVELS[2]).toBe('alert');
  });

  it('has exactly three levels', () => {
    expect(SEVERITY_LEVELS).toHaveLength(3);
  });
});

// ─── Path helpers ─────────────────────────────────────────────────────────────

describe('digestsDir', () => {
  it('returns an absolute path containing ".forge/digests"', () => {
    const d = digestsDir({ cwd: '/workspace' });
    expect(d.replace(/\\/g, '/')).toContain('.forge/digests');
  });

  it('falls back to process.cwd() when cwd is omitted', () => {
    const d = digestsDir();
    expect(d.length).toBeGreaterThan(0);
    expect(d.replace(/\\/g, '/')).toContain('.forge/digests');
  });

  it('uses the supplied cwd', () => {
    const d = digestsDir({ cwd: '/my/project' });
    const n = d.replace(/\\/g, '/');
    expect(n).toContain('/my/project');
    expect(n).toContain('digests');
  });
});

describe('digestFilePath', () => {
  it('produces a path ending with the date .json', () => {
    const p = digestFilePath({ date: '2026-05-20', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toMatch(/2026-05-20\.json$/);
  });

  it('places the file under .forge/digests/', () => {
    const p = digestFilePath({ date: '2026-05-20', cwd: '/workspace' });
    expect(p.replace(/\\/g, '/')).toContain('.forge/digests/');
  });

  it('uses process.cwd() when cwd is omitted', () => {
    const p = digestFilePath({ date: '2026-01-01' });
    expect(p.replace(/\\/g, '/')).toContain('2026-01-01.json');
  });

  it('produces different paths for different dates', () => {
    const a = digestFilePath({ date: '2026-05-20', cwd: '/w' });
    const b = digestFilePath({ date: '2026-05-19', cwd: '/w' });
    expect(a).not.toBe(b);
  });
});

// ─── listDigests ──────────────────────────────────────────────────────────────

describe('listDigests', () => {
  let cwd;
  let digestPath;

  beforeEach(() => {
    ({ cwd, digestPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns empty array when .forge/digests/ does not exist', () => {
    rmSync(digestPath, { recursive: true, force: true });
    expect(listDigests({ cwd })).toEqual([]);
  });

  it('returns empty array when directory is empty', () => {
    expect(listDigests({ cwd })).toEqual([]);
  });

  it('returns date strings for digest files present', () => {
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);
    const dates = listDigests({ cwd });
    expect(dates).toContain('2026-05-20');
  });

  it('returns dates sorted newest-first', () => {
    writeDigestFile(digestPath, '2026-05-18', DIGEST_ALL_INFO);
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);
    writeDigestFile(digestPath, '2026-05-19', DIGEST_ALL_INFO);
    const dates = listDigests({ cwd });
    expect(dates).toEqual(['2026-05-20', '2026-05-19', '2026-05-18']);
  });

  it('ignores files that do not match YYYY-MM-DD.json pattern', () => {
    writeFileSync(join(digestPath, 'README.md'), '# Digests');
    writeFileSync(join(digestPath, 'temp.json'), '{}');
    writeFileSync(join(digestPath, '20260520.json'), '{}');
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);
    const dates = listDigests({ cwd });
    expect(dates).toEqual(['2026-05-20']);
  });

  it('returns date strings without the .json extension', () => {
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);
    const dates = listDigests({ cwd });
    for (const d of dates) {
      expect(d).not.toMatch(/\.json$/);
    }
  });
});

// ─── readDigest ───────────────────────────────────────────────────────────────

describe('readDigest', () => {
  let cwd;
  let digestPath;

  beforeEach(() => {
    ({ cwd, digestPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', () => {
    expect(readDigest({ date: '2026-05-20', cwd })).toBeNull();
  });

  it('returns null when date is not provided', () => {
    expect(readDigest({})).toBeNull();
    expect(readDigest()).toBeNull();
  });

  it('returns null when date is empty string', () => {
    expect(readDigest({ date: '', cwd })).toBeNull();
  });

  it('returns null when date is not a string', () => {
    expect(readDigest({ date: 42, cwd })).toBeNull();
    expect(readDigest({ date: null, cwd })).toBeNull();
  });

  it('returns the parsed digest object', () => {
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);
    const digest = readDigest({ date: '2026-05-20', cwd });
    expect(digest).not.toBeNull();
    expect(Array.isArray(digest.sections)).toBe(true);
    expect(digest.generatedAt).toBe('2026-05-20T06:00:00.000Z');
  });

  it('returns null for a file containing invalid JSON', () => {
    writeFileSync(join(digestPath, '2026-05-20.json'), 'not valid json');
    expect(readDigest({ date: '2026-05-20', cwd })).toBeNull();
  });

  it('returns null for a file containing a JSON array', () => {
    writeFileSync(join(digestPath, '2026-05-20.json'), '[1,2,3]');
    expect(readDigest({ date: '2026-05-20', cwd })).toBeNull();
  });

  it('preserves the sections array', () => {
    writeDigestFile(digestPath, '2026-05-19', DIGEST_WITH_WARN);
    const digest = readDigest({ date: '2026-05-19', cwd });
    expect(digest.sections).toHaveLength(2);
    expect(digest.sections[1].severity).toBe('warn');
  });
});

// ─── readLatestDigest ─────────────────────────────────────────────────────────

describe('readLatestDigest', () => {
  let cwd;
  let digestPath;

  beforeEach(() => {
    ({ cwd, digestPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns null when no digests exist', () => {
    expect(readLatestDigest({ cwd })).toBeNull();
  });

  it('returns null when .forge/digests/ does not exist', () => {
    rmSync(digestPath, { recursive: true, force: true });
    expect(readLatestDigest({ cwd })).toBeNull();
  });

  it('returns the most recent digest when multiple exist', () => {
    writeDigestFile(digestPath, '2026-05-18', DIGEST_WITH_ALERT);
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);
    writeDigestFile(digestPath, '2026-05-19', DIGEST_WITH_WARN);
    const latest = readLatestDigest({ cwd });
    expect(latest).not.toBeNull();
    expect(latest.generatedAt).toBe('2026-05-20T06:00:00.000Z');
  });

  it('returns the single digest when only one exists', () => {
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);
    const latest = readLatestDigest({ cwd });
    expect(latest).not.toBeNull();
    expect(latest.generatedAt).toBe('2026-05-20T06:00:00.000Z');
  });

  it('returns null when latest file is unreadable JSON', () => {
    writeDigestFile(digestPath, '2026-05-18', DIGEST_ALL_INFO);
    writeFileSync(join(digestPath, '2026-05-20.json'), 'corrupt');
    expect(readLatestDigest({ cwd })).toBeNull();
  });
});

// ─── overallSeverity ──────────────────────────────────────────────────────────

describe('overallSeverity', () => {
  it('returns "info" for a digest with all info sections', () => {
    expect(overallSeverity(DIGEST_ALL_INFO)).toBe('info');
  });

  it('returns "warn" for a digest with a warn section', () => {
    expect(overallSeverity(DIGEST_WITH_WARN)).toBe('warn');
  });

  it('returns "alert" for a digest with an alert section', () => {
    expect(overallSeverity(DIGEST_WITH_ALERT)).toBe('alert');
  });

  it('returns "alert" even when other sections are info/warn', () => {
    const d = {
      sections: [SECTION_INFO, SECTION_ALERT, SECTION_WARN],
      generatedAt: '2026-05-20T00:00:00.000Z',
    };
    expect(overallSeverity(d)).toBe('alert');
  });

  it('returns "info" for an empty sections array', () => {
    expect(overallSeverity({ sections: [], generatedAt: '...' })).toBe('info');
  });

  it('returns "info" for a null digest', () => {
    expect(overallSeverity(null)).toBe('info');
  });

  it('returns "info" for an undefined digest', () => {
    expect(overallSeverity(undefined)).toBe('info');
  });

  it('returns "info" for a digest with no sections property', () => {
    expect(overallSeverity({ generatedAt: '...' })).toBe('info');
  });

  it('is pure — same input produces same result', () => {
    expect(overallSeverity(DIGEST_WITH_WARN)).toBe(overallSeverity(DIGEST_WITH_WARN));
  });
});

// ─── getSectionsByMinSeverity ─────────────────────────────────────────────────

describe('getSectionsByMinSeverity', () => {
  it('returns only sections at or above the given threshold', () => {
    const sections = getSectionsByMinSeverity(DIGEST_WITH_ALERT, 'warn');
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('aging-bugs');
    expect(ids).toContain('stalled-phases');
    expect(ids).not.toContain('probe-deltas');
  });

  it('returns alert sections only when threshold is "alert"', () => {
    const sections = getSectionsByMinSeverity(DIGEST_WITH_ALERT, 'alert');
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('stalled-phases');
  });

  it('returns all sections when threshold is "info"', () => {
    const sections = getSectionsByMinSeverity(DIGEST_WITH_ALERT, 'info');
    expect(sections).toHaveLength(DIGEST_WITH_ALERT.sections.length);
  });

  it('defaults to "warn" threshold', () => {
    const sections = getSectionsByMinSeverity(DIGEST_WITH_ALERT);
    const ids = sections.map((s) => s.id);
    expect(ids).toContain('aging-bugs');
    expect(ids).toContain('stalled-phases');
    expect(ids).not.toContain('probe-deltas');
  });

  it('returns empty array for a null digest', () => {
    expect(getSectionsByMinSeverity(null)).toEqual([]);
  });

  it('returns empty array for a digest with no sections', () => {
    expect(getSectionsByMinSeverity({ sections: [] })).toEqual([]);
  });

  it('returns empty array for an invalid threshold', () => {
    expect(getSectionsByMinSeverity(DIGEST_WITH_ALERT, 'critical')).toEqual([]);
  });

  it('returns empty array when no sections meet the threshold', () => {
    const sections = getSectionsByMinSeverity(DIGEST_ALL_INFO, 'warn');
    expect(sections).toEqual([]);
  });
});

// ─── Integration: round-trip ──────────────────────────────────────────────────

describe('round-trip: write then read', () => {
  let cwd;
  let digestPath;

  beforeEach(() => {
    ({ cwd, digestPath } = makeTmpWorkspace());
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('listDigests → readDigest pipeline works end-to-end', () => {
    writeDigestFile(digestPath, '2026-05-20', DIGEST_WITH_WARN);
    writeDigestFile(digestPath, '2026-05-19', DIGEST_ALL_INFO);

    const dates = listDigests({ cwd });
    expect(dates[0]).toBe('2026-05-20');

    const digest = readDigest({ date: dates[0], cwd });
    expect(digest).not.toBeNull();
    expect(overallSeverity(digest)).toBe('warn');
  });

  it('readLatestDigest + getSectionsByMinSeverity filters correctly', () => {
    writeDigestFile(digestPath, '2026-05-18', DIGEST_ALL_INFO);
    writeDigestFile(digestPath, '2026-05-20', DIGEST_WITH_ALERT);

    const latest = readLatestDigest({ cwd });
    expect(latest).not.toBeNull();
    expect(overallSeverity(latest)).toBe('alert');

    const alertSections = getSectionsByMinSeverity(latest, 'alert');
    expect(alertSections.length).toBeGreaterThan(0);
    expect(alertSections[0].severity).toBe('alert');
  });

  it('three-digest listing returns all dates newest-first', () => {
    writeDigestFile(digestPath, '2026-05-18', DIGEST_WITH_ALERT);
    writeDigestFile(digestPath, '2026-05-19', DIGEST_WITH_WARN);
    writeDigestFile(digestPath, '2026-05-20', DIGEST_ALL_INFO);

    const dates = listDigests({ cwd });
    expect(dates).toEqual(['2026-05-20', '2026-05-19', '2026-05-18']);

    const severities = dates.map((d) => overallSeverity(readDigest({ date: d, cwd })));
    expect(severities).toEqual(['info', 'warn', 'alert']);
  });
});
