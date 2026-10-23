/**
 * Plan Forge — lint: a task asks to change a file the slice's scope does not allow (meta-bug #380).
 *
 * The scope guard blocks or reverts a worker's change outside the slice's `[scope:]` list, so a task
 * that says "create `docs/x.html`" while the scope omits it sets the worker up to fail. About ten of
 * the plan-defect meta-bugs filed before this lint shared that cause.
 *
 * Deliberately narrow, because the lint only warns and a noisy lint gets muted. A naive check of
 * "every backticked path against the scope" flagged 13% of the slices in docs/plans, and nearly all
 * of those were package-relative paths, runtime state, prose mentions and dotted names. So:
 *
 *   - A path counts only when it is the OBJECT of a write verb ("Update `a.md`", "Add a section to
 *     `b.md`", "Edit `a.md` and `c.md`"). A path that is read, cited, run or merely named does not,
 *     and neither does one a task says not to change.
 *   - It must be a file with a known extension. Globs, directories, config keys, event names,
 *     versions and addresses are not files.
 *   - Scope is read suffix-aware: scope `pforge-claw/src/**` allows the task's `src/router.mjs`.
 *     A path is also tried against the directories the same task names.
 *   - Runtime paths (`.forge/`, `state/`, `.vscode/`, ...) are skipped: a tool writes them.
 */

import { matchScopeGlob, normalizeRepoPath } from "./scope-match.mjs";

const RULE = "task-file-outside-scope";
const MAX_LISTED_PATHS = 5;
const MAX_LISTED_SCOPE = 4;

const FILE_EXTENSIONS = [
  "md", "mdx", "txt", "json", "jsonc", "yml", "yaml", "toml", "ini", "cfg", "conf", "lock", "xml", "html", "htm",
  "css", "scss", "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "sh", "bash", "ps1", "psm1", "bat", "cmd",
  "py", "rb", "go", "rs", "java", "kt", "swift", "cs", "csproj", "sln", "php", "sql", "graphql", "proto", "tf",
  "bicep", "gradle", "properties",
];
const FILE_PATH_RE = new RegExp(`^[\\w@~.-]+(?:/[\\w@~.-]+)*\\.(?:${FILE_EXTENSIONS.join("|")})$`, "i");

// Files a tool writes while it runs, not files a worker edits.
const RUNTIME_PATH_RE = /^(?:\.forge|\.git|\.vscode|\.idea|\.cache|node_modules|state|dist|build|coverage)(?:\/|$)|^\.env(?:\.|$)/;

// An instruction is imperative ("Update `a.md`"). A description of what code does ("It writes
// `config.json`", "port fixed in `pforge.sh`") is not a task to change the file.
const WRITE_VERB_RE = new RegExp(
  "^(?:create|add|write|edit|modify|update|replace|rewrite|regenerate|append|delete|remove|rename|extend|implement|" +
  "patch|touch|change|generate|scaffold|fix|refactor)$",
  "i",
);
// Words that may sit between a verb and its object: "Add a new section to `x.md`".
const FILLER_WORDS = new Set([
  "a", "an", "the", "new", "existing", "current", "this", "its", "their", "file", "files", "module", "modules",
  "script", "scripts", "test", "tests", "doc", "docs", "document", "documentation", "section", "sections", "entry",
  "entries", "line", "lines", "row", "rows", "table", "list", "block", "note", "notes", "to", "in", "into", "under",
  "at", "of", "for", "each", "every", "all", "and", "or", "plus", "also", "then",
]);
const NEGATION_WORDS = new Set(["not", "no", "never", "without", "avoid", "don't", "dont", "doesn't", "except", "nothing", "nor"]);

// The scope guard reads the git diff, so a file the task says is ignored or not committed never reaches it.
const NOT_COMMITTED_RE = /\b(?:git-?ignored|untracked|not committed)\b/i;

// One match per unit of a line: a backticked span, a word, or a clause break.
const UNIT_RE = /`([^`\n]+)`|([A-Za-z][A-Za-z'’-]*)|([.;:!?])/g;

const isFilePath = (span) => FILE_PATH_RE.test(span) && !span.includes("..");
const isDirectory = (span) => /\/$/.test(span) || (span.includes("/") && !/\.[A-Za-z0-9]+$/.test(span));

/**
 * The files a line asks to change, and the directories it names. A write verb opens a clause; the
 * clause stays open across filler words, conjunctions and other backticked spans, and closes at a
 * clause break or any other word. A negation closes it for the rest of the sentence.
 */
function scanLine(line) {
  const objects = [];
  const directories = [];
  const committed = !NOT_COMMITTED_RE.test(line);
  let active = false;
  let negated = false;
  for (const [, span, word, clauseBreak] of line.matchAll(UNIT_RE)) {
    if (span !== undefined) {
      const path = normalizeRepoPath(span);
      if (isDirectory(path)) directories.push(path.replace(/\/$/, ""));
      else if (active && committed && isFilePath(path)) objects.push(path);
      continue;
    }
    if (clauseBreak !== undefined) {
      active = false;
      negated = false;
      continue;
    }
    const lower = word.toLowerCase();
    if (NEGATION_WORDS.has(lower)) {
      active = false;
      negated = true;
    } else if (WRITE_VERB_RE.test(lower)) {
      active = !negated;
    } else if (!FILLER_WORDS.has(lower)) {
      active = false;
    }
  }
  return { objects, directories };
}

function literalRoot(pattern) {
  const segments = [];
  for (const segment of normalizeRepoPath(pattern).split("/")) {
    if (/[*?[{]/.test(segment)) break;
    segments.push(segment);
  }
  return segments;
}

// A path is covered when the scope allows it as written, or as the tail of a path under the scope's
// root or one of its parent directories (scope `pforge-claw/src/**`, task `src/router.mjs`; scope
// `docs/manual/*`, task `cli-reference.html`).
function scopeCovers(entry, path) {
  const pattern = normalizeRepoPath(entry);
  if (matchScopeGlob(pattern, path)) return true;
  const root = literalRoot(pattern);
  // An entry that names one file has no directory of its own for a path to be relative to.
  const lastDirectoryDepth = isFilePath(pattern) ? root.length - 1 : root.length;
  for (let depth = 1; depth <= lastDirectoryDepth; depth++) {
    if (matchScopeGlob(pattern, `${root.slice(0, depth).join("/")}/${path}`)) return true;
  }
  return false;
}

function allowedByScope(scope, path, directories) {
  const candidates = [path, ...directories.map((directory) => `${directory}/${path}`)];
  return candidates.some((candidate) => scope.some((entry) => scopeCovers(entry, candidate)));
}

/** Paths the slice's tasks ask to change that its scope does not allow, in first-mention order. */
function pathsOutsideScope(slice) {
  const found = new Set();
  for (const task of slice.tasks) {
    const lines = String(task).split("\n").map(scanLine);
    const directories = lines.flatMap((line) => line.directories);
    for (const { objects } of lines) {
      for (const path of objects) {
        if (!RUNTIME_PATH_RE.test(path) && !allowedByScope(slice.scope, path, directories)) found.add(path);
      }
    }
  }
  return [...found];
}

function describeList(items, limit, render) {
  const shown = items.slice(0, limit).map(render).join(", ");
  return items.length > limit ? `${shown} (+${items.length - limit} more)` : shown;
}

/**
 * One warning per slice whose tasks ask to change files outside its declared scope. A slice with no
 * scope is not judged (nothing for the guard to enforce), and neither is a plain object without
 * `tasks` and `scope` arrays.
 *
 * @param {{ slices?: Array<{ number: string|number, title?: string, tasks?: string[], scope?: string[] }> }} plan
 * @returns {Array<{ slice: string|number, command: null, rule: string, severity: "warn", message: string }>}
 */
export function lintTaskFilesOutsideScope(plan) {
  const warnings = [];
  for (const slice of plan?.slices ?? []) {
    if (!Array.isArray(slice.tasks) || !Array.isArray(slice.scope) || slice.scope.length === 0) continue;
    const outside = pathsOutsideScope(slice);
    if (outside.length === 0) continue;
    warnings.push({
      slice: slice.number,
      command: null,
      rule: RULE,
      severity: "warn",
      message:
        `Slice ${slice.number} ("${slice.title}"): a task asks to change ${describeList(outside, MAX_LISTED_PATHS, (path) => `\`${path}\``)}, ` +
        `which the slice's scope (${describeList(slice.scope, MAX_LISTED_SCOPE, (entry) => entry)}) does not allow. ` +
        "The scope guard blocks or reverts a change outside the scope: add the file to the slice's scope, " +
        "or reword the task if the file is only read.",
    });
  }
  return warnings;
}
