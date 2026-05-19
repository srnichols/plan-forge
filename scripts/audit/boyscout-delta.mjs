// Boy Scout delta scanner.
//
// Operationalises the Boy Scout Rule from
// .github/instructions/architecture-principles.instructions.md:
//
//   "Every commit that touches a file must leave it in a better state."
//
// For every source file touched in the working diff (HEAD vs merge-base),
// compare ESLint violation counts at base-version vs HEAD-version. Surface
// any file where the count of clean-code violations did not strictly
// decrease — i.e. the file was edited but no Boy Scout improvement landed.
//
// Output: docs/plans/cleanup-findings/raw/boyscout-delta-report.json
//
// Usage:
//   node scripts/audit/boyscout-delta.mjs
//   node scripts/audit/boyscout-delta.mjs --base origin/master
//   node scripts/audit/boyscout-delta.mjs --base HEAD~1 --include "pforge-mcp/**"
//
// Exits 0 always; the skill aggregator decides severity.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'plans', 'cleanup-findings', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'boyscout-delta-report.json');
const ESLINT_CONFIG = path.join('scripts', 'audit', 'eslint-clean-code.config.mjs');

const TRACKED_RULES = new Set([
  'complexity-error',
  'complexity-warn',
  'max-lines-per-function-error',
  'max-lines-per-function-warn',
  'max-params-error',
  'max-params-warn',
  'max-depth',
  'max-nested-callbacks',
  'no-magic-numbers'
]);

function parseArgs(argv) {
  const args = { base: null, include: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--base') {
      args.base = argv[++i];
    } else if (token === '--include') {
      args.include = argv[++i];
    }
  }
  return args;
}

function run(cmd, cmdArgs, options = {}) {
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8', cwd: ROOT, ...options });
}

function resolveBase(explicitBase) {
  if (explicitBase) {
    return explicitBase;
  }
  // Prefer planning/main, fall back to master, then HEAD~1.
  for (const candidate of ['origin/planning/main', 'planning/main', 'origin/master', 'master']) {
    const result = run('git', ['merge-base', 'HEAD', candidate]);
    if (result.status === 0 && result.stdout.trim().length > 0) {
      return result.stdout.trim();
    }
  }
  const fallback = run('git', ['rev-parse', 'HEAD~1']);
  return fallback.status === 0 ? fallback.stdout.trim() : 'HEAD~1';
}

function listChangedFiles(baseRef, includeGlob) {
  const result = run('git', ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`]);
  if (result.status !== 0) {
    return [];
  }
  const allFiles = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const filtered = allFiles.filter((file) => file.endsWith('.mjs') || file.endsWith('.js'));
  if (!includeGlob) {
    return filtered;
  }
  const includeRegex = globToRegex(includeGlob);
  return filtered.filter((file) => includeRegex.test(file));
}

function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLESTAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLESTAR::/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function eslintCountForSource(source, virtualPath) {
  // Use --stdin / --stdin-filename so the existing flat config's `files: ['pforge-mcp/**/*.mjs', ...]`
  // glob still matches via the virtual path; avoids writing temp files outside the project tree.
  const result = run('npx', [
    '--yes',
    'eslint',
    '--config', ESLINT_CONFIG,
    '--format', 'json',
    '--stdin',
    '--stdin-filename', virtualPath
  ], { shell: process.platform === 'win32', input: source });
  if (!result.stdout) {
    return { perRule: {}, total: 0, error: result.stderr?.trim() ?? 'no eslint output' };
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (parseErr) {
    return { perRule: {}, total: 0, error: `eslint json parse failed: ${parseErr.message}` };
  }
  const perRule = {};
  for (const fileReport of parsed) {
    for (const message of fileReport.messages ?? []) {
      const ruleId = message.ruleId;
      if (!ruleId || !TRACKED_RULES.has(ruleId)) {
        continue;
      }
      perRule[ruleId] = (perRule[ruleId] ?? 0) + 1;
    }
  }
  const total = Object.values(perRule).reduce((sum, count) => sum + count, 0);
  return { perRule, total };
}

function readFileAtRef(ref, file) {
  const result = run('git', ['show', `${ref}:${file}`]);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function buildDelta(file, beforeCount, afterCount) {
  const perRuleDelta = {};
  const ruleKeys = new Set([
    ...Object.keys(beforeCount.perRule),
    ...Object.keys(afterCount.perRule)
  ]);
  for (const rule of ruleKeys) {
    const before = beforeCount.perRule[rule] ?? 0;
    const after = afterCount.perRule[rule] ?? 0;
    if (before !== after) {
      perRuleDelta[rule] = { before, after, delta: after - before };
    }
  }
  return {
    file,
    totalBefore: beforeCount.total,
    totalAfter: afterCount.total,
    totalDelta: afterCount.total - beforeCount.total,
    perRuleDelta
  };
}

function classify(delta) {
  if (delta.totalDelta < 0) {
    return 'improved';
  }
  if (delta.totalDelta === 0 && delta.totalBefore === 0) {
    return 'clean';
  }
  if (delta.totalDelta === 0) {
    return 'boy-scout-violation';
  }
  return 'regression';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseRef = resolveBase(args.base);
  const files = listChangedFiles(baseRef, args.include);

  const findings = [];
  const errors = [];

  for (const file of files) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      // File was deleted at HEAD; skip — not a Boy Scout case.
      continue;
    }
    const beforeSource = readFileAtRef(baseRef, file);
    if (beforeSource === null) {
      // New file at HEAD; nothing to compare against.
      findings.push({
        file,
        classification: 'new-file',
        totalBefore: 0,
        totalAfter: null,
        totalDelta: null,
        perRuleDelta: {}
      });
      continue;
    }
    const afterSource = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const beforeCount = eslintCountForSource(beforeSource, file);
    if (beforeCount.error) {
      errors.push({ file, phase: 'before', message: beforeCount.error });
      continue;
    }
    const afterCount = eslintCountForSource(afterSource, file);
    if (afterCount.error) {
      errors.push({ file, phase: 'after', message: afterCount.error });
      continue;
    }
    const delta = buildDelta(file, beforeCount, afterCount);
    delta.classification = classify(delta);
    findings.push(delta);
  }

  const summary = {
    base: baseRef,
    head: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
    timestamp: new Date().toISOString(),
    fileCount: files.length,
    counts: {
      improved: findings.filter((finding) => finding.classification === 'improved').length,
      clean: findings.filter((finding) => finding.classification === 'clean').length,
      boyScoutViolation: findings.filter((finding) => finding.classification === 'boy-scout-violation').length,
      regression: findings.filter((finding) => finding.classification === 'regression').length,
      newFile: findings.filter((finding) => finding.classification === 'new-file').length
    },
    findings,
    errors
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2), 'utf8');

  const violations = findings.filter((finding) => finding.classification === 'boy-scout-violation' || finding.classification === 'regression');
  console.log(`Boy Scout delta: base=${baseRef.substring(0, 10)} files=${files.length}`);
  console.log(`  improved: ${summary.counts.improved}`);
  console.log(`  clean:    ${summary.counts.clean}`);
  console.log(`  bs-viol:  ${summary.counts.boyScoutViolation}`);
  console.log(`  regress:  ${summary.counts.regression}`);
  console.log(`  new:      ${summary.counts.newFile}`);
  for (const finding of violations) {
    const rules = Object.entries(finding.perRuleDelta)
      .map(([rule, deltaInfo]) => `${rule} ${deltaInfo.before}->${deltaInfo.after}`)
      .join(', ');
    const detail = rules || `total ${finding.totalBefore}->${finding.totalAfter}`;
    console.log(`  ${finding.classification}: ${finding.file} (${detail})`);
  }
  if (errors.length > 0) {
    console.warn(`  ${errors.length} eslint error(s); see ${path.relative(ROOT, OUT_FILE)}`);
  }
  console.log(`Report: ${path.relative(ROOT, OUT_FILE)}`);
}

main();
