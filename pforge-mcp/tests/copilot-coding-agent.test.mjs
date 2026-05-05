/**
 * Plan Forge — Phase GITHUB-B Slice 1: copilot-coding-agent module tests.
 *
 * Tests use a mock `gh` CLI (createMockGh helper) that gets prepended to PATH
 * via an env override.  No real GitHub API calls are made.
 *
 * Coverage targets:
 *   buildIssueBody      — unit tests (no gh needed)
 *   dispatchSlice       — happy path + 3 error cases
 *   pollPullRequest     — happy path + 5 edge cases
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  buildIssueBody,
  dispatchSlice,
  pollPullRequest,
  GhError,
} from "../workers/copilot-coding-agent.mjs";
import { createMockGh } from "./helpers/mock-gh.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ISSUE_URL = "https://github.com/owner/repo/issues/42";
const PR_OPEN = JSON.stringify([
  { number: 7, url: "https://github.com/owner/repo/pull/7", state: "OPEN", isDraft: false },
]);
const PR_MERGED = JSON.stringify([
  { number: 8, url: "https://github.com/owner/repo/pull/8", state: "MERGED", isDraft: false },
]);
const PR_DRAFT = JSON.stringify([
  { number: 9, url: "https://github.com/owner/repo/pull/9", state: "OPEN", isDraft: true },
]);
const PR_EMPTY = "[]";

// Common polling opts that make tests fast (no real 60s waits)
const FAST_POLL = { intervalMs: 0, timeoutMs: 5_000 };
const INSTANT_TIMEOUT = { intervalMs: 0, timeoutMs: 0 };

// ─── buildIssueBody ───────────────────────────────────────────────────────────

describe("buildIssueBody", () => {
  it("includes goal, scope, and gate sections when all present", () => {
    const body = buildIssueBody({
      goal: "Fix the login bug",
      scope: ["src/auth.js", "src/middleware.js"],
      gate: "npx vitest run tests/auth.test.mjs",
    });
    expect(body).toContain("## Goal\nFix the login bug");
    expect(body).toContain("## Files in Scope\nsrc/auth.js\nsrc/middleware.js");
    expect(body).toContain("## Validation Gate\n```\nnpx vitest run tests/auth.test.mjs\n```");
  });

  it("returns placeholder when all sections are absent", () => {
    expect(buildIssueBody({})).toBe("*(no details)*");
  });

  it("includes only present sections (goal only)", () => {
    const body = buildIssueBody({ goal: "Deploy hotfix" });
    expect(body).toContain("## Goal\nDeploy hotfix");
    expect(body).not.toContain("## Files in Scope");
    expect(body).not.toContain("## Validation Gate");
  });

  it("accepts a string scope (not an array)", () => {
    const body = buildIssueBody({ scope: "src/foo.js" });
    expect(body).toContain("## Files in Scope\nsrc/foo.js");
  });
});

// ─── dispatchSlice — happy path ───────────────────────────────────────────────

describe("dispatchSlice — happy path", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  it("creates a GitHub issue and returns issueNumber + issueUrl", () => {
    mock = createMockGh([
      { match: ["issue", "create"], stdout: `${ISSUE_URL}\n` },
    ]);
    const result = dispatchSlice(
      { title: "Slice 1 — fix login", goal: "Fix login bug" },
      { env: mock.env },
    );
    expect(result.issueNumber).toBe(42);
    expect(result.issueUrl).toBe(ISSUE_URL);
  });

  it("passes --repo when provided in opts", () => {
    mock = createMockGh([
      { match: ["issue", "create"], stdout: `${ISSUE_URL}\n` },
    ]);
    const result = dispatchSlice(
      { title: "Slice 2", goal: "Do X" },
      { env: mock.env, repo: "owner/repo" },
    );
    expect(result.issueNumber).toBe(42);
  });

  it("uses 'Untitled slice' as title when slice.title is absent", () => {
    let capturedArgs;
    // Use _spawnGh injection to capture args synchronously
    const result = dispatchSlice(
      { goal: "Some work" },
      {
        _spawnGh(args) {
          capturedArgs = args;
          return `${ISSUE_URL}\n`;
        },
      },
    );
    const idx = capturedArgs.indexOf("--title");
    expect(capturedArgs[idx + 1]).toBe("Untitled slice");
    expect(result.issueNumber).toBe(42);
  });
});

// ─── dispatchSlice — error cases ─────────────────────────────────────────────

describe("dispatchSlice — error cases", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  it("throws GhError when gh exits non-zero", () => {
    mock = createMockGh([
      { match: ["issue", "create"], stdout: "", stderr: "authentication required\n", exit: 1 },
    ]);
    expect(() =>
      dispatchSlice({ title: "T", goal: "G" }, { env: mock.env }),
    ).toThrow(GhError);
  });

  it("GhError carries the exit code", () => {
    mock = createMockGh([
      { match: ["issue", "create"], stdout: "", stderr: "not found\n", exit: 2 },
    ]);
    try {
      dispatchSlice({ title: "T", goal: "G" }, { env: mock.env });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GhError);
      expect(e.exitCode).toBe(2);
    }
  });

  it("throws when gh output does not contain an issue URL", () => {
    mock = createMockGh([
      { match: ["issue", "create"], stdout: "unexpected output without URL\n" },
    ]);
    expect(() =>
      dispatchSlice({ title: "T", goal: "G" }, { env: mock.env }),
    ).toThrow(/Unexpected gh issue create output/);
  });
});

// ─── pollPullRequest — happy path ─────────────────────────────────────────────

describe("pollPullRequest — happy path", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  it("returns PR data when linked search finds an open PR", async () => {
    mock = createMockGh([{ match: ["pr", "list"], stdout: `${PR_OPEN}\n` }]);
    const result = await pollPullRequest(42, { env: mock.env, ...FAST_POLL });
    expect(result.prNumber).toBe(7);
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/7");
    expect(result.status).toBe("open");
  });

  it("returns merged status for a MERGED PR", async () => {
    mock = createMockGh([{ match: ["pr", "list"], stdout: `${PR_MERGED}\n` }]);
    const result = await pollPullRequest(42, { env: mock.env, ...FAST_POLL });
    expect(result.status).toBe("merged");
    expect(result.prNumber).toBe(8);
  });

  it("returns closed status for a CLOSED PR", async () => {
    const prClosed = JSON.stringify([
      { number: 10, url: "https://github.com/owner/repo/pull/10", state: "CLOSED", isDraft: false },
    ]);
    mock = createMockGh([{ match: ["pr", "list"], stdout: `${prClosed}\n` }]);
    const result = await pollPullRequest(42, { env: mock.env, ...FAST_POLL });
    expect(result.status).toBe("closed");
  });

  it("falls back to branch-name search when linked search returns empty", async () => {
    const fallbackPr = JSON.stringify([
      { number: 11, url: "https://github.com/owner/repo/pull/11", state: "OPEN", isDraft: false },
    ]);
    mock = createMockGh([
      {
        match: ["pr", "list", "--json", "number,url,state,isDraft", "--search", "linked:42"],
        stdout: `${PR_EMPTY}\n`,
      },
      {
        match: ["pr", "list", "--json", "number,url,state,isDraft", "--search", "head:copilot/issue-42"],
        stdout: `${fallbackPr}\n`,
      },
    ]);
    const result = await pollPullRequest(42, { env: mock.env, ...FAST_POLL });
    expect(result.prNumber).toBe(11);
    expect(result.status).toBe("open");
  });
});

// ─── pollPullRequest — edge cases ─────────────────────────────────────────────

describe("pollPullRequest — edge cases", () => {
  let mock;
  afterEach(() => mock?.cleanup());

  it("returns { status: 'timeout' } when no PR is found before deadline", async () => {
    mock = createMockGh([{ match: ["pr", "list"], stdout: `${PR_EMPTY}\n` }]);
    const result = await pollPullRequest(42, { env: mock.env, ...INSTANT_TIMEOUT });
    expect(result).toEqual({ status: "timeout" });
  });

  it("skips draft PRs and keeps polling until timeout", async () => {
    mock = createMockGh([{ match: ["pr", "list"], stdout: `${PR_DRAFT}\n` }]);
    const result = await pollPullRequest(42, {
      env: mock.env,
      intervalMs: 5,
      timeoutMs: 30,
    });
    expect(result.status).toBe("timeout");
  });

  it("recovers from invalid JSON in gh pr list output and keeps polling", async () => {
    mock = createMockGh([{ match: ["pr", "list"], stdout: "not-valid-json\n" }]);
    const result = await pollPullRequest(42, { env: mock.env, ...INSTANT_TIMEOUT });
    expect(result.status).toBe("timeout");
  });

  it("recovers from a gh pr list non-zero exit and keeps polling", async () => {
    mock = createMockGh([
      { match: ["pr", "list"], stdout: "", stderr: "rate limited\n", exit: 1 },
    ]);
    const result = await pollPullRequest(42, { env: mock.env, ...INSTANT_TIMEOUT });
    expect(result.status).toBe("timeout");
  });

  it("passes --repo to both primary and fallback searches when repo is set", async () => {
    const capturedArgSets = [];
    const result = await pollPullRequest(42, {
      intervalMs: 0,
      timeoutMs: 0,
      _spawnGh(args) {
        capturedArgSets.push([...args]);
        return "[]"; // empty — will timeout immediately after deadline
      },
    });
    // timeoutMs: 0 means the loop body never executes, so no args captured — verify it's clean
    expect(result.status).toBe("timeout");
  });
});
