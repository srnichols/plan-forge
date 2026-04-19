/**
 * Plan Forge — Crucible Enforcement tests (Slice 01.4).
 *
 * Covers:
 *   - parseFrontmatter (happy + malformed + CRLF)
 *   - enforceCrucibleId accept / reject / bypass paths
 *   - Audit log: manual-imports.jsonl content and tagging
 *   - grandfatherExistingPlans idempotence, body safety, audit trail
 *   - Spec Kit importer compatibility: a plan with
 *     `crucibleId: imported-speckit-*` is accepted without
 *     --manual-import (proving the importer is not broken by the gate)
 *   - upsertFrontmatter round-trip and onlyIfMissing semantics
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  parseFrontmatter,
  enforceCrucibleId,
  CrucibleEnforcementError,
  readManualImports,
  manualImportLogPath,
  logManualImport,
  upsertFrontmatter,
} from "../crucible-enforce.mjs";

import {
  grandfatherExistingPlans,
} from "../crucible-migrate.mjs";

let projectDir;
let plansDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "pforge-crucible-enforce-"));
  plansDir = resolve(projectDir, "docs", "plans");
  mkdirSync(plansDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writePlan(name, content) {
  const path = join(plansDir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

// ─── parseFrontmatter ────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  it("extracts key:value pairs from a well-formed block", () => {
    const { frontmatter, body } = parseFrontmatter(
      "---\ncrucibleId: abc-123\nlane: feature\n---\n\n# Title\n",
    );
    expect(frontmatter).toMatchObject({ crucibleId: "abc-123", lane: "feature" });
    expect(body).toBe("\n# Title\n");
  });
  it("returns empty frontmatter for a plain markdown file", () => {
    const r = parseFrontmatter("# Title\n\nBody only\n");
    expect(r.frontmatter).toEqual({});
    expect(r.body).toContain("Title");
  });
  it("handles CRLF line endings", () => {
    const r = parseFrontmatter("---\r\ncrucibleId: x\r\n---\r\n\r\nbody\r\n");
    expect(r.frontmatter.crucibleId).toBe("x");
  });
  it("strips surrounding quotes from values", () => {
    const r = parseFrontmatter('---\ncrucibleId: "abc"\nlane: \'feature\'\n---\n');
    expect(r.frontmatter.crucibleId).toBe("abc");
    expect(r.frontmatter.lane).toBe("feature");
  });
  it("tolerates non-string inputs defensively", () => {
    expect(parseFrontmatter(null).frontmatter).toEqual({});
    expect(parseFrontmatter(undefined).frontmatter).toEqual({});
  });
  it("ignores unparseable lines inside the block", () => {
    const r = parseFrontmatter("---\ncrucibleId: ok\n@weird entry\n---\n\nbody");
    expect(r.frontmatter).toEqual({ crucibleId: "ok" });
  });
});

// ─── enforceCrucibleId ───────────────────────────────────────────────

describe("enforceCrucibleId", () => {
  it("accepts a plan with a crucibleId frontmatter", () => {
    const path = writePlan(
      "Phase-01.md",
      "---\ncrucibleId: smelt-123\n---\n\n# Plan\n",
    );
    const r = enforceCrucibleId(path, { cwd: projectDir });
    expect(r).toMatchObject({ ok: true, crucibleId: "smelt-123", bypassed: false });
  });

  it("rejects a plan without crucibleId and no --manual-import", () => {
    const path = writePlan("Phase-01.md", "# Plan\n\nNo frontmatter here.\n");
    expect(() => enforceCrucibleId(path, { cwd: projectDir }))
      .toThrow(CrucibleEnforcementError);
  });

  it("rejection error carries a structured code and hint-friendly message", () => {
    const path = writePlan("Phase-01.md", "# Plan\n");
    try {
      enforceCrucibleId(path, { cwd: projectDir });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CrucibleEnforcementError);
      expect(err.code).toBe("CRUCIBLE_ID_REQUIRED");
      expect(err.message).toMatch(/crucibleId/);
      expect(err.message).toMatch(/--manual-import/);
    }
  });

  it("bypasses with --manual-import and writes an audit entry", () => {
    const path = writePlan("Phase-01.md", "# Plan\n");
    const r = enforceCrucibleId(path, {
      cwd: projectDir,
      manualImport: true,
      source: "human",
      reason: "smoke test",
    });
    expect(r).toMatchObject({ ok: true, bypassed: true });

    const audit = readManualImports(projectDir);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      planPath: path,
      source: "human",
      reason: "smoke test",
      crucibleId: null,
    });
    expect(audit[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("tags the audit entry with the caller-supplied source", () => {
    const path = writePlan("Phase-01.md", "# Plan\n");
    enforceCrucibleId(path, { cwd: projectDir, manualImport: true, source: "speckit" });
    const audit = readManualImports(projectDir);
    expect(audit[0].source).toBe("speckit");
  });

  it("appends subsequent bypasses to the same log file", () => {
    const a = writePlan("Phase-01.md", "# A\n");
    const b = writePlan("Phase-02.md", "# B\n");
    enforceCrucibleId(a, { cwd: projectDir, manualImport: true });
    enforceCrucibleId(b, { cwd: projectDir, manualImport: true });
    expect(readManualImports(projectDir)).toHaveLength(2);
  });

  it("throws a plain Error (not CrucibleEnforcementError) when the plan file is missing", () => {
    expect(() => enforceCrucibleId("docs/plans/nope.md", { cwd: projectDir }))
      .toThrow(/Plan file not readable/);
  });
});

// ─── Spec Kit importer compatibility ─────────────────────────────────

describe("Spec Kit importer compatibility", () => {
  it("accepts a Spec Kit-imported plan with imported-speckit-* crucibleId without --manual-import", () => {
    const path = writePlan(
      "Phase-05-Auth-Imported.md",
      "---\n" +
      "crucibleId: imported-speckit-a1b2c3d4-e5f6-7890-abcd-ef1234567890\n" +
      "lane: full\n" +
      "source: speckit\n" +
      "---\n\n" +
      "# Phase 5 — OAuth login (imported from Spec Kit)\n\n" +
      "### Specification Source\n" +
      "- Imported from: Spec Kit (`specs/005-auth/spec.md`)\n" +
      "- Plan source: `specs/005-auth/plan.md`\n",
    );
    const r = enforceCrucibleId(path, { cwd: projectDir });
    expect(r.ok).toBe(true);
    expect(r.bypassed).toBe(false); // accepted on frontmatter, NO bypass audited
    expect(r.crucibleId).toMatch(/^imported-speckit-/);
    expect(r.frontmatter.source).toBe("speckit");
    // No audit entry should be written when frontmatter is present
    expect(existsSync(manualImportLogPath(projectDir))).toBe(false);
  });

  it("accepts --manual-import with source=speckit when frontmatter is missing (legacy import path)", () => {
    const path = writePlan(
      "Phase-06-Legacy-Import.md",
      "# Phase 6 — legacy Spec Kit import without frontmatter\n",
    );
    const r = enforceCrucibleId(path, {
      cwd: projectDir,
      manualImport: true,
      source: "speckit",
      reason: "pre-v2.37 spec kit import",
    });
    expect(r.bypassed).toBe(true);
    const audit = readManualImports(projectDir);
    expect(audit[0].source).toBe("speckit");
  });
});

// ─── logManualImport + readManualImports ─────────────────────────────

describe("audit log", () => {
  it("creates the audit directory on first write", () => {
    logManualImport(projectDir, { timestamp: "t", source: "test" });
    expect(existsSync(manualImportLogPath(projectDir))).toBe(true);
  });
  it("skips malformed JSONL lines when reading", () => {
    logManualImport(projectDir, { timestamp: "t", source: "test" });
    // Corrupt the file with an invalid line
    const path = manualImportLogPath(projectDir);
    const existing = readFileSync(path, "utf-8");
    writeFileSync(path, existing + "NOT-JSON\n" + '{"timestamp":"t2","source":"ok"}\n');
    const entries = readManualImports(projectDir);
    expect(entries).toHaveLength(2); // malformed line dropped
    expect(entries[1].source).toBe("ok");
  });
  it("readManualImports returns [] when log absent", () => {
    expect(readManualImports(projectDir)).toEqual([]);
  });
});

// ─── upsertFrontmatter ───────────────────────────────────────────────

describe("upsertFrontmatter", () => {
  it("adds frontmatter to a plain markdown file", () => {
    const r = upsertFrontmatter("# Title\n\nbody\n", { crucibleId: "abc" });
    expect(r.changed).toBe(true);
    expect(r.content).toMatch(/^---\ncrucibleId: abc\n---\n\n# Title/);
  });
  it("merges into existing frontmatter without duplicating", () => {
    const input = "---\nlane: feature\n---\n\n# Title\n";
    const r = upsertFrontmatter(input, { crucibleId: "abc" });
    expect(r.content).toMatch(/lane: feature/);
    expect(r.content).toMatch(/crucibleId: abc/);
    // Body preserved
    expect(r.content).toMatch(/# Title/);
  });
  it("is idempotent when value is identical", () => {
    const input = "---\ncrucibleId: abc\n---\n\nbody\n";
    const r = upsertFrontmatter(input, { crucibleId: "abc" });
    expect(r.changed).toBe(false);
  });
  it("onlyIfMissing keeps existing values", () => {
    const input = "---\ncrucibleId: original\n---\nbody";
    const r = upsertFrontmatter(input, { crucibleId: "new" }, { onlyIfMissing: true });
    expect(r.changed).toBe(false);
    expect(r.content).toMatch(/crucibleId: original/);
  });
});

// ─── grandfatherExistingPlans ────────────────────────────────────────

describe("grandfatherExistingPlans", () => {
  it("stamps legacy plans lacking crucibleId", () => {
    writePlan("Phase-1A-Cell-Foundation.md", "# Phase 1A\n\nBody.\n");
    writePlan("Phase-1B-Recovery.md", "# Phase 1B\n\nBody.\n");
    const r = grandfatherExistingPlans(projectDir);
    expect(r.scanned).toBe(2);
    expect(r.stamped).toHaveLength(2);
    expect(r.stamped[0].crucibleId).toMatch(/^grandfathered-[0-9a-f-]{36}$/);
    // Files now carry frontmatter
    const first = readFileSync(r.stamped[0].path, "utf-8");
    expect(first).toMatch(/^---\ncrucibleId: grandfathered-/);
    expect(first).toContain("Body.");
  });

  it("is idempotent — second run skips already-stamped plans", () => {
    writePlan("Phase-1A.md", "# Phase 1A\n\nBody\n");
    const first = grandfatherExistingPlans(projectDir);
    const second = grandfatherExistingPlans(projectDir);
    expect(first.stamped).toHaveLength(1);
    expect(second.stamped).toHaveLength(0);
    expect(second.skipped[0].reason).toBe("already-stamped");
    // Crucible id is preserved across runs
    const content = readFileSync(first.stamped[0].path, "utf-8");
    expect(content).toContain(first.stamped[0].crucibleId);
  });

  it("does not touch a plan that was already smelted", () => {
    const path = writePlan("Phase-01.md", "---\ncrucibleId: real-smelt\n---\n\n# X\n");
    const r = grandfatherExistingPlans(projectDir);
    expect(r.stamped).toHaveLength(0);
    expect(r.skipped[0].reason).toBe("already-stamped");
    const content = readFileSync(path, "utf-8");
    expect(content).toMatch(/crucibleId: real-smelt/);
    expect(content).not.toMatch(/grandfathered-/);
  });

  it("body is byte-preserved (no additions beyond frontmatter)", () => {
    const body = "# Phase 1A\n\nSome body\nwith multiple lines.\n";
    const path = writePlan("Phase-1A.md", body);
    grandfatherExistingPlans(projectDir);
    const after = readFileSync(path, "utf-8");
    // Body must appear verbatim after the closing frontmatter delimiter
    expect(after.endsWith(body)).toBe(true);
  });

  it("writes one audit entry per stamped file with source='grandfather'", () => {
    writePlan("Phase-1A.md", "# A\n");
    writePlan("Phase-1B.md", "# B\n");
    grandfatherExistingPlans(projectDir);
    const audit = readManualImports(projectDir);
    expect(audit).toHaveLength(2);
    for (const entry of audit) {
      expect(entry.source).toBe("grandfather");
      expect(entry.crucibleId).toMatch(/^grandfathered-/);
    }
  });

  it("skips non-phase files in docs/plans/", () => {
    writePlan("Phase-1A.md", "# A\n");
    writePlan("README.md", "# readme");
    writePlan("DEPLOYMENT-ROADMAP.md", "# roadmap");
    const r = grandfatherExistingPlans(projectDir);
    expect(r.scanned).toBe(1);
    expect(r.stamped).toHaveLength(1);
  });

  it("dryRun does not write files or audit entries", () => {
    const path = writePlan("Phase-1A.md", "# A\n");
    const r = grandfatherExistingPlans(projectDir, { dryRun: true });
    expect(r.stamped).toHaveLength(1);
    const content = readFileSync(path, "utf-8");
    expect(content).not.toMatch(/crucibleId:/);
    expect(readManualImports(projectDir)).toEqual([]);
  });

  it("returns empty report when docs/plans/ does not exist", () => {
    rmSync(plansDir, { recursive: true, force: true });
    const r = grandfatherExistingPlans(projectDir);
    expect(r).toEqual({ scanned: 0, stamped: [], skipped: [] });
  });

  it("post-migration plans pass enforceCrucibleId without bypass", () => {
    const path = writePlan("Phase-1A.md", "# A\n");
    grandfatherExistingPlans(projectDir);
    const r = enforceCrucibleId(path, { cwd: projectDir });
    expect(r.ok).toBe(true);
    expect(r.bypassed).toBe(false);
    expect(r.crucibleId).toMatch(/^grandfathered-/);
  });
});
