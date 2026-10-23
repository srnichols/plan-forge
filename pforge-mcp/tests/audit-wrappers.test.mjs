import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Meta-bugs #341 and #349 — the Windows architecture and duplication audit
 * wrappers started `npx.cmd`, which current Node refuses to spawn without a
 * shell (EINVAL), then exited 0 anyway:
 *
 *   #341  scan-architecture.mjs wrote two EINVAL errors and "cycles: []".
 *   #349  run-jscpd.mjs found no report, took the largest JSON file in the raw
 *         directory (eslint-report.json) and wrote its 1,180 lint rows as clones.
 *
 * Both now run the installed CLI with `node <entry>` and no shell, and exit 1
 * whenever the scan did not run, so an empty report can no longer pass for a
 * clean one. The wrappers take their project root from the working directory,
 * so these tests run them against a throwaway project with stub CLIs.
 *
 * Meta-bug #370 — run-eslint-clean-code.mjs had the same hole: an ESLint that
 * failed (exit 2, or a crash that still exited 1) was written up as an empty
 * report and exit 0, replacing whatever findings the report held before.
 */

const AUDIT_DIR = resolve(import.meta.dirname, "..", "..", "scripts", "audit");

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "pf-audit-wrappers-"));
  dirs.push(root);
  const rawDir = join(root, "raw");
  mkdirSync(join(root, "scripts", "audit"), { recursive: true });
  writeFileSync(join(root, "scripts", "audit", "layer-policy.json"), JSON.stringify({
    layers: [], crossPackageWhitelist: [], flagCrossPackage: true,
  }));
  return { root, rawDir };
}

/** A fake `node_modules/<pkg>` whose bin is a small node script. */
function installStub(root, pkg, source) {
  const bin = "bin/cli.js";
  const dir = join(root, "node_modules", pkg);
  mkdirSync(join(dir, dirname(bin)), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg, version: "0.0.0", bin: { [pkg]: bin } }));
  writeFileSync(join(dir, bin), source);
}

function run(script, { root, rawDir }) {
  return spawnSync(process.execPath, [join(AUDIT_DIR, script)], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, PFORGE_AUDIT_RAW_DIR: rawDir },
  });
}

const readReport = ({ rawDir }, name) => JSON.parse(readFileSync(join(rawDir, name), "utf8"));

// madge prints a graph keyed relative to the scanned directory, including
// files it reaches outside that directory ("../pforge-mcp/enums.mjs").
const madgeStub = (graphsByRoot) => `
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const argv = process.argv.slice(2);
writeFileSync(join(process.cwd(), "madge-argv-" + argv[argv.length - 1] + ".json"), JSON.stringify(argv));
const graphs = ${JSON.stringify(graphsByRoot)};
process.stdout.write(JSON.stringify(graphs[argv[argv.length - 1]] ?? {}));
`;

describe("scan-architecture.mjs (#341)", () => {
  let project;
  beforeEach(() => { project = makeProject(); });

  it("reads madge's graph through the installed CLI and reports a cycle", () => {
    installStub(project.root, "madge", madgeStub({
      "pforge-mcp": { "a.mjs": ["b.mjs"], "b.mjs": ["a.mjs"], "c.mjs": [] },
      "pforge-master": { "x.mjs": [] },
    }));
    const result = run("scan-architecture.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    const report = readReport(project, "architecture-report.json");
    expect(report.errors).toEqual([]);
    expect(report.cycles).toEqual([{ files: ["pforge-mcp/a.mjs", "pforge-mcp/b.mjs"], size: 2 }]);
  });

  it("asks madge for .mjs files: its default reads .js only, which is 5 of 756 files here", () => {
    installStub(project.root, "madge", madgeStub({ "pforge-mcp": { "a.mjs": [] }, "pforge-master": { "x.mjs": [] } }));
    expect(run("scan-architecture.mjs", project).status).toBe(0);
    const argv = JSON.parse(readFileSync(join(project.root, "madge-argv-pforge-mcp.json"), "utf8"));
    const extensions = argv[argv.indexOf("--extensions") + 1];
    expect(extensions.split(",")).toEqual(expect.arrayContaining(["js", "mjs"]));
    expect(argv).toContain("--json");
  });

  it("resolves an import that leaves the scanned package against that package's root", () => {
    installStub(project.root, "madge", madgeStub({
      "pforge-mcp": { "enums.mjs": [] },
      "pforge-master": {
        "src/config.mjs": ["../pforge-mcp/enums.mjs"],
        "../pforge-mcp/enums.mjs": ["../pforge-master/src/config.mjs"],
      },
    }));
    const result = run("scan-architecture.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    const report = readReport(project, "architecture-report.json");
    expect(report.cycles).toEqual([{ files: ["pforge-master/src/config.mjs", "pforge-mcp/enums.mjs"], size: 2 }]);
    expect(report.crossLayerImports).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "pforge-master/src/config.mjs", target: "pforge-mcp/enums.mjs", reason: "cross-package" }),
      expect.objectContaining({ source: "pforge-mcp/enums.mjs", target: "pforge-master/src/config.mjs", reason: "cross-package" }),
    ]));
    expect(report.crossLayerImports).toHaveLength(2);
  });

  it("exits 1 and keeps the error when madge fails", () => {
    installStub(project.root, "madge", "console.error('boom'); process.exit(2);");
    const result = run("scan-architecture.mjs", project);
    expect(result.status).toBe(1);
    const report = readReport(project, "architecture-report.json");
    expect(report.errors).toHaveLength(2);
    expect(report.errors[0]).toMatchObject({ scanRoot: "pforge-mcp", exitCode: 2, stderr: "boom" });
    expect(report.errors[0].message).toMatch(/madge.*status 2/);
    expect(result.stderr).toMatch(/architecture scan incomplete/i);
  });

  it("exits 1 when madge is not installed", () => {
    const result = run("scan-architecture.mjs", project);
    expect(result.status).toBe(1);
    expect(readReport(project, "architecture-report.json").errors[0].message).toMatch(/madge is not installed/);
  });

  it("exits 1 when madge prints something that is not a graph", () => {
    installStub(project.root, "madge", "process.stdout.write('not json');");
    const result = run("scan-architecture.mjs", project);
    expect(result.status).toBe(1);
    expect(readReport(project, "architecture-report.json").errors[0].message).toMatch(/Unable to parse madge output/);
  });

  it("does not take an empty graph for a pass: a scan that found no files proved nothing", () => {
    installStub(project.root, "madge", madgeStub({ "pforge-mcp": { "a.mjs": [] }, "pforge-master": {} }));
    const result = run("scan-architecture.mjs", project);
    expect(result.status).toBe(1);
    const report = readReport(project, "architecture-report.json");
    expect(report.errors).toEqual([expect.objectContaining({ scanRoot: "pforge-master" })]);
    expect(report.errors[0].message).toMatch(/no source files/);
  });
});

const CLONE_PAIR = {
  format: "javascript",
  lines: 12,
  tokens: 90,
  firstFile: { name: "pforge-mcp/a.mjs", start: 1, end: 12 },
  secondFile: { name: "pforge-mcp/b.mjs", start: 3, end: 14 },
  fragment: "const x = 1;",
};

// jscpd's json reporter writes <--output>/jscpd-report.json.
const jscpdStub = ({ report, exit = 0, stderr = "" } = {}) => `
const { writeFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const argv = process.argv.slice(2);
writeFileSync(join(process.cwd(), "jscpd-argv.json"), JSON.stringify(argv));
const out = argv[argv.indexOf("--output") + 1];
${report === undefined ? "" : `mkdirSync(out, { recursive: true }); writeFileSync(join(out, "jscpd-report.json"), ${JSON.stringify(JSON.stringify(report))});`}
${stderr ? `process.stderr.write(${JSON.stringify(stderr)});` : ""}
process.exit(${exit});
`;

describe("run-jscpd.mjs (#349)", () => {
  let project;
  beforeEach(() => { project = makeProject(); });

  it("reads the clone pairs from jscpd's own report", () => {
    installStub(project.root, "jscpd", jscpdStub({ report: { statistics: { total: { clones: 1 } }, duplicates: [CLONE_PAIR] } }));
    const result = run("run-jscpd.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    const report = readReport(project, "duplication-report.json");
    expect(report.duplicates).toEqual([CLONE_PAIR]);
    expect(report).toMatchObject({ tool: "jscpd", tokenThreshold: 75, exitCode: 0 });
    expect(report.error).toBeUndefined();
  });

  it("passes the documented scan arguments", () => {
    installStub(project.root, "jscpd", jscpdStub({ report: { statistics: {}, duplicates: [] } }));
    expect(run("run-jscpd.mjs", project).status).toBe(0);
    const argv = JSON.parse(readFileSync(join(project.root, "jscpd-argv.json"), "utf8"));
    expect(argv[argv.indexOf("--min-tokens") + 1]).toBe("75");
    expect(argv[argv.indexOf("--reporters") + 1]).toBe("json");
    expect(argv[argv.indexOf("--ignore") + 1]).toBe("**/node_modules/**,**/tests/**,**/ui/**");
    expect(argv.slice(-4)).toEqual(["pforge-mcp", "pforge-master", "pforge.ps1", "pforge.sh"]);
  });

  it("reports a genuinely clean scan as clean", () => {
    installStub(project.root, "jscpd", jscpdStub({ report: { statistics: { total: { clones: 0 } }, duplicates: [] } }));
    const result = run("run-jscpd.mjs", project);
    expect(result.status).toBe(0);
    expect(readReport(project, "duplication-report.json")).toMatchObject({ duplicates: [], exitCode: 0 });
  });

  it("never mistakes another report in the raw directory for jscpd's (the 1,180 lint rows)", () => {
    mkdirSync(project.rawDir, { recursive: true });
    const lintRows = Array.from({ length: 1180 }, (_, i) => ({ filePath: `f${i}.mjs`, messages: [], errorCount: 0 }));
    writeFileSync(join(project.rawDir, "eslint-report.json"), JSON.stringify(lintRows));
    installStub(project.root, "jscpd", jscpdStub());
    const result = run("run-jscpd.mjs", project);
    expect(result.status).toBe(1);
    const report = readReport(project, "duplication-report.json");
    expect(report.duplicates).toEqual([]);
    expect(report.error).toMatch(/did not write jscpd-report\.json/);
  });

  it("reads jscpd's report even when a larger JSON file sits beside it", () => {
    mkdirSync(project.rawDir, { recursive: true });
    writeFileSync(join(project.rawDir, "eslint-report.json"), JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ filePath: `f${i}` }))));
    installStub(project.root, "jscpd", jscpdStub({ report: { statistics: {}, duplicates: [CLONE_PAIR] } }));
    const result = run("run-jscpd.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    expect(readReport(project, "duplication-report.json").duplicates).toEqual([CLONE_PAIR]);
  });

  it("does not reuse the report of an earlier run when this run wrote none", () => {
    mkdirSync(project.rawDir, { recursive: true });
    writeFileSync(join(project.rawDir, "jscpd-report.json"), JSON.stringify({ statistics: {}, duplicates: [CLONE_PAIR] }));
    installStub(project.root, "jscpd", jscpdStub());
    const result = run("run-jscpd.mjs", project);
    expect(result.status).toBe(1);
    expect(readReport(project, "duplication-report.json").duplicates).toEqual([]);
  });

  it("exits 1 and keeps the cause when jscpd fails", () => {
    installStub(project.root, "jscpd", jscpdStub({ exit: 2, stderr: "bad flag" }));
    const result = run("run-jscpd.mjs", project);
    expect(result.status).toBe(1);
    const report = readReport(project, "duplication-report.json");
    expect(report).toMatchObject({ duplicates: [], exitCode: 2, stderr: "bad flag" });
    expect(report.error).toMatch(/jscpd.*status 2/);
    expect(result.stderr).toMatch(/jscpd/);
  });

  it("exits 1 when jscpd is not installed", () => {
    const result = run("run-jscpd.mjs", project);
    expect(result.status).toBe(1);
    expect(readReport(project, "duplication-report.json").error).toMatch(/jscpd is not installed/);
  });

  it("rejects a report whose rows are not clone pairs", () => {
    installStub(project.root, "jscpd", jscpdStub({ report: { statistics: {}, duplicates: [{ filePath: "x.mjs", messages: [] }] } }));
    const result = run("run-jscpd.mjs", project);
    expect(result.status).toBe(1);
    const report = readReport(project, "duplication-report.json");
    expect(report.duplicates).toEqual([]);
    expect(report.error).toMatch(/not clone pairs/);
  });

  it("rejects a report that is not a jscpd report at all", () => {
    installStub(project.root, "jscpd", jscpdStub({ report: [{ filePath: "x.mjs" }] }));
    const result = run("run-jscpd.mjs", project);
    expect(result.status).toBe(1);
    expect(readReport(project, "duplication-report.json").error).toMatch(/not a jscpd report/);
    expect(existsSync(join(project.rawDir, "duplication-report.json"))).toBe(true);
  });
});

// ESLint's json formatter prints one entry per linted file, and the CLI exits 1 when a file has an error.
const eslintStub = ({ stdout, exit = 0, stderr = "" } = {}) => `
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
writeFileSync(join(process.cwd(), "eslint-argv.json"), JSON.stringify(process.argv.slice(2)));
${stdout === undefined ? "" : `process.stdout.write(${JSON.stringify(stdout)});`}
${stderr ? `process.stderr.write(${JSON.stringify(stderr)});` : ""}
process.exit(${exit});
`;

describe("run-eslint-clean-code.mjs (#370)", () => {
  let project;
  beforeEach(() => { project = makeProject(); });

  const findings = (root) => [{
    filePath: join(root, "pforge-mcp", "a.mjs"),
    messages: [{ ruleId: "clean-code/complexity-error", severity: 2, message: "too complex", line: 3, column: 1 }],
    errorCount: 1,
    warningCount: 0,
  }];
  const reportPath = ({ rawDir }) => join(rawDir, "eslint-report.json");
  const seedEarlierReport = (target) => {
    mkdirSync(target.rawDir, { recursive: true });
    writeFileSync(reportPath(target), JSON.stringify(findings(target.root)));
  };

  it("reports the violations ESLint found and still exits 0: the wrapper reports, it does not gate", () => {
    installStub(project.root, "eslint", eslintStub({ stdout: JSON.stringify(findings(project.root)), exit: 1 }));
    const result = run("run-eslint-clean-code.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    const report = readReport(project, "eslint-report.json");
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ filePath: "pforge-mcp/a.mjs", errorCount: 1 });
    expect(result.stdout).toMatch(/1 errors, 0 warnings across 1 files/);
  });

  it("reports a genuinely clean run as clean", () => {
    installStub(project.root, "eslint", eslintStub({ stdout: "[]" }));
    const result = run("run-eslint-clean-code.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    expect(readReport(project, "eslint-report.json")).toEqual([]);
  });

  it("passes the clean-code config, the json formatter and the scan globs", () => {
    installStub(project.root, "eslint", eslintStub({ stdout: "[]" }));
    expect(run("run-eslint-clean-code.mjs", project).status).toBe(0);
    const argv = JSON.parse(readFileSync(join(project.root, "eslint-argv.json"), "utf8"));
    expect(argv[argv.indexOf("--config") + 1].replace(/\\/g, "/")).toMatch(/scripts\/audit\/eslint-clean-code\.config\.mjs$/);
    expect(argv[argv.indexOf("--format") + 1]).toBe("json");
    expect(argv.slice(-3)).toEqual(["pforge-mcp/**/*.mjs", "pforge-master/**/*.mjs", "scripts/**/*.mjs"]);
  });

  it("exits 1 and keeps no report when ESLint hits a fatal error (exit 2)", () => {
    seedEarlierReport(project);
    installStub(project.root, "eslint", eslintStub({ exit: 2, stderr: "Oops! Something went wrong" }));
    const result = run("run-eslint-clean-code.mjs", project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ESLint scan failed.*status 2/);
    expect(result.stderr).toMatch(/Oops! Something went wrong/);
    expect(existsSync(reportPath(project)), "the earlier run's report must not stand in for this one").toBe(false);
  });

  it("exits 1 when ESLint exits 1 but printed no report: it died before linting", () => {
    seedEarlierReport(project);
    installStub(project.root, "eslint", eslintStub({ exit: 1, stderr: "Error: Cannot find module 'x'" }));
    const result = run("run-eslint-clean-code.mjs", project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ESLint scan failed/);
    expect(existsSync(reportPath(project))).toBe(false);
  });

  it.each([
    ["text", "not json"],
    ["a JSON object", JSON.stringify({ results: [] })],
  ])("exits 1 when ESLint prints %s instead of a report array", (_label, stdout) => {
    installStub(project.root, "eslint", eslintStub({ stdout }));
    const result = run("run-eslint-clean-code.mjs", project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ESLint scan failed/);
    expect(existsSync(reportPath(project))).toBe(false);
  });

  it("exits 1 when ESLint is not installed", () => {
    const result = run("run-eslint-clean-code.mjs", project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/eslint is not installed/);
  });
});
