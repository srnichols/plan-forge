import { lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const OPTIONAL_ASSET_SEGMENTS = Object.freeze([
  [".github", "hooks", "PreCommit.mjs"],
  [".github", "prompts", "step0-specify-feature.prompt.md"],
  [".github", "prompts", "step2-harden-plan.prompt.md"],
]);

function isAbsent(file) {
  try {
    lstatSync(file);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(file);
    if (parent !== file && !isAbsent(parent)) statSync(parent);
    return true;
  }
}

/** Missing optional guidance is intentional only in an installed custom preset. */
export function optionalGuidanceUnavailable(assetPath, { projectRoot = PROJECT_ROOT } = {}) {
  if (!OPTIONAL_ASSET_SEGMENTS.some((parts) => join(projectRoot, ...parts) === resolve(assetPath))) return false;
  if (!isAbsent(assetPath)) return false;
  const manifestPath = join(projectRoot, "package.json");
  if (!isAbsent(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.name === "plan-forge" && Array.isArray(manifest.workspaces)
      && manifest.workspaces.includes("pforge-mcp")) return false;
  }
  const configPath = join(projectRoot, ".forge.json");
  return !isAbsent(configPath) && JSON.parse(readFileSync(configPath, "utf8")).preset === "custom";
}
