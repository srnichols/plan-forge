/**
 * Meta-bugs #288, #289, #290 — forge_secret_scan failed with
 * "spawnSync git ENOBUFS" on release-sized diffs: the handler read
 * `git diff <since>` through execFileSync with Node's default 1 MiB buffer.
 *
 * Meta-bug #291 — forge_diff_classify returned severity "none", totalAdded 0
 * for a large staged release: `git diff --cached` hit the same buffer limit
 * and the handler caught the error as an empty (clean) diff.
 *
 * Both handlers now read through readGitDiff(), which buffers up to
 * GIT_DIFF_MAX_BUFFER_BYTES and raises GitDiffCapacityError beyond that,
 * and diff_classify fails closed when git cannot produce the staged diff.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _callToolHandler_051_forge_diff_classify,
  _callToolHandler_052_forge_secret_scan,
} from "../server/tool-handlers/safety.mjs";
import {
  GIT_DIFF_MAX_BUFFER_BYTES,
  GitDiffCapacityError,
  readGitDiff,
} from "../server/git-diff-reader.mjs";

const NODE_DEFAULT_MAX_BUFFER = 1024 * 1024;
const PADDING_LINE = "// padding padding padding padding padding padding padding padding padding\n";
const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

// Built at runtime so no credential-shaped literal lives in this source file.
function syntheticCredentialLine() {
  const token = Array.from({ length: 32 }, (_, i) => TOKEN_ALPHABET[(i * 7 + 3) % TOKEN_ALPHABET.length]).join("");
  return `api_key = "${token}"\n`;
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-288-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "meta-288@example.invalid");
  git(dir, "config", "user.name", "Meta 288");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "core.autocrlf", "false");
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "seed");
  return dir;
}

/** Stage a file whose diff is twice Node's default buffer, with a credential line at each end. */
function stageLargeFile(dir) {
  const paddingLines = Math.ceil((2 * NODE_DEFAULT_MAX_BUFFER) / PADDING_LINE.length);
  const credential = syntheticCredentialLine();
  writeFileSync(join(dir, "bulk.txt"), credential + PADDING_LINE.repeat(paddingLines) + credential);
  git(dir, "add", "bulk.txt");
  return { totalLines: paddingLines + 2 };
}

function parseResponse(response) {
  return JSON.parse(response.content[0].text);
}

describe("readGitDiff (meta #288–#291)", () => {
  let dir;
  beforeAll(() => {
    dir = makeRepo();
    stageLargeFile(dir);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("returns a diff larger than Node's default 1 MiB buffer intact", () => {
    const diff = readGitDiff({ cwd: dir, gitArgs: ["diff", "--cached"] });
    expect(diff.length).toBeGreaterThan(NODE_DEFAULT_MAX_BUFFER);
    expect(GIT_DIFF_MAX_BUFFER_BYTES).toBeGreaterThan(NODE_DEFAULT_MAX_BUFFER);
  });

  it("raises GitDiffCapacityError instead of returning a truncated diff", () => {
    let caught;
    try {
      readGitDiff({ cwd: dir, gitArgs: ["diff", "--cached"], maxBufferBytes: 4096 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitDiffCapacityError);
    expect(caught.code).toBe("GIT_DIFF_TOO_LARGE");
    expect(caught.message).toMatch(/was not scanned/);
  });

  it("propagates other git failures unchanged", () => {
    let caught;
    try {
      readGitDiff({ cwd: dir, gitArgs: ["diff", "no-such-ref-meta-288"] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(GitDiffCapacityError);
    expect(caught.status).toBe(128);
  });
});

describe("forge_secret_scan scans diffs larger than 1 MiB (meta #288, #289, #290)", () => {
  let dir;
  let totalLines;
  beforeAll(() => {
    dir = makeRepo();
    ({ totalLines } = stageLargeFile(dir));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("returns findings from the end of the diff instead of ENOBUFS", async () => {
    const response = await _callToolHandler_052_forge_secret_scan(
      { params: { name: "forge_secret_scan" } },
      { path: dir, since: "HEAD" },
    );
    expect(response.isError, response.content[0].text.slice(0, 200)).toBe(false);
    const result = parseResponse(response);
    expect(result.scannedFiles).toBe(1);
    expect(result.clean).toBe(false);
    const flaggedLines = result.findings.map((f) => f.line);
    expect(flaggedLines).toContain(1);
    expect(flaggedLines).toContain(totalLines);
    expect(JSON.stringify(result)).not.toContain(syntheticCredentialLine().trim());
    const cached = JSON.parse(readFileSync(resolve(dir, ".forge", "secret-scan-cache.json"), "utf-8"));
    expect(cached.scannedFiles).toBe(1);
  });
});

describe("forge_diff_classify classifies large staged diffs and fails closed (meta #291)", () => {
  let dir;
  let totalLines;
  beforeAll(() => {
    dir = makeRepo();
    ({ totalLines } = stageLargeFile(dir));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("classifies a staged diff larger than 1 MiB instead of reporting it clean", async () => {
    const response = await _callToolHandler_051_forge_diff_classify(
      { params: { name: "forge_diff_classify" } },
      { path: dir, maxLines: totalLines + 100 },
    );
    expect(response.isError).toBeFalsy();
    const result = parseResponse(response);
    expect(result.totalAdded).toBe(totalLines);
    expect(result.truncated).toBe(false);
    expect(result.severity).toBe("critical");
    expect(result.findings.map((f) => f.category)).toContain("leaked-secret");
  });

  it("returns an error rather than a clean result when git cannot read the index", async () => {
    const brokenDir = makeRepo();
    try {
      writeFileSync(join(brokenDir, ".git", "index"), "not an index");
      const response = await _callToolHandler_051_forge_diff_classify(
        { params: { name: "forge_diff_classify" } },
        { path: brokenDir },
      );
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toMatch(/not classified/i);
      expect(response.content[0].text).not.toMatch(/"severity":\s*"none"/);
    } finally {
      rmSync(brokenDir, { recursive: true, force: true });
    }
  });
});

describe("Guard: diff readers go through the bounded reader (meta #288–#291)", () => {
  const read = (...parts) => readFileSync(resolve(import.meta.dirname, "..", "server", ...parts), "utf-8");
  const sources = { "tool-handlers/safety.mjs": read("tool-handlers", "safety.mjs"), "rest-api.mjs": read("rest-api.mjs") };
  const src = sources["tool-handlers/safety.mjs"];

  for (const [name, text] of Object.entries(sources)) {
    it(`${name} has no direct git diff subprocess call`, () => {
      expect(text).not.toMatch(/exec(?:File)?Sync\(\s*["'`]git["'`]\s*,\s*\[\s*["'`]diff/);
      expect(text).not.toMatch(/execSync\(\s*["'`]git diff/);
    });
  }

  it("does not swallow a failed staged-diff read as an empty diff", () => {
    expect(src).not.toMatch(/diff\s*=\s*""\s*;?\s*\n\s*}/);
  });

  it("routes diff reads through readGitDiff", () => {
    expect((src.match(/readGitDiff\(/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(sources["rest-api.mjs"]).toMatch(/err instanceof GitDiffCapacityError/);
  });
});
