/**
 * #300 / #128 — the release rehearsal harness.
 *
 * The rehearsal itself drives real installers for several minutes and runs in
 * the release-rehearsal workflow; these tests cover its decision logic: argument
 * parsing, version ordering, release-checks.json evaluation, and the tag-collision
 * preflight that would have stopped the 2026-04-28 retrograde re-release.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Checks, checkTagCollision, compareVersions, evaluateFileCheck, parseArgs, previousTag, selectFileChecks,
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
  const git = (args, cwd = repo) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = (msg) => {
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", msg]);
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
