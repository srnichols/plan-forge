/**
 * Plan Forge — Crucible: phase-naming + persistence unit tests.
 *
 * Covers Phase-CRUCIBLE-01 Slice 1 acceptance criteria:
 *   - MUST: Phase naming validator enforces decimal-only semver rule
 *   - MUST: Atomic phase-number claim via file lock
 *   - MUST: Smelts persist to .forge/crucible/<id>.json (resumable)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isValidPhaseName,
  parsePhaseName,
  comparePhaseNames,
  nextPhaseNumber,
  claimPhaseNumber,
  releaseClaim,
  listClaims,
  _resetClaimsForTest,
} from "../crucible.mjs";

import {
  createSmelt,
  loadSmelt,
  updateSmelt,
  listSmelts,
  abandonSmelt,
  _deleteSmeltForTest,
} from "../crucible-store.mjs";

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "pforge-crucible-"));
});

afterEach(() => {
  try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── isValidPhaseName / parsePhaseName ───────────────────────────────

describe("isValidPhaseName", () => {
  it("accepts top-level decimal names", () => {
    expect(isValidPhaseName("Phase-01")).toBe(true);
    expect(isValidPhaseName("Phase-12")).toBe(true);
    expect(isValidPhaseName("Phase-99")).toBe(true);
  });
  it("accepts nested decimal names", () => {
    expect(isValidPhaseName("Phase-01.1")).toBe(true);
    expect(isValidPhaseName("Phase-01.1.2")).toBe(true);
    expect(isValidPhaseName("Phase-12.34.56")).toBe(true);
  });
  it("rejects letter-bearing names", () => {
    expect(isValidPhaseName("Phase-01D")).toBe(false);
    expect(isValidPhaseName("Phase-1.C.2")).toBe(false);
    expect(isValidPhaseName("Phase-2.1A")).toBe(false);
    expect(isValidPhaseName("Phase-CRUCIBLE-01")).toBe(false);
  });
  it("rejects malformed inputs", () => {
    expect(isValidPhaseName("phase-01")).toBe(false); // lowercase
    expect(isValidPhaseName("Phase-1")).toBe(false);  // must be 2+ digits top-level
    expect(isValidPhaseName("")).toBe(false);
    expect(isValidPhaseName(null)).toBe(false);
    expect(isValidPhaseName(undefined)).toBe(false);
    expect(isValidPhaseName(42)).toBe(false);
  });
});

describe("parsePhaseName", () => {
  it("returns numeric segments", () => {
    expect(parsePhaseName("Phase-01")).toEqual([1]);
    expect(parsePhaseName("Phase-12.3.4")).toEqual([12, 3, 4]);
  });
  it("returns null for invalid", () => {
    expect(parsePhaseName("Phase-1D")).toBeNull();
    expect(parsePhaseName("bad")).toBeNull();
  });
});

// ─── comparePhaseNames sort ──────────────────────────────────────────

describe("comparePhaseNames", () => {
  it("orders 01 < 01.1 < 01.2 < 02", () => {
    const list = ["Phase-02", "Phase-01.2", "Phase-01", "Phase-01.1"];
    list.sort(comparePhaseNames);
    expect(list).toEqual(["Phase-01", "Phase-01.1", "Phase-01.2", "Phase-02"]);
  });
  it("orders deeper nesting correctly", () => {
    const list = ["Phase-01.1.2", "Phase-01.2", "Phase-01.1", "Phase-01.1.1"];
    list.sort(comparePhaseNames);
    expect(list).toEqual([
      "Phase-01.1",
      "Phase-01.1.1",
      "Phase-01.1.2",
      "Phase-01.2",
    ]);
  });
  it("sorts invalid names last, stable for equal", () => {
    const list = ["Phase-99.9", "garbage", "Phase-01", "also-bad"];
    list.sort(comparePhaseNames);
    expect(list[0]).toBe("Phase-01");
    expect(list[1]).toBe("Phase-99.9");
  });
});

// ─── nextPhaseNumber ─────────────────────────────────────────────────

describe("nextPhaseNumber", () => {
  it("picks next top-level from empty", () => {
    expect(nextPhaseNumber([])).toBe("Phase-01");
  });
  it("picks max+1 top-level", () => {
    expect(nextPhaseNumber(["Phase-01", "Phase-02", "Phase-05"])).toBe("Phase-06");
  });
  it("ignores invalid names when computing max", () => {
    expect(nextPhaseNumber(["Phase-01", "garbage", "Phase-CRUCIBLE-01"])).toBe("Phase-02");
  });
  it("picks next child for a parent", () => {
    expect(nextPhaseNumber(["Phase-02.1", "Phase-02.2"], "Phase-02")).toBe("Phase-02.3");
  });
  it("picks first child when parent has none", () => {
    expect(nextPhaseNumber(["Phase-02"], "Phase-02")).toBe("Phase-02.1");
  });
  it("ignores siblings of other parents", () => {
    // Phase-03.1 should NOT influence Phase-02's children
    expect(nextPhaseNumber(["Phase-02.1", "Phase-03.1"], "Phase-02")).toBe("Phase-02.2");
  });
  it("rejects invalid parent", () => {
    expect(() => nextPhaseNumber([], "garbage")).toThrow(/invalid parent/);
  });
});

// ─── atomic claimPhaseNumber ─────────────────────────────────────────

describe("claimPhaseNumber", () => {
  it("claims a fresh phase name", () => {
    const result = claimPhaseNumber(projectDir, "Phase-01", "smelt-a");
    expect(result.claimed).toBe(true);
    const claims = listClaims(projectDir);
    expect(claims).toHaveLength(1);
    expect(claims[0].phaseName).toBe("Phase-01");
    expect(claims[0].id).toBe("smelt-a");
    expect(claims[0].claimedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("rejects duplicate claim", () => {
    claimPhaseNumber(projectDir, "Phase-01", "smelt-a");
    expect(() => claimPhaseNumber(projectDir, "Phase-01", "smelt-b"))
      .toThrow(/already claimed/);
  });
  it("rejects invalid phase name", () => {
    expect(() => claimPhaseNumber(projectDir, "Phase-CRUCIBLE-01", "smelt-a"))
      .toThrow(/invalid phase name/);
  });
  it("rejects missing smeltId", () => {
    expect(() => claimPhaseNumber(projectDir, "Phase-01", ""))
      .toThrow(/smeltId is required/);
  });
  it("persists claims across reads", () => {
    claimPhaseNumber(projectDir, "Phase-01", "smelt-a");
    claimPhaseNumber(projectDir, "Phase-01.1", "smelt-b");
    const claims = listClaims(projectDir);
    expect(claims).toHaveLength(2);
    const names = claims.map((c) => c.phaseName).sort();
    expect(names).toEqual(["Phase-01", "Phase-01.1"]);
  });
  it("writes to the expected path", () => {
    claimPhaseNumber(projectDir, "Phase-01", "smelt-a");
    const path = join(projectDir, ".forge", "crucible", "phase-claims.json");
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed["Phase-01"].id).toBe("smelt-a");
  });
  it("recovers from corrupt claims file", () => {
    const dir = join(projectDir, ".forge", "crucible");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "phase-claims.json"), "not json", "utf-8");
    // Should treat as empty and succeed
    expect(() => claimPhaseNumber(projectDir, "Phase-01", "smelt-a")).not.toThrow();
  });
});

describe("releaseClaim", () => {
  it("releases a held claim", () => {
    claimPhaseNumber(projectDir, "Phase-01", "smelt-a");
    const r = releaseClaim(projectDir, "Phase-01", "smelt-a");
    expect(r.released).toBe(true);
    expect(listClaims(projectDir)).toHaveLength(0);
  });
  it("refuses to release someone else's claim", () => {
    claimPhaseNumber(projectDir, "Phase-01", "smelt-a");
    const r = releaseClaim(projectDir, "Phase-01", "smelt-b");
    expect(r.released).toBe(false);
    expect(listClaims(projectDir)).toHaveLength(1);
  });
  it("is a no-op for non-existent claim", () => {
    const r = releaseClaim(projectDir, "Phase-99", "smelt-a");
    expect(r.released).toBe(false);
  });
});

// ─── createSmelt / loadSmelt ─────────────────────────────────────────

describe("createSmelt", () => {
  it("creates a smelt with defaults", () => {
    const s = createSmelt({ lane: "feature", rawIdea: "add widget", projectDir });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.lane).toBe("feature");
    expect(s.rawIdea).toBe("add widget");
    expect(s.source).toBe("human");
    expect(s.status).toBe("in-progress");
    expect(s.answers).toEqual([]);
    expect(s.draftMarkdown).toBe("");
    expect(s.phaseName).toBeNull();
    expect(s.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.updatedAt).toBe(s.createdAt);
    expect(s.parentSmeltId).toBeNull();
  });
  it("supports agent source with parentSmeltId", () => {
    const parent = createSmelt({ lane: "feature", rawIdea: "x", projectDir });
    const child = createSmelt({
      lane: "tweak",
      rawIdea: "y",
      projectDir,
      source: "agent",
      parentSmeltId: parent.id,
    });
    expect(child.source).toBe("agent");
    expect(child.parentSmeltId).toBe(parent.id);
  });
  it("rejects invalid lane", () => {
    expect(() => createSmelt({ lane: "bogus", rawIdea: "x", projectDir }))
      .toThrow(/invalid lane/);
  });
  it("rejects empty rawIdea", () => {
    expect(() => createSmelt({ lane: "tweak", rawIdea: "   ", projectDir }))
      .toThrow(/rawIdea is required/);
  });
  it("rejects invalid source", () => {
    expect(() => createSmelt({ lane: "tweak", rawIdea: "x", projectDir, source: "bot" }))
      .toThrow(/invalid source/);
  });
});

describe("loadSmelt", () => {
  it("round-trips a created smelt", () => {
    const s = createSmelt({ lane: "tweak", rawIdea: "fix typo", projectDir });
    const loaded = loadSmelt(s.id, projectDir);
    expect(loaded).toEqual(s);
  });
  it("returns null for missing id", () => {
    expect(loadSmelt("nonexistent", projectDir)).toBeNull();
  });
  it("returns null for invalid id", () => {
    expect(loadSmelt("", projectDir)).toBeNull();
    expect(loadSmelt(null, projectDir)).toBeNull();
  });
});

// ─── updateSmelt ─────────────────────────────────────────────────────

describe("updateSmelt", () => {
  it("merges patch fields and refreshes updatedAt", async () => {
    const s = createSmelt({ lane: "feature", rawIdea: "x", projectDir });
    // Wait so updatedAt actually changes
    await new Promise((r) => setTimeout(r, 10));
    const updated = updateSmelt(s.id, { draftMarkdown: "# draft" }, projectDir);
    expect(updated.draftMarkdown).toBe("# draft");
    expect(updated.updatedAt).not.toBe(s.updatedAt);
    expect(updated.createdAt).toBe(s.createdAt);
  });
  it("ignores attempts to change immutable fields", () => {
    const s = createSmelt({ lane: "feature", rawIdea: "x", projectDir });
    const updated = updateSmelt(s.id, {
      id: "hacked",
      createdAt: "1999-01-01T00:00:00Z",
      source: "agent",
      draftMarkdown: "ok",
    }, projectDir);
    expect(updated.id).toBe(s.id);
    expect(updated.createdAt).toBe(s.createdAt);
    expect(updated.source).toBe("human");
    expect(updated.draftMarkdown).toBe("ok");
  });
  it("validates lane in patch", () => {
    const s = createSmelt({ lane: "feature", rawIdea: "x", projectDir });
    expect(() => updateSmelt(s.id, { lane: "bogus" }, projectDir)).toThrow(/invalid lane/);
  });
  it("validates status in patch", () => {
    const s = createSmelt({ lane: "feature", rawIdea: "x", projectDir });
    expect(() => updateSmelt(s.id, { status: "bogus" }, projectDir)).toThrow(/invalid status/);
  });
  it("throws on missing smelt", () => {
    expect(() => updateSmelt("nonexistent", { draftMarkdown: "x" }, projectDir))
      .toThrow(/not found/);
  });
});

// ─── listSmelts ──────────────────────────────────────────────────────

describe("listSmelts", () => {
  it("returns empty for fresh project", () => {
    expect(listSmelts(projectDir)).toEqual([]);
  });
  it("returns smelts newest-first by updatedAt", async () => {
    const a = createSmelt({ lane: "tweak", rawIdea: "first", projectDir });
    await new Promise((r) => setTimeout(r, 5));
    const b = createSmelt({ lane: "tweak", rawIdea: "second", projectDir });
    const list = listSmelts(projectDir);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
  it("filters by status", () => {
    createSmelt({ lane: "tweak", rawIdea: "ongoing", projectDir });
    const b = createSmelt({ lane: "tweak", rawIdea: "done", projectDir });
    updateSmelt(b.id, { status: "finalized" }, projectDir);
    expect(listSmelts(projectDir, { status: "in-progress" })).toHaveLength(1);
    expect(listSmelts(projectDir, { status: "finalized" })).toHaveLength(1);
  });
  it("skips reserved files (phase-claims, config, manual-imports)", () => {
    createSmelt({ lane: "tweak", rawIdea: "x", projectDir });
    claimPhaseNumber(projectDir, "Phase-01", "fake-id");
    const dir = join(projectDir, ".forge", "crucible");
    writeFileSync(join(dir, "config.json"), "{}", "utf-8");
    writeFileSync(join(dir, "manual-imports.jsonl"), "", "utf-8");
    const list = listSmelts(projectDir);
    expect(list).toHaveLength(1);
  });
});

// ─── abandonSmelt ────────────────────────────────────────────────────

describe("abandonSmelt", () => {
  it("marks status and releases the phase claim", () => {
    const s = createSmelt({ lane: "feature", rawIdea: "x", projectDir });
    claimPhaseNumber(projectDir, "Phase-01", s.id);
    updateSmelt(s.id, { phaseName: "Phase-01" }, projectDir);
    expect(listClaims(projectDir)).toHaveLength(1);
    const r = abandonSmelt(s.id, projectDir);
    expect(r.abandoned).toBe(true);
    expect(loadSmelt(s.id, projectDir).status).toBe("abandoned");
    expect(listClaims(projectDir)).toHaveLength(0);
  });
  it("is idempotent", () => {
    const s = createSmelt({ lane: "tweak", rawIdea: "x", projectDir });
    abandonSmelt(s.id, projectDir);
    const r = abandonSmelt(s.id, projectDir);
    expect(r.abandoned).toBe(true);
  });
  it("returns false for missing smelt", () => {
    const r = abandonSmelt("nonexistent", projectDir);
    expect(r.abandoned).toBe(false);
  });
  it("releases claim only for smelts that hold one", () => {
    const s = createSmelt({ lane: "tweak", rawIdea: "x", projectDir });
    // No phaseName, no claim
    abandonSmelt(s.id, projectDir);
    expect(loadSmelt(s.id, projectDir).status).toBe("abandoned");
  });
});
