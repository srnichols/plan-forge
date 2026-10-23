import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workerPrompts = vi.hoisted(() => []);
vi.mock("../orchestrator/worker-spawn.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  assertWorkerBackendReady: () => null,
  spawnWorker: async (prompt) => {
    workerPrompts.push(prompt);
    return {
      output: "Implemented the slice as described, then re-read the changed files to confirm. ".repeat(6),
      stderr: "",
      exitCode: 0,
      worker: "test-worker",
      model: "test-model",
      tokens: { tokens_in: 1, tokens_out: 1, model: "test-model" },
    };
  },
}));

import { buildPlanContext, buildPlanContextBlock } from "../orchestrator/prompt-builders.mjs";
import { parsePlan } from "../orchestrator/plan-parser.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";
import { runPlan } from "../orchestrator.mjs";

/**
 * Meta-bug #320 — buildSlicePrompt sent the worker the slice title, numbered
 * tasks, scope, commands and gate, and nothing else. The parser had already
 * collected each slice's Context Files and the plan's Scope Contract Forbidden
 * list, but neither reached the worker, so "per the Shared Contract" was a
 * dangling reference and Forbidden actions were invisible to the one agent
 * that could break them. Two parser gotchas that silently degrade a slice
 * (a plain `Files:` line, a `[parallel-safe, group P1]` tag) had no lint.
 */

describe("buildPlanContextBlock (#320)", () => {
  const planContext = {
    planFile: "docs/plans/Phase-9-PLAN.md",
    forbidden: ["Changes outside `pforge-claw/`", "Editing `package.json`"],
    hasSharedContract: false,
  };
  const slice = { number: "3", title: "Wire it", contextFiles: ["docs/DESIGN.md", "pforge-claw/README.md"] };

  it("lists the slice's Context Files under a 'Read before editing' heading", () => {
    const block = buildPlanContextBlock(slice, planContext);
    expect(block).toMatch(/Read before editing/);
    expect(block).toContain("- docs/DESIGN.md");
    expect(block).toContain("- pforge-claw/README.md");
  });

  it("says Context Files are references, not editable scope", () => {
    expect(buildPlanContextBlock(slice, planContext)).toMatch(/not part of your (?:edit )?scope|reference/i);
  });

  it("carries every Forbidden item from the plan", () => {
    const block = buildPlanContextBlock(slice, planContext);
    expect(block).toMatch(/Forbidden/);
    expect(block).toContain("- Changes outside `pforge-claw/`");
    expect(block).toContain("- Editing `package.json`");
  });

  it("points at the plan file and says when to open it", () => {
    const block = buildPlanContextBlock(slice, planContext);
    expect(block).toContain("docs/plans/Phase-9-PLAN.md");
    expect(block).toMatch(/open that section|section (?:this slice|it) cites/i);
  });

  it("mentions the Shared Contract only when the plan has one", () => {
    expect(buildPlanContextBlock(slice, planContext)).not.toMatch(/Shared Contract/);
    expect(buildPlanContextBlock(slice, { ...planContext, hasSharedContract: true })).toMatch(/Shared Contract/);
  });

  it("is delimited like the other prompt blocks", () => {
    const block = buildPlanContextBlock(slice, planContext);
    expect(block).toContain("--- PLAN CONTEXT ---");
    expect(block).toContain("--- END PLAN CONTEXT ---");
  });

  it("omits the Context Files section when the slice declares none", () => {
    const block = buildPlanContextBlock({ ...slice, contextFiles: [] }, planContext);
    expect(block).not.toMatch(/Read before editing/);
    expect(block).toContain("Changes outside");
  });

  it("omits the Forbidden section when the plan lists nothing", () => {
    const block = buildPlanContextBlock(slice, { ...planContext, forbidden: [] });
    expect(block).not.toMatch(/Forbidden/);
    expect(block).toContain("docs/DESIGN.md");
  });

  it("is empty when there is nothing to say, so a bare slice prompt is unchanged", () => {
    expect(buildPlanContextBlock({ number: "1", title: "T" }, { planFile: null, forbidden: [], hasSharedContract: false })).toBe("");
    expect(buildPlanContextBlock({ number: "1", title: "T" }, null)).toBe("");
    expect(buildPlanContextBlock({ number: "1", title: "T" }, undefined)).toBe("");
  });

  it("caps a long Forbidden list and says how many it left out", () => {
    const forbidden = Array.from({ length: 27 }, (_, i) => `Forbidden thing ${i + 1}`);
    const block = buildPlanContextBlock(slice, { ...planContext, forbidden });
    expect(block).toContain("- Forbidden thing 20");
    expect(block).not.toContain("- Forbidden thing 21");
    expect(block).toMatch(/\+7 more/);
  });

  it("trims an overlong Forbidden item instead of dumping it whole", () => {
    const block = buildPlanContextBlock(slice, { ...planContext, forbidden: ["x".repeat(900)] });
    expect(block).not.toContain("x".repeat(400));
    expect(block).toContain("…");
  });
});

describe("buildPlanContext (#320)", () => {
  const cwd = join(tmpdir(), "pf-meta-320-project");
  const plan = (forbidden, extra = {}) => ({ scopeContract: { inScope: [], outOfScope: [], forbidden }, ...extra });

  it("names the plan file relative to the project, with forward slashes", () => {
    const ctx = buildPlanContext({ plan: plan([]), planPath: join(cwd, "docs", "plans", "Phase-9-PLAN.md"), cwd });
    expect(ctx.planFile).toBe("docs/plans/Phase-9-PLAN.md");
  });

  it("reads a relative plan path the way parsePlan does, from the process directory", () => {
    const ctx = buildPlanContext({ plan: plan([]), planPath: "docs/plans/Phase-9-PLAN.md", cwd: process.cwd() });
    expect(ctx.planFile).toBe("docs/plans/Phase-9-PLAN.md");
  });

  it("gives no pointer for a plan outside the project, rather than leak a local path", () => {
    const outside = join(tmpdir(), "elsewhere", "Phase-9-PLAN.md");
    expect(buildPlanContext({ plan: plan([]), planPath: outside, cwd }).planFile).toBeNull();
  });

  it("drops 'none'-style placeholder items but keeps real ones that start with the same word", () => {
    const ctx = buildPlanContext({
      plan: plan(["none", "None.", "Nothing", "N/A", "None — no extra restrictions", "Nothing outside `src/` may change", "Editing `a.mjs`"]),
      planPath: "plan.md",
      cwd,
    });
    expect(ctx.forbidden).toEqual(["Nothing outside `src/` may change", "Editing `a.mjs`"]);
  });

  it("carries hasSharedContract from the parsed plan", () => {
    expect(buildPlanContext({ plan: plan([], { hasSharedContract: true }), planPath: "plan.md", cwd }).hasSharedContract).toBe(true);
    expect(buildPlanContext({ plan: plan([]), planPath: "plan.md", cwd }).hasSharedContract).toBe(false);
  });

  it("tolerates a plan with no scope contract", () => {
    expect(buildPlanContext({ plan: {}, planPath: "plan.md", cwd }).forbidden).toEqual([]);
  });
});

describe("the worker prompt carries the plan context (#320)", () => {
  const dirs = [];
  beforeEach(() => { workerPrompts.length = 0; });
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function project(gateExit = 0) {
    const cwd = mkdtempSync(join(tmpdir(), "pf-meta-320-run-"));
    dirs.push(cwd);
    const gate = () => ["**Validation Gate**", "```", `node -e "process.exit(${gateExit})"`, "```"].join("\n");
    const planPath = join(cwd, "Phase-9-PLAN.md");
    writeFileSync(planPath, [
      "# Phase 9 - Plan context", "",
      "> **Status**: **HARDENED — cleared for execution.**", "",
      "## Scope Contract", "", "### In Scope", "- `src/**`", "",
      "### Forbidden", "- Changes outside `src/`", "- Editing `package.json`", "- none", "",
      "## Shared Contract", "", "- Event names live in `src/events.mjs`.", "",
      "## Execution Slices", "",
      "### Slice 1: First", "**Context Files**: `docs/ONE.md`, `src/events.mjs`", "", gate(), "", "1. Build the first part.", "",
      "### Slice 2: Second", "**Context Files**: `docs/TWO.md`", "", gate(), "", "1. Build the second part.", "",
    ].join("\n"));
    return { cwd, planPath };
  }

  const options = (cwd, extra = {}) => ({ cwd, mode: "auto", manualImport: true, quorum: false, noTempering: true, ...extra });

  it("hands the worker Context Files, Forbidden items and the plan pointer", async () => {
    const { cwd, planPath } = project();
    await runPlan(planPath, options(cwd));

    expect(workerPrompts).toHaveLength(2);
    const [first] = workerPrompts;
    expect(first).toContain("Execute Slice 1: First");
    expect(first).toContain("--- PLAN CONTEXT ---");
    expect(first).toContain("docs/ONE.md");
    expect(first).toContain("src/events.mjs");
    expect(first).toContain("- Changes outside `src/`");
    expect(first).toContain("- Editing `package.json`");
    expect(first).not.toMatch(/^- none$/m);
    expect(first).toContain("Phase-9-PLAN.md");
    expect(first).toMatch(/Shared Contract/);
  }, 120_000);

  it("gives each slice its own Context Files, not its neighbour's", async () => {
    const { cwd, planPath } = project();
    await runPlan(planPath, options(cwd));

    const [first, second] = workerPrompts;
    expect(first).not.toContain("docs/TWO.md");
    expect(second).toContain("docs/TWO.md");
    expect(second).not.toContain("docs/ONE.md");
  }, 120_000);

  it("repeats the context on the retry attempt after a failed gate", async () => {
    const { cwd, planPath } = project(1);
    await runPlan(planPath, options(cwd, { onlySlices: ["1"] }));

    expect(workerPrompts.length).toBeGreaterThanOrEqual(2);
    for (const prompt of workerPrompts) {
      expect(prompt).toContain("docs/ONE.md");
      expect(prompt).toContain("- Editing `package.json`");
    }
  }, 120_000);
});

describe("the hardening guidance no longer teaches what the parser ignores (#320)", () => {
  const ROOT = resolve(import.meta.dirname, "..", "..");
  const read = (rel) => readFileSync(resolve(ROOT, rel), "utf-8");
  const hardeningDocs = [
    ".github/prompts/step2-harden-plan.prompt.md",
    "docs/plans/AI-Plan-Hardening-Runbook-Instructions.md",
  ];
  const hardenerAgents = [
    "templates/.github/agents/plan-hardener.agent.md",
    "plugins/plan-forge/com.github.copilot/agents/plan-hardener.agent.md",
  ];

  it.each(hardeningDocs)("%s asks for exactly [parallel-safe] with the group in the body", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/\[parallel-safe\]\s*\(with Parallel Group\)/);
    expect(src).toMatch(/nothing else inside the brackets/);
    expect(src).toMatch(/\*\*Parallel Group\*\*/);
  });

  it.each(hardeningDocs)("%s asks for a bold **Files** line and explains the plain form is ignored", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/bold `\*\*Files\*\*:` line/);
    expect(src).toMatch(/plain `Files:` or `Scope:` line is not read/);
  });

  it.each(hardenerAgents)("%s keeps the group out of the parallel tag", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/`\[parallel-safe\]` with group/);
    expect(src).toMatch(/not inside the brackets/);
  });
});

describe("gate lint: declarations the parser silently ignores (#320)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-320-lint-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const planFile = () => join(dir, "plan.md");
  function lint(...sliceBlocks) {
    writeFileSync(planFile(), [
      "# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices",
      ...sliceBlocks.flatMap((block) => [...block, ""]),
    ].join("\n"));
    return lintGateCommands(planFile(), dir);
  }
  const rule = (result, name) => result.filter((f) => f.rule === name);

  describe("scope-not-parsed", () => {
    it("warns on a plain `Files:` line that produced no scope", () => {
      const result = lint(["### Slice 1 — Plain label", "Files: `src/a.mjs`, `src/b.mjs`", "1. Do it."]);
      const found = rule(result.warnings, "scope-not-parsed");
      expect(found).toHaveLength(1);
      expect(found[0].slice).toBe("1");
      expect(found[0].message).toMatch(/\*\*Files\*\*/);
      expect(found[0].message).toMatch(/\[scope:/);
    });

    it("warns on a bulleted plain `Scope:` line", () => {
      const result = lint(["### Slice 1 — Bulleted", "- Scope: src/a.mjs", "1. Do it."]);
      expect(rule(result.warnings, "scope-not-parsed")).toHaveLength(1);
    });

    it("warns on a plain `Files in scope:` line", () => {
      const result = lint(["### Slice 1 — Longer label", "Files in scope: src/a.mjs", "1. Do it."]);
      expect(rule(result.warnings, "scope-not-parsed")).toHaveLength(1);
    });

    it("stays quiet when the bold form is used", () => {
      const result = lint(["### Slice 1 — Bold", "**Files**: `src/a.mjs`", "1. Do it."]);
      expect(rule(result.warnings, "scope-not-parsed")).toHaveLength(0);
    });

    it("stays quiet when a [scope:] tag supplies the scope", () => {
      const result = lint(["### Slice 1 — Tagged [scope: src/**]", "Files: `src/a.mjs`", "1. Do it."]);
      expect(rule(result.warnings, "scope-not-parsed")).toHaveLength(0);
    });

    it("stays quiet for prose that merely starts with the word", () => {
      const result = lint(["### Slice 1 — Prose", "Scope creep is the main risk here.", "Files are listed in the contract.", "1. Do it."]);
      expect(rule(result.warnings, "scope-not-parsed")).toHaveLength(0);
    });

    it("ignores plain `Files:` lines inside a code fence", () => {
      const result = lint(["### Slice 1 — Fenced", "1. Do it.", "```text", "Files: src/a.mjs", "```"]);
      expect(rule(result.warnings, "scope-not-parsed")).toHaveLength(0);
    });
  });

  describe("parallel-tag-not-parsed", () => {
    it("warns on [parallel-safe, group P1], which the parser reads as sequential", () => {
      const result = lint(
        ["### Slice 1 — One", "1. Do it."],
        ["### Slice 2 — Two [parallel-safe, group P1]", "1. Do it."],
      );
      const found = rule(result.warnings, "parallel-tag-not-parsed");
      expect(found).toHaveLength(1);
      expect(found[0].slice).toBe("2");
      expect(found[0].message).toMatch(/\[parallel-safe, group P1\]/);
      expect(found[0].message).toMatch(/\[P\]|\[parallel-safe\]/);
      expect(parsePlan(planFile(), dir).slices[1].parallel).toBe(false);
    });

    it("warns on other tags that name parallelism but do not parse", () => {
      const result = lint(
        ["### Slice 1 — One [parallel: 2]", "1. Do it."],
        ["### Slice 2 — Two [can run in parallel]", "1. Do it."],
      );
      expect(rule(result.warnings, "parallel-tag-not-parsed").map((f) => f.slice)).toEqual(["1", "2"]);
    });

    it.each(["[P]", "[parallel]", "[parallel-safe]", "[Parallel-Safe]"])("stays quiet for the recognised tag %s", (tag) => {
      const result = lint(["### Slice 1 — One " + tag, "1. Do it."]);
      expect(rule(result.warnings, "parallel-tag-not-parsed")).toHaveLength(0);
    });

    it("stays quiet when a recognised tag is also present", () => {
      const result = lint(["### Slice 1 — One [P] [parallel-safe, group P1]", "1. Do it."]);
      expect(rule(result.warnings, "parallel-tag-not-parsed")).toHaveLength(0);
    });

    it("stays quiet for ordinary tags and for titles that only mention the word", () => {
      const result = lint(
        ["### Slice 1 — Add parallel scheduler [scope: src/**]", "1. Do it."],
        ["### Slice 2 — Parallel worktrees [depends: Slice 1]", "1. Do it."],
      );
      expect(rule(result.warnings, "parallel-tag-not-parsed")).toHaveLength(0);
    });
  });
});
