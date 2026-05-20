// Dead-exports scanner.
//
// Plan Forge has 100+ .mjs modules with thousands of named exports. Many were
// added during refactors and never wired to a consumer. Stale exports are a
// quiet liability: they widen the public surface (so surface-diff has more
// "breaking" candidates to triage), they obscure which symbols are real API,
// and they keep dead code alive in the bundle.
//
// This script answers: "Which exported names is no other file importing?"
//
// Approach (regex, no AST, no new deps):
//   1. Walk the project for tracked .mjs files (excluding tests, ui, node_modules)
//   2. For each file, extract every named export (mirrors surface-diff.mjs regex)
//   3. For each file, extract every import name (named, default, namespace, re-export)
//   4. Flag any (file, exportName) pair where exportName is never imported
//      anywhere AND the file is not a known entry point
//
// Known entry points (exports are CLI/server-bound, not library API):
//   - pforge-mcp/server.mjs
//   - pforge-master/server.mjs
//   - scripts/audit/*.mjs
//   - Anything ending in -cli.mjs
//
// False positives the script tolerates:
//   - Re-exports (`export { foo } from './bar.mjs'`) — treated as a consumer
//   - Dynamic `import()` calls — not tracked (rare in this codebase)
//   - Symbols consumed via `import *` namespace access — counted as "all used"
//
// Output: docs/plans/cleanup-findings/raw/dead-exports-report.json
//
// Usage:
//   node scripts/audit/dead-exports.mjs
//   node scripts/audit/dead-exports.mjs --scope "pforge-mcp/**"
//   node scripts/audit/dead-exports.mjs --include-tests

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'plans', 'cleanup-findings', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'dead-exports-report.json');

const DEFAULT_SCOPES = ['pforge-mcp', 'pforge-master', 'scripts'];
const EXCLUDED_DIRS = new Set(['node_modules', 'tests', 'ui', 'dist', '.forge', 'docs', 'archive']);
const ENTRY_POINT_PATTERNS = [
  /^pforge-mcp\/server\.mjs$/,
  /^pforge-master\/server\.mjs$/,
  /^scripts\/audit\/.*\.mjs$/,
  /-cli\.mjs$/,
  /\/cli\.mjs$/,
];

const EXPORT_REGEX = /^export\s+(?:async\s+)?(?:default\s+)?(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_BRACE_REGEX = /^export\s*\{([^}]+)\}/gm;
const REEXPORT_REGEX = /^export\s*(?:\*|\{[^}]+\})\s*from\s*["']([^"']+)["']/gm;

const IMPORT_NAMED_REGEX = /import\s+(?:type\s+)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
const IMPORT_DEFAULT_REGEX = /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g;
const IMPORT_NAMESPACE_REGEX = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g;

function parseArgs(argv) {
  const args = { scopes: null, includeTests: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--scope' || argv[i] === '--scopes') {
      args.scopes = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (argv[i] === '--include-tests') {
      args.includeTests = true;
    }
  }
  return args;
}

function walk(dir, includeTests, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!includeTests && EXCLUDED_DIRS.has(entry.name)) continue;
    if (includeTests && entry.name !== 'tests' && EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, includeTests, files);
    } else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.js'))) {
      files.push(full);
    }
  }
  return files;
}

function relPath(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function isEntryPoint(rel) {
  return ENTRY_POINT_PATTERNS.some((pattern) => pattern.test(rel));
}

function extractExports(source) {
  const names = new Set();
  let match;
  EXPORT_REGEX.lastIndex = 0;
  while ((match = EXPORT_REGEX.exec(source)) !== null) {
    names.add(match[1]);
  }
  EXPORT_BRACE_REGEX.lastIndex = 0;
  while ((match = EXPORT_BRACE_REGEX.exec(source)) !== null) {
    for (const part of match[1].split(',')) {
      const cleaned = part.trim().split(/\s+as\s+/i).pop();
      if (cleaned && /^[A-Za-z_$][\w$]*$/.test(cleaned)) {
        names.add(cleaned);
      }
    }
  }
  return names;
}

function resolveImportPath(fromFile, importSpec) {
  if (!importSpec.startsWith('.')) return null;
  const fromDir = path.dirname(fromFile);
  let resolved = path.resolve(fromDir, importSpec);
  if (!resolved.endsWith('.mjs') && !resolved.endsWith('.js')) {
    for (const ext of ['.mjs', '.js']) {
      if (fs.existsSync(resolved + ext)) {
        resolved += ext;
        break;
      }
    }
  }
  return relPath(resolved);
}

function extractImports(source, fromFile) {
  const named = [];
  const namespaceTargets = new Set();
  let match;
  IMPORT_NAMED_REGEX.lastIndex = 0;
  while ((match = IMPORT_NAMED_REGEX.exec(source)) !== null) {
    const target = resolveImportPath(fromFile, match[2]);
    if (!target) continue;
    for (const part of match[1].split(',')) {
      const cleaned = part.trim().split(/\s+as\s+/i)[0].trim();
      if (cleaned && /^[A-Za-z_$][\w$]*$/.test(cleaned)) {
        named.push({ target, name: cleaned });
      }
    }
  }
  IMPORT_DEFAULT_REGEX.lastIndex = 0;
  while ((match = IMPORT_DEFAULT_REGEX.exec(source)) !== null) {
    const target = resolveImportPath(fromFile, match[2]);
    if (target) named.push({ target, name: 'default' });
  }
  IMPORT_NAMESPACE_REGEX.lastIndex = 0;
  while ((match = IMPORT_NAMESPACE_REGEX.exec(source)) !== null) {
    const target = resolveImportPath(fromFile, match[2]);
    if (target) namespaceTargets.add(target);
  }
  REEXPORT_REGEX.lastIndex = 0;
  while ((match = REEXPORT_REGEX.exec(source)) !== null) {
    const target = resolveImportPath(fromFile, match[1]);
    if (target) namespaceTargets.add(target);
  }
  return { named, namespaceTargets };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scopes = args.scopes ?? DEFAULT_SCOPES;

  const files = [];
  for (const scope of scopes) {
    walk(path.join(ROOT, scope), args.includeTests, files);
  }

  const exportsByFile = new Map();
  const importsByFile = new Map();

  for (const abs of files) {
    const source = fs.readFileSync(abs, 'utf8');
    const rel = relPath(abs);
    exportsByFile.set(rel, extractExports(source));
    importsByFile.set(rel, extractImports(source, abs));
  }

  const usedExports = new Map();
  const namespaceConsumed = new Set();
  for (const [, imports] of importsByFile) {
    for (const target of imports.namespaceTargets) {
      namespaceConsumed.add(target);
    }
    for (const { target, name } of imports.named) {
      if (!usedExports.has(target)) usedExports.set(target, new Set());
      usedExports.get(target).add(name);
    }
  }

  const findings = [];
  for (const [file, exports] of exportsByFile) {
    if (isEntryPoint(file)) continue;
    if (namespaceConsumed.has(file)) continue;
    const used = usedExports.get(file) ?? new Set();
    const dead = [...exports].filter((name) => !used.has(name)).sort();
    if (dead.length > 0) {
      findings.push({ file, deadExports: dead, totalExports: exports.size });
    }
  }

  findings.sort((a, b) => b.deadExports.length - a.deadExports.length);

  const totalDead = findings.reduce((sum, f) => sum + f.deadExports.length, 0);
  const totalExports = [...exportsByFile.values()].reduce((sum, set) => sum + set.size, 0);

  const report = {
    generatedAt: new Date().toISOString(),
    scopes,
    counts: {
      filesScanned: files.length,
      filesWithDeadExports: findings.length,
      totalExports,
      deadExports: totalDead,
      namespaceConsumedFiles: namespaceConsumed.size,
    },
    findings,
    notes: [
      'Entry-point modules (server.mjs, *-cli.mjs, scripts/audit/*.mjs) are skipped.',
      'Files consumed via `import * as ns` or `export * from` are skipped (all exports potentially used).',
      'Dynamic `import()` and string-based requires are not tracked.',
      'False positives possible for symbols consumed by external tools or via convention (route handlers, etc).',
    ],
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  console.log(`Dead exports: scanned=${files.length} files`);
  console.log(`  total exports:        ${totalExports}`);
  console.log(`  dead exports:         ${totalDead}`);
  console.log(`  files with dead:      ${findings.length}`);
  console.log(`  namespace-consumed:   ${namespaceConsumed.size} (skipped)`);
  if (findings.length > 0) {
    console.log('\nTop offenders:');
    for (const f of findings.slice(0, 10)) {
      console.log(`  ${f.file} — ${f.deadExports.length}/${f.totalExports} dead: ${f.deadExports.slice(0, 5).join(', ')}${f.deadExports.length > 5 ? '…' : ''}`);
    }
  }
  console.log(`Report: ${path.relative(ROOT, OUT_FILE)}`);
}

main();
