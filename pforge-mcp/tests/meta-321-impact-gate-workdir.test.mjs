import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildImpactCommands, runImpactGate } from "../orchestrator/impact-gate.mjs";
import { gateCommandInWorkdir, runGate } from "../orchestrator/gate-runner.mjs";

/**
 * Meta-bug #321 — the impact gate built `npx --prefix <pkg> vitest run "<repo-relative path>"`
 * and ran it with the repo root as the working directory. `--prefix` only changes
 * where the binary resolves, so vitest loaded the ROOT config (test.root =
 * pforge-mcp) and reported "no test files" for every test outside pforge-mcp;
 * block mode then failed slices whose own gates had passed. A second case: a
 * package's e2e suite has its own vitest config and is excluded from the
 * default one, so those files were never collected either.
 *
 * Tests belong in the package's own directory: 15 of 135 claw test files and 7
 * of 14 sdk test files use process.cwd(), so `--root` alone would run them from
 * the repo root.
 */

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let repo;

function write(rel, text = "x\n") {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
}

function commitAll(message) {
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "commit", "-q", "-m", message);
}

const config = { command: null };

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pforge-meta-321-"));
  git(repo, "init", "-q", "-b", "main");
  write("README.md");
  commitAll("base");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("buildImpactCommands runs a package's tests from that package (#321)", () => {
  beforeEach(() => {
    write("package.json", JSON.stringify({ workspaces: ["pkg-a", "pkg-b"] }));
    write("pkg-a/package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    write("pkg-b/package.json", JSON.stringify({ devDependencies: { jest: "^30.0.0" } }));
  });

  it("hands each package its own working directory and package-relative files, with no --prefix", () => {
    const out = buildImpactCommands({
      cwd: repo,
      tests: ["pkg-a/tests/x.test.mjs", "pkg-b/src/y.spec.ts", "pkg-a/tests/deep/z.test.mjs"],
      config,
    });
    expect(out.runs).toEqual([
      { command: 'npx vitest run "tests/x.test.mjs" "tests/deep/z.test.mjs"', workdir: "pkg-a" },
      { command: 'npx jest "src/y.spec.ts"', workdir: "pkg-b" },
    ]);
    expect(out.commands).toEqual([
      'cd pkg-a && npx vitest run "tests/x.test.mjs" "tests/deep/z.test.mjs"',
      'cd pkg-b && npx jest "src/y.spec.ts"',
    ]);
  });

  it("leaves the root package alone: no working directory, no cd", () => {
    write("tests/root.test.mjs");
    write("package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    const out = buildImpactCommands({ cwd: repo, tests: ["tests/root.test.mjs"], config });
    expect(out.runs).toEqual([{ command: 'npx vitest run "tests/root.test.mjs"', workdir: null }]);
    expect(out.commands).toEqual(['npx vitest run "tests/root.test.mjs"']);
  });

  it("routes a suite to the vitest config that includes it, when the package has one", () => {
    write("pkg-a/vitest.e2e.config.mjs", "export default {};\n");
    const out = buildImpactCommands({
      cwd: repo,
      tests: ["pkg-a/tests/unit.test.mjs", "pkg-a/tests/e2e/flow.test.mjs", "pkg-a/tests/e2e/other.test.mjs"],
      config,
    });
    expect(out.runs).toEqual([
      { command: 'npx vitest run "tests/unit.test.mjs"', workdir: "pkg-a" },
      { command: 'npx vitest run --config vitest.e2e.config.mjs "tests/e2e/flow.test.mjs" "tests/e2e/other.test.mjs"', workdir: "pkg-a" },
    ]);
  });

  it("keeps a suite on the default config when no suite config exists", () => {
    const out = buildImpactCommands({ cwd: repo, tests: ["pkg-a/tests/e2e/flow.test.mjs"], config });
    expect(out.runs).toEqual([{ command: 'npx vitest run "tests/e2e/flow.test.mjs"', workdir: "pkg-a" }]);
  });

  it("does not route jest files through a vitest suite config", () => {
    write("pkg-b/jest.e2e.config.js", "module.exports = {};\n");
    write("pkg-b/vitest.e2e.config.mjs", "export default {};\n");
    const out = buildImpactCommands({ cwd: repo, tests: ["pkg-b/tests/e2e/y.spec.ts"], config });
    expect(out.runs).toEqual([{ command: 'npx jest "tests/e2e/y.spec.ts"', workdir: "pkg-b" }]);
  });

  it("runs a configured command once from the project root", () => {
    const out = buildImpactCommands({ cwd: repo, tests: ["t/a_spec.rb"], config: { command: "bundle exec rspec {files}" } });
    expect(out.runs).toEqual([{ command: 'bundle exec rspec "t/a_spec.rb"', workdir: null }]);
    expect(out.commands).toEqual(['bundle exec rspec "t/a_spec.rb"']);
  });

  it("still lists what it could not run", () => {
    const out = buildImpactCommands({ cwd: repo, tests: ["spec/user_spec.rb"], config });
    expect(out.runs).toEqual([]);
    expect(out.skipped).toMatch(/spec\/user_spec\.rb/);
  });
});

describe("runImpactGate passes the working directory to the gate runner (#321)", () => {
  const impactConfig = { mode: "block", command: null, maxTests: 10 };

  it("runs a package's tests with that package as the working directory", () => {
    write("package.json", JSON.stringify({ workspaces: ["pkg-a"] }));
    write("pkg-a/package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    commitAll("tooling");
    const base = git(repo, "rev-parse", "HEAD");
    write("pkg-a/src/thing.mjs");
    write("pkg-a/tests/thing.test.mjs");
    commitAll("slice");
    const runGateFn = vi.fn(() => ({ success: true, output: "ok" }));
    const out = runImpactGate({ cwd: repo, sinceSha: base, config: impactConfig, runGateFn, blastRadius: () => null });
    expect(out).toMatchObject({ ran: true, success: true, tests: ["pkg-a/tests/thing.test.mjs"] });
    expect(runGateFn).toHaveBeenCalledWith('npx vitest run "tests/thing.test.mjs"', repo, { workdir: "pkg-a" });
  });

  it("names the package directory in the failing command so the failure can be reproduced", () => {
    write("package.json", JSON.stringify({ workspaces: ["pkg-a"] }));
    write("pkg-a/package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    commitAll("tooling");
    const base = git(repo, "rev-parse", "HEAD");
    write("pkg-a/tests/thing.test.mjs");
    commitAll("slice");
    const runGateFn = vi.fn(() => ({ success: false, output: "1 failed" }));
    const out = runImpactGate({ cwd: repo, sinceSha: base, config: impactConfig, runGateFn, blastRadius: () => null });
    expect(out).toMatchObject({ ran: true, success: false });
    expect(out.failedCommand).toBe('cd pkg-a && npx vitest run "tests/thing.test.mjs"');
  });

  it("calls the gate runner exactly as before for the root package", () => {
    write("package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    commitAll("tooling");
    const base = git(repo, "rev-parse", "HEAD");
    write("tests/auth.test.mjs");
    commitAll("slice");
    const runGateFn = vi.fn(() => ({ success: true, output: "ok" }));
    runImpactGate({ cwd: repo, sinceSha: base, config: impactConfig, runGateFn, blastRadius: () => null });
    expect(runGateFn).toHaveBeenCalledWith('npx vitest run "tests/auth.test.mjs"', repo);
  });
});

describe("runGate workdir option (#321)", () => {
  const same = (actual, expected) => resolve(actual.trim()).toLowerCase() === resolve(expected).toLowerCase();

  it("runs the command in the requested subdirectory of the project", () => {
    mkdirSync(join(repo, "pkg"), { recursive: true });
    const result = runGate('node -e "console.log(process.cwd())"', repo, { workdir: "pkg" });
    expect(result.success).toBe(true);
    expect(same(result.output, join(repo, "pkg"))).toBe(true);
  });

  it("runs in the project root when no workdir is given", () => {
    const result = runGate('node -e "console.log(process.cwd())"', repo);
    expect(same(result.output, repo)).toBe(true);
  });

  it("refuses a workdir that leaves the project", () => {
    for (const workdir of ["../outside", resolve(repo, "..")]) {
      const result = runGate('node -e "process.exit(0)"', repo, { workdir });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/outside the project/);
    }
  });
});

describe("gateCommandInWorkdir (#321)", () => {
  it("leaves the command alone without a workdir", () => {
    expect(gateCommandInWorkdir("npx vitest run a", null)).toBe("npx vitest run a");
    expect(gateCommandInWorkdir("npx vitest run a", undefined)).toBe("npx vitest run a");
  });

  it("changes directory first inside the container shell, quoting what needs it", () => {
    expect(gateCommandInWorkdir("npx vitest run a", "pkg-a")).toBe("cd 'pkg-a' && npx vitest run a");
    expect(gateCommandInWorkdir("npx vitest run a", "my pkg")).toBe("cd 'my pkg' && npx vitest run a");
    expect(gateCommandInWorkdir("npx vitest run a", "it's")).toBe("cd 'it'\\''s' && npx vitest run a");
  });
});
