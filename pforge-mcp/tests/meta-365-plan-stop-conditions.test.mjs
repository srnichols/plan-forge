import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

import { parsePlan } from "../orchestrator/plan-parser.mjs";
import { parseStopConditions } from "../orchestrator/plan-stop-conditions.mjs";
import { appendPlanContext, buildPlanContext, buildPlanContextBlock } from "../orchestrator/prompt-builders.mjs";
import { detectWorkerBlockerReport } from "../orchestrator/worker-spawn.mjs";
import { quorumDispatch } from "../orchestrator/quorum.mjs";
import { runPlan } from "../orchestrator.mjs";

/**
 * Meta-bug #365 — the hardener's template puts a "Stop Conditions" section at
 * plan level, and the executor guidance tells a worker to re-read it, but the
 * orchestrator never sent it: a slice body ends at the next h1/h2 heading (#251),
 * so the section belongs to no slice, and the only stop text a worker received was
 * a per-slice "**Stop Condition**:" line, matched case-sensitively. 17 of the 24
 * plans in docs/plans have the section and no per-slice line, so their workers ran
 * without the plan's own halt rules, and nothing warned.
 *
 * The section now travels in the plan-context block every model that plans or
 * executes a slice receives. Real sections are bullet lists under an intro line,
 * tables of condition / reason / recovery, or prose, so it is passed through as
 * condensed lines rather than parsed into one shape.
 */

const BLOCKER = "## \u26A0 Blocker";

describe("parseStopConditions (#365)", () => {
  it("keeps the intro sentence, a bold sub-heading and the bullets, up to the next plan-level heading", () => {
    expect(parseStopConditions([
      "# Plan", "## Stop Conditions", "", "Halt if any of these fire:", "", "**Scope drift**",
      "- A file outside scope changes", "- A forbidden action is about to be introduced", "", "## Rollback", "- git revert",
    ])).toEqual([
      "Halt if any of these fire:", "**Scope drift**", "- A file outside scope changes", "- A forbidden action is about to be introduced",
    ]);
  });

  it("keeps numbered items as written", () => {
    expect(parseStopConditions(["## Stop Conditions", "1. Gate fails twice", "2) Secret found"])).toEqual(["1. Gate fails twice", "2) Secret found"]);
  });

  it("trims trailing spaces and keeps a nested bullet nested", () => {
    expect(parseStopConditions(["## Stop Conditions", "- Build fails   ", "    - on the second retry", "\t- or the third"])).toEqual([
      "- Build fails", "    - on the second retry", "\t- or the third",
    ]);
  });

  it("condenses a table row to its cells, recovery included, and drops the header and separator rows", () => {
    expect(parseStopConditions([
      "## Stop Conditions", "",
      "| Condition | Why halt | Recovery |", "|-----------|----------|----------|",
      "| **Gate fails twice** | A real regression | Roll back |",
      "| Scope violation | The guard was bypassed | Revert the slice |",
      "| Lonely cell |",
    ])).toEqual([
      "**Gate fails twice** — A real regression — Roll back",
      "Scope violation — The guard was bypassed — Revert the slice",
      "Lonely cell",
    ]);
  });

  it("keeps a row that follows a body row, and every row of a table with no leading pipe on its separator", () => {
    expect(parseStopConditions(["## Stop Conditions", "| H1 | H2 |", "|---|---|", "| a | b |", "| c | d |", "| e | f |"])).toEqual([
      "a — b", "c — d", "e — f",
    ]);
  });

  it("reads a table with alignment colons in its separator, and a row of empty cells as nothing", () => {
    expect(parseStopConditions(["## Stop Conditions", "| A | B |", "|:--|--:|", "| one | two |", "| | |"])).toEqual(["one — two"]);
  });

  it("keeps prose when the section has no list", () => {
    expect(parseStopConditions(["## Stop Conditions", "Stop if the migration touches an unnamed table.", "", "Stop if a gate fails twice."])).toEqual([
      "Stop if the migration touches an unnamed table.", "Stop if a gate fails twice.",
    ]);
  });

  it("keeps a deeper heading as written, and drops rules", () => {
    expect(parseStopConditions(["## Stop Conditions", "### Build failures", "- Gate fails twice", "---", "***", "- - -", "___", "### Security", "- Secret found"])).toEqual([
      "### Build failures", "- Gate fails twice", "### Security", "- Secret found",
    ]);
  });

  it("does not take a dash prefix or bold text for a rule", () => {
    expect(parseStopConditions(["## Stop Conditions", "-- not a rule", "**bold**", "- - real bullet"])).toEqual(["-- not a rule", "**bold**", "- - real bullet"]);
  });

  it.each([
    ["a singular heading", "## Stop Condition"],
    ["upper case", "## STOP CONDITIONS"],
    ["a suffix", "## Stop Conditions & Rollback"],
    ["a first-level heading", "# Stop Conditions"],
    ["extra spaces", "##   Stop   Conditions"],
  ])("recognises %s", (_name, heading) => {
    expect(parseStopConditions([heading, "- Halt on a failed gate"])).toEqual(["- Halt on a failed gate"]);
  });

  it.each([
    ["a deeper heading", "### Stop Conditions"],
    ["a longer first word", "## Non-Stop Conditions"],
    ["a different word", "## Stopping rules"],
    ["only the first word", "## Stop"],
  ])("does not take %s for the section", (_name, heading) => {
    expect(parseStopConditions([heading, "- Not a stop condition"])).toEqual([]);
  });

  it("joins every Stop Conditions section of the plan, in order", () => {
    expect(parseStopConditions(["## Stop Conditions", "- first", "## Slices", "- not this", "## Stop Conditions", "- second"])).toEqual(["- first", "- second"]);
  });

  it("ignores a heading inside a code fence, and keeps the lines of a fence inside the section", () => {
    expect(parseStopConditions(["```md", "## Stop Conditions", "- an example, not the section", "```", "## Stop Conditions", "- real"])).toEqual(["- real"]);
    expect(parseStopConditions(["## Stop Conditions", "- Run this and stop if it fails:", "```bash", "# check the build", "npm test", "```", "- Otherwise carry on"])).toEqual([
      "- Run this and stop if it fails:", "# check the build", "npm test", "- Otherwise carry on",
    ]);
  });

  it("returns nothing for a plan without the section, and for an empty one", () => {
    expect(parseStopConditions(["# Plan", "## Scope Contract", "- x"])).toEqual([]);
    expect(parseStopConditions(["## Stop Conditions", "", "   ", "## Next"])).toEqual([]);
    expect(parseStopConditions([])).toEqual([]);
  });
});

describe("parsePlan carries the section (#365)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-365-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const GATE = ["", "**Validation Gate**:", "```bash", "npm test", "```", ""];
  function parse(...body) {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, ["# Plan", "## Scope Contract", "### In Scope", "- Something", ...body].join("\n"));
    return parsePlan(planPath, dir);
  }

  it("lists the plan-level stop conditions and leaves each slice's own line alone", () => {
    const plan = parse(
      "## Execution Slices", "### Slice 1: Work", "**Stop Condition**: stop for slice 1", "1. Do it", ...GATE,
      "## Stop Conditions", "Halt if:", "- the migration touches a table not in scope", "",
    );
    expect(plan.stopConditions).toEqual(["Halt if:", "- the migration touches a table not in scope"]);
    expect(plan.slices[0].stopCondition).toBe("stop for slice 1");
  });

  it("does not turn a Stop Condition label inside the plan-level section into a slice's", () => {
    const plan = parse("## Execution Slices", "### Slice 1: Work", "1. Do it", ...GATE, "## Stop Conditions", "**Stop Condition**: plan-level text");
    expect(plan.slices[0].stopCondition).toBeNull();
    expect(plan.stopConditions).toEqual(["**Stop Condition**: plan-level text"]);
  });

  it("is an empty list for a plan without the section", () => {
    expect(parse("## Execution Slices", "### Slice 1: Work", "1. Do it", ...GATE).stopConditions).toEqual([]);
  });

  it("reads a file with Windows line endings", () => {
    const planPath = join(dir, "crlf.md");
    writeFileSync(planPath, ["# Plan", "## Execution Slices", "### Slice 1: Work", "1. Do it", ...GATE, "## Stop Conditions", "- halt on a failed gate"].join("\r\n"));
    expect(parsePlan(planPath, dir).stopConditions).toEqual(["- halt on a failed gate"]);
  });
});

describe("the same-line Stop Condition label (#365)", () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pf-meta-365-label-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const stopOf = (...body) => {
    const planPath = join(dir, "plan.md");
    writeFileSync(planPath, ["# Plan", "## Execution Slices", "### Slice 1: Work", ...body, "1. Do it", "", "**Validation Gate**:", "```bash", "npm test", "```"].join("\n"));
    return parsePlan(planPath, dir).slices[0].stopCondition;
  };

  it.each([
    "**Stop Condition**: stop A",
    "**Stop Conditions**: stop A",
    "**Stop condition**: stop A",
    "**STOP CONDITION**: stop A",
    "**Stop Condition:** stop A",
    "**Stop Conditions:** stop A",
    "- **Stop Condition**: stop A",
    "  **Stop condition:**   stop A  ",
  ])("reads %j", (line) => {
    expect(stopOf(line)).toBe("stop A");
  });

  it("does not read a line that only mentions stop conditions, or a label with nothing after it", () => {
    expect(stopOf("The stop conditions below apply to this slice.")).toBeNull();
    expect(stopOf("**Stop Condition**:")).toBeNull();
    expect(stopOf("**Stop Condition**:   ")).toBeNull();
  });
});

describe("the plan context carries the stop conditions (#365)", () => {
  const slice = { number: "1", title: "Wire it", contextFiles: [] };
  const withStops = (stopConditions, extra = {}) => ({ planFile: null, forbidden: [], hasSharedContract: false, stopConditions, ...extra });

  it("takes the lines from the plan and drops placeholders", () => {
    expect(buildPlanContext({ plan: { stopConditions: ["Halt if:", "- gate fails twice"] }, planPath: "plan.md", cwd: process.cwd() }).stopConditions).toEqual([
      "Halt if:", "- gate fails twice",
    ]);
    expect(buildPlanContext({ plan: { stopConditions: ["None", "- None", "N/A", "- n/a.", "TBD", "- gate fails"] }, planPath: "plan.md", cwd: process.cwd() }).stopConditions).toEqual(["- gate fails"]);
    expect(buildPlanContext({ plan: {}, planPath: "plan.md", cwd: process.cwd() }).stopConditions).toEqual([]);
  });

  it("renders them under a heading that says what to do, after the Forbidden items", () => {
    const block = buildPlanContextBlock(slice, withStops(["Halt if:", "- gate fails twice"], { forbidden: ["Editing `package.json`"] }));
    expect(block).toContain("Stop conditions from the plan");
    expect(block).toMatch(/do not work around it/);
    expect(block).toMatch(/follow the recovery the plan gives/);
    expect(block).toMatch(/\n\s*Halt if:\n- gate fails twice\n--- END PLAN CONTEXT ---$/);
    expect(block.indexOf("Forbidden by the plan")).toBeLessThan(block.indexOf("Stop conditions from the plan"));
  });

  it("keeps the lines as the plan wrote them, a nested bullet still nested", () => {
    const block = buildPlanContextBlock(slice, withStops(["- Gate fails twice:", "    - on the same slice", "**Scope**"]));
    expect(block).toContain("\n- Gate fails twice:\n    - on the same slice\n**Scope**\n");
  });

  it("asks for the Blocker Report the orchestrator recognises, so a stop is not recorded as a pass", () => {
    const block = buildPlanContextBlock(slice, withStops(["- gate fails twice"]));
    expect(block).toContain(BLOCKER);
    expect(block).toContain("**Problem:**");
    const reason = detectWorkerBlockerReport({ worker: "w", output: `${BLOCKER}\n\n**Problem:** the gate failed twice` }, "auto");
    expect(reason).toMatch(/reported a Blocker .*the gate failed twice/);
  });

  it("adds nothing when the plan has no stop conditions", () => {
    expect(buildPlanContextBlock(slice, withStops([]))).toBe("");
    expect(buildPlanContextBlock(slice, { planFile: null, forbidden: [], hasSharedContract: false })).toBe("");
  });

  it("is the whole block for a slice with no context files and a plan with nothing else", () => {
    const prompt = appendPlanContext("Execute Slice 1: Wire it", slice, withStops(["- gate fails twice"]));
    expect(prompt.startsWith("Execute Slice 1: Wire it\n\n--- PLAN CONTEXT ---")).toBe(true);
    expect(prompt).toContain("- gate fails twice");
  });

  it("clips a long line to 600 characters", () => {
    const block = buildPlanContextBlock(slice, withStops([`- ${"x".repeat(900)}`]));
    const line = block.split("\n").find((l) => l.startsWith("- xxx"));
    expect(line.length).toBe(600);
    expect(line.endsWith("…")).toBe(true);
  });

  it("keeps the longest line the plans in use have, whole", () => {
    const row = `**A condition of the longest kind** — ${"w".repeat(470)}`;
    expect(row.length).toBeGreaterThan(500);
    expect(buildPlanContextBlock(slice, withStops([row]))).toContain(`\n${row}\n`);
  });

  it("holds the section to 4,000 characters and says how much it left out", () => {
    const lines = Array.from({ length: 60 }, (_v, i) => `- condition ${String(i).padStart(2, "0")} ${"y".repeat(88)}`);
    const block = buildPlanContextBlock(slice, withStops(lines));
    const kept = block.split("\n").filter((l) => l.startsWith("- condition"));
    expect(kept).toHaveLength(Math.floor(4000 / lines[0].length));
    expect(kept.join("").length).toBeLessThanOrEqual(4000);
    expect(block).toContain(`(+${lines.length - kept.length} more lines in the plan's Stop Conditions section)`);
    expect(kept[0]).toContain("condition 00");
  });

  it("does not mention what it left out when everything fits", () => {
    expect(buildPlanContextBlock(slice, withStops(["- a", "- b"]))).not.toMatch(/more lines/);
  });
});

describe("a run hands every model that sees the slice the stop conditions (#365)", () => {
  const dirs = [];
  beforeEach(() => { calls.length = 0; });
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
  });

  function project() {
    const cwd = mkdtempSync(join(tmpdir(), "pf-meta-365-run-"));
    dirs.push(cwd);
    const planPath = join(cwd, "Phase-9-PLAN.md");
    writeFileSync(planPath, [
      "# Phase 9 - Stop conditions", "",
      "> **Status**: **HARDENED — cleared for execution.**", "",
      "## Scope Contract", "", "### In Scope", "- `src/**`", "",
      "## Execution Slices", "",
      "### Slice 1: First", "", "1. Build the first part.", "",
      "**Validation Gate**", "```", "node -e \"process.exit(0)\"", "```", "",
      "## Stop Conditions", "", "Halt if any of these fire:", "",
      "| Condition | Why halt | Recovery |", "|---|---|---|",
      "| **The migration touches a table not named in scope** | Data loss risk | Revert |", "",
    ].join("\n"));
    return { cwd, planPath };
  }

  const expectStops = (prompt) => {
    expect(prompt).toContain("--- PLAN CONTEXT ---");
    expect(prompt).toContain("Stop conditions from the plan");
    expect(prompt).toContain("Halt if any of these fire:");
    expect(prompt).toContain("**The migration touches a table not named in scope** — Data loss risk");
    expect(prompt).not.toContain("|---|");
  };

  it("gives the worker the section, with its table condensed", async () => {
    const { cwd, planPath } = project();
    await runPlan(planPath, { cwd, mode: "auto", manualImport: true, quorum: false, noTempering: true });

    expect(calls).toHaveLength(1);
    expectStops(calls[0].prompt);
  }, 120_000);

  it("covers the dry-run legs, the reviewer and the executor of a quorum run", async () => {
    const { cwd, planPath } = project();
    await runPlan(planPath, { cwd, mode: "auto", manualImport: true, quorum: true, noTempering: true });

    const legs = calls.filter((c) => c.role === "quorum-dry-run").map((c) => c.prompt);
    const reviewer = calls.filter((c) => c.role === "reviewer").map((c) => c.prompt);
    const executor = calls.filter((c) => c.role !== "quorum-dry-run" && c.role !== "reviewer").map((c) => c.prompt);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    expect(reviewer).toHaveLength(1);
    expect(executor.length).toBeGreaterThanOrEqual(1);
    for (const prompt of [...legs, ...reviewer, ...executor]) expectStops(prompt);
  }, 120_000);

  it("reaches a quorum leg directly, through the plan context", async () => {
    const stopSlice = { number: "1", title: "Build it", tasks: ["Build the first part."] };
    await quorumDispatch(stopSlice, { models: ["model-a", "model-b"], reviewerModel: "model-r", dryRunTimeout: 5_000 }, {
      cwd: process.cwd(), planContext: withPlanStops(["- gate fails twice"]),
    });
    const legs = calls.filter((c) => c.role === "quorum-dry-run");
    expect(legs).toHaveLength(2);
    for (const { prompt } of legs) expect(prompt).toContain("- gate fails twice");
  });
});

function withPlanStops(stopConditions) {
  return { planFile: null, forbidden: [], hasSharedContract: false, stopConditions };
}
