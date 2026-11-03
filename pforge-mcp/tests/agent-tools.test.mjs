/**
 * Pipeline agents that write files must be able to create them (#449).
 *
 * The agent templates name their tools in `tools:`. The Copilot CLI and SDK resolve each name through an alias
 * table. In it VS Code's `editFiles` stands for the edit tools alone (`str_replace_editor`, `edit`) and leaves
 * out `create`; `edit`, the alias GitHub and VS Code both document, stands for all of them (`apply_patch`,
 * `str_replace_editor`, `create`, `edit`). An Executor started with `editFiles` could change a file but not make
 * one, so every slice that added a test, script or fixture stopped with a blocker report.
 *
 * The other agents in the templates, the plugin and the presets are reviewers and helpers. They may list only the
 * names the shipped ones use today (reading, searching, running commands, and `agents`), so no spelling of editing
 * a file gets through and a new name has to be decided on purpose.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const toPosix = (path) => path.split("\\").join("/");

const WRITERS = Object.freeze(["executor", "plan-hardener", "shipper", "specifier"]);
const WRITER_DIRS = Object.freeze(["templates/.github/agents", "plugins/plan-forge/com.github.copilot/agents"]);

// What an agent that is not a pipeline writer may list: the names the shipped ones use. A list of the ways to edit a
// file would miss a spelling (`edit/editFiles`, `create` and `apply_patch` each work in some runtime), so a name that
// is not here fails and has to be decided on purpose. That includes the documented aliases nothing uses yet:
// `agent` would let a reviewer start a sub-agent that has every tool. `agents` is here because the pipeline agents
// list it; it is not a key in the CLI's alias table (`agent` is), so it grants nothing there. The Swift test runner's
// `run_in_terminal` matched no tool in CLI 1.0.80, so it had no shell and could not run a test. Running commands can
// write a file; these agents are held to what they are for by their instructions, not by this list.
const NON_WRITER_TOOLS = Object.freeze(["read", "search", "runCommands", "agents"]);

function agentsIn(dir) {
  const full = join(REPO_ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((name) => name.endsWith(".agent.md")).sort().map((name) => toPosix(join(dir, name)));
}

function presetAgentDirs() {
  return readdirSync(join(REPO_ROOT, "presets"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `presets/${entry.name}/.github/agents`);
}

/** The names in an agent's `tools:`, whether it is written inline (`[a, b]`) or as a block list. */
function toolsOf(relPath) {
  const text = readFileSync(join(REPO_ROOT, relPath), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const inline = frontmatter.match(/^tools:\s*\[([^\]]*)\]/m);
  if (inline) return inline[1].split(",").map((name) => name.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const block = frontmatter.match(/^tools:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m);
  return block ? block[1].split("\n").map((line) => line.replace(/^\s*-\s*/, "").trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : [];
}

const nameOf = (relPath) => relPath.split("/").pop().replace(/\.agent\.md$/, "");
const writerFiles = WRITER_DIRS.flatMap(agentsIn).filter((path) => WRITERS.includes(nameOf(path)));
const readOnlyFiles = [
  ...WRITER_DIRS.flatMap(agentsIn).filter((path) => !WRITERS.includes(nameOf(path))),
  ...presetAgentDirs().flatMap(agentsIn),
];

describe("the agent files this suite reads", () => {
  it("are all there, so the checks below are not vacuous", () => {
    expect(writerFiles).toHaveLength(WRITERS.length * WRITER_DIRS.length);
    expect(readOnlyFiles.length).toBeGreaterThan(40);
    for (const path of [...writerFiles, ...readOnlyFiles]) expect(toolsOf(path).length, `${path} lists no tools`).toBeGreaterThan(0);
  });

  it("start with their frontmatter, with no byte-order mark in front of it", () => {
    // A runtime that does not skip the mark finds no frontmatter, so a reviewer would lose its tools list and its read-only limit.
    const marked = [...writerFiles, ...readOnlyFiles].filter((path) => readFileSync(join(REPO_ROOT, path), "utf8").startsWith("\uFEFF"));
    expect(marked).toEqual([]);
  });
});

describe.each(writerFiles)("%s", (path) => {
  it("lists the edit alias, which covers creating files", () => {
    expect(toolsOf(path)).toContain("edit");
  });

  it("does not list editFiles, which the Copilot CLI maps without file creation", () => {
    expect(toolsOf(path)).not.toContain("editFiles");
  });
});

describe("agents that are not pipeline writers", () => {
  it("list only the reading, searching and command tools the shipped agents use", () => {
    const offenders = readOnlyFiles
      .map((path) => ({ path, unknown: toolsOf(path).filter((name) => !NON_WRITER_TOOLS.includes(name)) }))
      .filter(({ unknown }) => unknown.length > 0)
      .map(({ path, unknown }) => `${path}: ${unknown.join(", ")}`);
    expect(
      offenders,
      "These agents list a tool outside NON_WRITER_TOOLS. Add a name there only if it grants none of the file-editing tools, cannot start a sub-agent with more tools, and the Copilot CLI resolves it.",
    ).toEqual([]);
  });
});

describe("the agents table in templates/AGENTS.md.template", () => {
  const ROW = /^\|[^|]*\| `\.github\/agents\/([\w-]+)\.agent\.md` \|[^|]*\| ([^|]*) \|$/;
  const rows = readFileSync(join(REPO_ROOT, "templates", "AGENTS.md.template"), "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.match(ROW))
    .filter(Boolean)
    .map(([, name, tools]) => ({ name, tools: tools.split(",").map((tool) => tool.trim()).sort() }));

  it("has a row for each pipeline agent", () => {
    expect(rows.map((row) => row.name).sort()).toEqual([...WRITERS, "reviewer-gate"].sort());
  });

  it.each(rows)("lists the tools of $name that its template lists", ({ name, tools }) => {
    expect(tools).toEqual([...toolsOf(`templates/.github/agents/${name}.agent.md`)].sort());
  });
});
