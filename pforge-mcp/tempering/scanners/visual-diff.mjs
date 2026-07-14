/**
 * Visual-diff scanner (TEMPER-04 Slice 04.1).
 *
 * 3-band pixel diff + single-model LLM analyzer for the investigate band.
 * Follows the same result contract as contract.mjs:
 *   { scanner, startedAt, completedAt, verdict, pass, fail, skipped,
 *     durationMs, regressions?, reason?, details? }
 *
 * @module tempering/scanners/visual-diff
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getScreenshotManifest,
  getBaseline,
  diffImages,
  hashUrl,
} from "../baselines.mjs";
import { ensureScannerArtifactDir, seedArtifactsGitignore } from "../artifacts.mjs";
// Phase-27 (v2.60.0): Pricing canonical source lives in cost-service. The
// local estimateCost() is now a thin adapter over priceSlice.
import { priceSlice } from "../../cost-service.mjs";
// Phase-28.5: secrets.json fallback for API key detection
import { loadSecretFromForge } from "../../secrets.mjs";

// ─── Default visual analyzer config ──────────────────────────────────

const VISUAL_ANALYZER_DEFAULTS = {
  enabled: true,
  ignorableDiff: 0.001,     // 0.1%
  failureDiff: 0.02,        // 2.0%
  maxCostUsd: 2.0,
  mode: "quorum",           // "quorum" | "single"; default "quorum" when models.length >= 2
  models: ["claude-opus-4.8", "gpt-5.3-codex", "grok-4.20"],
  agreementThreshold: 2,    // N-of-M majority
  analyzerTimeoutMs: 60_000,
  maxImageWidth: 1920,
};

// ─── Hub event helper ─────────────────────────────────────────────────

function emit(hub, type, data) {
  if (!hub || typeof hub.broadcast !== "function") return;
  try {
    hub.broadcast({ type, data, timestamp: new Date().toISOString() });
  } catch { /* best-effort */ }
}

// ─── Scanner entry point ──────────────────────────────────────────────

/**
 * Run the visual-diff scanner.
 *
 * @param {object} ctx
 * @param {object} ctx.config         — loaded tempering config
 * @param {string} ctx.projectDir     — project root
 * @param {string} ctx.runId          — current run ID
 * @param {{plan:string,slice:string}|null} [ctx.sliceRef]
 * @param {Function} [ctx.now]
 * @param {object}   [ctx.env]        — process.env-shaped map
 * @param {Function} [ctx.spawnWorker] — DI for LLM analyzer
 * @param {object}   [ctx.hub]        — hub for event broadcasting
 * @returns {Promise<object>} scanner result record
 */
function createVisualDiffSkippedFrame(base, now, reason) {
  return {
    ...base,
    verdict: "skipped",
    pass: 0,
    fail: 0,
    skipped: 1,
    violationCount: 0,
    regressions: [],
    reason,
    durationMs: 0,
    completedAt: new Date(now()).toISOString(),
  };
}

function createVisualDiffState() {
  return {
    regressions: [],
    passCount: 0,
    failCount: 0,
    skippedCount: 0,
    cumulativeCostUsd: 0,
    budgetExceeded: false,
  };
}

function resolveVisualArtifactDir(projectDir, runId) {
  const artifactDir = ensureScannerArtifactDir(projectDir, runId, "visual-diff");
  if (artifactDir) seedArtifactsGitignore(projectDir);
  return artifactDir;
}

function getVisualArtifactPaths(artifactDir, urlHash) {
  return {
    baseline: artifactDir ? resolve(artifactDir, `${urlHash}-baseline.png`) : null,
    current: artifactDir ? resolve(artifactDir, `${urlHash}-current.png`) : null,
    diff: artifactDir ? resolve(artifactDir, `${urlHash}-diff.png`) : null,
  };
}

function findCurrentRunScreenshotPath(projectDir, runId, urlHash) {
  const artifactsRunDir = resolve(projectDir, ".forge", "tempering", "artifacts", runId);
  const candidates = [
    resolve(artifactsRunDir, "ui-playwright", `${urlHash}.png`),
    resolve(artifactsRunDir, "visual-diff", `${urlHash}.png`),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function readPreferredCurrentScreenshot(entry, currentRunPath) {
  if (!currentRunPath) {
    return entry.path && existsSync(entry.path) ? readFileSync(entry.path) : null;
  }
  const manifestPath = entry.path && existsSync(entry.path) ? entry.path : null;
  if (!manifestPath) {
    return readFileSync(currentRunPath);
  }
  return readFileSync(selectNewerScreenshotPath(manifestPath, currentRunPath));
}

function selectNewerScreenshotPath(manifestPath, currentRunPath) {
  let manifestMtime = 0;
  let runMtime = 0;
  try { manifestMtime = statSync(manifestPath).mtimeMs; } catch { /* fallback */ }
  try { runMtime = statSync(currentRunPath).mtimeMs; } catch { /* fallback */ }
  return runMtime >= manifestMtime ? currentRunPath : manifestPath;
}

function loadCurrentScreenshot(entry, projectDir, runId, urlHash) {
  try {
    const currentRunPath = findCurrentRunScreenshotPath(projectDir, runId, urlHash);
    return readPreferredCurrentScreenshot(entry, currentRunPath);
  } catch {
    return null;
  }
}

function writeVisualBuffer(path, buffer) {
  if (!path || !buffer) return;
  try {
    writeFileSync(path, buffer);
  } catch { /* best-effort */ }
}

function writeVisualArtifacts(paths, baselineBuf, currentBuf, diffBuffer) {
  writeVisualBuffer(paths.baseline, baselineBuf);
  writeVisualBuffer(paths.current, currentBuf);
  writeVisualBuffer(paths.diff, diffBuffer);
}

function pushVisualRegression(state, regression, kind = "skipped") {
  state.regressions.push(regression);
  if (kind === "pass") state.passCount++;
  else if (kind === "fail") state.failCount++;
  else if (kind === "skipped") state.skippedCount++;
}

function handleMissingVisualBaseline(state, entry, urlHash) {
  pushVisualRegression(state, {
    url: entry.url,
    urlHash,
    band: "skipped",
    reason: "needs-baseline",
  });
}

function handleMissingCurrentScreenshot(state, entry, urlHash) {
  pushVisualRegression(state, {
    url: entry.url,
    urlHash,
    band: "skipped",
    reason: "no-current-screenshot",
  });
}

function handleVisualDiffError(state, entry, urlHash, err) {
  pushVisualRegression(state, {
    url: entry.url,
    urlHash,
    band: "error",
    reason: `diff-error: ${err.message}`,
  });
}

function emitVisualAutoFail({ hub, entry, urlHash, diffPercent, sliceRef, paths }) {
  emit(hub, "tempering-visual-regression-detected", {
    url: entry.url,
    urlHash,
    diffPercent,
    band: "fail",
    verdict: "regression",
    sliceRef,
    artifacts: paths,
  });
}

function handleVisualAutoFail(state, { entry, urlHash, diffPercent, paths, hub, sliceRef }) {
  pushVisualRegression(state, {
    url: entry.url,
    urlHash,
    diffPercent,
    band: "fail",
    diffPath: paths.diff,
  }, "fail");
  emitVisualAutoFail({ hub, entry, urlHash, diffPercent, sliceRef, paths });
}

function buildAnalyzerImages(baselineBuf, currentBuf, diffBuffer) {
  const images = [
    { type: "baseline", data: baselineBuf.toString("base64") },
    { type: "current", data: currentBuf.toString("base64") },
  ];
  if (diffBuffer) images.push({ type: "diff", data: diffBuffer.toString("base64") });
  return images;
}

function tallyQuorumVotes(votes, threshold) {
  const valid = votes.filter((vote) => vote.ok);
  const yes = valid.filter((vote) => vote.regression).length;
  const no = valid.length - yes;
  return { valid, yes, no, threshold, agreementMet: yes >= threshold || no >= threshold };
}

function summarizeQuorumDecision(votes, threshold, models) {
  const tally = tallyQuorumVotes(votes, threshold);
  const llmVerdict = !tally.agreementMet ? "inconclusive" : tally.yes >= threshold ? "regression" : "acceptable";
  return {
    llmVerdict,
    severity: llmVerdict === "regression" ? resolveHighestSeverity(tally.valid.filter((vote) => vote.regression)) : null,
    explanation: buildQuorumExplanation(llmVerdict, tally),
    quorumData: {
      models,
      votes: votes.map((vote) => ({
        model: vote.model,
        regression: vote.regression ?? null,
        severity: vote.severity ?? null,
        explanation: vote.explanation ?? null,
        ok: !!vote.ok,
      })),
      agreement: `${Math.max(tally.yes, tally.no)}-of-${tally.valid.length}`,
      threshold,
    },
  };
}

function buildQuorumExplanation(llmVerdict, tally) {
  if (llmVerdict === "regression") {
    return tally.valid
      .filter((vote) => vote.regression)
      .map((vote) => `${vote.model}: ${vote.explanation || "regression"}`)
      .join("; ");
  }
  if (llmVerdict === "acceptable") {
    return tally.valid
      .filter((vote) => !vote.regression)
      .map((vote) => `${vote.model}: ${vote.explanation || "acceptable"}`)
      .join("; ");
  }
  return `Insufficient agreement: ${tally.yes} regression, ${tally.no} acceptable out of ${tally.valid.length} valid legs (threshold: ${tally.threshold})`;
}

async function runQuorumLlmAnalysis({ entry, sliceRef, diffPercent, analyzerConfig, spawnWorker, baselineBuf, currentBuf, diffBuffer, state }) {
  const models = analyzerConfig.models || ["claude-opus-4.7"];
  const threshold = analyzerConfig.agreementThreshold || 2;
  const prompt = buildAnalyzerPrompt(entry.url, sliceRef, diffPercent);
  const images = buildAnalyzerImages(baselineBuf, currentBuf, diffBuffer);
  const legs = await Promise.allSettled(
    models.map((model) => runLegWithBudget({
      model,
      prompt,
      images,
      timeoutMs: analyzerConfig.analyzerTimeoutMs,
      spawnWorker,
      estimateCost,
      budget: { cap: analyzerConfig.maxCostUsd, used: () => state.cumulativeCostUsd },
    })),
  );
  const votes = legs.map((leg, index) => normalizeQuorumVote(leg, models[index], analyzerConfig, state));
  return summarizeQuorumDecision(votes, threshold, models);
}

function normalizeQuorumVote(leg, model, analyzerConfig, state) {
  if (leg.status === "rejected") {
    return { model, ok: false, error: leg.reason?.message || String(leg.reason) };
  }
  const vote = leg.value;
  if (vote.costUsd) {
    state.cumulativeCostUsd += vote.costUsd;
    if (state.cumulativeCostUsd >= analyzerConfig.maxCostUsd) state.budgetExceeded = true;
  }
  return vote;
}

async function runSingleModelLlmAnalysis({ entry, sliceRef, diffPercent, analyzerConfig, spawnWorker, baselineBuf, currentBuf, diffBuffer, state }) {
  const model = (analyzerConfig.models || ["claude-opus-4.7"])[0] || "claude-opus-4.7";
  try {
    const workerResult = await Promise.race([
      spawnWorker({
        model,
        prompt: buildAnalyzerPrompt(entry.url, sliceRef, diffPercent),
        images: buildAnalyzerImages(baselineBuf, currentBuf, diffBuffer),
        responseFormat: "json",
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("analyzer-timeout")), analyzerConfig.analyzerTimeoutMs)),
    ]);
    return parseSingleModelAnalysisResult(workerResult, model, analyzerConfig, state);
  } catch (err) {
    return { llmVerdict: "inconclusive", severity: null, explanation: err.message || String(err), quorumData: null };
  }
}

function parseSingleModelAnalysisResult(workerResult, model, analyzerConfig, state) {
  if (!workerResult || typeof workerResult !== "object") {
    return { llmVerdict: "inconclusive", severity: null, explanation: "empty worker response", quorumData: null };
  }
  const parsed = typeof workerResult.text === "string" ? tryParseJson(workerResult.text) : workerResult;
  if (workerResult.usage) {
    const tokens = (workerResult.usage.inputTokens || 0) + (workerResult.usage.outputTokens || 0);
    state.cumulativeCostUsd += estimateCost(tokens, model);
    if (state.cumulativeCostUsd >= analyzerConfig.maxCostUsd) state.budgetExceeded = true;
  }
  if (!parsed || typeof parsed.regression !== "boolean") {
    return { llmVerdict: "inconclusive", severity: null, explanation: "LLM response did not match expected schema", quorumData: null };
  }
  return {
    llmVerdict: parsed.regression ? "regression" : "acceptable",
    severity: parsed.severity || null,
    explanation: parsed.explanation || null,
    quorumData: null,
  };
}

function resolveMissingWorkerAnalysis(env, projectDir) {
  const hasKey = env?.ANTHROPIC_API_KEY || env?.OPENAI_API_KEY || env?.XAI_API_KEY
    || loadSecretFromForge("ANTHROPIC_API_KEY", projectDir)
    || loadSecretFromForge("OPENAI_API_KEY", projectDir)
    || loadSecretFromForge("XAI_API_KEY", projectDir);
  return {
    llmVerdict: "inconclusive",
    severity: null,
    explanation: hasKey ? "no spawnWorker provided" : "no API key configured",
    quorumData: null,
  };
}

async function runLlmAnalysis({ entry, sliceRef, diffPercent, analyzerConfig, spawnWorker, baselineBuf, currentBuf, diffBuffer, env, projectDir, state }) {
  const models = analyzerConfig.models || ["claude-opus-4.7"];
  const useQuorum = analyzerConfig.mode !== "single" && models.length >= 2;
  if (spawnWorker && useQuorum) {
    return runQuorumLlmAnalysis({ entry, sliceRef, diffPercent, analyzerConfig, spawnWorker, baselineBuf, currentBuf, diffBuffer, state });
  }
  if (spawnWorker) {
    return runSingleModelLlmAnalysis({ entry, sliceRef, diffPercent, analyzerConfig, spawnWorker, baselineBuf, currentBuf, diffBuffer, state });
  }
  return resolveMissingWorkerAnalysis(env, projectDir);
}

function buildVisualEventPayload({ entry, urlHash, diffPercent, llmVerdict, severity, explanation, sliceRef, quorumData, paths }) {
  return {
    url: entry.url,
    urlHash,
    diffPercent,
    band: "investigate",
    verdict: llmVerdict,
    severity,
    explanation,
    sliceRef,
    ...(quorumData ? { quorum: quorumData } : {}),
    artifacts: paths,
  };
}

async function maybeQueueVisualReview({ config, projectDir, entry, urlHash, diffPercent, llmVerdict, hub, captureMemory }) {
  const vdConfig = config?.visualDiff || {};
  if (vdConfig.autoQueueReview !== true) return;
  try {
    const { maybeAddVisualBaselineReview } = await import("../../orchestrator.mjs");
    maybeAddVisualBaselineReview(projectDir, {
      title: `Visual regression on ${entry.url} — review baseline update`,
      severity: "medium",
      context: { url: entry.url, diffPercent, quorumVerdict: llmVerdict },
      correlationId: `visual-${urlHash}`,
    }, hub, captureMemory);
  } catch { /* review hook is advisory */ }
}

async function maybeQueueInconclusiveReview({ projectDir, entry, urlHash, diffPercent, quorumData, explanation, hub, captureMemory }) {
  try {
    const { maybeAddTemperingReview } = await import("../../orchestrator.mjs");
    maybeAddTemperingReview(projectDir, {
      title: `Visual-diff quorum inconclusive for ${entry.url}`,
      severity: "medium",
      context: { url: entry.url, diffPercent, quorum: quorumData, explanation },
      correlationId: `quorum-${urlHash}`,
    }, hub, captureMemory);
  } catch { /* review hook is advisory */ }
}

function captureVisualAnalysis({ captureMemory, llmVerdict, entry, diffPercent, quorumData, projectDir }) {
  if (!captureMemory) return;
  try {
    captureMemory(
      `Visual quorum ${llmVerdict}: ${entry.url} (${(diffPercent * 100).toFixed(2)}% diff). ` +
      (quorumData
        ? quorumData.votes.filter((vote) => vote.ok).map((vote) => `${vote.model}:${vote.regression ? "reg" : "ok"}`).join(", ")
        : `single-model: ${llmVerdict}`),
      llmVerdict === "inconclusive" ? "gotcha" : "decision",
      `forge_tempering_scan/visual-diff/${llmVerdict}`,
      projectDir,
    );
  } catch { /* best-effort */ }
}

async function handleInvestigateBand({ state, entry, urlHash, diffPercent, analyzerConfig, spawnWorker, baselineBuf, currentBuf, diffBuffer, paths, env, projectDir, sliceRef, hub, captureMemory, config }) {
  if (state.budgetExceeded) {
    pushVisualRegression(state, {
      url: entry.url,
      urlHash,
      diffPercent,
      band: "investigate",
      reason: "budget-exceeded",
    });
    return;
  }

  const analysis = await runLlmAnalysis({
    entry,
    sliceRef,
    diffPercent,
    analyzerConfig,
    spawnWorker,
    baselineBuf,
    currentBuf,
    diffBuffer,
    env,
    projectDir,
    state,
  });
  const regression = {
    url: entry.url,
    urlHash,
    diffPercent,
    band: "investigate",
    llmVerdict: analysis.llmVerdict,
    severity: analysis.severity,
    explanation: analysis.explanation,
    diffPath: paths.diff,
    ...(analysis.quorumData ? { quorum: analysis.quorumData } : {}),
  };
  state.regressions.push(regression);
  const eventPayload = buildVisualEventPayload({
    entry,
    urlHash,
    diffPercent,
    llmVerdict: analysis.llmVerdict,
    severity: analysis.severity,
    explanation: analysis.explanation,
    sliceRef,
    quorumData: analysis.quorumData,
    paths,
  });
  emit(hub, "tempering-visual-regression-detected", eventPayload);

  if (analysis.llmVerdict === "regression") {
    state.failCount++;
    await maybeQueueVisualReview({ config: config, projectDir: projectDir, entry: entry, urlHash: urlHash, diffPercent: diffPercent, ...{ llmVerdict: analysis.llmVerdict, hub, captureMemory } });
  } else if (analysis.llmVerdict === "acceptable") {
    state.passCount++;
  } else {
    state.skippedCount++;
    await maybeQueueInconclusiveReview({ projectDir: projectDir, entry: entry, urlHash: urlHash, diffPercent: diffPercent, quorumData: analysis.quorumData, ...{ explanation: analysis.explanation, hub, captureMemory } });
  }

  captureVisualAnalysis({ captureMemory: captureMemory, llmVerdict: analysis.llmVerdict, entry: entry, diffPercent: diffPercent, quorumData: analysis.quorumData, projectDir: projectDir });
}

async function processVisualDiffEntry({ entry, projectDir, runId, artifactDir, analyzerConfig, state, spawnWorker, hub, captureMemory, config, env, sliceRef }) {
  const urlHash = entry.urlHash || hashUrl(entry.url);
  const baselineBuf = getBaseline(urlHash, projectDir);
  if (!baselineBuf) {
    handleMissingVisualBaseline(state, entry, urlHash);
    return;
  }

  const currentBuf = loadCurrentScreenshot(entry, projectDir, runId, urlHash);
  if (!currentBuf) {
    handleMissingCurrentScreenshot(state, entry, urlHash);
    return;
  }

  let diffResult;
  try {
    diffResult = diffImages(baselineBuf, currentBuf);
  } catch (err) {
    handleVisualDiffError(state, entry, urlHash, err);
    return;
  }

  const paths = getVisualArtifactPaths(artifactDir, urlHash);
  writeVisualBuffer(paths.diff, diffResult.diffBuffer);

  if (diffResult.diffPercent < analyzerConfig.ignorableDiff) {
    state.passCount++;
    return;
  }

  if (diffResult.diffPercent >= analyzerConfig.failureDiff) {
    writeVisualArtifacts(paths, baselineBuf, currentBuf, diffResult.diffBuffer);
    handleVisualAutoFail(state, {
      entry,
      urlHash,
      diffPercent: diffResult.diffPercent,
      paths,
      hub,
      sliceRef,
    });
    return;
  }

  writeVisualArtifacts(paths, baselineBuf, currentBuf, null);
  await handleInvestigateBand({
    state,
    entry,
    urlHash,
    diffPercent: diffResult.diffPercent,
    analyzerConfig,
    spawnWorker,
    baselineBuf,
    currentBuf,
    diffBuffer: diffResult.diffBuffer,
    paths,
    env,
    projectDir,
    sliceRef,
    hub,
    captureMemory,
    config,
  });
}

function resolveVisualOverallVerdict(state) {
  if (state.budgetExceeded && state.failCount === 0) return "budget-exceeded";
  if (state.failCount > 0) return "fail";
  return "pass";
}

function writeVisualDiffReport(artifactDir, startedAt, verdict, state) {
  if (!artifactDir) return;
  try {
    writeFileSync(
      resolve(artifactDir, "report.json"),
      JSON.stringify({
        scanner: "visual-diff",
        startedAt,
        verdict,
        pass: state.passCount,
        fail: state.failCount,
        skipped: state.skippedCount,
        regressions: state.regressions,
        analyzerCostUsd: state.cumulativeCostUsd,
      }, null, 2) + "\n",
      "utf-8",
    );
  } catch { /* best-effort */ }
}

export async function runVisualDiffScan(ctx) {
  const {
    config = {},
    projectDir,
    runId,
    sliceRef = null,
    now = () => Date.now(),
    env = process.env,
    spawnWorker = null,
    hub = null,
    captureMemory = null,
  } = ctx || {};

  const t0 = now();
  const base = {
    scanner: "visual-diff",
    sliceRef,
    startedAt: new Date(t0).toISOString(),
  };

  const analyzerConfig = {
    ...VISUAL_ANALYZER_DEFAULTS,
    ...(config.visualAnalyzer || {}),
  };
  if (analyzerConfig.enabled === false) {
    return createVisualDiffSkippedFrame(base, now, "scanner-disabled");
  }

  const manifest = getScreenshotManifest(projectDir);
  if (!manifest || manifest.length === 0) {
    return createVisualDiffSkippedFrame(base, now, "no-screenshot-manifest");
  }

  const artifactDir = resolveVisualArtifactDir(projectDir, runId);
  const state = createVisualDiffState();
  for (const entry of manifest) {
    await processVisualDiffEntry({
      entry,
      projectDir,
      runId,
      artifactDir,
      analyzerConfig,
      state,
      spawnWorker,
      hub,
      captureMemory,
      config,
      env,
      sliceRef,
    });
  }

  const verdict = resolveVisualOverallVerdict(state);
  const durationMs = now() - t0;
  writeVisualDiffReport(artifactDir, base.startedAt, verdict, state);

  return {
    ...base,
    verdict,
    pass: state.passCount,
    fail: state.failCount,
    skipped: state.skippedCount,
    violationCount: state.failCount,
    regressions: state.regressions,
    artifactDir,
    durationMs,
    completedAt: new Date(now()).toISOString(),
    ...(state.budgetExceeded ? { details: { budgetExceeded: true, costUsd: state.cumulativeCostUsd } } : {}),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function buildAnalyzerPrompt(url, sliceRef, diffPercent) {
  const sliceContext = sliceRef ? `\nSlice: ${sliceRef.plan} / ${sliceRef.slice}` : "";
  return [
    `You are a visual regression analyzer for the Plan Forge tempering system.`,
    `Compare the baseline screenshot, current screenshot, and diff overlay for: ${url}${sliceContext}`,
    `The pixel diff is ${(diffPercent * 100).toFixed(4)}% — within the investigate band.`,
    `Determine whether this represents a true visual regression or an acceptable change.`,
    `\nRespond with ONLY valid JSON:`,
    `{ "regression": true/false, "severity": "low"|"medium"|"high"|"critical", "explanation": "brief reason" }`,
  ].join("\n");
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function estimateCost(tokens, model) {
  const half = Math.round(tokens / 2);
  return priceSlice(
    { tokens_in: half, tokens_out: tokens - half, model },
    "api-visual-diff",
  ).cost_usd;
}

// ─── Quorum helpers ──────────────────────────────────────────────────

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

function resolveHighestSeverity(votes) {
  let best = null;
  let bestIdx = SEVERITY_ORDER.length;
  for (const v of votes) {
    if (!v.severity) continue;
    const idx = SEVERITY_ORDER.indexOf(v.severity);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      best = v.severity;
    }
  }
  return best;
}

async function runLegWithBudget({ model, prompt, images, timeoutMs, spawnWorker, estimateCost: estCost, budget }) {
  // Skip if budget already exhausted
  if (budget.used() >= budget.cap) {
    return { model, ok: false, error: "budget-exceeded" };
  }

  try {
    const workerResult = await Promise.race([
      spawnWorker({ model, prompt, images, responseFormat: "json" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("analyzer-timeout")), timeoutMs),
      ),
    ]);

    if (!workerResult || typeof workerResult !== "object") {
      return { model, ok: false, error: "empty worker response" };
    }

    const parsed = typeof workerResult.text === "string"
      ? tryParseJson(workerResult.text)
      : workerResult;

    let costUsd = 0;
    if (workerResult.usage) {
      const tokens = (workerResult.usage.inputTokens || 0) + (workerResult.usage.outputTokens || 0);
      costUsd = estCost(tokens, model);
    }

    if (parsed && typeof parsed.regression === "boolean") {
      return {
        model,
        ok: true,
        regression: parsed.regression,
        severity: parsed.severity || null,
        explanation: parsed.explanation || null,
        costUsd,
      };
    }
    return { model, ok: false, error: "malformed-response", costUsd };
  } catch (err) {
    return { model, ok: false, error: err.message || String(err) };
  }
}
