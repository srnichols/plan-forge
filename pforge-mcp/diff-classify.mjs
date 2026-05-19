/**
 * Plan Forge — diff-classify.mjs (Phase WORKER-GUARDRAILS Slice A2)
 *
 * Classifies staged git diff changes by file category:
 *   plan    — plan files in docs/plans/
 *   test    — test files (*.test.*, *.spec.*, __tests__/, /tests/)
 *   docs    — documentation files (*.md, *.rst, docs/)
 *   config  — configuration files (.env, Dockerfile, tsconfig, .github/, .vscode/)
 *   chore   — build scripts, tooling, package files
 *   scope   — source / application code (business logic, APIs)
 *   unknown — unrecognized
 *
 * Exports:
 *   classifyFile(filePath)        → category string (synchronous, pure)
 *   classifyFiles(filePaths)      → Array<{ file, category }>
 *   classifyDiff(options)         → classification result object
 *   runDiffClassifyCheck(options) → preCommit chain result shape
 */

import { execSync } from "node:child_process";

// ─── Category rules (first match wins) ────────────────────────────────────

const CATEGORY_RULES = [
  {
    cat: "plan",
    match: (f) => /^docs\/plans\//i.test(f),
  },
  {
    cat: "test",
    match: (f) =>
      /\.(test|spec)\.(mjs|js|ts|jsx|tsx|cs|py|go|java|rb)$/.test(f) ||
      /\/__tests__\//.test(f) ||
      /(^|\/)tests\//.test(f),
  },
  {
    cat: "docs",
    match: (f) =>
      /\.(md|mdx|txt|rst|adoc)$/.test(f) ||
      (/^docs\//i.test(f) && !/^docs\/plans\//i.test(f)),
  },
  {
    cat: "config",
    match: (f) =>
      /(^|\/)(\.env[^/]*|Dockerfile[^/]*|docker-compose[^/]*)$/.test(f) ||
      /^\.github\//.test(f) ||
      /^\.vscode\//.test(f) ||
      /^\.forge\.json$/.test(f) ||
      /^\.forge\//.test(f) ||
      /(^|\/)(tsconfig[^/]*|jest\.config[^/]*|vitest\.config[^/]*|eslint[^/]*|prettier[^/]*|babel\.config[^/]*)$/.test(f),
  },
  {
    cat: "chore",
    match: (f) =>
      /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Makefile)$/.test(f) ||
      /(^|\/)(setup\.(sh|ps1|ps1)|pforge\.(sh|ps1))$/.test(f) ||
      /\.(sh|ps1)$/.test(f),
  },
  {
    cat: "scope",
    match: (f) =>
      /\.(mjs|js|ts|jsx|tsx|cs|py|go|java|rb|rs|cpp|c|h|hpp|swift|kt)$/.test(f),
  },
];

/**
 * Classify a single file path into a category.
 *
 * @param {string} filePath
 * @returns {"plan"|"test"|"docs"|"config"|"chore"|"scope"|"unknown"}
 */
export function classifyFile(filePath) {
  for (const rule of CATEGORY_RULES) {
    if (rule.match(filePath)) return rule.cat;
  }
  return "unknown";
}

/**
 * Classify an array of file paths.
 *
 * @param {string[]} filePaths
 * @returns {Array<{ file: string, category: string }>}
 */
export function classifyFiles(filePaths) {
  return filePaths.map((f) => ({ file: f, category: classifyFile(f) }));
}

/**
 * Build a human-readable summary string from a summary counts object.
 *
 * @param {Record<string, number>} summary
 * @returns {string}
 */
function buildSummaryText(summary) {
  return Object.entries(summary)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(", ");
}

/**
 * Get staged file list from git and classify them.
 *
 * @param {{ cwd?: string, since?: string }} options
 *   cwd   — working directory (default: process.cwd())
 *   since — git ref to diff against (default: staged diff --staged)
 * @returns {{
 *   ok: boolean,
 *   files: Array<{ file: string, category: string }>,
 *   summary: Record<string, number>,
 *   total: number,
 *   advisory?: string,
 *   error?: string
 * }}
 */
export function classifyDiff(options = {}) {
  const cwd = options.cwd || process.cwd();

  let stdout;
  try {
    const cmd = options.since
      ? `git diff --name-only ${options.since}`
      : "git diff --staged --name-only";
    stdout = execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    return {
      ok: false,
      files: [],
      summary: {},
      total: 0,
      error: `git diff failed: ${err.message}`,
    };
  }

  const paths = stdout ? stdout.split("\n").filter(Boolean) : [];
  const classified = classifyFiles(paths);

  // Build summary counts
  const summary = {};
  for (const { category } of classified) {
    summary[category] = (summary[category] || 0) + 1;
  }

  const advisory =
    paths.length > 0
      ? `Staged diff: ${paths.length} file(s) — ${buildSummaryText(summary)}`
      : "No staged changes detected.";

  return { ok: true, files: classified, summary, total: paths.length, advisory };
}

/**
 * Run diff-classify as a preCommit chain entry.
 * Always advisory (never blocks) — returns classification info for logging.
 *
 * @param {{ cwd?: string }} options
 * @returns {{ blocked: boolean, advisory?: string, classification?: object }}
 */
export function runDiffClassifyCheck(options = {}) {
  const result = classifyDiff(options);

  if (!result.ok) {
    // git unavailable — degrade gracefully, don't block
    return {
      blocked: false,
      advisory: `diff-classify: ${result.error || "git unavailable — skipped"}`,
    };
  }

  return {
    blocked: false,
    advisory: result.advisory,
    classification: {
      files: result.files,
      summary: result.summary,
      total: result.total,
    },
  };
}
