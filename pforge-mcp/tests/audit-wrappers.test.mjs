import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { auditGlobs, auditRoots } from "../../scripts/audit/scan-roots.mjs";

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

// A graph for every root the script scans, so a test only describes the roots it is about.
const graphsFor = (overrides = {}) => Object.fromEntries(
  auditRoots("scan-architecture").map((scanRoot) => [scanRoot, overrides[scanRoot] ?? { "x.mjs": [] }]),
);

describe("scan-architecture.mjs (#341)", () => {
  let project;
  beforeEach(() => { project = makeProject(); });

  it("reads madge's graph through the installed CLI and reports a cycle", () => {
    installStub(project.root, "madge", madgeStub(graphsFor({
      "pforge-mcp": { "a.mjs": ["b.mjs"], "b.mjs": ["a.mjs"], "c.mjs": [] },
    })));
    const result = run("scan-architecture.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    const report = readReport(project, "architecture-report.json");
    expect(report.errors).toEqual([]);
    expect(report.cycles).toEqual([{ files: ["pforge-mcp/a.mjs", "pforge-mcp/b.mjs"], size: 2 }]);
  });

  it("asks madge for .mjs files: its default reads .js only, which is 5 of 756 files here", () => {
    installStub(project.root, "madge", madgeStub(graphsFor()));
    expect(run("scan-architecture.mjs", project).status).toBe(0);
    const argv = JSON.parse(readFileSync(join(project.root, "madge-argv-pforge-mcp.json"), "utf8"));
    const extensions = argv[argv.indexOf("--extensions") + 1];
    expect(extensions.split(",")).toEqual(expect.arrayContaining(["js", "mjs"]));
    expect(argv).toContain("--json");
  });

  it("scans every root of the shared table, pforge-sdk included (#382)", () => {
    installStub(project.root, "madge", madgeStub(graphsFor()));
    expect(run("scan-architecture.mjs", project).status).toBe(0);
    for (const scanRoot of auditRoots("scan-architecture")) {
      expect(existsSync(join(project.root, `madge-argv-${scanRoot}.json`)), `madge was not run on ${scanRoot}`).toBe(true);
    }
    expect(auditRoots("scan-architecture")).toContain("pforge-sdk");
  });

  it("resolves an import that leaves the scanned package against that package's root", () => {
    installStub(project.root, "madge", madgeStub(graphsFor({
      "pforge-mcp": { "enums.mjs": [] },
      "pforge-master": {
        "src/config.mjs": ["../pforge-mcp/enums.mjs"],
        "../pforge-mcp/enums.mjs": ["../pforge-master/src/config.mjs"],
      },
    })));
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
    expect(report.errors).toHaveLength(auditRoots("scan-architecture").length);
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
    installStub(project.root, "madge", madgeStub(graphsFor({ "pforge-master": {} })));
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
    const scanned = [...auditRoots("run-jscpd"), "pforge.ps1", "pforge.sh"];
    expect(argv.slice(-scanned.length)).toEqual(scanned);
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
    const globs = auditGlobs("run-eslint-clean-code");
    expect(argv.slice(-globs.length)).toEqual(globs);
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

// ─── long-param-walker.mjs and clean-code-review.mjs (#397) ──────────────────
//
// Meta-bug #397 — a CI-style install (npm install in pforge-mcp only) has neither acorn nor
// eslint at the repository root. long-param-walker.mjs then fell back to a regex that counts
// every comma inside a call's parentheses, nested calls and literals included, and reported 82
// long-parameter errors that are not there, while the ESLint category dropped out of the report
// without a word. The clean-code no-regression test failed on the false errors. A scanner that
// cannot run is now reported as unavailable, with its reason, and no scan guesses.

/** Copies audit scripts into the project's own scripts/audit, so acorn is resolved from the project and not from this repository. */
function installAuditScripts(root, names) {
  mkdirSync(join(root, "scripts", "audit"), { recursive: true });
  for (const name of names) copyFileSync(join(AUDIT_DIR, name), join(root, "scripts", "audit", name));
}

function runInstalled(script, { root, rawDir }, args = []) {
  return spawnSync(process.execPath, [join(root, "scripts", "audit", script), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, PFORGE_AUDIT_RAW_DIR: rawDir },
  });
}

/** A fake acorn whose parse() returns one call expression per entry, with that many arguments. */
function installAcornStub(root, argCounts) {
  const dir = join(root, "node_modules", "acorn");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "acorn", version: "0.0.0", main: "index.js" }));
  const body = argCounts.map((count, i) => ({
    type: "CallExpression",
    callee: { type: "Identifier", name: `call${i}` },
    arguments: Array.from({ length: count }, () => ({ type: "Literal" })),
    loc: { start: { line: i + 1, column: 0 } },
  }));
  writeFileSync(join(dir, "index.js"), `exports.parse = () => (${JSON.stringify({ type: "Program", body })});\n`);
}

// A call whose parentheses hold more than 100 characters and several commas, as the regex looks for.
const WIDE_CALL = `call(${["aaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccc", "dddddddddddddddddddd", "eeeeeeeeeeeeeeeeeeee", "ffffffffffffffffffff", "g"].join(", ")});\n`;

describe("long-param-walker.mjs (#397)", () => {
  let project;
  beforeEach(() => {
    project = makeProject();
    installAuditScripts(project.root, ["long-param-walker.mjs", "raw-dir.mjs", "scan-roots.mjs"]);
    mkdirSync(join(project.root, "pforge-mcp", "src"), { recursive: true });
    writeFileSync(join(project.root, "pforge-mcp", "src", "wide.mjs"), WIDE_CALL);
  });
  const reportPath = ({ rawDir }) => join(rawDir, "long-param-report.json");

  it("does not guess from a regex when acorn is not installed: it exits 1, says so and writes no report", () => {
    mkdirSync(project.rawDir, { recursive: true });
    writeFileSync(reportPath(project), JSON.stringify([{ file: "old.mjs", line: 1, callee: "f", argCount: 9 }]));
    const result = runInstalled("long-param-walker.mjs", project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/acorn is not installed/);
    expect(result.stderr).toMatch(/did not run/);
    expect(existsSync(reportPath(project)), "neither regex guesses nor an earlier run's report may stand in for the scan").toBe(false);
  });

  it("reads each call through acorn when it is installed, with no regex finding", () => {
    installAcornStub(project.root, [7, 3]);
    const result = runInstalled("long-param-walker.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(reportPath(project), "utf8"));
    expect(report).toEqual([{ file: "pforge-mcp/src/wide.mjs", line: 1, col: 0, callee: "call0", argCount: 7 }]);
    expect(JSON.stringify(report)).not.toContain("regex-fallback");
  });

  it("reports a clean scan as an empty report", () => {
    installAcornStub(project.root, [2, 5]);
    const result = runInstalled("long-param-walker.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(reportPath(project), "utf8"))).toEqual([]);
  });

  it("exits 1 and writes no report when the scan itself fails, instead of a report that is not a findings array", () => {
    installAcornStub(project.root, [7]);
    rmSync(join(project.root, "pforge-mcp"), { recursive: true });
    writeFileSync(join(project.root, "pforge-mcp"), "a file where the scan root should be a directory");
    mkdirSync(project.rawDir, { recursive: true });
    writeFileSync(reportPath(project), JSON.stringify([{ file: "old.mjs", line: 1, callee: "f", argCount: 9 }]));
    const result = runInstalled("long-param-walker.mjs", project);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/long-parameter scan failed/);
    expect(existsSync(reportPath(project))).toBe(false);
  });
});

describe("clean-code-review.mjs (#397)", () => {
  let project;
  beforeEach(() => {
    project = makeProject();
    installAuditScripts(project.root, ["clean-code-review.mjs", "raw-dir.mjs"]);
  });

  const stubScript = (name, source) => writeFileSync(join(project.root, "scripts", "audit", `${name}.mjs`), source);
  const WORKING_MODULE_SCAN = `
    import fs from 'node:fs'; import path from 'node:path';
    const raw = process.env.PFORGE_AUDIT_RAW_DIR; fs.mkdirSync(raw, { recursive: true });
    fs.writeFileSync(path.join(raw, 'module-metrics.json'), JSON.stringify([{ file: 'big.mjs', loc: 4000, g14Severity: 'high-severity' }]));
  `;
  const FAILING_LONG_PARAM_SCAN = "console.error('long-param-walker: acorn is not installed (a root npm install provides it), so the scan did not run'); process.exitCode = 1;";
  const earlierLongParamReport = () => {
    mkdirSync(project.rawDir, { recursive: true });
    writeFileSync(join(project.rawDir, "long-param-report.json"), JSON.stringify(
      Array.from({ length: 3 }, (_, i) => ({ file: "x.mjs", line: i + 1, callee: "f", argCount: 9 })),
    ));
  };
  const audit = (args = []) => {
    const out = join(project.root, "report.json");
    const result = runInstalled("clean-code-review.mjs", project, ["--out", out, ...args]);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    return JSON.parse(readFileSync(out, "utf8"));
  };

  it("reports a scanner that did not run as unavailable, with its reason, and never reads its earlier report", () => {
    stubScript("measure-modules", WORKING_MODULE_SCAN);
    stubScript("long-param-walker", FAILING_LONG_PARAM_SCAN);
    earlierLongParamReport();
    const report = audit();
    expect(report.categories["module-size"]).toMatchObject({ errorCount: 1, warnCount: 0 });
    expect(report.categories["module-size"].unavailable).toBeUndefined();
    expect(report.categories["long-params"]).toEqual({
      unavailable: true,
      reason: "long-param-walker: acorn is not installed (a root npm install provides it), so the scan did not run",
      errorCount: 0,
      warnCount: 0,
      findings: [],
    });
    expect(report.summary.totalErrors, "the earlier report's three errors must not be counted").toBe(1);
    expect(report.errors.map((e) => e.script)).toContain("long-param-walker");
  });

  it("reports every scanner it cannot find as unavailable too, ESLint's category included", () => {
    stubScript("measure-modules", WORKING_MODULE_SCAN);
    const { categories } = audit();
    for (const category of ["eslint-d-series", "long-params", "dead-exports", "test-smells", "shell-parity", "dep-boundaries", "frozen-arrays-drift", "markers", "commented-code", "console-log"]) {
      expect(categories[category], category).toMatchObject({ unavailable: true, reason: "Script not found" });
    }
  });

  it("names the unavailable scanners in its console summary instead of printing zero errors for them", () => {
    stubScript("measure-modules", WORKING_MODULE_SCAN);
    stubScript("long-param-walker", FAILING_LONG_PARAM_SCAN);
    const result = runInstalled("clean-code-review.mjs", project);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/long-params\s+│ unavailable: long-param-walker: acorn is not installed/);
    expect(result.stdout).toMatch(/eslint-d-series\s+│ unavailable: Script not found/);
    expect(result.stdout).toMatch(/module-size\s+│ errors: 1/);
  });

  it("says a baseline comparison covers only the scanners that ran", () => {
    stubScript("measure-modules", WORKING_MODULE_SCAN);
    const baseline = join(project.root, "baseline.json");
    writeFileSync(baseline, JSON.stringify({ summary: { totalErrors: 5 } }));
    const result = runInstalled("clean-code-review.mjs", project, ["--out", join(project.root, "report.json"), "--compare-baseline", baseline]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/No regression: 1 errors \(baseline: 5\)/);
    expect(result.stdout).toMatch(/NOTE: \d+ scanner\(s\) did not run \(.*long-params.*\); the comparison covers only the rest/);
  });

  it("does not mention unavailable scanners when every one ran", () => {
    for (const name of ["measure-modules", "grep-matrix", "run-eslint-clean-code", "long-param-walker", "dead-exports", "test-smells", "shell-parity", "dep-boundaries", "frozen-arrays-drift"]) {
      stubScript(name, name === "measure-modules" ? WORKING_MODULE_SCAN : "");
    }
    const report = audit();
    expect(Object.values(report.categories).filter((c) => c.unavailable)).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
