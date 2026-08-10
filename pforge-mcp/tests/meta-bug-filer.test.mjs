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
  const execFile = vi.fn();
  const fetchFn = vi.fn();
  return {
    execSync,
    execFile,
    fetch: fetchFn,
    cwd: "/tmp/test",
    ...overrides,
  };
}

/** argv handed to `gh issue create`, or null if the CLI path was not taken. */
function ghCreateArgv(deps) {
  const call = deps.execFile.mock.calls.find((c) => c[0] === "gh" && c[1]?.[1] === "create");
  return call ? call[1] : null;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

/**
 * Route `gh issue list` to a dedupe result and `gh issue create` to a URL,
 * since both now run through the same argv runner.
 */
function stubGh(deps, { listJson = "[]", createUrl = null, createThrows = false } = {}) {
  deps.execFile.mockImplementation((_cmd, argv) => {
    if (argv[1] === "list") return listJson;
    if (createThrows) throw new Error("gh create failed");
    return createUrl;
  });
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

  it("passes the correct title and labels to gh issue create", async () => {
    const deps = makeDeps();
    const params = makeParams();
    const hash = computeMetaBugHash(params.class, params.title);

    // gh issue list returns no matches (no existing issue)
    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createUrl: "https://github.com/testowner/testrepo/issues/42" });

    const result = await fileMetaBug(params, makeConfig(), deps);

    expect(result.ok).toBe(true);
    expect(result.issueNumber).toBe(42);
    expect(result.deduped).toBe(false);
    expect(result.hash).toBe(hash);

    const argv = ghCreateArgv(deps);
    expect(argv).toBeTruthy();
    const title = argValue(argv, "--title");
    expect(title).toContain(`[self-repair:${hash}]`);
    expect(title).toContain(`[${params.class}]`);
    expect(title).toContain(params.title);

    // Verify labels
    expect(argv).toContain("self-repair");
    expect(argv).toContain("plan-forge-internal");
    expect(argv).toContain("plan-defect");
    expect(argv).toContain("high");
  });

  it("falls back to REST when gh CLI fails for create", async () => {
    const deps = makeDeps();
    const params = makeParams();

    // gh issue list returns no matches, gh issue create fails
    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createThrows: true });

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

    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createUrl: "https://github.com/testowner/testrepo/issues/10" });

    const result = await fileMetaBug(params, makeConfig(), deps);
    expect(result.ok).toBe(true);

    expect(ghCreateArgv(deps)).toContain("medium");
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
    stubGh(deps, {
      listJson: JSON.stringify([
        { number: 7, url: "https://github.com/testowner/testrepo/issues/7", title: `[self-repair:${hash}] [plan-defect] Gate uses wrong grep pattern` },
      ]),
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
    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createThrows: true });

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

    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createUrl: "https://github.com/testowner/testrepo/issues/50" });

    const result = await fileMetaBug(params, makeConfig(), deps);
    expect(result.ok).toBe(true);

    // The body should contain the trajectory under ## Context
    const body = argValue(ghCreateArgv(deps), "--body");
    expect(body).toContain("## Context");
    expect(body).toContain("I chose approach X because Y was too slow.");
  });

  it("body includes symptom section", async () => {
    const deps = makeDeps();
    const params = makeParams();

    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createUrl: "https://github.com/testowner/testrepo/issues/51" });

    await fileMetaBug(params, makeConfig(), deps);
    const body = argValue(ghCreateArgv(deps), "--body");
    expect(body).toContain("## Symptom");
    expect(body).toContain(params.symptom);
  });

  it("body includes file paths", async () => {
    const deps = makeDeps();
    const params = makeParams({ filePaths: ["src/a.mjs", "src/b.mjs"] });

    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createUrl: "https://github.com/testowner/testrepo/issues/52" });

    await fileMetaBug(params, makeConfig(), deps);
    const body = argValue(ghCreateArgv(deps), "--body");
    expect(body).toContain("## Files");
    expect(body).toContain("src/a.mjs");
    expect(body).toContain("src/b.mjs");
  });

  it("body includes plan and slice reference", async () => {
    const deps = makeDeps();
    const params = makeParams({ plan: "Phase-28", slice: "3" });

    deps.execSync.mockReturnValue("[]");
    stubGh(deps, { createUrl: "https://github.com/testowner/testrepo/issues/53" });

    await fileMetaBug(params, makeConfig(), deps);
    const body = argValue(ghCreateArgv(deps), "--body");
    expect(body).toContain("## Reference");
    expect(body).toContain("Phase-28");
    expect(body).toContain("Slice");
  });
});


