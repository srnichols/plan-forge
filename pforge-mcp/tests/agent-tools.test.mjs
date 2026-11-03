/**
 * Pipeline agents that write files must be able to create them (#449).
 *
 * The agent templates name their tools in `tools:`. The Copilot CLI and SDK resolve each name through an alias
 * table. In it VS Code's `editFiles` stands for the edit tools alone (`str_replace_editor`, `edit`) and leaves
 * out `create`; `edit`, the alias GitHub and VS Code both document, stands for all of them (`apply_patch`,
 * `str_replace_editor`, `create`, `edit`). An Executor started with `editFiles` could change a file but not make
 * one, so every slice that added a test, script or fixture stopped with a blocker report.
 *
 * The other agents are reviewers and must stay read-only, in whichever spelling a runtime accepts.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const toPosix = (path) => path.split("\\").join("/");

const WRITERS = Object.freeze(["executor", "plan-hardener", "shipper", "specifier"]);
const WRITER_DIRS = Object.freeze(["templates/.github/agents", "plugins/plan-forge/com.github.copilot/agents"]);

// Every name under which a runtime grants the right to change or create a file.
const WRITE_TOOLS = Object.freeze(["edit", "editFiles", "createFile", "createDirectory", "Edit", "MultiEdit", "Write", "NotebookEdit"]);

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
  it("stay read-only", () => {
    const offenders = readOnlyFiles
      .map((path) => ({ path, granted: toolsOf(path).filter((name) => WRITE_TOOLS.includes(name)) }))
      .filter(({ granted }) => granted.length > 0)
      .map(({ path, granted }) => `${path}: ${granted.join(", ")}`);
    expect(offenders).toEqual([]);
  });
});
