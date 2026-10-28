/**
 * #416 — a project installed with `-Preset custom` stays a shared-files project through `pforge update`.
 *
 * The installers copy only the shared instructions and the framework tooling for `custom`: no agents, prompts,
 * skills, hooks or automations. The update planner had no notion of that and added 47 of them the first time it
 * ran. A project whose .forge.json records `custom` now still gets updates to the files it has, new shared
 * instructions and new framework tooling, and no prompts, hooks, automations or skills of a category it does
 * not carry. A category it already carries (a project updated before this rule has all four) keeps getting its
 * new files: a hook launcher updated without the scripts it names would stop working.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlan } from "../update-plan.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUIDANCE = ["prompts", "hooks", "automations", "skills"];
const PLAN_TIMEOUT_MS = 120_000;

describe("pforge update and the custom preset", () => {
  let project;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "pf-custom-update-"));
  });

  afterEach(() => rmSync(project, { recursive: true, force: true }));

  const record = (config) => writeFileSync(join(project, ".forge.json"), JSON.stringify(config));
  const plan = (options = {}) => buildPlan({ sourceRoot: REPO, projectRoot: project, ...options });
  const added = (result, category) => result.operations.filter((op) => op.category === category && op.action === "new");
  /** Puts a file in the project: a copy of one the source ships, or text of the project's own. */
  const place = (relative, { copyOf, text = "mine\n" } = {}) => {
    mkdirSync(dirname(join(project, relative)), { recursive: true });
    if (copyOf) copyFileSync(join(REPO, copyOf), join(project, relative));
    else writeFileSync(join(project, relative), text);
  };

  it("adds no prompts, hooks, automations or skills to a project recorded as custom", { timeout: PLAN_TIMEOUT_MS }, () => {
    record({ preset: "custom" });
    const result = plan();
    expect(result.presets).toEqual(["custom"]);
    expect(result.presetSource).toBe("forge.json");
    for (const category of GUIDANCE) {
      expect(added(result, category).map((op) => op.dst), `new ${category} for a custom project`).toEqual([]);
    }
  });

  it("still delivers the shared instructions and the framework tooling", { timeout: PLAN_TIMEOUT_MS }, () => {
    record({ preset: "custom" });
    const result = plan();
    expect(added(result, "instructions").length).toBeGreaterThan(0);
    expect(added(result, "core").length).toBeGreaterThan(0);
    expect(added(result, "mcp").length).toBeGreaterThan(0);
  });

  it("keeps adding a category's new files once the project carries one, so a set is not left half updated", { timeout: PLAN_TIMEOUT_MS }, () => {
    record({ preset: "custom" });
    place(".github/hooks/plan-forge.json", { copyOf: "templates/.github/hooks/plan-forge.json" });
    const result = plan();
    expect(added(result, "hooks").length, "new hook files beside the launcher the project has").toBeGreaterThan(0);
    for (const category of ["prompts", "automations", "skills"]) {
      expect(added(result, category), `new ${category} for a project that carries none`).toEqual([]);
    }
  });

  it("does not take a hand-written prompt for one of Plan Forge's", { timeout: PLAN_TIMEOUT_MS }, () => {
    record({ preset: "custom" });
    place(".github/prompts/my-own-review.prompt.md");
    expect(added(plan(), "prompts")).toEqual([]);
  });

  it("keeps adding them to a project on a stack preset, so the gate is specific to custom", { timeout: PLAN_TIMEOUT_MS }, () => {
    record({ preset: "typescript" });
    const result = plan();
    for (const category of GUIDANCE) {
      expect(added(result, category).length, `new ${category} for a typescript project`).toBeGreaterThan(0);
    }
  });

  it("treats custom beside a stack preset as a stack project, as the installers do", { timeout: PLAN_TIMEOUT_MS }, () => {
    record({ preset: ["custom", "typescript"] });
    expect(added(plan(), "prompts").length).toBeGreaterThan(0);
  });

  it("does not assume custom from a project that records no preset", { timeout: PLAN_TIMEOUT_MS }, () => {
    const result = plan();
    expect(result.presets).toEqual(["custom"]);
    expect(result.presetSource).toBe("default");
    expect(added(result, "prompts").length).toBeGreaterThan(0);
  });

  it("honors an explicit custom preset over what the project recorded", { timeout: PLAN_TIMEOUT_MS }, () => {
    record({ preset: "typescript" });
    const result = plan({ presetsOverride: ["custom"] });
    for (const category of GUIDANCE) {
      expect(added(result, category), `new ${category} with --presets custom`).toEqual([]);
    }
  });
});
