// Test-smells scanner.
//
// Tests are infrastructure. Smelly tests rot the suite — flaky timing,
// focused tests slipping past CI, debug leakage, tautological assertions.
// Each of these has a documented "we got bitten by this" lineage in this
// project (Phase 41 S5 timeline-core +5ms tolerance flake being the canonical
// example).
//
// This script answers: "Which test files have known smells?"
//
// Smells detected (regex, no AST, no new deps):
//
//   FOCUS-LEAK     — `.only(` left in committed test (would skip every other test in the file under vitest)
//   SKIP-LEAK      — `.skip(` / `xit(` / `xtest(` / `xdescribe(` — silently disabled tests
//   TIME-FLAKE     — `setTimeout(`, `Math.random()`, `Date.now()`, `new Date()`, `performance.now()`
//                    without a nearby `useFakeTimers`, `vi.setSystemTime`, or "+Nms" / "tolerance" comment
//   CONSOLE-LEAK   — `console.log(` / `console.error(` / `console.warn(` in tests (debug leftovers)
//   TAUTOLOGY      — `expect(true).toBe(true)`, `expect(x).toBe(x)`, `expect(1).toBe(1)` — asserts nothing
//   EMPTY-TEST     — `it("...", () => {})` / `test("...", () => {})` with empty body
//   TODO-MARKER    — `it.todo(`, `test.todo(`, `// TODO` inside a describe block
//
// Output: docs/plans/cleanup-findings/raw/test-smells-report.json
//
// Usage:
//   node scripts/audit/test-smells.mjs
//   node scripts/audit/test-smells.mjs --scope "pforge-mcp/tests/**"
//   node scripts/audit/test-smells.mjs --severity error   (only FOCUS-LEAK + TAUTOLOGY + EMPTY-TEST)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'plans', 'cleanup-findings', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'test-smells-report.json');

const DEFAULT_SCOPES = ['pforge-mcp/tests', 'pforge-master/tests', 'tests'];

const SMELLS = [
  { id: 'FOCUS-LEAK', severity: 'error', regex: /\b(?:it|test|describe|context)\.only\s*\(/g, why: 'Focused test slipped past CI — would skip every other test in the suite if merged' },
  { id: 'SKIP-LEAK', severity: 'warn', regex: /\b(?:it|test|describe|context)\.skip\s*\(|\bx(?:it|test|describe)\s*\(/g, why: 'Silently disabled test — either re-enable, delete, or convert to .todo with a tracked issue' },
  { id: 'CONSOLE-LEAK', severity: 'warn', regex: /\bconsole\.(?:log|error|warn|info|debug)\s*\(/g, why: 'Debug leftover — adds noise to test output and obscures real failures' },
  { id: 'TAUTOLOGY', severity: 'error', regex: /expect\s*\(\s*(true|false|1|0|null|undefined|""|''|\[\]|\{\})\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/g, why: 'Assertion is always true — proves nothing about the code under test' },
  { id: 'EMPTY-TEST', severity: 'warn', regex: /\b(?:it|test)\s*\(\s*["'`][^"'`]+["'`]\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/g, why: 'Empty test body — placeholder that asserts nothing (convert to .todo or write the test)' },
  { id: 'TODO-MARKER', severity: 'info', regex: /\b(?:it|test)\.todo\s*\(/g, why: 'Pending test — track in an issue and remove the .todo when implemented' },
];

const TIME_FLAKE_PATTERNS = [
  { name: 'setTimeout', regex: /\bsetTimeout\s*\(/g },
  { name: 'Math.random', regex: /\bMath\.random\s*\(/g },
  { name: 'Date.now', regex: /\bDate\.now\s*\(/g },
  { name: 'new Date()', regex: /\bnew\s+Date\s*\(\s*\)/g },
  { name: 'performance.now', regex: /\bperformance\.now\s*\(/g },
];

const TIME_FLAKE_GUARDS = /useFakeTimers|setSystemTime|toleranc|±|\+\s*\d+\s*ms|approximately|fuzz|advanceTimersByTime/i;

function parseArgs(argv) {
  const args = { scopes: null, severity: 'info' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scope' || argv[i] === '--scopes') {
      args.scopes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (argv[i] === '--severity') {
      args.severity = argv[++i];
    }
  }
  return args;
}

function severityRank(s) {
  return { error: 3, warn: 2, info: 1 }[s] ?? 1;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && /\.test\.(mjs|js)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function relPath(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function lineNumberOf(source, charIndex) {
  let n = 1;
  for (let i = 0; i < charIndex && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) n++;
  }
  return n;
}

function getContext(source, charIndex, contextChars = 200) {
  const start = Math.max(0, charIndex - contextChars);
  const end = Math.min(source.length, charIndex + contextChars);
  return source.slice(start, end);
}

function scanSmells(source, minSeverity) {
  const findings = [];
  for (const smell of SMELLS) {
    if (severityRank(smell.severity) < severityRank(minSeverity)) continue;
    smell.regex.lastIndex = 0;
    let match;
    while ((match = smell.regex.exec(source)) !== null) {
      findings.push({
        smell: smell.id,
        severity: smell.severity,
        line: lineNumberOf(source, match.index),
        snippet: match[0].slice(0, 80),
        why: smell.why,
      });
    }
  }
  return findings;
}

function scanTimeFlakes(source, minSeverity) {
  if (severityRank('warn') < severityRank(minSeverity)) return [];
  const findings = [];
  for (const pattern of TIME_FLAKE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(source)) !== null) {
      const context = getContext(source, match.index, 250);
      if (TIME_FLAKE_GUARDS.test(context)) continue;
      findings.push({
        smell: 'TIME-FLAKE',
        severity: 'warn',
        line: lineNumberOf(source, match.index),
        snippet: `${pattern.name} without tolerance guard`,
        why: 'Time-sensitive code in tests without explicit tolerance or fake timers — Windows scheduler drift can flake the test (see Phase 41 S5 timeline-core +5ms→+50ms fix)',
      });
    }
  }
  return findings;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scopes = args.scopes ?? DEFAULT_SCOPES;

  const files = [];
  for (const scope of scopes) {
    walk(path.join(ROOT, scope), files);
  }

  const fileFindings = [];
  const counts = { error: 0, warn: 0, info: 0 };
  const bySmell = {};

  for (const abs of files) {
    const source = fs.readFileSync(abs, 'utf8');
    const findings = [
      ...scanSmells(source, args.severity),
      ...scanTimeFlakes(source, args.severity),
    ];
    if (findings.length === 0) continue;
    for (const f of findings) {
      counts[f.severity] = (counts[f.severity] ?? 0) + 1;
      bySmell[f.smell] = (bySmell[f.smell] ?? 0) + 1;
    }
    fileFindings.push({ file: relPath(abs), findings: findings.sort((a, b) => a.line - b.line) });
  }

  fileFindings.sort((a, b) => b.findings.length - a.findings.length);

  const report = {
    generatedAt: new Date().toISOString(),
    scopes,
    severityFilter: args.severity,
    counts: {
      filesScanned: files.length,
      filesWithSmells: fileFindings.length,
      errors: counts.error ?? 0,
      warnings: counts.warn ?? 0,
      info: counts.info ?? 0,
      bySmell,
    },
    findings: fileFindings,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  console.log(`Test smells: scanned=${files.length} test files (filter=${args.severity})`);
  console.log(`  errors:   ${report.counts.errors}`);
  console.log(`  warnings: ${report.counts.warnings}`);
  console.log(`  info:     ${report.counts.info}`);
  if (Object.keys(bySmell).length > 0) {
    console.log('  by smell:');
    for (const [smell, count] of Object.entries(bySmell).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${smell.padEnd(14)} ${count}`);
    }
  }
  if (fileFindings.length > 0) {
    console.log('\nTop files:');
    for (const f of fileFindings.slice(0, 10)) {
      console.log(`  ${f.file} — ${f.findings.length} smells`);
    }
  }
  console.log(`Report: ${path.relative(ROOT, OUT_FILE)}`);

  // Exit non-zero if any error-severity smells (FOCUS-LEAK / TAUTOLOGY / EMPTY-TEST)
  if ((counts.error ?? 0) > 0) {
    process.exitCode = 1;
  }
}

main();
