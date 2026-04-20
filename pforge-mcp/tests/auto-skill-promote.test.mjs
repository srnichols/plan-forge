/**
 * Plan Forge — Phase-26 Slice 8 (Auto-skill promotion) unit tests
 *
 * Covers the auto-skill promotion state machine in memory.mjs:
 *   - getAutoSkillStatus()
 *   - listPendingAutoSkills()
 *   - acceptAutoSkill()
 *   - rejectAutoSkill()
 *   - deferAutoSkill()
 *
 * States: pending → promoted | rejected | deferred. A deferred entry whose
 * `deferredUntil` has passed transitions back to pending automatically.
 *
 * Plan: docs/plans/Phase-26-COMPETITIVE-LOOP-v2.58-PLAN.md (Slice 8)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  extractAutoSkill,
  writeAutoSkill,
  incrementAutoSkillReuse,
  getAutoSkillStatus,
  listPendingAutoSkills,
  acceptAutoSkill,
  rejectAutoSkill,
  deferAutoSkill,
  AUTOSKILL_DEFER_MS,
} from "../memory.mjs";

// Helper: create an auto-skill with a target reuseCount in the tmp cwd.
function seedSkill(cwd, { title, reuseCount = 0, idx = 1 } = {}) {
  const rec = extractAutoSkill({
    slice: { number: idx, title, validationGate: `echo slice-${idx}` },
    now: `2026-04-20T00:00:00.00${idx}Z`,
  });
  writeAutoSkill({ cwd, record: rec });
  for (let i = 0; i < reuseCount; i++) {
    incrementAutoSkillReuse({ cwd, sha256Prefix: rec.sha256Prefix });
  }
  return rec.sha256Prefix;
}

describe("Phase-26 Slice 8 — auto-skill promotion state machine", () => {
  let cwd;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-skill-promote-"));
  });

  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── getAutoSkillStatus ────────────────────────────────────────────────

  describe("getAutoSkillStatus", () => {
    it("returns 'pending' for an unknown skill with no state", () => {
      expect(getAutoSkillStatus({ cwd, sha256Prefix: "deadbeef0000" })).toBe("pending");
    });

    it("returns 'promoted' when .github/skills/auto-<prefix>/SKILL.md exists", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      acceptAutoSkill({ cwd, sha256Prefix: prefix });
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix })).toBe("promoted");
    });

    it("returns 'rejected' after rejectAutoSkill", () => {
      const prefix = seedSkill(cwd, { title: "api endpoint", reuseCount: 3 });
      rejectAutoSkill({ cwd, sha256Prefix: prefix, reason: "noise" });
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix })).toBe("rejected");
    });

    it("returns 'deferred' while deferredUntil is in the future", () => {
      const prefix = seedSkill(cwd, { title: "testing work", reuseCount: 3 });
      const now = Date.parse("2026-04-20T00:00:00.000Z");
      deferAutoSkill({ cwd, sha256Prefix: prefix, now });
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix, now: now + 1000 })).toBe("deferred");
    });

    it("returns 'pending' once deferredUntil has expired", () => {
      const prefix = seedSkill(cwd, { title: "testing work", reuseCount: 3 });
      const now = Date.parse("2026-04-20T00:00:00.000Z");
      deferAutoSkill({ cwd, sha256Prefix: prefix, now });
      const later = now + AUTOSKILL_DEFER_MS + 1000;
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix, now: later })).toBe("pending");
    });
  });

  // ─── listPendingAutoSkills ─────────────────────────────────────────────

  describe("listPendingAutoSkills", () => {
    it("returns [] when no candidates exist", () => {
      expect(listPendingAutoSkills({ cwd })).toEqual([]);
    });

    it("omits candidates below the threshold", () => {
      seedSkill(cwd, { title: "database migration", reuseCount: 2, idx: 1 });
      expect(listPendingAutoSkills({ cwd, threshold: 3 })).toEqual([]);
    });

    it("includes candidates at or above threshold (default 3)", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3, idx: 1 });
      const pending = listPendingAutoSkills({ cwd });
      expect(pending).toHaveLength(1);
      expect(pending[0].sha256Prefix).toBe(prefix);
    });

    it("orders results by reuseCount descending", () => {
      const a = seedSkill(cwd, { title: "database migration", reuseCount: 3, idx: 1 });
      const b = seedSkill(cwd, { title: "api endpoint design", reuseCount: 7, idx: 2 });
      const c = seedSkill(cwd, { title: "testing coverage", reuseCount: 5, idx: 3 });
      const pending = listPendingAutoSkills({ cwd });
      expect(pending.map((s) => s.sha256Prefix)).toEqual([b, c, a]);
    });

    it("excludes promoted candidates", () => {
      const a = seedSkill(cwd, { title: "database migration", reuseCount: 3, idx: 1 });
      const b = seedSkill(cwd, { title: "api endpoint design", reuseCount: 3, idx: 2 });
      acceptAutoSkill({ cwd, sha256Prefix: a });
      const pending = listPendingAutoSkills({ cwd });
      expect(pending.map((s) => s.sha256Prefix)).toEqual([b]);
    });

    it("excludes rejected candidates", () => {
      const a = seedSkill(cwd, { title: "database migration", reuseCount: 3, idx: 1 });
      const b = seedSkill(cwd, { title: "api endpoint design", reuseCount: 3, idx: 2 });
      rejectAutoSkill({ cwd, sha256Prefix: a });
      const pending = listPendingAutoSkills({ cwd });
      expect(pending.map((s) => s.sha256Prefix)).toEqual([b]);
    });

    it("excludes deferred candidates while within the defer window", () => {
      const a = seedSkill(cwd, { title: "database migration", reuseCount: 3, idx: 1 });
      const b = seedSkill(cwd, { title: "api endpoint design", reuseCount: 3, idx: 2 });
      const now = Date.parse("2026-04-20T00:00:00.000Z");
      deferAutoSkill({ cwd, sha256Prefix: a, now });
      const pending = listPendingAutoSkills({ cwd, now: now + 1000 });
      expect(pending.map((s) => s.sha256Prefix)).toEqual([b]);
    });

    it("re-includes deferred candidates after the defer window expires", () => {
      const a = seedSkill(cwd, { title: "database migration", reuseCount: 3, idx: 1 });
      const now = Date.parse("2026-04-20T00:00:00.000Z");
      deferAutoSkill({ cwd, sha256Prefix: a, now });
      const later = now + AUTOSKILL_DEFER_MS + 1000;
      const pending = listPendingAutoSkills({ cwd, now: later });
      expect(pending.map((s) => s.sha256Prefix)).toEqual([a]);
    });

    it("honours custom threshold override", () => {
      seedSkill(cwd, { title: "database migration", reuseCount: 3, idx: 1 });
      expect(listPendingAutoSkills({ cwd, threshold: 10 })).toEqual([]);
      expect(listPendingAutoSkills({ cwd, threshold: 1 })).toHaveLength(1);
    });
  });

  // ─── acceptAutoSkill ───────────────────────────────────────────────────

  describe("acceptAutoSkill", () => {
    it("writes .github/skills/auto-<prefix>/SKILL.md", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      const result = acceptAutoSkill({ cwd, sha256Prefix: prefix });
      expect(result.ok).toBe(true);
      expect(result.promotedPath).toContain(`auto-${prefix}`);
      expect(existsSync(result.promotedPath)).toBe(true);
    });

    it("promoted file preserves the original rendered markdown", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      const { promotedPath } = acceptAutoSkill({ cwd, sha256Prefix: prefix });
      const content = readFileSync(promotedPath, "utf-8");
      expect(content).toContain(prefix);
      expect(content).toMatch(/commands/i);
    });

    it("records state.json entry with status='promoted' + actionedAt ISO", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      acceptAutoSkill({ cwd, sha256Prefix: prefix });
      const statePath = resolve(cwd, ".forge", "skills-auto", "state.json");
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state[prefix].status).toBe("promoted");
      expect(state[prefix].actionedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("fails gracefully when sha256Prefix missing", () => {
      const result = acceptAutoSkill({ cwd });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/required/i);
    });

    it("fails when prefix is unknown", () => {
      const result = acceptAutoSkill({ cwd, sha256Prefix: "deadbeef0000" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ─── rejectAutoSkill ───────────────────────────────────────────────────

  describe("rejectAutoSkill", () => {
    it("moves candidate to .forge/skills-auto/rejected/<prefix>.md", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      const result = rejectAutoSkill({ cwd, sha256Prefix: prefix, reason: "too generic" });
      expect(result.ok).toBe(true);
      expect(existsSync(result.rejectedPath)).toBe(true);
      expect(result.rejectedPath).toContain(join("skills-auto", "rejected"));
    });

    it("removes the original candidate file", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      const origPath = resolve(cwd, ".forge", "skills-auto", `${prefix}.md`);
      expect(existsSync(origPath)).toBe(true);
      rejectAutoSkill({ cwd, sha256Prefix: prefix });
      expect(existsSync(origPath)).toBe(false);
    });

    it("persists reason + status in state.json", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      rejectAutoSkill({ cwd, sha256Prefix: prefix, reason: "duplicate" });
      const state = JSON.parse(readFileSync(resolve(cwd, ".forge", "skills-auto", "state.json"), "utf-8"));
      expect(state[prefix].status).toBe("rejected");
      expect(state[prefix].reason).toBe("duplicate");
    });

    it("fails when prefix unknown", () => {
      const result = rejectAutoSkill({ cwd, sha256Prefix: "deadbeef0000" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ─── deferAutoSkill ────────────────────────────────────────────────────

  describe("deferAutoSkill", () => {
    it("records deferredUntil = now + 7 days", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      const now = Date.parse("2026-04-20T00:00:00.000Z");
      const result = deferAutoSkill({ cwd, sha256Prefix: prefix, now });
      expect(result.ok).toBe(true);
      const expected = new Date(now + AUTOSKILL_DEFER_MS).toISOString();
      expect(result.deferredUntil).toBe(expected);
    });

    it("writes status='deferred' to state.json", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      const now = Date.parse("2026-04-20T00:00:00.000Z");
      deferAutoSkill({ cwd, sha256Prefix: prefix, now });
      const state = JSON.parse(readFileSync(resolve(cwd, ".forge", "skills-auto", "state.json"), "utf-8"));
      expect(state[prefix].status).toBe("deferred");
      expect(state[prefix].deferredUntil).toBeTruthy();
    });

    it("fails when prefix unknown", () => {
      const result = deferAutoSkill({ cwd, sha256Prefix: "deadbeef0000" });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });
  });

  // ─── State transitions ────────────────────────────────────────────────

  describe("state transitions", () => {
    it("defer → expire → pending → accept is the canonical recovery path", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      const now = Date.parse("2026-04-20T00:00:00.000Z");
      deferAutoSkill({ cwd, sha256Prefix: prefix, now });
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix, now: now + 1000 })).toBe("deferred");
      const later = now + AUTOSKILL_DEFER_MS + 1000;
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix, now: later })).toBe("pending");
      const result = acceptAutoSkill({ cwd, sha256Prefix: prefix });
      expect(result.ok).toBe(true);
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix, now: later })).toBe("promoted");
    });

    it("accept then reject still reports promoted (promoted file wins)", () => {
      const prefix = seedSkill(cwd, { title: "database migration", reuseCount: 3 });
      acceptAutoSkill({ cwd, sha256Prefix: prefix });
      // Candidate file has been replicated into .github/skills/; the source
      // candidate remains under .forge/skills-auto for reuseCount updates.
      // A subsequent reject would fail because rejectAutoSkill moves the
      // source file — but the promoted file supersedes any state entry.
      const rejectRes = rejectAutoSkill({ cwd, sha256Prefix: prefix });
      expect(rejectRes.ok).toBe(true);
      // Promoted file still exists → getAutoSkillStatus prefers "promoted"
      expect(getAutoSkillStatus({ cwd, sha256Prefix: prefix })).toBe("promoted");
    });
  });
});
