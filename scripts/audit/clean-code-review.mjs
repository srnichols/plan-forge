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

function suggestDeadExportFix(finding) {
  return `Delete unused export \`${finding.name}\` in ${finding.file}:${finding.line} or wire a consumer`;
}

function suggestTestSmellFix(finding) {
  const smell = finding.smell;
  if (smell === 'FOCUS-LEAK') return `Remove \`.only\` in ${finding.file}:${finding.line} — would skip every other test in the file`;
  if (smell === 'TIME-FLAKE') return `Wrap with vi.useFakeTimers() or add an explicit tolerance comment in ${finding.file}:${finding.line}`;
  if (smell === 'TAUTOLOGY' || smell === 'EMPTY-TEST') return `Replace the placeholder assertion in ${finding.file}:${finding.line} with a real one (or convert to .todo)`;
  return `Review and remove the smell in ${finding.file}:${finding.line}`;
}

function suggestShellParityFix(finding) {
  if (finding.kind === 'MISSING-TWIN') {
    return `Add ${finding.base}.${finding.missing} (twin of ${finding.present.file})`;
  }
  return `Re-align ${finding.base} — ${finding.ps1.lines} vs ${finding.sh.lines} lines suggests one shell is a stub`;
}

function suggestDepBoundaryFix(finding) {
  if (finding.kind === 'BLOCKED') return `Remove or relocate import at ${finding.source}:${finding.line} — ${finding.sourcePackage} must not depend on ${finding.targetPackage}`;
  if (finding.kind === 'NEEDS-WHITELIST') return `Add "${finding.source} -> ${finding.target}" to layer-policy.json#crossPackageWhitelist or refactor the dependency away`;
  return `Review cross-package import at ${finding.source}:${finding.line}`;
}

function suggestFrozenArraysFix(finding, file) {
  if (finding.kind === 'HARD-DRIFT') return `Replace hand-typed "${finding.literal}" with the ${finding.enum} constant in ${file}:${finding.line}`;
  return `Consider importing ${finding.enum} and replacing hand-typed "${finding.literal}" in ${file}:${finding.line}`;
}

function suggestEslintFix(msg, file) {
  if (msg.ruleId === 'clean-code/complexity-error' || msg.ruleId === 'clean-code/complexity-warn') {
    return `Extract helper functions from the complex function at ${file}:${msg.line} to reduce cyclomatic complexity below threshold`;
  }
  if (msg.ruleId === 'clean-code/max-lines-per-function-error' || msg.ruleId === 'clean-code/max-lines-per-function-warn') {
    return `Split the long function at ${file}:${msg.line} into smaller, named helpers (each ≤100 lines ideally, ≤300 required)`;
  }
  if (msg.ruleId === 'clean-code/max-params-error' || msg.ruleId === 'clean-code/max-params-warn') {
    return `Wrap the positional parameters at ${file}:${msg.line} in an options object`;
  }
  return `Fix ESLint violation '${msg.ruleId}' at ${file}:${msg.line}`;
}

const scripts = [
  { name: 'measure-modules', path: path.join(root, 'scripts', 'audit', 'measure-modules.mjs') },
  { name: 'grep-matrix', path: path.join(root, 'scripts', 'audit', 'grep-matrix.mjs') },
  { name: 'run-eslint-clean-code', path: path.join(root, 'scripts', 'audit', 'run-eslint-clean-code.mjs') },
  { name: 'long-param-walker', path: path.join(root, 'scripts', 'audit', 'long-param-walker.mjs') },
  { name: 'dead-exports', path: path.join(root, 'scripts', 'audit', 'dead-exports.mjs') },
  { name: 'test-smells', path: path.join(root, 'scripts', 'audit', 'test-smells.mjs') },
  { name: 'shell-parity', path: path.join(root, 'scripts', 'audit', 'shell-parity.mjs') },
  { name: 'dep-boundaries', path: path.join(root, 'scripts', 'audit', 'dep-boundaries.mjs') },
  { name: 'frozen-arrays-drift', path: path.join(root, 'scripts', 'audit', 'frozen-arrays-drift.mjs') }
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

const deadExports = loadJson(path.join(rawDir, 'dead-exports-report.json'));
if (deadExports && Array.isArray(deadExports.findings)) {
  const findings = deadExports.findings.flatMap((file) =>
    (file.deadExports ?? []).map((exp) => ({
      file: file.file,
      name: exp.name,
      line: exp.line,
      severity: 'warn',
      ...(fixSuggestions ? { fix: suggestDeadExportFix({ file: file.file, name: exp.name, line: exp.line }) } : {})
    }))
  );
  report.categories['dead-exports'] = { errorCount: 0, warnCount: findings.length, findings };
  report.summary.totalWarnings += findings.length;
}

const testSmells = loadJson(path.join(rawDir, 'test-smells-report.json'));
if (testSmells && Array.isArray(testSmells.findings)) {
  const findings = testSmells.findings.flatMap((file) =>
    file.findings.map((s) => ({
      file: file.file,
      smell: s.smell,
      line: s.line,
      snippet: s.snippet,
      severity: s.severity,
      ...(fixSuggestions ? { fix: suggestTestSmellFix({ file: file.file, smell: s.smell, line: s.line }) } : {})
    }))
  );
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  report.categories['test-smells'] = { errorCount, warnCount, findings };
  report.summary.totalErrors += errorCount;
  report.summary.totalWarnings += warnCount;
}

const shellParity = loadJson(path.join(rawDir, 'shell-parity-report.json'));
if (shellParity && Array.isArray(shellParity.findings)) {
  const findings = shellParity.findings.map((f) => ({
    base: f.base,
    kind: f.kind,
    severity: f.severity,
    requiredPair: f.requiredPair,
    ...(fixSuggestions ? { fix: suggestShellParityFix(f) } : {})
  }));
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  report.categories['shell-parity'] = { errorCount, warnCount, findings };
  report.summary.totalErrors += errorCount;
  report.summary.totalWarnings += warnCount;
}

const depBoundaries = loadJson(path.join(rawDir, 'dep-boundaries-report.json'));
if (depBoundaries && Array.isArray(depBoundaries.findings)) {
  const findings = depBoundaries.findings.map((f) => ({
    source: f.source,
    line: f.line,
    target: f.target,
    kind: f.kind,
    severity: f.severity,
    ...(fixSuggestions ? { fix: suggestDepBoundaryFix(f) } : {})
  }));
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  report.categories['dep-boundaries'] = { errorCount, warnCount, findings };
  report.summary.totalErrors += errorCount;
  report.summary.totalWarnings += warnCount;
}

const frozenArrays = loadJson(path.join(rawDir, 'frozen-arrays-drift-report.json'));
if (frozenArrays && Array.isArray(frozenArrays.findings)) {
  const findings = frozenArrays.findings.flatMap((file) =>
    file.findings.map((d) => ({
      file: file.file,
      enum: d.enum,
      literal: d.literal,
      line: d.line,
      kind: d.kind,
      severity: d.severity,
      ...(fixSuggestions ? { fix: suggestFrozenArraysFix(d, file.file) } : {})
    }))
  );
  const warnCount = findings.filter((f) => f.severity === 'warn').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  report.categories['frozen-arrays-drift'] = {
    errorCount: 0,
    warnCount,
    infoCount,
    findings
  };
  report.summary.totalWarnings += warnCount;
}

// D-series: ESLint clean-code violations (complexity-error, max-lines-per-function-error, max-params-error)
const eslintReport = loadJson(path.join(rawDir, 'eslint-report.json'));
if (Array.isArray(eslintReport)) {
  const dSeriesErrorRules = new Set([
    'clean-code/complexity-error',
    'clean-code/max-lines-per-function-error',
    'clean-code/max-params-error'
  ]);
  const dSeriesWarnRules = new Set([
    'clean-code/complexity-warn',
    'clean-code/max-lines-per-function-warn',
    'clean-code/max-params-warn'
  ]);

  const errorFindings = [];
  const warnFindings = [];

  for (const fileResult of eslintReport) {
    for (const msg of fileResult.messages) {
      const finding = {
        file: fileResult.filePath,
        line: msg.line,
        column: msg.column,
        ruleId: msg.ruleId,
        message: msg.message,
        severity: msg.severity === 2 ? 'error' : 'warn',
        ...(fixSuggestions ? { fix: suggestEslintFix(msg, fileResult.filePath) } : {})
      };
      if (msg.severity === 2 && dSeriesErrorRules.has(msg.ruleId)) {
        errorFindings.push(finding);
      } else if (msg.severity === 1 && dSeriesWarnRules.has(msg.ruleId)) {
        warnFindings.push(finding);
      }
    }
  }

  report.categories['eslint-d-series'] = {
    errorCount: errorFindings.length,
    warnCount: warnFindings.length,
    findings: [...errorFindings, ...warnFindings]
  };
  report.summary.totalErrors += errorFindings.length;
  report.summary.totalWarnings += warnFindings.length;
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
