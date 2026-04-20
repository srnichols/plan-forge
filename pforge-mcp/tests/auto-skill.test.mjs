/**
 * Plan Forge — Phase-25 Slice 3 (L2 Auto-skill library / Voyager) unit tests
 *
 * Covers the auto-skill helpers in memory.mjs:
 *   - extractDomainKeywords()
 *   - extractAutoSkill() + renderAutoSkillMarkdown() + parseAutoSkillMarkdown()
 *   - writeAutoSkill() / readAutoSkill() / listAutoSkills()
 *   - retrieveAutoSkills()
 *   - incrementAutoSkillReuse()
 *   - shouldPromoteAutoSkill()
 *   - buildAutoSkillContext()
 *
 * MUST #3 (docs/plans/Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md):
 *   Every passing slice writes an auto-skill candidate to
 *   .forge/skills-auto/<sha256-prefix>.md with the mandated fields.
 * MUST #4 + D3: candidates promote only after reuseCount >= threshold (default 3).
 * D4: 12-character SHA-256 prefix filename.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  extractDomainKeywords,
  extractAutoSkill,
  renderAutoSkillMarkdown,
  parseAutoSkillMarkdown,
  writeAutoSkill,
  readAutoSkill,
  listAutoSkills,
  retrieveAutoSkills,
  incrementAutoSkillReuse,
  shouldPromoteAutoSkill,
  buildAutoSkillContext,
  AUTOSKILL_SHA_PREFIX_LEN,
  AUTOSKILL_DEFAULT_THRESHOLD,
} from "../memory.mjs";

// ─── extractDomainKeywords ────────────────────────────────────────────

describe("extractDomainKeywords", () => {
  it("detects database + testing keywords from slice title", () => {
    const kws = extractDomainKeywords({ title: "Add database migration and vitest coverage" });
    expect(kws).toContain("database migration patterns");
    expect(kws).toContain("testing patterns conventions");
  });

  it("returns [] when the title matches no known domain", () => {
    expect(extractDomainKeywords({ title: "unrelated freeform prose" })).toEqual([]);
  });

  it("returns [] for null / undefined slice", () => {
    expect(extractDomainKeywords(null)).toEqual([]);
    expect(extractDomainKeywords(undefined)).toEqual([]);
  });

  it("dedupes keywords across multiple matching patterns", () => {
    // Both phrases match the `database` regex — the same canonical query
    // should appear only once.
    const kws = extractDomainKeywords({ title: "database schema migration" });
    const count = kws.filter((k) => k === "database migration patterns").length;
    expect(count).toBe(1);
  });
});

// ─── extractAutoSkill / render / parse ────────────────────────────────

describe("extractAutoSkill (Phase-25 MUST #3)", () => {
  const slice = {
    number: 5,
    title: "Add database migration for tenants table",
    validationGate: "npm run migrate\nnpm test -- migrations\n# comment line\n",
  };

  it("returns a record with all mandated MUST #3 fields", () => {
    const rec = extractAutoSkill({ slice, planBasename: "Phase-99", now: "2026-04-20T00:00:00.000Z" });
    expect(rec).not.toBeNull();
    expect(rec.sha256Prefix).toHaveLength(AUTOSKILL_SHA_PREFIX_LEN);
    expect(rec.commands).toEqual(["npm run migrate", "npm test -- migrations"]);
    expect(rec.contextSignature).toBeDefined();
    expect(rec.contextSignature.domainKeywords).toContain("database migration patterns");
    expect(rec.contextSignature.planBasename).toBe("Phase-99");
    expect(rec.summary).toContain("database migration");
    expect(rec.reuseCount).toBe(0);
    expect(rec.createdAt).toBe("2026-04-20T00:00:00.000Z");
  });

  it("is deterministic — same inputs give the same sha256Prefix", () => {
    const a = extractAutoSkill({ slice, now: "t" });
    const b = extractAutoSkill({ slice, now: "t" });
    expect(a.sha256Prefix).toBe(b.sha256Prefix);
  });

  it("returns null when the slice has no validation-gate commands", () => {
    expect(extractAutoSkill({ slice: { title: "t", validationGate: "" } })).toBeNull();
    expect(extractAutoSkill({ slice: { title: "t", validationGate: "# only a comment\n" } })).toBeNull();
    expect(extractAutoSkill({ slice: { title: "t" } })).toBeNull();
    expect(extractAutoSkill({ slice: null })).toBeNull();
    expect(extractAutoSkill({})).toBeNull();
  });

  it("accepts array validationGate as well as string", () => {
    const rec = extractAutoSkill({ slice: { title: "Add tests", validationGate: ["npm test", "npm run lint"] } });
    expect(rec.commands).toEqual(["npm test", "npm run lint"]);
  });
});

describe("render / parse round-trip", () => {
  it("round-trips a record faithfully through Markdown-on-disk form", () => {
    const orig = {
      sha256Prefix: "abc123def456",
      summary: 'Slice with "quotes" and unicode éàü',
      createdAt: "2026-04-20T00:00:00.000Z",
      reuseCount: 7,
      contextSignature: {
        sliceType: "execute",
        titleHash: "deadbeef",
        planBasename: "Phase-99-EXAMPLE",
        domainKeywords: ["database migration patterns", "testing patterns conventions"],
      },
      commands: ["npm run migrate", 'echo "hi"'],
    };
    const md = renderAutoSkillMarkdown(orig);
    const parsed = parseAutoSkillMarkdown(md);
    expect(parsed).toEqual(orig);
  });

  it("parseAutoSkillMarkdown returns null on malformed input", () => {
    expect(parseAutoSkillMarkdown("no frontmatter here")).toBeNull();
    expect(parseAutoSkillMarkdown("---\nnotASkill: yes\n---\n")).toBeNull();
    expect(parseAutoSkillMarkdown(null)).toBeNull();
    expect(parseAutoSkillMarkdown(42)).toBeNull();
  });
});

// ─── filesystem: write / read / list / retrieve / increment ───────────

describe("auto-skill filesystem round-trip", () => {
  let cwd;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-auto-"));
  });

  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("writes to .forge/skills-auto/<sha256-prefix>.md (Phase-25 D4)", () => {
    const rec = extractAutoSkill({
      slice: { number: 1, title: "Database migration", validationGate: "npm run migrate" },
      now: "2026-04-20T00:00:00.000Z",
    });
    const path = writeAutoSkill({ cwd, record: rec });
    expect(path).toContain(resolve(cwd, ".forge", "skills-auto"));
    // 12-char hex + .md
    expect(path).toMatch(/skills-auto[\\/][0-9a-f]{12}\.md$/);
    expect(existsSync(path)).toBe(true);
  });

  it("readAutoSkill round-trips a written record", () => {
    const rec = extractAutoSkill({
      slice: { number: 1, title: "API endpoint", validationGate: "npm run build" },
      now: "2026-04-20T00:00:00.000Z",
    });
    writeAutoSkill({ cwd, record: rec });
    const read = readAutoSkill({ cwd, sha256Prefix: rec.sha256Prefix });
    expect(read).not.toBeNull();
    expect(read.sha256Prefix).toBe(rec.sha256Prefix);
    expect(read.commands).toEqual(rec.commands);
  });

  it("readAutoSkill returns null when missing", () => {
    expect(readAutoSkill({ cwd, sha256Prefix: "000000000000" })).toBeNull();
  });

  it("listAutoSkills returns all stored skills", () => {
    const a = extractAutoSkill({ slice: { number: 1, title: "database work", validationGate: "x" }, now: "a" });
    const b = extractAutoSkill({ slice: { number: 2, title: "auth token", validationGate: "y" }, now: "b" });
    writeAutoSkill({ cwd, record: a });
    writeAutoSkill({ cwd, record: b });
    const list = listAutoSkills({ cwd });
    expect(list).toHaveLength(2);
    const prefixes = list.map((s) => s.sha256Prefix).sort();
    expect(prefixes).toEqual([a.sha256Prefix, b.sha256Prefix].sort());
  });

  it("listAutoSkills returns [] when the directory is absent", () => {
    expect(listAutoSkills({ cwd })).toEqual([]);
  });

  it("retrieveAutoSkills matches by domain keyword and ranks by reuseCount desc", () => {
    const a = extractAutoSkill({ slice: { number: 1, title: "database migration A", validationGate: "a" }, now: "2026-04-20T00:00:00.000Z" });
    a.reuseCount = 5;
    const b = extractAutoSkill({ slice: { number: 2, title: "database migration B", validationGate: "b" }, now: "2026-04-20T00:00:01.000Z" });
    b.reuseCount = 1;
    const c = extractAutoSkill({ slice: { number: 3, title: "oauth token issuer", validationGate: "c" }, now: "2026-04-20T00:00:02.000Z" });
    writeAutoSkill({ cwd, record: a });
    writeAutoSkill({ cwd, record: b });
    writeAutoSkill({ cwd, record: c });

    const matches = retrieveAutoSkills({
      cwd,
      slice: { title: "Implement database migration for invoices" },
    });
    expect(matches.map((m) => m.sha256Prefix)).toEqual([a.sha256Prefix, b.sha256Prefix]);
  });

  it("retrieveAutoSkills returns [] when no domain keywords match", () => {
    const a = extractAutoSkill({ slice: { number: 1, title: "database X", validationGate: "a" } });
    writeAutoSkill({ cwd, record: a });
    expect(retrieveAutoSkills({ cwd, slice: { title: "totally unrelated freeform prose" } })).toEqual([]);
  });

  it("incrementAutoSkillReuse bumps reuseCount persistently", () => {
    const rec = extractAutoSkill({
      slice: { number: 1, title: "Auth layer", validationGate: "npm test" },
      now: "2026-04-20T00:00:00.000Z",
    });
    writeAutoSkill({ cwd, record: rec });
    expect(incrementAutoSkillReuse({ cwd, sha256Prefix: rec.sha256Prefix })).toBe(1);
    expect(incrementAutoSkillReuse({ cwd, sha256Prefix: rec.sha256Prefix })).toBe(2);
    const onDisk = readAutoSkill({ cwd, sha256Prefix: rec.sha256Prefix });
    expect(onDisk.reuseCount).toBe(2);
  });

  it("incrementAutoSkillReuse returns null when the skill is missing", () => {
    expect(incrementAutoSkillReuse({ cwd, sha256Prefix: "000000000000" })).toBeNull();
  });
});

// ─── promotion gate & context block ───────────────────────────────────

describe("shouldPromoteAutoSkill (Phase-25 MUST #4 / D3)", () => {
  it("returns false below the threshold", () => {
    expect(shouldPromoteAutoSkill({ reuseCount: 2 })).toBe(false);
  });

  it("returns true when reuseCount >= default threshold (3)", () => {
    expect(shouldPromoteAutoSkill({ reuseCount: 3 })).toBe(true);
    expect(shouldPromoteAutoSkill({ reuseCount: 10 })).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(shouldPromoteAutoSkill({ reuseCount: 4 }, 5)).toBe(false);
    expect(shouldPromoteAutoSkill({ reuseCount: 5 }, 5)).toBe(true);
  });

  it("handles invalid inputs safely", () => {
    expect(shouldPromoteAutoSkill(null)).toBe(false);
    expect(shouldPromoteAutoSkill({})).toBe(false);
    expect(shouldPromoteAutoSkill({ reuseCount: "not a number" })).toBe(false);
  });

  it("default threshold is exported as 3", () => {
    expect(AUTOSKILL_DEFAULT_THRESHOLD).toBe(3);
  });
});

describe("buildAutoSkillContext", () => {
  it("returns empty string for no skills", () => {
    expect(buildAutoSkillContext([])).toBe("");
    expect(buildAutoSkillContext(null)).toBe("");
    expect(buildAutoSkillContext(undefined)).toBe("");
  });

  it("formats each skill's summary, reuseCount, and commands", () => {
    const block = buildAutoSkillContext([
      { summary: "Database migration", reuseCount: 4, commands: ["npm run migrate"] },
      { summary: "Auth test", reuseCount: 1, commands: ["npm test -- auth"] },
    ]);
    expect(block).toContain("Database migration (reused 4×)");
    expect(block).toContain("Auth test (reused 1×)");
    expect(block).toContain("`npm run migrate`");
    expect(block).toContain("`npm test -- auth`");
    expect(block).toContain("--- AUTO-SKILL CONTEXT");
    expect(block).toContain("--- END AUTO-SKILL CONTEXT ---");
  });
});
