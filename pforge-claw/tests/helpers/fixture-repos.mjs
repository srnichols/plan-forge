import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeGh } from "./fake-pforge.mjs";

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = path.join(HELPER_DIR, "fake-project-mcp.mjs");

async function removeWithRetry(target) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code) || attempt >= 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

function runGit(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`git ${args[0]} failed (${code}): ${stderr.slice(0, 2000)}`));
      else resolve(stdout);
    });
  });
}

/**
 * Create isolated bare origins and main-branch clones for smoke fixtures.
 * @param {number} count
 * @param {{directory?:string}} options
 * @returns {Promise<{directory:string,projects:Array<object>,cleanup:Function}>}
 */
export async function createFixtureRepos(count = 3, {
  directory,
  withForge = false,
  ghShim = false,
  visibility,
} = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("fixture count must be 1..10");
  const root = directory ?? await mkdtemp(path.join(os.tmpdir(), "claw-fixtures-"));
  await mkdir(root, { recursive: true });
  const projects = [];
  const ownedPaths = [];
  let gh;
  try {
    for (let index = 1; index <= count; index += 1) {
      const id = `fixture-${index}`;
      const originPath = path.join(root, `${id}-origin.git`);
      const repoPath = path.join(root, id);
      const logPath = path.join(root, `${id}-mcp-calls.jsonl`);
      ownedPaths.push(originPath, repoPath, logPath);
      await runGit(["init", "--bare", "--initial-branch=main", originPath]);
      await runGit(["clone", originPath, repoPath]);
      await runGit(["config", "init.defaultBranch", "main"], { cwd: repoPath });
      await runGit(["config", "user.name", `Fixture ${index}`], { cwd: repoPath });
      await runGit(["config", "user.email", `fixture-${index}@example.com`], { cwd: repoPath });
      await mkdir(path.join(repoPath, "docs", "plans"), { recursive: true });
      await mkdir(path.join(repoPath, ".vscode"), { recursive: true });
      await writeFile(path.join(repoPath, "docs", "plans", "Phase-1-DEMO-PLAN.md"),
        `# Fixture plan ${index}\n\nA deterministic smoke-test plan.\n`);
      await writeFile(path.join(repoPath, ".vscode", "mcp.json"), JSON.stringify({
        servers: {
          "plan-forge": {
            command: process.execPath,
            args: [FAKE_MCP, "--log", logPath],
          },
        },
      }, null, 2));
      if (withForge) {
        await mkdir(path.join(repoPath, ".forge"), { recursive: true });
        await writeFile(path.join(repoPath, ".forge.json"), JSON.stringify({ v: 1 }, null, 2));
        await writeFile(path.join(repoPath, ".forge", "fm-prefs.json"), JSON.stringify({ v: 1 }, null, 2));
        await writeFile(path.join(repoPath, "docs", "plans", "Phase-2-FIXTURE-PLAN.md"),
          "# Fixture plan\n\n## Slices\n\n### Slice 1 - Fixture validation\n\nVerify the fixture repository.\n");
      }
      await runGit(["add", "docs/plans/Phase-1-DEMO-PLAN.md", ".vscode/mcp.json"], { cwd: repoPath });
      if (withForge) {
        await runGit(["add", ".forge.json", ".forge/fm-prefs.json", "docs/plans/Phase-2-FIXTURE-PLAN.md"], { cwd: repoPath });
      }
      await runGit(["commit", "-m", `fixture ${index}`], { cwd: repoPath });
      await runGit(["push", "-u", "origin", "main"], { cwd: repoPath });
      projects.push({ id, originPath, repoPath, logPath, ...(visibility ? { visibility } : {}) });
    }
    if (ghShim) {
      gh = await createFakeGh({
        directory: path.join(root, "fake-gh"),
        logPath: path.join(root, "fake-gh-calls.jsonl"),
      });
    }
  } catch (error) {
    if (!directory) await removeWithRetry(root);
    else {
      for (const target of ownedPaths) await removeWithRetry(target);
      if (ghShim) await removeWithRetry(path.join(root, "fake-gh"));
    }
    throw error;
  }
  let cleaned = false;
  return {
    directory: root,
    projects,
    ...(gh ? { ghShim: gh } : {}),
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (!directory) {
        await removeWithRetry(root);
        return;
      }
      for (const target of ownedPaths) await removeWithRetry(target);
      if (gh) {
        await removeWithRetry(path.join(root, "fake-gh"));
        await removeWithRetry(path.join(root, "fake-gh-calls.jsonl"));
      }
    },
  };
}
