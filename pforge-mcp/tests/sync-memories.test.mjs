/**
 * Tests for pforge-mcp/sync-memories.mjs (Roadmap C3).
 *
 * Covers:
 *   1.  sha256 — deterministic digest
 *   2.  parseAutoSkillFrontmatter — valid frontmatter with keywords and commands
 *   3.  parseAutoSkillFrontmatter — returns null on missing sha256Prefix
 *   4.  parseAutoSkillFrontmatter — returns null on empty / non-string input
 *   5.  collectTrajectories — reads plan/slice structure
 *   6.  collectTrajectories — returns [] when directory absent
 *   7.  collectTrajectories — respects `since` filter
 *   8.  collectTrajectories — respects `limit`
 *   9.  collectAutoSkills — reads .forge/skills-auto/*.md files
 *  10.  collectAutoSkills — returns [] when directory absent
 *  11.  collectAutoSkills — respects `since` filter
 *  12.  collectBrainDecisions — reads .forge/brain/**\/*.json files
 *  13.  collectBrainDecisions — returns [] when directory absent
 *  14.  collectBrainDecisions — skips JSON without recognizable content field
 *  15.  renderMemoryHints — sections present for each data source
 *  16.  renderMemoryHints — empty-state message when no data
 *  17.  renderMemoryHints — trajectory content truncated at 300 chars
 *  18.  syncMemories — dry-run returns dryRunContent, does not write file
 *  19.  syncMemories — writes .github/copilot-memory-hints.md by default
 *  20.  syncMemories — custom --output path
 *  21.  syncMemories — skip write when content unchanged (no --force)
 *  22.  syncMemories — --force re-writes even when content unchanged
 *  23.  syncMemories — throws SyncMemoriesError on missing projectRoot
 *  24.  syncMemories — throws SyncMemoriesError on invalid --since value
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
  parseAutoSkillFrontmatter,
  collectTrajectories,
  collectAutoSkills,
  collectBrainDecisions,
  renderMemoryHints,
  syncMemories,
  SyncMemoriesError,
} from "../sync-memories.mjs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_AUTO_SKILL = `---
sha256Prefix: abc123def456
summary: "Run vitest for auth module"
createdAt: 2026-01-15T10:00:00.000Z
reuseCount: 3
contextSignature:
  sliceType: test
  titleHash: 1234abcd
  planBasename: Phase-AUTH
  domainKeywords: ["testing patterns conventions", "authentication authorization patterns"]
commands:
  - "npx vitest run tests/auth.test.mjs"
  - "test -f src/auth/index.mjs && echo ok"
---

# Auto-skill: Run vitest for auth module

Captured by Plan-Forge.
`;

const SAMPLE_AUTO_SKILL_NO_PREFIX = `---
summary: "Missing prefix"
createdAt: 2026-01-01T00:00:00.000Z
reuseCount: 0
commands:
  - "echo hello"
---
`;

// ─── Project root factory ─────────────────────────────────────────────────────

/**
 * Create an isolated tmpdir project for testing.
 */
function makeProject(base, {
  trajectories = [],
  autoSkills   = [],
  brainEntries = [],
} = {}) {
  const root = join(base, randomUUID());
  mkdirSync(root, { recursive: true });

  for (const { plan, sliceId, content } of trajectories) {
    const dir = join(root, ".forge", "trajectories", plan);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `slice-${sliceId}.md`), content);
  }

  for (const { filename, content } of autoSkills) {
    const dir = join(root, ".forge", "skills-auto");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), content);
  }

  for (const { path: relPath, value } of brainEntries) {
    const abs = join(root, ".forge", "brain", relPath);
    mkdirSync(join(root, ".forge", "brain", relPath.split("/").slice(0, -1).join("/")), { recursive: true });
    writeFileSync(abs, JSON.stringify(value, null, 2));
  }

  return root;
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const BASE = join(tmpdir(), "sync-memories-tests-" + randomUUID().slice(0, 8));
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

describe("parseAutoSkillFrontmatter", () => {
  it("parses valid frontmatter with keywords and commands", () => {
    const result = parseAutoSkillFrontmatter(SAMPLE_AUTO_SKILL);
    expect(result).not.toBeNull();
    expect(result.sha256Prefix).toBe("abc123def456");
    expect(result.summary).toBe("Run vitest for auth module");
    expect(result.reuseCount).toBe(3);
    expect(result.domainKeywords).toContain("testing patterns conventions");
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toBe("npx vitest run tests/auth.test.mjs");
  });

  it("returns null when sha256Prefix is missing", () => {
    expect(parseAutoSkillFrontmatter(SAMPLE_AUTO_SKILL_NO_PREFIX)).toBeNull();
  });

  it("returns null on empty string", () => {
    expect(parseAutoSkillFrontmatter("")).toBeNull();
  });

  it("returns null on non-string input", () => {
    expect(parseAutoSkillFrontmatter(null)).toBeNull();
    expect(parseAutoSkillFrontmatter(42)).toBeNull();
  });
});

describe("collectTrajectories", () => {
  it("reads plan/slice structure", () => {
    const root = makeProject(BASE, {
      trajectories: [
        { plan: "Phase-AUTH", sliceId: "1", content: "I chose JWT." },
        { plan: "Phase-AUTH", sliceId: "2", content: "Tests passed." },
        { plan: "Phase-DB", sliceId: "1", content: "Used Prisma." },
      ],
    });
    const results = collectTrajectories(root);
    expect(results).toHaveLength(3);
    const contents = results.map((r) => r.content);
    expect(contents).toContain("I chose JWT.");
    expect(contents).toContain("Used Prisma.");
  });

  it("returns [] when trajectories directory absent", () => {
    const root = makeProject(BASE);
    expect(collectTrajectories(root)).toEqual([]);
  });

  it("respects since filter — excludes old entries", () => {
    const root = makeProject(BASE, {
      trajectories: [
        { plan: "Phase-OLD", sliceId: "1", content: "Old note." },
      ],
    });
    const future = new Date(Date.now() + 86400_000);
    const results = collectTrajectories(root, { since: future });
    expect(results).toHaveLength(0);
  });

  it("respects limit", () => {
    const root = makeProject(BASE, {
      trajectories: [
        { plan: "P1", sliceId: "1", content: "A" },
        { plan: "P2", sliceId: "2", content: "B" },
        { plan: "P3", sliceId: "3", content: "C" },
      ],
    });
    const results = collectTrajectories(root, { limit: 2 });
    expect(results).toHaveLength(2);
  });
});

describe("collectAutoSkills", () => {
  it("reads skills-auto .md files", () => {
    const root = makeProject(BASE, {
      autoSkills: [
        { filename: "abc123.md", content: SAMPLE_AUTO_SKILL },
      ],
    });
    const results = collectAutoSkills(root);
    expect(results).toHaveLength(1);
    expect(results[0].sha256Prefix).toBe("abc123def456");
    expect(results[0].reuseCount).toBe(3);
  });

  it("returns [] when skills-auto directory absent", () => {
    const root = makeProject(BASE);
    expect(collectAutoSkills(root)).toEqual([]);
  });

  it("respects since filter", () => {
    const root = makeProject(BASE, {
      autoSkills: [
        { filename: "abc123.md", content: SAMPLE_AUTO_SKILL },
      ],
    });
    const future = new Date(Date.now() + 86400_000);
    const results = collectAutoSkills(root, { since: future });
    expect(results).toHaveLength(0);
  });
});

describe("collectBrainDecisions", () => {
  it("reads .forge/brain/**\/*.json files with content field", () => {
    const root = makeProject(BASE, {
      brainEntries: [
        { path: "decisions/arch.json", value: { content: "Use Event Sourcing for audit log." } },
        { path: "decisions/auth.json", value: { content: "JWT tokens expire in 1 hour." } },
      ],
    });
    const results = collectBrainDecisions(root);
    expect(results).toHaveLength(2);
    const contents = results.map((r) => r.content);
    expect(contents.some((c) => c.includes("Event Sourcing"))).toBe(true);
  });

  it("returns [] when brain directory absent", () => {
    const root = makeProject(BASE);
    expect(collectBrainDecisions(root)).toEqual([]);
  });

  it("skips JSON without recognizable content field", () => {
    const root = makeProject(BASE, {
      brainEntries: [
        { path: "misc/empty.json", value: { noContent: "nothing useful" } },
        { path: "misc/null.json", value: null },
      ],
    });
    const results = collectBrainDecisions(root);
    expect(results).toHaveLength(0);
  });

  it("reads value.content field", () => {
    const root = makeProject(BASE, {
      brainEntries: [
        { path: "nested/item.json", value: { value: { content: "Nested content decision." } } },
      ],
    });
    const results = collectBrainDecisions(root);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Nested content decision.");
  });
});

describe("renderMemoryHints", () => {
  it("includes sections for each data source", () => {
    const md = renderMemoryHints({
      trajectories: [{ planBasename: "Phase-AUTH", sliceId: "1", content: "JWT was chosen." }],
      autoSkills:   [{ sha256Prefix: "aaa", summary: "Auth test recipe", commands: ["npm test"], domainKeywords: ["testing"], reuseCount: 2, createdAt: "" }],
      decisions:    [{ key: "decisions/arch", content: "Use Event Sourcing.", mtime: new Date() }],
      now: new Date("2026-05-16"),
    });

    expect(md).toContain("# Copilot Memory Hints");
    expect(md).toContain("## Architecture Decisions");
    expect(md).toContain("Use Event Sourcing.");
    expect(md).toContain("## Conventions & Patterns");
    expect(md).toContain("Auth test recipe");
    expect(md).toContain("## Lessons Learned");
    expect(md).toContain("Phase-AUTH");
    expect(md).toContain("2026-05-16");
  });

  it("shows empty-state message when no data", () => {
    const md = renderMemoryHints({
      trajectories: [],
      autoSkills:   [],
      decisions:    [],
    });
    expect(md).toContain("## No hints yet");
    expect(md).not.toContain("## Architecture Decisions");
    expect(md).not.toContain("## Conventions");
    expect(md).not.toContain("## Lessons");
  });

  it("truncates trajectory content at 300 chars", () => {
    const longContent = "X".repeat(400);
    const md = renderMemoryHints({
      trajectories: [{ planBasename: "P", sliceId: "1", content: longContent }],
      autoSkills:   [],
      decisions:    [],
    });
    expect(md).toContain("[truncated");
    expect(md).not.toContain("X".repeat(350));
  });
});

describe("syncMemories", () => {
  it("dry-run returns dryRunContent and does not write file", () => {
    const root = makeProject(BASE, {
      trajectories: [{ plan: "Phase-A", sliceId: "1", content: "Done." }],
    });
    const result = syncMemories({ projectRoot: root, dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.dryRunMode).toBe(true);
    expect(typeof result.dryRunContent).toBe("string");
    expect(result.dryRunContent).toContain("# Copilot Memory Hints");
    const outputPath = join(root, ".github", "copilot-memory-hints.md");
    expect(existsSync(outputPath)).toBe(false);
  });

  it("writes .github/copilot-memory-hints.md by default", () => {
    const root = makeProject(BASE, {
      trajectories: [{ plan: "Phase-A", sliceId: "1", content: "JWT approach chosen." }],
    });
    const result = syncMemories({ projectRoot: root });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    const content = readFileSync(result.outputPath, "utf-8");
    expect(content).toContain("# Copilot Memory Hints");
    expect(content).toContain("JWT approach chosen");
  });

  it("writes to custom --output path", () => {
    const root = makeProject(BASE);
    const customOutput = join("custom", "hints.md");
    const result = syncMemories({ projectRoot: root, output: customOutput });
    expect(result.ok).toBe(true);
    const expectedPath = join(root, customOutput);
    expect(result.outputPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
  });

  it("skips write when content is unchanged", () => {
    const root = makeProject(BASE);
    // Write once
    syncMemories({ projectRoot: root });
    // Write again — should be unchanged
    const result2 = syncMemories({ projectRoot: root });
    expect(result2.changed).toBe(false);
    expect(result2.message).toContain("up to date");
  });

  it("--force re-writes even when content unchanged", () => {
    const root = makeProject(BASE);
    syncMemories({ projectRoot: root });
    const result2 = syncMemories({ projectRoot: root, force: true });
    expect(result2.changed).toBe(true);
  });

  it("throws SyncMemoriesError when projectRoot is missing", () => {
    expect(() => syncMemories({})).toThrow(SyncMemoriesError);
  });

  it("throws SyncMemoriesError on invalid since value", () => {
    const root = makeProject(BASE);
    expect(() => syncMemories({ projectRoot: root, since: "not-a-date" })).toThrow(SyncMemoriesError);
  });
});
