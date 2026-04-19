/**
 * Plan Forge — TEMPER-05 Slice 05.1: Flakiness scanner.
 *
 * Reads the last N tempering run records and classifies each test
 * by its pass/fail outcome history. Tests that flake above the
 * configured threshold are flagged; optionally quarantined when
 * the guard is met (≥ confirmedFlakeMinFailures).
 */

import { resolve } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// ─── Defaults ─────────────────────────────────────────────────────────

export const FLAKINESS_DEFAULTS = Object.freeze({
  enabled: true,
  windowSize: 20,
  flakeThreshold: 0.05,
  minRunsForClassification: 3,
  quarantine: false,
  confirmedFlakeMinFailures: 3,
});

// ─── Hub helper ───────────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Scanner entry point ──────────────────────────────────────────────

/**
 * @param {object} ctx - DI context
 * @returns {Promise<object>} scanner result
 */
export async function runFlakinessScan(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    now = () => Date.now(),
    env = process.env,
    hub = null,
    captureMemory = null,
  } = ctx || {};

  const startedAt = new Date(now()).toISOString();

  // Merge defaults
  const raw = config.scanners?.flakiness;
  const settings = { ...FLAKINESS_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };

  // Budget
  const budgetMs = config.runtimeBudgets?.flakinessMaxMs ?? 60_000;
  const deadline = now() + budgetMs;

  // Skip: scanner disabled
  if (raw === false || settings.enabled === false) {
    return {
      scanner: "flakiness", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "skipped", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      flakes: [], quarantined: [],
      reason: "scanner-disabled",
    };
  }

  // Read prior run records
  const temperingDir = resolve(projectDir, ".forge", "tempering");
  const runs = loadRunRecords(temperingDir, settings.windowSize);

  // Skip: not enough history
  if (runs.length < 2) {
    return {
      scanner: "flakiness", sliceRef,
      startedAt, completedAt: new Date(now()).toISOString(),
      verdict: "skipped", pass: 0, fail: 0, skipped: 0,
      violationCount: 0, durationMs: 0,
      flakes: [], quarantined: [],
      reason: "no-prior-runs",
    };
  }

  // Build outcome map: testId → [outcomes]
  const outcomeMap = buildOutcomeMap(runs);

  // Classify each test
  const flakes = [];
  let passCount = 0;
  let failCount = 0;

  for (const [testId, outcomes] of Object.entries(outcomeMap)) {
    // Budget check
    if (now() > deadline) {
      return {
        scanner: "flakiness", sliceRef,
        startedAt, completedAt: new Date(now()).toISOString(),
        verdict: "budget-exceeded",
        pass: passCount, fail: failCount, skipped: 0,
        violationCount: flakes.length, durationMs: now() - new Date(startedAt).getTime(),
        flakes, quarantined: [],
        reason: "budget-exceeded",
      };
    }

    const classification = classifyTest(testId, outcomes, settings);
    if (classification.classification === "flaky") {
      flakes.push(classification);
      failCount++;

      emit(hub, "tempering-flakiness-detected", {
        testId,
        failureRate: classification.failureRate,
        window: classification.window,
      });

      // captureMemory only for confirmed flakes (guard: >= confirmedFlakeMinFailures)
      const failureCount = outcomes.filter((o) => o !== "pass").length;
      if (captureMemory && failureCount >= settings.confirmedFlakeMinFailures) {
        try {
          captureMemory({
            type: "flaky-test",
            testId,
            failureRate: classification.failureRate,
            window: classification.window,
          });
        } catch { /* best-effort */ }
      }
    } else {
      passCount++;
    }
  }

  // Build quarantine list (only if opt-in AND meets threshold)
  const quarantined = [];
  if (settings.quarantine) {
    for (const flake of flakes) {
      const outcomes = outcomeMap[flake.testId] || [];
      const failureCount = outcomes.filter((o) => o !== "pass").length;
      if (failureCount >= settings.confirmedFlakeMinFailures) {
        quarantined.push(flake.testId);
      }
    }
  }

  const completedAt = new Date(now()).toISOString();
  const verdict = flakes.length > 0 ? "fail" : "pass";

  return {
    scanner: "flakiness", sliceRef,
    startedAt, completedAt,
    verdict,
    pass: passCount, fail: failCount, skipped: 0,
    violationCount: flakes.length,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    flakes, quarantined,
  };
}

// ─── Internals ────────────────────────────────────────────────────────

function loadRunRecords(temperingDir, windowSize) {
  if (!existsSync(temperingDir)) return [];
  try {
    const files = readdirSync(temperingDir)
      .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, windowSize);

    const records = [];
    for (const f of files) {
      try {
        const raw = readFileSync(resolve(temperingDir, f), "utf-8");
        records.push(JSON.parse(raw));
      } catch {
        // skip corrupted records
      }
    }
    return records;
  } catch {
    return [];
  }
}

function buildOutcomeMap(runs) {
  const map = {};
  for (const run of runs) {
    if (!Array.isArray(run.scanners)) continue;
    for (const scanner of run.scanners) {
      const tests = scanner?.tests || scanner?.unitResult?.tests || scanner?.integrationResult?.tests;
      if (!Array.isArray(tests)) continue;
      for (const test of tests) {
        const id = test.testId || test.name || test.id;
        if (!id) continue;
        if (!map[id]) map[id] = [];
        map[id].push(test.status === "pass" ? "pass" : test.status || "fail");
      }
    }
  }
  return map;
}

function classifyTest(testId, outcomes, settings) {
  const window = outcomes.length;
  const failures = outcomes.filter((o) => o !== "pass").length;
  const failureRate = window > 0 ? failures / window : 0;

  let classification;
  if (window < settings.minRunsForClassification) {
    classification = "new";
  } else if (failures === 0) {
    classification = "stable-pass";
  } else if (failures === window) {
    classification = "stable-fail";
  } else if (failureRate > settings.flakeThreshold) {
    classification = "flaky";
  } else {
    classification = "stable-pass";
  }

  return {
    testId,
    classification,
    failureRate,
    window,
    runs: outcomes,
  };
}
