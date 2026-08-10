/**
 * Plan Forge — Bug #225 regression: prose "Depends On" lines → 0-slice phantom run.
 *
 * Root cause: applyBodyDependencies() ran normalizeSliceId() on the WHOLE comma
 * phrase, so prose deps ("none (foundation)", "S1 (consumes presets.ts)",
 * "and Group B merge checkpoint.") survived verbatim in node.depends. The
 * ParallelScheduler could never satisfy them → execute() returned [] → the run
 * reported "completed" with 0 passed / 0 failed.
 *
 * Verifies:
 *   (1) parser extracts leading slice ids from prose dep phrases.
 *   (2) "none (...)" yields no dependencies.
 *   (3) S-prefix tokens (S1, S2) normalize to numeric ids.
 *   (4) existing clean "Slice 1, Slice 2A" form still parses.
 *   (5) scheduler fails loud (non-empty failed results) on a dependency deadlock
 *       instead of returning an empty array.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlan, ParallelScheduler } from "../orchestrator.mjs";

function writePlan(tempDir, sliceBlocks) {
  const planPath = join(tempDir, "plan.md");
  writeFileSync(planPath, [
    "# Plan",
    "## Scope Contract",
    "### In Scope",
    "- Something",
    "## Execution Slices",
    sliceBlocks,
  ].join("\n"));
  return planPath;
}

describe("Bug #225 — prose Depends On parsing", () => {
  let tempDir;
  let origCwd;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-225-"));
    origCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("(1)+(2)+(3) extracts leading slice ids and drops prose with no id", () => {
    const planPath = writePlan(tempDir, [
      "### Slice 1: Foundation",
      "1. Do foundation work",
      "**Depends On**: none (foundation — RD-6 locked).",
      "",
      "### Slice 2: Redirects",
      "1. Build redirects",
      "**Depends On**: S1 (consumes `presets.ts` + the provisioning endpoint).",
      "",
      "### Slice 6: Merge",
      "1. Merge group",
      "**Depends On**: S2 (redirect targets must exist), and Group B merge checkpoint.",
    ].join("\n"));
    const plan = parsePlan(planPath, tempDir);
    const bySlice = Object.fromEntries(plan.slices.map((s) => [s.number, s.depends]));
    expect(bySlice["1"]).toEqual([]);          // (2) "none (...)" → no deps
    expect(bySlice["2"]).toEqual(["1"]);       // (3) S1 → "1"
    expect(bySlice["6"]).toEqual(["2"]);       // (1) leading S2 token, prose tail dropped
  });

  it("(4) preserves the existing clean 'Slice 1, Slice 2A' form", () => {
    const planPath = writePlan(tempDir, [
      "### Slice 3: Campaigns",
      "1. Build CRUD",
      "**Depends On:** Slice 1, Slice 2A (auth + items required)",
    ].join("\n"));
    const plan = parsePlan(planPath, tempDir);
    expect(plan.slices[0].depends).toEqual(["1", "2A"]);
  });

  it("(5) scheduler fails loud on a dependency deadlock instead of returning []", async () => {
    const events = [];
    const eventBus = { emit: (name, payload) => events.push({ name, payload }) };
    const scheduler = new ParallelScheduler(eventBus, 3);

    // Two slices, each depending on a non-existent prose id → never ready.
    const nodes = new Map([
      ["1", { number: "1", title: "A", depends: ["ghost"] }],
      ["2", { number: "2", title: "B", depends: ["ghost"] }],
    ]);
    const order = ["1", "2"];
    const executeFn = async () => ({ status: "passed" });

    const results = await scheduler.execute(nodes, order, executeFn);

    expect(results.length).toBe(2);
    expect(results.every((r) => r.status === "failed")).toBe(true);
    expect(results[0].error).toMatch(/unsatisfiable dependencies/i);
    expect(events.some((e) => e.name === "scheduler-deadlock")).toBe(true);
  });
});
