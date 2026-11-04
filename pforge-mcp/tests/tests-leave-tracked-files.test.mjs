/**
 * Running the tests, or the checks the contributor docs name, must leave the tracked files as they were.
 *
 * A change that only ran the suite once showed five modified fixtures, and the per-commit check
 * `node scripts/audit/boyscout-delta.mjs` showed a modified report: the orchestrator commits after a slice, a
 * contributor commits with `git add -A`, and either sweeps that churn into an unrelated commit. The earlier fix
 * for the audit reports (PFORGE_AUDIT_RAW_DIR) left three things open, and this suite holds all of them:
 *
 *   - docs/plans/cleanup-findings/raw/ is ignored, but boyscout-delta-report.json had been committed there by
 *     accident (a run on a clean tree: no files, base and head the same), so the ignore never applied to it.
 *   - CI never looked at the tree after the suite, so a test that rewrote a tracked file passed everywhere.
 *   - smith-golden.test.mjs wrote its golden file when that file was empty. It writes nothing now, and it runs
 *     its testbed comparison only when asked, which CI never does, so the guard above could not have seen it.
 *
 * CI's vitest job also runs for planning/main, where every change lands, and not only for master.
 */

import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const IS_GIT_CHECKOUT = existsSync(join(REPO_ROOT, ".git")) && spawnSync("git", ["--version"]).status === 0;

// What the per-commit check clean-code.instructions.md names writes, to a directory .gitignore already covers.
const PER_COMMIT_REPORTS = Object.freeze(["docs/plans/cleanup-findings/raw/boyscout-delta-report.json"]);

describe.skipIf(!IS_GIT_CHECKOUT)("a report a contributor's own check writes", () => {
  it.each(PER_COMMIT_REPORTS)("%s is ignored and not tracked", (path) => {
    const tracked = execFileSync("git", ["ls-files", "--", path], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    expect(tracked, `${path} is tracked, so every run of the check shows it modified`).toBe("");
    const ignored = spawnSync("git", ["check-ignore", "-q", "--", path], { cwd: REPO_ROOT }).status;
    expect(ignored, `${path} is not covered by .gitignore`).toBe(0);
  });
});

describe("a test that compares with a golden file", () => {
  // smith-golden.test.mjs used to write the golden itself when the file was empty, so a run could change a tracked file.
  const source = readFileSync(join(REPO_ROOT, "pforge-mcp", "tests", "smith-golden.test.mjs"), "utf8");

  it("smith-golden.test.mjs does not write a file", () => {
    expect(source).not.toMatch(/\bwriteFileSync\b|\bwriteFile\b|\bappendFileSync\b/);
  });

  it("smith-golden.test.mjs runs the testbed only when asked, since its golden is one testbed in one tool state", () => {
    expect(source).toContain('process.env.PFORGE_SMITH_GOLDEN === "1"');
    expect(source).toMatch(/const canRun = OPTED_IN &&/);
  });
});

describe("validate.yml's vitest job", () => {
  const workflow = readFileSync(join(REPO_ROOT, ".github", "workflows", "validate.yml"), "utf8").replace(/\r\n/g, "\n");
  const job = workflow.slice(workflow.indexOf("pforge-mcp-tests:"));
  const INSTALL_STEP = "- name: Install dependencies";
  const NOTE_STEP = "- name: Note the tracked files before the suite";
  const SUITE_STEP = "- name: Run vitest (full suite)";
  const GUARD_STEP = "- name: Tests leave tracked files as they found them";

  /** The branches an `on:` event of validate.yml lists, or null when the event is not there. */
  function branchesOf(event) {
    const triggers = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\njobs:"));
    const match = triggers.match(new RegExp(`\\n  ${event}:\\n(?:    #.*\\n)*    branches: \\[([^\\]]*)\\]`));
    return match ? match[1].split(",").map((branch) => branch.trim()) : null;
  }

  it.each(["push", "pull_request"])("runs on %s for planning/main, where every change lands, as well as for master", (event) => {
    const branches = branchesOf(event);
    expect(branches, `validate.yml's ${event} trigger lists no branches`).not.toBeNull();
    expect(branches).toContain("planning/main");
    expect(branches).toContain("master");
  });

  function stepText(name) {
    const start = job.indexOf(name);
    if (start < 0) return "";
    const next = job.indexOf("\n      - ", start + 1);
    return job.slice(start, next < 0 ? undefined : next);
  }

  it("notes the tracked files once the install is done and before the suite, since an install may rewrite a lockfile", () => {
    const install = job.indexOf(INSTALL_STEP);
    const note = job.indexOf(NOTE_STEP);
    const suite = job.indexOf(SUITE_STEP);
    expect(install, "the install step was not found").toBeGreaterThan(-1);
    expect(note, "no step notes the tree before the suite").toBeGreaterThan(install);
    expect(note).toBeLessThan(suite);
    expect(stepText(NOTE_STEP)).toContain("git diff");
  });

  it("has a step after the full suite that fails the build when the suite changed a tracked file", () => {
    const suite = job.indexOf(SUITE_STEP);
    const guard = job.indexOf(GUARD_STEP);
    expect(suite, "the full-suite step was not found").toBeGreaterThan(-1);
    expect(guard, "no step checks the tree after the suite").toBeGreaterThan(suite);
    expect(stepText(GUARD_STEP)).toMatch(/diff -u .*tracked-before.*tracked-after|diff -u .*tracked-after/);
    expect(stepText(GUARD_STEP)).toContain("exit 1");
  });

  it("runs that step even when the suite failed, so a rewrite is reported with the failure", () => {
    expect(stepText(GUARD_STEP)).toContain("if: always()");
  });

  it("runs it only when the tree was noted, so a failed install is not reported as a rewrite", () => {
    expect(stepText(NOTE_STEP)).toContain("id: note");
    expect(stepText(GUARD_STEP)).toContain("steps.note.conclusion == 'success'");
  });
});
