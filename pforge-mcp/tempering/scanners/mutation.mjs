/**
 * Plan Forge — TEMPER-05 Slice 05.2: Mutation scanner.
 *
 * 9th scanner — drives mutation testing tools (Stryker, dotnet-stryker,
 * mutmut, pitest, go-mutesting, cargo-mutants) via the stack's preset
 * adapter. Scheduling is delegated to `scheduling.mjs`; this module
 * owns the subprocess boundary, output parsing, and result shaping.
 *
 * Design contracts (inherited from load-stress.mjs / contract.mjs):
 *   - Never throws — all errors captured as `{ verdict: "error", reason }`.
 *   - Budget enforced via deadline check.
 *   - Tests inject `spawnFn` + `importFn` to avoid real subprocesses.
 */

import { resolve } from "node:path";
import { shouldRunMutation } from "../scheduling.mjs";

// ─── Defaults ─────────────────────────────────────────────────────────

export const MUTATION_DEFAULTS = Object.freeze({
  enabled: true,
  minima: { domain: 70, integration: 50, overall: 60 },
  criticalPaths: [],
  fullMutation: false,
  nightlyOnly: true,
  mutationMaxMs: 600_000,
});

// ─── Hub helper ───────────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Skipped frame helper ─────────────────────────────────────────────

function skippedFrame(sliceRef, now, reason) {
  const ts = new Date(now()).toISOString();
  return {
    scanner: "mutation",
    sliceRef,
    startedAt: ts,
    completedAt: ts,
    verdict: "skipped",
    pass: 0, fail: 0, skipped: 0,
    durationMs: 0,
    mutationScore: null,
    layers: null,
    reason,
  };
}

// ─── Scanner entry point ──────────────────────────────────────────────

/**
 * @param {object} ctx - DI context
 * @returns {Promise<object>} scanner result
 */
export async function runMutationScan(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    now = () => Date.now(),
    env = process.env,
    hub = null,
    captureMemory = null,
    importFn = (spec) => import(spec),
    spawnFn = null,
    trigger = "manual",
    touchedFiles = [],
  } = ctx || {};

  const startedAt = new Date(now()).toISOString();

  // 1. Scanner disabled
  const raw = config.scanners?.mutation;
  if (raw === false) {
    return skippedFrame(sliceRef, now, "scanner-disabled");
  }

  const settings = { ...MUTATION_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };

  // 2. Scheduling gate
  const schedule = shouldRunMutation({ config, trigger, touchedFiles });
  if (!schedule.run) {
    return {
      ...skippedFrame(sliceRef, now, "schedule-skipped"),
      scheduleReason: schedule.reason,
    };
  }

  // 3. Load stack adapter
  let adapter;
  try {
    const stack = config._detectedStack || "typescript";
    const mod = await importFn(`../../../presets/${stack}/tempering-adapter.mjs`);
    adapter = mod.temperingAdapter || mod.default;
  } catch {
    adapter = null;
  }

  if (!adapter || !adapter.mutation || !adapter.mutation.supported) {
    return skippedFrame(sliceRef, now, "stack-not-supported");
  }

  // 4. Budget
  const budgetMs = config.runtimeBudgets?.mutationMaxMs ?? settings.mutationMaxMs;
  const deadline = now() + budgetMs;

  // 5. Spawn mutation tool
  let stdout = "", stderr = "", exitCode = -1;
  try {
    if (spawnFn) {
      const proc = await spawnFn(adapter.mutation.cmd, { cwd: projectDir, budgetMs });
      stdout = proc.stdout || "";
      stderr = proc.stderr || "";
      exitCode = proc.exitCode ?? -1;
      if (proc.timedOut) {
        const completedAt = new Date(now()).toISOString();
        return {
          scanner: "mutation",
          sliceRef,
          startedAt, completedAt,
          verdict: "budget-exceeded",
          pass: 0, fail: 0, skipped: 0,
          durationMs: now() - new Date(startedAt).getTime(),
          mutationScore: null,
          layers: null,
          reason: "budget-exceeded",
        };
      }
    } else {
      // No spawn function — cannot run
      return skippedFrame(sliceRef, now, "tool-not-installed");
    }
  } catch (err) {
    return {
      scanner: "mutation",
      sliceRef,
      startedAt,
      completedAt: new Date(now()).toISOString(),
      verdict: "error",
      pass: 0, fail: 0, skipped: 0,
      durationMs: now() - new Date(startedAt).getTime(),
      mutationScore: null,
      layers: null,
      reason: `spawn-error:${err.message || err}`,
    };
  }

  // Budget check after spawn
  if (now() > deadline) {
    return {
      scanner: "mutation",
      sliceRef,
      startedAt,
      completedAt: new Date(now()).toISOString(),
      verdict: "budget-exceeded",
      pass: 0, fail: 0, skipped: 0,
      durationMs: now() - new Date(startedAt).getTime(),
      mutationScore: null,
      layers: null,
      reason: "budget-exceeded",
    };
  }

  // 6. Parse output
  let parsed;
  try {
    parsed = adapter.mutation.parseOutput(stdout, stderr, exitCode);
  } catch {
    // JSON parse failure → exit-code fallback
    parsed = {
      mutationScore: null,
      killed: 0,
      survived: 0,
      timeout: 0,
      noCoverage: 0,
      layers: null,
      reason: "parse-degraded",
    };
    if (exitCode === 0) {
      parsed.mutationScore = 100;
    }
  }

  if (!parsed) {
    parsed = { mutationScore: null, killed: 0, survived: 0, timeout: 0, noCoverage: 0, layers: null };
  }

  // No mutants generated
  const totalMutants = (parsed.killed || 0) + (parsed.survived || 0) + (parsed.timeout || 0) + (parsed.noCoverage || 0);
  if (totalMutants === 0 && parsed.mutationScore == null) {
    return skippedFrame(sliceRef, now, "no-mutants-generated");
  }

  // 7. Compare vs minima
  const minima = settings.minima || MUTATION_DEFAULTS.minima;
  const overallScore = parsed.mutationScore ?? (totalMutants > 0 ? ((parsed.killed || 0) / totalMutants) * 100 : 0);
  let verdict = "pass";
  let failCount = 0;
  const layerResults = [];

  // Check per-layer scores if available
  if (parsed.layers && typeof parsed.layers === "object") {
    for (const [layer, score] of Object.entries(parsed.layers)) {
      const minimum = minima[layer] ?? minima.overall ?? 60;
      const layerPass = score >= minimum;
      if (!layerPass) failCount++;
      layerResults.push({ layer, score, minimum, pass: layerPass });
    }
  }

  // Check overall score
  const overallMinimum = minima.overall ?? 60;
  if (overallScore < overallMinimum) {
    failCount++;
  }

  if (failCount > 0) {
    verdict = "fail";

    // Emit mutation-below-minimum event
    emit(hub, "tempering-mutation-below-minimum", {
      runId,
      sliceRef,
      overallScore,
      overallMinimum,
      layersBelowMinimum: layerResults.filter((l) => !l.pass),
    });

    // Capture memory on failure
    if (captureMemory && typeof captureMemory === "function") {
      try {
        const gapSummary = layerResults
          .filter((l) => !l.pass)
          .map((l) => `${l.layer}: ${l.score.toFixed(1)}% (min ${l.minimum}%)`)
          .join(", ");
        captureMemory(
          `Mutation score below minimum: overall=${overallScore.toFixed(1)}% (min ${overallMinimum}%). Gaps: ${gapSummary || "overall only"}`,
          "lesson",
          `tempering/mutation-gap`,
          projectDir,
        );
      } catch { /* best-effort */ }
    }
  }

  const completedAt = new Date(now()).toISOString();

  return {
    scanner: "mutation",
    sliceRef,
    startedAt,
    completedAt,
    verdict,
    pass: verdict === "pass" ? 1 : 0,
    fail: verdict === "fail" ? 1 : 0,
    skipped: 0,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    mutationScore: overallScore,
    killed: parsed.killed || 0,
    survived: parsed.survived || 0,
    timeout: parsed.timeout || 0,
    noCoverage: parsed.noCoverage || 0,
    layers: layerResults.length > 0 ? layerResults : null,
    reason: parsed.reason || null,
  };
}
