#!/usr/bin/env node
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FAKE_PR_URL = ["https://example", ".invalid/pr/1"].join("");

function run(command, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`fake command failed (${code}): ${stderr.slice(0, 2000)}`)));
  });
}

async function waitForFile(file) {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  try {
    await stat(file);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const { watch } = await import("node:fs");
  await new Promise((resolve, reject) => {
    const watcher = watch(directory, async () => {
      try {
        await stat(file);
        watcher.close();
        resolve();
      } catch (error) {
        if (error.code !== "ENOENT") {
          watcher.close();
          reject(error);
        }
      }
    });
    watcher.once("error", (error) => {
      watcher.close();
      reject(error);
    });
  });
}

async function runPlan(args) {
  const root = process.env.PFORGE_CLAW_FIXTURE_ROOT;
  const cwd = process.cwd();
  const relative = root ? path.relative(path.resolve(root), path.resolve(cwd)) : "..";
  if (!root || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    process.stderr.write("FAKE_PFORGE_OUTSIDE_FIXTURE\n");
    return 2;
  }
  const mcpFile = path.join(cwd, ".vscode", "mcp.json");
  try {
    await readFile(mcpFile, "utf8");
  } catch {
    process.stderr.write("FAKE_PFORGE_FIXTURE_INVALID\n");
    return 2;
  }
  const options = new Map();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith("--")) options.set(args[index], args[index + 1] ?? "");
  }
  if (options.has("--fail")) return Number(options.get("--fail")) || 1;
  const runId = "fixture-run-1";
  const runPath = path.join(cwd, ".forge", "runs", runId);
  await mkdir(runPath, { recursive: true });
  const events = path.join(runPath, "events.jsonl");
  await writeFile(events, `${JSON.stringify({ type: "started", plan: args[0] ?? null })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "progress", progress: 0.25 })}\n`);
  if (options.has("--gate")) await waitForFile(options.get("--gate"));
  if (options.has("--delay")) await new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(options.get("--delay")) || 0));
  });
  await appendFile(events, `${JSON.stringify({ type: "progress", progress: 1 })}\n`);
  await appendFile(events, `${JSON.stringify({ type: "completed" })}\n`);
  await run("git", ["add", ".forge/runs"], { cwd });
  await run("git", ["commit", "-m", "fixture plan run"], { cwd });
  process.stdout.write(`${JSON.stringify({ type: "completed", runId })}\n`);
  return 0;
}

async function fixtureProject() {
  const root = process.env.PFORGE_CLAW_FIXTURE_ROOT;
  const cwd = process.cwd();
  const relative = root ? path.relative(path.resolve(root), path.resolve(cwd)) : "..";
  if (!root || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("FAKE_PFORGE_OUTSIDE_FIXTURE");
  }
  try {
    await readFile(path.join(cwd, ".vscode", "mcp.json"), "utf8");
  } catch {
    throw new Error("FAKE_PFORGE_FIXTURE_INVALID");
  }
  return cwd;
}

async function writeFixtureArtifact(name, record) {
  const cwd = await fixtureProject();
  const artifactPath = path.join(cwd, ".forge", "e2e", name);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(record)}\n`);
}

async function handleCommand(command, args) {
  if (command === "run-plan" || command === "run") return runPlan(args);
  if (command === "bootstrap") {
    await writeFixtureArtifact("bootstrap.json", { ok: true, args });
    process.stdout.write(`${JSON.stringify({ type: "bootstrapped" })}\n`);
    return 0;
  }
  if (command === "resume") {
    await writeFixtureArtifact("resume.json", { ok: true, runId: args[0] ?? null });
    process.stdout.write(`${JSON.stringify({ type: "resumed", runId: args[0] ?? null })}\n`);
    return 0;
  }
  if (command === "abort") {
    await writeFixtureArtifact("abort.json", { ok: true, runId: args[0] ?? null });
    process.stdout.write(`${JSON.stringify({ type: "aborted", runId: args[0] ?? null })}\n`);
    return 0;
  }
  if (command === "memory" && args[0] === "drain") {
    await writeFixtureArtifact("memory-drain.json", { ok: true });
    process.stdout.write(`${JSON.stringify({ type: "memory-drained" })}\n`);
    return 0;
  }
  return 2;
}

export async function createFakeGh({ logPath, directory } = {}) {
  const targetDir = directory ?? await mkdtemp(path.join(os.tmpdir(), "claw-fake-gh-"));
  await mkdir(targetDir, { recursive: true });
  if (logPath) await mkdir(path.dirname(logPath), { recursive: true });
  const scriptPath = path.join(targetDir, "fake-gh-runtime.mjs");
  const body = `#!/usr/bin/env node
import { appendFile } from "node:fs/promises";
const args = process.argv.slice(2);
if (process.env.PFORGE_CLAW_GH_LOG) await appendFile(process.env.PFORGE_CLAW_GH_LOG, JSON.stringify({ args }) + "\\n");
if (args[0] === "pr" && args[1] === "create") process.stdout.write(${JSON.stringify(FAKE_PR_URL)} + "\\n");
`;
  await writeFile(scriptPath, body, { mode: 0o700 });
  return {
    command: [process.execPath, scriptPath],
    ...(logPath ? { env: { PFORGE_CLAW_GH_LOG: logPath } } : {}),
    path: scriptPath,
    cleanup: directory ? undefined : () => rm(targetDir, { recursive: true, force: true }),
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    return await handleCommand(command, args);
  } catch (error) {
    process.stderr.write(`${error.code ?? "FAKE_PFORGE_FAILED"}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
