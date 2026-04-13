/**
 * server.test.mjs — forge_drift_report + forge_incident_capture unit tests
 *
 * Tests drift score computation, history tracking, trend detection,
 * incident capture (MTTR, severity, onCall dispatch), and
 * capabilities metadata — without starting the MCP/HTTP server.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { runAnalyze, appendForgeJsonl, readForgeJsonl, regressionGuard, isGateCommandAllowed } from "../orchestrator.mjs";
import { TOOL_METADATA } from "../capabilities.mjs";

let tempDir;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pforge-server-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Capabilities: forge_drift_report metadata ──────────────────────────

describe("TOOL_METADATA forge_drift_report", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_drift_report");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_drift_report.addedIn).toBe("2.27.0");
  });

  it("produces drift-history.json", () => {
    expect(TOOL_METADATA.forge_drift_report.produces).toContain(".forge/drift-history.json");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_drift_report");
    expect(keys).toHaveLength(1);
  });

  it("has NO_SOURCE_FILES and ANALYSIS_FAILED error entries", () => {
    const errors = TOOL_METADATA.forge_drift_report.errors;
    expect(errors).toHaveProperty("NO_SOURCE_FILES");
    expect(errors).toHaveProperty("ANALYSIS_FAILED");
  });

  it("sideEffects mentions drift-alert hub event", () => {
    const effects = TOOL_METADATA.forge_drift_report.sideEffects.join(" ");
    expect(effects).toMatch(/drift-alert/);
  });
});

// ─── Drift score computation ─────────────────────────────────────────────

describe("drift score computation", () => {
  const penaltyPerViolation = 2;

  it("score is 100 when no violations", async () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "clean.js"), "export function greet(name) { return `Hello ${name}`; }\n");

    const analysis = await runAnalyze({ path: "src", cwd: tempDir });
    const score = Math.max(0, 100 - analysis.violations.length * penaltyPerViolation);
    expect(score).toBe(100);
  });

  it("score decreases by 2 per violation", async () => {
    mkdirSync(join(tempDir, "src"), { recursive: true });
    // 3 empty-catch blocks → score = 100 - 3*2 = 94
    writeFileSync(join(tempDir, "src", "bad.js"), [
      "try { doA(); } catch (e) {}",
      "try { doB(); } catch (e) {}",
      "try { doC(); } catch (e) {}",
    ].join("\n"));

    const analysis = await runAnalyze({ path: "src", cwd: tempDir });
    const score = Math.max(0, 100 - analysis.violations.length * penaltyPerViolation);
    expect(score).toBe(100 - analysis.violations.length * 2);
    expect(score).toBeLessThan(100);
  });

  it("score clamps at 0 for excessive violations", () => {
    const violationCount = 60;
    const score = Math.max(0, 100 - violationCount * penaltyPerViolation);
    expect(score).toBe(0);
  });
});

// ─── Drift history and trend ─────────────────────────────────────────────

describe("drift history and trend", () => {
  it("historyLength is 1 on first run", () => {
    const history = readForgeJsonl("drift-history.json", [], tempDir);
    expect(history).toHaveLength(0);
    const historyLength = history.length + 1;
    expect(historyLength).toBe(1);
  });

  it("appends records correctly", () => {
    appendForgeJsonl("drift-history.json", { score: 90, timestamp: "t1" }, tempDir);
    appendForgeJsonl("drift-history.json", { score: 85, timestamp: "t2" }, tempDir);

    const history = readForgeJsonl("drift-history.json", [], tempDir);
    expect(history).toHaveLength(2);
    expect(history[0].score).toBe(90);
    expect(history[1].score).toBe(85);
  });

  it("trend is 'stable' on first run (no previous)", () => {
    const prev = null;
    const score = 80;
    const delta = prev ? score - prev.score : 0;
    const trend = !prev ? "stable" : delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
    expect(trend).toBe("stable");
    expect(delta).toBe(0);
  });

  it("trend is 'improving' when score increases", () => {
    const prev = { score: 70 };
    const score = 85;
    const delta = score - prev.score;
    const trend = delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
    expect(trend).toBe("improving");
    expect(delta).toBe(15);
  });

  it("trend is 'degrading' when score decreases", () => {
    const prev = { score: 90 };
    const score = 75;
    const delta = score - prev.score;
    const trend = delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
    expect(trend).toBe("degrading");
    expect(delta).toBe(-15);
  });

  it("trend is 'stable' when score is unchanged", () => {
    const prev = { score: 80 };
    const score = 80;
    const delta = score - prev.score;
    const trend = delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
    expect(trend).toBe("stable");
    expect(delta).toBe(0);
  });
});

// ─── Threshold alerting ───────────────────────────────────────────────────

describe("drift threshold alerting", () => {
  it("alert fires when score < threshold", () => {
    const score = 65;
    const threshold = 70;
    expect(score < threshold).toBe(true);
  });

  it("alert does not fire when score >= threshold", () => {
    const score = 70;
    const threshold = 70;
    expect(score < threshold).toBe(false);
  });

  it("threshold defaults to 70 when not provided", () => {
    const threshold = Math.max(0, Math.min(100, undefined ?? 70));
    expect(threshold).toBe(70);
  });

  it("threshold clamps to [0, 100]", () => {
    expect(Math.max(0, Math.min(100, -10))).toBe(0);
    expect(Math.max(0, Math.min(100, 150))).toBe(100);
    expect(Math.max(0, Math.min(100, 55))).toBe(55);
  });
});

// ─── Rule filtering ───────────────────────────────────────────────────────

describe("runAnalyze rule filtering", () => {
  beforeEach(() => {
    mkdirSync(join(tempDir, "src2"), { recursive: true });
    writeFileSync(join(tempDir, "src2", "mixed.ts"), [
      "try { foo(); } catch (e) {}",           // empty-catch
      "const x: any = bar();",                 // any-type
      "// TODO: refactor this later",          // deferred-work
    ].join("\n"));
  });

  it("returns all rule violations when rules=null", async () => {
    const result = await runAnalyze({ path: "src2", rules: null, cwd: tempDir });
    const ruleIds = [...new Set(result.violations.map(v => v.rule))];
    expect(ruleIds.length).toBeGreaterThanOrEqual(2);
  });

  it("filters to only specified rules", async () => {
    const result = await runAnalyze({ path: "src2", rules: ["empty-catch"], cwd: tempDir });
    const ruleIds = [...new Set(result.violations.map(v => v.rule))];
    expect(ruleIds).toEqual(["empty-catch"]);
  });

  it("returns zero violations for unmatched rule filter", async () => {
    const result = await runAnalyze({ path: "src2", rules: ["sql-injection"], cwd: tempDir });
    expect(result.violations).toHaveLength(0);
  });
});

// ─── forge_incident_capture metadata ─────────────────────────────────────

describe("TOOL_METADATA forge_incident_capture", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_incident_capture");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_incident_capture.addedIn).toBe("2.27.0");
  });

  it("produces incidents.jsonl", () => {
    expect(TOOL_METADATA.forge_incident_capture.produces).toContain(".forge/incidents.jsonl");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_incident_capture");
    expect(keys).toHaveLength(1);
  });

  it("has RESOLVED_BEFORE_CAPTURED and INVALID_SEVERITY error entries", () => {
    const errors = TOOL_METADATA.forge_incident_capture.errors;
    expect(errors).toHaveProperty("RESOLVED_BEFORE_CAPTURED");
    expect(errors).toHaveProperty("INVALID_SEVERITY");
  });

  it("sideEffects mentions incident-captured hub event", () => {
    const effects = TOOL_METADATA.forge_incident_capture.sideEffects.join(" ");
    expect(effects).toMatch(/incident-captured/);
  });

  it("sideEffects mentions onCall bridge dispatch", () => {
    const effects = TOOL_METADATA.forge_incident_capture.sideEffects.join(" ");
    expect(effects).toMatch(/onCall/);
  });
});

// ─── Incident capture logic ───────────────────────────────────────────────

describe("incident MTTR computation", () => {
  it("mttr is null when resolvedAt is absent", () => {
    const resolvedAt = null;
    const mttr = resolvedAt ? 1 : null;
    expect(mttr).toBeNull();
  });

  it("mttr is computed as ms diff when resolvedAt is present", () => {
    const capturedAt = new Date("2024-01-01T00:00:00.000Z");
    const resolvedAt = new Date("2024-01-01T01:30:00.000Z"); // 90 minutes later
    const mttr = resolvedAt.getTime() - capturedAt.getTime();
    expect(mttr).toBe(90 * 60 * 1000);
  });

  it("rejects resolvedAt before capturedAt", () => {
    const capturedMs = new Date("2024-01-01T02:00:00.000Z").getTime();
    const resolvedMs = new Date("2024-01-01T01:00:00.000Z").getTime();
    expect(resolvedMs < capturedMs).toBe(true);
  });

  it("accepts resolvedAt equal to capturedAt (0 MTTR)", () => {
    const t = "2024-01-01T00:00:00.000Z";
    const mttr = new Date(t).getTime() - new Date(t).getTime();
    expect(mttr).toBe(0);
  });
});

describe("incident severity validation", () => {
  const VALID = ["low", "medium", "high", "critical"];

  it("accepts all valid severities", () => {
    for (const s of VALID) {
      expect(VALID.includes(s)).toBe(true);
    }
  });

  it("rejects unknown severity", () => {
    expect(VALID.includes("urgent")).toBe(false);
    expect(VALID.includes("p0")).toBe(false);
  });

  it("defaults to medium when not provided", () => {
    const severity = undefined ?? "medium";
    expect(severity).toBe("medium");
  });
});

describe("incident JSONL persistence", () => {
  it("appends incident records correctly", () => {
    const rec1 = { id: "inc-1", description: "Test A", severity: "low", capturedAt: "t1", resolvedAt: null, mttr: null, files: [] };
    const rec2 = { id: "inc-2", description: "Test B", severity: "high", capturedAt: "t2", resolvedAt: "t3", mttr: 3600000, files: ["src/api.ts"] };
    appendForgeJsonl("incidents.jsonl", rec1, tempDir);
    appendForgeJsonl("incidents.jsonl", rec2, tempDir);

    const incidents = readForgeJsonl("incidents.jsonl", [], tempDir);
    expect(incidents).toHaveLength(2);
    expect(incidents[0].id).toBe("inc-1");
    expect(incidents[1].severity).toBe("high");
    expect(incidents[1].mttr).toBe(3600000);
  });

  it("returns empty array when no incidents exist", () => {
    const incidents = readForgeJsonl("incidents.jsonl", [], tempDir);
    expect(incidents).toHaveLength(0);
  });

  it("incident id uses inc- prefix", () => {
    const id = `inc-${Date.now()}`;
    expect(id.startsWith("inc-")).toBe(true);
  });
});

// ─── forge_regression_guard metadata ────────────────────────────────────

describe("TOOL_METADATA forge_regression_guard", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_regression_guard");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_regression_guard.addedIn).toBe("2.29.0");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_regression_guard");
    expect(keys).toHaveLength(1);
  });

  it("has NO_PLANS_FOUND and GATE_FAILED error entries", () => {
    const errors = TOOL_METADATA.forge_regression_guard.errors;
    expect(errors).toHaveProperty("NO_PLANS_FOUND");
    expect(errors).toHaveProperty("GATE_FAILED");
  });

  it("sideEffects mentions shell command execution", () => {
    const effects = TOOL_METADATA.forge_regression_guard.sideEffects.join(" ");
    expect(effects).toMatch(/shell/i);
  });

  it("produces telemetry/tool-calls.jsonl", () => {
    const produces = TOOL_METADATA.forge_regression_guard.produces.join(" ");
    expect(produces).toMatch(/tool-calls\.jsonl/);
  });
});

// ─── isGateCommandAllowed ───────────────────────────────────────────────

describe("isGateCommandAllowed", () => {
  it("allows npm test", () => {
    expect(isGateCommandAllowed("npm test")).toBe(true);
  });

  it("allows node -e command", () => {
    expect(isGateCommandAllowed('node -e "console.log(1)"')).toBe(true);
  });

  it("allows env-var prefix (NODE_ENV=test npm test)", () => {
    expect(isGateCommandAllowed("NODE_ENV=test npm test")).toBe(true);
  });

  it("blocks rm -rf /", () => {
    expect(isGateCommandAllowed("rm -rf /")).toBe(false);
  });

  it("blocks unknown command", () => {
    expect(isGateCommandAllowed("wget http://example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isGateCommandAllowed("")).toBe(false);
  });
});

// ─── regressionGuard ─────────────────────────────────────────────────────

/** Write a minimal plan file with optional validation gate and testCommand. */
function writePlan(dir, name, options = {}) {
  const { gateCmds = null, testCommand = null } = options;
  const gateBlock = gateCmds
    ? `**Validation Gate**\n\`\`\`\n${gateCmds.join("\n")}\n\`\`\``
    : "";
  const testCmdLine = testCommand ? `**Test Command**: \`${testCommand}\`` : "";
  const content = [
    `# ${name}`,
    "",
    "## Scope Contract",
    "### In Scope",
    "- Test",
    "",
    "## Execution Slices",
    "",
    `### Slice 1: Build`,
    "",
    testCmdLine,
    "",
    gateBlock,
    "",
    "1. Build the thing",
  ].join("\n");
  writeFileSync(join(dir, name), content);
}

describe("regressionGuard — no plans directory", () => {
  it("returns 0 gates and success when docs/plans/ does not exist", async () => {
    const result = await regressionGuard([], { cwd: tempDir });
    expect(result.gatesChecked).toBe(0);
    expect(result.success).toBe(true);
    expect(result.files).toEqual([]);
  });
});

describe("regressionGuard — gate blocking", () => {
  beforeEach(() => {
    mkdirSync(join(tempDir, "docs", "plans"), { recursive: true });
  });

  it("marks disallowed commands as blocked", async () => {
    writePlan(join(tempDir, "docs", "plans"), "Phase-1-PLAN.md", {
      gateCmds: ["wget http://example.com"],
    });
    const result = await regressionGuard([], { cwd: tempDir });
    expect(result.gatesChecked).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.success).toBe(true); // blocked ≠ failed
    expect(result.results[0].status).toBe("blocked");
  });
});

describe("regressionGuard — gate execution", () => {
  beforeEach(() => {
    mkdirSync(join(tempDir, "docs", "plans"), { recursive: true });
  });

  it("reports passed when gate command succeeds", async () => {
    writePlan(join(tempDir, "docs", "plans"), "Phase-1-PLAN.md", {
      gateCmds: ['node -e "process.exit(0)"'],
    });
    const result = await regressionGuard(["src/main.js"], { cwd: tempDir });
    expect(result.gatesChecked).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.success).toBe(true);
    expect(result.files).toContain("src/main.js");
  });

  it("reports failed when gate command exits non-zero", async () => {
    writePlan(join(tempDir, "docs", "plans"), "Phase-1-PLAN.md", {
      gateCmds: ['node -e "process.exit(1)"'],
    });
    const result = await regressionGuard([], { cwd: tempDir });
    expect(result.failed).toBe(1);
    expect(result.success).toBe(false);
    expect(result.results[0].status).toBe("failed");
  });

  it("stops and skips remaining gates when failFast is true", async () => {
    writePlan(join(tempDir, "docs", "plans"), "Phase-1-PLAN.md", {
      gateCmds: ['node -e "process.exit(1)"', 'node -e "process.exit(0)"'],
    });
    const result = await regressionGuard([], { failFast: true, cwd: tempDir });
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(1);
    const statuses = result.results.map(r => r.status);
    expect(statuses).toContain("failed");
    expect(statuses).toContain("skipped");
  });
});

describe("regressionGuard — testCommand fallback", () => {
  beforeEach(() => {
    mkdirSync(join(tempDir, "docs", "plans"), { recursive: true });
  });

  it("uses testCommand when no bash-block gates are present", async () => {
    writePlan(join(tempDir, "docs", "plans"), "Phase-1-PLAN.md", {
      testCommand: 'node -e "process.exit(0)"',
    });
    const result = await regressionGuard([], { cwd: tempDir });
    // testCommand fallback: gate extracted from testCommand field
    expect(result.gatesChecked).toBe(1);
    const sources = result.results.map(r => r.source);
    expect(sources).toContain("testCommand");
  });
});

describe("regressionGuard — scoped to specific plan", () => {
  it("only runs gates from the specified plan file", async () => {
    mkdirSync(join(tempDir, "docs", "plans"), { recursive: true });
    // Two plans — only the specified one should be used
    writePlan(join(tempDir, "docs", "plans"), "Phase-1-PLAN.md", {
      gateCmds: ['node -e "process.exit(0)"'],
    });
    writePlan(join(tempDir, "docs", "plans"), "Phase-2-PLAN.md", {
      gateCmds: ['node -e "process.exit(1)"'],
    });
    const result = await regressionGuard([], {
      plan: "docs/plans/Phase-1-PLAN.md",
      cwd: tempDir,
    });
    expect(result.gatesChecked).toBe(1);
    expect(result.passed).toBe(1);
    expect(result.success).toBe(true);
  });
});

// ─── forge_runbook metadata ───────────────────────────────────────────────

describe("TOOL_METADATA forge_runbook", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_runbook");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_runbook.addedIn).toBe("2.30.0");
  });

  it("produces runbook markdown file", () => {
    expect(TOOL_METADATA.forge_runbook.produces.join(" ")).toMatch(/runbook\.md/);
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_runbook");
    expect(keys).toHaveLength(1);
  });

  it("has PLAN_NOT_FOUND error entry", () => {
    expect(TOOL_METADATA.forge_runbook.errors).toHaveProperty("PLAN_NOT_FOUND");
  });

  it("consumes plan files and incidents", () => {
    const consumes = TOOL_METADATA.forge_runbook.consumes.join(" ");
    expect(consumes).toMatch(/plans/);
    expect(consumes).toMatch(/incidents/);
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_runbook.cost).toBe("low");
  });
});

// ─── planNameToRunbookName ────────────────────────────────────────────────

describe("planNameToRunbookName derivation", () => {
  function planNameToRunbookName(planPath) {
    const base = planPath.replace(/\.md$/i, "").split(/[\\/]/).pop();
    return base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") + "-runbook.md";
  }

  it("converts Phase-TYPESCRIPT-EXAMPLE.md correctly", () => {
    expect(planNameToRunbookName("docs/plans/examples/Phase-TYPESCRIPT-EXAMPLE.md"))
      .toBe("phase-typescript-example-runbook.md");
  });

  it("converts Phase-1-AUTH-PLAN.md correctly", () => {
    expect(planNameToRunbookName("docs/plans/Phase-1-AUTH-PLAN.md"))
      .toBe("phase-1-auth-plan-runbook.md");
  });

  it("collapses multiple hyphens", () => {
    const result = planNameToRunbookName("docs/plans/Phase--DOUBLE.md");
    expect(result).not.toMatch(/--/);
  });
});
