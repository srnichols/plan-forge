import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const calls = vi.hoisted(() => []);
vi.mock("../orchestrator/worker-spawn.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  assertWorkerBackendReady: () => null,
  filterQuorumModels: (config) => ({ available: [...config.models], dropped: [] }),
  probeQuorumModelAvailability: () => ({ available: true }),
  spawnWorker: async (prompt, opts = {}) => {
    calls.push({ prompt, role: opts.role ?? "worker" });
    return {
      output: "Create src/a.mjs, wire it in, then re-read the changed files to confirm the result. ".repeat(4),
      stderr: "",
      exitCode: 0,
      worker: "test-worker",
      model: opts.model ?? "test-model",
      tokens: { tokens_in: 1, tokens_out: 1, model: opts.model ?? "test-model" },
    };
  },
}));

import { quorumDispatch, quorumReview } from "../orchestrator/quorum.mjs";
import { runPlan } from "../orchestrator.mjs";

/**
 * Meta-bug #381 — the executing worker's prompt carries a PLAN CONTEXT block
 * (the plan file, its Forbidden items, the Shared Contract notice and the
 * slice's Context Files, added for #320). The quorum legs that plan the slice
 * first never got it: the dry-run models and the reviewer wrote their plan
 * without knowing which paths the plan forbids or which contract the slice
 * must honour, so they could propose edits the executor then had to undo.
 */

const planContext = {
  planFile: "docs/plans/Phase-9-PLAN.md",
  forbidden: ["Changes outside `src/`", "Editing `package.json`"],
  hasSharedContract: true,
};
const slice = {
  number: "1",
  title: "Build it",
  tasks: ["Build the first part."],
  scope: ["src/**"],
  contextFiles: ["docs/ONE.md"],
  validationGate: "npm test",
};
const config = { models: ["model-a", "model-b", "model-c"], reviewerModel: "model-r", dryRunTimeout: 5_000 };
const BLOCK = "--- PLAN CONTEXT ---";

const roleCalls = (role) => calls.filter((call) => call.role === role).map((call) => call.prompt);

function expectPlanContext(prompt) {
  expect(prompt).toContain(BLOCK);
  expect(prompt).toContain("- Changes outside `src/`");
  expect(prompt).toContain("- Editing `package.json`");
  expect(prompt).toContain("docs/ONE.md");
  expect(prompt).toContain("Plan file: docs/plans/Phase-9-PLAN.md");
  expect(prompt).toMatch(/Shared Contract/);
}

describe("quorum legs receive the plan context (#381)", () => {
  beforeEach(() => { calls.length = 0; });

  it("gives every dry-run leg the plan context, after the slice instructions", async () => {
    await quorumDispatch(slice, config, { cwd: process.cwd(), planContext });

    const legs = roleCalls("quorum-dry-run");
    expect(legs).toHaveLength(config.models.length);
    for (const prompt of legs) {
      expectPlanContext(prompt);
      expect(prompt.indexOf("Execute Slice 1: Build it")).toBeLessThan(prompt.indexOf(BLOCK));
    }
  });

  it("gives the reviewer the plan context", async () => {
    const dispatchResult = { successful: [{ model: "model-a", output: "plan A" }, { model: "model-b", output: "plan B" }] };
    await quorumReview(dispatchResult, slice, config, { cwd: process.cwd(), planContext });

    const [reviewerPrompt] = roleCalls("reviewer");
    expectPlanContext(reviewerPrompt);
    expect(reviewerPrompt.indexOf("--- ORIGINAL SLICE ---")).toBeLessThan(reviewerPrompt.indexOf(BLOCK));
    expect(reviewerPrompt.indexOf(BLOCK)).toBeLessThan(reviewerPrompt.indexOf("Produce the unified execution plan now."));
  });

  it("adds nothing when the slice has no context files and the caller has no plan context", async () => {
    const bare = { number: "2", title: "Bare", tasks: ["Do it."] };
    await quorumDispatch(bare, config, { cwd: process.cwd() });
    await quorumReview(
      { successful: [{ model: "model-a", output: "plan A" }, { model: "model-b", output: "plan B" }] },
      bare,
      config,
      { cwd: process.cwd() },
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const { prompt } of calls) {
      expect(prompt).not.toContain(BLOCK);
      expect(prompt).toContain("Execute Slice 2: Bare");
    }
  });

  it("still passes the slice's own Context Files with no plan context, as the executor's prompt does", async () => {
    await quorumDispatch(slice, config, { cwd: process.cwd() });

    for (const prompt of roleCalls("quorum-dry-run")) {
      expect(prompt).toContain(BLOCK);
      expect(prompt).toContain("docs/ONE.md");
      expect(prompt).not.toContain("Forbidden by the plan");
      expect(prompt).not.toContain("Plan file:");
    }
  });

  it("adds nothing for a plan with no forbidden items, shared contract or context files", async () => {
    const bare = { number: "2", title: "Bare", tasks: ["Do it."] };
    await quorumDispatch(bare, config, { cwd: process.cwd(), planContext: { planFile: null, forbidden: [], hasSharedContract: false } });

    for (const prompt of roleCalls("quorum-dry-run")) expect(prompt).not.toContain(BLOCK);
  });
});

describe("a quorum run hands the plan context to every model that sees the slice (#381)", () => {
  const dirs = [];
  beforeEach(() => { calls.length = 0; });
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function project() {
    const cwd = mkdtempSync(join(tmpdir(), "pf-meta-381-"));
    dirs.push(cwd);
    const planPath = join(cwd, "Phase-9-PLAN.md");
    writeFileSync(planPath, [
      "# Phase 9 - Quorum plan context", "",
      "> **Status**: **HARDENED — cleared for execution.**", "",
      "## Scope Contract", "", "### In Scope", "- `src/**`", "",
      "### Forbidden", "- Changes outside `src/`", "- Editing `package.json`", "",
      "## Shared Contract", "", "- Event names live in `src/events.mjs`.", "",
      "## Execution Slices", "",
      "### Slice 1: First", "**Context Files**: `docs/ONE.md`", "",
      "**Validation Gate**", "```", "node -e \"process.exit(0)\"", "```", "",
      "1. Build the first part.", "",
    ].join("\n"));
    return { cwd, planPath };
  }

  it("covers the dry-run legs, the reviewer and the executor", async () => {
    const { cwd, planPath } = project();
    await runPlan(planPath, { cwd, mode: "auto", manualImport: true, quorum: true, noTempering: true });

    const legs = roleCalls("quorum-dry-run");
    const reviewer = roleCalls("reviewer");
    const executor = calls.filter((call) => call.role !== "quorum-dry-run" && call.role !== "reviewer").map((call) => call.prompt);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    expect(reviewer).toHaveLength(1);
    expect(executor.length).toBeGreaterThanOrEqual(1);
    for (const prompt of [...legs, ...reviewer, ...executor]) {
      expect(prompt).toContain(BLOCK);
      expect(prompt).toContain("- Editing `package.json`");
      expect(prompt).toContain("docs/ONE.md");
      expect(prompt).toContain("Phase-9-PLAN.md");
    }
  }, 120_000);
});
