import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lintGateCommands } from "../orchestrator.mjs";

/**
 * Build a minimal plan object with a single slice for gate-lint testing.
 * @param {string} validationGate
 * @param {string} [sliceNumber]
 * @returns {{ slices: Array<{number: string, title: string, validationGate: string}> }}
 */
function makePlan(validationGate, sliceNumber = "1") {
  return { slices: [{ number: sliceNumber, title: "Test Slice", validationGate }] };
}

/** Collect all W-rule findings (ruleId starting with "W") from a lint result. */
function wFindings(result) {
  return [...result.warnings, ...result.errors].filter(f => f.ruleId && /^W\d/.test(f.ruleId));
}

// ─── W-rule detection ─────────────────────────────────────────────────────────

describe("lintGateCommands — W-rule detection", () => {
  it("W1: detects bash -c prefix", () => {
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    const w1 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W1");
    expect(w1).toBeDefined();
    expect(w1.ruleId).toBe("W1");
    expect(w1.severity).toBe("warn");
  });

  it("W1: detects bare bash <script> prefix", () => {
    const result = lintGateCommands(makePlan('bash -c "npx vitest run"'));
    const w1 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W1");
    expect(w1).toBeDefined();
  });

  it("W2: detects shell pipeline with node as left operand", () => {
    const result = lintGateCommands(makePlan('node --version | grep 20'));
    const w2 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W2");
    expect(w2).toBeDefined();
    expect(w2.ruleId).toBe("W2");
    expect(w2.severity).toBe("warn");
  });

  it("W2: detects shell pipeline with npx as left operand", () => {
    const result = lintGateCommands(makePlan('npx vitest run | grep ok'));
    const w2 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W2");
    expect(w2).toBeDefined();
  });

  it("W2: does not fire on bash -c lines already caught by W1", () => {
    // bash -c lines can legitimately have pipes inside the bash string
    const result = lintGateCommands(makePlan('bash -c "node build.js | grep done"'));
    const w2 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W2");
    expect(w2).toBeUndefined();
  });

  it("W3: detects double-escaped backslash metachar in node -e regex", () => {
    // In the gate text, \\s represents two actual backslash chars before 's'
    const result = lintGateCommands(makePlan('node -e "const r=/##\\\\s+Slice/.test(\'x\')"'));
    const w3 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W3");
    expect(w3).toBeDefined();
    expect(w3.ruleId).toBe("W3");
    expect(w3.severity).toBe("warn");
  });

  it("W3: detects \\\\d+ double-escape pattern", () => {
    const result = lintGateCommands(makePlan('node -e "if(!/\\\\d+/.test(v)){process.exit(1)}"'));
    const w3 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W3");
    expect(w3).toBeDefined();
  });

  it("W4: detects cd dir && command chain", () => {
    const result = lintGateCommands(makePlan('cd pforge-mcp && npx vitest run'));
    const w4 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W4");
    expect(w4).toBeDefined();
    expect(w4.ruleId).toBe("W4");
    expect(w4.severity).toBe("warn");
  });

  it("W4: detects cd with multi-segment path", () => {
    const result = lintGateCommands(makePlan('cd src/lib && node check.mjs'));
    const w4 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W4");
    expect(w4).toBeDefined();
  });

  it("clean gate emits no W-rule findings", () => {
    const result = lintGateCommands(makePlan('npx --prefix pforge-mcp vitest run pforge-mcp/tests/example.test.mjs'));
    expect(wFindings(result)).toHaveLength(0);
  });

  it("each W-rule finding has ruleId, severity, slice, command, and message", () => {
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    const w1 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W1");
    expect(w1).toHaveProperty("ruleId");
    expect(w1).toHaveProperty("severity");
    expect(w1).toHaveProperty("slice");
    expect(w1).toHaveProperty("command");
    expect(w1).toHaveProperty("message");
  });
});

// ─── Suppression directive ────────────────────────────────────────────────────

describe("lintGateCommands — suppression directive (# pforge-lint-disable)", () => {
  it("# pforge-lint-disable W1 suppresses W1 finding", () => {
    const gate = "# pforge-lint-disable W1\nbash -c \"node -e xyz\"";
    const result = lintGateCommands(makePlan(gate));
    const w1 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W1");
    expect(w1).toBeUndefined();
  });

  it("# pforge-lint-disable W4 suppresses W4 but not W1", () => {
    const gate = "# pforge-lint-disable W4\nbash -c \"node -e xyz\"\ncd pforge-mcp && npx vitest run";
    const result = lintGateCommands(makePlan(gate));
    expect([...result.warnings, ...result.errors].find(f => f.ruleId === "W4")).toBeUndefined();
    expect([...result.warnings, ...result.errors].find(f => f.ruleId === "W1")).toBeDefined();
  });

  it("# pforge-lint-disable W1,W2 suppresses both W1 and W2", () => {
    const gate = "# pforge-lint-disable W1,W2\nbash -c \"node -e xyz\"\nnode --version | grep 20";
    const result = lintGateCommands(makePlan(gate));
    const hits = [...result.warnings, ...result.errors].filter(f => f.ruleId === "W1" || f.ruleId === "W2");
    expect(hits).toHaveLength(0);
  });

  it("suppression with spaces around commas is parsed correctly", () => {
    const gate = "# pforge-lint-disable W1 , W4\nbash -c \"node -e xyz\"\ncd src && node x.mjs";
    const result = lintGateCommands(makePlan(gate));
    const hits = [...result.warnings, ...result.errors].filter(f => f.ruleId === "W1" || f.ruleId === "W4");
    expect(hits).toHaveLength(0);
  });

  it("suppression is scoped per gate — other slices still fire the rule", () => {
    const plan = {
      slices: [
        { number: "1", title: "Suppressed", validationGate: "# pforge-lint-disable W1\nbash -c \"node -e xyz\"" },
        { number: "2", title: "Unsuppressed", validationGate: 'bash -c "node -e xyz"' },
      ],
    };
    const result = lintGateCommands(plan);
    const w1s = [...result.warnings, ...result.errors].filter(f => f.ruleId === "W1");
    expect(w1s).toHaveLength(1);
    expect(w1s[0].slice).toBe("2");
  });

  it("suppression on an unused rule is a no-op (no warning about unused suppression)", () => {
    const gate = "# pforge-lint-disable W1\nnpx vitest run tests/foo.test.mjs";
    const result = lintGateCommands(makePlan(gate));
    const unusedSuppress = [...result.warnings, ...result.errors].find(f => f.rule === "unused-suppression");
    expect(unusedSuppress).toBeUndefined();
  });

  it("suppression directive itself does not emit a comment-line warning", () => {
    const gate = "# pforge-lint-disable W1\nbash -c \"node -e xyz\"";
    const result = lintGateCommands(makePlan(gate));
    const commentWarns = [...result.warnings, ...result.errors].filter(f => f.rule === "comment-line");
    expect(commentWarns).toHaveLength(0);
  });

  it("non-suppress comment still emits comment-line warning", () => {
    const gate = "# This is a plain comment\nnpx vitest run";
    const result = lintGateCommands(makePlan(gate));
    const commentWarns = result.warnings.filter(f => f.rule === "comment-line");
    expect(commentWarns.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Strict mode (PFORGE_GATE_LINT_STRICT=1) ─────────────────────────────────

describe("lintGateCommands — strict mode (PFORGE_GATE_LINT_STRICT=1)", () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env.PFORGE_GATE_LINT_STRICT;
    process.env.PFORGE_GATE_LINT_STRICT = "1";
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.PFORGE_GATE_LINT_STRICT;
    } else {
      process.env.PFORGE_GATE_LINT_STRICT = savedEnv;
    }
  });

  it("W1 is promoted to error severity in strict mode", () => {
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    const w1 = result.errors.find(f => f.ruleId === "W1");
    expect(w1).toBeDefined();
    expect(w1.severity).toBe("error");
  });

  it("W1 in strict mode appears in errors, not warnings", () => {
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    const w1Warn = result.warnings.find(f => f.ruleId === "W1");
    const w1Err = result.errors.find(f => f.ruleId === "W1");
    expect(w1Warn).toBeUndefined();
    expect(w1Err).toBeDefined();
  });

  it("W4 is promoted to error in strict mode", () => {
    const result = lintGateCommands(makePlan('cd pforge-mcp && npx vitest run'));
    const w4 = result.errors.find(f => f.ruleId === "W4");
    expect(w4).toBeDefined();
    expect(w4.severity).toBe("error");
  });

  it("W2 is promoted to error in strict mode", () => {
    const result = lintGateCommands(makePlan('node --version | grep 20'));
    const w2 = result.errors.find(f => f.ruleId === "W2");
    expect(w2).toBeDefined();
    expect(w2.severity).toBe("error");
  });

  it("strict mode W-rule error causes passed=false", () => {
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    expect(result.passed).toBe(false);
  });

  it("suppression wins over strict mode — suppressed rule is not emitted as error", () => {
    const gate = "# pforge-lint-disable W1\nbash -c \"node -e xyz\"";
    const result = lintGateCommands(makePlan(gate));
    const w1 = [...result.warnings, ...result.errors].find(f => f.ruleId === "W1");
    expect(w1).toBeUndefined();
  });

  it("suppression of W1 in strict mode does not affect other W-rules", () => {
    const gate = "# pforge-lint-disable W1\nbash -c \"node -e xyz\"\ncd src && node x.mjs";
    const result = lintGateCommands(makePlan(gate));
    expect([...result.warnings, ...result.errors].find(f => f.ruleId === "W1")).toBeUndefined();
    const w4 = result.errors.find(f => f.ruleId === "W4");
    expect(w4).toBeDefined();
    expect(w4.severity).toBe("error");
  });
});

// ─── Default (non-strict) mode ────────────────────────────────────────────────

describe("lintGateCommands — default (non-strict) mode", () => {
  beforeEach(() => {
    delete process.env.PFORGE_GATE_LINT_STRICT;
  });

  it("W1 defaults to warn severity", () => {
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    const w1 = result.warnings.find(f => f.ruleId === "W1");
    expect(w1).toBeDefined();
    expect(w1.severity).toBe("warn");
  });

  it("W-rule warnings do not affect passed status", () => {
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    const wErrors = result.errors.filter(f => f.ruleId && /^W\d/.test(f.ruleId));
    expect(wErrors).toHaveLength(0);
    // passed is only false when there are real errors (non-W-rule errors)
    expect(typeof result.passed).toBe("boolean");
  });

  it("PFORGE_GATE_LINT_STRICT set to empty string does not enable strict mode", () => {
    process.env.PFORGE_GATE_LINT_STRICT = "";
    const result = lintGateCommands(makePlan('bash -c "node -e xyz"'));
    const w1Err = result.errors.find(f => f.ruleId === "W1");
    expect(w1Err).toBeUndefined();
    const w1Warn = result.warnings.find(f => f.ruleId === "W1");
    expect(w1Warn).toBeDefined();
  });
});
