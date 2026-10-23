#!/usr/bin/env node

/**
 * ESLint clean-code audit runner.
 *
 * Runs the eslint-clean-code.config.mjs rules through the installed ESLint CLI
 * (`node <entry>`, the CJS path) rather than importing ESLint as an ES module,
 * which hits the @eslint/eslintrc / ajv incompatibility under Node.js 24+.
 *
 * Output: docs/plans/cleanup-findings/raw/eslint-report.json
 * Schema: ESLint JSON formatter array (each item = { filePath, messages[], errorCount, warningCount })
 *
 * Exit code: 0 whenever ESLint ran, with or without violations (this reports, it
 * does not gate); 1 when ESLint itself failed. A failed run leaves no report, so an
 * empty report always means zero violations (meta-bug #370).
 *
 * Usage (from the repo root):
 *   node scripts/audit/run-eslint-clean-code.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { auditRawDir } from './raw-dir.mjs';
import { runInstalledBin } from './run-installed-bin.mjs';
import { auditGlobs } from './scan-roots.mjs';

const root = process.cwd();
const outFile = path.join(auditRawDir(root), 'eslint-report.json');
const configPath = path.join(root, 'scripts', 'audit', 'eslint-clean-code.config.mjs');

const scanGlobs = auditGlobs('run-eslint-clean-code');

// ESLint exits 1 when it found violations. Any other non-zero status is a failed run.
const VIOLATIONS_FOUND = 1;
const STDERR_EXCERPT_CHARS = 300;

function withStderr(message, stderr) {
  const excerpt = stderr.trim().slice(0, STDERR_EXCERPT_CHARS);
  return excerpt ? `${message}: ${excerpt}` : message;
}

// Runs ESLint and returns its report array, or { error } when it did not produce one.
function scan() {
  // A report left by an earlier run must not stand in for this one.
  fs.rmSync(outFile, { force: true });

  const result = runInstalledBin({
    root,
    pkg: 'eslint',
    args: ['--config', configPath, '--format', 'json', ...scanGlobs]
  });
  if (!result.ok && result.status !== VIOLATIONS_FOUND) {
    return { error: withStderr(result.error, result.stderr) };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    // Exit 1 with nothing on stdout is a crash, not a clean run.
    return { error: withStderr(`ESLint output is not JSON (${error.message})`, result.stderr) };
  }
  if (!Array.isArray(parsed)) {
    return { error: 'ESLint output is not a report array' };
  }
  return { report: parsed };
}

function writeReport(report) {
  // Normalise file paths to repo-relative posix so the report is portable
  const repoRoot = root.replace(/\\/g, '/');
  const normalised = report.map((fileResult) => ({
    ...fileResult,
    filePath: fileResult.filePath.replace(/\\/g, '/').replace(repoRoot + '/', '')
  }));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(normalised, null, 2) + '\n', 'utf8');

  const totalErrors = normalised.reduce((s, f) => s + f.errorCount, 0);
  const totalWarnings = normalised.reduce((s, f) => s + f.warningCount, 0);
  console.log(`ESLint: ${totalErrors} errors, ${totalWarnings} warnings across ${normalised.length} files → ${outFile}`);
}

const { report, error } = scan();
if (error) {
  console.error(`ESLint scan failed: ${error}`);
  process.exitCode = 1;
} else {
  writeReport(report);
}
