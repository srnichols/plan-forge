import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = path.join(HELPER_DIR, "fake-project-mcp.mjs");

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
export async function createFixtureRepos(count = 3, { directory } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("fixture count must be 1..10");
  const root = directory ?? await mkdtemp(path.join(os.tmpdir(), "claw-fixtures-"));
  await mkdir(root, { recursive: true });
  const projects = [];
  try {
    for (let index = 1; index <= count; index += 1) {
      const id = `fixture-${index}`;
      const originPath = path.join(root, `${id}-origin.git`);
      const repoPath = path.join(root, id);
      const logPath = path.join(root, `${id}-mcp-calls.jsonl`);
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
      await runGit(["add", "docs/plans/Phase-1-DEMO-PLAN.md", ".vscode/mcp.json"], { cwd: repoPath });
      await runGit(["commit", "-m", `fixture ${index}`], { cwd: repoPath });
      await runGit(["push", "-u", "origin", "main"], { cwd: repoPath });
      projects.push({ id, originPath, repoPath, logPath });
    }
  } catch (error) {
    if (!directory) await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    directory: root,
    projects,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
