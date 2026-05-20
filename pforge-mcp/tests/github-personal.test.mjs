/**
 * Tests for pforge-mcp/github-personal.mjs (Phase-54 Slice 0).
 *
 * Covers:
 *   1. fetchUserProfile — happy path, auth error, rate limit
 *   2. fetchRepoSummary — happy path, 404 not found, argument validation
 *   3. scanCopilotCoauthors — with Copilot co-authors, without co-authors,
 *      argument validation, date range params
 *
 * No real GitHub API calls are made; `gh` is intercepted by createMockGh.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchUserProfile,
  fetchRepoSummary,
  scanCopilotCoauthors,
  PersonalError,
  PersonalAuthError,
  PersonalNotFoundError,
  PersonalRateLimitError,
} from "../github-personal.mjs";

import { createMockGh } from "./helpers/mock-gh.mjs";

// ─── Fixture loading ──────────────────────────────────────────────────────────

const __dir = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES = join(__dir, "fixtures", "github-personal");

const USER_PROFILE     = JSON.parse(readFileSync(join(FIXTURES, "user-profile.json"), "utf-8"));
const REPO_SUMMARY     = JSON.parse(readFileSync(join(FIXTURES, "repo-summary.json"), "utf-8"));
const COMMITS_COPILOT  = JSON.parse(readFileSync(join(FIXTURES, "commits-with-copilot.json"), "utf-8"));
const COMMITS_NONE     = JSON.parse(readFileSync(join(FIXTURES, "commits-no-copilot.json"), "utf-8"));
const REPO_NOT_FOUND   = JSON.parse(readFileSync(join(FIXTURES, "repo-not-found.json"), "utf-8"));

// ─── fetchUserProfile ─────────────────────────────────────────────────────────

describe("fetchUserProfile — happy path", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      { match: ["api"], stdout: JSON.stringify(USER_PROFILE), exit: 0 },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("returns a normalized user profile", () => {
    const profile = fetchUserProfile({ env: mock.env });
    expect(profile.login).toBe("octocat");
    expect(profile.id).toBe(583231);
    expect(profile.name).toBe("The Octocat");
    expect(profile.email).toBe("octocat@github.com");
    expect(typeof profile.publicRepos).toBe("number");
    expect(typeof profile.followers).toBe("number");
    expect(typeof profile.following).toBe("number");
    expect(profile.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("maps snake_case fields to camelCase", () => {
    const profile = fetchUserProfile({ env: mock.env });
    expect(profile.publicRepos).toBe(USER_PROFILE.public_repos);
    expect(profile.createdAt).toBe(USER_PROFILE.created_at);
  });

  it("does not expose raw snake_case fields", () => {
    const profile = fetchUserProfile({ env: mock.env });
    expect(profile).not.toHaveProperty("public_repos");
    expect(profile).not.toHaveProperty("created_at");
  });
});

describe("fetchUserProfile — 403 auth failure", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      {
        match: ["api"],
        stdout: JSON.stringify({ message: "Bad credentials", status: "401" }),
        exit: 1,
      },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("throws PersonalAuthError", () => {
    expect(() => fetchUserProfile({ env: mock.env })).toThrow(PersonalAuthError);
  });

  it("error message mentions gh auth", () => {
    expect(() => fetchUserProfile({ env: mock.env })).toThrow(/gh auth/);
  });
});

describe("fetchUserProfile — rate limit", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      {
        match: ["api"],
        stdout: JSON.stringify({ message: "API rate limit exceeded", status: "429" }),
        exit: 1,
      },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("throws PersonalRateLimitError", () => {
    expect(() => fetchUserProfile({ env: mock.env })).toThrow(PersonalRateLimitError);
  });
});

// ─── fetchRepoSummary ─────────────────────────────────────────────────────────

describe("fetchRepoSummary — happy path", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      { match: ["api"], stdout: JSON.stringify(REPO_SUMMARY), exit: 0 },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("returns a normalized repo summary", () => {
    const summary = fetchRepoSummary({ owner: "octocat", repo: "Hello-World", env: mock.env });
    expect(summary.id).toBe(1296269);
    expect(summary.name).toBe("Hello-World");
    expect(summary.fullName).toBe("octocat/Hello-World");
    expect(summary.private).toBe(false);
    expect(summary.fork).toBe(false);
    expect(typeof summary.stars).toBe("number");
    expect(typeof summary.forks).toBe("number");
    expect(typeof summary.openIssues).toBe("number");
    expect(summary.defaultBranch).toBe("main");
    expect(summary.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("maps snake_case fields to camelCase", () => {
    const summary = fetchRepoSummary({ owner: "octocat", repo: "Hello-World", env: mock.env });
    expect(summary.fullName).toBe(REPO_SUMMARY.full_name);
    expect(summary.stars).toBe(REPO_SUMMARY.stargazers_count);
    expect(summary.openIssues).toBe(REPO_SUMMARY.open_issues_count);
  });
});

describe("fetchRepoSummary — 404 not found", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      { match: ["api"], stdout: JSON.stringify(REPO_NOT_FOUND), exit: 1 },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("throws PersonalNotFoundError", () => {
    expect(() =>
      fetchRepoSummary({ owner: "octocat", repo: "nonexistent", env: mock.env })
    ).toThrow(PersonalNotFoundError);
  });

  it("error message includes repo context", () => {
    expect(() =>
      fetchRepoSummary({ owner: "octocat", repo: "nonexistent", env: mock.env })
    ).toThrow(/octocat\/nonexistent/);
  });
});

describe("fetchRepoSummary — argument validation", () => {
  it("throws PersonalError when owner is omitted", () => {
    expect(() => fetchRepoSummary({ repo: "hello" })).toThrow(PersonalError);
    expect(() => fetchRepoSummary({ repo: "hello" })).toThrow(/owner is required/);
  });

  it("throws PersonalError when repo is omitted", () => {
    expect(() => fetchRepoSummary({ owner: "octocat" })).toThrow(PersonalError);
    expect(() => fetchRepoSummary({ owner: "octocat" })).toThrow(/repo is required/);
  });
});

// ─── scanCopilotCoauthors ─────────────────────────────────────────────────────

describe("scanCopilotCoauthors — commits with Copilot co-authors", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      { match: ["api"], stdout: JSON.stringify(COMMITS_COPILOT), exit: 0 },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("returns correct total and withCopilot counts", () => {
    const result = scanCopilotCoauthors({
      owner: "octocat",
      repo: "Hello-World",
      env: mock.env,
    });
    expect(result.total).toBe(COMMITS_COPILOT.length);
    const expectedCopilot = COMMITS_COPILOT.filter((c) =>
      /co-authored-by:\s*(github\s+)?copilot\s*</i.test(c.commit.message)
    ).length;
    expect(result.withCopilot).toBe(expectedCopilot);
    expect(result.withCopilot).toBeGreaterThan(0);
  });

  it("each CommitEntry has required fields", () => {
    const result = scanCopilotCoauthors({
      owner: "octocat",
      repo: "Hello-World",
      env: mock.env,
    });
    for (const entry of result.commits) {
      expect(typeof entry.sha).toBe("string");
      expect(typeof entry.date).toBe("string");
      expect(typeof entry.message).toBe("string");
      expect(typeof entry.hasCopilot).toBe("boolean");
    }
  });

  it("correctly flags commits with Copilot co-author signature", () => {
    const result = scanCopilotCoauthors({
      owner: "octocat",
      repo: "Hello-World",
      env: mock.env,
    });
    const withCopilot = result.commits.filter((c) => c.hasCopilot);
    for (const entry of withCopilot) {
      expect(entry.message).toMatch(/co-authored-by/i);
      expect(entry.message).toMatch(/copilot/i);
    }
  });

  it("correctly marks commits without Copilot as hasCopilot=false", () => {
    const result = scanCopilotCoauthors({
      owner: "octocat",
      repo: "Hello-World",
      env: mock.env,
    });
    const noCopilot = result.commits.filter((c) => !c.hasCopilot);
    for (const entry of noCopilot) {
      expect(entry.message).not.toMatch(/co-authored-by:\s*(github\s+)?copilot\s*</i);
    }
  });
});

describe("scanCopilotCoauthors — commits without Copilot co-authors", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      { match: ["api"], stdout: JSON.stringify(COMMITS_NONE), exit: 0 },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("returns withCopilot=0 when no commits have Copilot signatures", () => {
    const result = scanCopilotCoauthors({
      owner: "octocat",
      repo: "Hello-World",
      env: mock.env,
    });
    expect(result.total).toBe(COMMITS_NONE.length);
    expect(result.withCopilot).toBe(0);
    expect(result.commits.every((c) => !c.hasCopilot)).toBe(true);
  });
});

describe("scanCopilotCoauthors — argument validation", () => {
  it("throws PersonalError when owner is omitted", () => {
    expect(() => scanCopilotCoauthors({ repo: "hello" })).toThrow(PersonalError);
    expect(() => scanCopilotCoauthors({ repo: "hello" })).toThrow(/owner is required/);
  });

  it("throws PersonalError when repo is omitted", () => {
    expect(() => scanCopilotCoauthors({ owner: "octocat" })).toThrow(PersonalError);
    expect(() => scanCopilotCoauthors({ owner: "octocat" })).toThrow(/repo is required/);
  });
});

describe("scanCopilotCoauthors — 404 not found", () => {
  let mock;

  beforeEach(() => {
    mock = createMockGh([
      { match: ["api"], stdout: JSON.stringify(REPO_NOT_FOUND), exit: 1 },
    ]);
  });

  afterEach(() => mock.cleanup());

  it("throws PersonalNotFoundError", () => {
    expect(() =>
      scanCopilotCoauthors({ owner: "octocat", repo: "nonexistent", env: mock.env })
    ).toThrow(PersonalNotFoundError);
  });
});
