import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Test roots of the Plan Forge packages; sibling packages exist only in the source checkout.
// Not a project's own tests/ folder: vitest here never collects it, and it may hold
// another runner's files (a Playwright harness's *.spec.ts) that must keep their suffix (#361).
export const TEST_ROOTS = ["pforge-mcp/tests", "pforge-master/tests", "pforge-master/src", "pforge-sdk/tests"];
export const UNCOLLECTED = /\.(test|spec)\.(js|cjs|ts|mts|cts|jsx|tsx)$|\.spec\.mjs$/;
// Fixture trees hold sample projects for scanners, not suites of our own.
const SKIP_DIRS = new Set(["node_modules", "fixtures", ".forge"]);

function findUncollected(dir, repoRoot, found) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findUncollected(join(dir, entry.name), repoRoot, found);
    } else if (UNCOLLECTED.test(entry.name)) {
      found.push(relative(repoRoot, join(dir, entry.name)).replace(/\\/g, "/"));
    }
  }
  return found;
}

/** Test files under the package test roots that vitest would never collect. */
export function findUncollectedTests(repoRoot) {
  const roots = TEST_ROOTS.map((r) => join(repoRoot, r)).filter((r) => existsSync(r));
  return { roots, offenders: roots.flatMap((r) => findUncollected(r, repoRoot, [])) };
}
