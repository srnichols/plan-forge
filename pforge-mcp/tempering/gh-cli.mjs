/**
 * Plan Forge — Tempering: `gh` CLI invocation helper.
 *
 * Issue titles and bodies are agent-supplied markdown: multi-line, quoted, and
 * occasionally containing shell metacharacters. Assembling a `gh issue create`
 * shell string forced callers to escape newlines as the literal two-character
 * sequence `\n`, which `gh` then wrote verbatim into the issue body, and left
 * `$(...)`, backticks, and `$VAR` live on POSIX shells.
 *
 * Passing an argv array removes the shell from the path: no escaping needed,
 * and no command injection.
 *
 * @module tempering/gh-cli
 */

const GH_TIMEOUT_MS = 30_000;

/**
 * Build the argv for `gh issue create`.
 *
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string[]} [opts.labels]
 * @returns {string[]}
 */
export function buildCreateIssueArgs({ owner, repo, title, body, labels = [] }) {
  const args = ["issue", "create", "--repo", `${owner}/${repo}`, "--title", title, "--body", body];
  for (const label of labels) {
    args.push("--label", label);
  }
  return args;
}

/**
 * Create a GitHub issue via `gh issue create` without a shell.
 *
 * Returns null on any failure so callers fall back to the REST API.
 *
 * @param {object} opts
 * @param {string} opts.owner
 * @param {string} opts.repo
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string[]} [opts.labels]
 * @param {Function} [opts.execFile] - execFileSync-compatible runner; omitted disables the CLI path
 * @param {string} [opts.cwd]
 * @returns {{ issueNumber: number, url: string } | null}
 */
export function createIssueViaGhCli({ owner, repo, title, body, labels = [], execFile, cwd }) {
  if (typeof execFile !== "function") return null;
  try {
    const output = execFile("gh", buildCreateIssueArgs({ owner, repo, title, body, labels }), {
      encoding: "utf-8",
      timeout: GH_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
    }).trim();

    const match = output.match(/\/issues\/(\d+)/);
    return match ? { issueNumber: parseInt(match[1], 10), url: output } : null;
  } catch {
    return null;
  }
}
