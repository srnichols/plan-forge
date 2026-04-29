/**
 * Plan Forge — Bug #126: CrucibleEnforcementError surfaces both bypass forms.
 *
 * Acceptance criteria:
 *   (a) Error message contains both "--manual-import" and "manualImport: true".
 *   (b) Error code is "CRUCIBLE_ID_REQUIRED".
 *   (c) tools.json forge_run_plan.description contains "manualImport:true".
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CrucibleEnforcementError } from "../crucible-enforce.mjs";

describe("CrucibleEnforcementError message", () => {
  it("contains the CLI bypass form (--manual-import)", () => {
    const err = new CrucibleEnforcementError("/some/plan.md");
    expect(err.message).toContain("--manual-import");
  });

  it("contains the MCP bypass form (manualImport: true)", () => {
    const err = new CrucibleEnforcementError("/some/plan.md");
    expect(err.message).toContain("manualImport: true");
  });

  it("has code CRUCIBLE_ID_REQUIRED", () => {
    const err = new CrucibleEnforcementError("/some/plan.md");
    expect(err.code).toBe("CRUCIBLE_ID_REQUIRED");
  });
});

describe("tools.json forge_run_plan description", () => {
  it("mentions manualImport:true in the forge_run_plan description", () => {
    const toolsPath = resolve(fileURLToPath(new URL("../tools.json", import.meta.url)));
    const tools = JSON.parse(readFileSync(toolsPath, "utf-8"));
    const tool = tools.find((t) => t.name === "forge_run_plan");
    expect(tool).toBeDefined();
    expect(tool.description).toContain("manualImport:true");
  });
});
