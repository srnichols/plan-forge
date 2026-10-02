/**
 * #305 — vitest only collects `*.test.mjs`, so a test saved as `.test.js` (or
 * `.spec.*`, `.test.ts`, …) is silently never run and rots. Five such files sat
 * in pforge-mcp/tests unnoticed; one had drifted out of date entirely.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
// Test roots of every package; sibling packages exist only in the source checkout.
const TEST_ROOTS = ["pforge-mcp/tests", "pforge-master/tests", "pforge-master/src", "pforge-sdk/tests", "tests"];
const UNCOLLECTED = /\.(test|spec)\.(js|cjs|ts|mts|cts|jsx|tsx)$|\.spec\.mjs$/;
// Fixture trees hold sample projects for scanners, not suites of our own.
const SKIP_DIRS = new Set(["node_modules", "fixtures", ".forge"]);

function findUncollected(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) findUncollected(join(dir, entry.name), found);
    } else if (UNCOLLECTED.test(entry.name)) {
      found.push(relative(REPO_ROOT, join(dir, entry.name)).replace(/\\/g, "/"));
    }
  }
  return found;
}

describe("test files use the collected .test.mjs suffix", () => {
  it("no package has test files vitest would skip", () => {
    const roots = TEST_ROOTS.map((r) => join(REPO_ROOT, r)).filter((r) => existsSync(r));
    expect(roots.length).toBeGreaterThan(0);
    const offenders = roots.flatMap((r) => findUncollected(r));
    expect(offenders, "rename to .test.mjs so vitest runs them").toEqual([]);
  });
});
