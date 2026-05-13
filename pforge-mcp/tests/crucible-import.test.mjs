/**
 * Unit tests for the deterministic Spec Kit importer.
 *
 * Phase CRUCIBLE-IMPORT-CLI Slice 1.
 *
 * Fixtures: pforge-mcp/tests/fixtures/speckit/{green,partial,invalid}/
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  importSpeckit,
  parseSpec,
  parsePlan,
  parseTasks,
  parseConstitution,
  listSmelts,
  getSmelt,
} from "../crucible-import.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "speckit");

/**
 * Build a tmp project root and copy the named fixture into specs/<feature>/.
 * Returns the project root.
 */
function stageProject(fixtureName, { feature = "demo-feature", includeConstitutionInMemory = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "speckit-import-"));
  const featDir = join(root, "specs", feature);
  mkdirSync(featDir, { recursive: true });
  const src = join(FIXTURES, fixtureName);
  for (const f of readdirSync(src)) {
    if (f === "constitution.md" && includeConstitutionInMemory) {
      // Spec Kit's default layout: constitution lives under memory/, not specs/<feature>/
      const memDir = join(root, "memory");
      mkdirSync(memDir, { recursive: true });
      copyFileSync(join(src, f), join(memDir, f));
    } else {
      copyFileSync(join(src, f), join(featDir, f));
    }
  }
  return root;
}

let cleanupRoots = [];
afterEach(() => {
  for (const r of cleanupRoots) {
    try { rmSync(r, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  cleanupRoots = [];
});

// ─── parseSpec ───────────────────────────────────────────────────────────────
describe("parseSpec", () => {
  it("extracts title, goals, acceptance, and out-of-scope from green fixture", () => {
    const content = readFileSync(join(FIXTURES, "green", "spec.md"), "utf-8");
    const r = parseSpec(content);
    expect(r.title).toBe("Rate Limit Login Endpoint");
    expect(r.goals).toHaveLength(4);
    expect(r.goals[0]).toMatch(/Block more than 10 login attempts/);
    expect(r.acceptance).toHaveLength(4);
    expect(r.outOfScope).toHaveLength(3);
  });

  it("returns null title when no `# heading` is present", () => {
    const content = readFileSync(join(FIXTURES, "invalid", "spec.md"), "utf-8");
    const r = parseSpec(content);
    expect(r.title).toBeNull();
  });
});

// ─── parsePlan ───────────────────────────────────────────────────────────────
describe("parsePlan", () => {
  it("extracts scope, slices, and forbiddenActions from green fixture", () => {
    const content = readFileSync(join(FIXTURES, "green", "plan.md"), "utf-8");
    const r = parsePlan(content);
    expect(r.scope).toMatch(/token-bucket rate limiter/);
    expect(r.slices).toHaveLength(5);
    expect(r.slices[0].title).toBe("Middleware skeleton");
    expect(r.forbiddenActions).toHaveLength(4);
    expect(r.forbiddenActions[0]).toMatch(/session middleware/);
  });
});

// ─── parseTasks ──────────────────────────────────────────────────────────────
describe("parseTasks", () => {
  it("parses table rows and normalises status", () => {
    const content = readFileSync(join(FIXTURES, "green", "tasks.md"), "utf-8");
    const r = parseTasks(content);
    expect(r.rows.length).toBe(8);
    expect(r.rows[0].taskId).toBe("T-1");
    expect(r.rows[0].status).toBe("pending");
  });

  it("maps unknown status values to pending", () => {
    const r = parseTasks("| Task ID | Slice | Description | Status |\n|---|---|---|---|\n| T-1 | 1 | foo | in-review |");
    expect(r.rows[0].status).toBe("pending");
  });

  it("maps `done` and `in-progress` correctly", () => {
    const r = parseTasks("| Task ID | Slice | Description | Status |\n|---|---|---|---|\n| T-1 | 1 | a | done |\n| T-2 | 1 | b | in-progress |");
    expect(r.rows[0].status).toBe("done");
    expect(r.rows[1].status).toBe("in_progress");
  });
});

// ─── parseConstitution ───────────────────────────────────────────────────────
describe("parseConstitution", () => {
  it("extracts rules, commitments, and boundaries from green fixture", () => {
    const content = readFileSync(join(FIXTURES, "green", "constitution.md"), "utf-8");
    const r = parseConstitution(content);
    expect(r.rules.length).toBeGreaterThanOrEqual(5);
    expect(r.commitments.length).toBeGreaterThanOrEqual(2);
    expect(r.boundaries.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── importSpeckit happy path ────────────────────────────────────────────────
describe("importSpeckit — happy path", () => {
  it("imports green fixture, writes smelt + plan + audit log", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const r = importSpeckit({ projectRoot: root });

    expect(r.ok).toBe(true);
    expect(r.smeltId).toBeTruthy();
    expect(existsSync(r.smeltPath)).toBe(true);
    expect(existsSync(r.planPath)).toBe(true);
    expect(existsSync(join(root, ".forge", "crucible", "manual-imports.jsonl"))).toBe(true);

    // Plan must carry the Crucible-enforce frontmatter
    const plan = readFileSync(r.planPath, "utf-8");
    expect(plan).toMatch(/^---\r?\ncrucibleId: imported-speckit-/);
    expect(plan).toMatch(/source: speckit/);
    expect(plan).toMatch(/lane: full/);
    expect(plan).toMatch(/Rate Limit Login Endpoint/);

    // Smelt must carry mapped fields
    const smelt = JSON.parse(readFileSync(r.smeltPath, "utf-8"));
    expect(smelt.source).toBe("speckit");
    expect(smelt.status).toBe("imported");
    expect(smelt["plan-title"]).toBe("Rate Limit Login Endpoint");
    expect(smelt.slices).toHaveLength(5);
    expect(smelt.slices[0].tasks.length).toBeGreaterThan(0);
    expect(smelt["forbidden-actions"]).toHaveLength(4);
    expect(smelt["agent-constraints"].length).toBeGreaterThanOrEqual(5);

    // Audit-log entry
    const audit = readFileSync(join(root, ".forge", "crucible", "manual-imports.jsonl"), "utf-8");
    expect(audit).toMatch(/"source":"speckit"/);
    expect(audit).toMatch(/"crucibleId":"imported-speckit-/);
  });

  it("--dry-run writes nothing but reports success", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);

    const r = importSpeckit({ projectRoot: root, dryRun: true });

    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.mappedFields.length).toBeGreaterThan(0);
    expect(existsSync(join(root, ".forge", "crucible"))).toBe(false);
    expect(existsSync(join(root, "docs", "plans"))).toBe(false);
  });

  it("appends -2 to plan filename when collision occurs", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);
    const r1 = importSpeckit({ projectRoot: root });
    const r2 = importSpeckit({ projectRoot: root });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.planPath).not.toBe(r2.planPath);
    expect(r2.planPath).toMatch(/-2-PLAN\.md$/);
  });
});

// ─── importSpeckit error paths ───────────────────────────────────────────────
describe("importSpeckit — error paths", () => {
  it("returns SPECKIT_IMPORT_NOT_FOUND when no artifacts exist", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-empty-"));
    cleanupRoots.push(root);
    const r = importSpeckit({ projectRoot: root });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SPECKIT_IMPORT_NOT_FOUND");
  });

  it("returns SPECKIT_IMPORT_DIR_NOT_FOUND when --dir is bogus", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-baddir-"));
    cleanupRoots.push(root);
    const r = importSpeckit({ projectRoot: root, dir: "no/such/place" });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SPECKIT_IMPORT_DIR_NOT_FOUND");
  });

  it("returns SPECKIT_IMPORT_MISSING_FIELD when spec.md lacks a title", () => {
    const root = stageProject("invalid", { includeConstitutionInMemory: false });
    cleanupRoots.push(root);
    const r = importSpeckit({ projectRoot: root });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SPECKIT_IMPORT_MISSING_FIELD");
    expect(r.missingFields.some((m) => m.field === "title")).toBe(true);
  });

  it("returns SPECKIT_IMPORT_MISSING_REQUIRED when plan.md is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-noplan-"));
    cleanupRoots.push(root);
    const featDir = join(root, "specs", "demo");
    mkdirSync(featDir, { recursive: true });
    copyFileSync(join(FIXTURES, "green", "spec.md"), join(featDir, "spec.md"));
    const r = importSpeckit({ projectRoot: root });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("SPECKIT_IMPORT_MISSING_REQUIRED");
  });
});

// ─── importSpeckit warnings ──────────────────────────────────────────────────
describe("importSpeckit — partial fixture", () => {
  it("imports successfully but warns on missing tasks.md", () => {
    const root = stageProject("partial");
    cleanupRoots.push(root);
    const r = importSpeckit({ projectRoot: root });
    expect(r.ok).toBe(true);
    expect(r.missingFields.some((m) => m.file === "tasks.md")).toBe(true);
    expect(r.missingFields.find((m) => m.file === "tasks.md").severity).toBe("warn");
  });
});

// ─── --sync-principles ───────────────────────────────────────────────────────
describe("importSpeckit — --sync-principles", () => {
  it("writes PROJECT-PRINCIPLES.md when constitution.md present and target absent", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);
    const r = importSpeckit({ projectRoot: root, syncPrinciples: true });
    expect(r.ok).toBe(true);
    const pp = join(root, "docs", "plans", "PROJECT-PRINCIPLES.md");
    expect(existsSync(pp)).toBe(true);
    const body = readFileSync(pp, "utf-8");
    expect(body).toMatch(/^# Project Principles/);
    expect(body).toMatch(/secret manager/);
  });

  it("returns PROJECT_PRINCIPLES_EXISTS when target already exists", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);
    const pp = join(root, "docs", "plans", "PROJECT-PRINCIPLES.md");
    mkdirSync(dirname(pp), { recursive: true });
    writeFileSync(pp, "# pre-existing\n");
    const r = importSpeckit({ projectRoot: root, syncPrinciples: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("PROJECT_PRINCIPLES_EXISTS");
  });

  it("returns PROJECT_PRINCIPLES_NO_SOURCE when constitution.md absent", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-nocons-"));
    cleanupRoots.push(root);
    const featDir = join(root, "specs", "demo");
    mkdirSync(featDir, { recursive: true });
    copyFileSync(join(FIXTURES, "green", "spec.md"), join(featDir, "spec.md"));
    copyFileSync(join(FIXTURES, "green", "plan.md"), join(featDir, "plan.md"));
    const r = importSpeckit({ projectRoot: root, syncPrinciples: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("PROJECT_PRINCIPLES_NO_SOURCE");
  });
});

// ─── listSmelts / getSmelt ───────────────────────────────────────────────────
describe("listSmelts / getSmelt", () => {
  it("returns empty list when .forge/crucible/ does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-list-empty-"));
    cleanupRoots.push(root);
    const r = listSmelts(root);
    expect(r.smelts).toEqual([]);
  });

  it("lists imported smelts and surfaces metadata", () => {
    const root = stageProject("green");
    cleanupRoots.push(root);
    const im = importSpeckit({ projectRoot: root });
    expect(im.ok).toBe(true);

    const list = listSmelts(root);
    expect(list.smelts).toHaveLength(1);
    expect(list.smelts[0].source).toBe("speckit");
    expect(list.smelts[0].status).toBe("imported");
    expect(list.smelts[0].planTitle).toBe("Rate Limit Login Endpoint");

    const detail = getSmelt(root, list.smelts[0].id);
    expect(detail).not.toBeNull();
    expect(detail.source).toBe("speckit");

    expect(getSmelt(root, "nonexistent")).toBeNull();
  });

  it("ignores config.json and phase-claims.json", () => {
    const root = mkdtempSync(join(tmpdir(), "speckit-list-skip-"));
    cleanupRoots.push(root);
    const dir = join(root, ".forge", "crucible");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), "{}");
    writeFileSync(join(dir, "phase-claims.json"), "{}");
    const r = listSmelts(root);
    expect(r.smelts).toHaveLength(0);
  });
});
