import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

import { parsePlan, taskHeadline } from "../orchestrator/plan-parser.mjs";
import { buildSlicePrompt } from "../orchestrator/prompt-builders.mjs";
import { inferSliceType } from "../orchestrator/model-scoring.mjs";
import { scoreSliceComplexity } from "../orchestrator/review-watcher.mjs";
import { buildMemorySearchBlock } from "../memory.mjs";
import { runPlan } from "../orchestrator.mjs";

/**
 * Meta-bug #377 — applyTaskLine kept only a column-0 `1. ` line. Whatever sat
 * indented beneath a task (sub-bullets, a code sample, a wrapped paragraph) was
 * dropped, and the worker prompt is built from the tasks, so the worker received
 * "1. Orient first:" with nothing under it. Across docs/plans, 584 lines in 17
 * plans were lost this way, 319 of them in two slices of the Phase-62 plan.
 *
 * Indented text under a numbered task now belongs to that task, as in Markdown.
 */

describe("indented text under a numbered task (#377)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-377-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const GATE = ["", "**Validation Gate**:", "```bash", "npm test", "```", ""];
  function parse(...blocks) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, ["# Plan", "## Scope Contract", "### In Scope", "- Something", "## Execution Slices", ...blocks.flat()].join("\n"));
    return parsePlan(planPath, dir).slices;
  }
  const tasksOf = (...body) => parse(["### Slice 1: Work", ...body, ...GATE])[0].tasks;

  it("keeps the sub-bullets with the task they sit under", () => {
    expect(tasksOf("1. Orient first:", "   - Read `docs/X.md`", "   - Read `docs/Y.md`", "2. Then build")).toEqual([
      "Orient first:\n   - Read `docs/X.md`\n   - Read `docs/Y.md`",
      "Then build",
    ]);
  });

  it("keeps an indented code sample, with the blank line before it", () => {
    expect(tasksOf("1. Create the config:", "", "   ```json", '   { "a": 1 }', "   ```", "2. Next")).toEqual([
      'Create the config:\n\n   ```json\n   { "a": 1 }\n   ```',
      "Next",
    ]);
  });

  it("keeps a wrapped paragraph", () => {
    expect(tasksOf("1. Build the thing and make sure", "   the wrapped line is read too.", "2. Then test")).toEqual([
      "Build the thing and make sure\n   the wrapped line is read too.",
      "Then test",
    ]);
  });

  it("keeps blank lines between the lines of a task and drops the ones after its last", () => {
    expect(tasksOf("1. A", "", "   - x", "", "   - y", "", "2. B")).toEqual(["A\n\n   - x\n\n   - y", "B"]);
  });

  it("does not turn an indented numbered line into a task of its own", () => {
    expect(tasksOf("1. Orient:", "   1. read A", "   2. read B", "2. Build")).toEqual(["Orient:\n   1. read A\n   2. read B", "Build"]);
  });

  it("reads a tab as indentation and drops trailing whitespace", () => {
    expect(tasksOf("1. A", "\t- b   ", "2. C")).toEqual(["A\n\t- b", "C"]);
  });

  it("ends a task at the first line that is not indented", () => {
    expect(tasksOf("1. A", "   - kept", "**Note**: outdented", "   - not part of any task")).toEqual(["A\n   - kept"]);
  });

  it("does not let text after the gate join the last task", () => {
    const [{ tasks }] = parse(["### Slice 1: Work", "1. A", "", "**Validation Gate**:", "```bash", "npm test", "```", "", "   - indented after the gate", ""]);
    expect(tasks).toEqual(["A"]);
  });

  it("ignores indented text that comes before any task", () => {
    expect(tasksOf("   - stray bullet", "1. A")).toEqual(["A"]);
  });

  it("keeps a slice's last task from collecting the next slice's lines", () => {
    const [first, second] = parse(
      ["### Slice 1: One", "1. A", "   - a detail", ...GATE],
      ["### Slice 2: Two", "   - stray", "1. B", ...GATE],
    );
    expect(first.tasks).toEqual(["A\n   - a detail"]);
    expect(second.tasks).toEqual(["B"]);
  });

  it("still reads a scope declaration indented under a task as scope", () => {
    const [slice] = parse(["### Slice 1: Work", "1. A", "   **Files**: `src/a.mjs`", ...GATE]);
    expect(slice.scope).toEqual(["src/a.mjs"]);
    expect(slice.tasks).toEqual(["A"]);
  });

  it("leaves plans without nested text exactly as they were", () => {
    expect(tasksOf("1. One", "2. Two", "", "3. Three")).toEqual(["One", "Two", "Three"]);
  });
});

describe("slice routing and scoring read each task's own line, not the text under it (#377)", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pf-meta-377-score-")); });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("takes the first line of a task as its headline", () => {
    expect(taskHeadline("Orient first:\n   - Read A\n   - Read B")).toBe("Orient first:");
    expect(taskHeadline("One line")).toBe("One line");
    expect(taskHeadline("")).toBe("");
  });

  it("infers the slice type from headlines: a sub-bullet that mentions a test does not make a test slice", () => {
    expect(inferSliceType({ title: "Wire the router", tasks: ["Build the router\n   - add a unit test for it"] })).toBe("execute");
    expect(inferSliceType({ title: "Wire the router", tasks: ["Add the unit test", "Build the router"] })).toBe("test");
  });

  it("scores complexity from headlines: security words under a task do not raise the score", () => {
    const plain = { title: "Build it", tasks: ["Build the part"], validationGate: "npm test" };
    const nested = { ...plain, tasks: ["Build the part\n   - validate the password, token and secret handling"] };
    expect(scoreSliceComplexity(nested, cwd)).toEqual(scoreSliceComplexity(plain, cwd));
    const headline = { ...plain, tasks: ["Validate the password, token and secret handling"] };
    expect(scoreSliceComplexity(headline, cwd).signals.securityWeight).toBeGreaterThan(0);
  });
});

describe("the worker prompt lists the nested text under its task (#377)", () => {
  it("indents the continuation lines under the bullet", () => {
    const prompt = buildSlicePrompt({ number: "1", title: "T", tasks: ["Orient first:\n   - A\n   - B", "Then build"] });
    expect(prompt).toContain("- Orient first:\n     - A\n     - B\n- Then build");
  });

  it("keeps blank lines blank, with no trailing spaces", () => {
    const prompt = buildSlicePrompt({ number: "1", title: "T", tasks: ["Create it:\n\n   ```js\n   x();\n   ```"] });
    expect(prompt).toContain("- Create it:\n\n     ```js\n     x();\n     ```");
    expect(prompt).not.toMatch(/[ \t]+\n/);
  });

  it("writes single-line tasks as before", () => {
    expect(buildSlicePrompt({ number: "2", title: "T", tasks: ["One", "Two"] })).toContain("Tasks:\n- One\n- Two");
  });
});

describe("a task with nested text, where a task is quoted on one line (#377)", () => {
  it("builds the memory search query from the first line of the first task", () => {
    const block = buildMemorySearchBlock("proj", { title: "Wire it", tasks: ["Orient first:\n   - Read A", "Then build"] });
    expect(block).toContain('query: "Wire it Orient first:"');
    expect(block).not.toContain("Read A");
  });

  it("still builds it from a task of one line, or no tasks", () => {
    expect(buildMemorySearchBlock("proj", { title: "Wire it", tasks: ["Orient first"] })).toContain('query: "Wire it Orient first"');
    expect(buildMemorySearchBlock("proj", { title: "Wire it", tasks: [] })).toContain('query: "Wire it "');
    expect(buildMemorySearchBlock("proj", { title: "Wire it" })).toContain('query: "Wire it "');
  });
});

describe("a run sends the worker the nested text (#377)", () => {
  const dirs = [];
  beforeEach(() => { workerPrompts.length = 0; });
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  it("includes the sub-bullets of the task in the slice prompt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pf-meta-377-run-"));
    dirs.push(cwd);
    const planPath = join(cwd, "Phase-9-PLAN.md");
    writeFileSync(planPath, [
      "# Phase 9 - Nested tasks", "",
      "> **Status**: **HARDENED — cleared for execution.**", "",
      "## Scope Contract", "", "### In Scope", "- `src/**`", "",
      "## Execution Slices", "",
      "### Slice 1: First", "",
      "1. Orient first:", "   - Read `docs/ONE.md` before editing", "   - Note the event names", "2. Then build the part.", "",
      "**Validation Gate**", "```", "node -e \"process.exit(0)\"", "```", "",
    ].join("\n"));

    await runPlan(planPath, { cwd, mode: "auto", manualImport: true, quorum: false, noTempering: true });

    expect(workerPrompts).toHaveLength(1);
    expect(workerPrompts[0]).toContain("- Orient first:\n     - Read `docs/ONE.md` before editing\n     - Note the event names\n- Then build the part.");
  }, 120_000);
});
