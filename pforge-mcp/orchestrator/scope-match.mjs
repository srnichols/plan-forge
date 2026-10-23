/**
 * Plan Forge — scope path matching, shared by the scope guard (git-safety.mjs) and the plan linter
 * (task-scope-lint.mjs). It imports nothing, so either can depend on it without joining an import
 * cycle: git-safety reaches gate-helpers through hooks, and gate-helpers runs the linter.
 */

/**
 * Normalize a repo-relative path for scope comparison: backslashes to slashes,
 * strip a leading `./`, trim.
 *
 * @param {string} p
 * @returns {string}
 */
export function normalizeRepoPath(p) {
  return String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Match a single scope pattern against a normalized repo path. Supports `**`
 * (any characters, including `/`) and `*` (any characters except `/`). A
 * pattern without a wildcard matches the path exactly OR as a directory prefix.
 *
 * @param {string} pattern
 * @param {string} filePath — already normalized
 * @returns {boolean}
 */
export function matchScopeGlob(pattern, filePath) {
  const pat = normalizeRepoPath(pattern);
  if (!pat) return false;
  if (!pat.includes("*")) {
    return filePath === pat || filePath.startsWith(pat.endsWith("/") ? pat : pat + "/");
  }
  const NULL = "\u0000";
  const rx = new RegExp(
    "^" +
      pat
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, NULL)
        .replace(/\*/g, "[^/]*")
        .replace(new RegExp(NULL, "g"), ".*") +
      "$"
  );
  return rx.test(filePath);
}
