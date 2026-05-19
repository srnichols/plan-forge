#!/usr/bin/env node

/**
 * Aggregated clean-code review runner.
 * Executes all audit scripts and merges results into a single report.
 *
 * Usage:
 *   node scripts/audit/clean-code-review.mjs [--fix-suggestions] [--out <path>]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const rawDir = path.join(root, 'docs', 'plans', 'cleanup-findings', 'raw');

const args = process.argv.slice(2);
const fixSuggestions = args.includes('--fix-suggestions');
const outIndex = args.indexOf('--out');
const outPath = outIndex !== -1 ? args[outIndex + 1] : null;

function runScript(scriptPath) {
  try {
    execFileSync(process.execPath, [scriptPath], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function suggestModuleSizeFix(finding) {
  if (finding.g14Severity === 'high-severity') {
    return `Split ${finding.file} by responsibility — extract cohesive function groups into separate modules`;
  }
  return `Monitor ${finding.file} — extract helpers on the next feature touch`;
}

function suggestParamFix(finding) {
  return `Wrap positional args in an options object: ${finding.callee}({ ... }) at ${finding.file}:${finding.line}`;
}

function suggestMarkerFix(marker) {
  return `Convert to a tracked issue via forge_bug_file or remove if resolved: ${marker.file}:${marker.line}`;
}

function suggestCommentedCodeFix(block) {
  return `Delete lines ${block.startLine}–${block.endLine} in ${block.file} — code is preserved in git history`;
}

const scripts = [
  { name: 'measure-modules', path: path.join(root, 'scripts', 'audit', 'measure-modules.mjs') },
  { name: 'grep-matrix', path: path.join(root, 'scripts', 'audit', 'grep-matrix.mjs') },
  { name: 'long-param-walker', path: path.join(root, 'scripts', 'audit', 'long-param-walker.mjs') }
];

const report = {
  timestamp: new Date().toISOString(),
  categories: {},
  errors: [],
  summary: { totalErrors: 0, totalWarnings: 0 }
};

for (const script of scripts) {
  if (!fs.existsSync(script.path)) {
    report.errors.push({ script: script.name, message: 'Script not found' });
    continue;
  }
  const result = runScript(script.path);
  if (!result.ok) {
    report.errors.push({ script: script.name, message: result.error });
  }
}

const moduleMetrics = loadJson(path.join(rawDir, 'module-metrics.json'));
if (Array.isArray(moduleMetrics)) {
  const findings = moduleMetrics
    .filter((m) => m.g14Severity)
    .map((m) => ({
      file: m.file,
      loc: m.loc,
      severity: m.g14Severity === 'high-severity' ? 'error' : 'warn',
      ...(fixSuggestions ? { fix: suggestModuleSizeFix(m) } : {})
    }));

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  report.categories['module-size'] = { errorCount, warnCount, findings };
  report.summary.totalErrors += errorCount;
  report.summary.totalWarnings += warnCount;
}

const grepMatrix = loadJson(path.join(rawDir, 'grep-matrix-report.json'));
if (grepMatrix) {
  const markers = [
    ...(grepMatrix.todos ?? []),
    ...(grepMatrix.fixmes ?? []),
    ...(grepMatrix.hacks ?? []),
    ...(grepMatrix.xxxs ?? [])
  ].map((m) => ({
    ...m,
    severity: 'warn',
    ...(fixSuggestions ? { fix: suggestMarkerFix(m) } : {})
  }));

  const commentedCode = (grepMatrix.commentedCodeBlocks ?? []).map((b) => ({
    ...b,
    severity: 'warn',
    ...(fixSuggestions ? { fix: suggestCommentedCodeFix(b) } : {})
  }));

  report.categories['markers'] = {
    errorCount: 0,
    warnCount: markers.length,
    findings: markers
  };
  report.categories['commented-code'] = {
    errorCount: 0,
    warnCount: commentedCode.length,
    findings: commentedCode
  };
  report.categories['console-log'] = {
    advisory: true,
    count: grepMatrix.consoleLogs?.count ?? 0,
    note: grepMatrix.consoleLogs?.bulkNote ?? 'Bulk advisory'
  };
  report.summary.totalWarnings += markers.length + commentedCode.length;
}

const longParams = loadJson(path.join(rawDir, 'long-param-report.json'));
if (Array.isArray(longParams)) {
  const findings = longParams.map((f) => ({
    ...f,
    severity: f.argCount > 6 ? 'error' : 'warn',
    ...(fixSuggestions ? { fix: suggestParamFix(f) } : {})
  }));

  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  report.categories['long-params'] = { errorCount, warnCount, findings };
  report.summary.totalErrors += errorCount;
  report.summary.totalWarnings += warnCount;
}

if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Report written to: ${outPath}`);
} else {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Clean Code Review');
  console.log(`  ${report.timestamp}`);
  console.log('══════════════════════════════════════════════');

  for (const [category, data] of Object.entries(report.categories)) {
    if (data.advisory) {
      console.log(`  ${category.padEnd(20)} │ advisory: ${data.count}`);
      continue;
    }
    console.log(`  ${category.padEnd(20)} │ errors: ${data.errorCount}  warnings: ${data.warnCount}`);
  }

  console.log('──────────────────────────────────────────────');
  console.log(`  Total: ${report.summary.totalErrors} errors, ${report.summary.totalWarnings} warnings`);
  console.log('══════════════════════════════════════════════\n');

  if (report.errors.length > 0) {
    console.log('Script errors:');
    for (const err of report.errors) {
      console.log(`  ⚠ ${err.script}: ${err.message}`);
    }
  }
}
