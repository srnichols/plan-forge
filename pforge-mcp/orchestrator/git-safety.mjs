/** Plan Forge — Phase-53 S9: git safety sub-module */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { resolve, relative, join, dirname, basename, isAbsolute } from "node:path";
import { parseGitPorcelain, parseShortstat } from "./hooks.mjs";

export function isDestructiveSliceTitle(title) {
  if (typeof title !== "string") return false;
  return /^\s*(teardown|cleanup|rollback|postmortem|finalize)\b/i.test(title);
}

/** Default configuration for the Teardown Safety Guard. */
const TEARDOWN_GUARD_DEFAULTS = {
  enabled: true,
  blockOnBranchLoss: true,
  checkRemote: true,
  // Phase-26 Slice 4 — paths exempt from branch-loss detection.
  // When a missing-branch failure resolves to a worktree living under one
  // of these prefixes, the guard filters the failure instead of opening an
  // incident. Prevents competitive worktree archival from tripping the guard.
  exemptPathPrefixes: [".forge/worktrees", ".forge/worktrees-archive"],
};

/**
 * Phase-26 Slice 4 — pure path predicate.
 * Returns true when `candidatePath` (absolute or relative) resolves under
 * any of the exempt prefixes. Comparison is performed with forward-slash
 * normalization so Windows paths behave the same as POSIX.
 *
 * @param {string} candidatePath - Path to test.
 * @param {string[]} [prefixes] - Optional prefix list (defaults to the guard defaults).
 * @returns {boolean}
 */
export function isWorktreeExemptPath(candidatePath, prefixes = TEARDOWN_GUARD_DEFAULTS.exemptPathPrefixes) {
  if (typeof candidatePath !== "string" || candidatePath.length === 0) return false;
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false;
  const normalized = candidatePath.replace(/\\/g, "/");
  for (const prefix of prefixes) {
    if (typeof prefix !== "string" || prefix.length === 0) continue;
    const normPrefix = prefix.replace(/\\/g, "/").replace(/\/$/, "");
    // Match segment boundary: `.forge/worktrees` matches
    // `.forge/worktrees/...` or `path/to/.forge/worktrees/...`
    // but not `.forge/worktrees-other`.
    const idx = normalized.indexOf(normPrefix);
    if (idx < 0) continue;
    const after = normalized[idx + normPrefix.length];
    if (after === undefined || after === "/") return true;
  }
  return false;
}

/**
 * Load teardown guard configuration from .forge.json.
 * Falls back to TEARDOWN_GUARD_DEFAULTS if absent or malformed.
 * @param {string} cwd - Project root directory
 * @returns {{ enabled: boolean, blockOnBranchLoss: boolean, checkRemote: boolean }}
 */
export function loadTeardownGuardConfig(cwd) {
  let config = { ...TEARDOWN_GUARD_DEFAULTS };
  const configPath = resolve(cwd, ".forge.json");
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw?.orchestrator?.teardownGuard) {
        config = { ...config, ...raw.orchestrator.teardownGuard };
      }
    } catch {
      /* malformed config — use defaults */
    }
  }
  return config;
}

// Phase-53 S5: loadGateCheckConfig, registerGateCheckResponder → orchestrator/forge-io.mjs

// ─── Phase FORGE-SHOP-06 Slice 06.2 — Correlation Thread Responder ──

/**
 * Register the `brain.correlation-thread` hub responder.
 * Reads hub-events.jsonl and filters by correlationId.
 *
 * @param {object} hub - Hub instance with onAsk
 * @param {string} cwd - Project root
 * @param {object} [deps] - DI overrides
 */
// Phase-53 S6: registerCorrelationThreadResponder → orchestrator/hooks.mjs

/**
 * Verify that git branch state was not destroyed during a slice.
 * @param {{ branch: string, headSha: string, upstream: string|null }} baseline
 * @param {{ checkRemote: boolean, exemptPathPrefixes?: string[] }} config
 * @param {string} cwd
 * @param {{ exec?: (cmd: string, opts: object) => string }} [deps] - DI for tests.
 * @returns {{ ok: boolean, failures: string[], reflogTail: string[] }}
 */
export function verifyBranchSafety(baseline, config, cwd, deps = {}) {
  const exec = deps.exec || ((cmd, opts) => execSync(cmd, opts));
  const failures = [];
  let reflogTail = [];
  let localBranchMissing = false;

  // 1. Local branch ref still exists
  try {
    exec(`git show-ref --verify refs/heads/${baseline.branch}`, {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    });
  } catch {
    localBranchMissing = true;
    failures.push(`local branch ref 'refs/heads/${baseline.branch}' no longer exists`);
  }

  // 2. Baseline HEAD still reachable
  try {
    exec(`git cat-file -e ${baseline.headSha}^{commit}`, {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    });
  } catch {
    failures.push(`baseline HEAD ${baseline.headSha} is no longer reachable`);
  }

  // 3. Remote branch ref (when upstream was configured and checkRemote enabled)
  if (baseline.upstream && config.checkRemote) {
    try {
      const remoteName = baseline.upstream.split("/")[0] || "origin";
      const remoteBranch = baseline.upstream.split("/").slice(1).join("/") || baseline.branch;
      const lsRemote = exec(`git ls-remote --heads ${remoteName} ${remoteBranch}`, {
        cwd, encoding: "utf-8", timeout: 10000, stdio: "pipe",
      }).trim();
      if (!lsRemote) {
        failures.push(`remote branch '${baseline.upstream}' no longer exists on remote`);
      }
    } catch (err) {
      failures.push(`remote check failed for '${baseline.upstream}': ${err.message || "unknown error"}`);
    }
  }

  // Phase-26 Slice 4 — filter branch-loss failures whose underlying
  // worktree path lives under an exempt prefix (competitive worktrees).
  const exemptPrefixes = Array.isArray(config.exemptPathPrefixes)
    ? config.exemptPathPrefixes
    : TEARDOWN_GUARD_DEFAULTS.exemptPathPrefixes;
  if (localBranchMissing && exemptPrefixes.length > 0) {
    const worktreePath = resolveBranchWorktreePath(baseline.branch, cwd, exec);
    if (worktreePath && isWorktreeExemptPath(worktreePath, exemptPrefixes)) {
      // Drop the local-branch-ref failure — the worktree was intentionally torn down.
      const idx = failures.indexOf(`local branch ref 'refs/heads/${baseline.branch}' no longer exists`);
      if (idx >= 0) failures.splice(idx, 1);
    }
  }

  // On failure, capture reflog for recovery
  if (failures.length > 0) {
    try {
      reflogTail = exec("git reflog -n 20 --format=%H\\ %gs", {
        cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
      }).trim().split("\n");
    } catch { /* reflog unavailable */ }
  }

  return { ok: failures.length === 0, failures, reflogTail };
}

/**
 * Phase-26 Slice 4 — look up the worktree path for a given branch by
 * parsing `git worktree list --porcelain`. Returns null when the branch
 * has no associated worktree (e.g. already deleted) or when git fails.
 *
 * @param {string} branch
 * @param {string} cwd
 * @param {(cmd: string, opts: object) => string} exec
 * @returns {string|null}
 */
function resolveBranchWorktreePath(branch, cwd, exec) {
  try {
    const porcelain = exec("git worktree list --porcelain", {
      cwd, encoding: "utf-8", timeout: 5000, stdio: "pipe",
    });
    // Porcelain format: blocks separated by blank lines.
    //   worktree <path>
    //   HEAD <sha>
    //   branch refs/heads/<name>
    const blocks = String(porcelain).split(/\r?\n\r?\n/);
    for (const block of blocks) {
      if (!block.includes(`branch refs/heads/${branch}`)) continue;
      const m = block.match(/^worktree\s+(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch {
    /* git unavailable or no worktrees — fall through */
  }
  return null;
}

// Phase-53 S6: isDeployTrigger, isCacheStale → orchestrator/hooks.mjs

/**
 * Run the PreDeploy hook logic. Reads secret-scan and env-diff caches,
 * evaluates them against the hook configuration, and returns a result
 * indicating whether the deploy should be blocked or an advisory issued.
 *
 * @param {object} params
 * @param {string} params.toolName  - Tool being invoked
 * @param {string} [params.filePath=""] - File path being written
 * @param {string} [params.command=""]  - Command being executed
 * @param {string} [params.cwd=process.cwd()] - Project root directory
 * @returns {{ triggered: boolean, blocked?: boolean, reason?: string, advisory?: string, secretFindings?: Array, envGaps?: Array }}
 */
// Phase-53 S6: runPreDeployHook → orchestrator/hooks.mjs

// ─── PostSlice Hook ───────────────────────────────────────────────────
// Phase-53 S6: POSTSLICE_COMMIT_PATTERN, POSTSLICE_SKIP_PATTERNS,
// POSTSLICE_DEFAULTS, resetPostSliceHookFired → orchestrator/hooks.mjs

/**
 * Parse `git status --porcelain` output into a Map<path, statusLine>.
 * The status line is the full original line including the XY status code,
 * which lets callers tell whether a path was further modified between two
 * snapshots (same path + different line = worker touched it). Renames are
 * tracked at their post-rename path.
 *
 * @param {string} porcelain
 * @returns {Map<string, string>}
 */
// Phase-53 S6: parseGitPorcelain, parseShortstat → orchestrator/hooks.mjs

/**
 * Issue #195 — enumerate commits that landed between two SHAs during a
 * slice window. Used by {@link autoCommitSliceIfDirty} to record external
 * commits (e.g. the VS Code Copilot extension's auto-commit) that would
 * otherwise be silently absorbed into the orchestrator's housekeeping
 * commit, producing a misleading "feat(slice-N): …" message on a tree
 * containing only `.forge/` artifacts.
 *
 * Returns an array of `{ sha, author, subject, diffstat }`, oldest first.
 * Returns `[]` on any git failure — callers treat absence as
 * "no race detected", which is the safe default.
 */
export function captureAbsorbedCommits({ cwd = process.cwd(), fromSha, toSha = "HEAD" } = {}) {
  if (!fromSha) return [];
  let log;
  try {
    log = execSync(
      `git log --reverse --format=%H%x09%an%x09%s ${fromSha}..${toSha}`,
      { cwd, encoding: "utf-8", timeout: 5_000 },
    );
  } catch {
    return [];
  }
  const commits = [];
  const lines = (log || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const [sha, author, ...rest] = line.split("\t");
    if (!sha) continue;
    let diffstat = null;
    try {
      const shortstat = execSync(`git show --shortstat --format= ${sha}`, { cwd, encoding: "utf-8", timeout: 5_000 });
      diffstat = parseShortstat(shortstat);
    } catch { /* ignore */ }
    commits.push({ sha, author: author || "unknown", subject: rest.join("\t") || "", diffstat });
  }
  return commits;
}

/**
 * Capture the working-tree state at slice start so {@link autoCommitSliceIfDirty}
 * can later distinguish worker-owned paths from operator-owned paths that
 * were already dirty when the slice began. Issue #151.
 *
 * Returns null on any git failure (caller treats null as "no snapshot — fall
 * back to legacy `git add -A` behaviour").
 *
 * @param {{ cwd?: string }} [params]
 * @returns {Map<string, string>|null}
 */
export function snapshotPreSliceState({ cwd = process.cwd() } = {}) {
  try {
    const out = execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 });
    return parseGitPorcelain(out);
  } catch {
    return null;
  }
}

/**
 * Issue #178 / #202 — stash any pre-slice working-tree changes before the
 * worker runs, so a buggy worker (or a destructive teardown) can't trample
 * operator WIP. Pair with `popSliceSnapshot` at slice end.
 *
 * #202: `git stash push` without `-u` silently SKIPS untracked files even
 * when `git status --porcelain` shows them as dirty. That caused
 * `pushSliceSnapshot` to return `pushed:true` when no stash was actually
 * created (untracked-only working trees), surfacing at pop time as a
 * misleading "snapshot stash not found" error. Add `-u` so untracked
 * files are protected too and push/pop status is honest.
 *
 * @param {{ cwd?: string, sliceNumber: string|number, _execSync?: Function }} params
 * @returns {{ pushed: boolean, stashRef: string|null, reason?: string }}
 */
export function pushSliceSnapshot({ cwd = process.cwd(), sliceNumber, _execSync = execSync } = {}) {
  const stashRef = `pforge-slice-${sliceNumber}-snapshot`;
  try {
    const status = _execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 }).toString().trim();
    if (!status) return { pushed: false, stashRef: null, reason: "clean-tree" };
    // #202: `-u` (--include-untracked) — without it, an untracked-only tree
    // is silently skipped and the caller is misled into thinking we stashed.
    _execSync(`git stash push -u -m "${stashRef}"`, { cwd, encoding: "utf-8", timeout: 10_000 });
    return { pushed: true, stashRef };
  } catch (err) {
    return { pushed: false, stashRef: null, reason: (err?.message || "git-failed").slice(0, 200) };
  }
}

/**
 * Issue #178 / #201 — restore the snapshot stashed by `pushSliceSnapshot`.
 * Always called at slice end (success OR failure) so operator WIP is never
 * silently captured in `git stash list`.
 *
 * Strategy (Issue #201):
 *   1. Look up the stash ref BY MESSAGE (`pforge-slice-N-snapshot`), not by
 *      blind `git stash pop` of the top of the stack — the top may be an
 *      unrelated operator stash if anything stashed during the slice run.
 *   2. Use `git stash apply <ref>` (non-destructive). If it succeeds, drop
 *      the stash explicitly. If it fails with conflict OR "would be
 *      overwritten" (the dirty-tree case caused by orchestrator runtime
 *      writes between push and pop), leave the stash in place and return a
 *      structured error so the operator can recover via
 *      `git stash list` + `git stash show -p <ref>`.
 *
 * Conflict trigger (Issue #201): the orchestrator self-modifies runtime
 * files between push and pop (`.forge/watch-history.jsonl`,
 * `liveguard-broadcast.log`, `server-ports.json`, `model-performance.json`,
 * `quorum-history.jsonl`). Old behavior: blind `pop` failed with "would be
 * overwritten by merge", but git actually leaves the stash intact in that
 * case — the snapshot then accumulates in `git stash list` forever.
 *
 * @param {{ cwd?: string, sliceNumber: string|number, _execSync?: Function }} params
 * @returns {{ restored: boolean, conflict?: boolean, dirtyTree?: boolean, error?: string, stashRef?: string }}
 */
export function popSliceSnapshot({ cwd = process.cwd(), sliceNumber, _execSync = execSync } = {}) {
  const message = `pforge-slice-${sliceNumber}-snapshot`;
  // Step 1: find the stash ref by message (more reliable than top-of-stack).
  let stashRef = null;
  try {
    const list = _execSync("git stash list", { cwd, encoding: "utf-8", timeout: 5_000 }).toString();
    for (const line of list.split(/\r?\n/)) {
      // Match e.g. "stash@{2}: On master: pforge-slice-3-snapshot"
      const m = line.match(/^(stash@\{\d+\}):\s*[^:]*:\s*(.+)$/);
      if (m && m[2].trim() === message) { stashRef = m[1]; break; }
    }
  } catch (err) {
    return { restored: false, error: `git stash list failed: ${(err?.message || "").slice(0, 200)}` };
  }
  if (!stashRef) {
    // Nothing to restore (push reported `clean-tree`, or someone else dropped it).
    return { restored: false, error: "snapshot stash not found in git stash list" };
  }
  // Step 2: apply (non-destructive). On success, drop. On failure, leave intact.
  try {
    _execSync(`git stash apply ${stashRef}`, { cwd, encoding: "utf-8", timeout: 15_000, stdio: "pipe" });
  } catch (err) {
    const stderr = (err?.stderr?.toString?.() || err?.message || "").toString().trim();
    const conflict = /conflict|CONFLICT/i.test(stderr);
    const dirtyTree = /would be overwritten/i.test(stderr);
    return {
      restored: false,
      conflict,
      dirtyTree,
      stashRef,
      error: (stderr.slice(0, 400) || "git stash apply failed") +
        ` — recover with: git stash show -p ${stashRef} ; git stash apply ${stashRef}`,
    };
  }
  // Step 3: drop only after successful apply.
  try {
    _execSync(`git stash drop ${stashRef}`, { cwd, encoding: "utf-8", timeout: 10_000, stdio: "pipe" });
  } catch {
    // Apply succeeded but drop failed — non-fatal, operator can clean up.
  }
  return { restored: true, stashRef };
}

/**
 * Attach snapshot restore metadata to a slice result and restore the snapshot
 * exactly once when `snapshotStash` is true.
 *
 * This centralizes snapshot finalize behavior so every executeSlice return path
 * (success, failure, early-return) reports consistent snapshot fields.
 *
 * @param {{
 *   sliceResult: Record<string, any>,
 *   snapshotStash: boolean,
 *   cwd?: string,
 *   sliceNumber: string|number,
 *   eventBus?: { emit?: Function }|null,
 *   _popSliceSnapshot?: Function,
 * }} params
 * @returns {Record<string, any>}
 */
export function attachSliceSnapshotRestore({
  sliceResult,
  snapshotStash,
  cwd = process.cwd(),
  sliceNumber,
  eventBus = null,
  _popSliceSnapshot = popSliceSnapshot,
} = {}) {
  const base = { ...(sliceResult || {}) };

  if (!snapshotStash) {
    return { ...base, snapshotStashed: false };
  }

  const restore = _popSliceSnapshot({ cwd, sliceNumber });
  const withSnapshot = {
    ...base,
    snapshotStashed: true,
    snapshotRestored: !!restore?.restored,
  };

  if (!restore?.restored) {
    withSnapshot.snapshotRestoreError = restore?.error || "snapshot restore failed";
    if (eventBus) {
      eventBus.emit("snapshot-restore-failed", {
        sliceNumber,
        stashRef: `pforge-slice-${sliceNumber}-snapshot`,
        conflict: !!restore?.conflict,
        error: withSnapshot.snapshotRestoreError,
        recovery: "Run `git stash list` and `git stash apply stash@{0}` to recover your WIP.",
      });
    }
  }

  return withSnapshot;
}

/**
 * Issue #201 — janitor pass that drops `pforge-slice-N-snapshot` stashes
 * older than a threshold (default 7 days). Prevents long-term accumulation
 * of orphaned snapshots from conflicted pops in prior runs.
 *
 * Called at run-start from `runPlan` (best-effort, errors swallowed).
 *
 * @param {{ cwd?: string, maxAgeDays?: number, _execSync?: Function, _now?: () => Date }} params
 * @returns {{ scanned: number, dropped: string[], errors: string[] }}
 */
export function cleanupStaleSnapshots({
  cwd = process.cwd(),
  maxAgeDays = 7,
  _execSync = execSync,
  _now = () => new Date(),
} = {}) {
  const result = { scanned: 0, dropped: [], errors: [] };
  let list;
  try {
    // `%gd %ct %s` → stash ref, committer Unix timestamp, subject.
    list = _execSync(
      'git stash list --format="%gd|%ct|%s"',
      { cwd, encoding: "utf-8", timeout: 5_000 },
    ).toString();
  } catch (err) {
    result.errors.push(`git stash list failed: ${(err?.message || "").slice(0, 200)}`);
    return result;
  }
  const cutoffSec = Math.floor(_now().getTime() / 1000) - maxAgeDays * 24 * 60 * 60;
  // Iterate oldest→newest by collecting first, then dropping in reverse order
  // so refs remain valid (dropping stash@{0} shifts the others down).
  const toDrop = [];
  for (const line of list.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("|");
    if (parts.length < 3) continue;
    const [ref, tsStr, subject] = parts;
    result.scanned++;
    const ts = parseInt(tsStr, 10);
    if (!Number.isFinite(ts) || ts >= cutoffSec) continue;
    // Only target our own snapshot stashes — leave operator stashes alone.
    if (!/pforge-slice-\d+-snapshot/.test(subject)) continue;
    toDrop.push(ref);
  }
  // Drop in reverse so earlier refs stay stable (stash@{N} indexes shift down).
  for (const ref of toDrop.reverse()) {
    try {
      _execSync(`git stash drop ${ref}`, { cwd, encoding: "utf-8", timeout: 5_000, stdio: "pipe" });
      result.dropped.push(ref);
    } catch (err) {
      result.errors.push(`drop ${ref}: ${(err?.message || "").slice(0, 100)}`);
    }
  }
  return result;
}

/**
 * Issue #152 — extract the file paths declared in a slice's
 * **Files Modified (Exhaustive)** table (or the more permissive
 * **Files Modified** label many plans use).
 *
 * Plans express the table in markdown:
 *
 *   | File | Change |
 *   |------|--------|
 *   | `path/to/file.ts` | description |
 *   | path/other.md     | description |
 *
 * Only the first column is parsed. Backtick-wrapped paths are preferred;
 * otherwise we accept any token that looks like a path (contains `/`, `.`,
 * or matches a glob-ish pattern). Returns an empty array when the slice has
 * no such table — the caller must treat that as "no contract to enforce"
 * rather than a violation.
 *
 * @param {{ rawLines?: string[] }} slice
 * @returns {string[]}
 */
function _isTableCloseLine(trimmed) {
  return trimmed === "" || /^#{1,6}\s/.test(trimmed) || /^\*\*[^*]+\*\*\s*:?\s*$/.test(trimmed);
}

function _isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function _extractDeclaredPathsFromCell(firstCell, declared) {
  const backticks = firstCell.match(/`([^`]+)`/g);
  if (backticks && backticks.length > 0) {
    for (const b of backticks) {
      const p = b.replace(/`/g, "").trim();
      if (p && !declared.includes(p)) declared.push(p);
    }
    return;
  }
  if (/[/.]/.test(firstCell) && !/\s/.test(firstCell)) {
    if (!declared.includes(firstCell)) declared.push(firstCell);
  }
}

export function extractFilesModifiedExhaustive(slice) {
  const lines = slice?.rawLines || [];
  if (lines.length === 0) return [];

  const headerRe = /^\s*\*{0,2}files\s+(?:modified|touched)(?:\s*\([^)]*\))?\*{0,2}\s*:?\s*$/i;

  const declared = [];
  let inTable = false;
  let sawSeparator = false;

  for (const line of lines) {
    if (!inTable) {
      if (headerRe.test(line.trim())) {
        inTable = true;
        sawSeparator = false;
      }
      continue;
    }

    const trimmed = line.trim();
    if (_isTableCloseLine(trimmed)) {
      // Allow a single blank line right after the header before the table starts
      if (declared.length === 0 && trimmed === "" && !sawSeparator) continue;
      break;
    }

    if (_isTableSeparator(line)) {
      sawSeparator = true;
      continue;
    }

    if (line.includes("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
      if (cells.length === 0) continue;
      const firstCell = cells[0];
      if (!sawSeparator && /^(file|path|filename)$/i.test(firstCell)) continue;
      _extractDeclaredPathsFromCell(firstCell, declared);
    }
  }

  return declared;
}

/**
 * Issue #152 — verify every path declared in the slice's
 * **Files Modified (Exhaustive)** table actually appears in the slice's
 * working-tree changes (`git diff --name-only <startSha>..HEAD` plus current
 * porcelain for uncommitted edits).
 *
 * Returns a structured result. Never throws. When `declared` is empty, the
 * result reports `enforced: false` — there's no contract to enforce.
 *
 * @param {object} params
 * @param {{ number: number|string, title: string, rawLines?: string[] }} params.slice
 * @param {string} [params.cwd=process.cwd()]
 * @param {string|null} [params.startSha] — HEAD SHA captured at slice start
 * @returns {{
 *   enforced: boolean,
 *   declared: string[],
 *   actual: string[],
 *   missing: string[],
 * }}
 */
export function verifyFilesModified({ slice, cwd = process.cwd(), startSha = null } = {}) {
  const declared = extractFilesModifiedExhaustive(slice);
  if (declared.length === 0) {
    return { enforced: false, declared: [], actual: [], missing: [] };
  }

  // Collect actual touched paths: committed since startSha + currently dirty.
  const actualSet = new Set();

  if (startSha) {
    try {
      const diffOut = execSync(`git diff --name-only ${startSha} HEAD`, {
        cwd, encoding: "utf-8", timeout: 5_000,
      });
      for (const p of diffOut.split(/\r?\n/)) {
        const path = p.trim();
        if (path) actualSet.add(path);
      }
    } catch { /* startSha may not exist on first slice — fall through */ }
  }

  try {
    const porcelain = execSync("git status --porcelain", {
      cwd, encoding: "utf-8", timeout: 5_000,
    });
    for (const path of parseGitPorcelain(porcelain).keys()) {
      actualSet.add(path);
    }
  } catch { /* not a git repo — leave actualSet possibly empty */ }

  const actual = [...actualSet];
  // Normalize separators for cross-platform comparison (declared paths in
  // plans are typically forward-slash; git output is forward-slash on all OSes).
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const actualNorm = new Set(actual.map(norm));
  const missing = declared.filter((d) => !actualNorm.has(norm(d)));

  return { enforced: true, declared, actual, missing };
}

/**
 * After a slice passes, commit any dirty working-tree changes with a
 * deterministic conventional-commit message derived from the slice title.
 * Never commits on `mode === "assisted"` runs.
 *
 * Issue #151 — when `preSliceState` is provided, only paths the worker
 * actually created or modified during the slice are staged. Paths that were
 * already dirty at slice start (operator edits, parallel-process scratch
 * files) are left alone and reported via a `slice-foreign-files-detected`
 * event. Without `preSliceState` the function falls back to the legacy
 * `git add -A` behaviour for backward compatibility.
 *
 * @param {object} params
 * @param {{ number: number, title: string }} params.slice
 * @param {string} [params.cwd=process.cwd()]
 * @param {string} [params.mode]   — "assisted" skips auto-commit
 * @param {{ emit: Function }} [params.eventBus]
 * @param {string|null} [params.startSha]
 * @param {Map<string, string>|null} [params.preSliceState] — porcelain snapshot from {@link snapshotPreSliceState}
 * @returns {{ committed: boolean, reason?: string, sha?: string, message?: string, error?: string, foreignFiles?: string[] }}
 */
function _handleCleanTreeMaybeWorkerCommit({ slice, cwd, startSha, eventBus }) {
  if (!startSha) return { committed: false, reason: "clean-tree" };
  try {
    const currentSha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
    if (!currentSha || currentSha === startSha) return { committed: false, reason: "clean-tree" };
    const absorbedCommits = captureAbsorbedCommits({ cwd, fromSha: startSha, toSha: currentSha });
    let codeChanges = null;
    try {
      const shortstat = execSync(`git show --shortstat --format= ${currentSha}`, { cwd, encoding: "utf-8", timeout: 5_000 });
      codeChanges = parseShortstat(shortstat);
    } catch { /* ignore */ }
    const evt = { sliceNumber: slice.number, sha: currentSha, message: "(worker-committed)", source: "worker" };
    if (absorbedCommits.length > 0) evt.absorbedCommits = absorbedCommits;
    if (codeChanges) evt.codeChanges = codeChanges;
    eventBus?.emit("slice-auto-committed", evt);
    const out = { committed: true, sha: currentSha, message: "(worker-committed)", source: "worker", raceDetected: absorbedCommits.length > 1 };
    if (absorbedCommits.length > 0) out.absorbedCommits = absorbedCommits;
    if (codeChanges) out.codeChanges = codeChanges;
    return out;
  } catch {
    return { committed: false, reason: "clean-tree" };
  }
}

function _partitionDirtyPaths(currentState, preSliceState) {
  const workerPaths = [];
  const foreignFiles = [];
  for (const [path, line] of currentState) {
    const priorLine = preSliceState.get(path);
    if (priorLine === undefined || priorLine !== line) workerPaths.push(path);
    else foreignFiles.push(path);
  }
  return { workerPaths, foreignFiles };
}

function _buildCommitMessage(slice, workerPaths, raceDetected, absorbedCommits) {
  const allHousekeeping = workerPaths && workerPaths.length > 0
    && workerPaths.every((p) => p.replace(/\\/g, "/").startsWith(".forge/"));
  const conventionalType = /^(bug\s*#?\d+|fix)/i.test(slice.title) ? "fix" : "feat";
  const subject = slice.title.replace(/^bug\s*#?\d+[:\s]*/i, "").slice(0, 72).trim() || slice.title.slice(0, 72);
  let commitMessage = `${conventionalType}(slice-${slice.number}): ${subject}`;
  if (allHousekeeping && raceDetected) {
    const absorbedRef = absorbedCommits.map((c) => c.sha.slice(0, 7)).join(", ");
    commitMessage = `chore(slice-${slice.number}): housekeeping (source absorbed by ${absorbedRef})`;
  }
  return { commitMessage, allHousekeeping };
}

function _stageWorkerOrAll(workerPaths, cwd) {
  if (workerPaths) {
    const CHUNK = 50;
    for (let i = 0; i < workerPaths.length; i += CHUNK) {
      const batch = workerPaths.slice(i, i + CHUNK);
      // Use execFileSync with an args array (shell:false) so paths with
      // spaces, quotes, $(...), or backticks are passed verbatim instead
      // of being re-parsed by the shell. The `--` separator stops git
      // from interpreting any path that starts with `-` as a flag.
      execFileSync("git", ["add", "--", ...batch], { cwd, encoding: "utf-8", timeout: 10_000, windowsHide: true });
    }
  } else {
    execSync("git add -A", { cwd, encoding: "utf-8", timeout: 10_000 });
  }
}

function _captureCommitStats(sha, cwd) {
  try {
    const shortstat = execSync(`git show --shortstat --format= ${sha}`, { cwd, encoding: "utf-8", timeout: 5_000 });
    return parseShortstat(shortstat);
  } catch { return null; }
}

function _buildGitFailureResult(slice, eventBus, err) {
  eventBus?.emit("slice-dirty-tree-warning", { sliceNumber: slice?.number, error: err.message });
  return { committed: false, reason: "git-failed", error: err.message };
}

function _readSliceDirtyStatus(slice, cwd, eventBus) {
  try {
    return { statusOut: execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 }) };
  } catch (err) {
    return { result: _buildGitFailureResult(slice, eventBus, err) };
  }
}

function _resolveWorkerPathsForCommit({ statusOut, preSliceState, slice, eventBus }) {
  if (!statusOut || !statusOut.trim()) {
    return { cleanTree: true };
  }
  if (!preSliceState) {
    return { cleanTree: false, workerPaths: null, foreignFiles: [] };
  }
  const currentState = parseGitPorcelain(statusOut);
  const { workerPaths, foreignFiles } = _partitionDirtyPaths(currentState, preSliceState);
  if (foreignFiles.length > 0) {
    eventBus?.emit("slice-foreign-files-detected", { sliceNumber: slice?.number, foreignFiles });
  }
  if (workerPaths.length === 0) {
    return { result: { committed: false, reason: "no-worker-changes", foreignFiles } };
  }
  return { cleanTree: false, workerPaths, foreignFiles };
}

function _buildAutoCommitSuccess({
  slice,
  eventBus,
  sha,
  commitMessage,
  foreignFiles,
  codeChanges,
  absorbedCommits,
  raceDetected,
  allHousekeeping,
}) {
  const evt = { sliceNumber: slice.number, sha, message: commitMessage };
  if (foreignFiles.length > 0) evt.foreignFiles = foreignFiles;
  if (codeChanges) evt.codeChanges = codeChanges;
  if (absorbedCommits.length > 0) evt.absorbedCommits = absorbedCommits;
  if (raceDetected) evt.raceDetected = true;
  eventBus?.emit("slice-auto-committed", evt);

  const out = { committed: true, sha, message: commitMessage };
  if (foreignFiles.length > 0) out.foreignFiles = foreignFiles;
  if (codeChanges) out.codeChanges = codeChanges;
  if (absorbedCommits.length > 0) out.absorbedCommits = absorbedCommits;
  if (raceDetected) out.raceDetected = true;
  if (allHousekeeping) out.housekeepingOnly = true;
  return out;
}

export function autoCommitSliceIfDirty({
  slice,
  cwd = process.cwd(),
  mode,
  eventBus,
  startSha = null,
  preSliceState = null,
} = {}) {
  if (mode === "assisted") {
    return { committed: false, reason: "assisted-mode" };
  }

  const statusResult = _readSliceDirtyStatus(slice, cwd, eventBus);
  if (statusResult.result) {
    return statusResult.result;
  }

  const dirtyState = _resolveWorkerPathsForCommit({
    statusOut: statusResult.statusOut,
    preSliceState,
    slice,
    eventBus,
  });
  if (dirtyState.cleanTree) {
    return _handleCleanTreeMaybeWorkerCommit({ slice, cwd, startSha, eventBus });
  }
  if (dirtyState.result) {
    return dirtyState.result;
  }

  const { workerPaths, foreignFiles } = dirtyState;
  const absorbedCommits = startSha
    ? captureAbsorbedCommits({ cwd, fromSha: startSha, toSha: "HEAD" })
    : [];
  const raceDetected = absorbedCommits.length > 0;
  const { commitMessage, allHousekeeping } = _buildCommitMessage(slice, workerPaths, raceDetected, absorbedCommits);

  try {
    _stageWorkerOrAll(workerPaths, cwd);
    execFileSync("git", ["commit", "-m", commitMessage], { cwd, encoding: "utf-8", timeout: 15_000, windowsHide: true });
    const sha = execSync("git rev-parse HEAD", { cwd, encoding: "utf-8", timeout: 5_000 }).trim();
    const codeChanges = _captureCommitStats(sha, cwd);
    return _buildAutoCommitSuccess({
      slice,
      eventBus,
      sha,
      commitMessage,
      foreignFiles,
      codeChanges,
      absorbedCommits,
      raceDetected,
      allHousekeeping,
    });
  } catch (err) {
    return _buildGitFailureResult(slice, eventBus, err);
  }
}

/**
 * Issue #132 \u2014 after a slice fails, capture any uncommitted worker
 * deliverables so they aren't silently orphaned. Stages files with
 * `git add -A` (no commit), writes `.forge/runs/<runId>/orphans-slice-<N>.json`
 * with the file list and recovery hints, and emits a `slice-orphan-warning`
 * event. Failing-gate is the most common case: a buggy gate script (typo,
 * relative path, regex escape issue) marks the slice failed even though
 * the deliverables on disk are correct. Without staging + warning, the
 * next resume saw a clean tree and either re-ran the slice (wasting tokens)
 * or skipped it entirely.
 *
 * Never throws \u2014 best-effort. Returns a summary or null when nothing was
 * to capture.
 *
 * @param {object} params
 * @param {{ number: number, title: string }} params.slice
 * @param {string} params.cwd
 * @param {string} [params.runDir] - .forge/runs/<runId> for orphans-slice-N.json
 * @param {string} [params.mode] - "assisted" skips staging
 * @param {{ emit: Function }} [params.eventBus]
 * @returns {{ staged: boolean, files: string[], orphansPath?: string, reason?: string, error?: string }|null}
 */
export function stageOrphansOnSliceFailure({ slice, cwd = process.cwd(), runDir = null, mode, eventBus } = {}) {
  if (mode === "assisted") {
    return { staged: false, files: [], reason: "assisted-mode" };
  }

  let statusOut;
  try {
    statusOut = execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5_000 });
  } catch (err) {
    return { staged: false, files: [], reason: "git-failed", error: err.message };
  }

  if (!statusOut || !statusOut.trim()) {
    return null; // nothing on disk to orphan
  }

  // Parse `git status --porcelain` into a flat file list. Each line is
  // "XY path" (or "XY orig -> new" for renames). We capture the rightmost
  // path so renamed files are tracked at their new location.
  const files = statusOut
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const arrowIdx = l.indexOf(" -> ");
      const tail = arrowIdx >= 0 ? l.slice(arrowIdx + 4) : l.slice(3);
      return tail.trim().replace(/^"|"$/g, "");
    })
    .filter(Boolean);

  // Stage everything so files become visible in `git status` (and can be
  // committed by the operator after triage). We never commit on failure
  // \u2014 the gate said no, the human must verify.
  let staged = false;
  let stageError = null;
  try {
    execSync("git add -A", { cwd, encoding: "utf-8", timeout: 10_000 });
    staged = true;
  } catch (err) {
    stageError = err.message;
  }

  // Drop a structured orphans-slice-N.json artifact next to the run log.
  let orphansPath = null;
  if (runDir) {
    try {
      mkdirSync(runDir, { recursive: true });
      orphansPath = resolve(runDir, `orphans-slice-${slice.number}.json`);
      const payload = {
        sliceNumber: slice.number,
        sliceTitle: slice.title,
        capturedAt: new Date().toISOString(),
        staged,
        stageError,
        files,
        recovery: [
          `git status --short  # review staged files`,
          `git diff --cached   # see what the worker wrote`,
          `git commit -m "feat(slice-${slice.number}): <subject>"   # if deliverables are correct`,
          `git restore --staged . && git restore .                  # if deliverables are wrong`,
        ],
      };
      writeFileSync(orphansPath, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      orphansPath = null;
    }
  }

  if (eventBus && typeof eventBus.emit === "function") {
    try {
      eventBus.emit("slice-orphan-warning", {
        sliceNumber: slice.number,
        sliceTitle: slice.title,
        fileCount: files.length,
        files: files.slice(0, 20), // cap event payload
        staged,
        stageError,
        orphansPath: orphansPath ? relative(cwd, orphansPath) : null,
      });
    } catch { /* best-effort */ }
  }

  return { staged, files, orphansPath: orphansPath || undefined, ...(stageError ? { error: stageError } : {}) };
}
