// Meta-bug #89 regression guard:
// Plan parser must optionally capture bare bash/sh code blocks under a
// slice header as implicit validation gates when
// runtime.planParser.implicitGates is enabled, AND must count shell
// blocks per slice for downstream lint/analysis. Default behaviour must
// remain unchanged so existing plans are unaffected.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ORCHESTRATOR = readFileSync(
  resolve(__dirname, "..", "orchestrator.mjs"),
  "utf-8"
);

describe("orchestrator — meta-bug #89 plan-parser hardening", () => {
  it("parseSlices accepts an opts object with implicitGates flag", () => {
    expect(ORCHESTRATOR).toMatch(/function\s+parseSlices\s*\(\s*lines\s*,\s*opts\s*=\s*{}\s*\)/);
    expect(ORCHESTRATOR).toMatch(/const\s+implicitGates\s*=\s*opts\.implicitGates\s*===\s*true/);
  });

  it("captures bash/sh fence language on opening code block", () => {
    expect(ORCHESTRATOR).toMatch(/const\s+lang\s*=\s*line\.slice\(\s*3\s*\)\.trim\(\)\.toLowerCase\(\)/);
    expect(ORCHESTRATOR).toMatch(/isShellLang\s*=\s*lang\s*===\s*"bash"\s*\|\|\s*lang\s*===\s*"sh"/);
  });

  it("tracks bash-block count on each slice for analyzer lint", () => {
    expect(ORCHESTRATOR).toMatch(/current\._bashBlockCount\s*=\s*\(current\._bashBlockCount\s*\|\|\s*0\)\s*\+\s*1/);
  });

  it("marks implicit gates distinctly from explicit ones", () => {
    expect(ORCHESTRATOR).toMatch(/current\.implicitGate\s*=\s*true/);
  });

  it("activates implicit gate only when config opt-in AND no existing gate", () => {
    // The guard must test implicitGates flag AND absence of prior gate.
    expect(ORCHESTRATOR).toMatch(
      /if\s*\(\s*implicitGates\s*&&\s*!current\.validationGate\s*&&\s*!inValidationGate\s*\)/
    );
  });

  it("loads runtime.planParser config with safe defaults", () => {
    expect(ORCHESTRATOR).toMatch(/function\s+loadPlanParserConfig\s*\(/);
    expect(ORCHESTRATOR).toMatch(/runtime\?\.planParser/);
    // Default must be false — opt-in only.
    expect(ORCHESTRATOR).toMatch(
      /defaults\s*=\s*{\s*implicitGates:\s*false\s*}/
    );
  });

  it("parsePlan threads parser config into parseSlices", () => {
    expect(ORCHESTRATOR).toMatch(/parseSlices\(\s*lines\s*,\s*{\s*implicitGates:\s*parserCfg\.implicitGates\s*}\s*\)/);
  });
});
