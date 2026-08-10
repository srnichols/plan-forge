// Dependency-direction guard (generic, reusable).
//
// Catches the class of bug reported in self-repair issue #224: a file in an
// INNER layer importing from an OUTER layer, violating the Clean Architecture
// Dependency Rule ("source-code dependencies point only inward").
//
// The canonical monorepo shape this defends:
//
//   apps/      — composition roots / deployables (OUTER — may import packages)
//   packages/  — reusable libraries           (INNER — must NOT import apps)
//
// A `packages/*` file that imports from `apps/*` (e.g. the Phase-79 regression
// `import { X } from "../../../apps/api/src/test-support/constants"`) compiles
// fine in the app's build context but breaks isolated package builds and
// inverts the dependency graph. This guard flags it before it ships.
//
// Unlike dep-boundaries.mjs (which encodes Plan Forge's OWN package rules and
// scans only .mjs), this guard is:
//   - generic: the layer order is data-driven (layer-policy.json or defaults)
//   - portable: `--root <dir>` points it at any monorepo (e.g. a consuming repo)
//   - multi-language: scans .ts/.tsx/.js/.jsx/.mjs/.cjs by default
//   - gate-ready: `--gate` exits non-zero when any violation is found
//
// Policy (optional) — scripts/audit/layer-policy.json#dependencyDirection:
//   {
//     "dependencyDirection": {
//       "layers": ["apps", "packages"],   // ordered OUTER → INNER
//       "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]
//     }
//   }
//
// Rule: a file in layer index i may import a file in layer index j only when
// j >= i. apps(0) → packages(1) is allowed; packages(1) → apps(0) is BLOCKED.
//
// Usage:
//   node scripts/audit/dependency-direction.mjs                  # scan cwd
//   node scripts/audit/dependency-direction.mjs --root ../my-app # scan elsewhere
//   node scripts/audit/dependency-direction.mjs --gate           # exit 1 on violations

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_LAYERS = ['apps', 'packages'];
const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.forge', 'coverage']);

const IMPORT_REGEX = /(?:^|\n)\s*(?:import|export)[^;]*?from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_REGEX = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const REQUIRE_REGEX = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

export function parseArgs(argv) {
  const args = { root: process.cwd(), gate: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--gate') args.gate = true;
    else if (argv[i] === '--root') args.root = argv[++i];
  }
  return args;
}

export function loadDirectionPolicy(root) {
  const policyFile = path.join(root, 'scripts', 'audit', 'layer-policy.json');
  let layers = DEFAULT_LAYERS;
  let extensions = DEFAULT_EXTENSIONS;
  if (fs.existsSync(policyFile)) {
    try {
      const policy = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
      const dd = policy.dependencyDirection;
      if (dd && Array.isArray(dd.layers) && dd.layers.length > 0) layers = dd.layers;
      if (dd && Array.isArray(dd.extensions) && dd.extensions.length > 0) extensions = dd.extensions;
    } catch { /* fall back to defaults */ }
  }
  return { layers, extensions };
}

function walk(dir, extensions, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, files);
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Determine which layer a repo-relative path belongs to.
 * A path belongs to the OUTERMOST (lowest-index) layer whose name appears as a
 * path segment — so `apps/api/packages-mock/x.ts` is correctly classed `apps`.
 * @returns {{ name: string, index: number } | null}
 */
export function layerOf(relativePath, layers) {
  const segments = relativePath.split('/');
  let best = null;
  for (let li = 0; li < layers.length; li++) {
    const seg = segments.indexOf(layers[li]);
    if (seg === -1) continue;
    if (best === null || li < best.index) best = { name: layers[li], index: li, segPos: seg };
  }
  return best ? { name: best.name, index: best.index } : null;
}

function resolveRelativeImport(sourceRel, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  const sourceDir = path.posix.dirname(sourceRel.split(path.sep).join('/'));
  return path.posix.normalize(path.posix.join(sourceDir, specifier));
}

function lineNumberOf(source, charIndex) {
  let n = 1;
  for (let i = 0; i < charIndex && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) n++;
  }
  return n;
}

function extractImports(source) {
  const imports = [];
  for (const regex of [IMPORT_REGEX, DYNAMIC_IMPORT_REGEX, REQUIRE_REGEX]) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(source)) !== null) {
      imports.push({ spec: m[1], index: m.index });
    }
  }
  return imports;
}

/**
 * Scan a monorepo root for inner→outer dependency-direction violations.
 * Pure-ish: reads the filesystem but returns a structured result.
 * @returns {{ filesScanned: number, layers: string[], violations: object[] }}
 */
export function scanDependencyDirection(root, layers, extensions) {
  const files = walk(root, extensions);
  const violations = [];
  for (const abs of files) {
    const sourceRel = path.relative(root, abs).split(path.sep).join('/');
    const sourceLayer = layerOf(sourceRel, layers);
    if (!sourceLayer) continue;
    const source = fs.readFileSync(abs, 'utf8');
    for (const imp of extractImports(source)) {
      const resolved = resolveRelativeImport(sourceRel, imp.spec);
      if (!resolved) continue;
      const targetLayer = layerOf(resolved, layers);
      if (!targetLayer) continue;
      // INNER (higher index) importing OUTER (lower index) is the violation.
      if (targetLayer.index < sourceLayer.index) {
        violations.push({
          source: sourceRel,
          line: lineNumberOf(source, imp.index),
          specifier: imp.spec,
          target: resolved,
          sourceLayer: sourceLayer.name,
          targetLayer: targetLayer.name,
          why: `${sourceLayer.name}/* must not import ${targetLayer.name}/* (Dependency Rule: dependencies point inward)`,
        });
      }
    }
  }
  return { filesScanned: files.length, layers, violations };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const { layers, extensions } = loadDirectionPolicy(root);
  const result = scanDependencyDirection(root, layers, extensions);

  console.log(`Dependency direction: scanned ${result.filesScanned} files under ${path.relative(process.cwd(), root) || '.'}`);
  console.log(`  layer order (outer→inner): ${layers.join(' → ')}`);
  console.log(`  violations: ${result.violations.length}`);
  for (const v of result.violations) {
    console.log(`    ${v.source}:${v.line}  imports ${v.targetLayer}/  →  ${v.specifier}`);
    console.log(`      ${v.why}`);
  }

  if (args.gate && result.violations.length > 0) {
    console.error(`\nBLOCKED: ${result.violations.length} dependency-direction violation(s).`);
    process.exit(1);
  }
}

// Run as a CLI only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('dependency-direction.mjs')) {
  main();
}
