/**
 * Tests for pforge-mcp/dashboard/github-personal-tab.mjs (Phase-54 Slice 2).
 *
 * Coverage:
 *   renderAccountCard      — happy path, null input, XSS escape
 *   renderRepoActivityCard — happy path, null input, private badge, XSS escape
 *   renderAiAssistCard     — happy path, null input, zero-commits input
 *   renderPersonalEmptyState — reason variants
 *   window-attach          — window exports are present when window is defined
 *
 * No JSDOM — uses string assertions only (same pattern as github-metrics-dashboard.test.mjs).
 */

import { describe, expect, it, beforeAll } from "vitest";

let renderAccountCard;
let renderRepoActivityCard;
let renderAiAssistCard;
let renderPersonalEmptyState;

beforeAll(async () => {
  ({
    renderAccountCard,
    renderRepoActivityCard,
    renderAiAssistCard,
    renderPersonalEmptyState,
  } = await import("../dashboard/github-personal-tab.mjs"));
});

// ─── renderAccountCard ────────────────────────────────────────────────────────

describe("renderAccountCard — happy path", () => {
  const user = {
    login: "octocat",
    id: 583231,
    name: "The Octocat",
    email: "octocat@github.com",
    bio: "A friendly creature.",
    publicRepos: 42,
    followers: 100,
    following: 5,
    createdAt: "2011-01-25T18:44:36Z",
  };

  it("renders a card with data-card='account'", () => {
    const html = renderAccountCard(user);
    expect(html).toContain('data-card="account"');
  });

  it("includes the login handle", () => {
    const html = renderAccountCard(user);
    expect(html).toContain("@octocat");
  });

  it("includes the display name", () => {
    const html = renderAccountCard(user);
    expect(html).toContain("The Octocat");
  });

  it("includes publicRepos count", () => {
    const html = renderAccountCard(user);
    expect(html).toContain("42");
  });

  it("includes followers count", () => {
    const html = renderAccountCard(user);
    expect(html).toContain("100");
  });

  it("includes member-since date", () => {
    const html = renderAccountCard(user);
    expect(html).toContain("2011");
  });
});

describe("renderAccountCard — null input", () => {
  it("returns empty-state HTML (not throws)", () => {
    expect(() => renderAccountCard(null)).not.toThrow();
    const html = renderAccountCard(null);
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("returns empty-state HTML for undefined input", () => {
    expect(() => renderAccountCard(undefined)).not.toThrow();
    const html = renderAccountCard(undefined);
    expect(html).toContain("gh auth login");
  });
});

describe("renderAccountCard — XSS escape", () => {
  it("escapes < and > in login", () => {
    const html = renderAccountCard({ login: "<script>alert(1)</script>", publicRepos: 0, followers: 0, following: 0, createdAt: "" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes double-quotes in name", () => {
    const html = renderAccountCard({ login: "user", name: 'He said "hello"', publicRepos: 0, followers: 0, following: 0, createdAt: "" });
    expect(html).not.toContain('"hello"');
    expect(html).toContain("&quot;hello&quot;");
  });
});

// ─── renderRepoActivityCard ───────────────────────────────────────────────────

describe("renderRepoActivityCard — happy path", () => {
  const repo = {
    id: 1296269,
    name: "Hello-World",
    fullName: "octocat/Hello-World",
    private: false,
    description: "My first repository.",
    fork: false,
    stars: 80,
    forks: 9,
    openIssues: 0,
    defaultBranch: "main",
    language: "TypeScript",
    createdAt: "2011-01-26T19:01:12Z",
    updatedAt: "2024-01-01T00:00:00Z",
    pushedAt: "2024-06-01T12:00:00Z",
  };

  it("renders a card with data-card='repo'", () => {
    const html = renderRepoActivityCard(repo);
    expect(html).toContain('data-card="repo"');
  });

  it("includes the full repo name", () => {
    const html = renderRepoActivityCard(repo);
    expect(html).toContain("octocat/Hello-World");
  });

  it("includes star count", () => {
    const html = renderRepoActivityCard(repo);
    expect(html).toContain("80");
  });

  it("includes fork count", () => {
    const html = renderRepoActivityCard(repo);
    expect(html).toContain("9");
  });

  it("includes language badge", () => {
    const html = renderRepoActivityCard(repo);
    expect(html).toContain("TypeScript");
  });

  it("includes public badge for public repos", () => {
    const html = renderRepoActivityCard(repo);
    expect(html).toContain("public");
  });

  it("includes pushedAt date", () => {
    const html = renderRepoActivityCard(repo);
    expect(html).toContain("2024");
  });
});

describe("renderRepoActivityCard — private repo", () => {
  it("includes private badge", () => {
    const html = renderRepoActivityCard({ name: "secret", fullName: "org/secret", private: true, stars: 0, forks: 0, openIssues: 0 });
    expect(html).toContain("private");
  });
});

describe("renderRepoActivityCard — null input", () => {
  it("returns non-empty empty-state string (not throws)", () => {
    expect(() => renderRepoActivityCard(null)).not.toThrow();
    const html = renderRepoActivityCard(null);
    expect(html).toContain('data-card="repo"');
    expect(html).toContain("No repository data");
  });
});

describe("renderRepoActivityCard — XSS escape", () => {
  it("escapes < and > in repo.fullName", () => {
    const html = renderRepoActivityCard({
      name: "r",
      fullName: '<img src=x onerror="alert(1)">',
      private: false,
      stars: 0,
      forks: 0,
      openIssues: 0,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain("&lt;img");
  });
});

// ─── renderAiAssistCard ───────────────────────────────────────────────────────

describe("renderAiAssistCard — happy path", () => {
  const copilotSignal = {
    total: 10,
    withCopilot: 4,
    commits: [],
  };

  it("renders a card with data-card='ai-assist'", () => {
    const html = renderAiAssistCard(copilotSignal);
    expect(html).toContain('data-card="ai-assist"');
  });

  it("shows correct percentage (40.0%)", () => {
    const html = renderAiAssistCard(copilotSignal);
    expect(html).toContain("40.0%");
  });

  it("mentions 4 of 10 commits", () => {
    const html = renderAiAssistCard(copilotSignal);
    expect(html).toContain("4");
    expect(html).toContain("10");
  });

  it("data-pct attribute matches percentage string", () => {
    const html = renderAiAssistCard(copilotSignal);
    expect(html).toContain('data-pct="40.0"');
  });
});

describe("renderAiAssistCard — zero commits", () => {
  it("renders empty-state for total=0", () => {
    expect(() => renderAiAssistCard({ total: 0, withCopilot: 0, commits: [] })).not.toThrow();
    const html = renderAiAssistCard({ total: 0, withCopilot: 0, commits: [] });
    expect(html).toContain("empty");
  });

  it("renders empty-state for null input", () => {
    expect(() => renderAiAssistCard(null)).not.toThrow();
    const html = renderAiAssistCard(null);
    expect(html).toContain("empty");
  });
});

describe("renderAiAssistCard — 0% copilot", () => {
  it("shows 0.0% when withCopilot is 0 but total > 0", () => {
    const html = renderAiAssistCard({ total: 5, withCopilot: 0, commits: [] });
    expect(html).toContain("0.0%");
  });
});

// ─── renderPersonalEmptyState ─────────────────────────────────────────────────

describe("renderPersonalEmptyState — reason variants", () => {
  it("auth reason mentions gh auth login", () => {
    const html = renderPersonalEmptyState({ reason: "auth" });
    expect(html).toContain("gh auth login");
  });

  it("no-remote reason mentions GitHub remote", () => {
    const html = renderPersonalEmptyState({ reason: "no-remote" });
    expect(html).toContain("GitHub remote");
  });

  it("empty reason mentions no commits", () => {
    const html = renderPersonalEmptyState({ reason: "empty" });
    expect(html).toContain("No commits");
  });

  it("unknown reason renders a fallback message", () => {
    const html = renderPersonalEmptyState({ reason: "other" });
    expect(html).toContain("gh auth login");
    expect(typeof html).toBe("string");
  });

  it("no args renders default (does not throw)", () => {
    expect(() => renderPersonalEmptyState()).not.toThrow();
    const html = renderPersonalEmptyState();
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders data-card='empty-state'", () => {
    const html = renderPersonalEmptyState({ reason: "auth" });
    expect(html).toContain('data-card="empty-state"');
  });
});
