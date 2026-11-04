/**
 * #300 / #128 — the release rehearsal harness.
 *
 * The rehearsal itself drives real installers for several minutes and runs in
 * the release-rehearsal workflow; these tests cover its decision logic: argument
 * parsing, version ordering, release-checks.json evaluation, the tag-collision
 * preflight that would have stopped the 2026-04-28 retrograde re-release, and what
 * it says about a failed installed suite (#457).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Checks, checkTagCollision, compareVersions, evaluateFileCheck, parseArgs, previousTag, selectFileChecks, summarizeInstalledSuite,
} from "../../scripts/release/harness.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const tmp = [];
const newDir = (prefix) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmp.push(d);
  return d;
};
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

const quiet = () => new Checks({ quiet: true });

describe("parseArgs", () => {
  it("maps --kebab-case to camelCase, supports flags, and drops empty values", () => {
    expect(parseArgs(["--release-ref", "HEAD", "--previous-tag", "", "--skip-tag-check"], ["skipTagCheck"]))
      .toEqual({ releaseRef: "HEAD", skipTagCheck: true });
  });

  it("rejects positional arguments and a missing value", () => {
    expect(() => parseArgs(["HEAD"])).toThrow(/unexpected argument/);
    expect(() => parseArgs(["--preset"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--previous-tag", "--logs", "x"])).toThrow(/needs a value/);
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("3.10.0", "3.9.9")).toBeGreaterThan(0);
    expect(compareVersions("3.28.1", "3.28.1")).toBe(0);
    expect(["3.9.0", "3.28.1", "3.10.2"].sort(compareVersions)).toEqual(["3.9.0", "3.10.2", "3.28.1"]);
  });
});

describe("release-checks.json", () => {
  const spec = JSON.parse(readFileSync(join(REPO_ROOT, "scripts/release/release-checks.json"), "utf8"));

  it("every entry has a label and a path, and at most one assertion", () => {
    for (const c of spec.checks) {
      expect(c.label && c.path, JSON.stringify(c)).toBeTruthy();
      const kinds = ["contains", "notContains", "jsonKey"].filter((k) => k in c);
      expect(kinds.length, c.label).toBeLessThanOrEqual(1);
      if (c.jsonKey) expect(c, c.label).toHaveProperty("equals");
    }
  });

  it("selects preset-specific and fresh-only entries only where they apply", () => {
    const local = { checks: [{ path: "a" }, { path: "b", preset: "dotnet" }, { path: "c", when: "fresh" }] };
    expect(selectFileChecks(local, { preset: "typescript", fresh: false }).map((c) => c.path)).toEqual(["a"]);
    expect(selectFileChecks(local, { preset: "dotnet", fresh: true }).map((c) => c.path)).toEqual(["a", "b", "c"]);
  });

  it("skips current-wrapper entries right after an update run by the previous release's wrapper", () => {
    const local = { checks: [{ path: "a" }, { path: "m", when: "current-wrapper" }] };
    expect(selectFileChecks(local, { preset: "x", fresh: false, previousWrapper: true }).map((c) => c.path)).toEqual(["a"]);
    expect(selectFileChecks(local, { preset: "x", fresh: false }).map((c) => c.path)).toEqual(["a", "m"]);
    expect(selectFileChecks(local, { preset: "x", fresh: true }).map((c) => c.path)).toEqual(["a", "m"]);
  });

  it("evaluates exists, contains, notContains and jsonKey checks", () => {
    const project = newDir("pf-release-checks-");
    mkdirSync(join(project, "sub"));
    writeFileSync(join(project, "sub", "f.txt"), "\uFEFFhello -WindowStyle Hidden");
    writeFileSync(join(project, ".forge.json"), JSON.stringify({ modelRouting: { default: "m1" } }));
    const ok = (c) => evaluateFileCheck(project, c).ok;
    expect(ok({ path: "sub/f.txt" })).toBe(true);
    expect(ok({ path: "missing.txt" })).toBe(false);
    expect(ok({ path: "sub/f.txt", contains: "-WindowStyle Hidden" })).toBe(true);
    expect(ok({ path: "sub/f.txt", notContains: "E:\\GitHub" })).toBe(true);
    expect(ok({ path: "missing.txt", notContains: "x" })).toBe(false);
    expect(ok({ path: ".forge.json", jsonKey: "modelRouting.default", equals: "m1" })).toBe(true);
    expect(evaluateFileCheck(project, { path: ".forge.json", jsonKey: "modelRouting.default", equals: "m2" }))
      .toEqual({ ok: false, detail: "m1" });
  });
});

describe("tags (#128)", () => {
  let repo;
  let commits;
  // Every git command here runs with an identity: an annotated tag needs one as a commit does, and a CI runner has
  // none, so the tag in beforeAll threw there, the suite never started and its five tests were skipped (#436).
  const identity = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (args, cwd = repo) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...identity } }).trim();
  const commit = (msg) => {
    git(["commit", "-q", "--allow-empty", "-m", msg]);
    return git(["rev-parse", "HEAD"]);
  };

  beforeAll(() => {
    const origin = newDir("pf-origin-");
    git(["init", "-q", "--bare"], origin);
    repo = newDir("pf-repo-");
    git(["init", "-q"]);
    git(["remote", "add", "origin", origin]);
    commits = { a: commit("3.9.0"), b: commit("3.10.0"), c: commit("3.10.1") };
    git(["tag", "v3.9.0", commits.a]);
    git(["tag", "-a", "v3.10.0", "-m", "rel", commits.b]);
    git(["tag", "v3.10.1-rc.1", commits.c]);
    git(["push", "-q", "origin", "--tags"]);
  });

  it("previousTag picks the highest clean tag below the version", () => {
    expect(previousTag(repo, "3.10.1")).toBe("v3.10.0");
    expect(previousTag(repo, "3.10.0")).toBe("v3.9.0");
    expect(() => previousTag(repo, "3.0.0")).toThrow(/no release tag below/);
  });

  it("passes a new version, and a re-run whose tag already points at the release commit", () => {
    const fresh = quiet();
    checkTagCollision(fresh, repo, "3.10.1", commits.c);
    expect(fresh.failed, fresh.lines.join("\n")).toBe(0);
    const rerun = quiet();
    checkTagCollision(rerun, repo, "3.10.0", commits.b);
    expect(rerun.failed, rerun.lines.join("\n")).toBe(0);
  });

  it("fails when the tag exists on origin at another commit (annotated tags peeled)", () => {
    const checks = quiet();
    checkTagCollision(checks, repo, "3.10.0", commits.c);
    expect(checks.failed).toBe(1);
    expect(checks.lines.join("\n")).toContain(`origin v3.10.0 is ${commits.b.slice(0, 8)}`);
  });

  it("fails a retrograde release below what origin already has", () => {
    const checks = quiet();
    checkTagCollision(checks, repo, "3.9.5", commits.c);
    expect(checks.lines.find((l) => l.includes("newer than every release tag"))).toMatch(/^FAIL.*origin has v3\.10\.0/);
  });

  it("notes and skips the check when origin is unreachable", () => {
    const lonely = newDir("pf-noremote-");
    git(["init", "-q"], lonely);
    const checks = quiet();
    checkTagCollision(checks, lonely, "1.0.0", "x");
    expect(checks.failed).toBe(0);
    expect(checks.lines[0]).toMatch(/origin unreachable/);
  });
});

// ─── The installed suite (#457) ─────────────────────────────────────────────

// A vitest JSON report as the rehearsal reads it, for a project the rehearsal installed under a temp directory.
const installedPath = (relative) => `D:\\a\\_temp\\release-rehearsal\\fresh-ps\\pforge-mcp\\${relative.replace(/\//g, "\\")}`;
const testOf = (title, status, ancestorTitles = []) => ({
  ancestorTitles, title, status, fullName: [...ancestorTitles, title].join(" "),
  failureMessages: status === "failed" ? ["AssertionError: expected 1 to deeply equal 2\n    at somewhere"] : [],
});
const fileOf = (relative, tests) => ({
  name: installedPath(relative), status: tests.some((t) => t.status === "failed") ? "failed" : "passed", message: "", assertionResults: tests,
});
const reportOf = (files, counts = {}) => {
  const all = files.flatMap((f) => f.assertionResults);
  return {
    numTotalTests: all.length,
    numFailedTests: all.filter((t) => t.status === "failed").length,
    numFailedTestSuites: files.filter((f) => f.status === "failed").length,
    ...counts,
    testResults: files,
  };
};

describe("summarizeInstalledSuite (#457)", () => {
  it("says only the count for a suite that passes, and does not list skipped or todo tests", () => {
    const report = reportOf([fileOf("tests/a.test.mjs", [testOf("works", "passed", ["a"]), testOf("later", "skipped", ["a"]), testOf("someday", "todo", ["a"])])]);
    expect(summarizeInstalledSuite(report)).toEqual({ ok: true, detail: "0 failed of 3" });
  });

  it("names the failed test: its file, its suites and its title, joined by >", () => {
    const report = reportOf([
      fileOf("tests/cost-service.test.mjs", [
        testOf("prices a plan", "passed", ["cost-service"]),
        testOf("estimatePlan matches buildEstimate — with quorum config enabled", "failed", ["cost-service: estimatePlan regression", "with a quorum"]),
      ]),
    ]);
    expect(summarizeInstalledSuite(report)).toEqual({
      ok: false,
      detail: "1 failed of 2: tests/cost-service.test.mjs > cost-service: estimatePlan regression > with a quorum > estimatePlan matches buildEstimate — with quorum config enabled",
    });
  });

  it("names the failed tests of each file, in the order the report has them", () => {
    const report = reportOf([
      fileOf("tests/a.test.mjs", [testOf("one", "failed", ["a"]), testOf("two", "passed", ["a"])]),
      fileOf("tests/b.test.mjs", [testOf("three", "failed", ["b"])]),
    ]);
    expect(summarizeInstalledSuite(report).detail).toBe("2 failed of 3: tests/a.test.mjs > a > one; tests/b.test.mjs > b > three");
  });

  it("reads a Windows path and a POSIX path the same way", () => {
    const windows = fileOf("tests/a.test.mjs", [testOf("fails", "failed", ["a"])]);
    const posix = { ...windows, name: "/home/runner/work/_temp/release-rehearsal/fresh-ps/pforge-mcp/tests/a.test.mjs" };
    expect(summarizeInstalledSuite(reportOf([windows])).detail).toBe("1 failed of 1: tests/a.test.mjs > a > fails");
    expect(summarizeInstalledSuite(reportOf([posix])).detail).toBe("1 failed of 1: tests/a.test.mjs > a > fails");
  });

  it("lists at most eight failed tests and counts the rest", () => {
    const many = Array.from({ length: 11 }, (_, index) => testOf(`case ${index + 1}`, "failed", ["s"]));
    const { detail } = summarizeInstalledSuite(reportOf([fileOf("tests/many.test.mjs", many)]));
    expect(detail.startsWith("11 failed of 11: tests/many.test.mjs > s > case 1; ")).toBe(true);
    expect(detail).toContain("tests/many.test.mjs > s > case 8");
    expect(detail).not.toContain("case 9");
    expect(detail.endsWith("; and 3 more")).toBe(true);
  });

  it("does not count the rest when exactly eight failed", () => {
    const eight = Array.from({ length: 8 }, (_, index) => testOf(`case ${index + 1}`, "failed", ["s"]));
    const { detail } = summarizeInstalledSuite(reportOf([fileOf("tests/eight.test.mjs", eight)]));
    expect(detail).toContain("case 8");
    expect(detail).not.toContain("more");
  });

  it("puts a title with line breaks and tabs on one line", () => {
    const { detail } = summarizeInstalledSuite(reportOf([fileOf("tests/lines.test.mjs", [testOf("first line\r\n   second\tline\nthird", "failed", ["s"])])]));
    expect(detail).toBe("1 failed of 1: tests/lines.test.mjs > s > first line second line third");
  });

  it("drops the whitespace a title ends with", () => {
    const { detail } = summarizeInstalledSuite(reportOf([fileOf("tests/trim.test.mjs", [testOf("trailing \n\t", "failed", ["s"])])]));
    expect(detail).toBe("1 failed of 1: tests/trim.test.mjs > s > trailing");
  });

  it("cuts a long title to 160 characters and ends it with an ellipsis", () => {
    const long = `a ${"very ".repeat(80)}long title`;
    const { detail } = summarizeInstalledSuite(reportOf([fileOf("tests/long.test.mjs", [testOf(long, "failed", ["s"])])]));
    const entry = detail.slice("1 failed of 1: ".length);
    expect(entry).toHaveLength(160);
    expect(entry.endsWith("…")).toBe(true);
    expect(entry.startsWith("tests/long.test.mjs > s > a very very")).toBe(true);
  });

  it("keeps an entry of exactly 160 characters whole, and cuts one of 161", () => {
    const entryFor = (length) => {
      const prefix = "tests/edge.test.mjs > s > ";
      return summarizeInstalledSuite(reportOf([fileOf("tests/edge.test.mjs", [testOf("x".repeat(length - prefix.length), "failed", ["s"])])])).detail.slice("1 failed of 1: ".length);
    };
    expect(entryFor(160)).toBe(`tests/edge.test.mjs > s > ${"x".repeat(160 - 26)}`);
    expect(entryFor(161)).toBe(`tests/edge.test.mjs > s > ${"x".repeat(160 - 27)}…`);
  });

  it("falls back to the full name of a test the report gives no ancestor titles for", () => {
    const bare = { title: "only a title", status: "failed", fullName: "suite only a title", failureMessages: [] };
    expect(summarizeInstalledSuite(reportOf([fileOf("tests/bare.test.mjs", [bare])])).detail).toBe("1 failed of 1: tests/bare.test.mjs > suite only a title");
  });

  it("names a file that failed to load, with the first line of its message", () => {
    const broken = { name: installedPath("tests/broken.test.mjs"), status: "failed", message: "SyntaxError: Unexpected token\n    at wrapSafe (node:internal/modules/cjs/loader:1)", assertionResults: [] };
    expect(summarizeInstalledSuite(reportOf([broken]))).toEqual({ ok: false, detail: "0 failed of 0: tests/broken.test.mjs: SyntaxError: Unexpected token" });
  });

  it("names a file that failed to load and has no message", () => {
    const broken = { name: installedPath("tests/silent.test.mjs"), status: "failed", message: "", assertionResults: [] };
    expect(summarizeInstalledSuite(reportOf([broken])).detail).toBe("0 failed of 0: tests/silent.test.mjs");
  });

  it("fails a suite that failed with every test passing, and says so instead of reading 0 failed", () => {
    const report = { numTotalTests: 5, numFailedTests: 0, numFailedTestSuites: 2, testResults: [] };
    expect(summarizeInstalledSuite(report)).toEqual({ ok: false, detail: "0 failed of 5, 2 suites failed, none named (see the vitest report)" });
    expect(summarizeInstalledSuite({ ...report, numFailedTestSuites: 1 }).detail).toBe("0 failed of 5, 1 suite failed, none named (see the vitest report)");
  });

  it("says when tests failed that the report does not name", () => {
    const report = { numTotalTests: 9, numFailedTests: 3, numFailedTestSuites: 0, testResults: [{ name: installedPath("tests/a.test.mjs"), status: "failed", message: "", assertionResults: [] }] };
    expect(summarizeInstalledSuite(report).detail).toBe("3 failed of 9: tests/a.test.mjs");
    expect(summarizeInstalledSuite({ ...report, testResults: [] })).toEqual({ ok: false, detail: "3 failed of 9, none named (see the vitest report)" });
  });

  it("has no report to read when vitest wrote none, or wrote something without the three counts", () => {
    for (const report of [null, undefined, "x", 3, {}, { numTotalTests: 1 }, { numFailedTests: 0 }, { numTotalTests: 1, numFailedTests: 0 }, { numTotalTests: "1", numFailedTests: 0, numFailedTestSuites: 0 }]) {
      expect(summarizeInstalledSuite(report), String(JSON.stringify(report))).toEqual({ ok: false, detail: "no vitest report (see log)" });
    }
  });
});

describe("the rehearsal reports the installed suite through summarizeInstalledSuite (#457)", () => {
  const rehearse = readFileSync(join(REPO_ROOT, "scripts/release/rehearse.mjs"), "utf8");

  it("takes the verdict and the detail of each installed suite's check from the summary", () => {
    expect(rehearse).toMatch(/import\s*\{[^}]*\bsummarizeInstalledSuite\b[^}]*\}\s*from\s*"\.\/harness\.mjs"/);
    expect(rehearse).toMatch(/summarizeInstalledSuite\(/);
    expect(rehearse).toMatch(/installed pforge-mcp test suite passes`,\s*\w+\.ok,\s*\w+\.detail/);
  });

  it("keeps no list of failed files of its own, which named no test", () => {
    expect(rehearse).not.toContain("failedFiles");
    expect(rehearse).not.toContain("MAX_FAILED_FILES_LISTED");
  });
});

describe("the rehearsal workflow keeps the vitest reports of a failed run (#457)", () => {
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/release-rehearsal.yml"), "utf8").replace(/\r\n/g, "\n");
  const rehearse = readFileSync(join(REPO_ROOT, "scripts/release/rehearse.mjs"), "utf8");

  /** The `path:` lines of the step that uploads `artifact`: they end at the first blank line. */
  function uploadedPaths(artifact) {
    const start = workflow.indexOf(`name: ${artifact}`);
    if (start < 0) return [];
    const block = workflow.slice(start).split("\n\n")[0];
    return block.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("${{ runner.temp }}"));
  }

  it("uploads results.txt, the logs and the vitest report of each installed suite", () => {
    expect(uploadedPaths("release-rehearsal-logs")).toEqual([
      "${{ runner.temp }}/release-rehearsal/results.txt",
      "${{ runner.temp }}/release-rehearsal/*.log",
      "${{ runner.temp }}/release-rehearsal/*-vitest.json",
    ]);
  });

  it("is looking for the file name the rehearsal writes", () => {
    expect(rehearse).toContain("`${tag}-vitest.json`");
  });
});
