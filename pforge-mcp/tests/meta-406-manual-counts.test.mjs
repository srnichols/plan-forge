import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Meta-bug #406 — the manual said the MCP server has 106 tools when it registers 107, and
 * `docs/manual/maintain.mjs --audit`, the capabilities-drift workflow's gate, passed:
 *
 *   - nothing compared MANUAL_COUNTS.tools, a hand-kept number, with the registered tools;
 *   - only HIGH issues set the exit status, so the count drift (LOW) and the drift between
 *     glossary.html and glossary-terms.js (MEDIUM) never failed anything;
 *   - the glossary's tooltip terms were generated before the count tokens in glossary.html were
 *     rewritten, so one run left glossary-terms.js a count behind the page it came from.
 *
 * The fixture is a manual of two pages run through a copy of the real maintain.mjs, with a stand-in
 * for the tool registry, so each case sets the counts it needs.
 */

const REPO = resolve(import.meta.dirname, "..", "..");
const MAINTAIN = join(REPO, "docs", "manual", "maintain.mjs");
const sourceRepo = existsSync(MAINTAIN);

const dirs = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const page = (body) => `<!DOCTYPE html>
<html lang="en"><head><title>Page</title></head><body>
<aside id="manual-sidebar"></aside>
<main class="chapter-content">${body}</main>
<script src="assets/manual.js"></script>
</body></html>
`;

const manualJs = (tools) => `(function () {
  const CHAPTERS = [
    { id: "intro", file: "intro.html", title: "Intro", num: "", act: "" },
    { id: "glossary", file: "glossary.html", title: "Glossary", num: "", act: "" },
  ];
  const SEARCH_SECTIONS = [];
  const MANUAL_COUNTS = {
    tools:        ${tools}, // the registered MCP tools
    presets:      9,
  };
})();
`;

const glossary = (word, tools) => page(`<table><tr><td><strong>MCP</strong></td><td>${word} <!--c:tools-->${tools}<!--/c--> tools.</td></tr></table>`);
const registry = (count) => `export const TOOLS = Array.from({ length: ${count} }, (_, i) => ({ name: "tool_" + i }));\n`;
const CSS = "/* built css */\n";

/** A manual whose counts all say `tools` while the registry holds `registered`; glossary-terms.js is generated. */
function manualTree({ tools = 100, registered = tools } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pf-meta-406-"));
  dirs.push(root);
  const manual = join(root, "docs", "manual");
  const files = {
    js: join(manual, "assets", "manual.js"),
    intro: join(manual, "intro.html"),
    glossary: join(manual, "glossary.html"),
    terms: join(manual, "assets", "glossary-terms.js"),
    registry: join(root, "pforge-mcp", "server", "tool-definitions.mjs"),
  };
  mkdirSync(join(manual, "assets"), { recursive: true });
  mkdirSync(join(root, "docs", "assets"), { recursive: true });
  mkdirSync(join(root, "pforge-mcp", "server"), { recursive: true });
  copyFileSync(MAINTAIN, join(manual, "maintain.mjs"));
  writeFileSync(files.js, manualJs(tools));
  writeFileSync(files.intro, page(`<p>The server has <!--c:tools-->${tools}<!--/c--> tools.</p>`));
  writeFileSync(files.glossary, glossary("Exposes", tools));
  writeFileSync(join(root, "docs", "assets", "tailwind.built.css"), CSS);
  writeFileSync(join(root, "docs", "assets", "tailwind.built.css.sha256"), createHash("sha256").update(CSS).digest("hex"));
  writeFileSync(files.registry, registry(registered));
  const tree = { manual, files, read: (name) => readFileSync(files[name], "utf8") };
  const first = maintain(tree);
  expect(first.status, first.output).toBe(0);
  return tree;
}

function maintain(tree, ...args) {
  const run = spawnSync(process.execPath, [join(tree.manual, "maintain.mjs"), ...args], { encoding: "utf8", timeout: 60_000 });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const snapshot = (tree) => Object.keys(tree.files).map((name) => tree.read(name));

describe.skipIf(!sourceRepo)("maintain.mjs keeps the manual's counts in step with the tool registry (#406)", () => {
  it("audits clean when the manual, its pages and the glossary agree with the registered tools", () => {
    const tree = manualTree();
    const audit = maintain(tree, "--audit");
    expect(audit.status, audit.output).toBe(0);
    expect(audit.output).toContain("All checks passed");
  }, 60_000);

  it("fails an audit, and writes nothing, when MANUAL_COUNTS.tools is not the registered tool count", () => {
    const tree = manualTree({ tools: 100 });
    writeFileSync(tree.files.registry, registry(101));
    const before = snapshot(tree);
    const audit = maintain(tree, "--audit");
    expect(audit.status, audit.output).toBe(1);
    expect(audit.output).toContain("MANUAL_COUNTS.tools is 100, but the MCP server registers 101 tools");
    expect(snapshot(tree)).toEqual(before);
  }, 60_000);

  it("takes a changed registry through MANUAL_COUNTS, the page tokens, the glossary and its tooltip terms in one run", () => {
    const tree = manualTree({ tools: 100 });
    writeFileSync(tree.files.registry, registry(101));
    const run = maintain(tree);
    expect(run.status, run.output).toBe(0);
    expect(tree.read("js")).toMatch(/^\s*tools:\s+101,/m);
    expect(tree.read("intro")).toContain("<!--c:tools-->101<!--/c-->");
    expect(tree.read("glossary")).toContain("<!--c:tools-->101<!--/c-->");
    expect(tree.read("terms")).toContain("Exposes 101 tools.");
    const audit = maintain(tree, "--audit");
    expect(audit.status, audit.output).toBe(0);
  }, 60_000);

  it("takes a count changed by hand in MANUAL_COUNTS to the glossary's tooltip terms in one run", () => {
    const tree = manualTree({ tools: 100 });
    writeFileSync(tree.files.js, manualJs(101));
    writeFileSync(tree.files.registry, registry(101));
    const run = maintain(tree);
    expect(run.status, run.output).toBe(0);
    expect(tree.read("glossary")).toContain("<!--c:tools-->101<!--/c-->");
    expect(tree.read("terms")).toContain("Exposes 101 tools.");
    const audit = maintain(tree, "--audit");
    expect(audit.status, audit.output).toBe(0);
  }, 60_000);

  it("fails an audit on a page whose count token has drifted", () => {
    const tree = manualTree();
    writeFileSync(tree.files.intro, page("<p>The server has <!--c:tools-->99<!--/c--> tools.</p>"));
    const audit = maintain(tree, "--audit");
    expect(audit.status, audit.output).toBe(1);
    expect(audit.output).toContain("Drift in <!--c:tools-->: file has '99', source-of-truth says '100'");
  }, 60_000);

  it("fails an audit when the tooltip terms lag the glossary", () => {
    const tree = manualTree();
    writeFileSync(tree.files.glossary, glossary("Serves", 100));
    const audit = maintain(tree, "--audit");
    expect(audit.status, audit.output).toBe(1);
    expect(audit.output).toContain("Drift between glossary.html and assets/glossary-terms.js");
  }, 60_000);

  it("reports a glossary count token whose key is unknown and keeps its text in the tooltip terms", () => {
    const tree = manualTree();
    writeFileSync(tree.files.glossary, glossary("Exposes", 100).replace("tools.", "tools, <!--c:nope-->7<!--/c--> ways."));
    const run = maintain(tree);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain("Unknown count key '<!--c:nope-->'");
    expect(tree.read("terms")).toContain("Exposes 100 tools, 7 ways.");
  }, 60_000);

  it.each([
    ["is missing", null, "Cannot find module"],
    ["does not export TOOLS", "export const OTHER = [];\n", "TOOLS is not an array"],
    ["exports TOOLS that is not an array", "export const TOOLS = 5;\n", "TOOLS is not an array"],
    ["throws when it loads", 'throw new Error("boom");\n', "boom"],
  ])("fails an audit and a run when the tool registry %s", (_what, source, message) => {
    const tree = manualTree();
    if (source === null) rmSync(tree.files.registry);
    else writeFileSync(tree.files.registry, source);
    for (const args of [["--audit"], []]) {
      const run = maintain(tree, ...args);
      expect(run.status, run.output).toBe(1);
      expect(run.output).toContain("Cannot read the registered tool count");
      expect(run.output).toContain(message);
    }
  }, 60_000);

  it("fails a run that cannot find the tools entry of MANUAL_COUNTS to update", () => {
    const tree = manualTree();
    writeFileSync(tree.files.js, manualJs(100).replace(/^\s*tools:.*\n/m, ""));
    writeFileSync(tree.files.registry, registry(101));
    const run = maintain(tree);
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain("Could not find the 'tools:' entry of MANUAL_COUNTS to update");
  }, 60_000);
});

describe.skipIf(!sourceRepo)("this repository's manual and metrics follow the tool registry (#406)", () => {
  const readJson = (...segments) => JSON.parse(readFileSync(join(REPO, ...segments), "utf8"));

  it("MANUAL_COUNTS.tools is the number of tools the MCP server registers", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    const declared = Number(/^\s*tools:\s+(\d+),/m.exec(readFileSync(join(REPO, "docs", "manual", "assets", "manual.js"), "utf8"))?.[1]);
    expect(declared, "run `node docs/manual/maintain.mjs` to update it").toBe(TOOLS.length);
  });

  it("docs/_metrics.json mcpTools.total is the number of tools the MCP server registers", async () => {
    const { TOOLS } = await import("../server/tool-definitions.mjs");
    expect(
      readJson("docs", "_metrics.json").mcpTools.total,
      "update docs/_metrics.json, add the old total to _knownStaleAliases.mcpTools, then run `pwsh scripts/check-metrics.ps1 -Strict`",
    ).toBe(TOOLS.length);
  });

  it("maintain.mjs --audit has nothing to report", () => {
    const run = spawnSync(process.execPath, [MAINTAIN, "--audit", "--quiet"], { encoding: "utf8", timeout: 60_000 });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  }, 60_000);
});
