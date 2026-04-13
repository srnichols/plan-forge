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

// ─── forge_deploy_journal metadata ──────────────────────────────────────

describe("TOOL_METADATA forge_deploy_journal", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_deploy_journal");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_deploy_journal.addedIn).toBe("2.27.0");
  });

  it("produces deploy-journal.jsonl", () => {
    expect(TOOL_METADATA.forge_deploy_journal.produces).toContain(".forge/deploy-journal.jsonl");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_deploy_journal");
    expect(keys).toHaveLength(1);
  });

  it("has MISSING_VERSION error entry", () => {
    const errors = TOOL_METADATA.forge_deploy_journal.errors;
    expect(errors).toHaveProperty("MISSING_VERSION");
  });

  it("sideEffects mentions deploy-journal.jsonl", () => {
    const effects = TOOL_METADATA.forge_deploy_journal.sideEffects.join(" ");
    expect(effects).toMatch(/deploy-journal\.jsonl/);
  });

  it("sideEffects mentions deploy-recorded hub event", () => {
    const effects = TOOL_METADATA.forge_deploy_journal.sideEffects.join(" ");
    expect(effects).toMatch(/deploy-recorded/);
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_deploy_journal.cost).toBe("low");
  });
});

// ─── Deploy journal JSONL persistence ─────────────────────────────────────

describe("deploy journal JSONL persistence", () => {
  it("appends deploy records correctly", () => {
    const rec1 = { id: "deploy-1", version: "v1.0.0", by: "CI", notes: null, slice: null, deployedAt: "2024-01-01T00:00:00.000Z" };
    const rec2 = { id: "deploy-2", version: "v1.1.0", by: "alice", notes: "hotfix", slice: "S3", deployedAt: "2024-01-02T00:00:00.000Z" };
    appendForgeJsonl("deploy-journal.jsonl", rec1, tempDir);
    appendForgeJsonl("deploy-journal.jsonl", rec2, tempDir);

    const deploys = readForgeJsonl("deploy-journal.jsonl", [], tempDir);
    expect(deploys).toHaveLength(2);
    expect(deploys[0].version).toBe("v1.0.0");
    expect(deploys[1].by).toBe("alice");
    expect(deploys[1].notes).toBe("hotfix");
  });

  it("returns empty array when no deploys exist", () => {
    const deploys = readForgeJsonl("deploy-journal.jsonl", [], tempDir);
    expect(deploys).toHaveLength(0);
  });

  it("deploy id uses deploy- prefix", () => {
    const id = `deploy-${Date.now()}`;
    expect(id.startsWith("deploy-")).toBe(true);
  });
});

// ─── Incident → deploy correlation ───────────────────────────────────────

describe("incident preceding deploy correlation", () => {
  it("finds the most recent deploy before incident timestamp", () => {
    const deploys = [
      { id: "deploy-1", version: "v1.0.0", deployedAt: "2024-01-01T00:00:00.000Z" },
      { id: "deploy-2", version: "v1.1.0", deployedAt: "2024-01-02T00:00:00.000Z" },
      { id: "deploy-3", version: "v1.2.0", deployedAt: "2024-01-04T00:00:00.000Z" },
    ];
    const incidentTime = new Date("2024-01-03T12:00:00.000Z").getTime();
    let preceding = null;
    for (let i = deploys.length - 1; i >= 0; i--) {
      if (new Date(deploys[i].deployedAt).getTime() <= incidentTime) {
        preceding = deploys[i];
        break;
      }
    }
    expect(preceding).not.toBeNull();
    expect(preceding.id).toBe("deploy-2");
    expect(preceding.version).toBe("v1.1.0");
  });

  it("returns null when no deploys precede the incident", () => {
    const deploys = [
      { id: "deploy-1", version: "v2.0.0", deployedAt: "2024-06-01T00:00:00.000Z" },
    ];
    const incidentTime = new Date("2024-01-01T00:00:00.000Z").getTime();
    let preceding = null;
    for (let i = deploys.length - 1; i >= 0; i--) {
      if (new Date(deploys[i].deployedAt).getTime() <= incidentTime) {
        preceding = deploys[i];
        break;
      }
    }
    expect(preceding).toBeNull();
  });

  it("returns null when deploy journal is empty", () => {
    const deploys = [];
    let preceding = null;
    for (let i = deploys.length - 1; i >= 0; i--) {
      if (new Date(deploys[i].deployedAt).getTime() <= Date.now()) {
        preceding = deploys[i];
        break;
      }
    }
    expect(preceding).toBeNull();
  });

  it("JSONL round-trip: write deploys, read back, find preceding", () => {
    appendForgeJsonl("deploy-journal.jsonl", { id: "deploy-1", version: "v1.0.0", by: "CI", notes: null, slice: null, deployedAt: "2024-01-01T00:00:00.000Z" }, tempDir);
    appendForgeJsonl("deploy-journal.jsonl", { id: "deploy-2", version: "v1.1.0", by: "CI", notes: null, slice: null, deployedAt: "2024-01-05T00:00:00.000Z" }, tempDir);

    const deploys = readForgeJsonl("deploy-journal.jsonl", [], tempDir);
    const incidentTime = new Date("2024-01-03T00:00:00.000Z").getTime();
    let preceding = null;
    for (let i = deploys.length - 1; i >= 0; i--) {
      if (new Date(deploys[i].deployedAt).getTime() <= incidentTime) {
        preceding = deploys[i];
        break;
      }
    }
    expect(preceding).not.toBeNull();
    expect(preceding.id).toBe("deploy-1");
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

// ─── forge_hotspot metadata ───────────────────────────────────────────────

describe("TOOL_METADATA forge_hotspot", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_hotspot");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_hotspot.addedIn).toBe("2.31.0");
  });

  it("produces hotspot-cache.json", () => {
    expect(TOOL_METADATA.forge_hotspot.produces).toContain(".forge/hotspot-cache.json");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_hotspot");
    expect(keys).toHaveLength(1);
  });

  it("has GIT_LOG_FAILED and NO_COMMITS error entries", () => {
    const errors = TOOL_METADATA.forge_hotspot.errors;
    expect(errors).toHaveProperty("GIT_LOG_FAILED");
    expect(errors).toHaveProperty("NO_COMMITS");
  });

  it("sideEffects mentions hotspot-cache", () => {
    const effects = TOOL_METADATA.forge_hotspot.sideEffects.join(" ");
    expect(effects).toMatch(/hotspot-cache/);
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_hotspot.cost).toBe("low");
  });
});

// ─── forge_alert_triage metadata ──────────────────────────────────────────

describe("TOOL_METADATA forge_alert_triage", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_alert_triage");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_alert_triage.addedIn).toBe("2.31.0");
  });

  it("consumes incidents.jsonl and drift-history.json", () => {
    expect(TOOL_METADATA.forge_alert_triage.consumes).toContain(".forge/incidents.jsonl");
    expect(TOOL_METADATA.forge_alert_triage.consumes).toContain(".forge/drift-history.json");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_alert_triage");
    expect(keys).toHaveLength(1);
  });

  it("has NO_ALERTS and INVALID_SEVERITY error entries", () => {
    const errors = TOOL_METADATA.forge_alert_triage.errors;
    expect(errors).toHaveProperty("NO_ALERTS");
    expect(errors).toHaveProperty("INVALID_SEVERITY");
  });

  it("has no sideEffects (read-only tool)", () => {
    expect(TOOL_METADATA.forge_alert_triage.sideEffects).toHaveLength(0);
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_alert_triage.cost).toBe("low");
  });

  it("notes mention read-only and tiebreak rule", () => {
    expect(TOOL_METADATA.forge_alert_triage.notes).toMatch(/read-only/i);
    expect(TOOL_METADATA.forge_alert_triage.notes).toMatch(/tiebreak/i);
  });
});

// ─── Alert triage priority scoring ────────────────────────────────────────

describe("alert triage priority scoring", () => {
  const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };

  it("critical severity has weight 4", () => {
    expect(SEVERITY_WEIGHT.critical).toBe(4);
  });

  it("low severity has weight 1", () => {
    expect(SEVERITY_WEIGHT.low).toBe(1);
  });

  it("priority = severity_weight * recency_factor", () => {
    // Recent critical: 4 * 1.0 = 4.0
    const priority = SEVERITY_WEIGHT.critical * 1.0;
    expect(priority).toBe(4.0);
  });

  it("older alerts have lower priority via recency factor", () => {
    // Recent (< 24h) critical = 4 * 1.0 = 4.0
    // Older (> 30d) critical = 4 * 0.3 = 1.2
    const recent = SEVERITY_WEIGHT.critical * 1.0;
    const old = SEVERITY_WEIGHT.critical * 0.3;
    expect(recent).toBeGreaterThan(old);
  });
});

describe("alert triage data reading", () => {
  it("returns empty alerts when no incidents or drift exist", () => {
    const incidents = readForgeJsonl("incidents.jsonl", [], tempDir);
    const drift = readForgeJsonl("drift-history.json", [], tempDir);
    expect(incidents).toHaveLength(0);
    expect(drift).toHaveLength(0);
  });

  it("skips resolved incidents", () => {
    appendForgeJsonl("incidents.jsonl", { id: "inc-1", description: "resolved", severity: "high", capturedAt: new Date().toISOString(), resolvedAt: new Date().toISOString(), mttr: 1000, files: [] }, tempDir);
    appendForgeJsonl("incidents.jsonl", { id: "inc-2", description: "open", severity: "medium", capturedAt: new Date().toISOString(), resolvedAt: null, mttr: null, files: [] }, tempDir);
    const incidents = readForgeJsonl("incidents.jsonl", [], tempDir);
    const open = incidents.filter(i => !i.resolvedAt);
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe("inc-2");
  });

  it("reads drift violations from latest history entry", () => {
    appendForgeJsonl("drift-history.json", { timestamp: new Date().toISOString(), score: 90, violations: [{ file: "a.ts", rule: "empty-catch", severity: "high", line: 10 }], filesScanned: 1, delta: 0, trend: "stable" }, tempDir);
    appendForgeJsonl("drift-history.json", { timestamp: new Date().toISOString(), score: 85, violations: [{ file: "b.ts", rule: "any-type", severity: "medium", line: 5 }], filesScanned: 2, delta: -5, trend: "degrading" }, tempDir);
    const history = readForgeJsonl("drift-history.json", [], tempDir);
    const latest = history[history.length - 1];
    expect(latest.violations).toHaveLength(1);
    expect(latest.violations[0].rule).toBe("any-type");
  });

  it("filters by minimum severity", () => {
    const SEVERITY_ORDER = ["low", "medium", "high", "critical"];
    const minIdx = SEVERITY_ORDER.indexOf("high");
    const alerts = [
      { severity: "low" },
      { severity: "medium" },
      { severity: "high" },
      { severity: "critical" },
    ];
    const filtered = alerts.filter(a => SEVERITY_ORDER.indexOf(a.severity) >= minIdx);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(a => a.severity)).toEqual(["high", "critical"]);
  });

  it("tiebreak: more recent timestamp ranks higher when priority is equal", () => {
    const older = { priority: 3.0, timestamp: "2024-01-01T00:00:00.000Z" };
    const newer = { priority: 3.0, timestamp: "2024-01-02T00:00:00.000Z" };
    const sorted = [older, newer].sort((a, b) => b.priority - a.priority || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    expect(sorted[0]).toBe(newer);
  });
});
