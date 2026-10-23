/**
 * #305 — vitest only collects `*.test.mjs`, so a test saved as `.test.js` (or
 * `.spec.*`, `.test.ts`, …) is silently never run and rots. Five such files sat
 * in pforge-mcp/tests unnoticed; one had drifted out of date entirely.
 *
 * #361 — the guard also scanned the project's own `tests/` folder. A Playwright
 * harness there keeps its `*.spec.ts` files, which are not vitest tests and
 * would break if renamed, so the guard failed on every run in such a project.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findUncollectedTests } from "./helpers/uncollected-tests.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

describe("test files use the collected .test.mjs suffix", () => {
  it("no package has test files vitest would skip", () => {
    const { roots, offenders } = findUncollectedTests(REPO_ROOT);
    expect(roots.length).toBeGreaterThan(0);
    expect(offenders, "rename to .test.mjs so vitest runs them").toEqual([]);
  });
});

describe("the guard stays inside the Plan Forge packages (#361)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function project(files) {
    const root = mkdtempSync(join(tmpdir(), "pf-suffix-"));
    dirs.push(root);
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    return root;
  }

  it("leaves a project's own Playwright specs alone", () => {
    const root = project([
      "tests/playwright.config.ts",
      "tests/phase-3/e2e/specs/01-login.spec.ts",
      "tests/phase-3/e2e/specs/02-checkout.spec.ts",
      "pforge-mcp/tests/ok.test.mjs",
    ]);
    expect(findUncollectedTests(root).offenders).toEqual([]);
  });

  it("still flags an uncollected file in a Plan Forge package", () => {
    const root = project([
      "tests/e2e/specs/01-login.spec.ts",
      "pforge-mcp/tests/rotten.test.js",
      "pforge-sdk/tests/also-rotten.spec.mjs",
      "pforge-master/src/nested/dead.test.ts",
    ]);
    expect(findUncollectedTests(root).offenders.sort()).toEqual([
      "pforge-master/src/nested/dead.test.ts",
      "pforge-mcp/tests/rotten.test.js",
      "pforge-sdk/tests/also-rotten.spec.mjs",
    ]);
  });

  it("still skips fixture trees inside a package", () => {
    const root = project(["pforge-mcp/tests/fixtures/sample/src/math.test.js"]);
    expect(findUncollectedTests(root).offenders).toEqual([]);
  });
});
