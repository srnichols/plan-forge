import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPLEXITY_LIMIT = 20;
const PROCESS_TIMEOUT_MS = 30_000;

function lintProbe(branchCount) {
  const branches = Array.from(
    { length: branchCount },
    (_, index) => `if (value === ${index}) return ${index};`,
  ).join('\n');
  const child = spawnSync(process.execPath, [
    join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js'),
    '--config', join(repoRoot, 'scripts', 'audit', 'eslint-clean-code.config.mjs'),
    '--format', 'json',
    '--stdin',
    '--stdin-filename', join('pforge-claw', 'src', 'audit-coverage-probe.mjs'),
  ], {
    cwd: repoRoot,
    input: `function probe(value) {\n${branches}\nreturn -1;\n}\n`,
    encoding: 'utf8',
    timeout: PROCESS_TIMEOUT_MS,
  });
  expect(child.error).toBeUndefined();
  expect([0, 1]).toContain(child.status);
  return {
    status: child.status,
    messages: JSON.parse(child.stdout).flatMap((entry) => entry.messages),
  };
}

describe('Guard: Claw source uses the standard clean-code rules', () => {
  it('applies the warning rule without blocking complexity at the existing limit', () => {
    const report = lintProbe(COMPLEXITY_LIMIT - 1);
    expect(report.status).toBe(0);
    expect(report.messages.some((message) =>
      message.ruleId === 'clean-code/complexity-warn')).toBe(true);
    expect(report.messages.some((message) => message.severity === 2)).toBe(false);
  });

  it('blocks complexity above the existing limit on a real Claw filename', () => {
    const report = lintProbe(COMPLEXITY_LIMIT);
    expect(report.status).toBe(1);
    const violation = report.messages.find((message) =>
      message.ruleId === 'clean-code/complexity-error');
    expect(violation?.severity).toBe(2);
    expect(violation?.message).toContain(`Maximum allowed is ${COMPLEXITY_LIMIT}`);
  });

  it('includes Claw alongside the existing workspaces in the audit runner', () => {
    const source = readFileSync(
      join(repoRoot, 'scripts', 'audit', 'run-eslint-clean-code.mjs'), 'utf8',
    );
    for (const workspace of ['pforge-mcp', 'pforge-master', 'pforge-claw']) {
      expect(source).toContain(`'${workspace}/**/*.mjs'`);
    }
  });

  it('runs the same blocking lint command in Claw CI', () => {
    const source = readFileSync(
      join(repoRoot, '.github', 'workflows', 'pforge-claw.yml'), 'utf8',
    );
    expect(source).toContain(
      'node node_modules/eslint/bin/eslint.js --config scripts/audit/eslint-clean-code.config.mjs pforge-claw',
    );
  });
});

// A workspace missing from these lists is silently unlinted: Phase-62 added pforge-claw
// to the repository and no standard audit covered it until the owner found 75 errors
// across 44 files (meta-bug #340). An entry here is a decision with a reason, not an omission.
const LINT_EXEMPT = Object.freeze({
  'pforge-sdk': 'validateChunk (complexity 31, src/chunker.mjs) and validateProvenance (30, src/hallmark.mjs) exceed the limit of 20, so covering it needs a refactor first',
});

const workspaces = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).workspaces;
const globFor = (workspace) => `${workspace}/**/*.mjs`;
const uncovered = (patterns, { exempt = LINT_EXEMPT, among = workspaces } = {}) =>
  among.filter((workspace) => !patterns.includes(globFor(workspace)) && !Object.hasOwn(exempt, workspace));

function arrayLiteralStrings(source, declaration) {
  const match = source.match(new RegExp(`${declaration}\\s*[:=]\\s*\\[([\\s\\S]*?)\\]`));
  expect(match, `${declaration} should be an array literal`).not.toBeNull();
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe('Guard: every workspace is linted or explicitly exempt', () => {
  const auditSource = (name) => readFileSync(join(repoRoot, 'scripts', 'audit', name), 'utf8');
  // Read as text: a relative import out of the package is what the boundaries guard forbids.
  const lintPatterns = () => [
    ...arrayLiteralStrings(auditSource('eslint-clean-code.config.mjs'), 'files'),
  ];

  it('lists each workspace in the ESLint config files, or exempts it with a reason', () => {
    expect(uncovered(lintPatterns())).toEqual([]);
  });

  it('scans each workspace in the audit runner, or exempts it with a reason', () => {
    const globs = arrayLiteralStrings(auditSource('run-eslint-clean-code.mjs'), 'const scanGlobs');
    expect(uncovered(globs)).toEqual([]);
  });

  it('gives dep-boundaries a rule set for every workspace', () => {
    const packages = arrayLiteralStrings(auditSource('dep-boundaries.mjs'), 'const PACKAGES');
    expect(workspaces.filter((workspace) => !packages.includes(workspace))).toEqual([]);
  });

  it('keeps an exemption only for a workspace that exists and is still uncovered', () => {
    const patterns = [
      ...lintPatterns(),
      ...arrayLiteralStrings(auditSource('run-eslint-clean-code.mjs'), 'const scanGlobs'),
    ];
    for (const [workspace, reason] of Object.entries(LINT_EXEMPT)) {
      expect(workspaces, `${workspace} is exempt but is not a workspace`).toContain(workspace);
      expect(patterns, `${workspace} is now linted: drop its exemption`).not.toContain(globFor(workspace));
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('would report a workspace that appears in neither list', () => {
    const among = ['pforge-mcp', 'pforge-claw', 'pforge-new'];
    const patterns = [globFor('pforge-mcp'), globFor('pforge-claw')];
    expect(uncovered(patterns, { exempt: {}, among })).toEqual(['pforge-new']);
    expect(uncovered(patterns, { exempt: { 'pforge-new': 'reason' }, among })).toEqual([]);
    expect(uncovered([], { exempt: {}, among: [] })).toEqual([]);
  });
});

describe('Guard: the retired dashboard ignore does not hide Claw MCP source', () => {
  let fixtureRoot;

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'claw-ignore-guard-'));
    const child = spawnSync('git', ['init', '--quiet', fixtureRoot], {
      encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(0);
    writeFileSync(join(fixtureRoot, '.gitignore'),
      readFileSync(join(repoRoot, '.gitignore'), 'utf8'), 'utf8');
  });

  afterAll(() => {
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it.each([
    ['mcp/retired-dashboard-probe.mjs', 0],
    ['pforge-claw/src/mcp/project-client.mjs', 1],
  ])('preserves the intended ignore status for %s', (file, expectedStatus) => {
    const child = spawnSync('git', ['check-ignore', '--no-index', file], {
      cwd: fixtureRoot, encoding: 'utf8', timeout: PROCESS_TIMEOUT_MS,
    });
    expect(child.error).toBeUndefined();
    expect(child.status).toBe(expectedStatus);
  });
});
