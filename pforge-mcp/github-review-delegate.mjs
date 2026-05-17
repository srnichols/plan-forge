/**
 * Plan Forge — D6: Agentic Code Review Delegation.
 *
 * Delegates code review to the Copilot Coding Agent by finding the current
 * branch's open PR and creating a structured GitHub issue assigned to @copilot.
 * The agent reviews the diff against standard criteria and posts its findings.
 *
 * Exports:
 *   findPrForBranch(opts)      → PR descriptor | null
 *   buildReviewIssueBody(opts) → Markdown string
 *   delegateReview(opts)       → { ok, delegationType, reviewUrl, message }
 *   ReviewDelegateError
 *   ReviewDelegateNoPrError
 *   ReviewDelegateAuthError
 *
 * @module github-review-delegate
 */

import { spawnSync } from "node:child_process";

// ─── Error classes ────────────────────────────────────────────────────────────

export class ReviewDelegateError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewDelegateError";
  }
}

export class ReviewDelegateNoPrError extends ReviewDelegateError {
  constructor(message) {
    super(message);
    this.name = "ReviewDelegateNoPrError";
  }
}

export class ReviewDelegateAuthError extends ReviewDelegateError {
  constructor(message) {
    super(message);
    this.name = "ReviewDelegateAuthError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function spawnGhRaw(args, { cwd = process.cwd(), env = process.env } = {}) {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "cmd" : "gh";
  const cmdArgs = isWindows ? ["/d", "/s", "/c", "gh", ...args] : args;
  return spawnSync(cmd, cmdArgs, { cwd, env, encoding: "utf8", windowsHide: isWindows });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the open PR for the current branch via `gh pr view`.
 *
 * @param {Object} [opts]
 * @param {string} [opts.cwd]
 * @param {Object} [opts.env]
 * @param {Function} [opts._spawnGh] - Injected in tests
 * @returns {{ number: number, url: string, headRefName: string, state: string } | null}
 */
export function findPrForBranch({ cwd = process.cwd(), env, _spawnGh } = {}) {
  const spawn = _spawnGh ?? ((args, opts) => spawnGhRaw(args, opts));
  const result = spawn(
    ["pr", "view", "--json", "number,url,headRefName,state"],
    { cwd, env }
  );

  if (result.error) throw new ReviewDelegateError(`Failed to run gh: ${result.error.message}`);
  if (result.status !== 0) return null;

  try {
    const pr = JSON.parse(result.stdout || "{}");
    if (!pr.number) return null;
    if (pr.state === "CLOSED" || pr.state === "MERGED") return null;
    return pr;
  } catch {
    return null;
  }
}

/**
 * Build the body of the review delegation issue.
 *
 * @param {Object} opts
 * @param {string} opts.prUrl - URL of the PR to review
 * @param {string[]} [opts.criteria] - Custom review criteria (defaults to standard plan-forge set)
 * @returns {string} Markdown issue body
 */
export function buildReviewIssueBody({ prUrl, headRefName, criteria = [] }) {
  const defaultCriteria = [
    "Check for security vulnerabilities (SQL injection, XSS, auth bypass, exposed secrets)",
    "Verify error handling is comprehensive — no empty catch blocks, errors are logged",
    "Confirm tests cover the changed behavior and no coverage gaps are introduced",
    "Review for architectural violations — business logic only in services, no SQL in controllers",
    "Check that all new public functions have JSDoc / type annotations",
  ];
  const reviewCriteria = criteria.length > 0 ? criteria : defaultCriteria;
  const criteriaList = reviewCriteria.map((c) => `- [ ] ${c}`).join("\n");

  return [
    `## Code Review Request`,
    ``,
    `**Branch**: \`${headRefName ?? "unknown"}\``,
    `**PR**: ${prUrl}`,
    ``,
    `## Review Criteria`,
    ``,
    criteriaList,
    ``,
    `## Instructions`,
    ``,
    `1. Review the diff at the PR linked above`,
    `2. For each criterion, leave an inline comment on the relevant line if there is an issue`,
    `3. Post a summary comment on the PR with your overall assessment`,
    `4. If all criteria pass, approve the PR; otherwise request changes with specific fix suggestions`,
    ``,
    `> This review was delegated by Plan Forge D6 (\`pforge github review delegate\`).`,
  ].join("\n");
}

/**
 * Delegate code review for the current branch's PR to the Copilot Coding Agent.
 *
 * Creates a GitHub issue assigned to @copilot with a structured review request.
 * The Copilot Coding Agent reviews the PR diff and posts its findings.
 *
 * @param {Object} [opts]
 * @param {string[]} [opts.criteria] - Custom review criteria
 * @param {string} [opts.cwd]
 * @param {Object} [opts.env]
 * @param {Function} [opts._spawnGh] - Injected in tests
 * @returns {{ ok: true, delegationType: "issue", reviewUrl: string, message: string }}
 * @throws {ReviewDelegateNoPrError} when no open PR is found
 * @throws {ReviewDelegateAuthError} when gh permission denied
 * @throws {ReviewDelegateError} on other gh failures
 */
export function delegateReview({ criteria, cwd = process.cwd(), env, _spawnGh } = {}) {
  const spawn = _spawnGh ?? ((args, opts) => spawnGhRaw(args, opts));

  const pr = findPrForBranch({ cwd, env, _spawnGh });
  if (!pr) {
    throw new ReviewDelegateNoPrError(
      "No open PR found for the current branch. Create a PR first with: gh pr create"
    );
  }

  const issueBody = buildReviewIssueBody({ prUrl: pr.url, headRefName: pr.headRefName, criteria });
  const issueTitle = `Code Review: ${pr.headRefName} (PR #${pr.number})`;

  const result = spawn(
    ["issue", "create", "--title", issueTitle, "--body", issueBody, "--assignee", "@copilot"],
    { cwd, env }
  );

  if (result.error) {
    throw new ReviewDelegateError(`Failed to run gh: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    if (/403|forbidden/i.test(stderr)) {
      throw new ReviewDelegateAuthError(
        `Permission denied. Ensure gh is authenticated and has issues write access: gh auth login`
      );
    }
    throw new ReviewDelegateError(
      `gh issue create failed (exit ${result.status}): ${stderr || "unknown error"}`
    );
  }

  const issueUrl = result.stdout.trim();

  return {
    ok: true,
    delegationType: "issue",
    reviewUrl: issueUrl,
    message: `Review delegated to Copilot Coding Agent. Issue: ${issueUrl}`,
  };
}
