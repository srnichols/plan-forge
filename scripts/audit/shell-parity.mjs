// Shell-parity scanner.
//
// Plan Forge ships every entry point as BOTH PowerShell and Bash so Windows and
// Unix consumers get the same surface. AGENTS.md calls this out explicitly:
//
//   "When adding a new entry point: write the PowerShell version, write the
//    Bash version in the same commit, add parity tests. A PR that ships only
//    one shell is rejected."
//
// This script answers: "Which shell scripts are missing their twin, and which
// pairs look suspiciously divergent in size (one is a stub)?"
//
// Approach (filesystem walk, no AST, no new deps):
//   1. Walk the repo for tracked .ps1 and .sh files (skip node_modules, .forge,
//      archive, .git)
//   2. Group by basename (path minus extension)
//   3. Flag any group that has only one of the two extensions
//   4. For paired groups, compare line counts; flag if one is < 40% the size
//      of the other (probable stub or unported branch)
//
// Severity classification:
//   ERROR — missing twin on a REQUIRED_PAIR path (consumer-facing entry point)
//   WARN  — missing twin on a dev-internal path (scripts/, dev-only tools)
//   WARN  — size delta > 60% on a paired group (one shell may be a stub)
//   INFO  — paired groups that are healthy
//
// Required pairs (consumer surface — missing twin is blocking):
//   - pforge, setup, validate-setup (repo-root entry points)
//   - .github/hooks/scripts/** (hook surface installed into consumer repos)
//   - templates/.github/hooks/scripts/** (template for installed hooks)
//
// Output: docs/plans/cleanup-findings/raw/shell-parity-report.json
//
// Usage:
//   node scripts/audit/shell-parity.mjs
//   node scripts/audit/shell-parity.mjs --strict   (treat all WARN as ERROR)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'plans', 'cleanup-findings', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'shell-parity-report.json');

const EXCLUDED_DIRS = new Set(['node_modules', '.forge', 'archive', '.git', 'dist', 'coverage']);

const REQUIRED_PAIR_PATTERNS = [
  /^pforge$/,
  /^setup$/,
  /^validate-setup$/,
  /^\.github\/hooks\/scripts\//,
  /^templates\/\.github\/hooks\/scripts\//,
];

const SIZE_DELTA_THRESHOLD = 0.4; // smaller file must be at least 40% of larger

function parseArgs(argv) {
  const args = { strict: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strict') args.strict = true;
  }
  return args;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Exact match for .git (don't accidentally skip .github)
    if (entry.name === '.git' || EXCLUDED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && /\.(ps1|sh)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function relPath(absolute) {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function lineCount(absolute) {
  const src = fs.readFileSync(absolute, 'utf8');
  return src.split(/\r?\n/).length;
}

function isRequiredPair(base) {
  return REQUIRED_PAIR_PATTERNS.some((p) => p.test(base));
}

function classifyMissing(base, strict) {
  if (isRequiredPair(base)) return 'error';
  return strict ? 'error' : 'warn';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = walk(ROOT);

  // Group by basename
  const groups = new Map();
  for (const abs of files) {
    const rel = relPath(abs);
    const base = rel.replace(/\.(ps1|sh)$/, '');
    const ext = path.extname(rel).slice(1);
    if (!groups.has(base)) groups.set(base, {});
    groups.get(base)[ext] = { file: rel, lines: lineCount(abs) };
  }

  const findings = [];
  const counts = { error: 0, warn: 0, info: 0 };
  let pairedHealthy = 0;
  let missingTwin = 0;
  let sizeMismatch = 0;

  for (const [base, group] of [...groups.entries()].sort()) {
    const hasPs = !!group.ps1;
    const hasSh = !!group.sh;

    if (hasPs && hasSh) {
      const psLines = group.ps1.lines;
      const shLines = group.sh.lines;
      const smaller = Math.min(psLines, shLines);
      const larger = Math.max(psLines, shLines);
      const ratio = larger === 0 ? 1 : smaller / larger;
      if (ratio < SIZE_DELTA_THRESHOLD) {
        sizeMismatch++;
        counts.warn++;
        findings.push({
          base,
          kind: 'SIZE-MISMATCH',
          severity: 'warn',
          ps1: { file: group.ps1.file, lines: psLines },
          sh: { file: group.sh.file, lines: shLines },
          ratio: Number(ratio.toFixed(3)),
          why: `Line-count ratio ${(ratio * 100).toFixed(0)}% is below ${SIZE_DELTA_THRESHOLD * 100}% — one shell may be a stub or an unported branch`,
        });
      } else {
        pairedHealthy++;
        counts.info++;
      }
      continue;
    }

    missingTwin++;
    const severity = classifyMissing(base, args.strict);
    counts[severity]++;
    const presentExt = hasPs ? 'ps1' : 'sh';
    const missingExt = hasPs ? 'sh' : 'ps1';
    const present = hasPs ? group.ps1 : group.sh;
    findings.push({
      base,
      kind: 'MISSING-TWIN',
      severity,
      missing: missingExt,
      present: { ext: presentExt, file: present.file, lines: present.lines },
      requiredPair: isRequiredPair(base),
      why: isRequiredPair(base)
        ? `Required consumer entry point missing its .${missingExt} twin — AGENTS.md forbids ship-without-both`
        : `Dev-internal script missing its .${missingExt} twin — non-blocking but harms cross-platform parity`,
    });
  }

  findings.sort((a, b) => {
    const rank = { error: 3, warn: 2, info: 1 };
    return (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0) || a.base.localeCompare(b.base);
  });

  const report = {
    generatedAt: new Date().toISOString(),
    strict: args.strict,
    sizeDeltaThreshold: SIZE_DELTA_THRESHOLD,
    counts: {
      filesScanned: files.length,
      groupsScanned: groups.size,
      pairedHealthy,
      missingTwin,
      sizeMismatch,
      errors: counts.error,
      warnings: counts.warn,
      info: counts.info,
    },
    findings,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));

  console.log(`Shell parity: ${files.length} scripts in ${groups.size} groups`);
  console.log(`  paired (healthy):  ${pairedHealthy}`);
  console.log(`  missing twin:      ${missingTwin}`);
  console.log(`  size mismatch:     ${sizeMismatch}`);
  console.log(`  errors:   ${counts.error}`);
  console.log(`  warnings: ${counts.warn}`);
  if (findings.length > 0 && findings.some((f) => f.severity === 'error')) {
    console.log('\nERROR findings (required pairs missing twin):');
    for (const f of findings.filter((x) => x.severity === 'error')) {
      console.log(`  ${f.base.padEnd(60)} missing .${f.missing}`);
    }
  }
  console.log(`\nReport: ${path.relative(ROOT, OUT_FILE).split(path.sep).join('/')}`);

  if (args.strict && counts.error > 0) process.exit(1);
}

main();
