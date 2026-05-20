#!/usr/bin/env node

/**
 * ESLint clean-code audit runner.
 *
 * Runs the eslint-clean-code.config.mjs rules via the ESLint CLI (CJS path)
 * to avoid the @eslint/eslintrc / ajv incompatibility when importing ESLint
 * as an ES module under Node.js 24+ (eslintrc-universal.cjs requires ajv 6
 * but uses module-resolution that can resolve the root ajv@8 in some envs).
 *
 * Output: docs/plans/cleanup-findings/raw/eslint-report.json
 * Schema: ESLint JSON formatter array (each item = { filePath, messages[], errorCount, warningCount })
 *
 * Usage:
 *   node scripts/audit/run-eslint-clean-code.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const outFile = path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw', 'eslint-report.json');
const configPath = path.join(root, 'scripts', 'audit', 'eslint-clean-code.config.mjs');
const eslintBin = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');

const scanGlobs = [
  'pforge-mcp/**/*.mjs',
  'pforge-master/**/*.mjs',
  'scripts/**/*.mjs'
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

ensureDir(path.dirname(outFile));

// Run ESLint via the CLI (CJS entry point) to avoid ESM/ajv interop issue
const result = spawnSync(
  process.execPath,
  [eslintBin, '--config', configPath, '--format', 'json', ...scanGlobs],
  {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // ESLint exits 1 when it finds violations, which is expected
    shell: false
  }
);

// ESLint returns exit code 0 (no issues), 1 (lint violations), or 2 (fatal error)
if (result.status === 2 || (result.status !== 0 && result.status !== 1)) {
  const stderr = result.stderr || '';
  const msg = stderr.trim() || (result.error ? result.error.message : 'unknown error');
  console.error('ESLint fatal error (exit', result.status, '):', msg.slice(0, 300));
  // Write an empty report so downstream consumers don't crash
  fs.writeFileSync(outFile, JSON.stringify([], null, 2), 'utf8');
  process.exit(0);
}

let parsed;
try {
  parsed = JSON.parse(result.stdout || '[]');
} catch (e) {
  console.error('Failed to parse ESLint JSON output:', e.message);
  fs.writeFileSync(outFile, JSON.stringify([], null, 2), 'utf8');
  process.exit(0);
}

// Normalise file paths to repo-relative posix so the report is portable
const repoRoot = root.replace(/\\/g, '/');
const normalised = parsed.map((fileResult) => ({
  ...fileResult,
  filePath: fileResult.filePath.replace(/\\/g, '/').replace(repoRoot + '/', '')
}));

fs.writeFileSync(outFile, JSON.stringify(normalised, null, 2) + '\n', 'utf8');

const totalErrors = normalised.reduce((s, f) => s + f.errorCount, 0);
const totalWarnings = normalised.reduce((s, f) => s + f.warningCount, 0);
console.log(`ESLint: ${totalErrors} errors, ${totalWarnings} warnings across ${normalised.length} files → ${outFile}`);
