#!/usr/bin/env node

/**
 * Plan Forge — PostSlice clean-code delta runner.
 *
 * Lightweight, fast (<1s) audit invoked after every slice commit. Measures a
 * small set of cheap signals on the files actually touched by the latest
 * commit, compares them to the on-disk baseline, and emits an advisory when
 * any metric regresses past the configured thresholds.
 *
 * Signals measured (per scoped file):
 *   - LOC                       (lines of code, incl. blank/comment)
 *   - functions                 (count via the same regex as measure-modules.mjs)
 *   - todos                     (TODO / FIXME / HACK / XXX markers)
 *   - longParams                (function declarations / arrow fns with >=5 positional params)
 *   - modulesOverHighThreshold  (files exceeding G14 high-severity LOC ceiling, default 3000)
 *
 * Inputs:
 *   --since <ref>       Diff range (default `HEAD~1`). Files changed between
 *                       <ref> and HEAD are the audit scope.
 *   --scope <globs>     Comma-separated glob expressions. Files outside the
 *                       scope are ignored even if they appear in the diff.
 *   --json              Emit the structured result as JSON to stdout instead
 *                       of the human-readable advisory.
 *   --no-write          Do not update the baseline or append to history.
 *   --no-skip           Ignore commit-message skip patterns (always run).
 *   --baseline <path>   Override `.forge/clean-code-baseline.json` location.
 *   --history  <path>   Override `.forge/clean-code-history.jsonl` location.
 *   --cwd <path>        Run as if invoked from <path> (used by tests).
 *
 * Exit codes:
 *   0   — clean, improved, or advisory-only
 *   2   — config disabled / nothing to do (skipped)
 *   nonzero on script error (file I/O, git failure, etc.)
 *
 * Does NOT block the commit by design (advisory-only, mirrors the PostSlice
 * drift convention). Projects that want a blocking gate should call this
 * script from their own pre-push hook with `--json` and parse the exit.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULTS = Object.freeze({
  scopeGlobs: ['pforge-mcp/**/*.mjs', 'pforge-master/**/*.mjs', 'scripts/**/*.mjs'],
  warnThresholds: {
    newTodos: 1,
    newLongParams: 1,
    newModulesOverHighThreshold: 1,
    locIncrease: 200,
  },
  highLocThreshold: 3000,
  longParamThreshold: 5,
  skipCommitPatterns: [
    /^docs[:(]/,
    /^ci[:(]/,
    /^Merge /,
    /--no-verify/,
  ],
  commitMustMatch: /^(feat|fix|refactor|perf|chore|style|test)\(/,
});

// ─── arg parsing ─────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    since: 'HEAD~1',
    scope: null,
    json: false,
    write: true,
    skip: true,
    baselinePath: null,
    historyPath: null,
    cwd: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[i + 1];
    switch (arg) {
      case '--since':       out.since = next(); i += 1; break;
      case '--scope':       out.scope = next().split(',').map(s => s.trim()).filter(Boolean); i += 1; break;
      case '--json':        out.json = true; break;
      case '--no-write':    out.write = false; break;
      case '--no-skip':     out.skip = false; break;
      case '--baseline':    out.baselinePath = next(); i += 1; break;
      case '--history':     out.historyPath = next(); i += 1; break;
      case '--cwd':         out.cwd = next(); i += 1; break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }
  return out;
}

// ─── config loader ───────────────────────────────────────────────────

function loadConfig(cwd) {
  const config = {
    enabled: false,
    scopeGlobs: [...DEFAULTS.scopeGlobs],
    warnThresholds: { ...DEFAULTS.warnThresholds },
    highLocThreshold: DEFAULTS.highLocThreshold,
    longParamThreshold: DEFAULTS.longParamThreshold,
  };
  try {
    const cfgPath = path.join(cwd, '.forge.json');
    if (!fs.existsSync(cfgPath)) return config;
    const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const fromFile = raw?.hooks?.postSliceCleanCode;
    if (!fromFile || typeof fromFile !== 'object') return config;
    if (fromFile.enabled === true) config.enabled = true;
    if (Array.isArray(fromFile.scopeGlobs)) config.scopeGlobs = fromFile.scopeGlobs;
    if (fromFile.warnThresholds && typeof fromFile.warnThresholds === 'object') {
      config.warnThresholds = { ...config.warnThresholds, ...fromFile.warnThresholds };
    }
    if (typeof fromFile.highLocThreshold === 'number') config.highLocThreshold = fromFile.highLocThreshold;
    if (typeof fromFile.longParamThreshold === 'number') config.longParamThreshold = fromFile.longParamThreshold;
  } catch { /* keep defaults */ }
  return config;
}

// ─── git helpers ─────────────────────────────────────────────────────

function gitOutput(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (res.status !== 0) {
    const stderr = (res.stderr || '').trim();
    throw new Error(`git ${args.join(' ')} failed: ${stderr || `exit ${res.status}`}`);
  }
  return (res.stdout || '').trimEnd();
}

function getChangedFiles(since, cwd) {
  // Diff against the given ref; if it doesn't resolve (e.g. first commit), the
  // git command throws and the caller treats the diff as empty.
  try {
    const out = gitOutput(['diff', '--name-only', `${since}..HEAD`], cwd);
    if (!out) return [];
    return out.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function getLatestCommitMessage(cwd) {
  try {
    return gitOutput(['log', '-1', '--pretty=%B'], cwd);
  } catch {
    return '';
  }
}

function getLatestCommitSha(cwd) {
  try {
    return gitOutput(['rev-parse', 'HEAD'], cwd);
  } catch {
    return null;
  }
}

// ─── glob matching ───────────────────────────────────────────────────

/**
 * Convert a glob expression (supports **, *, and ?) into a RegExp anchored
 * to the full path. We deliberately keep this minimal — pulling in minimatch
 * for one usage in an audit script is over-dependency.
 *
 * Semantics:
 *   `**\/`  — zero or more path segments (so `src/**\/*.mjs` matches
 *            both `src/a.mjs` and `src/sub/a.mjs`)
 *   `**`   — any number of characters (used for trailing wildcards)
 *   `*`    — any character except `/`
 *   `?`    — single character except `/`
 */
function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*' && glob[i + 2] === '/') {
      // `**/` — zero or more path segments
      re += '(?:.*/)?';
      i += 2;
    } else if (ch === '*' && glob[i + 1] === '*') {
      // `**` (trailing) — any characters
      re += '.*';
      i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

function isInScope(file, scopeGlobs) {
  const posix = file.split(path.sep).join('/');
  return scopeGlobs.some(g => globToRegex(g).test(posix));
}

// ─── per-file measurement ────────────────────────────────────────────

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/g;

function countLongParamFunctions(source, threshold) {
  // Match function declarations, function expressions, arrow fns, and class
  // methods with a positional parameter list. We count any parameter group
  // whose top-level comma count is >= threshold-1. The regex is deliberately
  // conservative: we only inspect parens that are immediately preceded by an
  // identifier (or `function`, `async`, `=>`), which excludes function calls.
  const pattern = /(?:function\s*\w*|=>|\b(?:async\s+)?\w+\s*)\(([^()]*)\)/g;
  let count = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const params = match[1].trim();
    if (!params) continue;
    // Strip nested commas inside default values like `= [1, 2]`. Bracket / brace
    // depth tracking gives us a reasonably accurate top-level comma count.
    let depth = 0;
    let topLevelCommas = 0;
    for (const ch of params) {
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      else if (ch === ',' && depth === 0) topLevelCommas += 1;
    }
    if (topLevelCommas + 1 >= threshold) count += 1;
  }
  return count;
}

function measureFile(absPath, config) {
  let source;
  try { source = fs.readFileSync(absPath, 'utf-8'); }
  catch { return null; } // file deleted in this commit
  const lines = source.split(/\r?\n/);
  const loc = lines.length;
  const functions = (source.match(/\bfunction\s+\w+\s*\(/g)?.length ?? 0)
                  + (source.match(/\w+\s*=\s*(?:async\s+)?\(/g)?.length ?? 0);
  const todos = (source.match(TODO_PATTERN)?.length ?? 0);
  const longParams = countLongParamFunctions(source, config.longParamThreshold);
  return { loc, functions, todos, longParams };
}

// ─── totals + scope walk ─────────────────────────────────────────────

function emptyTotals() {
  return { loc: 0, functions: 0, todos: 0, longParams: 0, modulesOverHighThreshold: 0, filesScanned: 0 };
}

function measureScope(scopeFiles, cwd, config) {
  const totals = emptyTotals();
  const perFile = [];
  for (const file of scopeFiles) {
    const abs = path.join(cwd, file);
    if (!fs.existsSync(abs)) continue;
    const m = measureFile(abs, config);
    if (!m) continue;
    totals.loc += m.loc;
    totals.functions += m.functions;
    totals.todos += m.todos;
    totals.longParams += m.longParams;
    if (m.loc > config.highLocThreshold) totals.modulesOverHighThreshold += 1;
    totals.filesScanned += 1;
    perFile.push({ file, ...m });
  }
  return { totals, perFile };
}

function walkScope(cwd, scopeGlobs) {
  // Resolve scope by walking the unique top-level segments of the glob set,
  // collecting every `.mjs` file under them, then filtering through the
  // glob regexes. This avoids a hard dependency on globby/fast-glob.
  const roots = new Set();
  for (const g of scopeGlobs) {
    const firstStar = g.indexOf('*');
    const base = (firstStar === -1 ? g : g.slice(0, firstStar)).replace(/\/$/, '');
    if (base) roots.add(base);
  }
  const out = [];
  for (const root of roots) {
    const abs = path.join(cwd, root);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === 'tests' || ent.name === '.forge') continue;
          stack.push(full);
        } else if (ent.isFile() && (ent.name.endsWith('.mjs') || ent.name.endsWith('.cjs') || ent.name.endsWith('.js'))) {
          const rel = path.relative(cwd, full).split(path.sep).join('/');
          if (isInScope(rel, scopeGlobs)) out.push(rel);
        }
      }
    }
  }
  return out.sort();
}

// ─── delta + advisory ────────────────────────────────────────────────

function computeDelta(prior, current) {
  const keys = ['loc', 'functions', 'todos', 'longParams', 'modulesOverHighThreshold'];
  const delta = {};
  for (const k of keys) delta[k] = (current[k] ?? 0) - (prior?.[k] ?? 0);
  return delta;
}

function classify(delta, config) {
  const t = config.warnThresholds;
  const regressed = (
    delta.todos                    >= t.newTodos                    ||
    delta.longParams               >= t.newLongParams               ||
    delta.modulesOverHighThreshold >= t.newModulesOverHighThreshold ||
    delta.loc                      >= t.locIncrease
  );
  if (!regressed) return 'silent';
  // Promote to warning when ANY hard category regresses
  if (delta.modulesOverHighThreshold > 0 || delta.longParams >= t.newLongParams) {
    return 'warning';
  }
  return 'advisory';
}

function formatAdvisory(level, delta, totals, scopeFiles) {
  const icon = level === 'warning' ? '🔴' : '🟡';
  const label = level === 'warning' ? 'Warning' : 'Advisory';
  const fileCount = scopeFiles.length === 1 ? '1 file' : `${scopeFiles.length} files`;
  const lines = [
    `${icon} PostSlice Hook — Clean-Code ${label}`,
    '',
    `Touched ${fileCount}. Metric deltas vs. prior baseline:`,
    `  • LOC                       ${fmtDelta(delta.loc)}    (now ${totals.loc})`,
    `  • function count            ${fmtDelta(delta.functions)}    (now ${totals.functions})`,
    `  • TODO/FIXME/HACK markers   ${fmtDelta(delta.todos)}    (now ${totals.todos})`,
    `  • long parameter lists      ${fmtDelta(delta.longParams)}    (now ${totals.longParams})`,
    `  • modules over LOC ceiling  ${fmtDelta(delta.modulesOverHighThreshold)}    (now ${totals.modulesOverHighThreshold})`,
    '',
    'Run `/clean-code-review` for the full audit with fix suggestions.',
  ];
  return lines.join('\n');
}

function fmtDelta(n) {
  if (n === 0) return '   0';
  return (n > 0 ? `+${n}` : `${n}`).padStart(4);
}

// ─── persistence ─────────────────────────────────────────────────────

function readBaseline(baselinePath) {
  try {
    if (!fs.existsSync(baselinePath)) return null;
    const raw = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    return raw?.totals || null;
  } catch { return null; }
}

function writeBaseline(baselinePath, totals) {
  const payload = { updatedAt: new Date().toISOString(), totals };
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function appendHistory(historyPath, entry) {
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(historyPath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

// ─── skip evaluation ─────────────────────────────────────────────────

function evaluateSkip(commitMessage) {
  if (!commitMessage) return 'no-commit-message';
  for (const pattern of DEFAULTS.skipCommitPatterns) {
    if (pattern.test(commitMessage)) return `skip-pattern:${pattern.source}`;
  }
  if (!DEFAULTS.commitMustMatch.test(commitMessage)) return 'not-conventional-commit';
  return null;
}

// ─── main ────────────────────────────────────────────────────────────

export function runCleanCodeDelta(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const config = loadConfig(cwd);
  if (opts.scope) config.scopeGlobs = opts.scope;

  const result = {
    triggered: true,
    action: 'silent',
    skippedReason: null,
    message: null,
    prior: null,
    totals: null,
    delta: null,
    scope: [],
  };

  if (!config.enabled && !opts.force) {
    result.triggered = false;
    result.skippedReason = 'config-disabled';
    return result;
  }

  if (opts.skip !== false) {
    const commitMessage = opts.commitMessage !== undefined
      ? opts.commitMessage
      : getLatestCommitMessage(cwd);
    const skip = evaluateSkip(commitMessage);
    if (skip) {
      result.triggered = false;
      result.action = 'skip';
      result.skippedReason = skip;
      return result;
    }
  }

  const changed = Array.isArray(opts.changedFiles)
    ? opts.changedFiles
    : getChangedFiles(opts.since || 'HEAD~1', cwd);
  const inScope = changed.filter(f => isInScope(f, config.scopeGlobs));
  result.scope = inScope;

  // Measure the entire scope (not just changed files) so the totals can be
  // compared apples-to-apples with the baseline. Changed-file filtering is
  // used only to decide whether the hook is worth running at all.
  if (inScope.length === 0) {
    result.triggered = false;
    result.action = 'skip';
    result.skippedReason = 'no-scoped-files-changed';
    return result;
  }

  const allScopeFiles = walkScope(cwd, config.scopeGlobs);
  const { totals } = measureScope(allScopeFiles, cwd, config);
  result.totals = totals;

  const baselinePath = opts.baselinePath || path.join(cwd, '.forge', 'clean-code-baseline.json');
  const historyPath  = opts.historyPath  || path.join(cwd, '.forge', 'clean-code-history.jsonl');

  const prior = readBaseline(baselinePath);
  result.prior = prior;
  const delta = computeDelta(prior, totals);
  result.delta = delta;

  if (prior) {
    const level = classify(delta, config);
    result.action = level;
    if (level !== 'silent') {
      result.message = formatAdvisory(level, delta, totals, inScope);
    }
  } else {
    // First run — no prior to compare against. We still write the baseline so
    // the *next* commit has something to diff against.
    result.action = 'baseline-initialized';
  }

  if (opts.write !== false) {
    writeBaseline(baselinePath, totals);
    const sha = getLatestCommitSha(cwd);
    appendHistory(historyPath, {
      timestamp: new Date().toISOString(),
      commitSha: sha,
      scope: inScope,
      totals,
      delta,
      action: result.action,
    });
  }

  return result;
}

function main(argv) {
  const args = parseArgs(argv);
  const result = runCleanCodeDelta({
    cwd: args.cwd || process.cwd(),
    since: args.since,
    scope: args.scope,
    write: args.write,
    skip: args.skip,
    baselinePath: args.baselinePath,
    historyPath: args.historyPath,
    force: !args.skip, // --no-skip implies the user wants to bypass config.enabled
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.message) {
    process.stdout.write(`${result.message}\n`);
  }

  if (result.action === 'skip' || result.skippedReason === 'config-disabled') {
    process.exit(2);
  }
  process.exit(0);
}

// Run only when invoked as a script (not when imported by tests)
const isDirectInvocation = (() => {
  try {
    const argvPath = path.resolve(process.argv[1] || '');
    const selfPath = path.resolve(new URL(import.meta.url).pathname.replace(/^\//, ''));
    // Windows-safe comparison: normalize drive letter casing
    return argvPath.toLowerCase() === selfPath.toLowerCase();
  } catch { return false; }
})();

if (isDirectInvocation) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`clean-code-delta: ${err.message}\n`);
    process.exit(1);
  }
}
