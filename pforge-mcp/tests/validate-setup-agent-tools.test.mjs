/**
 * validate-setup warns about a tool name in an agent file that gives the agent less in the Copilot CLI than it lists.
 *
 * `pforge update` replaces an agent file nobody edited and keeps one that was edited, so a project that edited the
 * Executor (or any file that listed `editFiles`) still has the name that cannot create a file in the Copilot CLI
 * (#449), and nothing told its owner. `pforge check` runs validate-setup, and so does the `forge_validate` tool.
 *
 * Measured with Copilot CLI 1.0.106: an agent listing `editFiles` got `edit` and no `create`; one listing
 * `run_in_terminal` and `read_file` got no shell and no search. The warning names only those three names, which Plan
 * Forge itself once shipped. `runCommands` and `agents` are shipped today, so they must not be warned about.
 */

import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SHELLS } from "./helpers/validate-setup-shells.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const ANSI = /\x1b\[[0-9;]*m/g;

const tmpDirs = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project with the given agent files (name → text). `custom` keeps the stack-specific file checks out of the way. */
function project(agents = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pf-validate-tools-"));
  tmpDirs.push(dir);
  writeFileSync(join(dir, ".forge.json"), `${JSON.stringify({ projectName: "Acme", preset: "custom", templateVersion: "9.9.9" })}\n`);
  if (Object.keys(agents).length > 0) mkdirSync(join(dir, ".github", "agents"), { recursive: true });
  for (const [name, text] of Object.entries(agents)) {
    const file = join(dir, ".github", "agents", name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return dir;
}

const agent = (toolsLine, body = "Body text.\n") => `---\nname: Probe\ndescription: A probe.\n${toolsLine}\n---\n${body}`;
const outputOf = (run) => `${run.stdout}${run.stderr}`.replace(ANSI, "");

const SAME_LIST_IN_OTHER_FORMS = [
  ["a block list", agent("tools:\n  - read\n  - editFiles\n  - runCommands")],
  ["quoted names", agent(`tools: ['read', "editFiles", 'runCommands']`)],
  ["Windows line endings", agent("tools: [read, editFiles]").replace(/\n/g, "\r\n")],
  ["a byte-order mark", `\uFEFF${agent("tools: [read, editFiles]")}`],
  ["a trailing comment", agent("tools: [read, editFiles] # edits only")],
  ["a list in brackets over several lines, as Prettier writes one that is too long for a line", agent("tools:\n  [\n    read,\n    editFiles,\n  ]")],
  ["a list in brackets on the line after tools:", agent("tools:\n  [read, editFiles]")],
  ["a list in brackets that closes on its last name", agent("tools: [read,\n  editFiles]")],
  ["comments inside a list in brackets", agent("tools:\n  [\n    read, # reads\n    editFiles # edits\n  ]")],
  ["a block list after a comment on the tools: line", agent("tools: # the list\n  - read\n  - editFiles")],
  ["blank and comment lines inside a block list", agent("tools:\n\n  # note\n  - read\n\n  - editFiles")],
  ["spaces inside the quotes", agent(`tools: [' editFiles ']`)],
];

for (const shell of SHELLS) {
  describe.skipIf(!shell.available)(`${shell.name}: tool names in agent files`, () => {
    it("warns for editFiles, naming the file, the tool and what to use, and still reaches the summary", () => {
      const out = outputOf(shell.run(project({ "executor.agent.md": agent("tools: [read, search, editFiles, runCommands]", "Use editFiles to change files.\n") })));
      expect(out).toMatch(/WARN\s+\.github\/agents\/executor\.agent\.md lists 'editFiles': in the Copilot CLI it cannot create a file\. Use 'edit'\./);
      expect(out).not.toMatch(/FAIL\s+\.github\/agents\/executor\.agent\.md/);
      expect(out, "a list with a warning has no pass line").not.toMatch(/PASS\s+\.github\/agents\/ tool names/);
      expect(out, "the run reaches its summary").toMatch(/Results:\s+\d+ passed/);
    }, 180_000);

    it("warns for run_in_terminal and read_file, the names the Swift test runner once listed", () => {
      const out = outputOf(shell.run(project({ "test-runner.agent.md": agent("tools: [run_in_terminal, read_file]") })));
      expect(out).toMatch(/WARN\s+\.github\/agents\/test-runner\.agent\.md lists 'run_in_terminal': the Copilot CLI gives the agent no shell for it\. Use 'runCommands'\./);
      expect(out).toMatch(/WARN\s+\.github\/agents\/test-runner\.agent\.md lists 'read_file': the Copilot CLI has no tool of that name\. Use 'read'\./);
    }, 180_000);

    it("says how a kept file is brought up to date", () => {
      const out = outputOf(shell.run(project({ "executor.agent.md": agent("tools: [editFiles]") })));
      expect(out).toMatch(/pforge update replaces an agent file you have not edited; one you edited is kept, with the new copy under \.forge\/update-pending\//);
    }, 180_000);

    it.each(SAME_LIST_IN_OTHER_FORMS)("finds editFiles written as %s", (_label, text) => {
      const out = outputOf(shell.run(project({ "executor.agent.md": text })));
      expect(out).toMatch(/WARN\s+\.github\/agents\/executor\.agent\.md lists 'editFiles'/);
    }, 180_000);

    it("passes every agent file Plan Forge ships, `agents` and `runCommands` included", () => {
      const shipped = [];
      for (const dir of ["templates", "presets/shared", "presets/swift", "presets/typescript"]) {
        const full = join(REPO_ROOT, dir, ".github", "agents");
        for (const file of readdirSync(full).filter((name) => name.endsWith(".agent.md"))) shipped.push({ from: join(full, file), as: `${dir.replace("/", "-")}-${file}` });
      }
      const dir = project();
      mkdirSync(join(dir, ".github", "agents"), { recursive: true });
      for (const { from, as } of shipped) copyFileSync(from, join(dir, ".github", "agents", as));
      const out = outputOf(shell.run(dir));
      expect(out).not.toMatch(/lists '/);
      expect(out).toContain(`PASS  .github/agents/ tool names (${shipped.length} agent files, none that fails in the Copilot CLI)`);
    }, 180_000);

    it("counts each warning, and the pass for a clean list, in the summary", () => {
      const tally = (text) => {
        const [, passed, , warnings] = outputOf(shell.run(project({ "probe.agent.md": agent(text) }))).match(/Results:\s+(\d+) passed\s+\|\s+(\d+) failed\s+\|\s+(\d+) warnings/) ?? [];
        return { passed: Number(passed), warnings: Number(warnings) };
      };
      const clean = tally("tools: [read, search, runCommands]");
      const flagged = tally("tools: [run_in_terminal, read_file]");
      expect(flagged.warnings - clean.warnings, "one warning for each name").toBe(2);
      expect(clean.passed - flagged.passed, "the pass line is for a list with nothing to warn about").toBe(1);
    }, 180_000);

    it("ignores a tools line outside the first frontmatter block, in a file with no frontmatter, and in an agent that lists no tools", () => {
      const out = outputOf(
        shell.run(
          project({
            "in-the-body.agent.md": "---\nname: Probe\ndescription: A probe.\n---\nExample:\n\n```yaml\ntools: [editFiles]\n```\n",
            "no-frontmatter.agent.md": "# Executor\n\ntools: [editFiles]\nNo frontmatter, so no tools list.\n",
            "all-tools.agent.md": "---\nname: Probe\ndescription: No tools line, so every tool.\n---\nBody.\n",
          }),
        ),
      );
      expect(out).not.toMatch(/lists '/);
      expect(out).toMatch(/PASS\s+\.github\/agents\/ tool names \(3 agent files, none that fails in the Copilot CLI\)/);
    }, 180_000);

    it("says nothing about tool names when the project has no agent files", () => {
      const out = outputOf(shell.run(project()));
      expect(out).not.toMatch(/tool names/);
      expect(out).toMatch(/Results:\s+\d+ passed/);
    }, 180_000);

    it("ends a block list at the next key, so another key's list is not read as tools", () => {
      const out = outputOf(shell.run(project({ "handoffs.agent.md": agent("tools:\n  - read\nhandoffs:\n  - editFiles") })));
      expect(out).not.toMatch(/lists '/);
      expect(out).toMatch(/PASS\s+\.github\/agents\/ tool names/);
    }, 180_000);

    it("ends a list in brackets at its closing bracket, so another key's list is not read as tools", () => {
      const out = outputOf(shell.run(project({ "handoffs.agent.md": agent("tools:\n  [\n    read,\n  ]\nhandoffs: [plan, editFiles]") })));
      expect(out).not.toMatch(/lists '/);
      expect(out).toMatch(/PASS\s+\.github\/agents\/ tool names/);
    }, 180_000);

    it("reads the key and the names as written, so that every shell agrees about `Tools:` and `EditFiles`", () => {
      const out = outputOf(shell.run(project({ "upper-key.agent.md": agent("Tools: [read, editFiles]"), "upper-name.agent.md": agent("tools: [read, EditFiles]") })));
      expect(out).not.toMatch(/lists '/);
      expect(out).toMatch(/PASS\s+\.github\/agents\/ tool names \(2 agent files, none that fails in the Copilot CLI\)/);
    }, 180_000);

    it("reads only the agent files directly in .github/agents, as the agent count does", () => {
      const out = outputOf(shell.run(project({ "executor.agent.md": agent("tools: [read]"), "old/executor.agent.md": agent("tools: [editFiles]") })));
      expect(out).not.toMatch(/lists '/);
      expect(out).toMatch(/PASS\s+\.github\/agents\/ tool names \(1 agent files, none that fails in the Copilot CLI\)/);
    }, 180_000);
  });
}
