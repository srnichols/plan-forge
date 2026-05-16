/**
 * sandbox-repo.mjs — Creates an isolated git repository in a tmpdir for tests.
 *
 * ## Why this exists (Issue #176)
 *
 * When integration tests call `runPlan()` without a proper git repo in `cwd`,
 * git commands (e.g. `git rev-parse HEAD`, `git push`) walk up the filesystem
 * tree until they find the *operator's* `.git` directory. This lets worker
 * subprocesses (gh-copilot, claude, codex) accidentally operate on the real
 * repo — two historical incidents resulted in the worker committing and pushing
 * to `origin/master` from within a test.
 *
 * By initialising a fresh git repo in the tmpDir (`git init` + empty commit),
 * all git operations performed by the worker stay within the sandbox. A `git
 * push` attempt inside the sandbox fails with "no remote" instead of silently
 * pushing to the operator's upstream.
 *
 * ## Usage
 *
 *   import { withSandboxRepo } from "./helpers/sandbox-repo.mjs";
 *
 *   describe("my suite", () => {
 *     let sandbox;
 *     beforeEach(() => { sandbox = withSandboxRepo(); });
 *     afterEach(()  => { sandbox.cleanup(); });
 *
 *     it("runs plan safely", async () => {
 *       const planPath = sandbox.writePlan("plan.md", content);
 *       const result = await runPlan(planPath, { cwd: sandbox.dir, dryRunWorker: true });
 *       expect(result.status).not.toBe("error");
 *     });
 *   });
 *
 * @module sandbox-repo
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * @typedef {object} SandboxRepo
 * @property {string} dir             - Absolute path to the isolated tmpdir git repo.
 * @property {(name?: string, content?: string) => string} writePlan
 *   Write a minimal Plan Forge plan file into the sandbox; returns the full path.
 * @property {() => void} cleanup     - Remove the tmpdir (call in afterEach / finally).
 */

const SANDBOX_PREFIX = "pforge-sandbox-";

/**
 * Minimal safe git identity for the sandbox repo — avoids interactive prompts
 * and ensures commits succeed even in environments without global git config.
 */
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "pforge-sandbox",
  GIT_AUTHOR_EMAIL: "sandbox@pforge.test",
  GIT_COMMITTER_NAME: "pforge-sandbox",
  GIT_COMMITTER_EMAIL: "sandbox@pforge.test",
  GIT_TERMINAL_PROMPT: "0",
};

/**
 * Create an isolated tmpdir containing an initialised git repository with one
 * empty commit.  Worker subprocesses spawned with `cwd: sandbox.dir` cannot
 * escape to the operator's repository because the sandbox has its own `.git`.
 *
 * @param {string} [prefix] - Optional prefix appended to the tmpdir name.
 * @returns {SandboxRepo}
 */
export function withSandboxRepo(prefix = "") {
  const dir = mkdtempSync(join(tmpdir(), `${SANDBOX_PREFIX}${prefix}`));

  // Initialise a real git repo so git commands stay inside the sandbox.
  const gitOpts = { cwd: dir, env: GIT_ENV, stdio: "pipe" };
  execSync("git init", gitOpts);
  execSync('git commit --allow-empty -m "sandbox: initial"', gitOpts);

  return {
    dir,

    /**
     * Write a minimal single-slice plan file into the sandbox and return its
     * absolute path.  Suitable for tests that need a non-zero-slice plan to
     * exercise the full runPlan() scheduler path.
     *
     * @param {string} [name="plan.md"]   - Filename relative to sandbox dir.
     * @param {string} [content]           - Override default plan content.
     * @returns {string} Absolute path to the written plan file.
     */
    writePlan(name = "plan.md", content) {
      const body = content ??
        "---\ncrucibleId: sandbox-test\n---\n# Sandbox Test Plan\n\n### Slice 1: Test\n\nTask.\n";
      const path = join(dir, name);
      writeFileSync(path, body, "utf-8");
      return path;
    },

    /** Remove the sandbox tmpdir. Always call in afterEach / finally. */
    cleanup() {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          rmSync(dir, { recursive: true, force: true });
          return;
        } catch (err) {
          if (err.code !== "EPERM" && err.code !== "EBUSY") throw err;
          // Brief spin to let the OS release file handles (Windows EPERM fix).
          const end = Date.now() + 50;
          while (Date.now() < end) { /* spin */ }
        }
      }
      // Best-effort on final failure; CI will GC the tmpdir eventually.
    },
  };
}
