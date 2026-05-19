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
function buildFlakinessResult({ sliceRef, startedAt, completedAt, verdict, pass = 0, fail = 0, flakes = [], quarantined = [], reason = null, nowMs = 0 }) {
  const result = {
    scanner: "flakiness",
    sliceRef,
    startedAt,
    completedAt,
    verdict,
    pass,
    fail,
    skipped: 0,
    violationCount: flakes.length,
    durationMs: nowMs,
    flakes,
    quarantined,
  };
  if (reason) result.reason = reason;
  return result;
}

function maybeCaptureConfirmedFlake(captureMemory, settings, testId, outcomes, classification) {
  const failureCount = outcomes.filter((o) => o !== "pass").length;
  if (!captureMemory || failureCount < settings.confirmedFlakeMinFailures) return failureCount;
  try {
    captureMemory({
      type: "flaky-test",
      testId,
      failureRate: classification.failureRate,
      window: classification.window,
    });
  } catch { /* best-effort */ }
  return failureCount;
}

function buildQuarantineList(flakes, outcomeMap, settings) {
  if (!settings.quarantine) return [];
  return flakes
    .filter((flake) => (outcomeMap[flake.testId] || []).filter((o) => o !== "pass").length >= settings.confirmedFlakeMinFailures)
    .map((flake) => flake.testId);
}

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
  const raw = config.scanners?.flakiness;
  const settings = { ...FLAKINESS_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };
  const deadline = now() + (config.runtimeBudgets?.flakinessMaxMs ?? 60_000);

  if (raw === false || settings.enabled === false) {
    return buildFlakinessResult({
      sliceRef,
      startedAt,
      completedAt: new Date(now()).toISOString(),
      verdict: "skipped",
      reason: "scanner-disabled",
    });
  }

  const runs = loadRunRecords(resolve(projectDir, ".forge", "tempering"), settings.windowSize);
  if (runs.length < 2) {
    return buildFlakinessResult({
      sliceRef,
      startedAt,
      completedAt: new Date(now()).toISOString(),
      verdict: "skipped",
      reason: "no-prior-runs",
    });
  }

  const outcomeMap = buildOutcomeMap(runs);
  const flakes = [];
  let passCount = 0;
  let failCount = 0;

  for (const [testId, outcomes] of Object.entries(outcomeMap)) {
    if (now() > deadline) {
      return buildFlakinessResult({
        sliceRef,
        startedAt,
        completedAt: new Date(now()).toISOString(),
        verdict: "budget-exceeded",
        pass: passCount,
        fail: failCount,
        flakes,
        quarantined: [],
        reason: "budget-exceeded",
        nowMs: now() - new Date(startedAt).getTime(),
      });
    }

    const classification = classifyTest(testId, outcomes, settings);
    if (classification.classification !== "flaky") {
      passCount++;
      continue;
    }

    flakes.push(classification);
    failCount++;
    emit(hub, "tempering-flakiness-detected", {
      testId,
      failureRate: classification.failureRate,
      window: classification.window,
    });
    maybeCaptureConfirmedFlake(captureMemory, settings, testId, outcomes, classification);
  }

  const completedAt = new Date(now()).toISOString();
  return buildFlakinessResult({
    sliceRef,
    startedAt,
    completedAt,
    verdict: flakes.length > 0 ? "fail" : "pass",
    pass: passCount,
    fail: failCount,
    flakes,
    quarantined: buildQuarantineList(flakes, outcomeMap, settings),
    nowMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
  });
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
