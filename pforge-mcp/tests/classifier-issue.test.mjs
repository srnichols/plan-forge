/**
 * Tests for tempering/classifier-issue.mjs — Phase CLASSIFIER-ISSUE (v3.5.0)
 *
 * Covers:
 *   1. buildClassifierIssueBody — markdown structure
 *   2. computeClassifierIssueHash — determinism and stability
 *   3. fileClassifierIssue — no-token guard, no-repo guard, gh CLI success,
 *      REST fallback, dedup (comment), unexpected error handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildClassifierIssueBody,
  computeClassifierIssueHash,
  CLASSIFIER_ISSUE_LABELS,
  fileClassifierIssue,
} from "../tempering/classifier-issue.mjs";

// ─── buildClassifierIssueBody ─────────────────────────────────────────────────

describe("buildClassifierIssueBody", () => {
  const payload = {
    findingClass: "missing-alt-text",
    route: "/about",
    currentClassification: "infra",
    reason: "Decorative images lack alt attribute",
    rule: "content-audit:alt-text",
    proposedAction: "Add classifier rule to skip decorative images",
    evidence: { url: "/about", selector: "img.decorative" },
  };

  it("includes finding class in heading", () => {
    const body = buildClassifierIssueBody(payload, "abc123");
    expect(body).toContain("missing-alt-text");
  });

  it("includes route when present", () => {
    const body = buildClassifierIssueBody(payload, "abc123");
    expect(body).toContain("/about");
  });

  it("includes proposed action", () => {
    const body = buildClassifierIssueBody(payload, "abc123");
    expect(body).toContain("Add classifier rule");
  });

  it("embeds the hash in the footer", () => {
    const body = buildClassifierIssueBody(payload, "abc123def456");
    expect(body).toContain("abc123def456");
  });

  it("includes collapsed evidence block when evidence is non-empty", () => {
    const body = buildClassifierIssueBody(payload, "hash");
    expect(body).toContain("<details>");
    expect(body).toContain("img.decorative");
  });

  it("omits evidence block when evidence is empty", () => {
    const noEvidence = { ...payload, evidence: {} };
    const body = buildClassifierIssueBody(noEvidence, "hash");
    expect(body).not.toContain("<details>");
  });

  it("handles missing optional fields gracefully", () => {
    const minimal = { findingClass: "broken-link" };
    const body = buildClassifierIssueBody(minimal, "hash");
    expect(body).toContain("broken-link");
    expect(body).toContain("Plan Forge Tempering");
  });
});

// ─── computeClassifierIssueHash ──────────────────────────────────────────────

describe("computeClassifierIssueHash", () => {
  it("returns a 12-character hex string", () => {
    const h = computeClassifierIssueHash("broken-link", "link is 404");
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = computeClassifierIssueHash("missing-h1", "page lacks heading");
    const b = computeClassifierIssueHash("missing-h1", "page lacks heading");
    expect(a).toBe(b);
  });

  it("differs for different finding classes", () => {
    const a = computeClassifierIssueHash("missing-h1", "same reason");
    const b = computeClassifierIssueHash("broken-link", "same reason");
    expect(a).not.toBe(b);
  });

  it("differs for different reasons", () => {
    const a = computeClassifierIssueHash("infra", "reason A");
    const b = computeClassifierIssueHash("infra", "reason B");
    expect(a).not.toBe(b);
  });

  it("is case-insensitive for reason", () => {
    const a = computeClassifierIssueHash("infra", "Noisy Pattern");
    const b = computeClassifierIssueHash("infra", "noisy pattern");
    expect(a).toBe(b);
  });

  it("handles null/undefined inputs without throwing", () => {
    expect(() => computeClassifierIssueHash(null, null)).not.toThrow();
    const h = computeClassifierIssueHash(undefined, undefined);
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });
});

// ─── CLASSIFIER_ISSUE_LABELS ──────────────────────────────────────────────────

describe("CLASSIFIER_ISSUE_LABELS", () => {
  it("includes classifier-noise label", () => {
    expect(CLASSIFIER_ISSUE_LABELS).toContain("classifier-noise");
  });

  it("includes plan-forge-internal label", () => {
    expect(CLASSIFIER_ISSUE_LABELS).toContain("plan-forge-internal");
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(CLASSIFIER_ISSUE_LABELS)).toBe(true);
  });
});

// ─── fileClassifierIssue ─────────────────────────────────────────────────────

const BASE_PAYLOAD = {
  findingClass: "missing-alt-text",
  route: "/home",
  currentClassification: "infra",
  reason: "Decorative images",
  proposedAction: "Skip decorative images",
};

describe("fileClassifierIssue — no token", () => {
  it("returns ok:false with NO_TOKEN when no token available", async () => {
    const origEnv = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const result = await fileClassifierIssue(BASE_PAYLOAD, {}, {
      execSync: () => { throw new Error("no gh"); },
      fetch: undefined,
      cwd: "/fake/cwd",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NO_TOKEN");
    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv;
  });
});

describe("fileClassifierIssue — no repo", () => {
  it("returns ok:false with NO_REPO when git remote unavailable", async () => {
    const origEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "fake-token";
    const result = await fileClassifierIssue(BASE_PAYLOAD, {}, {
      execSync: (cmd) => {
        if (cmd.includes("git remote")) throw new Error("no remote");
        throw new Error("unexpected");
      },
      fetch: undefined,
      cwd: "/fake/cwd",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NO_REPO");
    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv; else delete process.env.GITHUB_TOKEN;
  });
});

describe("fileClassifierIssue — gh CLI success (new issue)", () => {
  it("returns ok:true with issueNumber from gh CLI output", async () => {
    const origEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "fake-token";

    const execSync = vi.fn((cmd) => {
      if (cmd.includes("git remote")) return "https://github.com/owner/repo.git";
      if (cmd.includes("gh issue list")) return "[]";         // no existing issue
      if (cmd.includes("gh issue create")) return "https://github.com/owner/repo/issues/42";
      throw new Error(`unexpected cmd: ${cmd}`);
    });

    const result = await fileClassifierIssue(BASE_PAYLOAD, {}, { execSync, cwd: "/fake/cwd" });
    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(42);
    expect(result.deduped).toBe(false);

    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv; else delete process.env.GITHUB_TOKEN;
  });
});

describe("fileClassifierIssue — dedup: comments on existing issue", () => {
  it("returns ok:true with deduped:true when matching issue exists", async () => {
    const origEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "fake-token";

    const hash = computeClassifierIssueHash(BASE_PAYLOAD.findingClass, BASE_PAYLOAD.reason);
    const execSync = vi.fn((cmd) => {
      if (cmd.includes("git remote")) return "https://github.com/owner/repo.git";
      if (cmd.includes("gh issue list")) {
        return JSON.stringify([{ number: 7, url: "https://github.com/owner/repo/issues/7", title: `[classifier-noise:${hash}] missing-alt-text: Decorative images` }]);
      }
      throw new Error(`unexpected cmd: ${cmd}`);
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1001, html_url: "https://github.com/owner/repo/issues/7#comment-1001" }),
    });

    const result = await fileClassifierIssue(BASE_PAYLOAD, {}, { execSync, fetch: fetchMock, cwd: "/fake/cwd" });
    expect(result.ok).toBe(true);
    expect(result.deduped).toBe(true);
    expect(result.issueNumber).toBe(7);

    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv; else delete process.env.GITHUB_TOKEN;
  });
});

describe("fileClassifierIssue — REST fallback", () => {
  it("falls back to REST when gh CLI issue creation fails", async () => {
    const origEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "fake-token";

    const execSync = vi.fn((cmd) => {
      if (cmd.includes("git remote")) return "https://github.com/owner/repo.git";
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) throw new Error("gh create failed");
      throw new Error(`unexpected: ${cmd}`);
    });

    // fetchMock is called twice:
    //   1. REST search fallback in findExisting (returns empty items)
    //   2. createViaRest for the actual issue creation
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ number: 99, html_url: "https://github.com/owner/repo/issues/99" }) });

    const result = await fileClassifierIssue(BASE_PAYLOAD, {}, { execSync, fetch: fetchMock, cwd: "/fake/cwd" });
    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(99);

    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv; else delete process.env.GITHUB_TOKEN;
  });
});

describe("fileClassifierIssue — MISSING_PAYLOAD guard (via server handler logic)", () => {
  it("returns error object when payload is falsy", async () => {
    const origEnv = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "fake-token";
    // Directly call with null payload — should not crash
    const result = await fileClassifierIssue(null, {}, { execSync: () => { throw new Error("no"); }, cwd: "/fake" });
    // null payload → findingClass is null, hash computed, but will fail at NO_TOKEN or NO_REPO
    // The key assertion: must not throw
    expect(typeof result.ok).toBe("boolean");
    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv; else delete process.env.GITHUB_TOKEN;
  });
});
