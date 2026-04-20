/**
 * Plan Forge — Phase-26 Slice 9 (Incident → fix-proposal auto-retry) tests
 *
 * Covers the pure helpers and injectable-git state machine added to
 * orchestrator.mjs:
 *   - findMatchingFixProposal()
 *   - shouldAutoRetryFix() + markFixAttempted()
 *   - writeProposedFixPatch()
 *   - applyFixProposal() — dry-run + apply paths
 *   - rollbackFixProposal()
 *
 * MUST (docs/plans/Phase-26-COMPETITIVE-LOOP-v2.58-PLAN.md §Slice 9):
 *   - dry-run default (patch written; tree unchanged)
 *   - apply re-runs gate (orchestrator owns that; helper returns applied:true)
 *   - rollback on failure
 *   - 1-attempt cap via autoFixAttempted
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  PROPOSED_FIX_DIR,
  findMatchingFixProposal,
  shouldAutoRetryFix,
  markFixAttempted,
  writeProposedFixPatch,
  applyFixProposal,
  rollbackFixProposal,
} from "../orchestrator.mjs";

const SAMPLE_PATCH = `diff --git a/hello.txt b/hello.txt
index 0000000..1111111 100644
--- a/hello.txt
+++ b/hello.txt
@@ -1 +1 @@
-old
+new
`;

// ─── findMatchingFixProposal ──────────────────────────────────────────

describe("findMatchingFixProposal", () => {
  it("returns null for missing incident or proposals", () => {
    expect(findMatchingFixProposal({})).toBeNull();
    expect(findMatchingFixProposal({ incident: { id: "inc-1" } })).toBeNull();
    expect(findMatchingFixProposal({ incident: { id: "inc-1" }, proposals: [] })).toBeNull();
  });

  it("prefers correlationId match over sliceNumber match", () => {
    const incident = { id: "inc-42", sliceNumber: 5 };
    const proposals = [
      { fixId: "a", sliceNumber: 5, generatedAt: "2026-04-20T00:00:00Z" },
      { fixId: "b", correlationId: "inc-42", generatedAt: "2026-04-19T00:00:00Z" },
    ];
    expect(findMatchingFixProposal({ incident, proposals }).fixId).toBe("b");
  });

  it("falls back to incidentId match", () => {
    const incident = { id: "inc-7" };
    const proposals = [
      { fixId: "x", incidentId: "inc-7", generatedAt: "2026-04-20T00:00:00Z" },
    ];
    expect(findMatchingFixProposal({ incident, proposals }).fixId).toBe("x");
  });

  it("falls back to sliceNumber match when no id matches", () => {
    const incident = { id: "inc-99", sliceNumber: 3 };
    const proposals = [
      { fixId: "p1", sliceNumber: 3, generatedAt: "2026-04-18T00:00:00Z" },
      { fixId: "p2", sliceNumber: 4, generatedAt: "2026-04-20T00:00:00Z" },
    ];
    expect(findMatchingFixProposal({ incident, proposals }).fixId).toBe("p1");
  });

  it("picks the newest among multiple same-slice matches", () => {
    const incident = { id: "inc-1", sliceNumber: 7 };
    const proposals = [
      { fixId: "old", sliceNumber: 7, generatedAt: "2026-01-01T00:00:00Z" },
      { fixId: "new", sliceNumber: 7, generatedAt: "2026-04-20T00:00:00Z" },
      { fixId: "mid", sliceNumber: 7, generatedAt: "2026-03-15T00:00:00Z" },
    ];
    expect(findMatchingFixProposal({ incident, proposals }).fixId).toBe("new");
  });

  it("returns null when nothing matches", () => {
    const incident = { id: "inc-1", sliceNumber: 99 };
    const proposals = [{ fixId: "p1", sliceNumber: 1 }];
    expect(findMatchingFixProposal({ incident, proposals })).toBeNull();
  });
});

// ─── shouldAutoRetryFix + markFixAttempted ────────────────────────────

describe("shouldAutoRetryFix / markFixAttempted (1-attempt cap)", () => {
  it("allows retry for a fresh incident", () => {
    expect(shouldAutoRetryFix({ id: "inc-1" })).toBe(true);
  });

  it("blocks retry once autoFixAttempted === true", () => {
    const marked = markFixAttempted({ id: "inc-1" });
    expect(marked.autoFixAttempted).toBe(true);
    expect(shouldAutoRetryFix(marked)).toBe(false);
  });

  it("does not mutate the input incident", () => {
    const original = { id: "inc-1" };
    markFixAttempted(original);
    expect(original.autoFixAttempted).toBeUndefined();
  });

  it("stamps autoFixAttemptedAt with ISO timestamp", () => {
    const now = new Date("2026-04-20T12:00:00.000Z");
    const marked = markFixAttempted({ id: "inc-1" }, { now });
    expect(marked.autoFixAttemptedAt).toBe("2026-04-20T12:00:00.000Z");
  });

  it("rejects non-object incidents", () => {
    expect(shouldAutoRetryFix(null)).toBe(false);
    expect(shouldAutoRetryFix(undefined)).toBe(false);
    expect(shouldAutoRetryFix("inc-1")).toBe(false);
  });
});

// ─── writeProposedFixPatch / applyFixProposal / rollbackFixProposal ───

describe("applyFixProposal state machine", () => {
  let cwd;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-autofix-"));
  });

  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ─── writeProposedFixPatch ──────────────────────────────────────────

  it("writes patch to .forge/proposed-fixes/<fixId>.patch", () => {
    const path = writeProposedFixPatch({ cwd, fixId: "fix-123", patch: SAMPLE_PATCH });
    expect(path).toContain(resolve(cwd, ".forge", PROPOSED_FIX_DIR));
    expect(path).toMatch(/fix-123\.patch$/);
    expect(readFileSync(path, "utf-8")).toBe(SAMPLE_PATCH);
  });

  it("sanitizes fixId to prevent directory traversal", () => {
    const path = writeProposedFixPatch({ cwd, fixId: "../../etc/evil", patch: SAMPLE_PATCH });
    expect(path).toMatch(/proposed-fixes[\\/][A-Za-z0-9._-]+\.patch$/);
    expect(path).not.toContain("..");
    // File lives under .forge/proposed-fixes — never escapes via traversal
    expect(path).toContain(resolve(cwd, ".forge", PROPOSED_FIX_DIR));
  });

  it("throws when fixId missing", () => {
    expect(() => writeProposedFixPatch({ cwd, patch: SAMPLE_PATCH })).toThrow(/fixId/);
  });

  it("throws when patch missing", () => {
    expect(() => writeProposedFixPatch({ cwd, fixId: "x" })).toThrow(/patch/);
  });

  // ─── applyFixProposal: dry-run ──────────────────────────────────────

  it("dry-run writes patch file but does NOT invoke git", () => {
    let gitCalls = 0;
    const runGit = () => { gitCalls++; return { ok: true }; };
    const res = applyFixProposal({ cwd, fixId: "fix-dry", patch: SAMPLE_PATCH, mode: "dry-run", runGit });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("dry-run");
    expect(res.applied).toBe(false);
    expect(existsSync(res.patchPath)).toBe(true);
    expect(gitCalls).toBe(0);
  });

  it("defaults to dry-run mode when mode omitted", () => {
    const res = applyFixProposal({ cwd, fixId: "fix-default", patch: SAMPLE_PATCH, runGit: () => ({ ok: true }) });
    expect(res.mode).toBe("dry-run");
    expect(res.applied).toBe(false);
  });

  // ─── applyFixProposal: apply ────────────────────────────────────────

  it("apply mode invokes git apply with the patch file path", () => {
    const calls = [];
    const runGit = (opts) => { calls.push(opts); return { ok: true }; };
    const res = applyFixProposal({ cwd, fixId: "fix-apply", patch: SAMPLE_PATCH, mode: "apply", runGit });
    expect(res.ok).toBe(true);
    expect(res.applied).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe("apply");
    expect(calls[0].args).toContain(res.patchPath);
  });

  it("apply failure returns ok:false + error, does NOT throw", () => {
    const runGit = () => ({ ok: false, stderr: "patch does not apply" });
    const res = applyFixProposal({ cwd, fixId: "fix-fail", patch: SAMPLE_PATCH, mode: "apply", runGit });
    expect(res.ok).toBe(false);
    expect(res.applied).toBe(false);
    expect(res.error).toMatch(/patch does not apply/);
  });

  it("rejects invalid mode", () => {
    const res = applyFixProposal({ cwd, fixId: "x", patch: SAMPLE_PATCH, mode: "force", runGit: () => ({ ok: true }) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid mode/);
  });

  // ─── rollbackFixProposal ────────────────────────────────────────────

  it("rollback invokes git apply -R against the stored patch", () => {
    const { patchPath } = applyFixProposal({ cwd, fixId: "fix-rb", patch: SAMPLE_PATCH, mode: "dry-run", runGit: () => ({ ok: true }) });
    expect(existsSync(patchPath)).toBe(true);
    const calls = [];
    const runGit = (opts) => { calls.push(opts); return { ok: true }; };
    const res = rollbackFixProposal({ cwd, fixId: "fix-rb", runGit });
    expect(res.ok).toBe(true);
    expect(calls[0].args).toEqual(expect.arrayContaining(["apply", "-R"]));
    expect(calls[0].args).toContain(patchPath);
  });

  it("rollback fails gracefully when patch file missing", () => {
    const res = rollbackFixProposal({ cwd, fixId: "missing", runGit: () => ({ ok: true }) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it("rollback surfaces git failure as ok:false", () => {
    applyFixProposal({ cwd, fixId: "fix-rbfail", patch: SAMPLE_PATCH, mode: "dry-run", runGit: () => ({ ok: true }) });
    const runGit = () => ({ ok: false, stderr: "conflict" });
    const res = rollbackFixProposal({ cwd, fixId: "fix-rbfail", runGit });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/conflict/);
  });

  it("rollback rejects missing fixId", () => {
    const res = rollbackFixProposal({ cwd, runGit: () => ({ ok: true }) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/fixId/);
  });

  // ─── Canonical recovery: apply → fail → rollback → mark attempted ───

  it("canonical apply-fail-rollback flow leaves the incident capped", () => {
    const incident = { id: "inc-1", sliceNumber: 3 };
    expect(shouldAutoRetryFix(incident)).toBe(true);

    // Apply fails
    const applyRes = applyFixProposal({
      cwd,
      fixId: "fix-flow",
      patch: SAMPLE_PATCH,
      mode: "apply",
      runGit: () => ({ ok: false, stderr: "merge conflict" }),
    });
    expect(applyRes.ok).toBe(false);

    // Rollback (no-op since nothing applied, but still exercised)
    const rbRes = rollbackFixProposal({
      cwd,
      fixId: "fix-flow",
      runGit: () => ({ ok: true }),
    });
    expect(rbRes.ok).toBe(true);

    // Cap the incident
    const capped = markFixAttempted(incident);
    expect(shouldAutoRetryFix(capped)).toBe(false);
  });
});
