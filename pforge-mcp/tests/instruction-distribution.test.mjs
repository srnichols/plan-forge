/**
 * Every instruction file the repository keeps is either shipped to projects or declared maintainer-only.
 *
 * Which instruction files reach a project is named in one place, pforge-mcp/preset-catalog.json:
 * `internalInstructions` ship from .github/instructions/ and `sharedInstructions` ship from
 * presets/shared/.github/instructions/. setup.ps1, setup.sh and update-plan.mjs (so both `pforge update` shells)
 * read those lists (#299). The release checklist still told the maintainer to find each name in four per-script
 * lists that no longer exist, and its scan reported nine gaps that were not gaps.
 *
 * A file that is on neither list never reaches a project, silently. That is what this suite catches, and it keeps
 * the two release documents describing the mechanism that is really there.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const INSTRUCTIONS = ".github/instructions";
const SHARED = "presets/shared/.github/instructions";
const TEMPLATES = "templates/.github/instructions";

const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const catalog = JSON.parse(read("pforge-mcp/preset-catalog.json"));
const { internalInstructions: internal, sharedInstructions: shared } = catalog;

// Guidance for working on this repository; setup says it does not ship it.
const MAINTAINER_ONLY = Object.freeze(["aci-design.instructions.md", "release-checklist.instructions.md"]);
// A template the project owns once it is installed (NEVER_UPDATE in update-plan.mjs); it ships from templates/.
const TEMPLATE_ONLY = Object.freeze(["project-principles.instructions.md"]);

// Lists the checklist and the editor cues used to name, and the script that held each. Neither script has them now.
const GONE_LISTS = Object.freeze([
  { token: "$sharedInstructions", script: "pforge.ps1" },
  { token: "for instr_name", script: "pforge.sh" },
]);
const STALE_PHRASES = Object.freeze([
  "enumerated in setup.{ps1,sh} + pforge.{ps1,sh}",
  "MUST be enumerated in **all four**",
  "missing from one of setup/update scripts",
]);

function namesIn(dir) {
  const full = join(REPO_ROOT, dir);
  return existsSync(full) ? readdirSync(full).filter((name) => name.endsWith(".instructions.md")).sort() : [];
}

/** The routes by which a repository instruction file reaches a project; a file should have exactly one. */
function routesOf(name) {
  return [
    internal.includes(name) && "internalInstructions",
    shared.includes(name) && "sharedInstructions",
    TEMPLATE_ONLY.includes(name) && "template",
    MAINTAINER_ONLY.includes(name) && "maintainer-only",
  ].filter(Boolean);
}

function checklistSection1b() {
  const text = read("docs/RELEASE-CHECKLIST.md");
  const start = text.indexOf("### 1b.");
  const end = text.indexOf("### 1c.");
  return start >= 0 && end > start ? text.slice(start, end) : "";
}

describe("every instruction file in .github/instructions", () => {
  const files = namesIn(INSTRUCTIONS);

  it("is found, so the checks below are not vacuous", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s reaches projects by exactly one route, or is declared maintainer-only", (name) => {
    expect(
      routesOf(name),
      `${name} is not named by preset-catalog.json (internalInstructions or sharedInstructions) and is not declared maintainer-only in this suite, `
        + "so setup and pforge update never deliver it. Add it to the catalog, or to MAINTAINER_ONLY here if it must stay out of projects.",
    ).toHaveLength(1);
  });
});

describe("preset-catalog.json instruction lists", () => {
  it("name only files that exist where setup reads them", () => {
    const missing = [
      ...internal.filter((name) => !existsSync(join(REPO_ROOT, INSTRUCTIONS, name))).map((name) => `${INSTRUCTIONS}/${name}`),
      ...shared.filter((name) => !existsSync(join(REPO_ROOT, SHARED, name))).map((name) => `${SHARED}/${name}`),
    ];
    expect(missing).toEqual([]);
  });

  it("name no file twice", () => {
    const all = [...internal, ...shared];
    expect(all.filter((name, index) => all.indexOf(name) !== index)).toEqual([]);
  });

  it("leave no file in presets/shared that setup would never install", () => {
    expect(namesIn(SHARED).filter((name) => !shared.includes(name))).toEqual([]);
  });
});

describe.each(MAINTAINER_ONLY)("maintainer-only %s", (name) => {
  it("exists, so the declaration is not stale", () => {
    expect(existsSync(join(REPO_ROOT, INSTRUCTIONS, name))).toBe(true);
  });

  it("is carried by no route to projects", () => {
    expect([...internal, ...shared, ...namesIn(SHARED), ...namesIn(TEMPLATES)]).not.toContain(name);
  });
});

describe("the release documents describe how instruction files ship", () => {
  const DOCS = ["docs/RELEASE-CHECKLIST.md", ".github/instructions/release-checklist.instructions.md"];

  it("RELEASE-CHECKLIST 1b names the catalog's two lists and this suite", () => {
    const section = checklistSection1b();
    expect(section, "the 1b section was not found").not.toBe("");
    for (const needle of ["preset-catalog.json", "internalInstructions", "sharedInstructions", "instruction-distribution.test.mjs"]) {
      expect(section, `1b does not mention ${needle}`).toContain(needle);
    }
  });

  it("the editor cue for an instruction file sends the maintainer to the catalog", () => {
    const cue = read(".github/instructions/release-checklist.instructions.md")
      .split("\n")
      .find((line) => line.startsWith("- Editing or adding **`.github/instructions/"));
    expect(cue, "the editor cue for an instruction file was not found").toBeDefined();
    expect(cue).toContain("preset-catalog.json");
  });

  it.each(DOCS)("%s names no per-script list that a script no longer has", (doc) => {
    const text = read(doc);
    const stale = GONE_LISTS.filter(({ token, script }) => !read(script).includes(token) && text.includes(token));
    expect(stale.map(({ token, script }) => `${token} (${script} has no such list)`)).toEqual([]);
  });

  it.each(DOCS)("%s no longer asks for each name in all four scripts", (doc) => {
    const text = read(doc);
    expect(STALE_PHRASES.filter((phrase) => text.includes(phrase))).toEqual([]);
  });
});
