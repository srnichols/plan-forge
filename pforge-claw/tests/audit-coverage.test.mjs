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
