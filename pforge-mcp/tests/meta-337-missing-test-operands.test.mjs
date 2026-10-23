import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMissingTestOperands } from "../orchestrator/gate-operands.mjs";
import { runGate } from "../orchestrator/gate-runner.mjs";
import { classifyUnrunnableGate } from "../orchestrator/gate-preflight.mjs";

/**
 * Meta-bug #337 — `npx vitest run tests/placement.test.mjs tests/k8s-manifests.test.mjs`
 * passed (1 file, 20 tests) although tests/placement.test.mjs was never created.
 * vitest treats positional arguments as filters, so a missing file is silently
 * ignored as long as another operand matches. The Phase-62 Slice 23 worker
 * stopped on a Blocker, created nothing, and this gate still went green.
 *
 * Linting the shape would flag every multi-file gate (the repo's plans carry
 * dozens, nearly all legitimate), so the gate runner checks the one thing that
 * matters at the moment the gate runs: every test file it names must exist.
 */

describe("findMissingTestOperands (#337)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function project(...files) {
    const dir = mkdtempSync(join(tmpdir(), "pf-meta-337-"));
    dirs.push(dir);
    for (const file of files) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "x");
    }
    return dir;
  }

  it("reports the named test file that was never created, as in the Slice 23 incident", () => {
    const dir = project("tests/k8s-manifests.test.mjs");
    expect(findMissingTestOperands("npx vitest run tests/placement.test.mjs tests/k8s-manifests.test.mjs", dir))
      .toEqual(["tests/placement.test.mjs"]);
  });

  it("reports nothing when every named file exists", () => {
    const dir = project("tests/a.test.mjs", "tests/b.test.mjs");
    expect(findMissingTestOperands("npx vitest run tests/a.test.mjs tests/b.test.mjs", dir)).toEqual([]);
  });

  it("handles quoted operands, a ./ prefix and the --prefix form the testing guide recommends", () => {
    const dir = project("pforge-mcp/tests/here.test.mjs");
    expect(findMissingTestOperands('npx --prefix pforge-mcp vitest run "pforge-mcp/tests/here.test.mjs" "./pforge-mcp/tests/gone.test.mjs"', dir))
      .toEqual(["./pforge-mcp/tests/gone.test.mjs"]);
  });

  it.each([
    ["pnpm exec vitest run web/a.test.ts", "web/a.test.ts"],
    ["node node_modules/vitest/vitest.mjs run a.test.mjs", "a.test.mjs"],
    ["npx jest src/b.spec.tsx", "src/b.spec.tsx"],
    ["npx vitest run --reporter verbose c.test.cjs", "c.test.cjs"],
  ])("recognises the runner in %s", (command, missing) => {
    expect(findMissingTestOperands(command, project())).toEqual([missing]);
  });

  it("ignores patterns, substring filters and operands that are not test files", () => {
    const dir = project();
    expect(findMissingTestOperands('npx vitest run "tests/foo-*.test.mjs" tests/placement placement src/util.mjs', dir)).toEqual([]);
  });

  it("does not mistake an option value for a file operand", () => {
    const dir = project();
    expect(findMissingTestOperands('npx vitest run -t "parses a.test.mjs" --config vitest.e2e.config.mjs', dir)).toEqual([]);
  });

  it("stands down when the runner is pointed at another root, where relative paths mean something else", () => {
    const dir = project();
    expect(findMissingTestOperands("npx vitest run --root pkg tests/a.test.mjs", dir)).toEqual([]);
    expect(findMissingTestOperands("npx vitest run --dir pkg tests/a.test.mjs", dir)).toEqual([]);
  });

  it("ignores commands that do not run a filter-style test runner", () => {
    const dir = project();
    expect(findMissingTestOperands("node tests/a.test.mjs", dir)).toEqual([]);
    expect(findMissingTestOperands("echo tests/a.test.mjs", dir)).toEqual([]);
    expect(findMissingTestOperands("", dir)).toEqual([]);
  });

  it("reports an absolute path that does not exist and accepts one that does", () => {
    const dir = project("tests/a.test.mjs");
    expect(findMissingTestOperands(`npx vitest run "${join(dir, "tests", "a.test.mjs")}"`, dir)).toEqual([]);
    expect(findMissingTestOperands(`npx vitest run "${join(dir, "tests", "gone.test.mjs")}"`, dir)).toEqual([join(dir, "tests", "gone.test.mjs")]);
  });

  it("lists each missing file once", () => {
    const dir = project();
    expect(findMissingTestOperands("npx vitest run a.test.mjs a.test.mjs b.test.mjs", dir)).toEqual(["a.test.mjs", "b.test.mjs"]);
  });
});

describe("runGate refuses a gate that names a missing test file (#337)", () => {
  const dirs = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  const emptyProject = () => {
    const dir = mkdtempSync(join(tmpdir(), "pf-meta-337-gate-"));
    dirs.push(dir);
    return dir;
  };

  it("fails with a message that names the file and why it matters, without running the command", () => {
    const result = runGate("npx vitest run tests/placement.test.mjs", emptyProject());
    expect(result.success).toBe(false);
    expect(result.error).toContain("tests/placement.test.mjs");
    expect(result.error).toMatch(/do not exist/);
    expect(result.error).toMatch(/filters/);
  });

  it("stays an ordinary failure the worker can fix on retry, not an unrunnable gate", () => {
    const result = runGate("npx vitest run tests/placement.test.mjs", emptyProject());
    expect(classifyUnrunnableGate(result)).toBeNull();
  });

  it("leaves gates that name no test file alone", () => {
    expect(runGate('node -e "process.exit(0)"', emptyProject()).success).toBe(true);
  });
});
