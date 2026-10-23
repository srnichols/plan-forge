import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildImpactCommands } from "../orchestrator/impact-gate.mjs";

/**
 * Meta-bugs #371 and #372 — two kinds of test file the impact gate got wrong.
 *
 *   #371  pforge-sdk is an npm workspace that runs vitest (`"test": "npx vitest run"`,
 *         its own vitest.config.mjs) but declares no dependencies; vitest is hoisted
 *         from the root. Runner detection only read dependencies, so the gate dropped
 *         the package's tests with "no test runner detected".
 *   #372  `*.spec.*` counted as a vitest test everywhere. Playwright and Cypress use
 *         that name for their own runner, so a repo with an e2e suite had those specs
 *         handed to vitest, which cannot run them.
 */

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let repo;

function write(rel, text = "x\n") {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
}

const config = { command: null };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pforge-meta-371-"));
  git(repo, "init", "-q", "-b", "main");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("a package that runs vitest or jest from its test script is a runner (#371)", () => {
  beforeEach(() => write("package.json", JSON.stringify({ workspaces: ["pkg"] })));

  it("runs the tests of a workspace package that declares no dependencies, from that package", () => {
    write("pkg/package.json", JSON.stringify({ scripts: { test: "npx vitest run" } }));
    const out = buildImpactCommands({ cwd: repo, tests: ["pkg/tests/a.test.mjs"], config });
    expect(out.runs).toEqual([{ command: 'npx vitest run "tests/a.test.mjs"', workdir: "pkg" }]);
    expect(out.skipped).toBeUndefined();
  });

  it.each([
    ["vitest", "vitest run"],
    ["cross-env CI=1 vitest run --coverage", "vitest run"],
    ["jest --coverage", "jest"],
  ])("reads the runner out of the test script %j", (script, runner) => {
    write("pkg/package.json", JSON.stringify({ scripts: { test: script } }));
    const out = buildImpactCommands({ cwd: repo, tests: ["pkg/tests/a.test.mjs"], config });
    expect(out.runs).toEqual([{ command: `npx ${runner} "tests/a.test.mjs"`, workdir: "pkg" }]);
  });

  it.each([
    'echo "Error: no test specified" && exit 1',
    "node --test",
    "npm test --workspaces --if-present",
  ])("does not take the test script %j for a runner", (script) => {
    write("pkg/package.json", JSON.stringify({ scripts: { test: script } }));
    const out = buildImpactCommands({ cwd: repo, tests: ["pkg/tests/a.test.mjs"], config });
    expect(out.runs).toEqual([]);
    expect(out.skipped).toContain("pkg/tests/a.test.mjs");
  });

  it("leaves a declared dependency in charge when the script names another runner", () => {
    write("pkg/package.json", JSON.stringify({ devDependencies: { jest: "^30.0.0" }, scripts: { test: "vitest run" } }));
    const out = buildImpactCommands({ cwd: repo, tests: ["pkg/tests/a.test.mjs"], config });
    expect(out.runs).toEqual([{ command: 'npx jest "tests/a.test.mjs"', workdir: "pkg" }]);
  });
});

describe("a spec file that a Playwright or Cypress config owns is not a vitest test (#372)", () => {
  beforeEach(() => write("package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } })));

  it("leaves a Playwright spec out of the vitest run and says why", () => {
    write("playwright.config.ts", "export default {};\n");
    const out = buildImpactCommands({ cwd: repo, tests: ["tests/unit.test.mjs", "e2e/login.spec.ts"], config });
    expect(out.runs).toEqual([{ command: 'npx vitest run "tests/unit.test.mjs"', workdir: null }]);
    expect(out.skipped).toContain("e2e/login.spec.ts");
    expect(out.skipped).toMatch(/Playwright or Cypress/);
    expect(out.skipped).not.toContain("tests/unit.test.mjs");
  });

  it("does the same for a Cypress spec", () => {
    write("cypress.config.js", "module.exports = {};\n");
    const out = buildImpactCommands({ cwd: repo, tests: ["cypress/e2e/home.spec.ts"], config });
    expect(out.runs).toEqual([]);
    expect(out.skipped).toContain("cypress/e2e/home.spec.ts");
  });

  it("finds the config in a parent directory of the spec", () => {
    write("web/playwright.config.mjs", "export default {};\n");
    const out = buildImpactCommands({ cwd: repo, tests: ["web/e2e/flows/a/checkout.spec.ts"], config });
    expect(out.runs).toEqual([]);
    expect(out.skipped).toContain("web/e2e/flows/a/checkout.spec.ts");
  });

  it("keeps running a *.spec.* file under vitest when no e2e config owns it", () => {
    const out = buildImpactCommands({ cwd: repo, tests: ["src/cart.spec.ts"], config });
    expect(out.runs).toEqual([{ command: 'npx vitest run "src/cart.spec.ts"', workdir: null }]);
    expect(out.skipped).toBeUndefined();
  });

  it("leaves a *.test.* file beside an e2e config alone", () => {
    write("playwright.config.ts", "export default {};\n");
    const out = buildImpactCommands({ cwd: repo, tests: ["tests/cart.test.ts"], config });
    expect(out.runs).toEqual([{ command: 'npx vitest run "tests/cart.test.ts"', workdir: null }]);
    expect(out.skipped).toBeUndefined();
  });

  it("reports an e2e spec and a test with no runner together", () => {
    write("playwright.config.ts", "export default {};\n");
    const out = buildImpactCommands({ cwd: repo, tests: ["e2e/login.spec.ts", "spec/user_spec.rb"], config });
    expect(out.skipped).toContain("e2e/login.spec.ts");
    expect(out.skipped).toContain("spec/user_spec.rb");
  });
});
