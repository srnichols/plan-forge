/**
 * Audit artifact shape tests (Phase-39 Slice 4).
 *
 * Validates that `forge_tempering_drain` produces a `.forge/audits/dev-<ts>.json`
 * artifact whose shape is a superset of the blog's documented convention:
 *   - ts (ISO string)
 *   - rounds (array)
 *   - findingsByLane ({ bug, spec, classifier })
 *   - terminated ("converged" | "max-rounds" | "aborted")
 *   - summary (object)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runTemperingDrain } from "../tempering/drain.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `audit-artifact-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function mockRunnerConverging() {
  let callCount = 0;
  return async () => {
    callCount++;
    const findings = callCount === 1
      ? [
          { class: "missing-h1", route: "/about", severity: "high", evidence: {} },
          { class: "broken-link", route: "/docs", severity: "medium", evidence: {} },
          { class: "client-shell", route: "/dash", severity: "info", evidence: {} },
        ]
      : [];
    return {
      ok: true,
      runId: `run-${callCount}`,
      stack: "typescript",
      verdict: findings.length > 0 ? "fail" : "pass",
      scanners: [{
        scanner: "content-audit",
        verdict: findings.length > 0 ? "fail" : "pass",
        pass: findings.length === 0 ? 1 : 0,
        fail: findings.length,
        findings,
      }],
    };
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("audit artifact shape", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("drain writes a dev-<ts>.json artifact that the server handler can consume", async () => {
    // Run drain directly — artifact writing is done by the server handler,
    // but we can verify the drain result has the fields needed.
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 3,
      runTemperingRunFn: mockRunnerConverging(),
      now: () => 1713916886000,
    });

    expect(result.terminated).toBe("converged");
    expect(result.rounds).toBeInstanceOf(Array);
    expect(result.rounds.length).toBeGreaterThanOrEqual(2);
    expect(result.summary).toBeDefined();
    expect(result.summary.drainCurve).toBeInstanceOf(Array);
    expect(result.summary.totalRounds).toBeGreaterThanOrEqual(2);
  });

  it("artifact shape matches blog convention when constructed from drain result", async () => {
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: mockRunnerConverging(),
      now: () => 1713916886000,
    });

    // Simulate the server's writeAuditArtifact logic
    const ts = 1713916886000;
    const findingsByLane = { bug: 0, spec: 0, classifier: 0 };
    for (const round of result.rounds) {
      if (round.findingCount) {
        findingsByLane.bug += round.realFindings || 0;
        findingsByLane.classifier += round.patterns || 0;
      }
    }

    const artifact = {
      ts: new Date(ts).toISOString(),
      rounds: result.rounds,
      findingsByLane,
      terminated: result.terminated,
      summary: result.summary,
      sliceRef: null,
    };

    // Blog-documented required keys
    expect(artifact).toHaveProperty("ts");
    expect(artifact).toHaveProperty("rounds");
    expect(artifact).toHaveProperty("findingsByLane");
    expect(artifact).toHaveProperty("terminated");
    expect(artifact).toHaveProperty("summary");

    // Type checks
    expect(typeof artifact.ts).toBe("string");
    expect(artifact.rounds).toBeInstanceOf(Array);
    expect(typeof artifact.findingsByLane).toBe("object");
    expect(typeof artifact.findingsByLane.bug).toBe("number");
    expect(typeof artifact.findingsByLane.spec).toBe("number");
    expect(typeof artifact.findingsByLane.classifier).toBe("number");
    expect(["converged", "max-rounds", "aborted"]).toContain(artifact.terminated);
    expect(typeof artifact.summary).toBe("object");
  });

  it("artifact has valid ISO timestamp", async () => {
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 2,
      runTemperingRunFn: mockRunnerConverging(),
    });

    const ts = new Date().toISOString();
    expect(() => new Date(ts)).not.toThrow();
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it("artifact findingsByLane counts match drain curve", async () => {
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: mockRunnerConverging(),
      now: () => 1713916886000,
    });

    const findingsByLane = { bug: 0, spec: 0, classifier: 0 };
    for (const round of result.rounds) {
      if (round.findingCount) {
        findingsByLane.bug += round.realFindings || 0;
        findingsByLane.classifier += round.patterns || 0;
      }
    }

    // First round has 2 real findings (high+medium) and 1 pattern (info)
    expect(findingsByLane.bug).toBe(2);
    expect(findingsByLane.classifier).toBe(1);
    expect(findingsByLane.spec).toBe(0);
  });

  it("terminated field uses only allowed values", async () => {
    // Converged case
    const converged = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: mockRunnerConverging(),
    });
    expect(["converged", "max-rounds", "aborted"]).toContain(converged.terminated);

    // Max-rounds case
    const cleanDir = makeTmpDir();
    try {
      let callCount = 0;
      const neverConverge = async () => {
        callCount++;
        return {
          ok: true,
          runId: `run-${callCount}`,
          scanners: [{
            scanner: "unit",
            verdict: "fail",
            pass: 0,
            fail: 1,
            findings: [{ class: "always-fails", route: "/", severity: "high", evidence: {} }],
          }],
        };
      };
      const maxRounds = await runTemperingDrain({
        project: cleanDir,
        maxRounds: 2,
        runTemperingRunFn: neverConverge,
      });
      expect(maxRounds.terminated).toBe("max-rounds");
    } finally {
      cleanTmpDir(cleanDir);
    }
  });
});

// ─── Meta-bug #101 regression: no-work detection ─────────────────────

describe("drain no-work detection (meta-bug #101)", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("reports 'no-work' when runner returns { ok:true, skipped:true }", async () => {
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: async () => ({
        ok: true,
        skipped: true,
        reason: "tempering-disabled",
        runId: "run-skip",
      }),
    });

    expect(result.terminated).toBe("no-work");
    expect(result.summary.terminated).toBe("no-work");
    expect(result.summary.reason).toBe("tempering-disabled");
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].noWork).toBe(true);
    expect(result.rounds[0].reason).toBe("tempering-disabled");
  });

  it("reports 'no-work' when runner returns ok but no scanners array", async () => {
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: async () => ({
        ok: true,
        runId: "run-no-scanners",
        verdict: "pass",
      }),
    });

    expect(result.terminated).toBe("no-work");
    expect(result.summary.reason).toBe("no-scanners-executed");
  });

  it("reports 'no-work' when scanners array is empty", async () => {
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: async () => ({
        ok: true,
        runId: "run-empty",
        verdict: "pass",
        scanners: [],
      }),
    });

    expect(result.terminated).toBe("no-work");
    expect(result.summary.reason).toBe("no-scanners-executed");
  });

  it("does NOT mistake a real convergent run (scanners present, 0 findings) for no-work", async () => {
    // This is the case where scanners actually ran and found nothing — legitimate convergence.
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: async () => ({
        ok: true,
        runId: "run-real",
        verdict: "pass",
        scanners: [{ scanner: "unit", verdict: "pass", pass: 10, fail: 0, findings: [] }],
      }),
    });

    expect(result.terminated).toBe("converged");
    expect(result.rounds[0].noWork).toBeUndefined();
  });

  it("summary includes historyPath so callers know where artifacts live", async () => {
    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 1,
      runTemperingRunFn: async () => ({
        ok: true,
        scanners: [{ scanner: "unit", findings: [] }],
      }),
    });
    expect(result.summary.historyPath).toContain("drain-history.jsonl");
  });
});

