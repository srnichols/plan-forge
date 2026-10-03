/**
 * Guard: every rule the Boy Scout delta tracks is a rule the clean-code ESLint
 * config actually reports.
 *
 * The delta used to track `complexity-warn` while ESLint reported
 * `clean-code/complexity-warn`, so complexity, function-length and
 * parameter-count changes were never counted — only no-magic-numbers was.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DELTA_SCRIPT = resolve(REPO_ROOT, "scripts/audit/boyscout-delta.mjs");
const ESLINT_CONFIG = resolve(REPO_ROOT, "scripts/audit/eslint-clean-code.config.mjs");

function trackedRules() {
  const src = readFileSync(DELTA_SCRIPT, "utf8");
  const block = src.match(/const TRACKED_RULES = new Set\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error("TRACKED_RULES not found in boyscout-delta.mjs");
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

async function configuredRules() {
  const { default: config } = await import(pathToFileURL(ESLINT_CONFIG).href);
  const entries = Array.isArray(config) ? config : [config];
  return new Set(entries.flatMap((entry) => Object.keys(entry.rules || {})));
}

describe("Guard: Boy Scout delta tracks rules the clean-code config reports", () => {
  it("every tracked rule is configured", async () => {
    const configured = await configuredRules();
    const tracked = trackedRules();
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.filter((rule) => !configured.has(rule))).toEqual([]);
  });

  it("tracks the complexity, length and parameter rules under their plugin prefix", () => {
    expect(trackedRules()).toEqual(expect.arrayContaining([
      "clean-code/complexity-warn",
      "clean-code/complexity-error",
      "clean-code/max-lines-per-function-warn",
      "clean-code/max-params-warn",
    ]));
  });
});
