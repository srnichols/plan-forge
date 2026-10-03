/**
 * The pforge-mcp modules `pforge update` runs from the update *source* (the
 * release being installed). Since #299 both shells delegate the scan to
 * update-plan.mjs and refuse a source without it, so any test that builds a
 * fake source must ship these. Kept in one list so a new import is added once.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export const UPDATE_RUNTIME_FILES = Object.freeze([
  "pforge-mcp/update-plan.mjs",
  "pforge-mcp/update-guard.mjs",
  "pforge-mcp/detect-preset.mjs",
  "pforge-mcp/migrate-forge-config.mjs",
  "pforge-mcp/preset-catalog.json",
  "pforge-mcp/orchestrator/constants.mjs",
]);

/** Copy the real update runtime into a fake source tree rooted at `sourceRoot`. */
export function copyUpdateRuntime(sourceRoot) {
  for (const rel of UPDATE_RUNTIME_FILES) {
    const target = join(sourceRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(REPO_ROOT, rel), target);
  }
}
