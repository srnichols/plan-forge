/**
 * Plan Forge's own plan corpus: every `*PLAN.md` under docs/plans.
 *
 * The corpus tests assert thresholds measured on it ("more than 100 slices"), so they
 * mean something only where the whole corpus is. The directory is not evidence of
 * that: master keeps docs/plans (templates and examples) but sync-master.ps1 scrubs
 * the phase plans from it, and an installed project's docs/plans holds only that
 * project's own few plans (#398).
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { IS_PLAN_FORGE_SOURCE } from "./source-repo.mjs";

export const PLANS_DIR = resolve(import.meta.dirname, "..", "..", "..", "docs", "plans");
/** The project root the plans are parsed against. */
export const PLAN_CORPUS_ROOT = resolve(PLANS_DIR, "..", "..");

const PLAN_FILE = /PLAN\.md$/i;

/** Every plan file under `dir`, nested folders included. */
export function planFilesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return planFilesUnder(full);
    return PLAN_FILE.test(name) ? [full] : [];
  });
}

/**
 * The corpus, or an empty list wherever its thresholds do not apply: outside the
 * framework's source tree, and in a tree that lost the phase plans.
 *
 * @param {{ plansDir?: string, isFrameworkSource?: boolean }} [options]
 * @returns {string[]}
 */
export function findPlanCorpus({ plansDir = PLANS_DIR, isFrameworkSource = IS_PLAN_FORGE_SOURCE } = {}) {
  return isFrameworkSource && existsSync(plansDir) ? planFilesUnder(plansDir) : [];
}

/** This checkout's corpus: the phase plans on planning/main, nothing on master or in an installed project. */
export const PLAN_CORPUS = findPlanCorpus();
