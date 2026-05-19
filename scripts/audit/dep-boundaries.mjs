// Dep-boundaries scanner.
//
// Plan Forge is a small monorepo with strict package boundaries:
//
//   pforge-mcp/        — MCP server, orchestrator, memory hub, ~100 forge_* tools
//   pforge-master/     — Forge-Master Studio (read-only reasoning loop)
//   pforge-sdk/        — SDK consumed by user projects
//   scripts/           — dev tooling (audits, smoke tests, migrations)
//   extensions/        — community extensions (notify-*, etc.) — must stay leaf
//
// The Dependency Rule (Clean Architecture) says: source-code dependencies point
// only inward. In Plan Forge terms:
//
//   - scripts/* may import from any package (dev tooling) → ALLOWED
//   - pforge-master/* may import from pforge-mcp/* only via WHITELIST
//   - pforge-mcp/* must NOT import from pforge-master/* (upper depends on lower)
//   - extensions/* must NOT import from pforge-mcp/* or pforge-master/* (loose
//     coupling — extensions register through hooks, not direct imports)
//   - pforge-sdk/* must NOT import from any other Plan Forge package (SDK is leaf)
//
// This script answers: "Which cross-package imports exist in the repo, and
// which ones violate the boundary rules?"
//
// scan-architecture.mjs already covers cross-LAYER imports within pforge-mcp
// using madge. This script focuses on cross-PACKAGE boundaries, runs without
// madge, and is regex-only so it works in CI without a heavy dependency chain.
//
// Rule source:
//   scripts/audit/layer-policy.json#crossPackageWhitelist (explicit allowed pairs)
//   plus the PACKAGE_RULES table below (default policy)
//
// Output: docs/plans/cleanup-findings/raw/dep-boundaries-report.json
//
// Usage:
//   node scripts/audit/dep-boundaries.mjs
//   node scripts/audit/dep-boundaries.mjs --include-tests

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'plans', 'cleanup-findings', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'dep-boundaries-report.json');
const POLICY_FILE = path.join(ROOT, 'scripts', 'audit', 'layer-policy.json');

const PACKAGES = ['pforge-mcp', 'pforge-master', 'pforge-sdk', 'scripts', 'extensions'];
const EXCLUDED_DIRS = new Set(['node_modules', '.forge', '.git', 'dist', 'archive', 'docs', 'ui']);

// PACKAGE_RULES — default policy. true = ALLOWED, false = BLOCKED.
// Lookup: PACKAGE_RULES[sourcePackage][targetPackage]
const PACKAGE_RULES = {
  'scripts':       { 'pforge-mcp': true,  'pforge-master': true,  'pforge-sdk': true,  'extensions': true  },
  'pforge-master': { 'pforge-mcp': 'whitelist', 'pforge-sdk': true, 'pforge-master': true, 'scripts': false, 'extensions': false },
  'pforge-mcp':    { 'pforge-master': 'whitelist', 'pforge-sdk': true, 'pforge-mcp': true, 'scripts': false, 'extensions': false },
  'pforge-sdk':    { 'pforge-mcp': false, 'pforge-master': false, 'pforge-sdk': true, 'scripts': false, 'extensions': false },
  'extensions':    { 'pforge-mcp': false, 'pforge-master': false, 'pforge-sdk': true, 'extensions': true, 'scripts': false },
};

const IMPORT_REGEX = /(?:^|\n)\s*(?:import|export)[^;]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_REGEX = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function parseArgs(argv) {
  const args = { includeTests: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--include-tests') args.includeTests = true;
  }
  return args;
}

function loadPolicy() {
  if (!fs.existsSync(POLICY_FILE)) return { crossPackageWhitelist: [] };
  try {
    return JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'));
  } catch {
    return { crossPackageWhitelist: [] };
  }
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
      files.push(full);
    }
  }
  return files;
}

function relPath(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function packageOf(relativePath) {
  for (const pkg of PACKAGES) {
    if (relativePath === pkg || relativePath.startsWith(`${pkg}/`)) return pkg;
  }
  return null;
}

function resolveImport(sourceFile, specifier) {
  // Only resolve relative imports — package specifiers (bare imports) skip
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const sourceDir = path.dirname(sourceFile);
  let resolved = path.normalize(path.join(sourceDir, specifier));
  // Normalize to posix for matching against package prefixes
  return resolved.split(path.sep).join('/');
}

function lineNumberOf(source, charIndex) {
  let n = 1;
  for (let i = 0; i < charIndex && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) n++;
  }
  return n;
}

function extractImports(absoluteFile) {
  const source = fs.readFileSync(absoluteFile, 'utf8');
  const sourceRel = relPath(absoluteFile);
  const imports = [];
  for (const regex of [IMPORT_REGEX, DYNAMIC_IMPORT_REGEX]) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(source)) !== null) {
      const spec = m[1];
      const resolved = resolveImport(sourceRel, spec);
      if (!resolved) continue;
      imports.push({ spec, resolved, line: lineNumberOf(source, m.index) });
    }
  }
  return imports;
}

function classify(sourcePkg, targetPkg, sourceFile, resolvedTarget, whitelist) {
  if (sourcePkg === targetPkg) return null; // intra-package — not our concern
  const rule = PACKAGE_RULES[sourcePkg]?.[targetPkg];
  if (rule === true) return { kind: 'ALLOWED', severity: 'info' };
  if (rule === false) {
    return {
      kind: 'BLOCKED',
      severity: 'error',
      why: `${sourcePkg} must not depend on ${targetPkg} (PACKAGE_RULES policy)`,
    };
  }
  if (rule === 'whitelist') {
    const edge = `${sourceFile} -> ${resolvedTarget}`;
    const allowed = whitelist.some((entry) => {
      // Whitelist entries are "src -> tgt" strings or {source, target} objects
      if (typeof entry === 'string') return entry === edge;
      return entry.source === sourceFile && entry.target === resolvedTarget;
    });
    if (allowed) return { kind: 'WHITELISTED', severity: 'info' };
    return {
      kind: 'NEEDS-WHITELIST',
      severity: 'warn',
      why: `${sourcePkg} -> ${targetPkg} requires explicit entry in layer-policy.json#crossPackageWhitelist`,
    };
  }
  // No rule defined — treat as cross-package and flag for human review
  return {
    kind: 'UNCLASSIFIED',
    severity: 'warn',
    why: `Cross-package import from ${sourcePkg} to ${targetPkg} not covered by PACKAGE_RULES — add an entry`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = loadPolicy();
  const whitelist = policy.crossPackageWhitelist ?? [];

  const files = [];
  for (const pkg of PACKAGES) {
    walk(path.join(ROOT, pkg), args.includeTests, files);
  }

  const findings = [];
  const counts = { error: 0, warn: 0, info: 0 };
  const byKind = {};

  for (const abs of files) {
    const sourceRel = relPath(abs);
    const sourcePkg = packageOf(sourceRel);
    if (!sourcePkg) continue;
    const imports = extractImports(abs);
    for (const imp of imports) {
      const targetPkg = packageOf(imp.resolved);
      if (!targetPkg) continue;
      const verdict = classify(sourcePkg, targetPkg, sourceRel, imp.resolved, whitelist);
      if (!verdict) continue;
      counts[verdict.severity]++;
      byKind[verdict.kind] = (byKind[verdict.kind] ?? 0) + 1;
      if (verdict.severity === 'info') continue;
      findings.push({
        source: sourceRel,
        line: imp.line,
        target: imp.resolved,
        sourcePackage: sourcePkg,
        targetPackage: targetPkg,
        specifier: imp.spec,
        kind: verdict.kind,
        severity: verdict.severity,
        why: verdict.why,
      });
    }
  }

  findings.sort((a, b) => {
    const rank = { error: 3, warn: 2, info: 1 };
    return (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0)
      || a.source.localeCompare(b.source)
      || a.line - b.line;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    includeTests: args.includeTests,
    packages: PACKAGES,
    counts: {
      filesScanned: files.length,
      errors: counts.error,
      warnings: counts.warn,
      infoAllowed: counts.info,
      byKind,
    },
    findings,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  console.log(`Dep boundaries: scanned ${files.length} .mjs files across ${PACKAGES.length} packages`);
  console.log(`  errors:   ${counts.error}  (BLOCKED imports)`);
  console.log(`  warnings: ${counts.warn}   (NEEDS-WHITELIST or UNCLASSIFIED)`);
  console.log(`  allowed:  ${counts.info}`);
  if (Object.keys(byKind).length > 0) {
    console.log('  by kind:');
    for (const [kind, count] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${kind.padEnd(18)} ${count}`);
    }
  }
  console.log(`\nReport: ${path.relative(ROOT, OUT_FILE).split(path.sep).join('/')}`);
}

main();
