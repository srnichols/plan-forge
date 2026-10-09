import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseSkill } from "../skill-runner.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const MAX_DESCRIPTION_LENGTH = 1024;
const sharedSkills = join(ROOT, "presets", "shared", "skills");
const projectSkills = join(ROOT, ".github", "skills");
const pluginSkills = join(ROOT, "plugins", "plan-forge", "skills");
const presetReviewSkills = readdirSync(join(ROOT, "presets"))
  .map((preset) => join(ROOT, "presets", preset, ".github", "skills", "code-review", "SKILL.md"))
  .filter((file) => existsSync(file));
const reviewSkills = [
  ...[projectSkills, sharedSkills, pluginSkills].map((dir) => join(dir, "code-review", "SKILL.md")),
  ...presetReviewSkills,
].map((file) => ({ file, name: relative(ROOT, file) }));
const cleanCodeSkills = [projectSkills, sharedSkills, pluginSkills]
  .map((dir) => join(dir, "clean-code-review", "SKILL.md"))
  .map((file) => ({ file, name: relative(ROOT, file) }));
const cleanCodeInstructions = [
  join(ROOT, ".github", "instructions", "clean-code.instructions.md"),
  join(ROOT, "presets", "shared", ".github", "instructions", "clean-code.instructions.md"),
  join(ROOT, "templates", ".github", "instructions", "clean-code.instructions.md"),
].map((file) => ({ file, name: relative(ROOT, file) }));
const architectureInstructions = [
  join(ROOT, ".github", "instructions", "architecture-principles.instructions.md"),
  join(ROOT, "presets", "shared", ".github", "instructions", "architecture-principles.instructions.md"),
].map((file) => ({ file, name: relative(ROOT, file) }));

const MAINTAINABILITY_CHECKS = [
  "Software entropy",
  "Knowledge-level DRY",
  "Orthogonality",
  "Reversibility",
  "preconditions",
  "acquire/release",
  "failure mechanism",
  "property-based",
  "Deep modules",
  "Domain Language",
  "Contract Refs",
  "Design Concerns",
];

describe("Guard: review skills require maintainability evidence, not a findings quota", () => {
  it.each(reviewSkills)("$name includes the checks inside executable review steps", ({ file }) => {
    const skill = parseSkill(file);
    expect(skill.meta.name).toBe("code-review");
    expect(skill.meta.description).toEqual(expect.any(String));
    expect(skill.meta.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
    const body = skill.steps.map((step) => step.rawLines.join("\n")).join("\n");
    for (const check of MAINTAINABILITY_CHECKS) expect(body).toContain(check);
  });

  it.each(reviewSkills)("$name permits evidence-backed zero findings", ({ file }) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("Zero findings is valid");
    expect(source).not.toMatch(/zero(?:-| )findings? (?:is suspicious|review usually)|suspiciously clean/i);
  });
});

describe("Guard: mechanical audit signals do not replace qualitative judgment", () => {
  it.each(cleanCodeSkills)("$name preserves raw deltas and scope-aware interpretation", ({ file }) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("mechanical signals, not an entropy score");
    expect(source).toContain("independent reasons to change");
    expect(source).toContain("unchanged count is not an automatic rejection");
    expect(source).toContain("boy-scout-violation");
    expect(source).toContain("per-rule");
    expect(source).toContain("severity");
    expect(source).toMatch(/read-only/i);
  });
});

describe("Guard: DRY instructions distinguish shared knowledge from coincidental similarity", () => {
  it.each(cleanCodeInstructions)("$name preserves independent policy ownership", ({ file }) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("same knowledge");
    expect(source).toContain("independent reasons to change");
    expect(source).toContain("warning count");
  });
});

describe("Guard: scope-aware Boy Scout guidance preserves existing blocking gates", () => {
  it.each(architectureInstructions)("$name preserves error and no-new-violation requirements", ({ file }) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("DRY protects shared knowledge");
    expect(source).toContain("not a warning-count quota");
    expect(source).toContain("fix that error in the same commit");
    expect(source).toContain("Do not introduce new violations");
  });
});
