import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const WINDOWS_EXECUTABLES = ["copilot.com", "copilot.exe", "copilot.bat", "copilot.cmd"];
const JAVASCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

class CopilotLauncherError extends Error {
  constructor(message) {
    super(message);
    this.name = "CopilotLauncherError";
  }
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function isBootstrapDirectory(path) {
  return basename(path).toLowerCase() === "copilotcli"
    && basename(dirname(path)).toLowerCase() === "github.copilot-chat";
}

async function findExecutable(directory) {
  for (const name of WINDOWS_EXECUTABLES) {
    const candidate = join(directory, name);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

async function readCopilotManifest(packageDir) {
  try {
    return JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function resolvePackageBin(packageDir, manifest) {
  if (manifest?.name !== "@github/copilot") return null;
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.copilot;
  if (typeof bin !== "string" || isAbsolute(bin)) return null;
  const entry = resolve(packageDir, bin);
  const within = relative(packageDir, entry);
  if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) return null;
  return JAVASCRIPT_EXTENSIONS.has(extname(entry)) ? entry : null;
}

async function findNpmEntry(directory) {
  const packageDir = join(directory, "node_modules", "@github", "copilot");
  const entry = resolvePackageBin(packageDir, await readCopilotManifest(packageDir));
  if (!entry || !await isFile(entry)) return null;
  const localNode = join(directory, "node.exe");
  return { command: await isFile(localNode) ? localNode : process.execPath, prefix: [entry] };
}

async function installedLauncher(executable, args, bootstrap) {
  if ([".exe", ".com"].includes(extname(executable).toLowerCase())) {
    return { command: executable, args, direct: true, bypassedBootstrap: bootstrap };
  }
  const npm = await findNpmEntry(dirname(executable));
  if (npm) return { command: npm.command, args: [...npm.prefix, ...args], direct: true, bypassedBootstrap: bootstrap };
  throw new CopilotLauncherError(`Copilot resolves through the shared VS Code bootstrapper to an unrecognized script at ${executable}. Put the installed Copilot CLI ahead of the bootstrapper on PATH.`);
}

function searchDirectories(env, cwd) {
  const path = env.PATH ?? env.Path ?? "";
  return path.split(";").filter(Boolean).map((entry) => resolve(cwd, entry.replace(/^"|"$/g, "")));
}

/**
 * Bypass the mutable VS Code bootstrapper only when it shadows an installed CLI.
 * @param {{ command: string, args: string[], cwd?: string, env?: object, platform?: string }} options
 * @returns {Promise<{ command: string, args: string[], direct: boolean, bypassedBootstrap?: string }>}
 */
export async function resolveCopilotLauncher({ command, args, cwd = process.cwd(), env = process.env, platform = process.platform }) {
  const unchanged = { command, args, direct: false };
  if (platform !== "win32" || command !== "copilot") return unchanged;
  let bootstrap;
  for (const directory of searchDirectories(env, cwd)) {
    const executable = await findExecutable(directory);
    if (!executable) continue;
    if (!bootstrap) {
      if (!isBootstrapDirectory(directory)) return unchanged;
      bootstrap = executable;
    }
    if (isBootstrapDirectory(directory)) continue;
    return installedLauncher(executable, args, bootstrap);
  }
  if (!bootstrap) return unchanged;
  throw new CopilotLauncherError("Only the shared VS Code Copilot bootstrapper was found. Install the standalone Copilot CLI and put it on PATH before running unattended workers.");
}
