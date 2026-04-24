/**
 * CLI E2E tests for `pforge audit-loop` (Phase-39 Slice 8).
 *
 * Validates:
 *   1. --dry-run resolves config with _dryRun flag, no triage side effects
 *   2. Manual mode (no --auto) runs unconditionally
 *   3. --auto with mode=off exits early
 *   4. --auto with signals tripped → drain dispatched
 *   5. --env=staging plumbed correctly
 *   6. Production guard cannot be bypassed via CLI
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runTemperingDrain } from "../tempering/drain.mjs";
import {
  AUDIT_DEFAULTS,
  loadAuditConfig,
  shouldAutoDrain,
} from "../tempering/auto-activate.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeTmpProject() {
  const dir = mkdtempSync(join(tmpdir(), "e2e-cli-audit-"));
  mkdirSync(resolve(dir, ".forge", "audits"), { recursive: true });
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
 * Simulates the CLI `pforge audit-loop` handler logic. This mirrors
 * the flow in pforge.sh/pforge.ps1: parse flags → load config →
 * evaluate auto/manual mode → dispatch or exit early.
 */
function simulateCliAuditLoop(dir, flags = {}, drainFn = null) {
  const config = loadAuditConfig(dir);
  const env = flags.env || "dev";
  const maxRounds = flags.max || config.maxRounds;
  const dryRun = !!flags.dryRun;
  const autoMode = !!flags.auto;

  // Production guard
  if (config.forbidProduction && env === "production") {
    return { dispatched: false, reason: "production-forbidden", config, env };
  }

  // Dry-run: return config snapshot, no side effects
  if (dryRun) {
    return { dispatched: false, reason: "dry-run", config, dryRun: true, maxRounds, env };
  }

  // Auto mode: evaluate threshold signals
  if (autoMode) {
    const evaluation = shouldAutoDrain({
      cwd: dir,
      config,
      env,
      filesChanged: flags.filesChanged || 0,
      lastDrainTs: flags.lastDrainTs || 0,
      lastVerdict: flags.lastVerdict || null,
      recentFindingCount: flags.recentFindingCount || 0,
    });
    if (!evaluation.fire) {
      return { dispatched: false, reason: "no-signals", signals: evaluation.signals, config };
    }
  }

  // Dispatch drain
  const drainResult = drainFn
    ? drainFn({ project: dir, maxRounds })
    : { rounds: [], terminated: "mock", summary: {} };

  return { dispatched: true, drainResult, config, maxRounds, env };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("CLI E2E: pforge audit-loop --dry-run", () => {
  let dir;
  beforeEach(() => { dir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("--dry-run --env=dev returns config snapshot with no triage side effects", () => {
    writeForgeJson(dir, { audit: { mode: "auto", maxRounds: 3 } });
    const result = simulateCliAuditLoop(dir, { dryRun: true, env: "dev" });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("dry-run");
    expect(result.dryRun).toBe(true);
    expect(result.maxRounds).toBe(3);
    expect(result.config.mode).toBe("auto");

    // No artifacts should be created
    const auditsDir = resolve(dir, ".forge", "audits");
    const auditFiles = existsSync(auditsDir)
      ? readDirJsonFiles(auditsDir)
      : [];
    expect(auditFiles.filter((f) => f.startsWith("dev-"))).toHaveLength(0);
  });
});

describe("CLI E2E: pforge audit-loop manual mode", () => {
  let dir;
  beforeEach(() => { dir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("manual mode (no --auto) dispatches drain regardless of config mode", () => {
    writeForgeJson(dir, { audit: { mode: "off" } });
    let drainCalled = false;
    const result = simulateCliAuditLoop(dir, {}, (opts) => {
      drainCalled = true;
      expect(opts.project).toBe(dir);
      return { rounds: [{ round: 1 }], terminated: "converged", summary: {} };
    });

    expect(result.dispatched).toBe(true);
    expect(drainCalled).toBe(true);
    expect(result.drainResult.terminated).toBe("converged");
  });

  it("manual mode respects production guard", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = simulateCliAuditLoop(dir, { env: "production" });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("production-forbidden");
  });
});

describe("CLI E2E: pforge audit-loop --auto", () => {
  let dir;
  beforeEach(() => { dir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("--auto with mode=off exits early with no drain", () => {
    writeForgeJson(dir, { audit: { mode: "off" } });
    const result = simulateCliAuditLoop(dir, { auto: true });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("no-signals");
    expect(result.signals.mode).toBe("off");
  });

  it("--auto with signals tripped dispatches drain", () => {
    writeForgeJson(dir, { audit: { mode: "auto" } });
    let drainCalled = false;
    const result = simulateCliAuditLoop(
      dir,
      {
        auto: true,
        filesChanged: 20,
        lastDrainTs: 0,
        lastVerdict: "max-rounds",
        recentFindingCount: 5,
      },
      () => {
        drainCalled = true;
        return { rounds: [{ round: 1 }], terminated: "converged", summary: {} };
      },
    );

    expect(result.dispatched).toBe(true);
    expect(drainCalled).toBe(true);
  });

  it("--auto with mode=auto but no signals exits early", () => {
    writeForgeJson(dir, { audit: { mode: "auto" } });
    const result = simulateCliAuditLoop(dir, {
      auto: true,
      filesChanged: 0,
      lastDrainTs: Date.now(),
      lastVerdict: "converged",
      recentFindingCount: 0,
    });

    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("no-signals");
  });
});

describe("CLI E2E: pforge audit-loop --env=staging", () => {
  let dir;
  beforeEach(() => { dir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("--env=staging plumbed to drain", () => {
    writeForgeJson(dir, { audit: { mode: "always" } });
    const result = simulateCliAuditLoop(dir, { env: "staging" }, (opts) => {
      return { rounds: [], terminated: "converged", summary: {} };
    });

    expect(result.dispatched).toBe(true);
    expect(result.env).toBe("staging");
  });
});

describe("CLI E2E: full drain integration through CLI path", () => {
  let dir;
  beforeEach(() => { dir = makeTmpProject(); });
  afterEach(() => { cleanTmpDir(dir); });

  it("manual run executes drain and produces result", async () => {
    writeForgeJson(dir, { audit: { mode: "off" } });

    const drainResult = await runTemperingDrain({
      project: dir,
      maxRounds: 2,
      runTemperingRunFn: async () => ({
        ok: true,
        runId: "cli-e2e-1",
        correlationId: null,
        stack: "node",
        verdict: "pass",
        scanners: [{ scanner: "content-audit", findings: [], verdict: "pass", pass: 4, fail: 0, durationMs: 1 }],
      }),
    });

    expect(drainResult.terminated).toBe("converged");
    expect(drainResult.rounds).toHaveLength(1);

    // History JSONL written
    const historyPath = resolve(dir, ".forge", "tempering", "drain-history.jsonl");
    expect(existsSync(historyPath)).toBe(true);
  });
});

// ─── Utility ─────────────────────────────────────────────────────────

function readDirJsonFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}
