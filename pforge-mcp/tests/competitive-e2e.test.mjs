/**
 * Phase-26 Slice 5 — Competitive end-to-end integration.
 *
 * Wires parsePlan → CompetitiveScheduler → stub worktreeManager to verify
 * the full loop: one slice tagged [competitive: 3] spawns three variants,
 * two fail gates in different ways, one passes, the passing variant is
 * promoted (fast-forwarded) and the losers archived. Slice status reports
 * as 'passed' with winningVariant and selectionReason populated.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlan, CompetitiveScheduler } from "../orchestrator.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function mkTemp() {
  const dir = join(tmpdir(), `pforge-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("Phase-26 competitive E2E", () => {
  let dir;
  let planPath;
  let fixtureSrc;

  beforeEach(() => {
    dir = mkTemp();
    // Locate the committed fixture plan next to this test file.
    fixtureSrc = resolve(__dirname, "fixtures", "competitive-plan.md");
    // Copy it into the temp working dir so parsePlan resolves from there.
    const raw = readFileSync(fixtureSrc, "utf-8");
    planPath = join(dir, "competitive-plan.md");
    writeFileSync(planPath, raw);
  });

  afterEach(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("runs three variants, picks a winner, promotes it, archives losers", async () => {
    const plan = parsePlan(planPath, dir);
    expect(plan.slices).toHaveLength(1);
    const slice = plan.slices[0];
    expect(slice.competitive).toBe(true);
    expect(slice.competitiveVariants).toBe(3);
    const nodes = new Map(plan.slices.map((s) => [s.number, s]));

    // Capture scheduler events + manager interactions.
    const events = { started: [], variantStarted: [], variantCompleted: [], won: [], failed: [] };
    const bus = new EventEmitter();
    bus.on("competitive-slice-started", (e) => events.started.push(e));
    bus.on("variant-started", (e) => events.variantStarted.push(e));
    bus.on("variant-completed", (e) => events.variantCompleted.push(e));
    bus.on("competitive-slice-won", (e) => events.won.push(e));
    bus.on("competitive-slice-failed", (e) => events.failed.push(e));

    const created = [];
    const archived = [];
    const promoted = [];
    const manager = {
      createWorktree: (opts) => {
        const path = join(opts.projectDir, ".forge", "worktrees",
          opts.planBasename, String(opts.sliceId), `variant-${opts.variant}`);
        created.push({ variant: opts.variant, path });
        mkdirSync(path, { recursive: true });
        return { path, baseRef: "HEAD" };
      },
      promoteWinner: (opts) => {
        promoted.push(opts.variant);
        return { promoted: true, commits: [`v${opts.variant}-c1`], from: "", to: "" };
      },
      archiveWorktree: (opts) => {
        archived.push(opts.variant);
        return { archived: true, from: "", to: "" };
      },
    };

    // Variant execution matrix — only variant 2 passes gates.
    // Variant 1: failed gate.
    // Variant 2: passed, moderate cost, moderate diff.
    // Variant 3: error (worker crash).
    const executeFn = async (s) => {
      const v = s.variantContext.variant;
      if (v === 1) return { status: "failed", cost_usd: 0.40, diffLines: 80, error: "gate failed" };
      if (v === 2) return { status: "passed", cost_usd: 0.30, diffLines: 60, completedAt: 1700 };
      return { status: "error", cost_usd: 0.20, diffLines: 10, error: "worker crashed" };
    };

    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3,
      projectDir: dir,
      planBasename: "competitive-plan",
      worktreeManager: manager,
    });
    const results = await sched.execute(nodes, [slice.number], executeFn);

    // ─── Assertions ────────────────────────────────────────────────
    expect(results).toHaveLength(1);
    const [res] = results;

    // Three variants ran.
    expect(res.variants).toHaveLength(3);
    expect(created.map((c) => c.variant).sort()).toEqual([1, 2, 3]);

    // Winner is variant 2 (only one that passed).
    expect(res.status).toBe("passed");
    expect(res.winningVariant).toBe(2);
    expect(res.selectionReason).toMatch(/variant 2/i);

    // Fast-forward happened for variant 2.
    expect(promoted).toEqual([2]);
    expect(res.promotion.promoted).toBe(true);
    expect(res.promotion.commits).toEqual(["v2-c1"]);

    // Losers archived (variants 1 + 3).
    expect(archived.sort()).toEqual([1, 3]);

    // Event bus captured the lifecycle.
    expect(events.started).toHaveLength(1);
    expect(events.variantStarted).toHaveLength(3);
    expect(events.variantCompleted).toHaveLength(3);
    expect(events.won).toHaveLength(1);
    expect(events.won[0].winningVariant).toBe(2);
    expect(events.failed).toHaveLength(0);
  });

  it("marks slice failed and archives all variants when none passes gates", async () => {
    const plan = parsePlan(planPath, dir);
    const slice = plan.slices[0];
    const nodes = new Map(plan.slices.map((s) => [s.number, s]));

    const bus = new EventEmitter();
    const failEvents = [];
    bus.on("competitive-slice-failed", (e) => failEvents.push(e));

    const created = [];
    const archived = [];
    const promoted = [];
    const manager = {
      createWorktree: (opts) => {
        const path = join(opts.projectDir, ".forge", "worktrees",
          opts.planBasename, String(opts.sliceId), `variant-${opts.variant}`);
        created.push(opts.variant);
        mkdirSync(path, { recursive: true });
        return { path, baseRef: "HEAD" };
      },
      promoteWinner: (opts) => { promoted.push(opts.variant); return { promoted: true }; },
      archiveWorktree: (opts) => { archived.push(opts.variant); return { archived: true }; },
    };

    const executeFn = async () => ({ status: "failed", cost_usd: 0.5, diffLines: 50 });

    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3,
      projectDir: dir,
      planBasename: "competitive-plan",
      worktreeManager: manager,
    });
    const results = await sched.execute(nodes, [slice.number], executeFn);

    expect(results[0].status).toBe("failed");
    expect(results[0].winningVariant).toBeNull();
    expect(promoted).toEqual([]);
    expect(archived.sort()).toEqual([1, 2, 3]);
    expect(failEvents).toHaveLength(1);
  });
});
