import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const calls = vi.hoisted(() => []);
const git = vi.hoisted(() => ({ committed: [], staged: [] }));
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
vi.mock("../orchestrator/git-safety.mjs", async (importOriginal) => ({
  ...(await importOriginal()),
  autoCommitSliceIfDirty: ({ slice }) => {
    git.committed.push(String(slice.number));
    return { committed: true, reason: "test" };
  },
  stageOrphansOnSliceFailure: ({ slice }) => {
    git.staged.push(String(slice.number));
    return null;
  },
}));

import { parsePlan, isManualGateSlice, manualGateText } from "../orchestrator/plan-parser.mjs";
import { buildSlicePrompt } from "../orchestrator/prompt-builders.mjs";
import { holdManualGateSlice, summarizeManualHolds, manualHoldReport } from "../orchestrator/run-plan/manual-gate-hold.mjs";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";
import { runPlan } from "../orchestrator.mjs";

/**
 * Meta-bug #369 — a `[manual]` gate is the step-2 convention for a check no
 * command can make: "a person confirms the deployment in the portal". The lint
 * exempts it from gate-declared-not-runnable, but at run time nothing paused,
 * skipped or reported such a slice: validationGate is empty, there is no gate to
 * cross-check, and a worker that exits 0 passes the slice. A slice that needs a
 * live cloud session or an owner's approval could be completed by a worker
 * without either, and the plan marked complete.
 *
 * In auto mode the run now stops after the slice's worker finishes, with the
 * work committed, and says what a person must check and how to continue. The
 * slice is recorded as failed with a reason and a flag of its own, not as a
 * status of its own: every scheduler, summary and exit-code path reads passed or
 * failed, and a status they do not know would let the run carry on past it.
 * Assisted mode has a person at the keyboard already, so it does not stop.
 */

const GATE_TEXT = "a person confirms the deployment in the portal";

describe("isManualGateSlice and manualGateText (#369)", () => {
  it.each([
    "[manual] a person confirms",
    "[Manual] a person confirms",
    "  [MANUAL]a person confirms",
    "[manual]",
  ])("is true for a gate that starts with the marker: %j", (validationGateDescription) => {
    expect(isManualGateSlice({ validationGate: null, validationGateDescription })).toBe(true);
    expect(isManualGateSlice({ validationGate: "  ", validationGateDescription })).toBe(true);
  });

  it("is false when a runnable gate command was parsed, because that gate decides the slice", () => {
    expect(isManualGateSlice({ validationGate: "npm test", validationGateDescription: "[manual] a person confirms" })).toBe(false);
  });

  it.each([
    [{ validationGate: null, validationGateDescription: "all tests pass" }],
    [{ validationGate: null, validationGateDescription: "see the [manual] steps" }],
    [{ validationGate: null }],
    [{}],
    [null],
    [undefined],
  ])("is false for %j", (slice) => {
    expect(isManualGateSlice(slice)).toBe(false);
  });

  it("gives the gate text without its marker", () => {
    expect(manualGateText({ validationGateDescription: "[manual]  a person confirms the deployment " })).toBe("a person confirms the deployment");
    expect(manualGateText({ validationGateDescription: "[manual]" })).toBe("");
    expect(manualGateText({})).toBe("");
  });

  describe("with the real parser", () => {
    let dir;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-369-parse-")); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const parse = (...gateLines) => {
      const planPath = join(dir, "plan.md");
      writeFileSync(planPath, ["# Plan", "## Scope Contract", "### In Scope", "- x", "## Execution Slices", "### Slice 1: Work", "1. Do it", ...gateLines, ""].join("\n"));
      return parsePlan(planPath, dir).slices[0];
    };

    it("recognises the convention as the step-2 prompt writes it", () => {
      const slice = parse(`**Validation Gate**: [manual] ${GATE_TEXT}`);
      expect(isManualGateSlice(slice)).toBe(true);
      expect(manualGateText(slice)).toBe(GATE_TEXT);
    });

    it("does not take a slice with a gate command for a manual one, whatever else its gate line says", () => {
      expect(isManualGateSlice(parse("**Validation Gate**:", "```bash", "npm test", "```"))).toBe(false);
      expect(isManualGateSlice(parse("**Validation Gate**: [manual] confirm in the portal", "```bash", "npm test", "```"))).toBe(false);
    });

    it("leaves the lint's exemption as it was, and still errors on a gate that is prose", () => {
      const lint = (line) => {
        parse(line);
        return lintGateCommands(join(dir, "plan.md"), dir).errors.filter((e) => e.rule === "gate-declared-not-runnable");
      };
      expect(lint(`**Validation Gate**: [manual] ${GATE_TEXT}`)).toEqual([]);
      expect(lint("**Validation Gate**: all tests pass")).toHaveLength(1);
    });
  });
});

describe("the worker's prompt (#369)", () => {
  const base = { number: "2", title: "Deploy", tasks: ["Deploy it."] };

  it("tells the worker a person verifies the slice, and that it must not report that as done", () => {
    const prompt = buildSlicePrompt({ ...base, validationGate: null, validationGateDescription: `[manual] ${GATE_TEXT}` });
    expect(prompt).toContain(`Manual verification (a person does this after you finish; you cannot, so do not report it as done): ${GATE_TEXT}`);
    expect(prompt).not.toContain("Validation gate (run these after completion)");
  });

  it("says so when the gate has no text", () => {
    expect(buildSlicePrompt({ ...base, validationGate: null, validationGateDescription: "[manual]" })).toContain("(no description)");
  });

  it("leaves a slice with a gate command, and one with no gate, as they were", () => {
    const gated = buildSlicePrompt({ ...base, validationGate: "npm test", validationGateDescription: "[manual] a person looks too" });
    expect(gated).toContain("Validation gate (run these after completion):\nnpm test");
    expect(gated).not.toContain("Manual verification");
    expect(buildSlicePrompt(base)).not.toContain("Manual verification");
  });
});

describe("holdManualGateSlice (#369)", () => {
  const slice = { number: "2", title: "Deploy", validationGate: null, validationGateDescription: `[manual] ${GATE_TEXT}` };
  const passed = () => ({ status: "passed", number: "2", title: "Deploy" });

  it("turns a passed manual slice into one waiting for a person, naming what to check and how to continue", () => {
    const result = passed();
    holdManualGateSlice({ sliceResult: result, slice, mode: "auto" });
    expect(result.status).toBe("failed");
    expect(result.awaitingManualVerification).toEqual({ gate: GATE_TEXT });
    expect(result.statusReason).toMatch(/^manual-verification-required: /);
    expect(result.statusReason).toContain(GATE_TEXT);
    expect(result.statusReason).toMatch(/changes are committed/);
    expect(result.statusReason).toContain("--resume-from");
  });

  it("holds when no mode is given, as auto is the default", () => {
    const result = passed();
    holdManualGateSlice({ sliceResult: result, slice });
    expect(result.status).toBe("failed");
  });

  it("does not stop an assisted run: a person is already at the keyboard", () => {
    const result = passed();
    holdManualGateSlice({ sliceResult: result, slice, mode: "assisted" });
    expect(result).toEqual(passed());
  });

  it("leaves a slice that already failed with its own reason", () => {
    const result = { status: "failed", statusReason: "validation gate failed: npm test" };
    holdManualGateSlice({ sliceResult: result, slice, mode: "auto" });
    expect(result).toEqual({ status: "failed", statusReason: "validation gate failed: npm test" });
  });

  it("leaves a slice with a gate command, and a slice that is not manual, alone", () => {
    for (const other of [
      { ...slice, validationGate: "npm test" },
      { number: "2", title: "Plain", validationGate: null, validationGateDescription: "all tests pass" },
      { number: "2", title: "Bare" },
    ]) {
      const result = passed();
      holdManualGateSlice({ sliceResult: result, slice: other, mode: "auto" });
      expect(result).toEqual(passed());
    }
  });

  it("says so when the gate has no text", () => {
    const result = passed();
    holdManualGateSlice({ sliceResult: result, slice: { ...slice, validationGateDescription: "[manual]" }, mode: "auto" });
    expect(result.awaitingManualVerification).toEqual({ gate: "(no description)" });
    expect(result.statusReason).toContain("(no description)");
  });
});

describe("summarizeManualHolds and manualHoldReport (#369)", () => {
  const plan = { slices: [{ number: "1" }, { number: "2" }, { number: "2A" }, { number: "3" }] };
  const held = (number, gate) => ({ number, title: `Slice ${number}`, status: "failed", awaitingManualVerification: { gate } });

  it("lists each held slice with the slice to continue from", () => {
    expect(summarizeManualHolds(plan, [{ number: "1", status: "passed" }, held("2", "check A")])).toEqual([
      { slice: "2", title: "Slice 2", gate: "check A", resumeFrom: "2A" },
    ]);
  });

  it("has nothing to continue from when the held slice is the last", () => {
    expect(summarizeManualHolds(plan, [held("3", "check C")])).toEqual([{ slice: "3", title: "Slice 3", gate: "check C", resumeFrom: null }]);
  });

  it("is empty when no slice is held", () => {
    expect(summarizeManualHolds(plan, [{ number: "1", status: "passed" }, { number: "2", status: "failed", statusReason: "x" }])).toEqual([]);
    expect(summarizeManualHolds(plan, [])).toEqual([]);
    expect(summarizeManualHolds({}, [held("2", "x")])).toEqual([{ slice: "2", title: "Slice 2", gate: "x", resumeFrom: null }]);
  });

  it("has nothing to continue from for a held slice the plan does not list, rather than the plan's first", () => {
    expect(summarizeManualHolds(plan, [held("9", "x")])).toEqual([{ slice: "9", title: "Slice 9", gate: "x", resumeFrom: null }]);
  });

  it("lists every held slice, in the order the results came", () => {
    expect(summarizeManualHolds(plan, [held("1", "check A"), held("2", "check B")]).map((hold) => [hold.slice, hold.resumeFrom])).toEqual([["1", "2"], ["2", "2A"]]);
  });

  it("reports what to verify and the command to continue with", () => {
    expect(manualHoldReport([{ slice: "2", title: "Deploy", gate: "check A", resumeFrom: "3" }])).toBe(
      "Slice 2 is waiting for you to verify: check A. Then continue with --resume-from 3",
    );
  });

  it("says nothing is left to run after the last slice", () => {
    expect(manualHoldReport([{ slice: "3", title: "Last", gate: "check C", resumeFrom: null }])).toBe(
      "Slice 3 is waiting for you to verify: check C. It is the last slice, so nothing is left to run",
    );
  });

  it("is empty when nothing is held", () => {
    expect(manualHoldReport([])).toBe("");
  });

  it("reports each held slice, one after another", () => {
    expect(manualHoldReport([
      { slice: "1", title: "A", gate: "check A", resumeFrom: "2" },
      { slice: "3", title: "C", gate: "check C", resumeFrom: null },
    ])).toBe(
      "Slice 1 is waiting for you to verify: check A. Then continue with --resume-from 2. "
      + "Slice 3 is waiting for you to verify: check C. It is the last slice, so nothing is left to run",
    );
  });
});

describe("a run that reaches a manual gate (#369)", () => {
  const dirs = [];
  beforeEach(() => { calls.length = 0; git.committed.length = 0; git.staged.length = 0; });
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  const sliceBlock = (number, title, gate) => [`### Slice ${number}: ${title}`, "", `1. Do part ${number}.`, "", ...gate, ""];
  const commandGate = ["**Validation Gate**", "```", "node -e \"process.exit(0)\"", "```"];

  function project(slices) {
    const cwd = mkdtempSync(join(tmpdir(), "pf-meta-369-run-"));
    dirs.push(cwd);
    const planPath = join(cwd, "Phase-9-PLAN.md");
    writeFileSync(planPath, [
      "# Phase 9 - Manual gate", "",
      "> **Status**: **HARDENED — cleared for execution.**", "",
      "## Scope Contract", "", "### In Scope", "- `src/**`", "",
      "## Execution Slices", "",
      ...slices.flatMap(([number, title, gate]) => sliceBlock(number, title, gate)),
    ].join("\n"));
    return { cwd, planPath };
  }
  const threeSlices = () => project([
    ["1", "First", commandGate],
    ["2", "Deploy", [`**Validation Gate**: [manual] ${GATE_TEXT}`]],
    ["3", "Last", commandGate],
  ]);
  const run = (cwd, planPath, extra = {}) => runPlan(planPath, { cwd, mode: "auto", manualImport: true, quorum: false, noTempering: true, ...extra });

  it("stops after the manual slice's worker finishes, and says what to verify and how to continue", async () => {
    const { cwd, planPath } = threeSlices();
    const summary = await run(cwd, planPath);

    expect(calls).toHaveLength(2);
    expect(summary.status).toBe("failed");
    expect(summary.results).toMatchObject({ passed: 1, failed: 1 });
    const held = summary.sliceResults.find((r) => String(r.number) === "2");
    expect(held).toMatchObject({ status: "failed", awaitingManualVerification: { gate: GATE_TEXT } });
    expect(held.statusReason).toMatch(/^manual-verification-required: /);
    expect(summary.awaitingManualVerification).toEqual([{ slice: "2", title: "Deploy", gate: GATE_TEXT, resumeFrom: "3" }]);
    expect(summary.report).toContain(`Slice 2 is waiting for you to verify: ${GATE_TEXT}. Then continue with --resume-from 3`);
  }, 120_000);

  it("shows the worker the manual check and leaves the plan's status header alone", async () => {
    const { cwd, planPath } = threeSlices();
    const before = readFileSync(planPath, "utf-8");
    const summary = await run(cwd, planPath);

    expect(calls[1].prompt).toContain(`Manual verification (a person does this after you finish; you cannot, so do not report it as done): ${GATE_TEXT}`);
    expect(summary.planStatusRewrite).toBeUndefined();
    expect(readFileSync(planPath, "utf-8")).toBe(before);
  }, 120_000);

  it("commits the held slice's work like a passed one, instead of only staging it as for a failure", async () => {
    const { cwd, planPath } = threeSlices();
    await run(cwd, planPath);

    expect(git.committed).toEqual(["1", "2"]);
    expect(git.staged).toEqual([]);
  }, 120_000);

  it("records the held slice as failed on disk, which is what a later run reads", async () => {
    const { cwd, planPath } = threeSlices();
    await run(cwd, planPath);

    const [runDir] = readdirSync(join(cwd, ".forge", "runs"));
    const record = JSON.parse(readFileSync(join(cwd, ".forge", "runs", runDir, "slice-2.json"), "utf-8"));
    expect(record).toMatchObject({ status: "failed", awaitingManualVerification: { gate: GATE_TEXT } });
  }, 120_000);

  it("continues from the next slice once the owner has verified, and does not claim the plan complete", async () => {
    const { cwd, planPath } = threeSlices();
    await run(cwd, planPath);
    calls.length = 0;
    const resumed = await run(cwd, planPath, { resumeFrom: 3 });

    expect(calls).toHaveLength(1);
    expect(resumed.status).toBe("completed");
    expect(resumed.awaitingManualVerification).toBeUndefined();
    expect(resumed.planStatusRewrite).toMatchObject({ rewrote: false, reason: "partial-run", uncovered: ["2"] });
  }, 240_000);

  it("holds a manual slice that is the last one, with nothing left to continue", async () => {
    const { cwd, planPath } = project([["1", "First", commandGate], ["2", "Sign-off", [`**Validation Gate**: [manual] ${GATE_TEXT}`]]]);
    const summary = await run(cwd, planPath);

    expect(summary.awaitingManualVerification).toEqual([{ slice: "2", title: "Sign-off", gate: GATE_TEXT, resumeFrom: null }]);
    expect(summary.report).toContain("It is the last slice, so nothing is left to run");
  }, 120_000);

  it("runs a plan with no manual gate exactly as before", async () => {
    const { cwd, planPath } = project([["1", "First", commandGate], ["2", "Second", commandGate]]);
    const summary = await run(cwd, planPath);

    expect(summary.status).toBe("completed");
    expect(summary.results).toMatchObject({ passed: 2, failed: 0 });
    expect(summary.awaitingManualVerification).toBeUndefined();
    expect(calls).toHaveLength(2);
  }, 120_000);

  it("does not hold a manual slice when a person drives the run", async () => {
    const { cwd, planPath } = threeSlices();
    const summary = await run(cwd, planPath, { mode: "assisted" });

    expect(calls).toHaveLength(0);
    expect(summary.status).toBe("completed");
    expect(summary.awaitingManualVerification).toBeUndefined();
    expect(summary.sliceResults.find((r) => String(r.number) === "2")).toMatchObject({ status: "passed" });
  }, 120_000);
});
