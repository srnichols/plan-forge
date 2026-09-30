import { execFileSync } from "node:child_process";

const BYTES_PER_MIB = 1_048_576;
const GIT_DIFF_MAX_BUFFER_MIB = 64;

/**
 * Upper bound on the `git diff` output a tool buffers in memory.
 *
 * Node's execFileSync/execSync default (1 MiB) failed ordinary release diffs
 * with `spawnSync git ENOBUFS` (meta-bugs #288, #289, #290), and the staged-diff
 * classifier swallowed the same error as an empty, clean diff (#291). 64 MiB
 * covers the largest reported diff (~1.2 MB) by a wide margin while still
 * bounding memory for a pathological range.
 */
export const GIT_DIFF_MAX_BUFFER_BYTES = GIT_DIFF_MAX_BUFFER_MIB * BYTES_PER_MIB;

export const GIT_DIFF_TIMEOUT_MS = 30_000;

export class GitDiffCapacityError extends Error {
  /**
   * @param {string[]} gitArgs
   * @param {number} maxBufferBytes
   */
  constructor(gitArgs, maxBufferBytes) {
    super(
      `git ${gitArgs.join(" ")} produced more than ${Math.round(maxBufferBytes / BYTES_PER_MIB)} MiB of output — ` +
      "the diff was not scanned. Narrow the range (for example a single commit or a path subset) and retry.",
    );
    this.name = "GitDiffCapacityError";
    this.code = "GIT_DIFF_TOO_LARGE";
    this.gitArgs = gitArgs;
    this.maxBufferBytes = maxBufferBytes;
  }
}

/**
 * Run `git <gitArgs>` and return its stdout, failing loudly instead of
 * truncating: an oversized diff raises GitDiffCapacityError, and every other
 * git failure propagates unchanged so callers can never mistake it for an
 * empty diff.
 *
 * @param {{ cwd: string, gitArgs: string[], maxBufferBytes?: number, timeoutMs?: number }} options
 * @returns {string}
 */
export function readGitDiff({ cwd, gitArgs, maxBufferBytes = GIT_DIFF_MAX_BUFFER_BYTES, timeoutMs = GIT_DIFF_TIMEOUT_MS }) {
  try {
    return execFileSync("git", gitArgs, {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: maxBufferBytes,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (err && err.code === "ENOBUFS") throw new GitDiffCapacityError(gitArgs, maxBufferBytes);
    throw err;
  }
}
