/**
 * #398 — the plan-corpus tests (#373, #374, #375) guarded their corpus blocks with
 * `existsSync(docs/plans)`. The directory is on master and in every installed
 * project, the corpus is not, so the "large enough to mean something" thresholds
 * failed there. The helper decides whether the corpus is present.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PLAN_CORPUS, findPlanCorpus, planFilesUnder } from "./helpers/plan-corpus.mjs";
import { IS_PLAN_FORGE_SOURCE } from "./helpers/source-repo.mjs";

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A docs/plans folder holding the named files. */
function plansFolder(...names) {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-398-"));
  tmpDirs.push(dir);
  for (const name of names) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), "# Plan\n");
  }
  return dir;
}

const rel = (dir, files) => files.map((file) => file.slice(dir.length + 1).replace(/\\/g, "/")).sort();

describe("planFilesUnder (#398)", () => {
  it("lists every *PLAN.md, nested folders included", () => {
    const dir = plansFolder("Phase-1-A-PLAN.md", "archive/Phase-0-OLD-PLAN.md", "examples/deep/Phase-9-X-plan.md");
    expect(rel(dir, planFilesUnder(dir))).toEqual(["Phase-1-A-PLAN.md", "archive/Phase-0-OLD-PLAN.md", "examples/deep/Phase-9-X-plan.md"]);
  });

  it("skips files that are not plans", () => {
    const dir = plansFolder("README.md", "DEPLOYMENT-ROADMAP.md", "Phase-1-AUTH-EXAMPLE.md", "PLAN-TEMPLATE.md", "notes.txt");
    expect(planFilesUnder(dir)).toEqual([]);
  });
});

describe("findPlanCorpus (#398)", () => {
  it("is the whole list in the framework's source tree", () => {
    const dir = plansFolder("Phase-1-A-PLAN.md", "Phase-2-B-PLAN.md");
    expect(rel(dir, findPlanCorpus({ plansDir: dir, isFrameworkSource: true }))).toEqual(["Phase-1-A-PLAN.md", "Phase-2-B-PLAN.md"]);
  });

  it("is empty in an installed project, whatever plans its docs/plans holds", () => {
    const dir = plansFolder("Phase-1-OWN-PLAN.md", "Phase-2-OWN-PLAN.md", "Phase-3-OWN-PLAN.md");
    expect(findPlanCorpus({ plansDir: dir, isFrameworkSource: false })).toEqual([]);
  });

  it("is empty on master, which keeps docs/plans but not the phase plans", () => {
    const dir = plansFolder("AI-Plan-Hardening-Runbook.md", "examples/Phase-1-DEMO-EXAMPLE.md", "Phase-PLAN-TEMPLATE.md");
    expect(findPlanCorpus({ plansDir: dir, isFrameworkSource: true })).toEqual([]);
  });

  it("is empty when the folder does not exist", () => {
    expect(findPlanCorpus({ plansDir: join(tmpdir(), "pf-meta-398-missing"), isFrameworkSource: true })).toEqual([]);
  });
});

// The helper must not go quietly empty where the corpus is, or the three corpus tests would skip for good.
// The marker is located here, not through the helper's own PLANS_DIR, so a wrong path there cannot hide itself.
const ROADMAP = join(import.meta.dirname, "..", "..", "docs", "plans", "DEPLOYMENT-ROADMAP.md");
describe.skipIf(!IS_PLAN_FORGE_SOURCE || !existsSync(ROADMAP))("the corpus of this checkout (#398)", () => {
  it("finds the phase plans wherever the dev-only roadmap is", () => {
    expect(PLAN_CORPUS.length).toBeGreaterThan(20);
  });
});

describe("no test decides the corpus is present from the folder alone (#398)", () => {
  it("never guards a corpus block with skipIf(!existsSync(PLANS_DIR))", () => {
    const offenders = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith(".test.mjs") && name !== "plan-corpus-helper.test.mjs")
      .filter((name) => /skipIf\(\s*!existsSync\(\s*PLANS_DIR\s*\)\s*\)/.test(readFileSync(join(import.meta.dirname, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});
