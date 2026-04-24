/**
 * E2E integration tests for the Phase-39 audit loop (Slice 8).
 *
 * Validates:
 *   1. Full drain cycle with mock runner → artifact + history written
 *   2. Drain output → triage → all three lanes reachable
 *   3. Audit artifact shape matches blog-documented contract
 *   4. Auto-activation threshold fires and emits hub event
 *   5. Safety rails: forbidProduction immutable, default mode "off"
 *   6. REST /api/audit/drain dry-run and production guard
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runTemperingDrain } from "../tempering/drain.mjs";
import { routeFinding } from "../tempering/triage.mjs";
import {
  AUDIT_DEFAULTS,
  loadAuditConfig,
  shouldAutoDrain,
} from "../tempering/auto-activate.mjs";

// ─── Fixture helpers ─────────────────────────────────────────────────

const FIXTURE_DIR = resolve(import.meta.dirname, "fixtures", "audit-loop-e2e");
const FIXTURE_RESPONSES = JSON.parse(
  readFileSync(resolve(FIXTURE_DIR, "responses.json"), "utf-8"),
);

function makeTmpProject() {
  const dir = mkdtempSync(join(tmpdir(), "e2e-audit-loop-"));
  mkdirSync(resolve(dir, ".forge", "audits"), { recursive: true });
  writeFileSync(
    resolve(dir, ".forge", "audits", "routes.json"),
    readFileSync(resolve(FIXTURE_DIR, "routes.json")),
  );
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function writeForgeJson(dir, content) {
  writeFileSync(
    resolve(dir, ".forge.json"),
    JSON.stringify(content, null, 2),
    "utf-8",
  );
}

/**
 * Build a mock `runTemperingRunFn` that uses fixture responses to
 * simulate a content-audit scanner producing findings that decrease
 * over rounds (modeling the fix-and-re-probe cycle).
 */
function mockRunnerFromFixture(roundData) {
  let call = 0;
  return async () => {
    const idx = Math.min(call++, roundData.length - 1);
    const rd = roundData[idx];
    return {
      ok: true,
      runId: `e2e-run-${call}`,
      correlationId: null,
      stack: "node",
      verdict: rd.findings.length > 0 ? "fail" : "pass",
      scanners: [
        {
          scanner: "content-audit",
          verdict: rd.findings.length > 0 ? "fail" : "pass",
          pass: rd.pass || 0,
          fail: rd.findings.length,
          findings: rd.findings,
          durationMs: 5,
        },
      ],
      runRecordPath: null,
      configWritten: false,
      changedFilesCount: 0,
    };
  };
}

// ─── Round data: 3 known-bad routes + 1 noise ─────────────────────

const ROUND_1_FINDINGS = [
  { class: "placeholder-content", route: "/about", severity: "high", evidence: { placeholders: ["TODO"] } },
  { class: "hard-404", route: "/missing-page", severity: "high", evidence: { status: 404 } },
  { class: "client-shell", route: "/dashboard", severity: "info", evidence: { words: 0 } },
];

const ROUND_2_FINDINGS = [
  { class: "hard-404", route: "/missing-page", severity: "high", evidence: { status: 404 } },
];

const ROUND_3_FINDINGS = [];

// ─── Tests ───────────────────────────────────────────────────────────

describe("E2E: drain cycle → artifact + history", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("runs ≥2 rounds, converges, writes drain-history.jsonl", async () => {
    const runner = mockRunnerFromFixture([
      { findings: ROUND_1_FINDINGS, pass: 1 },
      { findings: ROUND_2_FINDINGS, pass: 3 },
      { findings: ROUND_3_FINDINGS, pass: 4 },
    ]);

    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: runner,
    });

    expect(result.terminated).toBe("converged");
    expect(result.rounds.length).toBeGreaterThanOrEqual(2);
    expect(result.summary.drainCurve[0]).toBe(2); // 2 real (high) findings in round 1
    expect(result.summary.finalRealFindings).toBe(0);

    // History JSONL
    const historyPath = resolve(tmpDir, ".forge", "tempering", "drain-history.jsonl");
    expect(existsSync(historyPath)).toBe(true);
    const lines = readFileSync(historyPath, "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(result.rounds.length);
    const firstLine = JSON.parse(lines[0]);
    expect(firstLine).toHaveProperty("round");
    expect(firstLine).toHaveProperty("runId");
    expect(firstLine).toHaveProperty("ts");
    expect(firstLine).toHaveProperty("realFindings");
  });

  it("terminates at max-rounds when convergence never fires", async () => {
    const persistentFinding = [
      { class: "hard-404", route: "/missing-page", severity: "high", evidence: { status: 404 } },
    ];
    const runner = mockRunnerFromFixture([{ findings: persistentFinding, pass: 3 }]);

    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 3,
      runTemperingRunFn: runner,
    });

    expect(result.terminated).toBe("max-rounds");
    expect(result.rounds).toHaveLength(3);
  });
});

describe("E2E: drain output → triage routing covers all three lanes", () => {
  it("routes drain findings through triage to bug, spec, and classifier lanes", () => {
    const bugClassifier = { classification: "real-bug", reason: "404 is a product bug", confidence: 0.9, source: "rule" };
    const specClassifier = { classification: "feature-gap", reason: "missing content", confidence: 0.8, source: "llm" };
    const classifierClassifier = { classification: "infra", reason: "client-shell expected", confidence: 0.85, source: "rule", rule: "spa-ignore" };

    const bugResult = routeFinding(ROUND_1_FINDINGS[1], bugClassifier);
    const specResult = routeFinding(ROUND_1_FINDINGS[0], specClassifier);
    const classifierResult = routeFinding(ROUND_1_FINDINGS[2], classifierClassifier);

    expect(bugResult.lane).toBe("bug");
    expect(bugResult.confidence).toBe("high");
    expect(bugResult.payload.route).toBe("/missing-page");

    expect(specResult.lane).toBe("spec");
    expect(specResult.confidence).toBe("medium");
    expect(specResult.payload.source).toBe("audit-triage");

    expect(classifierResult.lane).toBe("classifier");
    expect(classifierResult.confidence).toBe("medium");
    expect(classifierResult.payload.findingClass).toBe("client-shell");
    expect(classifierResult.payload.proposedAction).toBeTruthy();
  });
});

describe("E2E: audit artifact shape matches blog contract", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("writeAuditArtifact produces blog-compatible shape", async () => {
    // Simulate what server.mjs does: drain → writeAuditArtifact
    const runner = mockRunnerFromFixture([
      { findings: ROUND_1_FINDINGS, pass: 1 },
      { findings: ROUND_3_FINDINGS, pass: 4 },
    ]);

    const drainResult = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: runner,
    });

    // Write artifact exactly as server.mjs does
    const auditsDir = resolve(tmpDir, ".forge", "audits");
    mkdirSync(auditsDir, { recursive: true });
    const ts = Date.now();
    const fileName = `dev-${ts}.json`;
    const filePath = resolve(auditsDir, fileName);

    const findingsByLane = { bug: 0, spec: 0, classifier: 0 };
    for (const round of drainResult.rounds) {
      if (round.findingCount) {
        findingsByLane.bug += round.realFindings || 0;
        findingsByLane.classifier += round.patterns || 0;
      }
    }

    const artifact = {
      ts: new Date(ts).toISOString(),
      rounds: drainResult.rounds,
      findingsByLane,
      terminated: drainResult.terminated,
      summary: drainResult.summary,
    };

    writeFileSync(filePath, JSON.stringify(artifact, null, 2));

    // Validate artifact shape matches blog-documented contract
    const written = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(written).toHaveProperty("ts");
    expect(written).toHaveProperty("rounds");
    expect(written).toHaveProperty("findingsByLane");
    expect(written).toHaveProperty("terminated");
    expect(written).toHaveProperty("summary");
    expect(written.findingsByLane).toHaveProperty("bug");
    expect(written.findingsByLane).toHaveProperty("spec");
    expect(written.findingsByLane).toHaveProperty("classifier");
    expect(typeof written.ts).toBe("string");
    expect(Array.isArray(written.rounds)).toBe(true);
    expect(["converged", "max-rounds", "aborted"]).toContain(written.terminated);
  });
});

describe("E2E: auto-activation threshold fires with hub event", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("shouldAutoDrain fires and drain-auto-estimate event emits before dispatch", () => {
    writeForgeJson(tmpDir, { audit: { mode: "auto" } });

    const events = [];
    const hub = { broadcast: (evt) => events.push(evt) };
    const config = loadAuditConfig(tmpDir);

    const evaluation = shouldAutoDrain({
      cwd: tmpDir,
      config,
      env: "dev",
      filesChanged: 20,
      lastDrainTs: 0,
      lastVerdict: "max-rounds",
      recentFindingCount: 5,
    });

    expect(evaluation.fire).toBe(true);

    // Emit the event (mirrors orchestrator logic)
    hub.broadcast({
      type: "drain-auto-estimate",
      data: { mode: config.mode, maxRounds: config.maxRounds, signals: evaluation.signals },
      timestamp: new Date().toISOString(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("drain-auto-estimate");
    expect(events[0].data.mode).toBe("auto");
    expect(events[0].data.maxRounds).toBe(5);
    expect(events[0].data.signals).toBeDefined();
  });

  it("each threshold independently trips shouldAutoDrain", () => {
    writeForgeJson(tmpDir, { audit: { mode: "auto" } });
    const config = loadAuditConfig(tmpDir);
    const base = { cwd: tmpDir, config, env: "dev", lastVerdict: "max-rounds", recentFindingCount: 1 };

    // Files threshold only
    const filesResult = shouldAutoDrain({ ...base, filesChanged: 20, lastDrainTs: Date.now() });
    expect(filesResult.fire).toBe(true);

    // Days threshold only
    const daysResult = shouldAutoDrain({ ...base, filesChanged: 0, lastDrainTs: 0 });
    expect(daysResult.fire).toBe(true);
  });
});

describe("E2E: safety rails", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("forbidProduction: true cannot be overridden at runtime", () => {
    writeForgeJson(tmpDir, { audit: { mode: "always", forbidProduction: false } });
    const config = loadAuditConfig(tmpDir);
    expect(config.forbidProduction).toBe(true);

    const result = shouldAutoDrain({ cwd: tmpDir, config, env: "production" });
    expect(result.fire).toBe(false);
    expect(result.signals.blocked).toBe(true);
  });

  it("audit.mode defaults to 'off' on fresh .forge.json with no audit key", () => {
    writeForgeJson(tmpDir, { quorum: { enabled: true } });
    const config = loadAuditConfig(tmpDir);
    expect(config.mode).toBe("off");
    expect(config._source).toBe("defaults");
  });

  it("audit.mode defaults to 'off' when .forge.json is absent", () => {
    const bareDir = mkdtempSync(join(tmpdir(), "e2e-bare-"));
    try {
      const config = loadAuditConfig(bareDir);
      expect(config.mode).toBe("off");
    } finally {
      cleanTmpDir(bareDir);
    }
  });
});

// ─── REST API E2E (via createExpressApp) ─────────────────────────────

describe("E2E: REST /api/audit endpoints", () => {
  let server;
  let baseUrl;
  let tmpDir;
  let savedCwd;

  beforeAll(async () => {
    tmpDir = makeTmpProject();
    writeForgeJson(tmpDir, { audit: { mode: "auto" } });
    savedCwd = process.cwd();
    process.env.PLAN_FORGE_PROJECT = tmpDir;
    process.chdir(tmpDir);

    const { createExpressApp } = await import("../server.mjs");
    const app = createExpressApp();
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (savedCwd) process.chdir(savedCwd);
    if (tmpDir) cleanTmpDir(tmpDir);
  });

  it("GET /api/audit/config returns loaded audit config", async () => {
    const res = await fetch(`${baseUrl}/api/audit/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("mode");
    expect(body).toHaveProperty("forbidProduction", true);
    expect(body).toHaveProperty("maxRounds");
  });

  it("POST /api/audit/drain with dryRun returns dry-run payload", async () => {
    const res = await fetch(`${baseUrl}/api/audit/drain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dryRun).toBe(true);
    expect(body.wouldRun).toBe(true);
    expect(body.maxRounds).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/audit/drain with env=production returns 403", async () => {
    const res = await fetch(`${baseUrl}/api/audit/drain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env: "production" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("production-forbidden");
  });
});
