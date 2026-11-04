/**
 * Where the bug adapter, the meta-bug filer and the classifier lane find a GitHub token.
 *
 * A project's MCP server answered forge_meta_bug_file with a bare NO_TOKEN. A server reads its environment once,
 * when it starts, so a token exported in a terminal afterwards never reaches it, and the answer did not say so.
 * What these tests pin:
 *   - the variables are the ones github-request.mjs names, in its order: GITHUB_TOKEN, then GH_TOKEN;
 *   - a refusal says which source was tried and why it had no token, and never repeats a token;
 *   - the classifier lane reads a token the same way, because it shares the resolver instead of copying it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fileMetaBug, resolveGitHubToken } from "../tempering/bug-adapters/github.mjs";
import { fileClassifierIssue } from "../tempering/classifier-issue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NO_VARIABLES = {};
// Built at run time so no token-shaped literal sits in the source.
const TOKEN_SHAPED = "ghp_" + "A1b2".repeat(9);

const META_PARAMS = { class: "plan-defect", title: "A gate names the wrong file", symptom: "Slice 2 gate failed" };
const META_CONFIG = { meta: { selfRepairRepo: "testowner/testrepo" } };
const CLASSIFIER_PAYLOAD = {
  findingClass: "missing-alt-text",
  route: "/home",
  currentClassification: "infra",
  reason: "Decorative images",
  proposedAction: "Skip decorative images",
};

const tempDirs = [];

/** A project directory, with a .forge/secrets.json holding `secrets` when one is given. */
function makeProject(secrets) {
  const dir = mkdtempSync(join(tmpdir(), "pf-token-"));
  tempDirs.push(dir);
  if (secrets !== undefined) {
    mkdirSync(join(dir, ".forge"));
    writeFileSync(join(dir, ".forge", "secrets.json"), secrets);
  }
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ghFails = (fields) => () => {
  throw Object.assign(new Error("Command failed: gh auth token"), fields);
};

/** The refusal message for a resolution that finds no token. */
function whyNone(overrides = {}) {
  const result = resolveGitHubToken({}, { env: NO_VARIABLES, ...overrides });
  expect(result.token).toBeNull();
  expect(result.error).toBe("NO_TOKEN");
  return result.message;
}

describe("a token in the environment", () => {
  it("reads GITHUB_TOKEN", () => {
    expect(resolveGitHubToken({}, { env: { GITHUB_TOKEN: "ghp_one" } })).toEqual({ token: "ghp_one", source: "env" });
  });

  it("reads GH_TOKEN, the variable the GitHub CLI reads, when GITHUB_TOKEN is not set", () => {
    expect(resolveGitHubToken({}, { env: { GH_TOKEN: "ghp_two" } })).toEqual({ token: "ghp_two", source: "env" });
  });

  it("prefers GITHUB_TOKEN over GH_TOKEN", () => {
    expect(resolveGitHubToken({}, { env: { GITHUB_TOKEN: "ghp_one", GH_TOKEN: "ghp_two" } }).token).toBe("ghp_one");
  });

  it("skips a blank GITHUB_TOKEN for GH_TOKEN", () => {
    expect(resolveGitHubToken({}, { env: { GITHUB_TOKEN: "  ", GH_TOKEN: "ghp_two" } }).token).toBe("ghp_two");
  });

  it("reads no other variable: a Copilot token is not a GitHub API token", () => {
    expect(resolveGitHubToken({}, { env: { COPILOT_GITHUB_TOKEN: "ghp_three" } }).token).toBeNull();
  });

  it("asks nothing else once the environment has a token", () => {
    const execSync = vi.fn();
    const cwd = makeProject(JSON.stringify({ github: { token: "from-secrets" } }));
    expect(resolveGitHubToken({}, { env: { GH_TOKEN: "ghp_two" }, execSync, cwd }).source).toBe("env");
    expect(execSync).not.toHaveBeenCalled();
  });
});

describe("the sources after the environment are asked in order", () => {
  it("reads the secrets file before it starts gh, which would start a process", () => {
    const execSync = vi.fn(() => "from-gh\n");
    const cwd = makeProject(JSON.stringify({ github: { token: "from-secrets" } }));
    expect(resolveGitHubToken({}, { env: NO_VARIABLES, execSync, cwd })).toEqual({ token: "from-secrets", source: "secrets.json" });
    expect(execSync).not.toHaveBeenCalled();
  });

  it("asks gh when the secrets file has no token", () => {
    const execSync = vi.fn(() => "from-gh\n");
    const cwd = makeProject(JSON.stringify({ github: {} }));
    expect(resolveGitHubToken({}, { env: NO_VARIABLES, execSync, cwd })).toEqual({ token: "from-gh", source: "gh-cli" });
    expect(execSync).toHaveBeenCalledTimes(1);
  });
});

describe("when no source has a token, the message says why", () => {
  it("says the variables are not set in this process, and what to do about it", () => {
    const message = whyNone();
    expect(message).toContain("GITHUB_TOKEN and GH_TOKEN are not set in this process");
    expect(message).toContain("gh auth login");
    expect(message).toContain(".forge/secrets.json");
  });

  it("says a variable that cannot be a token is unusable, not unset, and never repeats its value", () => {
    const message = whyNone({ env: { GITHUB_TOKEN: "has a space in it" } });
    expect(message).toContain("GITHUB_TOKEN is set but is not a usable token");
    expect(message).not.toContain("are not set in this process");
    expect(message).not.toContain("has a space in it");
  });

  it.each([
    ["is not there", undefined, ".forge/secrets.json was not found"],
    ["has no github.token", JSON.stringify({ github: {} }), ".forge/secrets.json has no github.token"],
    ["is not JSON", "{ not json", ".forge/secrets.json could not be read as JSON"],
  ])("says so when the secrets file %s", (_label, contents, expected) => {
    expect(whyNone({ cwd: makeProject(contents) })).toContain(expected);
  });

  it("does not claim to have read a secrets file when it was given no project", () => {
    expect(whyNone()).not.toContain("was not found");
  });

  it.each([
    ["exits non-zero", ghFails({ status: 1, stderr: "no oauth token found for github.com\n" }), "`gh auth token` exited with status 1: no oauth token found for github.com"],
    ["exits non-zero without a word", ghFails({ status: 4, stderr: "" }), "`gh auth token` exited with status 4"],
    ["times out", ghFails({ code: "ETIMEDOUT", status: null, signal: "SIGTERM" }), "`gh auth token` timed out after 10 s"],
    ["cannot start", ghFails({ code: "ENOENT", status: null }), "`gh auth token` could not run (ENOENT)"],
    ["prints nothing", () => "\n", "`gh auth token` printed no token"],
  ])("says what happened when gh auth token %s", (_label, execSync, expected) => {
    expect(whyNone({ execSync })).toContain(expected);
  });

  it("says gh auth token was not run when it is given no command runner", () => {
    expect(whyNone()).toContain("`gh auth token` was not run");
  });

  it("quotes only the first line of what gh printed, skipping blank ones", () => {
    const message = whyNone({ execSync: ghFails({ status: 1, stderr: "\n\nfirst line\nsecond line\n" }) });
    expect(message).toContain("exited with status 1: first line");
    expect(message).not.toContain("second line");
  });

  it("cuts that line to a bounded length", () => {
    const message = whyNone({ execSync: ghFails({ status: 1, stderr: "x".repeat(500) }) });
    expect(message).not.toContain("x".repeat(121));
    expect(message).toContain("x".repeat(100));
  });

  it("never repeats a token that gh printed", () => {
    const stderr = `error: token ${TOKEN_SHAPED} was rejected\n`;
    const message = whyNone({ execSync: ghFails({ status: 1, stderr }) });
    expect(message).not.toContain(TOKEN_SHAPED);
    expect(message).toContain("[redacted]");
  });
});

describe("forge_meta_bug_file without a token", () => {
  it("answers NO_TOKEN with the message that says why", async () => {
    const result = await fileMetaBug(META_PARAMS, META_CONFIG, {
      env: NO_VARIABLES,
      execSync: ghFails({ status: 1, stderr: "no oauth token found for github.com\n" }),
      execFile: vi.fn(),
      cwd: makeProject(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("NO_TOKEN");
    expect(result.message).toContain("GITHUB_TOKEN and GH_TOKEN are not set in this process");
    expect(result.message).toContain(".forge/secrets.json was not found");
    expect(result.message).toContain("exited with status 1: no oauth token found for github.com");
  });

  it("files the issue when only GH_TOKEN is set", async () => {
    const execFile = vi.fn((_cmd, argv) => (argv[1] === "list" ? "[]" : "https://github.com/testowner/testrepo/issues/77"));
    const result = await fileMetaBug(META_PARAMS, META_CONFIG, {
      env: { GH_TOKEN: "ghp_two" },
      execSync: vi.fn(),
      execFile,
      cwd: makeProject(),
    });

    expect(result).toMatchObject({ ok: true, issueNumber: 77, deduped: false });
  });
});

describe("the classifier lane reads the token the same way", () => {
  it("files the issue when only GH_TOKEN is set", async () => {
    vi.stubEnv("GITHUB_TOKEN", undefined);
    vi.stubEnv("GH_TOKEN", "ghp_two");
    const execSync = vi.fn((cmd) => {
      if (cmd.includes("git remote")) return "https://github.com/owner/repo.git";
      throw new Error(`unexpected cmd: ${cmd}`);
    });
    const execFile = vi.fn((_cmd, argv) => (argv[1] === "list" ? "[]" : "https://github.com/owner/repo/issues/42"));

    const result = await fileClassifierIssue(CLASSIFIER_PAYLOAD, {}, { execSync, execFile, cwd: makeProject() });

    expect(result).toMatchObject({ ok: true, issueNumber: 42 });
  });

  it("answers NO_TOKEN with the message that says why", async () => {
    vi.stubEnv("GITHUB_TOKEN", undefined);
    vi.stubEnv("GH_TOKEN", undefined);

    const result = await fileClassifierIssue(CLASSIFIER_PAYLOAD, {}, {
      execSync: ghFails({ status: 1, stderr: "" }),
      cwd: makeProject(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("NO_TOKEN");
    expect(result.message).toContain("GITHUB_TOKEN and GH_TOKEN are not set in this process");
  });
});

describe("Guard: one module decides which variables carry a GitHub token", () => {
  const source = (relative) => readFileSync(join(HERE, relative), "utf8");

  it("the bug adapter leaves the variables to github-request.mjs", () => {
    const adapter = source("../tempering/bug-adapters/github.mjs");
    expect(adapter).not.toMatch(/process\.env\.(GITHUB_TOKEN|GH_TOKEN)/);
    expect(adapter).toContain('from "../../github-request.mjs"');
  });

  it("the classifier lane has no copy of the token chain", () => {
    const classifier = source("../tempering/classifier-issue.mjs");
    expect(classifier).not.toMatch(/process\.env\.(GITHUB_TOKEN|GH_TOKEN)/);
    expect(classifier).not.toMatch(/["'`]gh auth token["'`]/);
    expect(classifier).toContain('from "./bug-adapters/github.mjs"');
  });

  it("github-request.mjs still names the variables", () => {
    expect(source("../github-request.mjs")).toContain('["GITHUB_TOKEN", "GH_TOKEN"]');
  });
});
