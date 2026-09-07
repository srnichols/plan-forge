import { cp, lstat, mkdir, readdir, readlink, stat, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const TRANSIENT_DIRECTORIES = ["worktrees", "worktrees-archive", "runs", "traces"]
  .map((name) => join(".forge", name));

class WorktreeInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorktreeInputError";
  }
}

function isInside(root, candidate) {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isTransient(projectDir, source) {
  const path = relative(projectDir, source);
  return path.split(sep).includes(".git")
    || TRANSIENT_DIRECTORIES.some((directory) => path === directory || path.startsWith(`${directory}${sep}`));
}

async function copyLocalLink({ projectDir, worktreePath, source, destination }) {
  const target = resolve(dirname(source), await readlink(source));
  if (!isInside(projectDir, target)) {
    throw new WorktreeInputError(`Ignored input links outside the project: ${relative(projectDir, source)}. Install dependencies locally before isolated execution.`);
  }
  const isolatedTarget = join(worktreePath, relative(projectDir, target));
  const targetStat = await stat(source);
  const linkType = targetStat.isDirectory() ? (process.platform === "win32" ? "junction" : "dir") : "file";
  await mkdir(dirname(destination), { recursive: true });
  await symlink(isolatedTarget, destination, linkType);
}

async function copyInputEntry({ projectDir, worktreePath, source, destination, abortSignal }) {
  abortSignal?.throwIfAborted();
  if (isTransient(projectDir, source)) return;
  if (isInside(source, worktreePath)) {
    await mkdir(destination, { recursive: true });
    for (const name of await readdir(source)) {
      await copyInputEntry({
        projectDir, worktreePath, abortSignal,
        source: join(source, name), destination: join(destination, name),
      });
    }
    return;
  }
  await cp(source, destination, {
    recursive: true,
    force: false,
    verbatimSymlinks: true,
    async filter(entry, target) {
      abortSignal?.throwIfAborted();
      if (isTransient(projectDir, entry)) return false;
      if (!(await lstat(entry)).isSymbolicLink()) return true;
      await copyLocalLink({ projectDir, worktreePath, source: entry, destination: target });
      return false;
    },
  });
}

/**
 * Copy Git-ignored runtime inputs without sharing writable dependency directories.
 * @param {{ projectDir: string, worktreePath: string, ignoredPaths: string[], abortSignal?: AbortSignal }} options
 * @returns {Promise<void>}
 */
export async function copyWorktreeInputs({ projectDir, worktreePath, ignoredPaths, abortSignal }) {
  for (const path of ignoredPaths) {
    abortSignal?.throwIfAborted();
    const source = resolve(projectDir, path);
    if (!isInside(projectDir, source)) throw new WorktreeInputError("Ignored input escapes the project directory.");
    const destination = join(worktreePath, relative(projectDir, source));
    await copyInputEntry({ projectDir, worktreePath, source, destination, abortSignal });
  }
}
