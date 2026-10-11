import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { TERMINAL } from "./model.mjs";
import { applicationIdentity, matchesApplicationAck } from "../protocol/l2-ack.mjs";
import { assertInside, isInside, realpathNearest } from "../path-safety.mjs";

export { assertInside, isInside, realpathNearest };

const MAX_OUTPUT = 64 * 1024;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const NPM_ENTRY_CANDIDATES = [
  path.join(path.dirname(process.execPath), "node_modules", "npm", "bin"),
  path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules", "npm", "bin"),
];
const SHIM_REFUSAL_HINT = "Configure runtimes.ghCommand or runtimes.pforgeCommand with an executable, not a .cmd/.bat shim.";

function appendBounded(current, chunk, limit) {
  const remaining = limit;
  if (remaining <= 0) return current;
  let bytes = Buffer.from(chunk).subarray(0, remaining);
  while (bytes.length && Buffer.byteLength(bytes.toString("utf8")) > remaining) {
    bytes = bytes.subarray(0, bytes.length - 1);
  }
  return current + bytes.toString("utf8");
}

function isBareCommand(cmd, platform) {
  const pathApi = platform === "win32" ? path.win32 : path;
  return !pathApi.isAbsolute(cmd) && !cmd.includes(pathApi.sep)
    && !(platform === "win32" && cmd.includes("/"));
}

function windowsCandidates(cmd, env, exists) {
  const environment = (name) => Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
  const directories = String(environment("PATH") ?? "").split(";").filter(Boolean);
  const configured = String(environment("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .split(";").filter(Boolean).map((extension) => extension.startsWith(".") ? extension : `.${extension}`);
  const safeExtensions = [".EXE", ".COM"];
  const shimExtensions = [".CMD", ".BAT"];
  const candidate = (directory, extension) => path.win32.join(directory, `${cmd}${extension}`);
  const firstMatch = (extensions) => {
    for (const directory of directories) {
      for (const extension of extensions) {
        const match = configured.find((item) => item.toUpperCase() === extension);
        if (match && exists(candidate(directory, match))) return candidate(directory, match);
      }
    }
    return null;
  };
  return { safe: firstMatch(safeExtensions), shim: firstMatch(shimExtensions) };
}

export function resolveCommand(cmd, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (typeof cmd !== "string" || !cmd) throw new ClawError("COMMAND_INVALID");
  if (/\.(?:cmd|bat)$/i.test(cmd)) throw new ClawError("CMD_SHIM_REFUSED", { hint: SHIM_REFUSAL_HINT });
  if (platform === "win32" && ["npm", "npx"].includes(cmd.toLowerCase())) {
    const entry = cmd.toLowerCase() === "npm" ? "npm-cli.js" : "npx-cli.js";
    const executable = NPM_ENTRY_CANDIDATES
      .map((directory) => path.join(directory, entry))
      .find((candidate) => exists(candidate));
    if (!executable) throw new ClawError("NPM_CLI_NOT_FOUND");
    return [process.execPath, executable];
  }
  if (platform === "win32" && isBareCommand(cmd, platform)) {
    const { safe, shim } = windowsCandidates(cmd, env, exists);
    if (safe) return [safe];
    if (shim) {
      throw new ClawError("CMD_SHIM_REFUSED", {
        hint: SHIM_REFUSAL_HINT,
      });
    }
    throw new ClawError("COMMAND_NOT_FOUND");
  }
  return [cmd];
}

export function resolveGhCommand({ config = {} } = {}) {
  const configured = config?.runtimes?.ghCommand ?? "auto";
  if (configured === "auto") return ["gh"];
  if (!Array.isArray(configured) || configured.length === 0
    || configured.some((part) => typeof part !== "string" || !part)) {
    throw new ClawError("CONFIG_INVALID");
  }
  if (/\.(?:cmd|bat)$/i.test(configured[0])) {
    throw new ClawError("CMD_SHIM_REFUSED", { hint: SHIM_REFUSAL_HINT });
  }
  return [...configured];
}

export function resolvePforgeCommand({ config = {}, cwd, platform = process.platform } = {}) {
  const configured = config?.runtimes?.pforgeCommand ?? "auto";
  if (configured === "auto") {
    if (typeof cwd !== "string" || !cwd) throw new ClawError("PFORGE_CWD_REQUIRED");
    return platform === "win32"
      ? ["pwsh", "-NoProfile", "-File", path.join(cwd, "pforge.ps1")]
      : ["bash", path.join(cwd, "pforge.sh")];
  }
  if (!Array.isArray(configured) || configured.length === 0
    || configured.some((part) => typeof part !== "string" || !part)) {
    throw new ClawError("PFORGE_COMMAND_INVALID");
  }
  if (/\.(?:cmd|bat)$/i.test(configured[0])) {
    throw new ClawError("CMD_SHIM_REFUSED", { hint: SHIM_REFUSAL_HINT });
  }
  return [...configured];
}

export function run(cmd, args = [], options = {}) {
  const { cwd, env, signal, timeoutMs, maxOutput = MAX_OUTPUT } = options;
  return new Promise((resolve) => {
    let child;
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    let failure;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      failure ??= new ClawError("JOB_CANCELLED");
      child?.kill();
    };
    try {
      if (signal?.aborted) {
        finish({ code: -1, stdout, stderr, error: new ClawError("JOB_CANCELLED") });
        return;
      }
      const [executable, ...prefix] = resolveCommand(cmd, options);
      child = spawn(executable, [...prefix, ...args], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
      });
      child.stdout?.on("data", (chunk) => {
        stdout = appendBounded(stdout, chunk, maxOutput - Buffer.byteLength(stdout) - Buffer.byteLength(stderr));
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendBounded(stderr, chunk, maxOutput - Buffer.byteLength(stdout) - Buffer.byteLength(stderr));
      });
      child.once("error", (error) => {
        failure ??= error;
        if (!child.pid) finish({ code: -1, stdout, stderr, error: failure });
      });
      child.once("close", (code) => finish({
        code: failure ? -1 : code ?? -1, stdout, stderr, ...(failure ? { error: failure } : {}),
      }));
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => {
          failure = new ClawError("COMMAND_TIMEOUT");
          child.kill();
        }, timeoutMs);
        timer.unref?.();
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    } catch (error) {
      finish({ code: -1, stdout, stderr, error });
    }
  });
}

async function gitTopLevel({ repoPath, runner, env, signal }) {
  signal?.throwIfAborted();
  const result = await runner("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], { env, signal });
  signal?.throwIfAborted();
  if (result.code !== 0) throw new ClawError("GIT_REPO_INVALID");
  return realpath(result.stdout.trim());
}

export async function addWorktree({ home, project, job, runner = run, env, signal } = {}) {
  if (!IDENTIFIER.test(project?.id ?? "") || !IDENTIFIER.test(job?.id ?? "")) {
    throw new ClawError("WORKTREE_BAD_IDENTIFIER");
  }
  const root = path.join(home, "worktrees", project.id);
  const target = path.join(root, job.id);
  await assertInside(root, target);
  const operatorRoot = await gitTopLevel({ repoPath: project.repo.path, runner, env, signal });
  const canonicalTarget = await realpathNearest(target);
  if (await isInside(operatorRoot, canonicalTarget)) throw new ClawError("WORKTREE_IN_OPERATOR_TREE");
  await mkdir(root, { recursive: true });
  try {
    await lstat(target);
    throw new ClawError("WORKTREE_EXISTS");
  } catch (error) {
    if (error instanceof ClawError) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  const branch = `claw/${job.id}`;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    signal?.throwIfAborted();
    const branchExists = await runner("git", ["-C", project.repo.path, "show-ref", "--verify", "--quiet", ref], { env, signal });
    signal?.throwIfAborted();
    if (branchExists.code === 0) throw new ClawError("WORKTREE_EXISTS");
  }
  const result = await runner("git", [
    "-C", project.repo.path, "worktree", "add", "-b", branch, target,
    project.repo.baseBranch ?? "main",
  ], { env, signal });
  signal?.throwIfAborted();
  if (result.code !== 0) throw new ClawError("WORKTREE_ADD_FAILED");
  await writeFile(path.join(target, ".claw-job.json"), JSON.stringify({
    jobId: job.id,
    projectId: project.id,
    createdAt: new Date().toISOString(),
  }));
  return { path: target, branch };
}

export async function removeWorktree({ repoPath, path: worktreePath, runner = run, env, signal } = {}) {
  try {
    signal?.throwIfAborted();
    const result = await runner("git", ["-C", repoPath, "worktree", "remove", "--force", worktreePath], { env, signal });
    return result.code === 0
      ? { ok: true }
      : { ok: false, code: "WORKTREE_REMOVE_FAILED" };
  } catch {
    return { ok: false, code: "WORKTREE_REMOVE_FAILED" };
  }
}

export async function sweepWorktrees({ home, store, now = Date.now, keepHours = 24, runner = run } = {}) {
  const worktreesRoot = path.join(home, "worktrees");
  let projects;
  try {
    projects = await readdir(worktreesRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const jobs = store.fold("jobs", (all, event) => {
    if (event.kind === "job.created") all[event.job.id] = { ...event.job, finishedAt: null };
    if (event.kind === "job.transition" && all[event.jobId]) {
      all[event.jobId] = {
        ...all[event.jobId],
        state: event.to,
        finishedAt: TERMINAL.includes(event.to) ? event.ts ?? all[event.jobId].finishedAt : null,
      };
    }
    return all;
  }, {});
  const removed = [];
  for (const projectEntry of projects) {
    if (!projectEntry.isDirectory()) continue;
    const projectRoot = path.join(worktreesRoot, projectEntry.name);
    for (const jobEntry of await readdir(projectRoot, { withFileTypes: true })) {
      if (!jobEntry.isDirectory()) continue;
      const candidate = path.join(projectRoot, jobEntry.name);
      const marker = await readWorktreeMarker(candidate);
      if (!(await canSweepWorktree({
        candidate, projectId: projectEntry.name, marker, job: jobs[marker?.jobId], store, now, keepHours,
      }))) continue;
      const removedResult = await removeWorktree({ repoPath: candidate, path: candidate, runner });
      if (removedResult.ok) removed.push(candidate);
    }
  }
  return removed;
}

async function readWorktreeMarker(candidate) {
  try {
    return JSON.parse(await readFile(path.join(candidate, ".claw-job.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function containsHistory(candidate) {
  try {
    await lstat(path.join(candidate, ".forge"));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function hasAppliedHistory({ marker, job, store }) {
  try {
    const identity = applicationIdentity(marker.applicationAck);
    if (identity.jobId !== job.id || identity.projectId !== job.projectId
      || marker.applicationAck.ok !== true) return false;
    return [...store.read("audit")].some(({ record }) => record.kind === "job.history-applied"
      && record.applicationAck?.ok === true && matchesApplicationAck(identity, record.applicationAck));
  } catch {
    return false;
  }
}

async function canSweepWorktree({ candidate, projectId, marker, job, store, now, keepHours }) {
  if (!marker || marker.projectId !== projectId || marker.jobId !== path.basename(candidate)
    || !job || !["failed", "cancelled"].includes(job.state) || marker.l2Pending === true) return false;
  const finishedAt = Date.parse(job.finishedAt ?? "");
  if (!Number.isFinite(finishedAt) || now() - finishedAt < keepHours * 60 * 60 * 1000) return false;
  return !(await containsHistory(candidate)) || hasAppliedHistory({ marker, job, store });
}
