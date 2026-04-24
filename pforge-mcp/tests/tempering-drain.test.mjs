/**
 * Tests for the tempering drain loop driver (Phase-39 Slice 2).
 *
 * Validates:
 *   1. Convergence — drain stops when realFindings === 0 && patterns === 0
 *   2. Max-rounds — drain caps at maxRounds when convergence never fires
 *   3. Delta-write — per-round JSONL history written with correct shape
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { runTemperingDrain } from "../tempering/drain.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = resolve(tmpdir(), `drain-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmpDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Build a mock `runTemperingRunFn` that returns decreasing findings
 * across rounds. `roundFindings` is an array of
 * `{ real: [{ class, severity }...], patterns: [{ class, severity: "info" }...] }`.
 */
function mockRunnerFromRounds(roundFindings) {
  let callCount = 0;
  return async (opts) => {
    const idx = Math.min(callCount, roundFindings.length - 1);
    callCount++;
    const rf = roundFindings[idx];
    const findings = [
      ...(rf.real || []).map((f) => ({
        class: f.class || "test-finding",
        route: "/test",
        severity: f.severity || "high",
        evidence: {},
      })),
      ...(rf.patterns || []).map((f) => ({
        class: f.class || "client-shell",
        route: "/test",
        severity: "info",
        evidence: {},
      })),
    ];
    return {
      ok: true,
      runId: `run-${callCount}`,
      correlationId: opts.correlationId,
      stack: "node",
      verdict: findings.some((f) => f.severity !== "info" && f.severity !== "ok") ? "fail" : "pass",
      scanners: [
        {
          scanner: "content-audit",
          verdict: "pass",
          pass: 0,
          fail: findings.length,
          findings,
          durationMs: 10,
        },
      ],
      runRecordPath: null,
      configWritten: false,
      changedFilesCount: 0,
    };
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("runTemperingDrain", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("converges when realFindings and patterns reach zero", async () => {
    const mockRunner = mockRunnerFromRounds([
      // Round 1: 88 real findings + 24 patterns
      {
        real: Array.from({ length: 88 }, (_, i) => ({ class: `bug-${i}`, severity: "high" })),
        patterns: Array.from({ length: 24 }, (_, i) => ({ class: `noise-${i}` })),
      },
      // Round 2: zero findings
      { real: [], patterns: [] },
    ]);

    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: mockRunner,
    });

    expect(result.terminated).toBe("converged");
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0].realFindings).toBe(88);
    expect(result.rounds[0].patterns).toBe(24);
    expect(result.rounds[1].realFindings).toBe(0);
    expect(result.rounds[1].patterns).toBe(0);
    expect(result.summary.drainCurve).toEqual([88, 0]);
  });

  it("terminates at max-rounds when convergence never fires", async () => {
    const mockRunner = mockRunnerFromRounds([
      { real: [{ class: "persistent-bug", severity: "high" }], patterns: [] },
    ]);

    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 3,
      runTemperingRunFn: mockRunner,
    });

    expect(result.terminated).toBe("max-rounds");
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds.every((r) => r.realFindings === 1)).toBe(true);
  });

  it("writes per-round deltas to drain-history.jsonl", async () => {
    const mockRunner = mockRunnerFromRounds([
      { real: Array.from({ length: 10 }, () => ({ severity: "high" })), patterns: [{ class: "n" }] },
      { real: Array.from({ length: 3 }, () => ({ severity: "medium" })), patterns: [] },
      { real: [], patterns: [] },
    ]);

    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: mockRunner,
    });

    expect(result.terminated).toBe("converged");
    expect(result.rounds).toHaveLength(3);

    const historyPath = resolve(tmpDir, ".forge", "tempering", "drain-history.jsonl");
    expect(existsSync(historyPath)).toBe(true);

    const lines = readFileSync(historyPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(3);

    // Round 1: no deltas (first round)
    expect(lines[0].round).toBe(1);
    expect(lines[0].realFindings).toBe(10);
    expect(lines[0].patterns).toBe(1);
    expect(lines[0].deltas).toBeNull();
    expect(lines[0]).toHaveProperty("runId");
    expect(lines[0]).toHaveProperty("ts");

    // Round 2: deltas relative to round 1
    expect(lines[1].round).toBe(2);
    expect(lines[1].realFindings).toBe(3);
    expect(lines[1].patterns).toBe(0);
    expect(lines[1].deltas).toEqual({ realFindings: -7, patterns: -1 });

    // Round 3: deltas relative to round 2
    expect(lines[2].round).toBe(3);
    expect(lines[2].realFindings).toBe(0);
    expect(lines[2].patterns).toBe(0);
    expect(lines[2].deltas).toEqual({ realFindings: -3, patterns: 0 });
  });

  it("aborts when runner returns ok:false", async () => {
    let callCount = 0;
    const failingRunner = async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true, runId: "run-1",
          scanners: [{ findings: [{ class: "bug", severity: "high", route: "/", evidence: {} }] }],
          verdict: "fail", correlationId: null,
        };
      }
      return { ok: false, error: "projectDir required", code: "missing-projectDir" };
    };

    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 5,
      runTemperingRunFn: failingRunner,
    });

    expect(result.terminated).toBe("aborted");
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[1].error).toBe("projectDir required");
  });

  it("returns error for missing project", async () => {
    const result = await runTemperingDrain({});
    expect(result.terminated).toBe("aborted");
    expect(result.summary.error).toBe("project directory required");
  });

  it("respects abort signal between rounds", async () => {
    const controller = new AbortController();
    let callCount = 0;
    const slowRunner = async () => {
      callCount++;
      if (callCount >= 2) controller.abort();
      return {
        ok: true, runId: `run-${callCount}`,
        scanners: [{ findings: [{ class: "x", severity: "high", route: "/", evidence: {} }] }],
        verdict: "fail", correlationId: null,
      };
    };

    const result = await runTemperingDrain({
      project: tmpDir,
      maxRounds: 10,
      runTemperingRunFn: slowRunner,
      abortSignal: controller.signal,
    });

    expect(result.terminated).toBe("aborted");
    expect(result.rounds.length).toBeLessThanOrEqual(3);
  });
});
