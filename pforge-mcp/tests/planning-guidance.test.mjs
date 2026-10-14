import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const stages = [
  {
    stage: "specification",
    prompt: "step0-specify-feature.prompt.md",
    agent: "specifier.agent.md",
    required: ["Domain Language", "Decision Ledger", "Depends on", "Rationale / evidence", "bounded context"],
  },
  {
    stage: "hardening",
    prompt: "step2-harden-plan.prompt.md",
    agent: "plan-hardener.agent.md",
    required: ["Decision Ledger", "reopen dependent decisions", "Contract Refs", "Decision Refs", "Language Ref", "approval evidence", "not runtime enforcement"],
  },
  {
    stage: "execution",
    prompt: "step3-execute-slice.prompt.md",
    agent: "executor.agent.md",
    required: ["Contract Refs", "Decision Refs", "Language Ref", "approval evidence", "stale", "not runtime enforcement"],
  },
  {
    stage: "review",
    prompt: "step5-review-gate.prompt.md",
    agent: "reviewer-gate.agent.md",
    required: ["Contract Refs", "Domain Language", "Deep modules", "Design Concerns", "Revisit trigger", "not runtime enforcement", "blocking verification gap"],
  },
];
const guidance = stages.flatMap(({ stage, prompt, agent, required }) => [
  join(ROOT, ".github", "prompts", prompt),
  join(ROOT, "templates", ".github", "agents", agent),
  join(ROOT, "plugins", "plan-forge", "com.github.copilot", "agents", agent),
].map((file) => ({ file, name: relative(ROOT, file), stage, required })));
const architectureInstructions = [
  join(ROOT, ".github", "instructions", "architecture-principles.instructions.md"),
  join(ROOT, "presets", "shared", ".github", "instructions", "architecture-principles.instructions.md"),
].map((file) => ({ file, name: relative(ROOT, file) }));
const handoffInstructions = [
  join(ROOT, ".github", "instructions", "status-reporting.instructions.md"),
  join(ROOT, "presets", "shared", ".github", "instructions", "status-reporting.instructions.md"),
].map((file) => ({ file, name: relative(ROOT, file) }));
const DESIGN_CONTEXT_FIELDS = [
  "Decision Ledger",
  "Domain Language",
  "C-001@r1",
  "D-001@r1",
  "L-001@r1",
  "approval evidence",
  "not runtime enforcement",
];

describe("Guard: design context survives every pipeline entry point", () => {
  it.each(guidance)("$name preserves $stage design context", ({ file, required }) => {
    const source = readFileSync(file, "utf8");
    expect(required.filter((marker) => !source.includes(marker))).toEqual([]);
  });
});

describe("Guard: project and consumer instructions define the same design context", () => {
  it.each(architectureInstructions)("$name defines versioned references without claiming runtime enforcement", ({ file }) => {
    const source = readFileSync(file, "utf8");
    expect(DESIGN_CONTEXT_FIELDS.filter((marker) => !source.includes(marker))).toEqual([]);
    expect(source).toContain("private helper");
    expect(source).toContain("reopen dependent decisions");
  });
});

describe("Guard: copy-paste runbook retains design context and read-only feedback", () => {
  it("requires the same references and scoped feedback as the pipeline agents", () => {
    const source = readFileSync(join(ROOT, "docs", "plans", "AI-Plan-Hardening-Runbook-Instructions.md"), "utf8");
    const required = ["Contract Refs", "Decision Refs", "Language Ref", "Design Concerns", "not runtime enforcement"];
    expect(required.filter((marker) => !source.includes(marker))).toEqual([]);
  });
});

describe("Guard: handoff summaries preserve requested design revisions", () => {
  it.each(handoffInstructions)("$name includes context references and approval evidence", ({ file }) => {
    const source = readFileSync(file, "utf8");
    const required = ["**Contract Refs:**", "**Decision Refs:**", "**Language Ref:**", "**Approval evidence:**", "not runtime enforcement"];
    expect(required.filter((marker) => !source.includes(marker))).toEqual([]);
  });
});
