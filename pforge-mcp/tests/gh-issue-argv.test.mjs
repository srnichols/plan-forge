/**
 * Regression tests for `gh issue create` argument handling.
 *
 * Meta-bug: every issue filed through the gh CLI path rendered literal `\n`
 * instead of line breaks (observed on srnichols/plan-forge#236 and #237). The
 * command was assembled as a shell string, so newlines had to be escaped to
 * survive it — and `gh` passed the escape through verbatim into the body.
 *
 * The same shell string interpolated agent-supplied title/body text with only
 * `"` escaped, leaving `$(...)`, backticks, and `$VAR` live on POSIX shells.
 *
 * Both are fixed by passing an argv array instead of a shell string.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildCreateIssueArgs, createIssueViaGhCli } from "../tempering/gh-cli.mjs";
import { fileMetaBug } from "../tempering/bug-adapters/github.mjs";
import { fileClassifierIssue } from "../tempering/classifier-issue.mjs";

// ─── Helpers ──────────────────────────────────────────────────────────

const MULTILINE_BODY = "## Class\n\n`plan-defect`\n\n## Symptom\n\nLine one.\nLine two.";

/** Grab the argv array handed to a mocked execFile for `gh issue create`. */
function createArgvFrom(execFileMock) {
  const call = execFileMock.mock.calls.find(
    (c) => c[0] === "gh" && Array.isArray(c[1]) && c[1][1] === "create",
  );
  return call ? call[1] : null;
}

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

// ─── buildCreateIssueArgs ─────────────────────────────────────────────

describe("buildCreateIssueArgs", () => {
  it("keeps the body in a single argv element with real newlines", () => {
    const argv = buildCreateIssueArgs({
      owner: "o",
      repo: "r",
      title: "t",
      body: MULTILINE_BODY,
    });
    expect(argValue(argv, "--body")).toBe(MULTILINE_BODY);
  });

  it("never emits the literal two-character sequence backslash-n", () => {
    const argv = buildCreateIssueArgs({
      owner: "o",
      repo: "r",
      title: "t",
      body: MULTILINE_BODY,
    });
    expect(argValue(argv, "--body")).not.toContain("\\n");
    expect(argValue(argv, "--body").split("\n").length).toBeGreaterThan(1);
  });

  it("passes shell metacharacters through verbatim", () => {
    const hostile = 'Title with $(whoami) `id` "quotes" $HOME && rm -rf /';
    const argv = buildCreateIssueArgs({
      owner: "o",
      repo: "r",
      title: hostile,
      body: "b",
    });
    expect(argValue(argv, "--title")).toBe(hostile);
  });

  it("emits one --label flag pair per label", () => {
    const argv = buildCreateIssueArgs({
      owner: "o",
      repo: "r",
      title: "t",
      body: "b",
      labels: ["self-repair", "plan-defect", "high"],
    });
    expect(argv.filter((a) => a === "--label")).toHaveLength(3);
    expect(argv).toContain("plan-defect");
  });

  it("targets the requested repo", () => {
    const argv = buildCreateIssueArgs({ owner: "acme", repo: "widget", title: "t", body: "b" });
    expect(argValue(argv, "--repo")).toBe("acme/widget");
  });
});

// ─── createIssueViaGhCli ──────────────────────────────────────────────

describe("createIssueViaGhCli", () => {
  it("invokes gh with an argv array, never a shell string", () => {
    const execFile = vi.fn(() => "https://github.com/o/r/issues/42");
    createIssueViaGhCli({ owner: "o", repo: "r", title: "t", body: MULTILINE_BODY, execFile });

    expect(execFile).toHaveBeenCalledTimes(1);
    const [cmd, argv] = execFile.mock.calls[0];
    expect(cmd).toBe("gh");
    expect(Array.isArray(argv)).toBe(true);
    expect(argValue(argv, "--body")).toBe(MULTILINE_BODY);
  });

  it("parses the issue number from gh output", () => {
    const execFile = vi.fn(() => "https://github.com/o/r/issues/42\n");
    const result = createIssueViaGhCli({ owner: "o", repo: "r", title: "t", body: "b", execFile });
    expect(result).toEqual({ issueNumber: 42, url: "https://github.com/o/r/issues/42" });
  });

  it("returns null when no execFile runner is injected", () => {
    expect(createIssueViaGhCli({ owner: "o", repo: "r", title: "t", body: "b" })).toBeNull();
  });

  it("returns null when gh throws, so callers fall back to REST", () => {
    const execFile = vi.fn(() => { throw new Error("gh not installed"); });
    expect(createIssueViaGhCli({ owner: "o", repo: "r", title: "t", body: "b", execFile })).toBeNull();
  });

  it("returns null when gh output has no issue URL", () => {
    const execFile = vi.fn(() => "something unexpected");
    expect(createIssueViaGhCli({ owner: "o", repo: "r", title: "t", body: "b", execFile })).toBeNull();
  });
});

// ─── End-to-end body fidelity ─────────────────────────────────────────

describe("fileMetaBug — body reaches gh with real newlines", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("does not escape newlines in the issue body", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const execSync = vi.fn(() => "[]"); // gh issue list → no existing issue
    const execFile = vi.fn(() => "https://github.com/testowner/testrepo/issues/77");

    const result = await fileMetaBug(
      {
        class: "plan-defect",
        title: "Non-Goal asserts endpoints that do not exist",
        symptom: "Slice 1 scoped a list endpoint.\nThe route file has only approve and deny.",
        workaround: "Added an entryType filter to the existing list.",
        filePaths: ["apps/api/src/modules/admin/guest-refund.routes.ts"],
      },
      { meta: { selfRepairRepo: "testowner/testrepo" } },
      { execSync, execFile, fetch: vi.fn(), cwd: "/tmp/test" },
    );

    expect(result.ok).toBe(true);
    const body = argValue(createArgvFrom(execFile), "--body");
    expect(body).toContain("## Symptom");
    expect(body).not.toContain("\\n");
    expect(body).toContain("Slice 1 scoped a list endpoint.\nThe route file has only approve and deny.");
  });
});

describe("fileClassifierIssue — body reaches gh with real newlines", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("does not escape newlines in the issue body", async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const execSync = vi.fn((cmd) => {
      if (cmd.includes("git remote")) return "https://github.com/owner/repo.git";
      if (cmd.includes("gh issue list")) return "[]";
      throw new Error(`unexpected cmd: ${cmd}`);
    });
    const execFile = vi.fn(() => "https://github.com/owner/repo/issues/88");

    const result = await fileClassifierIssue(
      {
        findingClass: "missing-alt-text",
        route: "/home",
        currentClassification: "infra",
        reason: "Decorative images",
        proposedAction: "Skip decorative images",
      },
      {},
      { execSync, execFile, cwd: "/fake/cwd" },
    );

    expect(result.ok).toBe(true);
    const body = argValue(createArgvFrom(execFile), "--body");
    expect(body).not.toContain("\\n");
    expect(body.split("\n").length).toBeGreaterThan(1);
  });
});
