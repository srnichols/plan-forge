/**
 * The shells validate-setup runs in, and how to run each on a project directory.
 *
 * validate-setup ships as validate-setup.sh and validate-setup.ps1, and the PowerShell one has to run in Windows
 * PowerShell 5.1 as well as in pwsh. A test of what validate-setup says runs it in every shell this machine has.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const isWin = process.platform === "win32";
const BASH = isWin ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((p) => existsSync(p)) : "bash";
const PWSH_OK = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const PS_ARGS = ["-NoProfile", "-NonInteractive"];

/** @type {Array<{ name: string, available: boolean, run: (project: string) => import("node:child_process").SpawnSyncReturns<string> }>} */
export const SHELLS = [
  { name: "validate-setup.sh", available: Boolean(BASH), run: (project) => spawnSync(BASH, [join(REPO_ROOT, "validate-setup.sh"), "--path", project], { encoding: "utf8", timeout: 120_000 }) },
  {
    name: "validate-setup.ps1 under pwsh",
    available: PWSH_OK,
    run: (project) => spawnSync("pwsh", [...PS_ARGS, "-File", join(REPO_ROOT, "validate-setup.ps1"), "-ProjectPath", project], { encoding: "utf8", timeout: 120_000 }),
  },
  {
    name: "validate-setup.ps1 under Windows PowerShell 5.1",
    available: isWin,
    run: (project) =>
      spawnSync("powershell.exe", [...PS_ARGS, "-ExecutionPolicy", "Bypass", "-File", join(REPO_ROOT, "validate-setup.ps1"), "-ProjectPath", project], { encoding: "utf8", timeout: 120_000 }),
  },
];
