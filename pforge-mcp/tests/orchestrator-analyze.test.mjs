// Phase-31 Slice 2 — plan-parser lint in runAnalyze.
// Verifies that runAnalyze emits ADVISORY lines for plan slices that have
// bash code blocks but no **Validation Gate**: marker, and that the advisory
// is suppressed when runtime.planParser.implicitGates is true (because the
// bash block is captured as the gate during parsing, so validationGate is set).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runAnalyze } from "../orchestrator.mjs";

// Minimal plan with one slice that has a bash block but no validation gate.
const PLAN_BASH_NO_GATE = [
  "# Test Plan",
  "",
  "### Slice 1: Test Slice",
  "",
  "Some content.",
  "",
  "```bash",
  'echo "hello"',
  "```",
  "",
].join("\n");

// Minimal plan with one slice that has a bash block AND an explicit validation gate.
const PLAN_BASH_WITH_GATE = [
  "# Test Plan",
  "",
  "### Slice 1: Good Slice",
  "",
  "Some content.",
  "",
  "**Validation Gate**:",
  "```bash",
  'echo "hello"',
  "```",
  "",
].join("\n");

// Plan with no bash blocks at all — advisory must not fire.
const PLAN_NO_BASH = [
  "# Test Plan",
  "",
  "### Slice 1: No-Bash Slice",
  "",
  "Just prose, no code blocks.",
  "",
].join("\n");

describe("runAnalyze — plan-parser lint advisories", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pforge-analyze-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits advisory for a slice with a bash block and no validation gate", async () => {
    writeFileSync(join(tmpDir, "plan.md"), PLAN_BASH_NO_GATE);
    const result = await runAnalyze({ planPath: "plan.md", cwd: tmpDir });
    expect(Array.isArray(result.advisories)).toBe(true);
    expect(result.advisories).toHaveLength(1);
    expect(result.advisories[0]).toMatch(/ADVISORY plan-parser-gate-missing/);
    expect(result.advisories[0]).toMatch(/Slice 1/);
    expect(result.advisories[0]).toMatch(/Test Slice/);
    expect(result.advisories[0]).toMatch(/1 bash block/);
  });

  it("suppresses advisory when runtime.planParser.implicitGates is true", async () => {
    writeFileSync(join(tmpDir, "plan.md"), PLAN_BASH_NO_GATE);
    // implicitGates=true causes parseSlices to capture the bare bash block as the
    // validationGate, so !slice.validationGate is false and no advisory fires.
    writeFileSync(
      join(tmpDir, ".forge.json"),
      JSON.stringify({ runtime: { planParser: { implicitGates: true } } })
    );
    const result = await runAnalyze({ planPath: "plan.md", cwd: tmpDir });
    expect(result.advisories).toHaveLength(0);
  });

  it("emits no advisory when an explicit validation gate is declared", async () => {
    writeFileSync(join(tmpDir, "plan.md"), PLAN_BASH_WITH_GATE);
    const result = await runAnalyze({ planPath: "plan.md", cwd: tmpDir });
    expect(result.advisories).toHaveLength(0);
  });

  it("emits no advisory when the slice has no bash blocks", async () => {
    writeFileSync(join(tmpDir, "plan.md"), PLAN_NO_BASH);
    const result = await runAnalyze({ planPath: "plan.md", cwd: tmpDir });
    expect(result.advisories).toHaveLength(0);
  });

  it("returns empty advisories array when no planPath is provided", async () => {
    const result = await runAnalyze({ cwd: tmpDir });
    expect(Array.isArray(result.advisories)).toBe(true);
    expect(result.advisories).toHaveLength(0);
  });
});
