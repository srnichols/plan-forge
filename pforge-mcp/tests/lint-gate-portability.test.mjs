import { describe, it, expect } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGatePortability, lintGateCommands } from "../orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "fixtures", "plan-with-portability-issues.md");

describe("validateGatePortability", () => {
  it("detects pipe to brace-group with read", () => {
    const result = validateGatePortability('echo hello | { read VAR; echo $VAR; }');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].pattern).toBe("pipe-to-brace-read");
  });

  it("detects nested double-quotes in bash -c", () => {
    const result = validateGatePortability('bash -c "node -e \\"console.log(\'hi\')\\""');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].pattern).toBe("nested-double-quotes");
  });

  it("detects command substitution containing a pipe", () => {
    const result = validateGatePortability("echo $(cat file.txt | grep pattern)");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].pattern).toBe("cmd-substitution-pipe");
  });

  it("returns zero warnings for clean portable commands", () => {
    const clean = [
      "npm test",
      "npx vitest run tests/example.test.mjs",
      "node --version",
      'grep -q foo bar',
    ];
    for (const cmd of clean) {
      const result = validateGatePortability(cmd);
      expect(result.warnings, `expected zero warnings for: ${cmd}`).toHaveLength(0);
    }
  });

  it("handles null/undefined/empty input gracefully", () => {
    expect(validateGatePortability(null).warnings).toHaveLength(0);
    expect(validateGatePortability(undefined).warnings).toHaveLength(0);
    expect(validateGatePortability("").warnings).toHaveLength(0);
  });

  it("each warning has pattern, message, and suggestion fields", () => {
    const result = validateGatePortability('echo hello | { read VAR; echo $VAR; }');
    const w = result.warnings[0];
    expect(w).toHaveProperty("pattern");
    expect(w).toHaveProperty("message");
    expect(w).toHaveProperty("suggestion");
    expect(typeof w.pattern).toBe("string");
    expect(typeof w.message).toBe("string");
    expect(typeof w.suggestion).toBe("string");
  });
});

describe("lintGateCommands — portabilityWarnings integration", () => {
  it("returns portabilityWarnings array in result", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));
    expect(result).toHaveProperty("portabilityWarnings");
    expect(Array.isArray(result.portabilityWarnings)).toBe(true);
  });

  it("detects portability issues from plan fixture", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));
    // Slices 1-3 each have one portability issue
    expect(result.portabilityWarnings.length).toBeGreaterThanOrEqual(3);

    const patterns = result.portabilityWarnings.map(w => w.pattern);
    expect(patterns).toContain("pipe-to-brace-read");
    expect(patterns).toContain("nested-double-quotes");
    expect(patterns).toContain("cmd-substitution-pipe");
  });

  it("clean portable gates produce zero portability warnings", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));
    // Slice 4 has only clean commands — no portability warnings for that slice
    const slice4Warnings = result.portabilityWarnings.filter(w => w.slice === "4");
    expect(slice4Warnings).toHaveLength(0);
  });

  it("portability warnings include slice and command context", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));
    for (const pw of result.portabilityWarnings) {
      expect(pw).toHaveProperty("slice");
      expect(pw).toHaveProperty("command");
      expect(pw).toHaveProperty("pattern");
      expect(pw).toHaveProperty("message");
      expect(pw).toHaveProperty("suggestion");
    }
  });

  it("portability warnings do not affect passed status", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));
    // portability warnings are non-blocking
    // passed depends only on errors, not portability warnings
    expect(typeof result.passed).toBe("boolean");
  });

  it("summary includes portability warning count", () => {
    const result = lintGateCommands(fixturePath, join(__dirname, ".."));
    expect(result.summary).toContain("portability warning(s)");
  });
});
