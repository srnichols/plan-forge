// Frozen-arrays drift scanner.
//
// pforge-mcp/enums.mjs is the single source of truth for stable-small-set
// string literals: hook names, model tiers, quorum modes, error codes,
// watcher modes, cost sources, etc. The Phase 41 enums-centralization had to
// chase the same hook-name string across 50+ files because hand-typed literals
// drifted silently over a year.
//
// The Clean Code DRY guard (clean-code.instructions.md) says:
//
//   "If the same value is from a stable small set (hook names, modes, tiers,
//    error codes), import from pforge-mcp/enums.mjs — never re-type."
//
// This script answers: "Which files hand-type a literal that's already
// canonicalized in enums.mjs?"
//
// Approach (regex parse of enums.mjs, no AST, no new deps):
//   1. Parse enums.mjs to extract canonical literals from each frozen array
//      and frozen object (HOOK_PASCAL, ERROR_CODES, QUORUM_MODES, etc.)
//   2. Walk the codebase for .mjs files (excluding enums.mjs and tests by
//      default; --include-tests to widen)
//   3. For each file, scan for string-literal occurrences of canonical
//      values (`"literal"`, `'literal'`, `` `literal` ``) on a word boundary
//   4. For each match, check whether the file already imports the
//      corresponding constant from enums.mjs
//   5. Classify findings:
//        - HARD-DRIFT — file imports the enum but still uses a hand-typed
//          literal somewhere (high-confidence cleanup)
//        - SOFT-DRIFT — file does not import the enum (candidate for review;
//          may be coincidental string)
//
// Scope (default scan):
//   - HOOK_PASCAL    — PascalCase hook names (rarely coincidental)
//   - ERROR_CODES    — error code constants (unique strings, very high signal)
//
// Extended scope (--all):
//   - + QUORUM_MODES, MODEL_TIERS, WATCHER_MODES, COST_SOURCES,
//     FORGE_MASTER_MODES — values like "auto" / "fast" / "power" are common
//     English words, so this mode produces more false positives
//
// Output: docs/plans/cleanup-findings/raw/frozen-arrays-drift-report.json
//
// Usage:
//   node scripts/audit/frozen-arrays-drift.mjs
//   node scripts/audit/frozen-arrays-drift.mjs --all
//   node scripts/audit/frozen-arrays-drift.mjs --include-tests

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'plans', 'cleanup-findings', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'frozen-arrays-drift-report.json');
const ENUMS_FILE = path.join(ROOT, 'pforge-mcp', 'enums.mjs');

const DEFAULT_SCAN_DIRS = ['pforge-mcp', 'pforge-master', 'scripts', 'extensions'];
const EXCLUDED_DIRS = new Set(['node_modules', '.forge', '.git', 'dist', 'archive', 'docs', 'ui']);

const DEFAULT_ENUMS = ['HOOK_PASCAL', 'ERROR_CODES'];
const EXTENDED_ENUMS = [
  'HOOK_PASCAL',
  'ERROR_CODES',
  'QUORUM_MODES',
  'MODEL_TIERS',
  'WATCHER_MODES',
  'COST_SOURCES',
  'FORGE_MASTER_MODES',
];

function parseArgs(argv) {
  const args = { all: false, includeTests: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') args.all = true;
    else if (argv[i] === '--include-tests') args.includeTests = true;
  }
  return args;
}

// Extract canonical literals from enums.mjs. Returns:
//   { ENUM_NAME: { literals: ["Foo", ...], importName: "ENUM_NAME" }, ... }
function parseEnums(targetEnums) {
  const source = fs.readFileSync(ENUMS_FILE, 'utf8');
  const result = {};

  // freezeArray-style: export const FOO = freezeArray([...])
  const FREEZE_ARRAY_REGEX = /export\s+const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(?:Object\.freeze\()?\s*freezeArray\s*\(\s*\[([^\]]+)\]/g;
  let m;
  while ((m = FREEZE_ARRAY_REGEX.exec(source)) !== null) {
    const name = m[1];
    if (!targetEnums.includes(name)) continue;
    const literals = [...m[2].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
    result[name] = { literals, importName: name };
  }

  // Frozen-object-style: export const FOO = Object.freeze({ Key: "value", ... })
  // For HOOK_PASCAL specifically, derive from HOOK_NAMES keys (PascalCase)
  const HOOK_NAMES_REGEX = /export\s+const\s+HOOK_NAMES\s*=\s*Object\.freeze\s*\(\s*\{([^}]+)\}/;
  const hm = HOOK_NAMES_REGEX.exec(source);
  if (hm && targetEnums.includes('HOOK_PASCAL')) {
    const keys = [...hm[1].matchAll(/^\s*([A-Z][A-Za-z0-9_]*)\s*:/gm)].map((x) => x[1]);
    result['HOOK_PASCAL'] = { literals: keys, importName: 'HOOK_PASCAL' };
  }

  // ERROR_CODES — extract via the keys of the freezeErrorCode block
  const ERROR_CODES_REGEX = /export\s+const\s+ERROR_CODES\s*=\s*Object\.freeze\s*\(\s*\{([\s\S]+?)\}\s*\)\s*;/;
  const em = ERROR_CODES_REGEX.exec(source);
  if (em && targetEnums.includes('ERROR_CODES')) {
    // Each entry: KEY: freezeErrorCode("STRING_OR_CODE", ...)
    const codes = new Set();
    const ENTRY_REGEX = /^\s*([A-Z][A-Z0-9_]+)\s*:\s*freezeErrorCode\s*\(\s*["']([^"']+)["']/gm;
    let cm;
    while ((cm = ENTRY_REGEX.exec(em[1])) !== null) {
      codes.add(cm[1]); // KEY
      codes.add(cm[2]); // the code string passed to freezeErrorCode
    }
    result['ERROR_CODES'] = { literals: [...codes], importName: 'ERROR_CODES' };
  }

  return result;
}

function walk(dir, includeTests, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    if (!includeTests && entry.name === 'tests') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, includeTests, files);
    } else if (entry.isFile() && /\.mjs$/.test(entry.name)) {
      // Skip enums.mjs itself
      if (path.resolve(full) === path.resolve(ENUMS_FILE)) continue;
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

function importsFromEnums(source, importName) {
  // Match `import { ... importName ... } from "...enums.mjs"` (relative path)
  const IMPORT_BLOCK_REGEX = /import\s*\{([^}]+)\}\s*from\s*["']([^"']*enums\.mjs|[^"']*\/enums)["']/g;
  let m;
  while ((m = IMPORT_BLOCK_REGEX.exec(source)) !== null) {
    const names = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (names.includes(importName)) return true;
  }
  return false;
}

function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanFile(absolute, enums) {
  const source = fs.readFileSync(absolute, 'utf8');
  const fileRel = relPath(absolute);
  const findings = [];

  for (const [enumName, { literals, importName }] of Object.entries(enums)) {
    const fileImportsEnum = importsFromEnums(source, importName);
    for (const literal of literals) {
      // Match the literal as a quoted string token: "X" or 'X' or `X`
      const pattern = new RegExp(`(["'\`])${escapeRegex(literal)}\\1`, 'g');
      let match;
      while ((match = pattern.exec(source)) !== null) {
        // Skip import statements (the literal might be inside the source spec)
        const ctxStart = Math.max(0, match.index - 80);
        const ctxBefore = source.slice(ctxStart, match.index);
        if (/import[^;]*$/.test(ctxBefore)) continue;
        findings.push({
          enum: enumName,
          literal,
          line: lineNumberOf(source, match.index),
          severity: fileImportsEnum ? 'warn' : 'info',
          kind: fileImportsEnum ? 'HARD-DRIFT' : 'SOFT-DRIFT',
          why: fileImportsEnum
            ? `File imports ${importName} but still uses hand-typed "${literal}" — replace with the constant`
            : `File hand-types "${literal}" without importing ${importName} — review whether to migrate`,
        });
      }
    }
  }
  return findings;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetEnumNames = args.all ? EXTENDED_ENUMS : DEFAULT_ENUMS;
  const enums = parseEnums(targetEnumNames);

  if (Object.keys(enums).length === 0) {
    console.error(`No enums extracted from ${path.relative(ROOT, ENUMS_FILE)} — check parsing logic`);
    process.exit(1);
  }

  const files = [];
  for (const dir of DEFAULT_SCAN_DIRS) {
    walk(path.join(ROOT, dir), args.includeTests, files);
  }

  const fileFindings = [];
  const counts = { warn: 0, info: 0 };
  const byEnum = {};
  const byKind = {};

  for (const abs of files) {
    const findings = scanFile(abs, enums);
    if (findings.length === 0) continue;
    for (const f of findings) {
      counts[f.severity]++;
      byEnum[f.enum] = (byEnum[f.enum] ?? 0) + 1;
      byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    }
    fileFindings.push({
      file: relPath(abs),
      findings: findings.sort((a, b) => a.line - b.line),
    });
  }

  fileFindings.sort((a, b) => b.findings.length - a.findings.length);

  const report = {
    generatedAt: new Date().toISOString(),
    enumsSource: path.relative(ROOT, ENUMS_FILE).split(path.sep).join('/'),
    enumsScanned: Object.fromEntries(
      Object.entries(enums).map(([name, { literals }]) => [name, { literalCount: literals.length }]),
    ),
    extendedScan: args.all,
    includeTests: args.includeTests,
    counts: {
      filesScanned: files.length,
      filesWithDrift: fileFindings.length,
      warnings: counts.warn,
      info: counts.info,
      byEnum,
      byKind,
    },
    findings: fileFindings,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  console.log(`Frozen-arrays drift: scanned ${files.length} files against ${Object.keys(enums).length} enums`);
  for (const [name, { literals }] of Object.entries(enums)) {
    console.log(`  ${name.padEnd(20)} ${literals.length} canonical literals`);
  }
  console.log(`  HARD-DRIFT (warn): ${byKind['HARD-DRIFT'] ?? 0}  (file imports enum but hand-types literal)`);
  console.log(`  SOFT-DRIFT (info): ${byKind['SOFT-DRIFT'] ?? 0}  (file hand-types literal, no enum import)`);
  console.log(`  files with drift:  ${fileFindings.length}`);
  console.log(`\nReport: ${path.relative(ROOT, OUT_FILE).split(path.sep).join('/')}`);
}

main();
