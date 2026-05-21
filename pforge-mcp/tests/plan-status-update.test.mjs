/**
 * Plan Forge — Issue #212: plan-status-update unit tests
 *
 * Covers rewritePlanStatusOnSuccess():
 *   - Rewrites `status: HARDENED` → `status: COMPLETE` in YAML frontmatter
 *   - Rewrites `> **Status**: **HARDENED…` quote-header line
 *   - Idempotent when already COMPLETE
 *   - No-op when planPath is absent or file does not exist
 *   - No-op when no HARDENED markers are present
 *   - Uses VERSION file for version string when not overridden
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { rewritePlanStatusOnSuccess } from "../orchestrator.mjs";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HARDENED_PLAN = `---
phase: 59
name: CRUCIBLE-MODES
status: HARDENED
lockHash: abc123
---

# Phase 59 — CRUCIBLE-MODES

> **Status**: **HARDENED — cleared for execution 2026-05-21.** Step-2 hardening completed.
> **Source**: Some source description.
> **Tracks**: some files.

---

## Execution Hold

Some hold text.
`;

const COMPLETE_PLAN = `---
phase: 59
name: CRUCIBLE-MODES
status: COMPLETE
lockHash: abc123
---

# Phase 59 — CRUCIBLE-MODES

> **Status**: **✅ Complete — shipped 2026-05-21 (v3.18.1-dev).** See \`## What actually shipped\` section below.
> **Source**: Some source description.
> **Tracks**: some files.

---
`;

const NO_STATUS_PLAN = `---
phase: 99
name: TEST
lockHash: xyz
---

# Phase 99

Some content with no status field.
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir;

beforeEach(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), "pf-plan-status-test-"));
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writePlan(name, content) {
  const planPath = resolve(tmpDir, name);
  writeFileSync(planPath, content, "utf-8");
  return planPath;
}

function readPlan(planPath) {
  return readFileSync(planPath, "utf-8");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("rewritePlanStatusOnSuccess", () => {
  it("rewrites status: HARDENED to status: COMPLETE in YAML frontmatter", () => {
    const planPath = writePlan("phase.md", HARDENED_PLAN);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-05-21T16:54:04.000Z",
      version: "v3.18.1-dev",
    });
    const updated = readPlan(planPath);
    expect(updated).toContain("status: COMPLETE");
    expect(updated).not.toContain("status: HARDENED");
  });

  it("rewrites the quote-header status line", () => {
    const planPath = writePlan("phase.md", HARDENED_PLAN);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-05-21T16:54:04.000Z",
      version: "v3.18.1-dev",
    });
    const updated = readPlan(planPath);
    expect(updated).toContain("✅ Complete");
    expect(updated).toContain("shipped 2026-05-21 (v3.18.1-dev)");
    expect(updated).not.toContain("HARDENED — cleared for execution");
  });

  it("uses the date part only (YYYY-MM-DD) from the ISO shippedAt", () => {
    const planPath = writePlan("phase.md", HARDENED_PLAN);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-12-31T23:59:59.999Z",
      version: "v4.0.0",
    });
    const updated = readPlan(planPath);
    expect(updated).toContain("shipped 2026-12-31 (v4.0.0)");
  });

  it("reads VERSION file from cwd when version not provided", () => {
    writeFileSync(resolve(tmpDir, "VERSION"), "3.18.1-dev", "utf-8");
    const planPath = writePlan("phase.md", HARDENED_PLAN);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-05-21T12:00:00.000Z",
    });
    const updated = readPlan(planPath);
    expect(updated).toContain("v3.18.1-dev");
  });

  it("omits version suffix when VERSION file is absent and version not provided", () => {
    const planPath = writePlan("phase.md", HARDENED_PLAN);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-05-21T12:00:00.000Z",
    });
    const updated = readPlan(planPath);
    expect(updated).toContain("shipped 2026-05-21.");
    expect(updated).not.toMatch(/shipped \d{4}-\d{2}-\d{2} \(v/);
  });

  it("is idempotent — COMPLETE plan is not modified", () => {
    const planPath = writePlan("phase.md", COMPLETE_PLAN);
    const before = readPlan(planPath);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-05-21T12:00:00.000Z",
      version: "v9.0.0",
    });
    const after = readPlan(planPath);
    expect(after).toBe(before);
  });

  it("no-ops when planPath is not provided", () => {
    // Should not throw.
    expect(() => rewritePlanStatusOnSuccess({ cwd: tmpDir })).not.toThrow();
  });

  it("no-ops when plan file does not exist", () => {
    expect(() =>
      rewritePlanStatusOnSuccess({
        planPath: resolve(tmpDir, "nonexistent.md"),
        cwd: tmpDir,
      })
    ).not.toThrow();
  });

  it("no-ops when plan has no HARDENED markers", () => {
    const planPath = writePlan("phase.md", NO_STATUS_PLAN);
    const before = readPlan(planPath);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-05-21T12:00:00.000Z",
      version: "v3.18.1",
    });
    const after = readPlan(planPath);
    expect(after).toBe(before);
  });

  it("preserves all other content in the plan file", () => {
    const planPath = writePlan("phase.md", HARDENED_PLAN);
    rewritePlanStatusOnSuccess({
      planPath,
      cwd: tmpDir,
      shippedAt: "2026-05-21T12:00:00.000Z",
      version: "v3.18.1-dev",
    });
    const updated = readPlan(planPath);
    // Phase header, lockHash, execution hold section all preserved
    expect(updated).toContain("lockHash: abc123");
    expect(updated).toContain("Phase 59 — CRUCIBLE-MODES");
    expect(updated).toContain("## Execution Hold");
    expect(updated).toContain("> **Source**: Some source description.");
  });
});
