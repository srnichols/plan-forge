import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { isInside, realpathNearest, resolveCommand, resolvePforgeCommand, run } from "./worktree.mjs";

const OUTPUT_LIMIT = 64 * 1024;
const SECRET_RELATIVE = path.join(".forge", "secrets.json").toLowerCase();
export const COPYSET_MAX_BYTES = 1024 * 1024;
export const DEFAULT_COPY_PATHS = Object.freeze([".forge.json", ".forge/fm-prefs.json"]);

function installMode(config) {
  return config?.bootstrap?.install ?? "none";
}

export function validateCopyEntry(entry) {
  if (typeof entry !== "string" || !entry || path.isAbsolute(entry)
    || path.win32.isAbsolute(entry) || /^[a-z]:/i.test(entry) || entry.split(/[\\/]/).includes("..")) {
    throw new ClawError("BOOTSTRAP_COPY_INVALID");
  }
  const normalizedEntry = entry.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".").join("/").toLowerCase();
  if (normalizedEntry === ".forge/secrets.json") {
    throw new ClawError("BOOTSTRAP_SECRET_COPY_REFUSED");
  }
  if (!normalizedEntry) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  return entry.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".").join("/");
}

async function copyTarget(repoPath, entry) {
  const relative = validateCopyEntry(entry);
  const target = path.resolve(repoPath, ...relative.split("/"));
  if (!(await isInside(repoPath, target))) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  const resolved = await realpath(target);
  validateCopyEntry(path.relative(await realpath(repoPath), resolved));
  return { relative, target: resolved };
}

export async function collectCopySet({ repoPath, paths = DEFAULT_COPY_PATHS, maxBytes = COPYSET_MAX_BYTES }) {
  if (!Array.isArray(paths) || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  const files = [];
  let bytes = 0;
  for (const entry of paths) {
    try {
      const { relative, target } = await copyTarget(repoPath, entry);
      const metadata = await stat(target);
      if (!metadata.isFile()) throw new ClawError("BOOTSTRAP_COPY_INVALID");
      if (bytes + metadata.size > maxBytes) throw new ClawError("CLAW_COPYSET_TOO_LARGE");
      const content = await readFile(target);
      bytes += content.length;
      if (bytes > maxBytes) throw new ClawError("CLAW_COPYSET_TOO_LARGE");
      files.push({ path: relative, content: content.toString("base64") });
    } catch (error) {
      if (error.code === "ENOENT") throw new ClawError("CLAW_COPYSET_MISSING");
      throw error;
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export async function applyCopySet({ repoPath, files, maxBytes = COPYSET_MAX_BYTES }) {
  if (!Array.isArray(files) || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  let bytes = 0;
  const seen = new Set();
  const decoded = [];
  for (const file of files) {
    const relative = validateCopyEntry(file?.path);
    if (seen.has(relative) || typeof file.content !== "string") throw new ClawError("BOOTSTRAP_COPY_INVALID");
    seen.add(relative);
    const content = Buffer.from(file.content, "base64");
    if (content.toString("base64") !== file.content) throw new ClawError("BOOTSTRAP_COPY_INVALID");
    bytes += content.length;
    if (bytes > maxBytes) throw new ClawError("CLAW_COPYSET_TOO_LARGE");
    const target = path.resolve(repoPath, ...relative.split("/"));
    if (!(await isInside(repoPath, target))) throw new ClawError("BOOTSTRAP_COPY_INVALID");
    validateCopyEntry(path.relative(await realpath(repoPath), await realpathNearest(target)));
    const metadata = await lstat(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (metadata && !metadata.isFile()) throw new ClawError("BOOTSTRAP_COPY_INVALID");
    decoded.push({ target, content });
  }
  for (const { target, content } of decoded) {
    await mkdir(path.dirname(target), { recursive: true });
    if (!(await isInside(repoPath, target))) throw new ClawError("BOOTSTRAP_COPY_INVALID");
    validateCopyEntry(path.relative(await realpath(repoPath), await realpathNearest(target)));
    await writeFile(target, content);
  }
}

async function copyEntry({ sourceRoot, destinationRoot, entry }) {
  validateCopyEntry(entry);
  const source = path.resolve(sourceRoot, entry);
  const destination = path.resolve(destinationRoot, entry);
  if (!(await isInside(sourceRoot, source)) || !(await isInside(destinationRoot, destination))) {
    throw new ClawError("BOOTSTRAP_COPY_INVALID");
  }
  const realSource = await realpath(source);
  if (!(await isInside(sourceRoot, realSource))) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  const relativeReal = path.relative(await realpath(sourceRoot), realSource).toLowerCase();
  if (relativeReal === SECRET_RELATIVE) throw new ClawError("BOOTSTRAP_SECRET_COPY_REFUSED");
  await copyTree(realSource, destination, sourceRoot, destinationRoot);
}

async function copyTree(source, destination, sourceRoot, destinationRoot) {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  if (metadata.isDirectory()) {
    await mkdir(destination, { recursive: true });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(destination, entry.name);
      if (!(await isInside(sourceRoot, sourcePath)) || !(await isInside(destinationRoot, targetPath))) {
        throw new ClawError("BOOTSTRAP_COPY_INVALID");
      }
      if (path.relative(await realpath(sourceRoot), sourcePath).toLowerCase() === SECRET_RELATIVE) continue;
      await copyTree(sourcePath, targetPath, sourceRoot, destinationRoot);
    }
    return;
  }
  if (!metadata.isFile()) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

function safeOutput(value, secrets) {
  let output = String(value ?? "").slice(0, OUTPUT_LIMIT);
  if (typeof secrets?.redact === "function") output = secrets.redact(output);
  return output;
}

async function execute(runner, command, args, options) {
  try {
    return await runner(command, args, options);
  } catch {
    return { code: -1, stdout: "", stderr: "" };
  }
}

export async function bootstrapWorktree({
  job,
  worktree,
  forgeHome,
  homeRepo,
  config = {},
  secrets,
  runner = run,
} = {}) {
  void job;
  const sourceRoot = typeof homeRepo === "string" ? homeRepo : homeRepo?.path;
  const worktreePath = typeof worktree === "string" ? worktree : worktree?.path;
  if (!sourceRoot || !worktreePath) {
    return { ok: false, reason: "bootstrap", step: "copy", code: "BOOTSTRAP_PATH_MISSING" };
  }
  try {
    for (const entry of config.bootstrap?.copy ?? []) {
      try {
        await copyEntry({ sourceRoot, destinationRoot: worktreePath, entry });
      } catch (error) {
        return {
          ok: false,
          reason: "bootstrap",
          step: "copy",
          code: error.code === "ENOENT" ? "BOOTSTRAP_COPY_MISSING" : error.code ?? "BOOTSTRAP_COPY_FAILED",
        };
      }
    }

    const env = { ...process.env };
    for (const name of config.bootstrap?.env ?? []) {
      const value = secrets?.get?.(name);
      if (typeof value !== "string" || !value) {
        return { ok: false, reason: "bootstrap", step: "environment", code: "BOOTSTRAP_SECRET_MISSING" };
      }
      env[name] = value;
    }

    const mode = installMode(config);
    if (mode === "link") {
      const source = path.join(sourceRoot, "node_modules");
      const destination = path.join(worktreePath, "node_modules");
      const sourceMetadata = await lstat(source).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!sourceMetadata?.isDirectory()) {
        return { ok: false, reason: "bootstrap", step: "install", code: "BOOTSTRAP_LINK_SOURCE_MISSING" };
      }
      try {
        await lstat(destination);
        return { ok: false, reason: "bootstrap", step: "install", code: "BOOTSTRAP_LINK_CONFLICT" };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await symlink(source, destination, process.platform === "win32" ? "junction" : "dir");
    } else if (mode === "npm-ci" || mode === "ci") {
      const [command, ...prefix] = resolveCommand("npm");
      const installed = await execute(runner, command, [...prefix, "ci"], { cwd: worktreePath, env });
      if (installed.code !== 0) {
        safeOutput(installed.stderr, secrets);
        return { ok: false, reason: "bootstrap", step: "install", code: "BOOTSTRAP_INSTALL_FAILED" };
      }
    } else if (mode !== "none") {
      return { ok: false, reason: "bootstrap", step: "install", code: "BOOTSTRAP_INSTALL_MODE" };
    }

    const pforge = resolvePforgeCommand({ config, cwd: worktreePath });
    const [command, ...prefix] = pforge;
    const result = await execute(runner, command, [...prefix, "smith"], { cwd: worktreePath, env });
    safeOutput(result.stdout, secrets);
    safeOutput(result.stderr, secrets);
    if (result.code !== 0) {
      return { ok: false, reason: "bootstrap", step: "smith", code: "BOOTSTRAP_SMITH_FAILED" };
    }
    void forgeHome;
    return { ok: true, env };
  } catch (error) {
    const code = error instanceof ClawError ? error.code
      : error.code === "ENOENT" ? "BOOTSTRAP_COPY_MISSING" : "BOOTSTRAP_FAILED";
    return { ok: false, reason: "bootstrap", step: "bootstrap", code };
  }
}
