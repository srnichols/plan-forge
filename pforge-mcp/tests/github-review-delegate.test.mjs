import { describe, it, expect, vi } from "vitest";
import {
  findPrForBranch,
  buildReviewIssueBody,
  delegateReview,
  ReviewDelegateError,
  ReviewDelegateNoPrError,
  ReviewDelegateAuthError,
} from "../github-review-delegate.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrJson(overrides = {}) {
  return JSON.stringify({
    number: 42,
    url: "https://github.com/test/repo/pull/42",
    headRefName: "feat/my-feature",
    state: "OPEN",
    ...overrides,
  });
}

function makeSpawn(stdout, status = 0, error = null) {
  return vi.fn(() => ({ stdout, stderr: "", status, error }));
}

// ─── findPrForBranch ──────────────────────────────────────────────────────────

describe("findPrForBranch", () => {
  it("returns PR descriptor for an open PR", () => {
    const spawn = makeSpawn(makePrJson());
    const pr = findPrForBranch({ _spawnGh: spawn });
    expect(pr).toMatchObject({ number: 42, state: "OPEN" });
    expect(spawn).toHaveBeenCalledWith(
      ["pr", "view", "--json", "number,url,headRefName,state"],
      expect.anything()
    );
  });

  it("returns null when exit code is non-zero (no PR)", () => {
    const spawn = makeSpawn("", 1);
    expect(findPrForBranch({ _spawnGh: spawn })).toBeNull();
  });

  it("returns null for a CLOSED PR", () => {
    const spawn = makeSpawn(makePrJson({ state: "CLOSED" }));
    expect(findPrForBranch({ _spawnGh: spawn })).toBeNull();
  });

  it("returns null for a MERGED PR", () => {
    const spawn = makeSpawn(makePrJson({ state: "MERGED" }));
    expect(findPrForBranch({ _spawnGh: spawn })).toBeNull();
  });

  it("throws ReviewDelegateError when gh itself fails to launch", () => {
    const spawn = makeSpawn("", 0, new Error("ENOENT"));
    expect(() => findPrForBranch({ _spawnGh: spawn })).toThrowError(ReviewDelegateError);
  });

  it("returns null on invalid JSON from gh", () => {
    const spawn = makeSpawn("not-json");
    expect(findPrForBranch({ _spawnGh: spawn })).toBeNull();
  });
});

// ─── buildReviewIssueBody ─────────────────────────────────────────────────────

describe("buildReviewIssueBody", () => {
  it("contains the PR URL", () => {
    const body = buildReviewIssueBody({ prUrl: "https://github.com/test/repo/pull/42", headRefName: "feat/branch" });
    expect(body).toContain("https://github.com/test/repo/pull/42");
  });

  it("contains default criteria when none provided", () => {
    const body = buildReviewIssueBody({ prUrl: "https://x", headRefName: "main" });
    expect(body).toContain("security vulnerabilities");
    expect(body).toContain("error handling");
    expect(body).toContain("tests cover");
  });

  it("uses custom criteria when provided", () => {
    const body = buildReviewIssueBody({
      prUrl: "https://x",
      headRefName: "feat/x",
      criteria: ["Check foo", "Verify bar"],
    });
    expect(body).toContain("Check foo");
    expect(body).toContain("Verify bar");
    expect(body).not.toContain("security vulnerabilities");
  });

  it("includes a Plan Forge attribution footer", () => {
    const body = buildReviewIssueBody({ prUrl: "https://x", headRefName: "main" });
    expect(body).toContain("Plan Forge D6");
  });
});

// ─── delegateReview ───────────────────────────────────────────────────────────

describe("delegateReview", () => {
  it("creates an issue and returns reviewUrl on success", () => {
    const prSpawn = makeSpawn(makePrJson());
    const issueUrl = "https://github.com/test/repo/issues/99";
    const issueSpawn = makeSpawn(issueUrl + "\n");
    let callCount = 0;
    const spawn = vi.fn((args, opts) => {
      callCount++;
      return callCount === 1 ? prSpawn(args, opts) : issueSpawn(args, opts);
    });

    const result = delegateReview({ _spawnGh: spawn });
    expect(result.ok).toBe(true);
    expect(result.delegationType).toBe("issue");
    expect(result.reviewUrl).toBe(issueUrl);
    expect(result.message).toContain(issueUrl);
  });

  it("passes PR URL and headRefName in the issue", () => {
    const prSpawn = makeSpawn(makePrJson());
    const issueSpawn = makeSpawn("https://github.com/test/repo/issues/99\n");
    let callCount = 0;
    const spawn = vi.fn((args, opts) => {
      callCount++;
      return callCount === 1 ? prSpawn(args, opts) : issueSpawn(args, opts);
    });

    delegateReview({ _spawnGh: spawn });
    const issueCreateArgs = spawn.mock.calls[1][0];
    const bodyIndex = issueCreateArgs.indexOf("--body");
    const body = issueCreateArgs[bodyIndex + 1];
    expect(body).toContain("https://github.com/test/repo/pull/42");
    expect(body).toContain("feat/my-feature");
  });

  it("assigns the issue to @copilot", () => {
    const prSpawn = makeSpawn(makePrJson());
    const issueSpawn = makeSpawn("https://github.com/test/repo/issues/99\n");
    let callCount = 0;
    const spawn = vi.fn((args, opts) => {
      callCount++;
      return callCount === 1 ? prSpawn(args, opts) : issueSpawn(args, opts);
    });

    delegateReview({ _spawnGh: spawn });
    const issueArgs = spawn.mock.calls[1][0];
    expect(issueArgs).toContain("@copilot");
    expect(issueArgs).toContain("--assignee");
  });

  it("throws ReviewDelegateNoPrError when no open PR", () => {
    const spawn = makeSpawn("", 1);
    expect(() => delegateReview({ _spawnGh: spawn })).toThrowError(ReviewDelegateNoPrError);
  });

  it("throws ReviewDelegateAuthError on 403 from gh issue create", () => {
    const prSpawn = makeSpawn(makePrJson());
    const issueSpawn = vi.fn(() => ({ stdout: "", stderr: "HTTP 403: forbidden", status: 1, error: null }));
    let callCount = 0;
    const spawn = vi.fn((args, opts) => {
      callCount++;
      return callCount === 1 ? prSpawn(args, opts) : issueSpawn(args, opts);
    });

    expect(() => delegateReview({ _spawnGh: spawn })).toThrowError(ReviewDelegateAuthError);
  });

  it("throws ReviewDelegateError on general gh issue create failure", () => {
    const prSpawn = makeSpawn(makePrJson());
    const issueSpawn = vi.fn(() => ({ stdout: "", stderr: "network error", status: 1, error: null }));
    let callCount = 0;
    const spawn = vi.fn((args, opts) => {
      callCount++;
      return callCount === 1 ? prSpawn(args, opts) : issueSpawn(args, opts);
    });

    expect(() => delegateReview({ _spawnGh: spawn })).toThrowError(ReviewDelegateError);
  });

  it("accepts custom criteria and passes them into the issue body", () => {
    const prSpawn = makeSpawn(makePrJson());
    const issueSpawn = makeSpawn("https://github.com/test/repo/issues/99\n");
    let callCount = 0;
    const spawn = vi.fn((args, opts) => {
      callCount++;
      return callCount === 1 ? prSpawn(args, opts) : issueSpawn(args, opts);
    });

    delegateReview({ criteria: ["Custom check"], _spawnGh: spawn });
    const issueArgs = spawn.mock.calls[1][0];
    const bodyIndex = issueArgs.indexOf("--body");
    const body = issueArgs[bodyIndex + 1];
    expect(body).toContain("Custom check");
  });
});
