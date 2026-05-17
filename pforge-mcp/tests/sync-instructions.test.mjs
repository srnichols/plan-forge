/**
 * Tests for pforge-mcp/sync-instructions.mjs (v3.0.0).
 *
 * Covers:
 *   1.  sha256 — deterministic digest
 *   2.  sha256 — differs for different content
 *   3.  stripFrontmatter — removes YAML frontmatter block
 *   4.  stripFrontmatter — returns unchanged text when no frontmatter
 *   5.  stripFrontmatter — returns empty string for non-string input
 *   6.  collectProjectProfile — reads project-profile.instructions.md, strips frontmatter
 *   7.  collectProjectProfile — returns found:false when file absent
 *   8.  collectProjectPrinciples — reads docs/plans/PROJECT-PRINCIPLES.md (primary)
 *   9.  collectProjectPrinciples — falls back to project-principles.instructions.md
 *  10.  collectProjectPrinciples — returns found:false when neither file exists
 *  11.  collectForgeConfig — extracts model routing, quorum, and parallelism from .forge.json
 *  12.  collectForgeConfig — returns found:false when .forge.json absent
 *  13.  collectForgeConfig — returns found:false when .forge.json is invalid JSON
 *  14.  collectInstructionFiles — reads project-specific .instructions.md files
 *  15.  collectInstructionFiles — excludes default-excluded files
 *  16.  collectInstructionFiles — returns [] when directory absent
 *  17.  collectInstructionFiles — respects custom exclude list
 *  18.  renderInstructions — includes profile, principles, and forgeConfig sections
 *  19.  renderInstructions — empty-state message when no data
 *  20.  renderInstructions — noPrinciples flag omits principles section
 *  21.  renderInstructions — noProfile flag omits profile section
 *  22.  renderInstructions — returns sectionsCount matching rendered sections
 *  23.  syncInstructions — dry-run returns dryRunContent, does not write file
 *  24.  syncInstructions — writes .github/copilot-instructions.md by default
 *  25.  syncInstructions — custom --output path
 *  26.  syncInstructions — skip write when content unchanged (no --force)
 *  27.  syncInstructions — --force re-writes even when content unchanged
 *  28.  syncInstructions — throws SyncInstructionsError on missing projectRoot
 *  29.  syncInstructions — noPrinciples flag passes through
 *  30.  syncInstructions — noProfile flag passes through
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  sha256,
  stripFrontmatter,
  collectProjectProfile,
  collectProjectPrinciples,
  collectForgeConfig,
  collectInstructionFiles,
  renderInstructions,
  syncInstructions,
  SyncInstructionsError,
} from "../sync-instructions.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROFILE_WITH_FRONTMATTER = `---
description: Project profile instructions
applyTo: '**'
priority: HIGH
---

# My Project Profile

This project uses Node.js 22 with ESM modules.

## Tech Stack

- Backend: Node.js
- Testing: Vitest
`;

const PRINCIPLES_DOC = `# Project Principles

1. **Architecture-First** — always ask 5 questions before coding.
2. **No quick fixes** — do it right the first time.
`;

const FORGE_JSON_FULL = JSON.stringify({
  modelRouting: { default: "auto" },
  quorum: { enabled: true, threshold: 5, models: [] },
  maxParallelism: 4,
  maxRetries: 2,
  forgeMaster: {
    reasoningModel: "gpt-4o",
    reasoningProvider: "githubCopilot",
    philosophy: "Prefer composability over configurability.",
  },
}, null, 2);

const FORGE_JSON_MINIMAL = JSON.stringify({
  modelRouting: { default: "speed" },
}, null, 2);

const EXTRA_INSTR = `---
description: API patterns for REST endpoints
applyTo: 'src/api/**'
---

# API Patterns

Use RESTful conventions. Paginate with cursor-based pagination.
`;

// ─── Project root factory ─────────────────────────────────────────────────────

/**
 * Create an isolated tmpdir project for testing.
 */
function makeProject(base, {
  profileContent       = null,
  principlesContent    = null,
  principlesInstrContent = null,
  forgeJsonContent     = null,
  extraInstrFiles      = [],
} = {}) {
  const root = join(base, randomUUID());
  mkdirSync(root, { recursive: true });

  if (profileContent !== null) {
    const dir = join(root, ".github", "instructions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project-profile.instructions.md"), profileContent);
  }

  if (principlesContent !== null) {
    const dir = join(root, "docs", "plans");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROJECT-PRINCIPLES.md"), principlesContent);
  }

  if (principlesInstrContent !== null) {
    const dir = join(root, ".github", "instructions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project-principles.instructions.md"), principlesInstrContent);
  }

  if (forgeJsonContent !== null) {
    writeFileSync(join(root, ".forge.json"), forgeJsonContent);
  }

  for (const { filename, content } of extraInstrFiles) {
    const dir = join(root, ".github", "instructions");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), content);
  }

  return root;
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const BASE = join(tmpdir(), "sync-instructions-tests-" + randomUUID().slice(0, 8));
beforeEach(() => mkdirSync(BASE, { recursive: true }));
afterEach(() => {
  try { rmSync(BASE, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("sha256", () => {
  it("produces consistent digest", () => {
    const a = sha256("hello world");
    const b = sha256("hello world");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("differs for different content", () => {
    expect(sha256("abc")).not.toBe(sha256("xyz"));
  });
});

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter block", () => {
    const result = stripFrontmatter(PROFILE_WITH_FRONTMATTER);
    expect(result).not.toContain("---");
    expect(result).not.toContain("applyTo");
    expect(result).toContain("# My Project Profile");
    expect(result).toContain("Node.js 22");
  });

  it("returns unchanged text when no frontmatter present", () => {
    const text = "# Heading\n\nSome content.";
    expect(stripFrontmatter(text)).toBe(text);
  });

  it("returns empty string for non-string input", () => {
    expect(stripFrontmatter(null)).toBe("");
    expect(stripFrontmatter(42)).toBe("");
    expect(stripFrontmatter(undefined)).toBe("");
  });
});

describe("collectProjectProfile", () => {
  it("reads project-profile.instructions.md and strips frontmatter", () => {
    const root = makeProject(BASE, { profileContent: PROFILE_WITH_FRONTMATTER });
    const result = collectProjectProfile(root);
    expect(result.found).toBe(true);
    expect(result.content).toContain("# My Project Profile");
    expect(result.content).not.toContain("applyTo");
  });

  it("returns found:false when file is absent", () => {
    const root = makeProject(BASE);
    const result = collectProjectProfile(root);
    expect(result.found).toBe(false);
    expect(result.content).toBe("");
  });
});

describe("collectProjectPrinciples", () => {
  it("reads docs/plans/PROJECT-PRINCIPLES.md as primary source", () => {
    const root = makeProject(BASE, { principlesContent: PRINCIPLES_DOC });
    const result = collectProjectPrinciples(root);
    expect(result.found).toBe(true);
    expect(result.content).toContain("Architecture-First");
    expect(result.source).toBe("docs/plans/PROJECT-PRINCIPLES.md");
  });

  it("falls back to project-principles.instructions.md when primary is absent", () => {
    const fallbackContent = `---
description: Generated principles
applyTo: '**'
---

# Project Principles Guards

Always run tests.
`;
    const root = makeProject(BASE, { principlesInstrContent: fallbackContent });
    const result = collectProjectPrinciples(root);
    expect(result.found).toBe(true);
    expect(result.content).toContain("Always run tests");
    expect(result.source).toBe(".github/instructions/project-principles.instructions.md");
  });

  it("returns found:false when neither file exists", () => {
    const root = makeProject(BASE);
    const result = collectProjectPrinciples(root);
    expect(result.found).toBe(false);
    expect(result.content).toBe("");
    expect(result.source).toBe("");
  });
});

describe("collectForgeConfig", () => {
  it("extracts model routing, quorum, parallelism, and philosophy from .forge.json", () => {
    const root = makeProject(BASE, { forgeJsonContent: FORGE_JSON_FULL });
    const result = collectForgeConfig(root);
    expect(result.found).toBe(true);
    expect(result.settings["Default model routing"]).toBe("auto");
    expect(result.settings["Quorum mode"]).toContain("enabled");
    expect(result.settings["Max parallelism"]).toBe("4");
    expect(result.settings["Max retries per slice"]).toBe("2");
    expect(result.settings["Forge-Master reasoning model"]).toBe("gpt-4o");
    expect(result.settings["Project philosophy"]).toContain("composability");
  });

  it("handles minimal .forge.json with only model routing", () => {
    const root = makeProject(BASE, { forgeJsonContent: FORGE_JSON_MINIMAL });
    const result = collectForgeConfig(root);
    expect(result.found).toBe(true);
    expect(result.settings["Default model routing"]).toBe("speed");
    expect(result.settings["Quorum mode"]).toBeUndefined();
  });

  it("returns found:false when .forge.json is absent", () => {
    const root = makeProject(BASE);
    const result = collectForgeConfig(root);
    expect(result.found).toBe(false);
  });

  it("returns found:false when .forge.json contains invalid JSON", () => {
    const root = makeProject(BASE);
    writeFileSync(join(root, ".forge.json"), "{ not valid json }");
    const result = collectForgeConfig(root);
    expect(result.found).toBe(false);
  });
});

describe("collectInstructionFiles", () => {
  it("reads project-specific .instructions.md files", () => {
    const root = makeProject(BASE, {
      extraInstrFiles: [
        { filename: "api-patterns.instructions.md", content: EXTRA_INSTR },
        { filename: "database.instructions.md", content: "---\ndescription: DB\napplyTo: '**'\n---\n\n# DB Patterns\n\nUse Prisma.\n" },
      ],
    });
    const results = collectInstructionFiles(root);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const titles = results.map((r) => r.title);
    expect(titles).toContain("API Patterns");
    expect(titles).toContain("DB Patterns");
  });

  it("excludes default-excluded baseline files", () => {
    const root = makeProject(BASE, {
      extraInstrFiles: [
        { filename: "architecture-principles.instructions.md", content: "# Arch\n\nShould be excluded." },
        { filename: "git-workflow.instructions.md", content: "# Git\n\nShould be excluded." },
        { filename: "api-patterns.instructions.md", content: "# API\n\nShould be included." },
      ],
    });
    const results = collectInstructionFiles(root);
    const filenames = results.map((r) => r.filename);
    expect(filenames).not.toContain("architecture-principles.instructions.md");
    expect(filenames).not.toContain("git-workflow.instructions.md");
    expect(filenames).toContain("api-patterns.instructions.md");
  });

  it("returns [] when .github/instructions directory is absent", () => {
    const root = makeProject(BASE);
    const results = collectInstructionFiles(root);
    expect(results).toEqual([]);
  });

  it("respects custom exclude list", () => {
    const root = makeProject(BASE, {
      extraInstrFiles: [
        { filename: "api-patterns.instructions.md", content: "# API\n\nContent." },
        { filename: "security.instructions.md", content: "# Security\n\nContent." },
      ],
    });
    const results = collectInstructionFiles(root, { exclude: ["api-patterns.instructions.md"] });
    const filenames = results.map((r) => r.filename);
    expect(filenames).not.toContain("api-patterns.instructions.md");
    expect(filenames).toContain("security.instructions.md");
  });
});

describe("renderInstructions", () => {
  it("includes all sections when data is present", () => {
    const { markdown } = renderInstructions({
      profile:    { content: "Node.js 22 backend.", found: true },
      principles: { content: "# Principles\n\n1. TDD.", found: true, source: "docs/plans/PROJECT-PRINCIPLES.md" },
      forgeConfig: { settings: { "Default model routing": "auto" }, found: true },
      extraInstructions: [{ filename: "api-patterns.instructions.md", title: "API Patterns", content: "Use REST." }],
      now: new Date("2026-05-16"),
    });

    expect(markdown).toContain("# Copilot Instructions");
    expect(markdown).toContain("2026-05-16");
    expect(markdown).toContain("## Project Profile");
    expect(markdown).toContain("Node.js 22");
    expect(markdown).toContain("## Project Principles");
    expect(markdown).toContain("TDD");
    expect(markdown).toContain("## API Patterns");
    expect(markdown).toContain("Use REST.");
    expect(markdown).toContain("## Forge Configuration");
    expect(markdown).toContain("auto");
  });

  it("shows empty-state message when all sources are absent", () => {
    const { markdown, sectionsCount } = renderInstructions({
      profile:          { content: "", found: false },
      principles:       { content: "", found: false, source: "" },
      forgeConfig:      { settings: {}, found: false },
      extraInstructions: [],
    });
    expect(markdown).toContain("No project-specific instructions found");
    expect(sectionsCount).toBe(0);
  });

  it("noPrinciples flag omits principles section", () => {
    const { markdown } = renderInstructions({
      profile:    { content: "Profile.", found: true },
      principles: { content: "Principles.", found: true, source: "" },
      forgeConfig: { settings: {}, found: false },
      noPrinciples: true,
    });
    expect(markdown).toContain("## Project Profile");
    expect(markdown).not.toContain("## Project Principles");
  });

  it("noProfile flag omits profile section", () => {
    const { markdown } = renderInstructions({
      profile:    { content: "Profile.", found: true },
      principles: { content: "Principles.", found: true, source: "" },
      forgeConfig: { settings: {}, found: false },
      noProfile: true,
    });
    expect(markdown).toContain("## Project Principles");
    expect(markdown).not.toContain("## Project Profile");
  });

  it("returns sectionsCount matching rendered sections", () => {
    const { sectionsCount } = renderInstructions({
      profile:    { content: "Profile.", found: true },
      principles: { content: "Principles.", found: true, source: "" },
      forgeConfig: { settings: { "Default model routing": "auto" }, found: true },
      extraInstructions: [
        { filename: "api-patterns.instructions.md", title: "API Patterns", content: "REST." },
        { filename: "security.instructions.md", title: "Security", content: "Validate input." },
      ],
    });
    // profile + principles + 2 extra + forgeConfig = 5
    expect(sectionsCount).toBe(5);
  });
});

describe("syncInstructions", () => {
  it("dry-run returns dryRunContent and does not write file", () => {
    const root = makeProject(BASE, {
      principlesContent: PRINCIPLES_DOC,
    });
    const result = syncInstructions({ projectRoot: root, dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRunMode).toBe(true);
    expect(typeof result.dryRunContent).toBe("string");
    expect(result.dryRunContent).toContain("# Copilot Instructions");
    const outputPath = join(root, ".github", "copilot-instructions.md");
    expect(existsSync(outputPath)).toBe(false);
  });

  it("writes .github/copilot-instructions.md by default", () => {
    const root = makeProject(BASE, {
      profileContent: PROFILE_WITH_FRONTMATTER,
      principlesContent: PRINCIPLES_DOC,
      forgeJsonContent: FORGE_JSON_MINIMAL,
    });
    const result = syncInstructions({ projectRoot: root });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    const content = readFileSync(result.outputPath, "utf-8");
    expect(content).toContain("# Copilot Instructions");
    expect(content).toContain("Architecture-First");
    expect(content).toContain("My Project Profile");
  });

  it("writes to custom --output path", () => {
    const root = makeProject(BASE, { principlesContent: PRINCIPLES_DOC });
    const customOutput = join("custom", "instructions.md");
    const result = syncInstructions({ projectRoot: root, output: customOutput });
    expect(result.ok).toBe(true);
    const expectedPath = join(root, customOutput);
    expect(result.outputPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it("skips write when content is unchanged", () => {
    const root = makeProject(BASE, { principlesContent: PRINCIPLES_DOC });
    syncInstructions({ projectRoot: root });
    const result2 = syncInstructions({ projectRoot: root });
    expect(result2.changed).toBe(false);
    expect(result2.message).toContain("up to date");
  });

  it("--force re-writes even when content unchanged", () => {
    const root = makeProject(BASE, { principlesContent: PRINCIPLES_DOC });
    syncInstructions({ projectRoot: root });
    const result2 = syncInstructions({ projectRoot: root, force: true });
    expect(result2.changed).toBe(true);
  });

  it("throws SyncInstructionsError when projectRoot is missing", () => {
    expect(() => syncInstructions({})).toThrow(SyncInstructionsError);
  });

  it("noPrinciples flag passes through to output", () => {
    const root = makeProject(BASE, { principlesContent: PRINCIPLES_DOC });
    const result = syncInstructions({ projectRoot: root, noPrinciples: true });
    expect(result.ok).toBe(true);
    expect(result.sections.principles).toBe(false);
    const content = readFileSync(result.outputPath, "utf-8");
    expect(content).not.toContain("Architecture-First");
  });

  it("noProfile flag passes through to output", () => {
    const root = makeProject(BASE, {
      profileContent: PROFILE_WITH_FRONTMATTER,
      principlesContent: PRINCIPLES_DOC,
    });
    const result = syncInstructions({ projectRoot: root, noProfile: true });
    expect(result.ok).toBe(true);
    expect(result.sections.profile).toBe(false);
    const content = readFileSync(result.outputPath, "utf-8");
    expect(content).not.toContain("My Project Profile");
    expect(content).toContain("Architecture-First");
  });
});
