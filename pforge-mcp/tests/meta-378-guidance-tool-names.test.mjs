import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Meta-bug #378 — eight files told agents to file project bugs with
 * `forge_bug_file`, a tool that does not exist (the tool is `forge_bug_register`).
 * An agent that follows the text calls a missing tool and fails or improvises.
 *
 * This checks every `forge_*` name that guidance, skills, agents, presets,
 * templates, plugins and the audit scripts mention against the tools tools.json
 * defines. Measured when it was added: 603 files, 3 unknown names, one of them
 * the defect and two of them not tool names (a placeholder and a wildcard).
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const SURFACES = [
  ".github/agents",
  ".github/instructions",
  ".github/skills",
  ".github/prompts",
  ".github/hooks",
  ".github/copilot-instructions.md",
  "presets",
  "templates",
  "plugins",
  "AGENTS.md",
  "scripts/audit",
];
const TEXT_FILE = /\.(md|mjs|json|ps1|sh|yml|yaml|txt)$/i;
const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);
const TOOL_NAME = /\bforge_[a-z][a-z0-9_]*\b/g;
// A placeholder in an example, not a tool.
const PLACEHOLDERS = new Set(["forge_xxx"]);

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path)
    .filter((name) => !SKIPPED_DIRECTORIES.has(name))
    .flatMap((name) => filesUnder(join(path, name)));
}

function mentionedTools() {
  const mentions = [];
  const files = SURFACES.flatMap((surface) => filesUnder(join(REPO_ROOT, surface))).filter((file) => TEXT_FILE.test(file));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [name] of text.matchAll(TOOL_NAME)) {
      // `forge_bug_*` is a family, and the pattern stops at the underscore before the asterisk.
      if (name.endsWith("_") || PLACEHOLDERS.has(name)) continue;
      mentions.push({ file: relative(REPO_ROOT, file).replace(/\\/g, "/"), name });
    }
  }
  return { files, mentions };
}

describe("tool names in shipped guidance (#378)", () => {
  const defined = new Set(JSON.parse(readFileSync(join(REPO_ROOT, "pforge-mcp", "tools.json"), "utf8")).map((tool) => tool.name));
  const { files, mentions } = mentionedTools();

  it("checks a real corpus, so an empty scan cannot pass", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(new Set(mentions.map((mention) => mention.name)).size).toBeGreaterThan(20);
  });

  it("names only tools that tools.json defines", () => {
    const unknown = mentions
      .filter((mention) => !defined.has(mention.name))
      .map((mention) => `${mention.file}: ${mention.name}`);
    expect([...new Set(unknown)]).toEqual([]);
  });

  it("points project bugs at forge_bug_register, which exists", () => {
    expect(defined.has("forge_bug_register")).toBe(true);
    expect(defined.has("forge_bug_file")).toBe(false);
  });
});
