/**
 * Phase-26 Slice 3 — winner-selection tests.
 *
 * Covers (plan D2):
 *   selectWinner — pure function, deterministic tiebreak chain
 *   promoteWinner — cherry-picks baseRef..winnerHEAD into parent
 *   CompetitiveScheduler integration — winner promoted, losers archived,
 *     slice result status becomes "passed"/"failed"
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  selectWinner,
  CompetitiveScheduler,
} from "../orchestrator.mjs";
import {
  promoteWinner,
  variantPath,
} from "../worktree-manager.mjs";

function makeTempDir() {
  const dir = join(tmpdir(), `pforge-ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mkNodes(slices) {
  const map = new Map();
  for (const s of slices) map.set(s.number, s);
  return map;
}

// ─── selectWinner ──────────────────────────────────────────────────────

describe("selectWinner", () => {
  it("returns null for empty input", () => {
    const r = selectWinner([]);
    expect(r.winner).toBeNull();
    expect(r.reason).toBe("no variants");
  });

  it("returns null for non-array input", () => {
    const r = selectWinner(null);
    expect(r.winner).toBeNull();
  });

  it("returns null when no variant passed gates", () => {
    const r = selectWinner([
      { variant: 1, status: "failed", cost_usd: 0.1, diffLines: 5 },
      { variant: 2, status: "error", cost_usd: 0.2, diffLines: 10 },
    ]);
    expect(r.winner).toBeNull();
    expect(r.reason).toMatch(/no variant passed/i);
  });

  it("picks the only eligible variant", () => {
    const r = selectWinner([
      { variant: 1, status: "passed", cost_usd: 0.5, diffLines: 100 },
      { variant: 2, status: "failed", cost_usd: 0.1, diffLines: 10 },
    ]);
    expect(r.winner.variant).toBe(1);
  });

  it("picks lowest cost-to-diff ratio when all pass", () => {
    const r = selectWinner([
      { variant: 1, status: "passed", cost_usd: 1.0, diffLines: 50 }, // 0.02
      { variant: 2, status: "passed", cost_usd: 0.5, diffLines: 50 }, // 0.01  ← winner
      { variant: 3, status: "passed", cost_usd: 2.0, diffLines: 50 }, // 0.04
    ]);
    expect(r.winner.variant).toBe(2);
  });

  it("tiebreaks on shortest diff when ratio ties", () => {
    const r = selectWinner([
      { variant: 1, status: "passed", cost_usd: 1.0, diffLines: 100 }, // ratio 0.01
      { variant: 2, status: "passed", cost_usd: 0.5, diffLines: 50  }, // ratio 0.01  ← winner (shorter diff)
    ]);
    expect(r.winner.variant).toBe(2);
  });

  it("tiebreaks on earliest completedAt when ratio + diff tie", () => {
    const r = selectWinner([
      { variant: 1, status: "passed", cost_usd: 1.0, diffLines: 50, completedAt: 2000 },
      { variant: 2, status: "passed", cost_usd: 1.0, diffLines: 50, completedAt: 1000 }, // earliest ← winner
      { variant: 3, status: "passed", cost_usd: 1.0, diffLines: 50, completedAt: 3000 },
    ]);
    expect(r.winner.variant).toBe(2);
  });

  it("falls back to durationMs when completedAt missing", () => {
    const r = selectWinner([
      { variant: 1, status: "passed", cost_usd: 0.5, diffLines: 10, durationMs: 500 }, // ← faster wins
      { variant: 2, status: "passed", cost_usd: 0.5, diffLines: 10, durationMs: 800 },
    ]);
    expect(r.winner.variant).toBe(1);
  });

  it("final tiebreak: lowest variant number wins when everything ties", () => {
    const r = selectWinner([
      { variant: 3, status: "passed", cost_usd: 1.0, diffLines: 50, completedAt: 1000 },
      { variant: 1, status: "passed", cost_usd: 1.0, diffLines: 50, completedAt: 1000 },
      { variant: 2, status: "passed", cost_usd: 1.0, diffLines: 50, completedAt: 1000 },
    ]);
    expect(r.winner.variant).toBe(1);
  });

  it("treats missing cost as 0 (ratio = 0 ties)", () => {
    const r = selectWinner([
      { variant: 1, status: "passed", diffLines: 100 }, // 0 / 100 = 0
      { variant: 2, status: "passed", diffLines: 10  }, // 0 / 10  = 0, shorter diff wins
    ]);
    expect(r.winner.variant).toBe(2);
  });

  it("reason string cites cost/diff, diff, completion key", () => {
    const r = selectWinner([
      { variant: 1, status: "passed", cost_usd: 0.5, diffLines: 50, completedAt: 1000 },
    ]);
    expect(r.reason).toMatch(/cost\/diff=/);
    expect(r.reason).toMatch(/diff=50/);
    expect(r.reason).toMatch(/completion=1000/);
  });
});

// ─── promoteWinner ─────────────────────────────────────────────────────

describe("promoteWinner", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeTempDir(); });

  it("returns not promoted if worktree is missing", () => {
    const r = promoteWinner({
      projectDir, planBasename: "p", sliceId: "s", variant: 1,
      spawn: () => ({ status: 0, stdout: "" }),
    });
    expect(r.promoted).toBe(false);
    expect(r.error).toMatch(/worktree missing/);
  });

  it("no-ops when worktree HEAD equals baseRef (no commits to cherry-pick)", () => {
    const wt = variantPath(projectDir, "p", "s", 1);
    mkdirSync(wt, { recursive: true });
    const sameSha = "abc123";
    const spawn = (cmd, args) => {
      if (args[0] === "rev-parse") return { status: 0, stdout: sameSha };
      return { status: 0, stdout: "" };
    };
    const r = promoteWinner({ projectDir, planBasename: "p", sliceId: "s", variant: 1, spawn });
    expect(r.promoted).toBe(true);
    expect(r.commits).toEqual([]);
  });

  it("cherry-picks the commit range baseRef..HEAD into parent", () => {
    const wt = variantPath(projectDir, "p", "s", 1);
    mkdirSync(wt, { recursive: true });
    const calls = [];
    const spawn = (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts?.cwd });
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { status: 0, stdout: "head123" };
      if (args[0] === "rev-parse" && args[1] === "base-ref") return { status: 0, stdout: "base000" };
      if (args[0] === "rev-list") return { status: 0, stdout: "c1\nc2\nc3\n" };
      if (args[0] === "cherry-pick") return { status: 0, stdout: "", stderr: "" };
      return { status: 0 };
    };
    const r = promoteWinner({ projectDir, planBasename: "p", sliceId: "s", variant: 1, baseRef: "base-ref", spawn });
    expect(r.promoted).toBe(true);
    expect(r.commits).toEqual(["c1", "c2", "c3"]);

    const cp = calls.find((c) => c.args[0] === "cherry-pick");
    expect(cp).toBeDefined();
    expect(cp.args).toEqual(["cherry-pick", "-x", "c1", "c2", "c3"]);
    expect(cp.cwd).toBe(projectDir);
  });

  it("throws when cherry-pick fails", () => {
    const wt = variantPath(projectDir, "p", "s", 1);
    mkdirSync(wt, { recursive: true });
    const spawn = (cmd, args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { status: 0, stdout: "head" };
      if (args[0] === "rev-parse" && args[1] === "base-ref") return { status: 0, stdout: "base" };
      if (args[0] === "rev-list") return { status: 0, stdout: "c1" };
      if (args[0] === "cherry-pick") return { status: 1, stderr: "CONFLICT" };
      return { status: 0 };
    };
    expect(() =>
      promoteWinner({ projectDir, planBasename: "p", sliceId: "s", variant: 1, baseRef: "base-ref", spawn }),
    ).toThrow(/cherry-pick failed/);
  });

  it("throws when rev-parse HEAD fails", () => {
    const wt = variantPath(projectDir, "p", "s", 1);
    mkdirSync(wt, { recursive: true });
    const spawn = () => ({ status: 128, stderr: "fatal" });
    expect(() =>
      promoteWinner({ projectDir, planBasename: "p", sliceId: "s", variant: 1, spawn }),
    ).toThrow(/rev-parse HEAD failed/);
  });
});

// ─── CompetitiveScheduler + winner selection integration ───────────────

describe("CompetitiveScheduler — Slice 3 integration", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeTempDir(); });

  function recordingManager() {
    const created = [];
    const archived = [];
    const promoted = [];
    return {
      created, archived, promoted,
      createWorktree: (opts) => {
        const path = join(opts.projectDir, ".forge", "worktrees",
          opts.planBasename, String(opts.sliceId), `variant-${opts.variant}`);
        created.push({ ...opts, path });
        return { path, baseRef: "HEAD" };
      },
      archiveWorktree: (opts) => { archived.push(opts.variant); return { archived: true, from: "", to: "" }; },
      promoteWinner: (opts) => { promoted.push(opts.variant); return { promoted: true, commits: ["c1"], from: "", to: "" }; },
    };
  }

  it("marks slice passed, promotes winner, archives losers", async () => {
    const bus = new EventEmitter();
    const mgr = recordingManager();
    const wonEvents = [];
    bus.on("competitive-slice-won", (e) => wonEvents.push(e));

    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, competitiveVariants: 3, depends: [] },
    ]);
    const executeFn = async (s) => {
      const v = s.variantContext.variant;
      return {
        status: "passed",
        cost_usd: v === 2 ? 0.3 : 1.0,
        diffLines: 50,
      };
    };

    const results = await sched.execute(nodes, ["1"], executeFn);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(results[0].winningVariant).toBe(2);
    expect(mgr.promoted).toEqual([2]);
    expect(mgr.archived.sort()).toEqual([1, 3]);
    expect(wonEvents).toHaveLength(1);
    expect(wonEvents[0].winningVariant).toBe(2);
  });

  it("marks slice failed and archives all variants when no variant passed", async () => {
    const bus = new EventEmitter();
    const mgr = recordingManager();
    const failEvents = [];
    bus.on("competitive-slice-failed", (e) => failEvents.push(e));

    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 2, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, competitiveVariants: 2, depends: [] },
    ]);
    const executeFn = async () => ({ status: "failed", cost_usd: 0.5, diffLines: 10 });

    const results = await sched.execute(nodes, ["1"], executeFn);

    expect(results[0].status).toBe("failed");
    expect(results[0].winningVariant).toBeNull();
    expect(mgr.archived.sort()).toEqual([1, 2]);
    expect(mgr.promoted).toEqual([]);
    expect(failEvents).toHaveLength(1);
  });

  it("tolerates promoteWinner failure and still archives losers", async () => {
    const bus = new EventEmitter();
    const created = [];
    const archived = [];
    const mgr = {
      created, archived,
      createWorktree: (opts) => {
        const path = join(opts.projectDir, ".forge", "worktrees",
          opts.planBasename, String(opts.sliceId), `variant-${opts.variant}`);
        created.push({ ...opts, path });
        return { path, baseRef: "HEAD" };
      },
      archiveWorktree: (opts) => { archived.push(opts.variant); return { archived: true, from: "", to: "" }; },
      promoteWinner: () => { throw new Error("conflict"); },
    };

    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 2, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, competitiveVariants: 2, depends: [] },
    ]);
    const results = await sched.execute(nodes, ["1"], async (s) => ({
      status: "passed", cost_usd: 0.5, diffLines: s.variantContext.variant * 10,
    }));

    // Promotion failed but slice still marked passed; losers still archived.
    expect(results[0].status).toBe("passed");
    expect(results[0].promotion.promoted).toBe(false);
    expect(results[0].promotion.error).toBe("conflict");
    // Variants 1/2 have cost=0.5 each and diffLines=10/20 → ratios 0.05/0.025.
    // Lower ratio wins → variant 2 is winner → variant 1 archived.
    expect(archived).toEqual([1]);
  });
});
