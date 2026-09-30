/**
 * Meta-bug #281 — lintGateCommands reported 0 errors and 0 warnings for a plan
 * whose gates sat in ```text fences and whose tasks were plain bullets.
 * parsePlan found every slice but extracted `tasks: []` and
 * `validationGate: null`, so a lint-clean plan could launch workers with no
 * gate and no instructions.
 *
 * The lint now judges the parsed slices themselves:
 *   - gate declared but nothing runnable parsed → error (blocks run-plan pre-flight)
 *   - no numbered tasks                         → warning (the worker receives
 *                                                  only title, scope and gate)
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lintGateCommands } from "../orchestrator/gate-helpers.mjs";
import { parsePlan } from "../orchestrator/plan-parser.mjs";

const tmpDirs = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function writePlan(body) {
  const dir = mkdtempSync(join(tmpdir(), "pf-meta-281-"));
  tmpDirs.push(dir);
  const planPath = join(dir, "Phase-1-FIXTURE-PLAN.md");
  writeFileSync(planPath, body);
  return { dir, planPath };
}

function slicePlan({ tasks = ["1. Add the endpoint.", "2. Cover it with a test."], gateBlock = ["```bash", "npm test", "```"], gateLabel = "**Validation Gate**:" } = {}) {
  return [
    "# Phase 1 — Fixture",
    "",
    "## Execution Slices",
    "",
    "### Slice 1 — Endpoint",
    "",
    "**Scope** (files in scope):",
    "- `src/endpoint.ts`",
    "",
    ...tasks,
    "",
    gateLabel,
    ...gateBlock,
    "",
  ].join("\n");
}

const rules = (findings) => findings.map((f) => f.rule);

describe("lint judges the slices parsePlan actually produced (meta #281)", () => {
  it("fails a slice whose declared gate sits in a ```text fence", () => {
    const { dir, planPath } = writePlan(slicePlan({ gateBlock: ["```text", "npm test", "```"] }));
    expect(parsePlan(planPath, dir).slices[0].validationGate).toBeNull();

    const result = lintGateCommands(planPath, dir);
    expect(result.passed).toBe(false);
    const finding = result.errors.find((e) => e.rule === "gate-declared-not-runnable");
    expect(finding, JSON.stringify(result.errors)).toBeDefined();
    expect(finding.slice).toBe("1");
    expect(finding.message).toMatch(/no runnable gate command/);
    expect(finding.message).toMatch(/```text fences and prose are never executed/);
  });

  it("fails a slice whose gate is only prose, quoting the gate text", () => {
    const { dir, planPath } = writePlan(slicePlan({ gateLabel: "**Validation Gate**: all endpoint tests pass", gateBlock: [] }));
    const result = lintGateCommands(planPath, dir);
    expect(result.passed).toBe(false);
    const finding = result.errors.find((e) => e.rule === "gate-declared-not-runnable");
    expect(finding.message).toContain('gate text: "all endpoint tests pass"');
  });

  it("accepts an explicit [manual] gate, the step-2 convention for unautomatable checks", () => {
    const { dir, planPath } = writePlan(slicePlan({ gateLabel: "**Validation Gate**: [manual] UI layout matches mockup", gateBlock: [] }));
    const result = lintGateCommands(planPath, dir);
    expect(rules(result.errors)).not.toContain("gate-declared-not-runnable");
  });

  it("warns when a slice's tasks are bullets the worker prompt never receives", () => {
    const { dir, planPath } = writePlan(slicePlan({ tasks: ["- Add the endpoint.", "- Cover it with a test."] }));
    expect(parsePlan(planPath, dir).slices[0].tasks).toEqual([]);

    const result = lintGateCommands(planPath, dir);
    expect(result.passed).toBe(true);
    const finding = result.warnings.find((w) => w.rule === "no-numbered-tasks");
    expect(finding, JSON.stringify(result.warnings)).toBeDefined();
    expect(finding.message).toMatch(/receives just the title, scope and gate/);
  });

  it("reports both defects of the originally reported plan shape", () => {
    const { dir, planPath } = writePlan(slicePlan({
      tasks: ["Implement the endpoint and cover it with a test."],
      gateBlock: ["```text", "npx tsc --noEmit", "npm test", "```"],
    }));
    const result = lintGateCommands(planPath, dir);
    expect(result.passed).toBe(false);
    expect(rules(result.errors)).toContain("gate-declared-not-runnable");
    expect(rules(result.warnings)).toContain("no-numbered-tasks");
  });

  it("stays clean once the slice uses numbered tasks and a shell fence", () => {
    const { dir, planPath } = writePlan(slicePlan());
    const result = lintGateCommands(planPath, dir);
    expect(result.passed).toBe(true);
    expect(rules(result.errors)).not.toContain("gate-declared-not-runnable");
    expect(rules(result.warnings)).not.toContain("no-numbered-tasks");
  });

  it("does not judge gate-only fixtures that carry no parsed tasks array", () => {
    const result = lintGateCommands({ slices: [{ number: "1", title: "T", validationGate: "npm test" }] });
    expect(rules(result.warnings)).not.toContain("no-numbered-tasks");
    expect(result.passed).toBe(true);
  });
});
