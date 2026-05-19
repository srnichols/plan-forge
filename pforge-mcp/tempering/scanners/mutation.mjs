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

function buildMutationFrame({ sliceRef, startedAt, now, verdict, reason, mutationScore = null, layers = null }) {
  const completedAt = new Date(now()).toISOString();
  return {
    scanner: "mutation",
    sliceRef,
    startedAt,
    completedAt,
    verdict,
    pass: 0,
    fail: 0,
    skipped: 0,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    mutationScore,
    layers,
    reason,
  };
}

async function loadMutationAdapter(config, importFn) {
  try {
    const stack = config._detectedStack || "typescript";
    const mod = await importFn(`../../../presets/${stack}/tempering-adapter.mjs`);
    return mod.temperingAdapter || mod.default;
  } catch {
    return null;
  }
}

async function runMutationProcess({ spawnFn, command, projectDir, budgetMs }) {
  if (!spawnFn) {
    return { skipped: true, reason: "tool-not-installed" };
  }
  const proc = await spawnFn(command, { cwd: projectDir, budgetMs });
  if (proc.timedOut) {
    return { budgetExceeded: true };
  }
  return {
    stdout: proc.stdout || "",
    stderr: proc.stderr || "",
    exitCode: proc.exitCode ?? -1,
  };
}

function parseMutationOutput(parseOutput, stdout, stderr, exitCode) {
  try {
    return parseOutput(stdout, stderr, exitCode) || {
      mutationScore: null,
      killed: 0,
      survived: 0,
      timeout: 0,
      noCoverage: 0,
      layers: null,
    };
  } catch {
    return {
      mutationScore: exitCode === 0 ? 100 : null,
      killed: 0,
      survived: 0,
      timeout: 0,
      noCoverage: 0,
      layers: null,
      reason: "parse-degraded",
    };
  }
}

function evaluateMutationResults(parsed, settings) {
  const totalMutants = (parsed.killed || 0) + (parsed.survived || 0) + (parsed.timeout || 0) + (parsed.noCoverage || 0);
  const minima = settings.minima || MUTATION_DEFAULTS.minima;
  const overallScore = parsed.mutationScore ?? (totalMutants > 0 ? ((parsed.killed || 0) / totalMutants) * 100 : 0);
  const layerResults = buildLayerResults(parsed.layers, minima);
  const overallMinimum = minima.overall ?? 60;
  const failures = countMutationFailures(layerResults, overallScore, overallMinimum);
  return {
    totalMutants,
    overallScore,
    overallMinimum,
    layerResults,
    failures,
    verdict: failures > 0 ? "fail" : "pass",
  };
}

function buildLayerResults(layers, minima) {
  if (!layers || typeof layers !== "object") return [];
  return Object.entries(layers).map(([layer, score]) => {
    const minimum = minima[layer] ?? minima.overall ?? 60;
    return { layer, score, minimum, pass: score >= minimum };
  });
}

function countMutationFailures(layerResults, overallScore, overallMinimum) {
  let failCount = layerResults.filter((layer) => !layer.pass).length;
  if (overallScore < overallMinimum) {
    failCount++;
  }
  return failCount;
}

function emitMutationFailure({ hub, runId, sliceRef, overallScore, overallMinimum, layerResults }) {
  emit(hub, "tempering-mutation-below-minimum", {
    runId,
    sliceRef,
    overallScore,
    overallMinimum,
    layersBelowMinimum: layerResults.filter((layer) => !layer.pass),
  });
}

function captureMutationFailure({ captureMemory, layerResults, overallScore, overallMinimum, projectDir }) {
  if (!captureMemory || typeof captureMemory !== "function") return;
  try {
    const gapSummary = layerResults
      .filter((layer) => !layer.pass)
      .map((layer) => `${layer.layer}: ${layer.score.toFixed(1)}% (min ${layer.minimum}%)`)
      .join(", ");
    captureMemory(
      `Mutation score below minimum: overall=${overallScore.toFixed(1)}% (min ${overallMinimum}%). Gaps: ${gapSummary || "overall only"}`,
      "lesson",
      `tempering/mutation-gap`,
      projectDir,
    );
  } catch { /* best-effort */ }
}

function resolveMutationContext(ctx) {
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
  return {
    config,
    projectDir,
    runId,
    sliceRef,
    now,
    env,
    hub,
    captureMemory,
    importFn,
    spawnFn,
    trigger,
    touchedFiles,
  };
}

function buildScheduleSkippedFrame(sliceRef, now, schedule) {
  return {
    ...skippedFrame(sliceRef, now, "schedule-skipped"),
    scheduleReason: schedule.reason,
  };
}

function buildMutationSuccessResult(sliceRef, startedAt, now, parsed, evaluation) {
  const completedAt = new Date(now()).toISOString();
  return {
    scanner: "mutation",
    sliceRef,
    startedAt,
    completedAt,
    verdict: evaluation.verdict,
    pass: evaluation.verdict === "pass" ? 1 : 0,
    fail: evaluation.verdict === "fail" ? 1 : 0,
    skipped: 0,
    durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    mutationScore: evaluation.overallScore,
    killed: parsed.killed || 0,
    survived: parsed.survived || 0,
    timeout: parsed.timeout || 0,
    noCoverage: parsed.noCoverage || 0,
    layers: evaluation.layerResults.length > 0 ? evaluation.layerResults : null,
    reason: parsed.reason || null,
  };
}

function handleMutationFailureEffects(mutationCtx, evaluation) {
  if (evaluation.verdict !== "fail") return;
  emitMutationFailure({
    hub: mutationCtx.hub,
    runId: mutationCtx.runId,
    sliceRef: mutationCtx.sliceRef,
    overallScore: evaluation.overallScore,
    overallMinimum: evaluation.overallMinimum,
    layerResults: evaluation.layerResults,
  });
  captureMutationFailure({
    captureMemory: mutationCtx.captureMemory,
    layerResults: evaluation.layerResults,
    overallScore: evaluation.overallScore,
    overallMinimum: evaluation.overallMinimum,
    projectDir: mutationCtx.projectDir,
  });
}

async function executeMutationProcess(mutationCtx, adapter, budgetMs, startedAt) {
  try {
    return await runMutationProcess({
      spawnFn: mutationCtx.spawnFn,
      command: adapter.mutation.cmd,
      projectDir: mutationCtx.projectDir,
      budgetMs,
    });
  } catch (err) {
    return buildMutationFrame({
      sliceRef: mutationCtx.sliceRef,
      startedAt,
      now: mutationCtx.now,
      verdict: "error",
      reason: `spawn-error:${err.message || err}`,
    });
  }
}

// ─── Scanner entry point ──────────────────────────────────────────────

/**
 * @param {object} ctx - DI context
 * @returns {Promise<object>} scanner result
 */
export async function runMutationScan(ctx) {
  const mutationCtx = resolveMutationContext(ctx);
  const startedAt = new Date(mutationCtx.now()).toISOString();
  const raw = mutationCtx.config.scanners?.mutation;
  if (raw === false) {
    return skippedFrame(mutationCtx.sliceRef, mutationCtx.now, "scanner-disabled");
  }

  const settings = { ...MUTATION_DEFAULTS, ...(typeof raw === "object" ? raw : {}) };
  const schedule = shouldRunMutation({
    config: mutationCtx.config,
    trigger: mutationCtx.trigger,
    touchedFiles: mutationCtx.touchedFiles,
  });
  if (!schedule.run) return buildScheduleSkippedFrame(mutationCtx.sliceRef, mutationCtx.now, schedule);

  const adapter = await loadMutationAdapter(mutationCtx.config, mutationCtx.importFn);
  if (!adapter || !adapter.mutation || !adapter.mutation.supported) {
    return skippedFrame(mutationCtx.sliceRef, mutationCtx.now, "stack-not-supported");
  }

  const budgetMs = mutationCtx.config.runtimeBudgets?.mutationMaxMs ?? settings.mutationMaxMs;
  const deadline = mutationCtx.now() + budgetMs;
  const proc = await executeMutationProcess(mutationCtx, adapter, budgetMs, startedAt);
  if (proc?.scanner === "mutation") return proc;
  if (proc?.skipped) return skippedFrame(mutationCtx.sliceRef, mutationCtx.now, proc.reason);
  if (proc?.budgetExceeded || mutationCtx.now() > deadline) {
    return buildMutationFrame({ sliceRef: mutationCtx.sliceRef, startedAt, now: mutationCtx.now, verdict: "budget-exceeded", reason: "budget-exceeded" });
  }

  const parsed = parseMutationOutput(adapter.mutation.parseOutput, proc.stdout, proc.stderr, proc.exitCode);
  const evaluation = evaluateMutationResults(parsed, settings);
  if (evaluation.totalMutants === 0 && parsed.mutationScore == null) {
    return skippedFrame(mutationCtx.sliceRef, mutationCtx.now, "no-mutants-generated");
  }

  handleMutationFailureEffects(mutationCtx, evaluation);
  return buildMutationSuccessResult(mutationCtx.sliceRef, startedAt, mutationCtx.now, parsed, evaluation);
}
