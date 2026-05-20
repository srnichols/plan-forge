/**
 * Plan Forge — Phase-55 Slice 0: clean-code no-regression gate.
 *
 * Runs the consolidated clean-code-review audit script against the
 * current working tree and asserts that the error count has not risen
 * above the baseline captured at the start of Phase-55.
 *
 * Warnings are explicitly allowed to move in either direction — only
 * errors are gated. A new ESLint complexity-error or module-size-error
 * introduced by any slice will cause this test to fail immediately.
 *
 * Two tests:
 *  1. Fast fixture check — baseline JSON exists and has totalErrors === 4.
 *  2. Full audit run — fresh results must not exceed baseline error count.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const AUDIT_SCRIPT = resolve(REPO_ROOT, 'scripts/audit/clean-code-review.mjs');
const BASELINE_PATH = resolve(
  REPO_ROOT,
  'docs/plans/cleanup-findings/raw/clean-code-review-baseline-phase-55.json'
);

describe('clean-code no-regression gate (Phase-55)', () => {
  it('baseline fixture exists and has totalErrors === 4', () => {
    expect(existsSync(BASELINE_PATH), `baseline fixture missing at:\n  ${BASELINE_PATH}`).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    expect(baseline).toHaveProperty('summary');
    expect(baseline.summary.totalErrors, 'baseline totalErrors should be 4').toBe(4);
  });

  it(
    'fresh audit produces no more errors than baseline',
    { timeout: 180_000 },
    () => {
      const tmpOut = join(tmpdir(), `pf55-clean-code-${Date.now()}-${process.pid}.json`);
      try {
        const result = spawnSync(
          process.execPath,
          [AUDIT_SCRIPT, '--out', tmpOut],
          { cwd: REPO_ROOT, encoding: 'utf8', timeout: 150_000 }
        );

        if (result.error) throw result.error;
        if (result.status !== 0) {
          throw new Error(
            `Audit script exited with code ${result.status}:\n` +
            `stdout: ${result.stdout}\nstderr: ${result.stderr}`
          );
        }

        expect(
          existsSync(tmpOut),
          'audit script produced no output file — check for script errors above'
        ).toBe(true);

        const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
        const current = JSON.parse(readFileSync(tmpOut, 'utf8'));

        if (current.summary.totalErrors > baseline.summary.totalErrors) {
          const delta = current.summary.totalErrors - baseline.summary.totalErrors;
          const errorEntries = Object.entries(current.categories)
            .filter(([, v]) => (v.errorCount ?? 0) > 0)
            .map(([k, v]) => `  ${k}: ${v.errorCount} error(s)`)
            .join('\n');
          throw new Error(
            `REGRESSION: ${delta} new error(s) introduced beyond baseline.\n` +
            `  Baseline: ${baseline.summary.totalErrors} errors\n` +
            `  Current:  ${current.summary.totalErrors} errors\n` +
            (errorEntries ? `Error categories:\n${errorEntries}` : '')
          );
        }

        expect(current.summary.totalErrors).toBeLessThanOrEqual(baseline.summary.totalErrors);
      } finally {
        try { if (existsSync(tmpOut)) unlinkSync(tmpOut); } catch { /* ignore cleanup errors */ }
      }
    }
  );
});
