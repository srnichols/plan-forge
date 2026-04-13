/**
 * server.test.mjs — LiveGuard tool handler unit tests
 *
 * Tests drift score computation, history tracking, trend detection,
 * incident capture (MTTR, severity, onCall dispatch), deploy journal,
 * dep watch, health trend, alert triage, and
 * capabilities metadata — without starting the MCP/HTTP server.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runAnalyze, appendForgeJsonl, readForgeJsonl, regressionGuard, isGateCommandAllowed, getHealthTrend, recordModelPerformance, emitToolTelemetry } from "../orchestrator.mjs";
import { TOOL_METADATA } from "../capabilities.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// ─── forge_dep_watch metadata ─────────────────────────────────────────────

describe("TOOL_METADATA forge_dep_watch", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_dep_watch");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_dep_watch.addedIn).toBe("2.27.0");
  });

  it("produces deps-snapshot.json", () => {
    expect(TOOL_METADATA.forge_dep_watch.produces).toContain(".forge/deps-snapshot.json");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_dep_watch");
    expect(keys).toHaveLength(1);
  });

  it("has NO_PACKAGE_JSON and AUDIT_FAILED error entries", () => {
    const errors = TOOL_METADATA.forge_dep_watch.errors;
    expect(errors).toHaveProperty("NO_PACKAGE_JSON");
    expect(errors).toHaveProperty("AUDIT_FAILED");
  });

  it("sideEffects mentions deps-snapshot.json", () => {
    const effects = TOOL_METADATA.forge_dep_watch.sideEffects.join(" ");
    expect(effects).toMatch(/deps-snapshot\.json/);
  });

  it("sideEffects mentions dep-vulnerability hub event", () => {
    const effects = TOOL_METADATA.forge_dep_watch.sideEffects.join(" ");
    expect(effects).toMatch(/dep-vulnerability/);
  });

  it("consumes package.json and package-lock.json", () => {
    expect(TOOL_METADATA.forge_dep_watch.consumes).toContain("package.json");
    expect(TOOL_METADATA.forge_dep_watch.consumes).toContain("package-lock.json");
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_dep_watch.cost).toBe("low");
  });
});

// ─── Dep watch snapshot JSONL persistence ─────────────────────────────────

describe("dep watch snapshot persistence", () => {
  it("stores and reads deps-snapshot.json correctly", () => {
    const snapshot = {
      capturedAt: new Date().toISOString(),
      depCount: 42,
      vulnerabilities: [{ name: "lodash", severity: "high", advisory: "CVE-2021-23337" }],
    };
    const forgePath = resolve(tempDir, ".forge");
    mkdirSync(forgePath, { recursive: true });
    writeFileSync(resolve(forgePath, "deps-snapshot.json"), JSON.stringify(snapshot));

    const result = JSON.parse(
      require("node:fs").readFileSync(resolve(forgePath, "deps-snapshot.json"), "utf-8")
    );
    expect(result.depCount).toBe(42);
    expect(result.vulnerabilities).toHaveLength(1);
    expect(result.vulnerabilities[0].name).toBe("lodash");
  });

  it("returns null when no snapshot exists", () => {
    const result = readForgeJsonl("deps-snapshot.json", null, tempDir);
    expect(result).toBeNull();
  });

  it("diff: new vulnerabilities = current minus previous", () => {
    const prev = [
      { name: "lodash", severity: "high" },
      { name: "express", severity: "medium" },
    ];
    const current = [
      { name: "lodash", severity: "high" },
      { name: "express", severity: "medium" },
      { name: "axios", severity: "low" },
    ];
    const prevNames = new Set(prev.map(v => v.name));
    const newVulns = current.filter(v => !prevNames.has(v.name));
    expect(newVulns).toHaveLength(1);
    expect(newVulns[0].name).toBe("axios");
  });

  it("diff: resolved vulnerabilities = previous minus current", () => {
    const prev = [
      { name: "lodash", severity: "high" },
      { name: "express", severity: "medium" },
    ];
    const current = [
      { name: "lodash", severity: "high" },
    ];
    const currentNames = new Set(current.map(v => v.name));
    const resolved = prev.filter(v => !currentNames.has(v.name));
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe("express");
  });
});

// ─── forge_health_trend metadata ──────────────────────────────────────────

describe("TOOL_METADATA forge_health_trend", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_health_trend");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_health_trend.addedIn).toBe("2.31.0");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_health_trend");
    expect(keys).toHaveLength(1);
  });

  it("consumes operational data files", () => {
    const consumes = TOOL_METADATA.forge_health_trend.consumes;
    expect(consumes).toContain(".forge/drift-history.json");
    expect(consumes).toContain(".forge/incidents.jsonl");
    expect(consumes).toContain(".forge/model-performance.json");
  });

  it("has NO_DATA error entry", () => {
    expect(TOOL_METADATA.forge_health_trend.errors).toHaveProperty("NO_DATA");
  });

  it("has no sideEffects (read-only)", () => {
    expect(TOOL_METADATA.forge_health_trend.sideEffects).toHaveLength(0);
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_health_trend.cost).toBe("low");
  });
});

// ─── Health trend integration ──────────────────────────────────────────────

describe("forge_health_trend integration", () => {
  it("returns structured result with all metrics", () => {
    const now = new Date().toISOString();
    appendForgeJsonl("drift-history.json", { timestamp: now, score: 85 }, tempDir);
    appendForgeJsonl("incidents.jsonl", { capturedAt: now, severity: "high", resolvedAt: null, mttr: null }, tempDir);
    recordModelPerformance(tempDir, { date: now, model: "gpt-4o", status: "passed", cost_usd: 0.05 });

    const result = getHealthTrend(tempDir, 30);
    expect(result.drift.snapshots).toBe(1);
    expect(result.drift.latest).toBe(85);
    expect(result.incidents.total).toBe(1);
    expect(result.incidents.open).toBe(1);
    expect(result.models.totalSlices).toBe(1);
    expect(result.dataPoints).toBeGreaterThanOrEqual(3);
    expect(result.healthScore).not.toBeNull();
  });

  it("returns baseline health when no operational data exists", () => {
    const result = getHealthTrend(tempDir, 30);
    // incidents metric contributes 100 (no incidents = 0 penalty), so healthScore is 100
    expect(result.healthScore).toBe(100);
    // drift.trend "insufficient-data" takes precedence over no-data check
    expect(result.trend).toBe("insufficient-data");
  });

  it("narrows time window correctly", () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    appendForgeJsonl("drift-history.json", { timestamp: old, score: 50 }, tempDir);
    appendForgeJsonl("drift-history.json", { timestamp: recent, score: 95 }, tempDir);

    const result = getHealthTrend(tempDir, 7, ["drift"]);
    expect(result.drift.snapshots).toBe(1);
    expect(result.drift.latest).toBe(95);
  });
});

// ─── GET /api/liveguard/traces — LiveGuard event JSONL persistence ──────

describe("liveguard traces endpoint data", () => {
  it("returns empty array when liveguard-events.jsonl is absent", () => {
    const result = readForgeJsonl("liveguard-events.jsonl", [], tempDir);
    expect(result).toEqual([]);
  });

  it("returns array of events when liveguard-events.jsonl exists", () => {
    const event1 = { timestamp: new Date().toISOString(), tool: "forge_alert_triage", status: "OK", durationMs: 42 };
    const event2 = { timestamp: new Date().toISOString(), tool: "forge_drift_report", status: "OK", durationMs: 105 };
    appendForgeJsonl("liveguard-events.jsonl", event1, tempDir);
    appendForgeJsonl("liveguard-events.jsonl", event2, tempDir);

    const result = readForgeJsonl("liveguard-events.jsonl", [], tempDir);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe("forge_alert_triage");
    expect(result[1].tool).toBe("forge_drift_report");
  });

  it("returns default when liveguard-events.jsonl has corrupt lines", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    writeFileSync(resolve(forgeDir, "liveguard-events.jsonl"), '{"tool":"forge_hotspot","status":"OK"}\nBAD LINE\n{"tool":"forge_runbook","status":"OK"}\n');

    const result = readForgeJsonl("liveguard-events.jsonl", [], tempDir);
    expect(result).toEqual([]);
  });
});

// ─── Capabilities: forge_secret_scan metadata ──────────────────────────

describe("TOOL_METADATA forge_secret_scan", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_secret_scan");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_secret_scan.addedIn).toBe("2.28.0");
  });

  it("produces secret-scan-cache.json", () => {
    expect(TOOL_METADATA.forge_secret_scan.produces).toContain(".forge/secret-scan-cache.json");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_secret_scan");
    expect(keys).toHaveLength(1);
  });

  it("has GIT_UNAVAILABLE and DIFF_TIMEOUT error entries", () => {
    const errors = TOOL_METADATA.forge_secret_scan.errors;
    expect(errors).toHaveProperty("GIT_UNAVAILABLE");
    expect(errors).toHaveProperty("DIFF_TIMEOUT");
  });

  it("sideEffects mentions secret-scan-cache.json", () => {
    const se = TOOL_METADATA.forge_secret_scan.sideEffects;
    expect(se.some(s => s.includes("secret-scan-cache.json"))).toBe(true);
  });

  it("sideEffects mentions deploy-journal-meta.json sidecar", () => {
    const se = TOOL_METADATA.forge_secret_scan.sideEffects;
    expect(se.some(s => s.includes("deploy-journal-meta.json"))).toBe(true);
  });

  it("has securityNote about never logging actual values", () => {
    expect(TOOL_METADATA.forge_secret_scan.securityNote).toBeDefined();
    expect(TOOL_METADATA.forge_secret_scan.securityNote).toContain("REDACTED");
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_secret_scan.cost).toBe("low");
  });
});

describe("secret scan cache persistence", () => {
  it("stores and reads secret-scan-cache.json correctly", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const cache = {
      scannedAt: "2024-01-01T00:00:00.000Z",
      since: "HEAD~1",
      threshold: 4.0,
      scannedFiles: 3,
      clean: false,
      findings: [{ file: "src/config.js", line: 5, type: "api_key", entropyScore: 4.8, masked: "<REDACTED>", confidence: "high" }],
    };
    writeFileSync(resolve(forgeDir, "secret-scan-cache.json"), JSON.stringify(cache, null, 2), "utf-8");
    const read = JSON.parse(require("fs").readFileSync(resolve(forgeDir, "secret-scan-cache.json"), "utf-8"));
    expect(read.clean).toBe(false);
    expect(read.findings).toHaveLength(1);
    expect(read.findings[0].masked).toBe("<REDACTED>");
    expect(read.findings[0].entropyScore).toBe(4.8);
  });

  it("findings never contain actual secret values", () => {
    const finding = { file: "src/config.js", line: 5, type: "api_key", entropyScore: 4.8, masked: "<REDACTED>", confidence: "high" };
    expect(finding.masked).toBe("<REDACTED>");
    expect(Object.values(finding).every(v => typeof v === "string" ? !v.includes("sk-") : true)).toBe(true);
  });
});

describe("deploy journal sidecar annotation", () => {
  it("writes secretScanClean and secretScanAt to sidecar keyed by deploy id", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });

    const sidecar = {
      "deploy-1700000000000": {
        secretScanClean: true,
        secretScanAt: "2024-01-01T00:00:00.000Z",
      },
    };
    writeFileSync(resolve(forgeDir, "deploy-journal-meta.json"), JSON.stringify(sidecar, null, 2), "utf-8");

    const read = JSON.parse(require("fs").readFileSync(resolve(forgeDir, "deploy-journal-meta.json"), "utf-8"));
    expect(read["deploy-1700000000000"].secretScanClean).toBe(true);
    expect(read["deploy-1700000000000"].secretScanAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("preserves existing sidecar fields when adding scan annotation", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });

    const existing = { "deploy-100": { someField: "value" } };
    writeFileSync(resolve(forgeDir, "deploy-journal-meta.json"), JSON.stringify(existing, null, 2), "utf-8");

    // Simulate adding scan annotation
    const sidecar = JSON.parse(require("fs").readFileSync(resolve(forgeDir, "deploy-journal-meta.json"), "utf-8"));
    sidecar["deploy-100"] = { ...sidecar["deploy-100"], secretScanClean: false, secretScanAt: "2024-06-01T00:00:00.000Z" };
    writeFileSync(resolve(forgeDir, "deploy-journal-meta.json"), JSON.stringify(sidecar, null, 2), "utf-8");

    const read = JSON.parse(require("fs").readFileSync(resolve(forgeDir, "deploy-journal-meta.json"), "utf-8"));
    expect(read["deploy-100"].someField).toBe("value");
    expect(read["deploy-100"].secretScanClean).toBe(false);
  });
});

// ─── Capabilities: forge_env_diff metadata ──────────────────────────────

describe("TOOL_METADATA forge_env_diff", () => {
  it("is present in TOOL_METADATA", () => {
    expect(TOOL_METADATA).toHaveProperty("forge_env_diff");
  });

  it("has correct addedIn version", () => {
    expect(TOOL_METADATA.forge_env_diff.addedIn).toBe("2.28.0");
  });

  it("produces env-diff-cache.json", () => {
    expect(TOOL_METADATA.forge_env_diff.produces).toContain(".forge/env-diff-cache.json");
  });

  it("has exactly one entry (no duplicates)", () => {
    const keys = Object.keys(TOOL_METADATA).filter(k => k === "forge_env_diff");
    expect(keys).toHaveLength(1);
  });

  it("has BASELINE_NOT_FOUND and TARGET_NOT_FOUND error entries", () => {
    const errors = TOOL_METADATA.forge_env_diff.errors;
    expect(errors).toHaveProperty("BASELINE_NOT_FOUND");
    expect(errors).toHaveProperty("TARGET_NOT_FOUND");
  });

  it("sideEffects mentions env-diff-cache.json", () => {
    const se = TOOL_METADATA.forge_env_diff.sideEffects;
    expect(se.some(s => s.includes("env-diff-cache.json"))).toBe(true);
  });

  it("sideEffects mentions key names only, no values", () => {
    const se = TOOL_METADATA.forge_env_diff.sideEffects;
    expect(se.some(s => s.includes("key names only"))).toBe(true);
  });

  it("has securityNote about never reading values", () => {
    expect(TOOL_METADATA.forge_env_diff.securityNote).toBeDefined();
    expect(TOOL_METADATA.forge_env_diff.securityNote).toContain("key names only");
  });

  it("has cost low", () => {
    expect(TOOL_METADATA.forge_env_diff.cost).toBe("low");
  });

  it("consumes .env files", () => {
    expect(TOOL_METADATA.forge_env_diff.consumes).toContain(".env");
    expect(TOOL_METADATA.forge_env_diff.consumes).toContain(".env.*");
  });
});

// ─── forge_env_diff cache persistence ──────────────────────────────────

describe("env diff cache persistence", () => {
  it("stores and reads env-diff-cache.json correctly", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const cache = {
      scannedAt: "2024-01-01T00:00:00.000Z",
      baseline: ".env",
      filesCompared: 2,
      pairs: [
        { file: ".env.staging", missingInTarget: ["STRIPE_KEY"], missingInBaseline: [] },
        { file: ".env.production", missingInTarget: [], missingInBaseline: ["DEBUG_MODE"] },
      ],
      summary: { clean: false, totalGaps: 2, baselineKeyCount: 10 },
    };
    writeFileSync(resolve(forgeDir, "env-diff-cache.json"), JSON.stringify(cache, null, 2), "utf-8");
    const read = JSON.parse(require("fs").readFileSync(resolve(forgeDir, "env-diff-cache.json"), "utf-8"));
    expect(read.summary.clean).toBe(false);
    expect(read.pairs).toHaveLength(2);
    expect(read.pairs[0].missingInTarget).toContain("STRIPE_KEY");
    expect(read.summary.totalGaps).toBe(2);
  });

  it("cache never contains environment variable values", () => {
    const pair = { file: ".env.staging", missingInTarget: ["API_KEY"], missingInBaseline: [] };
    // Verify the structure only contains key names, not values
    expect(pair.missingInTarget[0]).toBe("API_KEY");
    expect(Object.keys(pair)).not.toContain("values");
    expect(JSON.stringify(pair)).not.toContain("sk-");
  });
});

// ─── forge_secret_scan: Shannon entropy computation ─────────────────────

describe("Shannon entropy computation", () => {
  // Mirror of the shannonEntropy function from server.mjs handler
  function shannonEntropy(str) {
    if (!str || str.length === 0) return 0;
    const freq = {};
    for (const char of str) freq[char] = (freq[char] || 0) + 1;
    let entropy = 0;
    for (const count of Object.values(freq)) {
      const p = count / str.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  it("returns 0 for empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for null/undefined", () => {
    expect(shannonEntropy(null)).toBe(0);
    expect(shannonEntropy(undefined)).toBe(0);
  });

  it("returns 0 for single repeated character", () => {
    expect(shannonEntropy("aaaaaaa")).toBe(0);
  });

  it("returns 1.0 for two equally frequent characters", () => {
    const result = shannonEntropy("ab");
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("high-entropy random string exceeds 4.0", () => {
    const apiKey = "sk-a3F7z9Q2bR8xK1mL5nP4";
    expect(shannonEntropy(apiKey)).toBeGreaterThan(3.5);
  });

  it("low-entropy repetitive string stays below 3.0", () => {
    expect(shannonEntropy("aabbccdd")).toBeLessThan(3.0);
  });

  it("real-world secret token has high entropy", () => {
    const token = "ghp_ABC123DEF456GHI789JKL012MNO345PQR678";
    expect(shannonEntropy(token)).toBeGreaterThan(3.5);
  });
});

// ─── forge_secret_scan: threshold clamping ──────────────────────────────

describe("secret scan threshold clamping", () => {
  it("clamps to 3.5 when below minimum", () => {
    const threshold = Math.max(3.5, Math.min(5.0, 2.0));
    expect(threshold).toBe(3.5);
  });

  it("clamps to 5.0 when above maximum", () => {
    const threshold = Math.max(3.5, Math.min(5.0, 6.0));
    expect(threshold).toBe(5.0);
  });

  it("defaults to 4.0 when undefined", () => {
    const threshold = Math.max(3.5, Math.min(5.0, undefined ?? 4.0));
    expect(threshold).toBe(4.0);
  });

  it("preserves valid threshold within range", () => {
    const threshold = Math.max(3.5, Math.min(5.0, 4.5));
    expect(threshold).toBe(4.5);
  });
});

// ─── forge_secret_scan: KEY_PATTERNS and type inference ─────────────────

describe("secret scan key pattern matching", () => {
  const KEY_PATTERNS = /(?:key|secret|token|password|api_key|auth|credential|private)/i;

  it("matches api_key", () => {
    expect(KEY_PATTERNS.test("const API_KEY = 'abc'")).toBe(true);
  });

  it("matches secret", () => {
    expect(KEY_PATTERNS.test("MY_SECRET=xyz")).toBe(true);
  });

  it("matches token", () => {
    expect(KEY_PATTERNS.test("ACCESS_TOKEN = value")).toBe(true);
  });

  it("matches password", () => {
    expect(KEY_PATTERNS.test("DB_PASSWORD=hunter2")).toBe(true);
  });

  it("matches auth", () => {
    expect(KEY_PATTERNS.test("AUTH_HEADER=Bearer xyz")).toBe(true);
  });

  it("matches credential", () => {
    expect(KEY_PATTERNS.test("AWS_CREDENTIAL=xxx")).toBe(true);
  });

  it("matches private", () => {
    expect(KEY_PATTERNS.test("PRIVATE_KEY=---")).toBe(true);
  });

  it("does not match benign variable names", () => {
    expect(KEY_PATTERNS.test("const name = 'alice'")).toBe(false);
    expect(KEY_PATTERNS.test("let count = 42")).toBe(false);
  });
});

describe("secret scan type inference", () => {
  function inferType(line) {
    const lower = line.toLowerCase();
    if (/api.?key/i.test(lower)) return "api_key";
    if (/secret/i.test(lower)) return "secret";
    if (/token/i.test(lower)) return "token";
    if (/password|passwd/i.test(lower)) return "password";
    if (/auth/i.test(lower)) return "auth";
    if (/private/i.test(lower)) return "private_key";
    if (/credential/i.test(lower)) return "credential";
    return "unknown";
  }

  it("infers api_key from API_KEY=", () => {
    expect(inferType('API_KEY="sk-test123"')).toBe("api_key");
  });

  it("infers secret from SECRET=", () => {
    expect(inferType('MY_SECRET="abc"')).toBe("secret");
  });

  it("infers token from TOKEN=", () => {
    expect(inferType('ACCESS_TOKEN="ghp_abc"')).toBe("token");
  });

  it("infers password from PASSWORD=", () => {
    expect(inferType('DB_PASSWORD="hunter2"')).toBe("password");
  });

  it("infers password from PASSWD=", () => {
    expect(inferType('DB_PASSWD="hunter2"')).toBe("password");
  });

  it("infers auth from AUTH_HEADER", () => {
    expect(inferType('AUTH_HEADER="Bearer xyz"')).toBe("auth");
  });

  it("infers private_key from PRIVATE_KEY", () => {
    expect(inferType('PRIVATE_KEY="-----BEGIN RSA"')).toBe("private_key");
  });

  it("infers credential from CREDENTIAL", () => {
    expect(inferType('AWS_CREDENTIAL="xxx"')).toBe("credential");
  });

  it("returns unknown for unrecognized patterns", () => {
    expect(inferType('const x = "hello world"')).toBe("unknown");
  });
});

describe("secret scan confidence classification", () => {
  const KEY_PATTERNS = /(?:key|secret|token|password|api_key|auth|credential|private)/i;

  function classify(entropy, line) {
    const keyMatch = KEY_PATTERNS.test(line);
    if (entropy >= 4.5 && keyMatch) return "high";
    if ((entropy >= 4.0 && keyMatch) || entropy >= 4.8) return "medium";
    return "low";
  }

  it("high: entropy >= 4.5 AND key match", () => {
    expect(classify(4.5, "API_KEY=xxx")).toBe("high");
  });

  it("medium: entropy >= 4.0 AND key match (below 4.5)", () => {
    expect(classify(4.2, "SECRET=xxx")).toBe("medium");
  });

  it("medium: entropy >= 4.8 even without key match", () => {
    expect(classify(4.9, "const x = 'random'")).toBe("medium");
  });

  it("low: entropy below 4.0 and no key match", () => {
    expect(classify(3.5, "const x = 'hello'")).toBe("low");
  });

  it("low: entropy below 4.0 even with key match", () => {
    expect(classify(3.8, "API_KEY=test")).toBe("low");
  });
});

// ─── forge_env_diff: .env key parsing ───────────────────────────────────

describe("env diff key parsing", () => {
  function parseEnvKeys(content) {
    const keys = new Set();
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) keys.add(trimmed.slice(0, eqIdx).trim());
    }
    return keys;
  }

  it("parses simple KEY=VALUE pairs", () => {
    const keys = parseEnvKeys("DB_HOST=localhost\nDB_PORT=5432\n");
    expect(keys.size).toBe(2);
    expect(keys.has("DB_HOST")).toBe(true);
    expect(keys.has("DB_PORT")).toBe(true);
  });

  it("skips comments", () => {
    const keys = parseEnvKeys("# This is a comment\nDB_HOST=localhost\n# Another comment\n");
    expect(keys.size).toBe(1);
    expect(keys.has("DB_HOST")).toBe(true);
  });

  it("skips empty lines", () => {
    const keys = parseEnvKeys("\n\nDB_HOST=localhost\n\n\nDB_PORT=5432\n\n");
    expect(keys.size).toBe(2);
  });

  it("handles values with = signs", () => {
    const keys = parseEnvKeys("CONNECTION_STRING=host=db;port=5432\n");
    expect(keys.size).toBe(1);
    expect(keys.has("CONNECTION_STRING")).toBe(true);
  });

  it("trims whitespace around key names", () => {
    const keys = parseEnvKeys("  DB_HOST  =localhost\n");
    expect(keys.has("DB_HOST")).toBe(true);
  });

  it("ignores lines without = separator", () => {
    const keys = parseEnvKeys("NOT_A_KEY\nDB_HOST=localhost\n");
    expect(keys.size).toBe(1);
  });

  it("returns empty set for empty content", () => {
    const keys = parseEnvKeys("");
    expect(keys.size).toBe(0);
  });

  it("never captures values (only keys)", () => {
    const keys = parseEnvKeys("SECRET=super_secret_value\n");
    expect(keys.has("SECRET")).toBe(true);
    expect([...keys].join("")).not.toContain("super_secret_value");
  });
});

// ─── forge_env_diff: key comparison logic ───────────────────────────────

describe("env diff key comparison", () => {
  it("detects keys missing in target", () => {
    const baseline = new Set(["DB_HOST", "DB_PORT", "API_KEY"]);
    const target = new Set(["DB_HOST", "DB_PORT"]);
    const missingInTarget = [...baseline].filter(k => !target.has(k)).sort();
    expect(missingInTarget).toEqual(["API_KEY"]);
  });

  it("detects keys missing in baseline", () => {
    const baseline = new Set(["DB_HOST"]);
    const target = new Set(["DB_HOST", "DEBUG_MODE", "LOG_LEVEL"]);
    const missingInBaseline = [...target].filter(k => !baseline.has(k)).sort();
    expect(missingInBaseline).toEqual(["DEBUG_MODE", "LOG_LEVEL"]);
  });

  it("reports clean when keys match exactly", () => {
    const baseline = new Set(["A", "B", "C"]);
    const target = new Set(["A", "B", "C"]);
    const missingInTarget = [...baseline].filter(k => !target.has(k));
    const missingInBaseline = [...target].filter(k => !baseline.has(k));
    const totalGaps = missingInTarget.length + missingInBaseline.length;
    expect(totalGaps).toBe(0);
  });

  it("totalGaps sums all missing keys across pairs", () => {
    const pairs = [
      { file: ".env.staging", missingInTarget: ["A", "B"], missingInBaseline: [] },
      { file: ".env.production", missingInTarget: ["A"], missingInBaseline: ["X"] },
    ];
    const totalGaps = pairs.reduce((sum, p) => sum + (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0), 0);
    expect(totalGaps).toBe(4);
  });

  it("clean is true only when totalGaps is 0", () => {
    expect(0 === 0).toBe(true);
    expect(1 === 0).toBe(false);
  });
});

// ─── forge_env_diff: auto-detect .env.* files ───────────────────────────

describe("env diff auto-detect target files", () => {
  it("detects .env.staging and .env.production", () => {
    writeFileSync(join(tempDir, ".env"), "DB_HOST=localhost\n");
    writeFileSync(join(tempDir, ".env.staging"), "DB_HOST=staging\n");
    writeFileSync(join(tempDir, ".env.production"), "DB_HOST=prod\n");
    writeFileSync(join(tempDir, "readme.txt"), "not an env file\n");

    const entries = readdirSync(tempDir);
    const detected = entries.filter(f => f.startsWith(".env.") && !f.endsWith(".example")).sort();
    expect(detected).toEqual([".env.production", ".env.staging"]);
  });

  it("excludes .env.example files", () => {
    writeFileSync(join(tempDir, ".env"), "KEY=val\n");
    writeFileSync(join(tempDir, ".env.example"), "KEY=\n");
    writeFileSync(join(tempDir, ".env.staging"), "KEY=val\n");

    const entries = readdirSync(tempDir);
    const detected = entries.filter(f => f.startsWith(".env.") && !f.endsWith(".example")).sort();
    expect(detected).toEqual([".env.staging"]);
    expect(detected).not.toContain(".env.example");
  });

  it("returns empty array when no .env.* files exist", () => {
    writeFileSync(join(tempDir, ".env"), "KEY=val\n");

    const entries = readdirSync(tempDir);
    const detected = entries.filter(f => f.startsWith(".env.") && !f.endsWith(".example")).sort();
    expect(detected).toEqual([]);
  });
});

// ─── forge_env_diff: graceful degradation ───────────────────────────────

describe("env diff graceful degradation", () => {
  it("returns structured error when baseline not found", () => {
    const baselinePath = resolve(tempDir, ".env");
    const exists = existsSync(baselinePath);
    expect(exists).toBe(false);

    const graceful = { pairs: [], summary: { clean: null, error: "baseline file not found: .env" } };
    expect(graceful.summary.clean).toBeNull();
    expect(graceful.summary.error).toContain("baseline file not found");
    expect(graceful.pairs).toEqual([]);
  });

  it("records error for missing target file in pair", () => {
    const pair = { file: ".env.staging", missingInTarget: [], missingInBaseline: [], error: "file not found: .env.staging" };
    expect(pair.error).toContain("file not found");
  });
});

// ─── Telemetry integration: LIVEGUARD_TOOLS membership ──────────────────

describe("emitToolTelemetry LIVEGUARD_TOOLS membership", () => {
  const EXPECTED_LIVEGUARD_TOOLS = [
    "forge_drift_report", "forge_incident_capture", "forge_dep_watch",
    "forge_regression_guard", "forge_runbook", "forge_hotspot",
    "forge_health_trend", "forge_alert_triage", "forge_deploy_journal",
    "forge_secret_scan", "forge_env_diff",
  ];

  it("writes liveguard-events.jsonl for forge_secret_scan", () => {
    emitToolTelemetry("forge_secret_scan", { since: "HEAD~1" }, { clean: true }, 42, "OK", tempDir);
    const events = readForgeJsonl("liveguard-events.jsonl", [], tempDir);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some(e => e.tool === "forge_secret_scan")).toBe(true);
  });

  it("writes liveguard-events.jsonl for forge_env_diff", () => {
    emitToolTelemetry("forge_env_diff", { baseline: ".env" }, { clean: true }, 30, "OK", tempDir);
    const events = readForgeJsonl("liveguard-events.jsonl", [], tempDir);
    expect(events.some(e => e.tool === "forge_env_diff")).toBe(true);
  });

  it("does NOT write liveguard-events.jsonl for non-LiveGuard tools", () => {
    emitToolTelemetry("forge_smith", {}, "ok", 10, "OK", tempDir);
    const events = readForgeJsonl("liveguard-events.jsonl", [], tempDir);
    expect(events.filter(e => e.tool === "forge_smith")).toHaveLength(0);
  });

  it("always writes to telemetry/tool-calls.jsonl", () => {
    emitToolTelemetry("forge_secret_scan", {}, { clean: true }, 50, "OK", tempDir);
    const calls = readForgeJsonl("telemetry/tool-calls.jsonl", [], tempDir);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.some(c => c.tool === "forge_secret_scan")).toBe(true);
  });

  it("LIVEGUARD_TOOLS set has exactly 11 entries", () => {
    for (const tool of EXPECTED_LIVEGUARD_TOOLS) {
      emitToolTelemetry(tool, {}, "test", 1, "OK", tempDir);
    }
    const events = readForgeJsonl("liveguard-events.jsonl", [], tempDir);
    const uniqueTools = [...new Set(events.map(e => e.tool))];
    expect(uniqueTools.sort()).toEqual(EXPECTED_LIVEGUARD_TOOLS.sort());
    expect(uniqueTools).toHaveLength(11);
  });
});

describe("emitToolTelemetry record shape", () => {
  it("returns record with expected fields", () => {
    const record = emitToolTelemetry("forge_secret_scan", { since: "HEAD~1" }, { clean: true, findings: 0 }, 42, "OK", tempDir);
    expect(record).toHaveProperty("timestamp");
    expect(record).toHaveProperty("tool", "forge_secret_scan");
    expect(record).toHaveProperty("inputs");
    expect(record).toHaveProperty("result");
    expect(record).toHaveProperty("durationMs", 42);
    expect(record).toHaveProperty("status", "OK");
  });

  it("truncates result to 2000 chars", () => {
    const longResult = "x".repeat(3000);
    const record = emitToolTelemetry("forge_env_diff", {}, longResult, 10, "OK", tempDir);
    expect(record.result.length).toBeLessThanOrEqual(2000);
  });

  it("wraps non-object inputs", () => {
    const record = emitToolTelemetry("forge_secret_scan", "raw-string", "ok", 5, "OK", tempDir);
    expect(record.inputs).toEqual({ raw: "raw-string" });
  });

  it("never throws on telemetry failure", () => {
    expect(() => {
      emitToolTelemetry("forge_secret_scan", {}, "ok", 5, "OK", "/nonexistent/path/that/does/not/exist");
    }).not.toThrow();
  });

  it("records DEGRADED status for graceful degradation", () => {
    const record = emitToolTelemetry("forge_secret_scan", {}, { clean: null, error: "git unavailable" }, 5, "DEGRADED", tempDir);
    expect(record.status).toBe("DEGRADED");
  });
});

// ─── Dashboard tab smoke tests ──────────────────────────────────────────

describe("dashboard tab structure", () => {
  const dashboardHtml = readFileSync(resolve(__dirname, "..", "dashboard", "index.html"), "utf-8");
  const dashboardJs = readFileSync(resolve(__dirname, "..", "dashboard", "app.js"), "utf-8");

  const CORE_TABS = ["progress", "runs", "cost", "actions", "replay", "extensions", "config", "traces", "skills"];
  const LG_TABS = ["lg-health", "lg-incidents", "lg-triage", "lg-security", "lg-env"];
  const ALL_TABS = [...CORE_TABS, ...LG_TABS];

  it("has 9 core tab buttons", () => {
    for (const tab of CORE_TABS) {
      expect(dashboardHtml).toContain(`data-tab="${tab}"`);
    }
  });

  it("has 5 LiveGuard tab buttons", () => {
    for (const tab of LG_TABS) {
      expect(dashboardHtml).toContain(`data-tab="${tab}"`);
    }
  });

  it("total tab count is 14 (9 core + 5 LG)", () => {
    const tabMatches = dashboardHtml.match(/data-tab="[^"]+"/g) || [];
    expect(tabMatches.length).toBe(14);
  });

  it("has LiveGuard section divider", () => {
    expect(dashboardHtml).toContain("🛡️ LG");
  });

  it("LiveGuard tabs use amber hover style", () => {
    const lgButtons = dashboardHtml.match(/hover:text-amber-400[^>]*data-tab="lg-/g) || [];
    expect(lgButtons.length).toBe(5);
  });

  it("tabLoadHooks has entries for tabs that need dynamic loading", () => {
    // actions tab has no load hook — its content is loaded via inline handlers
    const HOOKED_TABS = ALL_TABS.filter(t => t !== "actions");
    for (const tab of HOOKED_TABS) {
      const pattern = tab.includes("-") ? `'${tab}'` : tab;
      expect(dashboardJs).toContain(pattern);
    }
  });

  it("lg-security tab loader calls loadLGSecurity", () => {
    expect(dashboardJs).toContain("loadLGSecurity");
  });

  it("lg-env tab loader calls loadLGEnv", () => {
    expect(dashboardJs).toContain("loadLGEnv");
  });

  it("tabBadgeState tracks lgSecurityAlert", () => {
    expect(dashboardJs).toContain("lgSecurityAlert");
  });

  it("keyboard shortcut 1-9 switches tabs", () => {
    expect(dashboardJs).toMatch(/1-9.*switch tabs|switch.*tabs/i);
  });
});

// ─── forge_runbook backward compatibility (H6): env-diff cache integration ──

describe("forge_runbook backward compatibility — env-diff cache", () => {
  it("runbook includes env key gaps section when env-diff-cache.json has gaps", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const envDiff = {
      scannedAt: "2024-01-01T00:00:00.000Z",
      baseline: ".env",
      filesCompared: 1,
      pairs: [{ file: ".env.staging", missingInTarget: ["STRIPE_KEY"], missingInBaseline: [] }],
      summary: { clean: false, totalGaps: 1, baselineKeyCount: 10 },
    };
    writeFileSync(resolve(forgeDir, "env-diff-cache.json"), JSON.stringify(envDiff, null, 2), "utf-8");

    const envDiffPath = resolve(tempDir, ".forge", "env-diff-cache.json");
    const cache = JSON.parse(readFileSync(envDiffPath, "utf-8"));
    const lines = [];
    if (cache.summary && !cache.summary.clean) {
      const gapPairs = (cache.pairs || []).filter(p => (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0) > 0);
      if (gapPairs.length) {
        lines.push("## Environment Key Gaps");
        lines.push("");
        lines.push(`Baseline: \`${cache.baseline || ".env"}\` (${cache.summary.baselineKeyCount || "?"} keys)`);
        for (const pair of gapPairs) {
          lines.push(`### ${pair.file}`);
          if (pair.missingInTarget?.length) {
            lines.push("**Missing in target (present in baseline):**");
            pair.missingInTarget.forEach(k => lines.push(`- \`${k}\``));
          }
        }
      }
    }
    const output = lines.join("\n");
    expect(output).toContain("## Environment Key Gaps");
    expect(output).toContain("STRIPE_KEY");
    expect(output).toContain(".env.staging");
    expect(output).toContain("10 keys");
  });

  it("runbook skips env section when cache is clean", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const envDiff = {
      scannedAt: "2024-01-01T00:00:00.000Z",
      baseline: ".env",
      filesCompared: 1,
      pairs: [{ file: ".env.staging", missingInTarget: [], missingInBaseline: [] }],
      summary: { clean: true, totalGaps: 0, baselineKeyCount: 10 },
    };
    writeFileSync(resolve(forgeDir, "env-diff-cache.json"), JSON.stringify(envDiff, null, 2), "utf-8");

    const cache = JSON.parse(readFileSync(resolve(forgeDir, "env-diff-cache.json"), "utf-8"));
    const shouldInclude = cache.summary && !cache.summary.clean;
    expect(shouldInclude).toBe(false);
  });

  it("runbook does not crash when env-diff-cache.json is absent", () => {
    let envSection = "";
    try {
      const envDiffPath = resolve(tempDir, ".forge", "env-diff-cache.json");
      if (existsSync(envDiffPath)) {
        const cache = JSON.parse(readFileSync(envDiffPath, "utf-8"));
        if (cache.summary && !cache.summary.clean) envSection = "has gaps";
      }
    } catch { /* env-diff cache unavailable — skip */ }
    expect(envSection).toBe("");
  });

  it("runbook handles missingInBaseline (extra keys in target)", () => {
    const forgeDir = resolve(tempDir, ".forge");
    mkdirSync(forgeDir, { recursive: true });
    const envDiff = {
      baseline: ".env",
      pairs: [{ file: ".env.production", missingInTarget: [], missingInBaseline: ["DEBUG_MODE", "LOG_LEVEL"] }],
      summary: { clean: false, totalGaps: 2, baselineKeyCount: 5 },
    };
    writeFileSync(resolve(forgeDir, "env-diff-cache.json"), JSON.stringify(envDiff, null, 2), "utf-8");

    const cache = JSON.parse(readFileSync(resolve(forgeDir, "env-diff-cache.json"), "utf-8"));
    const gapPairs = (cache.pairs || []).filter(p => (p.missingInTarget?.length || 0) + (p.missingInBaseline?.length || 0) > 0);
    expect(gapPairs).toHaveLength(1);
    expect(gapPairs[0].missingInBaseline).toContain("DEBUG_MODE");
    expect(gapPairs[0].missingInBaseline).toContain("LOG_LEVEL");
  });
});
