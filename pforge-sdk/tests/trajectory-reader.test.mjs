/**
 * trajectory-reader.test.mjs — Unit tests for pforge-sdk/src/trajectory-reader.mjs
 *
 * Uses temporary directories for I/O tests so no real .forge/ state is required.
 * Run with: npx vitest run pforge-sdk/tests/trajectory-reader.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TRAJECTORIES_DIR_RELATIVE,
  countWords,
  trajectoriesDir,
  planTrajectoriesDir,
  trajectoryFilePath,
  parseSliceId,
  listPlans,
  listTrajectories,
  readTrajectory,
  readAllTrajectories,
  summarizeTrajectories,
} from '../src/trajectory-reader.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PLAN_A = 'Phase-42-CLEAN-CODE-AUDIT-PLAN';
const PLAN_B = 'Phase-AUTH-RBAC-SCAFFOLD-PLAN';

const SLICE_1_CONTENT = `I created the initial module skeleton. The core decision was to keep the \
auth dispatcher thin — a plain function switch over provider names rather than a class registry. \
This keeps unit tests simple and avoids inheritance complexity. Bearer extraction normalises the \
Authorization header to lowercase before stripping the prefix, matching the existing secrets.mjs \
pattern for case-insensitive env-var lookups. Total changes: three new files, one new test suite.`;

const SLICE_2_CONTENT = `Wired the middleware into the MCP tool dispatch path. The key constraint \
was backward compatibility — when no auth config is present the middleware must pass through \
without touching the request. I tested this by running the existing 37 tests before and after \
the change; all pass. The RBAC resolver now receives the authenticate result and enforces \
tool-level permissions defined in .forge/rbac.json. Missing rbac.json defaults to allow-all.`;

// ─── Workspace helpers ────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'pforge-sdk-trajectory-'));
  const trajDir = join(cwd, '.forge', 'trajectories');
  mkdirSync(trajDir, { recursive: true });
  return { cwd, trajDir };
}

function makePlanDir(trajDir, planName) {
  const planDir = join(trajDir, planName);
  mkdirSync(planDir, { recursive: true });
  return planDir;
}

function writeSlice(planDir, sliceId, content) {
  writeFileSync(join(planDir, `slice-${sliceId}.md`), content, 'utf-8');
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

// ─── TRAJECTORIES_DIR_RELATIVE ────────────────────────────────────────────────

describe('TRAJECTORIES_DIR_RELATIVE', () => {
  it('is a non-empty string', () => {
    expect(typeof TRAJECTORIES_DIR_RELATIVE).toBe('string');
    expect(TRAJECTORIES_DIR_RELATIVE.length).toBeGreaterThan(0);
  });

  it('contains ".forge" and "trajectories"', () => {
    const n = TRAJECTORIES_DIR_RELATIVE.replace(/\\/g, '/');
    expect(n).toContain('.forge');
    expect(n).toContain('trajectories');
  });
});

// ─── countWords ───────────────────────────────────────────────────────────────

describe('countWords', () => {
  it('counts single words', () => {
    expect(countWords('hello')).toBe(1);
  });

  it('counts space-separated words', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('handles multiple spaces between words', () => {
    expect(countWords('one  two   three')).toBe(3);
  });

  it('returns 0 for an empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for a whitespace-only string', () => {
    expect(countWords('   ')).toBe(0);
  });

  it('returns 0 for non-string input', () => {
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords(42)).toBe(0);
  });
});

// ─── trajectoriesDir ─────────────────────────────────────────────────────────

describe('trajectoriesDir', () => {
  it('returns an absolute path containing ".forge/trajectories"', () => {
    const d = trajectoriesDir({ cwd: '/workspace' });
    expect(d.replace(/\\/g, '/')).toContain('.forge/trajectories');
  });

  it('falls back to process.cwd() when cwd is omitted', () => {
    const d = trajectoriesDir();
    expect(d.length).toBeGreaterThan(0);
    expect(d.replace(/\\/g, '/')).toContain('.forge/trajectories');
  });

  it('uses the supplied cwd', () => {
    const d = trajectoriesDir({ cwd: '/my/project' });
    const n = d.replace(/\\/g, '/');
    expect(n).toContain('/my/project');
    expect(n).toContain('trajectories');
  });
});

// ─── planTrajectoriesDir ──────────────────────────────────────────────────────

describe('planTrajectoriesDir', () => {
  it('returns a path under .forge/trajectories containing the plan name', () => {
    const d = planTrajectoriesDir({ planBasename: PLAN_A, cwd: '/w' });
    const n = d.replace(/\\/g, '/');
    expect(n).toContain('.forge/trajectories');
    expect(n).toContain(PLAN_A);
  });

  it('throws when planBasename is missing', () => {
    expect(() => planTrajectoriesDir({ cwd: '/w' })).toThrow(TypeError);
  });

  it('throws when planBasename is an empty string', () => {
    expect(() => planTrajectoriesDir({ planBasename: '', cwd: '/w' })).toThrow(TypeError);
  });

  it('sanitizes path traversal in planBasename', () => {
    const d = planTrajectoriesDir({ planBasename: '../../evil', cwd: '/w' });
    expect(d.replace(/\\/g, '/')).not.toContain('..');
  });
});

// ─── trajectoryFilePath ───────────────────────────────────────────────────────

describe('trajectoryFilePath', () => {
  it('produces a path ending with slice-<id>.md', () => {
    const p = trajectoryFilePath({ planBasename: PLAN_A, sliceId: '3', cwd: '/w' });
    expect(p.replace(/\\/g, '/')).toMatch(/slice-3\.md$/);
  });

  it('places the file under .forge/trajectories/<plan>/', () => {
    const p = trajectoryFilePath({ planBasename: PLAN_A, sliceId: '3', cwd: '/w' });
    const n = p.replace(/\\/g, '/');
    expect(n).toContain('.forge/trajectories');
    expect(n).toContain(PLAN_A);
  });

  it('uses process.cwd() when cwd is omitted', () => {
    const p = trajectoryFilePath({ planBasename: PLAN_A, sliceId: '1' });
    expect(p.replace(/\\/g, '/')).toContain('slice-1.md');
  });

  it('produces different paths for different slice IDs', () => {
    const a = trajectoryFilePath({ planBasename: PLAN_A, sliceId: '1', cwd: '/w' });
    const b = trajectoryFilePath({ planBasename: PLAN_A, sliceId: '2', cwd: '/w' });
    expect(a).not.toBe(b);
  });

  it('throws when planBasename is missing', () => {
    expect(() => trajectoryFilePath({ sliceId: '1' })).toThrow(TypeError);
  });

  it('throws when sliceId is missing', () => {
    expect(() => trajectoryFilePath({ planBasename: PLAN_A })).toThrow(TypeError);
  });
});

// ─── parseSliceId ─────────────────────────────────────────────────────────────

describe('parseSliceId', () => {
  it('extracts numeric slice ID', () => {
    expect(parseSliceId('slice-1.md')).toBe('1');
    expect(parseSliceId('slice-12.md')).toBe('12');
    expect(parseSliceId('slice-100.md')).toBe('100');
  });

  it('extracts alphanumeric slice ID', () => {
    expect(parseSliceId('slice-S3.md')).toBe('S3');
    expect(parseSliceId('slice-abc.md')).toBe('abc');
  });

  it('returns null for non-string input', () => {
    expect(parseSliceId(null)).toBeNull();
    expect(parseSliceId(undefined)).toBeNull();
    expect(parseSliceId(42)).toBeNull();
  });

  it('returns null for a file missing the .md extension', () => {
    expect(parseSliceId('slice-1')).toBeNull();
    expect(parseSliceId('slice-1.txt')).toBeNull();
  });

  it('returns null for unrelated filenames', () => {
    expect(parseSliceId('notes.md')).toBeNull();
    expect(parseSliceId('run.json')).toBeNull();
    expect(parseSliceId('.tmp')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseSliceId('')).toBeNull();
  });
});

// ─── listPlans ────────────────────────────────────────────────────────────────

describe('listPlans — missing trajectories directory', () => {
  it('returns [] when .forge/trajectories/ does not exist', () => {
    const { cwd, trajDir } = workspace();
    rmSync(trajDir, { recursive: true, force: true });
    expect(listPlans({ cwd })).toEqual([]);
  });
});

describe('listPlans — populated trajectories directory', () => {
  it('returns plan names sorted alphabetically', () => {
    const { cwd, trajDir } = workspace();
    makePlanDir(trajDir, PLAN_B);
    makePlanDir(trajDir, PLAN_A);
    const plans = listPlans({ cwd });
    expect(plans).toHaveLength(2);
    expect(plans[0]).toBe(PLAN_A); // A < B
    expect(plans[1]).toBe(PLAN_B);
  });

  it('excludes files (non-directories) from the list', () => {
    const { cwd, trajDir } = workspace();
    makePlanDir(trajDir, PLAN_A);
    writeFileSync(join(trajDir, 'not-a-plan.md'), 'noise', 'utf-8');
    expect(listPlans({ cwd })).toEqual([PLAN_A]);
  });

  it('returns [] for an empty trajectories directory', () => {
    const { cwd } = workspace();
    expect(listPlans({ cwd })).toEqual([]);
  });
});

// ─── listTrajectories ─────────────────────────────────────────────────────────

describe('listTrajectories — missing plan directory', () => {
  it('returns [] when plan directory does not exist', () => {
    const { cwd } = workspace();
    expect(listTrajectories({ planBasename: PLAN_A, cwd })).toEqual([]);
  });

  it('returns [] when planBasename is missing', () => {
    expect(listTrajectories({ cwd: '/w' })).toEqual([]);
  });
});

describe('listTrajectories — populated plan directory', () => {
  it('returns entries sorted numerically by slice ID', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '3', SLICE_2_CONTENT);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    writeSlice(planDir, '12', 'Slice twelve content here.');
    const entries = listTrajectories({ planBasename: PLAN_A, cwd });
    expect(entries.map((e) => e.sliceId)).toEqual(['1', '3', '12']);
  });

  it('includes sliceId, path, and wordCount for each entry', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    const entries = listTrajectories({ planBasename: PLAN_A, cwd });
    expect(entries).toHaveLength(1);
    expect(entries[0].sliceId).toBe('1');
    expect(typeof entries[0].path).toBe('string');
    expect(entries[0].wordCount).toBeGreaterThan(0);
  });

  it('wordCount matches countWords output', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    const entries = listTrajectories({ planBasename: PLAN_A, cwd });
    expect(entries[0].wordCount).toBe(countWords(SLICE_1_CONTENT));
  });

  it('skips non-slice-N.md files silently', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    writeFileSync(join(planDir, 'notes.txt'), 'ignored', 'utf-8');
    writeFileSync(join(planDir, 'README.md'), 'also ignored', 'utf-8');
    expect(listTrajectories({ planBasename: PLAN_A, cwd })).toHaveLength(1);
  });

  it('returns [] for an empty plan directory', () => {
    const { cwd, trajDir } = workspace();
    makePlanDir(trajDir, PLAN_A);
    expect(listTrajectories({ planBasename: PLAN_A, cwd })).toEqual([]);
  });
});

// ─── readTrajectory ───────────────────────────────────────────────────────────

describe('readTrajectory', () => {
  it('returns { sliceId, content, wordCount } for an existing file', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    const note = readTrajectory({ planBasename: PLAN_A, sliceId: '1', cwd });
    expect(note).not.toBeNull();
    expect(note.sliceId).toBe('1');
    expect(note.content).toBe(SLICE_1_CONTENT);
    expect(note.wordCount).toBe(countWords(SLICE_1_CONTENT));
  });

  it('returns null when the file does not exist', () => {
    const { cwd } = workspace();
    expect(readTrajectory({ planBasename: PLAN_A, sliceId: '99', cwd })).toBeNull();
  });

  it('returns null when planBasename is missing', () => {
    expect(readTrajectory({ sliceId: '1', cwd: '/w' })).toBeNull();
  });

  it('returns null when sliceId is missing', () => {
    expect(readTrajectory({ planBasename: PLAN_A, cwd: '/w' })).toBeNull();
  });

  it('accepts numeric sliceId', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '2', SLICE_2_CONTENT);
    const note = readTrajectory({ planBasename: PLAN_A, sliceId: 2, cwd });
    expect(note).not.toBeNull();
    expect(note.sliceId).toBe('2');
  });

  it('returns null when planBasename is empty string', () => {
    expect(readTrajectory({ planBasename: '', sliceId: '1' })).toBeNull();
  });
});

// ─── readAllTrajectories ──────────────────────────────────────────────────────

describe('readAllTrajectories', () => {
  it('returns all slices in ascending numeric order', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '3', SLICE_2_CONTENT);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    writeSlice(planDir, '2', 'Middle slice.');
    const notes = readAllTrajectories({ planBasename: PLAN_A, cwd });
    expect(notes.map((n) => n.sliceId)).toEqual(['1', '2', '3']);
  });

  it('includes sliceId, content, and wordCount for each entry', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    const notes = readAllTrajectories({ planBasename: PLAN_A, cwd });
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe(SLICE_1_CONTENT);
    expect(notes[0].wordCount).toBe(countWords(SLICE_1_CONTENT));
  });

  it('returns [] when the plan directory does not exist', () => {
    const { cwd } = workspace();
    expect(readAllTrajectories({ planBasename: PLAN_A, cwd })).toEqual([]);
  });

  it('returns [] when planBasename is missing', () => {
    expect(readAllTrajectories({ cwd: '/w' })).toEqual([]);
  });

  it('returns [] for an empty plan directory', () => {
    const { cwd, trajDir } = workspace();
    makePlanDir(trajDir, PLAN_A);
    expect(readAllTrajectories({ planBasename: PLAN_A, cwd })).toEqual([]);
  });

  it('skips non-slice files', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    writeFileSync(join(planDir, 'other.md'), 'noise', 'utf-8');
    expect(readAllTrajectories({ planBasename: PLAN_A, cwd })).toHaveLength(1);
  });
});

// ─── summarizeTrajectories ────────────────────────────────────────────────────

describe('summarizeTrajectories — empty / invalid input', () => {
  it('returns zero summary for empty array', () => {
    expect(summarizeTrajectories([])).toEqual({
      total: 0, sliceIds: [], totalWords: 0, avgWords: 0,
    });
  });

  it('returns zero summary for null input', () => {
    expect(summarizeTrajectories(null)).toEqual({
      total: 0, sliceIds: [], totalWords: 0, avgWords: 0,
    });
  });

  it('returns zero summary for non-array input', () => {
    expect(summarizeTrajectories('not an array')).toEqual({
      total: 0, sliceIds: [], totalWords: 0, avgWords: 0,
    });
  });
});

describe('summarizeTrajectories — single entry', () => {
  it('computes correct stats for one entry', () => {
    const entries = [{ sliceId: '1', content: SLICE_1_CONTENT, wordCount: countWords(SLICE_1_CONTENT) }];
    const summary = summarizeTrajectories(entries);
    expect(summary.total).toBe(1);
    expect(summary.sliceIds).toEqual(['1']);
    expect(summary.totalWords).toBe(countWords(SLICE_1_CONTENT));
    expect(summary.avgWords).toBe(countWords(SLICE_1_CONTENT));
  });
});

describe('summarizeTrajectories — multiple entries', () => {
  it('totals word counts across entries', () => {
    const entries = [
      { sliceId: '1', wordCount: 100 },
      { sliceId: '2', wordCount: 200 },
      { sliceId: '3', wordCount: 300 },
    ];
    const summary = summarizeTrajectories(entries);
    expect(summary.total).toBe(3);
    expect(summary.totalWords).toBe(600);
    expect(summary.avgWords).toBe(200);
  });

  it('includes all sliceIds in order', () => {
    const entries = [
      { sliceId: '1', wordCount: 50 },
      { sliceId: '2', wordCount: 50 },
    ];
    const summary = summarizeTrajectories(entries);
    expect(summary.sliceIds).toEqual(['1', '2']);
  });

  it('rounds avgWords to the nearest integer', () => {
    const entries = [
      { sliceId: '1', wordCount: 100 },
      { sliceId: '2', wordCount: 101 },
      { sliceId: '3', wordCount: 102 },
    ];
    const summary = summarizeTrajectories(entries);
    expect(Number.isInteger(summary.avgWords)).toBe(true);
    expect(summary.avgWords).toBe(101);
  });

  it('uses listTrajectories output (path + wordCount only)', () => {
    const { cwd, trajDir } = workspace();
    const planDir = makePlanDir(trajDir, PLAN_A);
    writeSlice(planDir, '1', SLICE_1_CONTENT);
    writeSlice(planDir, '2', SLICE_2_CONTENT);
    const entries = listTrajectories({ planBasename: PLAN_A, cwd });
    const summary = summarizeTrajectories(entries);
    expect(summary.total).toBe(2);
    expect(summary.totalWords).toBeGreaterThan(0);
  });
});
