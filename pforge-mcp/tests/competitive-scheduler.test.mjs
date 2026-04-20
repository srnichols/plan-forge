/**
 * Phase-26 Slice 2 — CompetitiveScheduler tests.
 *
 * Covers:
 *   - [competitive] and [competitive:N] tag parse
 *   - loadCompetitiveConfig defaults + clamps
 *   - CompetitiveScheduler runs non-competitive slices sequentially
 *   - CompetitiveScheduler spawns N worktree variants per [competitive] slice
 *   - executeFn gets variantContext ({ variant, worktreePath })
 *   - All variants return, status "competitive-pending", winningVariant=null
 *   - Variant errors don't crash the scheduler
 *   - Worktree creation failure archives partial variants + errors the slice
 *   - abortSignal respected before variants start
 */

import { describe, it, expect, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompetitiveScheduler,
  loadCompetitiveConfig,
  parsePlan,
} from "../orchestrator.mjs";

function makeTempDir() {
  const dir = join(tmpdir(), `pforge-cs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function mkNodes(slices) {
  const map = new Map();
  for (const s of slices) map.set(s.number, s);
  return map;
}

function fakeManager() {
  const created = [];
  const archived = [];
  return {
    created, archived,
    createWorktree: (opts) => {
      const path = join(opts.projectDir, ".forge", "worktrees",
        String(opts.planBasename), String(opts.sliceId), `variant-${opts.variant}`);
      created.push({ ...opts, path });
      return { path, baseRef: "HEAD" };
    },
    archiveWorktree: (opts) => {
      archived.push(opts);
      return { archived: true, from: "", to: "" };
    },
  };
}

// ─── Plan parse: [competitive] tag ─────────────────────────────────────

describe("parsePlan — [competitive] tag", () => {
  let cwd;
  beforeEach(() => { cwd = makeTempDir(); });

  const write = (md) => {
    const p = join(cwd, "plan.md");
    writeFileSync(p, md);
    return p;
  };

  it("marks a slice [competitive] when tag is present", () => {
    const md = `---\ncrucibleId: test-1\nlane: full\nsource: human\n---\n\n# Plan\n\n## Slices\n\n### Slice 1: Normal\n\n### Slice 2: Competitive [competitive]\n`;
    const plan = parsePlan(write(md), cwd);
    const s1 = plan.slices.find((s) => s.number === "1");
    const s2 = plan.slices.find((s) => s.number === "2");
    expect(s1.competitive).toBe(false);
    expect(s2.competitive).toBe(true);
  });

  it("parses [competitive: N] as variant override", () => {
    const md = `---\ncrucibleId: test-2\nlane: full\nsource: human\n---\n\n# Plan\n\n## Slices\n\n### Slice 1: Three variants [competitive: 3]\n\n### Slice 2: Four variants [competitive:4]\n`;
    const plan = parsePlan(write(md), cwd);
    const s1 = plan.slices.find((s) => s.number === "1");
    const s2 = plan.slices.find((s) => s.number === "2");
    expect(s1.competitiveVariants).toBe(3);
    expect(s2.competitiveVariants).toBe(4);
  });

  it("leaves competitiveVariants null when no count provided", () => {
    const md = `---\ncrucibleId: test-3\nlane: full\nsource: human\n---\n\n# Plan\n\n## Slices\n\n### Slice 1: Bare [competitive]\n`;
    const plan = parsePlan(write(md), cwd);
    expect(plan.slices[0].competitive).toBe(true);
    expect(plan.slices[0].competitiveVariants).toBeNull();
  });
});

// ─── loadCompetitiveConfig ─────────────────────────────────────────────

describe("loadCompetitiveConfig", () => {
  let cwd;
  beforeEach(() => { cwd = makeTempDir(); });

  it("returns defaults when .forge.json missing", () => {
    expect(loadCompetitiveConfig(cwd)).toEqual({ maxVariants: 3, archiveDays: 7 });
  });

  it("returns defaults when .forge.json has no runtime.competitive key", () => {
    writeFileSync(join(cwd, ".forge.json"), JSON.stringify({ other: "x" }));
    expect(loadCompetitiveConfig(cwd)).toEqual({ maxVariants: 3, archiveDays: 7 });
  });

  it("reads maxVariants and archiveDays from config", () => {
    writeFileSync(join(cwd, ".forge.json"), JSON.stringify({
      runtime: { competitive: { maxVariants: 5, archiveDays: 14 } },
    }));
    expect(loadCompetitiveConfig(cwd)).toEqual({ maxVariants: 5, archiveDays: 14 });
  });

  it("clamps maxVariants to [2, 5]", () => {
    writeFileSync(join(cwd, ".forge.json"), JSON.stringify({
      runtime: { competitive: { maxVariants: 99 } },
    }));
    expect(loadCompetitiveConfig(cwd).maxVariants).toBe(5);

    writeFileSync(join(cwd, ".forge.json"), JSON.stringify({
      runtime: { competitive: { maxVariants: 0 } },
    }));
    expect(loadCompetitiveConfig(cwd).maxVariants).toBe(2);
  });

  it("ignores non-positive archiveDays", () => {
    writeFileSync(join(cwd, ".forge.json"), JSON.stringify({
      runtime: { competitive: { archiveDays: -1 } },
    }));
    expect(loadCompetitiveConfig(cwd).archiveDays).toBe(7);
  });

  it("returns defaults on malformed JSON", () => {
    writeFileSync(join(cwd, ".forge.json"), "{ not json");
    expect(loadCompetitiveConfig(cwd)).toEqual({ maxVariants: 3, archiveDays: 7 });
  });
});

// ─── CompetitiveScheduler — non-competitive path ───────────────────────

describe("CompetitiveScheduler — non-competitive slices", () => {
  it("runs non-competitive slices sequentially in DAG order", async () => {
    const bus = new EventEmitter();
    const sched = new CompetitiveScheduler(bus);
    const nodes = mkNodes([
      { number: "1", title: "A", competitive: false, depends: [] },
      { number: "2", title: "B", competitive: false, depends: ["1"] },
    ]);
    const calls = [];
    const executeFn = async (s) => { calls.push(s.number); return { status: "passed" }; };
    const results = await sched.execute(nodes, ["1", "2"], executeFn);
    expect(calls).toEqual(["1", "2"]);
    expect(results.map((r) => r.status)).toEqual(["passed", "passed"]);
  });

  it("stops on first non-competitive failure", async () => {
    const bus = new EventEmitter();
    const sched = new CompetitiveScheduler(bus);
    const nodes = mkNodes([
      { number: "1", title: "A", competitive: false, depends: [] },
      { number: "2", title: "B", competitive: false, depends: ["1"] },
    ]);
    const executeFn = async (s) => s.number === "1" ? { status: "failed" } : { status: "passed" };
    const results = await sched.execute(nodes, ["1", "2"], executeFn);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("failed");
  });

  it("emits slice-started / slice-completed for non-competitive slices", async () => {
    const bus = new EventEmitter();
    const events = [];
    bus.on("slice-started", (e) => events.push(["start", e.sliceId]));
    bus.on("slice-completed", (e) => events.push(["done", e.sliceId]));
    const sched = new CompetitiveScheduler(bus);
    const nodes = mkNodes([{ number: "1", title: "A", competitive: false, depends: [] }]);
    await sched.execute(nodes, ["1"], async () => ({ status: "passed" }));
    expect(events).toEqual([["start", "1"], ["done", "1"]]);
  });
});

// ─── CompetitiveScheduler — competitive path ───────────────────────────

describe("CompetitiveScheduler — [competitive] slices", () => {
  let projectDir;
  beforeEach(() => { projectDir = makeTempDir(); });

  it("spawns N variants via worktree manager and runs each through executeFn", async () => {
    const bus = new EventEmitter();
    const mgr = fakeManager();
    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3,
      projectDir, planBasename: "p1",
      worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, depends: [] },
    ]);
    const seen = [];
    const executeFn = async (s) => {
      seen.push(s.variantContext);
      return { status: "passed", diffLines: 10 };
    };

    const results = await sched.execute(nodes, ["1"], executeFn);

    expect(mgr.created).toHaveLength(3);
    expect(mgr.created.map((c) => c.variant)).toEqual([1, 2, 3]);
    expect(seen.map((v) => v.variant).sort()).toEqual([1, 2, 3]);
    expect(seen.every((v) => typeof v.worktreePath === "string")).toBe(true);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("competitive-pending");
    expect(results[0].variants).toHaveLength(3);
    expect(results[0].winningVariant).toBeNull();
  });

  it("respects slice.competitiveVariants override", async () => {
    const bus = new EventEmitter();
    const mgr = fakeManager();
    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, competitiveVariants: 5, depends: [] },
    ]);
    await sched.execute(nodes, ["1"], async () => ({ status: "passed" }));
    expect(mgr.created).toHaveLength(5);
  });

  it("clamps competitiveVariants to [2, 5]", async () => {
    const bus = new EventEmitter();
    const mgr = fakeManager();
    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, competitiveVariants: 99, depends: [] },
    ]);
    await sched.execute(nodes, ["1"], async () => ({ status: "passed" }));
    expect(mgr.created).toHaveLength(5);
  });

  it("collects variant errors without crashing the slice", async () => {
    const bus = new EventEmitter();
    const mgr = fakeManager();
    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, depends: [] },
    ]);
    const executeFn = async (s) => {
      if (s.variantContext.variant === 2) throw new Error("boom");
      return { status: "passed" };
    };
    const results = await sched.execute(nodes, ["1"], executeFn);
    expect(results[0].variants).toHaveLength(3);
    const v2 = results[0].variants.find((v) => v.variant === 2);
    expect(v2.status).toBe("error");
    expect(v2.error).toBe("boom");
  });

  it("archives partial variants when worktree creation fails mid-spawn", async () => {
    const bus = new EventEmitter();
    const created = [];
    const archived = [];
    const mgr = {
      created, archived,
      createWorktree: (opts) => {
        if (opts.variant === 3) throw new Error("disk full");
        const path = join(opts.projectDir, ".forge", "worktrees",
          opts.planBasename, String(opts.sliceId), `variant-${opts.variant}`);
        created.push({ ...opts, path });
        return { path, baseRef: "HEAD" };
      },
      archiveWorktree: (opts) => { archived.push(opts); return { archived: true, from: "", to: "" }; },
    };
    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 3, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, depends: [] },
    ]);
    const results = await sched.execute(nodes, ["1"], async () => ({ status: "passed" }));
    expect(results[0].status).toBe("error");
    expect(archived.map((a) => a.variant).sort()).toEqual([1, 2]);
  });

  it("emits competitive lifecycle events", async () => {
    const bus = new EventEmitter();
    const events = [];
    bus.on("competitive-slice-started", (e) => events.push(["started", e.sliceId, e.variants]));
    bus.on("variant-started", (e) => events.push(["v-started", e.variant]));
    bus.on("variant-completed", (e) => events.push(["v-done", e.variant, e.status]));
    bus.on("competitive-slice-variants-completed", (e) => events.push(["finished", e.sliceId]));

    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 2, projectDir, planBasename: "p1", worktreeManager: fakeManager(),
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, competitiveVariants: 2, depends: [] },
    ]);
    await sched.execute(nodes, ["1"], async () => ({ status: "passed" }));
    expect(events[0]).toEqual(["started", "1", 2]);
    expect(events.filter((e) => e[0] === "v-started")).toHaveLength(2);
    expect(events.filter((e) => e[0] === "v-done")).toHaveLength(2);
    expect(events.at(-1)).toEqual(["finished", "1"]);
  });

  it("respects abortSignal before variants start", async () => {
    const bus = new EventEmitter();
    const mgr = fakeManager();
    const controller = new AbortController();
    controller.abort();
    const sched = new CompetitiveScheduler(bus, {
      maxVariants: 2, projectDir, planBasename: "p1", worktreeManager: mgr,
    });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, depends: [] },
    ]);
    const results = await sched.execute(nodes, ["1"], async () => ({ status: "passed" }), {
      abortSignal: controller.signal,
    });
    // Aborted before loop entered — results is empty
    expect(results).toEqual([]);
  });

  it("works without worktree manager (fallback: null worktreePath)", async () => {
    const bus = new EventEmitter();
    const sched = new CompetitiveScheduler(bus, { maxVariants: 2 });
    const nodes = mkNodes([
      { number: "1", title: "Comp", competitive: true, competitiveVariants: 2, depends: [] },
    ]);
    const seen = [];
    const executeFn = async (s) => { seen.push(s.variantContext); return { status: "passed" }; };
    const results = await sched.execute(nodes, ["1"], executeFn);
    expect(seen.every((v) => v.worktreePath === null)).toBe(true);
    expect(results[0].variants).toHaveLength(2);
  });
});
