/**
 * Plan Forge — is this project's Plan Forge install internally consistent?
 *
 * `pforge update` runs in the project's existing pforge script, and scripts
 * older than 3.31.2 only update the packages they knew about. Upgrading
 * 3.29.0-dev → 3.31.1 that way left pforge-master at 3.29 (so Forge-Master
 * missed the 3.31 tool-profile change) while .forge.json said 3.31.1. smith
 * calls this (both shells) to catch such a half-applied upgrade.
 *
 * Usage: node install-consistency.mjs --project <dir>   → JSON on stdout
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RERUN_FIX = "Run 'pforge update' once more to finish the upgrade.";

function readJson(path) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
}

const packageVersion = (root, pkg) => {
  const version = readJson(join(root, pkg, "package.json"))?.version;
  return typeof version === "string" ? version : null;
};

/**
 * @param {string} projectRoot
 * @returns {{ frameworkVersion: string|null, templateVersion: string|null,
 *   packages: Record<string, string|null>, issues: { code: string, message: string, fix: string }[], message: string }}
 */
export function checkInstallConsistency(projectRoot) {
  const root = resolve(projectRoot);
  const templateVersion = readJson(join(root, ".forge.json"))?.templateVersion ?? null;
  const packages = { "pforge-mcp": packageVersion(root, "pforge-mcp"), "pforge-master": packageVersion(root, "pforge-master") };
  const mcp = packages["pforge-mcp"];
  const master = packages["pforge-master"];
  const issues = [];
  if (mcp && master && master !== mcp) {
    issues.push({
      code: "PACKAGES_DISAGREE",
      message: `pforge-master is v${master} but pforge-mcp is v${mcp}: an update stopped part-way (older pforge scripts did not update every package).`,
      fix: RERUN_FIX,
    });
  }
  if (mcp && templateVersion && templateVersion !== mcp) {
    issues.push({
      code: "TEMPLATE_VERSION_MISMATCH",
      message: `.forge.json says v${templateVersion} but the installed pforge-mcp is v${mcp}.`,
      fix: RERUN_FIX,
    });
  }
  const frameworkVersion = mcp ?? null;
  const message = frameworkVersion
    ? (issues.length === 0 ? `Plan Forge v${frameworkVersion} is installed consistently.` : `Plan Forge v${frameworkVersion}: ${issues.length} problem(s).`)
    : "Plan Forge is not installed here (no pforge-mcp/package.json).";
  return { frameworkVersion, templateVersion, packages, issues, message };
}

export function runCli(argv, { stdout = process.stdout } = {}) {
  const i = argv.indexOf("--project");
  const projectRoot = i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd();
  stdout.write(`${JSON.stringify(checkInstallConsistency(projectRoot))}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase()) {
  process.exitCode = runCli(process.argv.slice(2));
}
