import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPodGitEnvironment } from "../src/k8s/pod-git-env.mjs";

const PACKAGE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FORWARDED_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);
const COMMAND_UNAVAILABLE = 127;

function waitForChild(child) {
  return new Promise((resolve) => {
    const handlers = FORWARDED_SIGNALS.map((signal) => {
      const handler = () => child.kill(signal);
      process.on(signal, handler);
      return { signal, handler };
    });
    const finish = (code) => {
      for (const { signal, handler } of handlers) process.removeListener(signal, handler);
      resolve(code);
    };
    child.once("error", () => finish(COMMAND_UNAVAILABLE));
    child.once("close", (code) => finish(code ?? 1));
  });
}

/**
 * Run the image's pforge command with credentials and identity confined to its workspace.
 * @param {{args?: string[], cwd?: string, env?: object, spawnFn?: Function}} options
 * @returns {Promise<number>}
 */
export async function runWorkerEntrypoint({
  args = process.argv.slice(2), cwd = process.cwd(), env = process.env, spawnFn = spawn,
} = {}) {
  const home = env.HOME || path.join(cwd, "home");
  try {
    const childEnv = createPodGitEnvironment({ env, home });
    if (env.PFORGE_CLAW_COPILOT_TOKEN) childEnv.COPILOT_GITHUB_TOKEN = env.PFORGE_CLAW_COPILOT_TOKEN;
    await mkdir(home, { recursive: true });
    let command;
    let commandArgs;
    if (args[0] === "claw") {
      command = process.execPath;
      commandArgs = [path.join(PACKAGE_ROOT, "cli.mjs"), ...args.slice(1)];
    } else {
      const script = path.join(cwd, "pforge.sh");
      await access(script, constants.X_OK);
      command = "bash";
      commandArgs = [script, ...args];
    }
    const child = spawnFn(command, commandArgs, { cwd, env: childEnv, stdio: "inherit" });
    return await waitForChild(child);
  } catch {
    process.stderr.write("pforge: command or writable job home unavailable\n");
    return COMMAND_UNAVAILABLE;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runWorkerEntrypoint();
}
