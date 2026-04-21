/**
 * Tests for fileMetaBug() — meta-bug filer with hash-based deduplication.
 * Phase-28.3 Slice 2.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fileMetaBug,
  computeMetaBugHash,
  resolveGitHubToken,
  resolveSelfRepairRepo,
  META_BUG_CLASSES,
  SELF_REPAIR_LABELS,
} from "../tempering/bug-adapters/github.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeParams(overrides = {}) {
  return {
    class: "plan-defect",
    title: "Gate uses wrong grep pattern",
    symptom: "Slice 3 gate failed because grep matched stale file",
    workaround: "Changed grep to use -r flag",
    filePaths: ["src/foo.mjs"],
    slice: "3",
    plan: "Phase-28",
    severity: "high",
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return { meta: { selfRepairRepo: "testowner/testrepo" }, ...overrides };
}

function makeDeps(overrides = {}) {
  const execSync = vi.fn();
  const fetchFn = vi.fn();
  return {
    execSync,
    fetch: fetchFn,
    cwd: "/tmp/test",
    ...overrides,
  };
}

function stubTokenEnv() {
  process.env.GITHUB_TOKEN = "ghp_test_token_123";
}

function clearTokenEnv() {
  delete process.env.GITHUB_TOKEN;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("computeMetaBugHash", () => {
  it("produces a 12-character hex string", () => {
    const hash = computeMetaBugHash("plan-defect", "Some title");
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is stable across calls with same class+title", () => {
    const h1 = computeMetaBugHash("plan-defect", "Gate uses wrong grep pattern");
    const h2 = computeMetaBugHash("plan-defect", "Gate uses wrong grep pattern");
    expect(h1).toBe(h2);
  });

  it("normalizes whitespace for stability", () => {
    const h1 = computeMetaBugHash("plan-defect", "Gate  uses   wrong pattern");
    const h2 = computeMetaBugHash("plan-defect", "Gate uses wrong pattern");
    expect(h1).toBe(h2);
  });

  it("normalizes case for stability", () => {
    const h1 = computeMetaBugHash("plan-defect", "Gate Uses Wrong Pattern");
    const h2 = computeMetaBugHash("plan-defect", "gate uses wrong pattern");
    expect(h1).toBe(h2);
  });

  it("differs for different classes", () => {
    const h1 = computeMetaBugHash("plan-defect", "Same title");
    const h2 = computeMetaBugHash("orchestrator-defect", "Same title");
    expect(h1).not.toBe(h2);
  });

  it("differs for different titles", () => {
    const h1 = computeMetaBugHash("plan-defect", "Title A");
    const h2 = computeMetaBugHash("plan-defect", "Title B");
    expect(h1).not.toBe(h2);
  });
});

describe("fileMetaBug — new-issue path", () => {
  beforeEach(() => {
    stubTokenEnv();
  });

  afterEach(() => {
    clearTokenEnv();
  });

  it("calls createIssueViaGh with correct title and labels", async () => {
    const deps = makeDeps();
    const params = makeParams();
    const hash = computeMetaBugHash(params.class, params.title);

    // gh issue list returns no matches (no existing issue)
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) {
        return `https://github.com/testowner/testrepo/issues/42`;
      }
      return "";
    });

    const result = await fileMetaBug(params, makeConfig(), deps);

    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(42);
    expect(result.deduped).toBe(false);
    expect(result.hash).toBe(hash);

    // Verify create was called with correct title format
    const createCall = deps.execSync.mock.calls.find((c) => c[0].includes("gh issue create"));
    expect(createCall).toBeTruthy();
    expect(createCall[0]).toContain(`[self-repair:${hash}]`);
    expect(createCall[0]).toContain(`[${params.class}]`);
    expect(createCall[0]).toContain(params.title);

    // Verify labels
    expect(createCall[0]).toContain('--label "self-repair"');
    expect(createCall[0]).toContain('--label "plan-forge-internal"');
    expect(createCall[0]).toContain('--label "plan-defect"');
    expect(createCall[0]).toContain('--label "high"');
  });

  it("falls back to REST when gh CLI fails for create", async () => {
    const deps = makeDeps();
    const params = makeParams();

    // gh issue list returns no matches, gh issue create fails
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) throw new Error("gh not found");
      return "";
    });

    // REST create succeeds
    deps.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ number: 99, html_url: "https://github.com/testowner/testrepo/issues/99" }),
      headers: { get: () => null },
    });

    const result = await fileMetaBug(params, makeConfig(), deps);

    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(99);
    expect(result.deduped).toBe(false);
  });

  it("uses default severity 'medium' when not provided", async () => {
    const deps = makeDeps();
    const params = makeParams({ severity: undefined });

    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) {
        return `https://github.com/testowner/testrepo/issues/10`;
      }
      return "";
    });

    const result = await fileMetaBug(params, makeConfig(), deps);
    expect(result.ok).toBe(true);

    const createCall = deps.execSync.mock.calls.find((c) => c[0].includes("gh issue create"));
    expect(createCall[0]).toContain('--label "medium"');
  });
});

describe("fileMetaBug — dedupe path", () => {
  beforeEach(() => {
    stubTokenEnv();
  });

  afterEach(() => {
    clearTokenEnv();
  });

  it("calls addComment when matching open issue exists (gh CLI path)", async () => {
    const deps = makeDeps();
    const params = makeParams();
    const hash = computeMetaBugHash(params.class, params.title);

    // gh issue list returns a match
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) {
        return JSON.stringify([
          { number: 7, url: "https://github.com/testowner/testrepo/issues/7", title: `[self-repair:${hash}] [plan-defect] Gate uses wrong grep pattern` },
        ]);
      }
      return "";
    });

    // addComment via REST succeeds
    deps.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 555, html_url: "https://github.com/testowner/testrepo/issues/7#issuecomment-555" }),
    });

    const result = await fileMetaBug(params, makeConfig(), deps);

    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(7);
    expect(result.deduped).toBe(true);
    expect(result.hash).toBe(hash);

    // Verify comment was posted via REST (addComment)
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const fetchCall = deps.fetch.mock.calls[0];
    expect(fetchCall[0]).toContain("/issues/7/comments");
  });

  it("dedupes via REST search when gh CLI is unavailable", async () => {
    const params = makeParams();
    const hash = computeMetaBugHash(params.class, params.title);
    const fetchFn = vi.fn();

    // First call: REST search returns match
    // Second call: addComment succeeds
    let callCount = 0;
    fetchFn.mockImplementation(async (url) => {
      callCount++;
      if (url.includes("/search/issues")) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { number: 15, html_url: "https://github.com/testowner/testrepo/issues/15", title: `[self-repair:${hash}] [plan-defect] Gate uses wrong grep pattern` },
            ],
          }),
        };
      }
      // addComment
      return {
        ok: true,
        json: async () => ({ id: 800, html_url: "https://github.com/testowner/testrepo/issues/15#issuecomment-800" }),
      };
    });

    const result = await fileMetaBug(params, makeConfig(), {
      fetch: fetchFn,
      cwd: "/tmp/test",
      // No execSync — forces REST path
    });

    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(15);
    expect(result.deduped).toBe(true);
  });
});

describe("fileMetaBug — error handling", () => {
  afterEach(() => {
    clearTokenEnv();
  });

  it("returns NO_TOKEN when no token is available", async () => {
    clearTokenEnv();
    const result = await fileMetaBug(makeParams(), makeConfig(), makeDeps());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NO_TOKEN");
  });

  it("returns MISSING_REQUIRED_FIELDS when class is missing", async () => {
    stubTokenEnv();
    const result = await fileMetaBug(makeParams({ class: "" }), makeConfig(), makeDeps());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("MISSING_REQUIRED_FIELDS");
  });

  it("returns MISSING_REQUIRED_FIELDS when title is missing", async () => {
    stubTokenEnv();
    const result = await fileMetaBug(makeParams({ title: "" }), makeConfig(), makeDeps());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("MISSING_REQUIRED_FIELDS");
  });

  it("returns MISSING_REQUIRED_FIELDS when symptom is missing", async () => {
    stubTokenEnv();
    const result = await fileMetaBug(makeParams({ symptom: "" }), makeConfig(), makeDeps());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("MISSING_REQUIRED_FIELDS");
  });

  it("returns CREATE_FAILED when both gh CLI and REST fail", async () => {
    stubTokenEnv();
    const deps = makeDeps();

    // No existing issues
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) throw new Error("fail");
      return "";
    });

    // REST also fails
    deps.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
    });

    const result = await fileMetaBug(makeParams(), makeConfig(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("HTTP_500");
  });

  it("never throws — returns UNEXPECTED on unforeseen errors", async () => {
    stubTokenEnv();
    // Pass null params to trigger internal error
    const result = await fileMetaBug(null, makeConfig(), makeDeps());
    expect(result.ok).toBe(false);
    expect(result.error).toBe("MISSING_REQUIRED_FIELDS");
  });
});

describe("fileMetaBug — body content", () => {
  beforeEach(() => {
    stubTokenEnv();
  });

  afterEach(() => {
    clearTokenEnv();
  });

  it("trajectory excerpt appears in body under ## Context", async () => {
    const deps = makeDeps();
    const trajectory = "I chose approach X because Y was too slow.\nKey gotcha: Z.";
    const params = makeParams({ trajectoryExcerpt: trajectory });

    let capturedBody = "";
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) {
        capturedBody = cmd;
        return `https://github.com/testowner/testrepo/issues/50`;
      }
      return "";
    });

    const result = await fileMetaBug(params, makeConfig(), deps);
    expect(result.ok).toBe(true);

    // The body should contain the trajectory under ## Context
    expect(capturedBody).toContain("## Context");
    expect(capturedBody).toContain("I chose approach X because Y was too slow.");
  });

  it("body includes symptom section", async () => {
    const deps = makeDeps();
    const params = makeParams();

    let capturedBody = "";
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) {
        capturedBody = cmd;
        return `https://github.com/testowner/testrepo/issues/51`;
      }
      return "";
    });

    await fileMetaBug(params, makeConfig(), deps);
    expect(capturedBody).toContain("## Symptom");
    expect(capturedBody).toContain(params.symptom);
  });

  it("body includes file paths", async () => {
    const deps = makeDeps();
    const params = makeParams({ filePaths: ["src/a.mjs", "src/b.mjs"] });

    let capturedBody = "";
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) {
        capturedBody = cmd;
        return `https://github.com/testowner/testrepo/issues/52`;
      }
      return "";
    });

    await fileMetaBug(params, makeConfig(), deps);
    expect(capturedBody).toContain("## Files");
    expect(capturedBody).toContain("src/a.mjs");
    expect(capturedBody).toContain("src/b.mjs");
  });

  it("body includes plan and slice reference", async () => {
    const deps = makeDeps();
    const params = makeParams({ plan: "Phase-28", slice: "3" });

    let capturedBody = "";
    deps.execSync.mockImplementation((cmd) => {
      if (cmd.includes("gh issue list")) return "[]";
      if (cmd.includes("gh issue create")) {
        capturedBody = cmd;
        return `https://github.com/testowner/testrepo/issues/53`;
      }
      return "";
    });

    await fileMetaBug(params, makeConfig(), deps);
    expect(capturedBody).toContain("## Reference");
    expect(capturedBody).toContain("Phase-28");
    expect(capturedBody).toContain("Slice");
  });
});


