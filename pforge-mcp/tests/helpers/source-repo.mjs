/**
 * Whether the tests are running inside the Plan Forge repository itself, as
 * opposed to a project that `pforge update` installed pforge-mcp/tests into.
 *
 * Keyed on a file update never ships. "setup.ps1 exists" is not enough:
 * projects keep a setup.ps1 from an old install that updates never refresh,
 * so tests comparing against it failed in every such project.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO_ONLY_MARKER = fileURLToPath(new URL("../../../scripts/release/release-checks.json", import.meta.url));
export const IS_PLAN_FORGE_SOURCE = existsSync(REPO_ONLY_MARKER);
