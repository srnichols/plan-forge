/**
 * Impact gate (recommendation 2). Each Phase-UPDATE-CORE slice passed its own
 * gate, yet the full suite then found 8 failures in tests the slice gates never
 * ran. After a slice's gate passes, the tests related to the files the slice
 * changed now run too.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildImpactCommands,
  changedFilesSince,
  findRelatedTests,
  isTestFile,
  loadImpactGateConfig,
  runImpactGate,
} from "../orchestrator/impact-gate.mjs";
import { runSliceGates } from "../orchestrator/run-plan.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let repo;

function write(rel, text = "x\n") {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
}

function commitAll(message) {
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pforge-impact-"));
  git(repo, "init", "-q", "-b", "main");
  write("README.md");
  commitAll("base");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("isTestFile", () => {
  it.each([
    "src/auth.test.mjs", "web/app.spec.tsx", "tests/helpers.js", "pkg/__tests__/a.js",
    "app/test_models.py", "app/models_test.py", "svc/handler_test.go",
    "tests/TimeTracker.Tests/ClientServiceTests.cs", "src/FooTest.cs", "spec/user_spec.rb",
  ])("recognises %s", (p) => expect(isTestFile(p)).toBe(true));

  it.each(["src/auth.mjs", "src/Contest.cs", "docs/testing.md", "src/latest.py"])("rejects %s", (p) => expect(isTestFile(p)).toBe(false));
});

describe("loadImpactGateConfig", () => {
  it("blocks by default with a 40-test cap", () => {
    expect(loadImpactGateConfig(repo)).toEqual({ mode: "block", command: null, maxTests: 40 });
  });

  it("accepts a mode string or an object", () => {
    write(".forge.json", JSON.stringify({ impactGate: "warn" }));
    expect(loadImpactGateConfig(repo).mode).toBe("warn");
    write(".forge.json", JSON.stringify({ impactGate: { mode: "off", command: "make test FILES='{files}'", maxTests: 5 } }));
    expect(loadImpactGateConfig(repo)).toEqual({ mode: "off", command: "make test FILES='{files}'", maxTests: 5 });
  });

  it("falls back to defaults for unknown values", () => {
    write(".forge.json", JSON.stringify({ impactGate: { mode: "maybe", maxTests: -1 } }));
    expect(loadImpactGateConfig(repo)).toEqual({ mode: "block", command: null, maxTests: 40 });
  });
});

describe("changedFilesSince", () => {
  it("lists committed, modified and untracked files since a commit, posix and sorted", () => {
    const base = git(repo, "rev-parse", "HEAD");
    write("src/a.mjs");
    commitAll("worker commit");
    write("README.md", "edited\n");
    write("src/new/b.mjs");
    write("src/gone.mjs");
    commitAll("add gone");
    rmSync(join(repo, "src/gone.mjs"));
    expect(changedFilesSince({ cwd: repo, sinceSha: base })).toEqual(["README.md", "src/a.mjs", "src/new/b.mjs"]);
  });

  it("returns an empty list without a start commit", () => {
    expect(changedFilesSince({ cwd: repo, sinceSha: null })).toEqual([]);
  });
});

describe("findRelatedTests", () => {
  const tracked = [
    "src/auth.mjs", "tests/auth.test.mjs", "tests/auth-helpers.test.mjs", "tests/billing.test.mjs",
    "app/models.py", "app/tests/test_models.py",
    "svc/handler.go", "svc/handler_test.go",
    "src/Api/ClientService.cs", "tests/Api.Tests/ClientServiceTests.cs",
  ];

  it("maps changed sources to tests by name, keeps changed tests, adds lattice tests", () => {
    const blastRadius = vi.fn(() => ({ files: [], tests: ["tests/billing.test.mjs"], depth: 3, truncated: false }));
    const out = findRelatedTests({
      cwd: repo,
      changedFiles: ["src/auth.mjs", "app/models.py", "svc/handler.go", "src/Api/ClientService.cs", "tests/auth-helpers.test.mjs"],
      trackedFiles: tracked,
      blastRadius,
    });
    expect(out.tests).toEqual([
      "tests/auth-helpers.test.mjs",
      "app/tests/test_models.py",
      "svc/handler_test.go",
      "tests/Api.Tests/ClientServiceTests.cs",
      "tests/auth.test.mjs",
      "tests/billing.test.mjs",
    ]);
    expect(blastRadius).toHaveBeenCalledWith(expect.arrayContaining(["src/auth.mjs"]), expect.objectContaining({ deps: { cwd: repo } }));
  });

  it("works without a lattice index", () => {
    const out = findRelatedTests({ cwd: repo, changedFiles: ["src/auth.mjs"], trackedFiles: tracked, blastRadius: () => null });
    expect(out.tests).toEqual(["tests/auth.test.mjs"]);
  });

  it("never hands a runner a non-test file that merely lives under tests/", () => {
    const out = findRelatedTests({
      cwd: repo,
      changedFiles: ["tests/fixtures/plan.json", "tests/helpers/sandbox.mjs"],
      trackedFiles: [...tracked, "tests/fixtures/plan.json", "tests/helpers/sandbox.mjs"],
      blastRadius: () => ({ files: [], tests: ["tests/helpers/sandbox.mjs"], depth: 3, truncated: false }),
    });
    expect(out.tests).toEqual([]);
  });

  it("ignores changed files that no longer exist in the tracked list for naming", () => {
    const out = findRelatedTests({ cwd: repo, changedFiles: ["docs/guide.md"], trackedFiles: tracked, blastRadius: () => null });
    expect(out.tests).toEqual([]);
  });
});

describe("buildImpactCommands", () => {
  it("runs JS/TS tests with vitest when the project uses it", () => {
    write("package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    expect(buildImpactCommands({ cwd: repo, tests: ["tests/a.test.mjs", "tests/b c.test.mjs"], config: { command: null } }))
      .toEqual({ commands: ['npx vitest run "tests/a.test.mjs" "tests/b c.test.mjs"'] });
  });

  it("uses jest when that is the runner", () => {
    write("package.json", JSON.stringify({ devDependencies: { jest: "^30.0.0" } }));
    expect(buildImpactCommands({ cwd: repo, tests: ["a.spec.ts"], config: { command: null } }).commands).toEqual(['npx jest "a.spec.ts"']);
  });

  it("runs each workspace package's tests with that package's runner", () => {
    write("package.json", JSON.stringify({ workspaces: ["pkg-a", "pkg-b"] }));
    write("pkg-a/package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    write("pkg-b/package.json", JSON.stringify({ devDependencies: { jest: "^30.0.0" } }));
    expect(buildImpactCommands({ cwd: repo, tests: ["pkg-a/tests/x.test.mjs", "pkg-b/src/y.spec.ts", "pkg-a/tests/deep/z.test.mjs"], config: { command: null } }).commands)
      .toEqual([
        'npx --prefix pkg-a vitest run "pkg-a/tests/x.test.mjs" "pkg-a/tests/deep/z.test.mjs"',
        'npx --prefix pkg-b jest "pkg-b/src/y.spec.ts"',
      ]);
  });

  it("runs pytest, go test per package, and dotnet test filtered to the test classes", () => {
    write("tests/Api.Tests/Api.Tests.csproj", "<Project />");
    const out = buildImpactCommands({
      cwd: repo,
      tests: ["app/tests/test_models.py", "svc/handler_test.go", "svc/sub/x_test.go", "tests/Api.Tests/ClientServiceTests.cs", "tests/Api.Tests/Billing/InvoiceTests.cs"],
      config: { command: null },
    });
    expect(out.commands).toEqual([
      'python -m pytest "app/tests/test_models.py"',
      "go test ./svc ./svc/sub",
      'dotnet test "tests/Api.Tests/Api.Tests.csproj" --filter "FullyQualifiedName~ClientServiceTests|FullyQualifiedName~InvoiceTests"',
    ]);
  });

  it("prefers a configured command with a {files} placeholder", () => {
    expect(buildImpactCommands({ cwd: repo, tests: ["t/a_spec.rb"], config: { command: "bundle exec rspec {files}" } }))
      .toEqual({ commands: ['bundle exec rspec "t/a_spec.rb"'] });
  });

  it("explains when no runner is known", () => {
    const out = buildImpactCommands({ cwd: repo, tests: ["spec/user_spec.rb"], config: { command: null } });
    expect(out.commands).toEqual([]);
    expect(out.skipped).toMatch(/spec\/user_spec\.rb/);
    expect(out.skipped).toMatch(/impactGate\.command/);
  });
});

describe("runImpactGate", () => {
  const config = { mode: "block", command: null, maxTests: 2 };

  beforeEach(() => {
    write("package.json", JSON.stringify({ devDependencies: { vitest: "^4.0.0" } }));
    commitAll("tooling");
  });

  it("runs the related tests and reports success", () => {
    const base = git(repo, "rev-parse", "HEAD");
    write("src/auth.mjs");
    write("tests/auth.test.mjs");
    commitAll("slice");
    const runGateFn = vi.fn(() => ({ success: true, output: "ok" }));
    const out = runImpactGate({ cwd: repo, sinceSha: base, config, runGateFn, blastRadius: () => null });
    expect(out).toMatchObject({ ran: true, success: true, tests: ["tests/auth.test.mjs"], truncated: false });
    expect(runGateFn).toHaveBeenCalledWith('npx vitest run "tests/auth.test.mjs"', repo);
  });

  it("reports the failing command and caps the test list", () => {
    const base = git(repo, "rev-parse", "HEAD");
    write("tests/a.test.mjs"); write("tests/b.test.mjs"); write("tests/c.test.mjs");
    commitAll("slice");
    const runGateFn = vi.fn(() => ({ success: false, output: "1 failed" }));
    const out = runImpactGate({ cwd: repo, sinceSha: base, config, runGateFn, blastRadius: () => null });
    expect(out).toMatchObject({ ran: true, success: false, truncated: true, output: "1 failed" });
    expect(out.tests).toHaveLength(2);
    expect(out.failedCommand).toContain("npx vitest run");
  });

  it("does nothing when off, when nothing changed, or with no related tests", () => {
    const base = git(repo, "rev-parse", "HEAD");
    const runGateFn = vi.fn();
    expect(runImpactGate({ cwd: repo, sinceSha: base, config: { ...config, mode: "off" }, runGateFn })).toMatchObject({ ran: false, success: true });
    expect(runImpactGate({ cwd: repo, sinceSha: base, config, runGateFn, blastRadius: () => null })).toMatchObject({ ran: false, success: true, reason: expect.stringMatching(/no files changed/) });
    write("docs/guide.md"); commitAll("docs");
    expect(runImpactGate({ cwd: repo, sinceSha: base, config, runGateFn, blastRadius: () => null })).toMatchObject({ ran: false, success: true, reason: expect.stringMatching(/no related tests/) });
    expect(runGateFn).not.toHaveBeenCalled();
  });
});

// End to end through the orchestrator's gate step, with a real git repo and a
// configured impact command (a Node script) instead of a real test runner.
describe("runSliceGates — slice gate, then impact gate", () => {
  const CHECK = "const bad = process.argv.slice(2).filter((f) => f.includes('broken')); if (bad.length) { console.log('FAIL ' + bad.join(' ')); process.exit(1); } console.log('ok');";

  beforeEach(() => {
    write("check.cjs", CHECK);
    commitAll("tooling");
  });

  const configure = (impactGate) => { write(".forge.json", JSON.stringify({ impactGate })); commitAll("config"); };
  const slice = { number: "1", validationGate: 'node -e "process.exit(0)"' };

  it("fails the slice when a related test fails in block mode, and names it", () => {
    configure({ mode: "block", command: "node check.cjs {files}" });
    const start = git(repo, "rev-parse", "HEAD");
    write("src/parser.mjs"); write("tests/parser-broken.test.mjs"); commitAll("slice work");
    const r = runSliceGates({ slice, cwd: repo, sliceStartHead: start });
    expect(r.success).toBe(false);
    expect(r.failedCommand).toBe('node check.cjs "tests/parser-broken.test.mjs"');
    expect(r.output).toMatch(/^Impact gate: tests related to this slice's changes failed \(1 test file\(s\)\)/);
    expect(r.output).toContain("FAIL tests/parser-broken.test.mjs");
  });

  it("passes the slice in warn mode but records the failure", () => {
    configure({ mode: "warn", command: "node check.cjs {files}" });
    const start = git(repo, "rev-parse", "HEAD");
    write("tests/parser-broken.test.mjs"); commitAll("slice work");
    const r = runSliceGates({ slice, cwd: repo, sliceStartHead: start });
    expect(r.success).toBe(true);
    expect(r.impact).toMatchObject({ ran: true, success: false });
  });

  it("never runs the impact gate when the slice's own gate fails", () => {
    configure({ mode: "block", command: "node check.cjs {files}" });
    const start = git(repo, "rev-parse", "HEAD");
    write("tests/parser-broken.test.mjs"); commitAll("slice work");
    const r = runSliceGates({ slice: { number: "1", validationGate: 'node -e "process.exit(3)"' }, cwd: repo, sliceStartHead: start });
    expect(r.success).toBe(false);
    expect(r.failedCommand).toBe('node -e "process.exit(3)"');
    expect(r.impact).toBeUndefined();
  });
});