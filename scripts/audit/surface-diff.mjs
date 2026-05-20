// Public surface diff scanner.
//
// Plan Forge ships a wide consumer surface: 100+ forge_* MCP tools, a CLI,
// and a library API. Silent breaking changes are catastrophic. This script
// answers the question /code-review needs to ask:
//
//   "What did consumers see change in this PR?"
//
// It diffs three layers against the merge-base:
//   1. Module exports        — every `export ...` statement per .mjs file
//   2. MCP tool definitions  — entries in the TOOLS array in pforge-mcp/server.mjs
//                              (name + inputSchema property keys)
//   3. CLI commands          — top-level branches in pforge.ps1 / pforge.sh
//                              (parsed via grep of switch/case-style dispatch)
//
// Each change is categorised:
//   - additive    — new export / tool / flag; safe
//   - removal     — breaking change; must be intentional
//   - signature   — same name but inputSchema/params changed; behaviour-only
//                   for additive field additions, breaking for removals/renames
//
// Output: docs/plans/cleanup-findings/raw/surface-diff-report.json
//
// Usage:
//   node scripts/audit/surface-diff.mjs
//   node scripts/audit/surface-diff.mjs --base origin/master
//
// Regex-based — no AST parsing, no new dependencies. This means false
// positives are possible (e.g. exports inside template literals). The skill
// agent is expected to apply judgment to the report.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'docs', 'plans', 'cleanup-findings', 'raw');
const OUT_FILE = path.join(OUT_DIR, 'surface-diff-report.json');

const SERVER_FILE = 'pforge-mcp/server.mjs';
const CLI_FILES = ['pforge.ps1', 'pforge.sh'];

const EXPORT_REGEX = /^export\s+(?:async\s+)?(?:default\s+)?(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_BRACE_REGEX = /^export\s*\{([^}]+)\}/gm;
const TOOL_NAME_REGEX = /name:\s*["']([a-zA-Z_][\w_]*)["']/g;

function parseArgs(argv) {
  const args = { base: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') {
      args.base = argv[++i];
    }
  }
  return args;
}

function run(cmd, cmdArgs) {
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8', cwd: ROOT });
}

function resolveBase(explicitBase) {
  if (explicitBase) {
    return explicitBase;
  }
  for (const candidate of ['origin/planning/main', 'planning/main', 'origin/master', 'master']) {
    const result = run('git', ['merge-base', 'HEAD', candidate]);
    if (result.status === 0 && result.stdout.trim().length > 0) {
      return result.stdout.trim();
    }
  }
  const fallback = run('git', ['rev-parse', 'HEAD~1']);
  return fallback.status === 0 ? fallback.stdout.trim() : 'HEAD~1';
}

function listChangedFiles(baseRef) {
  const result = run('git', ['diff', '--name-only', '--diff-filter=ACMRD', `${baseRef}...HEAD`]);
  if (result.status !== 0) {
    return [];
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function readFileAtRef(ref, file) {
  const result = run('git', ['show', `${ref}:${file}`]);
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function readFileAtHead(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    return null;
  }
  return fs.readFileSync(full, 'utf8');
}

function extractExports(source) {
  if (!source) {
    return new Set();
  }
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

function extractMcpTools(source) {
  if (!source) {
    return new Map();
  }
  // Find every `name: "forge_xxx"` and capture the inputSchema property keys
  // that follow within the same object literal (best-effort regex).
  const tools = new Map();
  const toolBlockRegex = /\{\s*name:\s*["']([a-zA-Z_][\w_]*)["'][\s\S]*?\}\s*,(?=\s*(?:\{|\]))/g;
  let match;
  while ((match = toolBlockRegex.exec(source)) !== null) {
    const name = match[1];
    if (!name.startsWith('forge_') && !name.startsWith('brain_') && !name.startsWith('crucible_')) {
      continue;
    }
    const block = match[0];
    const props = extractInputSchemaProps(block);
    tools.set(name, props);
  }
  return tools;
}

function extractInputSchemaProps(toolBlock) {
  // Find the `properties: { ... }` inside `inputSchema`.
  const propertiesMatch = toolBlock.match(/inputSchema[\s\S]*?properties:\s*\{([\s\S]*?)\n\s*\}/);
  if (!propertiesMatch) {
    return [];
  }
  const inner = propertiesMatch[1];
  const propRegex = /\n\s*([A-Za-z_][\w]*)\s*:\s*\{/g;
  const props = new Set();
  let propMatch;
  while ((propMatch = propRegex.exec(inner)) !== null) {
    props.add(propMatch[1]);
  }
  return [...props].sort();
}

function extractCliCommands(source) {
  if (!source) {
    return new Set();
  }
  const cmds = new Set();
  // PowerShell switch: lines like `'run-plan' { ... }` or `"smith" { ... }`
  const psSwitchRegex = /^\s*['"]([a-z][a-z0-9-]*)['"]\s*\{/gim;
  let match;
  while ((match = psSwitchRegex.exec(source)) !== null) {
    cmds.add(match[1]);
  }
  // Bash case: lines like `  run-plan)` or `  "smith")`
  const bashCaseRegex = /^\s*["']?([a-z][a-z0-9-]*)["']?\)/gim;
  while ((match = bashCaseRegex.exec(source)) !== null) {
    cmds.add(match[1]);
  }
  return cmds;
}

function diffSets(before, after) {
  const beforeSet = before instanceof Set ? before : new Set(before);
  const afterSet = after instanceof Set ? after : new Set(after);
  const added = [...afterSet].filter((item) => !beforeSet.has(item)).sort();
  const removed = [...beforeSet].filter((item) => !afterSet.has(item)).sort();
  return { added, removed };
}

function diffExports(baseRef, changedFiles) {
  const findings = [];
  for (const file of changedFiles) {
    if (!file.endsWith('.mjs') && !file.endsWith('.js')) {
      continue;
    }
    if (file.includes('/tests/') || file.includes('/node_modules/')) {
      continue;
    }
    const before = extractExports(readFileAtRef(baseRef, file));
    const after = extractExports(readFileAtHead(file));
    const { added, removed } = diffSets(before, after);
    if (added.length === 0 && removed.length === 0) {
      continue;
    }
    findings.push({
      file,
      added,
      removed,
      category: removed.length > 0 ? 'breaking' : 'additive'
    });
  }
  return findings;
}

function diffMcpTools(baseRef) {
  const before = extractMcpTools(readFileAtRef(baseRef, SERVER_FILE));
  const after = extractMcpTools(readFileAtHead(SERVER_FILE));
  const findings = [];
  const allNames = new Set([...before.keys(), ...after.keys()]);
  for (const name of [...allNames].sort()) {
    const hadBefore = before.has(name);
    const hasAfter = after.has(name);
    if (!hadBefore && hasAfter) {
      findings.push({ tool: name, change: 'added', properties: after.get(name), category: 'additive' });
      continue;
    }
    if (hadBefore && !hasAfter) {
      findings.push({ tool: name, change: 'removed', properties: before.get(name), category: 'breaking' });
      continue;
    }
    const beforeProps = before.get(name) ?? [];
    const afterProps = after.get(name) ?? [];
    const { added, removed } = diffSets(beforeProps, afterProps);
    if (added.length === 0 && removed.length === 0) {
      continue;
    }
    findings.push({
      tool: name,
      change: 'signature',
      addedProperties: added,
      removedProperties: removed,
      category: removed.length > 0 ? 'breaking' : 'additive'
    });
  }
  return findings;
}

function diffCliCommands(baseRef) {
  const findings = [];
  for (const file of CLI_FILES) {
    const before = extractCliCommands(readFileAtRef(baseRef, file));
    const after = extractCliCommands(readFileAtHead(file));
    const { added, removed } = diffSets(before, after);
    if (added.length === 0 && removed.length === 0) {
      continue;
    }
    findings.push({
      file,
      added,
      removed,
      category: removed.length > 0 ? 'breaking' : 'additive'
    });
  }
  return findings;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseRef = resolveBase(args.base);
  const changedFiles = listChangedFiles(baseRef);

  const exportFindings = diffExports(baseRef, changedFiles);
  const toolFindings = changedFiles.includes(SERVER_FILE) ? diffMcpTools(baseRef) : [];
  const cliFindings = diffCliCommands(baseRef);

  const summary = {
    base: baseRef,
    head: run('git', ['rev-parse', 'HEAD']).stdout.trim(),
    timestamp: new Date().toISOString(),
    changedFileCount: changedFiles.length,
    counts: {
      exports: {
        breaking: exportFindings.filter((finding) => finding.category === 'breaking').length,
        additive: exportFindings.filter((finding) => finding.category === 'additive').length
      },
      tools: {
        breaking: toolFindings.filter((finding) => finding.category === 'breaking').length,
        additive: toolFindings.filter((finding) => finding.category === 'additive').length
      },
      cli: {
        breaking: cliFindings.filter((finding) => finding.category === 'breaking').length,
        additive: cliFindings.filter((finding) => finding.category === 'additive').length
      }
    },
    exports: exportFindings,
    tools: toolFindings,
    cli: cliFindings
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Surface diff: base=${baseRef.substring(0, 10)}`);
  console.log(`  Exports  -> additive: ${summary.counts.exports.additive}, breaking: ${summary.counts.exports.breaking}`);
  console.log(`  MCP tools -> additive: ${summary.counts.tools.additive}, breaking: ${summary.counts.tools.breaking}`);
  console.log(`  CLI cmds -> additive: ${summary.counts.cli.additive}, breaking: ${summary.counts.cli.breaking}`);

  for (const finding of [...exportFindings, ...toolFindings, ...cliFindings].filter((finding) => finding.category === 'breaking')) {
    const label = finding.file ?? finding.tool;
    const detail = finding.removed
      ? `removed: ${finding.removed.join(', ')}`
      : `removedProperties: ${(finding.removedProperties ?? []).join(', ')}`;
    console.log(`  BREAKING: ${label} (${detail})`);
  }

  console.log(`Report: ${path.relative(ROOT, OUT_FILE)}`);
}

main();
