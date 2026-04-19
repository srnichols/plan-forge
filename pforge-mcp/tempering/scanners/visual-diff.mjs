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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getScreenshotManifest,
  getBaseline,
  diffImages,
  hashUrl,
} from "../baselines.mjs";
import { ensureScannerArtifactDir, seedArtifactsGitignore } from "../artifacts.mjs";

// ─── Default visual analyzer config ──────────────────────────────────

const VISUAL_ANALYZER_DEFAULTS = {
  enabled: true,
  ignorableDiff: 0.001,     // 0.1%
  failureDiff: 0.02,        // 2.0%
  maxCostUsd: 2.0,
  mode: "quorum",           // "quorum" | "single"; default "quorum" when models.length >= 2
  models: ["claude-opus-4.7", "gpt-5.3-codex", "grok-4.20"],
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

  const skippedFrame = (reason) => ({
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
  });

  // Merge analyzer settings
  const analyzerConfig = {
    ...VISUAL_ANALYZER_DEFAULTS,
    ...(config.visualAnalyzer || {}),
  };

  if (analyzerConfig.enabled === false) {
    return skippedFrame("scanner-disabled");
  }

  // Read screenshot manifest from TEMPER-03
  const manifest = getScreenshotManifest(projectDir);
  if (!manifest || manifest.length === 0) {
    return skippedFrame("no-screenshot-manifest");
  }

  // Prepare artifact directory for diff overlays
  const artifactDir = ensureScannerArtifactDir(projectDir, runId, "visual-diff");
  if (artifactDir) seedArtifactsGitignore(projectDir);

  const regressions = [];
  let passCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  let cumulativeCostUsd = 0;
  let budgetExceeded = false;

  for (const entry of manifest) {
    const urlHash = entry.urlHash || hashUrl(entry.url);

    // Load baseline
    const baselineBuf = getBaseline(urlHash, projectDir);
    if (!baselineBuf) {
      // First run — no baseline to compare against
      skippedCount++;
      regressions.push({
        url: entry.url,
        urlHash,
        band: "skipped",
        reason: "needs-baseline",
      });
      continue;
    }

    // Load current screenshot
    let currentBuf;
    try {
      if (entry.path && existsSync(entry.path)) {
        currentBuf = readFileSync(entry.path);
      } else {
        // Try to find in current run artifacts
        const candidates = [
          resolve(projectDir, ".forge", "tempering", "artifacts", runId, "ui-playwright", `${urlHash}.png`),
          resolve(projectDir, ".forge", "tempering", "artifacts", runId, "visual-diff", `${urlHash}.png`),
        ];
        for (const c of candidates) {
          if (existsSync(c)) { currentBuf = readFileSync(c); break; }
        }
      }
    } catch { /* fall through */ }

    if (!currentBuf) {
      skippedCount++;
      regressions.push({
        url: entry.url,
        urlHash,
        band: "skipped",
        reason: "no-current-screenshot",
      });
      continue;
    }

    // Pixel diff
    let diffResult;
    try {
      diffResult = diffImages(baselineBuf, currentBuf);
    } catch (err) {
      skippedCount++;
      regressions.push({
        url: entry.url,
        urlHash,
        band: "error",
        reason: `diff-error: ${err.message}`,
      });
      continue;
    }

    // Write diff overlay
    if (artifactDir && diffResult.diffBuffer) {
      try {
        const diffPath = resolve(artifactDir, `${urlHash}-diff.png`);
        writeFileSync(diffPath, diffResult.diffBuffer);
      } catch { /* best-effort */ }
    }

    const { diffPercent } = diffResult;

    // Three-band classification
    if (diffPercent < analyzerConfig.ignorableDiff) {
      // Band 1: pass — negligible difference
      passCount++;
      continue;
    }

    if (diffPercent >= analyzerConfig.failureDiff) {
      // Band 3: automatic fail — too large a diff, skip LLM
      failCount++;
      const regression = {
        url: entry.url,
        urlHash,
        diffPercent,
        band: "fail",
        diffPath: artifactDir ? resolve(artifactDir, `${urlHash}-diff.png`) : null,
      };
      regressions.push(regression);

      // Write baseline + current for dashboard viewer (fail band)
      if (artifactDir) {
        try { writeFileSync(resolve(artifactDir, `${urlHash}-baseline.png`), baselineBuf); } catch { /* best-effort */ }
        try { writeFileSync(resolve(artifactDir, `${urlHash}-current.png`), currentBuf); } catch { /* best-effort */ }
      }

      emit(hub, "tempering-visual-regression-detected", {
        url: entry.url,
        urlHash,
        diffPercent,
        band: "fail",
        verdict: "regression",
        sliceRef,
        artifacts: {
          baseline: artifactDir ? resolve(artifactDir, `${urlHash}-baseline.png`) : null,
          current: artifactDir ? resolve(artifactDir, `${urlHash}-current.png`) : null,
          diff: artifactDir ? resolve(artifactDir, `${urlHash}-diff.png`) : null,
        },
      });
      continue;
    }

    // Band 2: investigate — invoke LLM analyzer
    if (budgetExceeded) {
      // Cost cap already hit — skip remaining analyses
      skippedCount++;
      regressions.push({
        url: entry.url,
        urlHash,
        diffPercent,
        band: "investigate",
        reason: "budget-exceeded",
      });
      continue;
    }

    // Resolve quorum vs single mode
    const quorumModels = analyzerConfig.models || ["claude-opus-4.7"];
    const useQuorum = analyzerConfig.mode !== "single" && quorumModels.length >= 2;
    const threshold = analyzerConfig.agreementThreshold || 2;

    let llmVerdict = null;
    let severity = null;
    let explanation = null;
    let quorumData = null;

    const baselinePath = artifactDir ? resolve(artifactDir, `${urlHash}-baseline.png`) : null;
    const currentPath = artifactDir ? resolve(artifactDir, `${urlHash}-current.png`) : null;
    const diffPath = artifactDir ? resolve(artifactDir, `${urlHash}-diff.png`) : null;

    // Write baseline + current artifacts for dashboard viewer
    if (artifactDir) {
      try { writeFileSync(resolve(artifactDir, `${urlHash}-baseline.png`), baselineBuf); } catch { /* best-effort */ }
      try { writeFileSync(resolve(artifactDir, `${urlHash}-current.png`), currentBuf); } catch { /* best-effort */ }
    }

    if (spawnWorker && useQuorum) {
      // ── Quorum dispatch ──
      const prompt = buildAnalyzerPrompt(entry.url, sliceRef, diffPercent);
      const baselineB64 = baselineBuf.toString("base64");
      const currentB64 = currentBuf.toString("base64");
      const diffB64 = diffResult.diffBuffer ? diffResult.diffBuffer.toString("base64") : null;
      const images = [
        { type: "baseline", data: baselineB64 },
        { type: "current", data: currentB64 },
      ];
      if (diffB64) images.push({ type: "diff", data: diffB64 });

      const legs = await Promise.allSettled(
        quorumModels.map(model => runLegWithBudget({
          model, prompt, images,
          timeoutMs: analyzerConfig.analyzerTimeoutMs,
          spawnWorker, estimateCost,
          budget: { cap: analyzerConfig.maxCostUsd, used: () => cumulativeCostUsd },
        }))
      );

      const votes = legs.map((leg, i) => {
        const model = quorumModels[i];
        if (leg.status === "rejected") {
          return { model, ok: false, error: leg.reason?.message || String(leg.reason) };
        }
        const v = leg.value;
        // Track cost
        if (v.costUsd) {
          cumulativeCostUsd += v.costUsd;
          if (cumulativeCostUsd >= analyzerConfig.maxCostUsd) budgetExceeded = true;
        }
        return v;
      });

      const valid = votes.filter(v => v.ok);
      const yes = valid.filter(v => v.regression).length;
      const no = valid.length - yes;
      const agreementMet = yes >= threshold || no >= threshold;

      llmVerdict =
        !agreementMet ? "inconclusive" :
        yes >= threshold ? "regression" :
        "acceptable";

      // Severity = highest among winning majority
      if (llmVerdict === "regression") {
        const winners = valid.filter(v => v.regression);
        severity = resolveHighestSeverity(winners);
        explanation = winners.map(v => `${v.model}: ${v.explanation || "regression"}`).join("; ");
      } else if (llmVerdict === "acceptable") {
        const winners = valid.filter(v => !v.regression);
        explanation = winners.map(v => `${v.model}: ${v.explanation || "acceptable"}`).join("; ");
      } else {
        explanation = `Insufficient agreement: ${yes} regression, ${no} acceptable out of ${valid.length} valid legs (threshold: ${threshold})`;
      }

      quorumData = {
        models: quorumModels,
        votes: votes.map(v => ({
          model: v.model,
          regression: v.regression ?? null,
          severity: v.severity ?? null,
          explanation: v.explanation ?? null,
          ok: !!v.ok,
        })),
        agreement: `${Math.max(yes, no)}-of-${valid.length}`,
        threshold,
      };
    } else if (spawnWorker) {
      // ── Single-model path (backward compat) ──
      try {
        const model = quorumModels[0] || "claude-opus-4.7";
        const prompt = buildAnalyzerPrompt(entry.url, sliceRef, diffPercent);
        const images = [
          { type: "baseline", data: baselineBuf.toString("base64") },
          { type: "current", data: currentBuf.toString("base64") },
        ];
        if (diffResult.diffBuffer) {
          images.push({ type: "diff", data: diffResult.diffBuffer.toString("base64") });
        }

        const workerResult = await Promise.race([
          spawnWorker({
            model,
            prompt,
            images,
            responseFormat: "json",
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("analyzer-timeout")), analyzerConfig.analyzerTimeoutMs),
          ),
        ]);

        if (workerResult && typeof workerResult === "object") {
          const parsed = typeof workerResult.text === "string"
            ? tryParseJson(workerResult.text)
            : workerResult;

          if (parsed && typeof parsed.regression === "boolean") {
            llmVerdict = parsed.regression ? "regression" : "acceptable";
            severity = parsed.severity || null;
            explanation = parsed.explanation || null;
          } else {
            llmVerdict = "inconclusive";
            explanation = "LLM response did not match expected schema";
          }

          if (workerResult.usage) {
            const tokens = (workerResult.usage.inputTokens || 0) + (workerResult.usage.outputTokens || 0);
            cumulativeCostUsd += estimateCost(tokens, model);
            if (cumulativeCostUsd >= analyzerConfig.maxCostUsd) {
              budgetExceeded = true;
            }
          }
        } else {
          llmVerdict = "inconclusive";
          explanation = "empty worker response";
        }
      } catch (err) {
        llmVerdict = "inconclusive";
        explanation = err.message || String(err);
      }
    } else {
      const hasKey = env?.ANTHROPIC_API_KEY || env?.OPENAI_API_KEY || env?.XAI_API_KEY;
      if (!hasKey) {
        llmVerdict = "inconclusive";
        explanation = "no API key configured";
      } else {
        llmVerdict = "inconclusive";
        explanation = "no spawnWorker provided";
      }
    }

    const regression = {
      url: entry.url,
      urlHash,
      diffPercent,
      band: "investigate",
      llmVerdict,
      severity,
      explanation,
      diffPath,
      ...(quorumData ? { quorum: quorumData } : {}),
    };
    regressions.push(regression);

    // Build event payload with artifacts + quorum
    const eventPayload = {
      url: entry.url,
      urlHash,
      diffPercent,
      band: "investigate",
      verdict: llmVerdict,
      severity,
      explanation,
      sliceRef,
      ...(quorumData ? { quorum: quorumData } : {}),
      artifacts: { baseline: baselinePath, current: currentPath, diff: diffPath },
    };

    if (llmVerdict === "regression") {
      failCount++;
      emit(hub, "tempering-visual-regression-detected", eventPayload);
    } else if (llmVerdict === "acceptable") {
      passCount++;
      emit(hub, "tempering-visual-regression-detected", eventPayload);
    } else {
      // inconclusive — count as skipped (advisory, not pass or fail)
      skippedCount++;
      emit(hub, "tempering-visual-regression-detected", eventPayload);
    }

    // L3 capture — text only, never images
    if (captureMemory) {
      try {
        captureMemory(
          `Visual quorum ${llmVerdict}: ${entry.url} (${(diffPercent * 100).toFixed(2)}% diff). ` +
          (quorumData
            ? quorumData.votes.filter(v => v.ok).map(v => `${v.model}:${v.regression ? "reg" : "ok"}`).join(", ")
            : `single-model: ${llmVerdict}`),
          llmVerdict === "inconclusive" ? "gotcha" : "decision",
          `forge_tempering_scan/visual-diff/${llmVerdict}`,
          projectDir,
        );
      } catch { /* best-effort */ }
    }
  }

  // Overall verdict
  let verdict;
  if (budgetExceeded && failCount === 0) verdict = "budget-exceeded";
  else if (failCount > 0) verdict = "fail";
  else verdict = "pass";

  const durationMs = now() - t0;

  // Write report artifact
  if (artifactDir) {
    try {
      writeFileSync(
        resolve(artifactDir, "report.json"),
        JSON.stringify({
          scanner: "visual-diff",
          startedAt: base.startedAt,
          verdict,
          pass: passCount,
          fail: failCount,
          skipped: skippedCount,
          regressions,
          analyzerCostUsd: cumulativeCostUsd,
        }, null, 2) + "\n",
        "utf-8",
      );
    } catch { /* best-effort */ }
  }

  return {
    ...base,
    verdict,
    pass: passCount,
    fail: failCount,
    skipped: skippedCount,
    violationCount: failCount,
    regressions,
    artifactDir,
    durationMs,
    completedAt: new Date(now()).toISOString(),
    ...(budgetExceeded ? { details: { budgetExceeded: true, costUsd: cumulativeCostUsd } } : {}),
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
  const rates = {
    "claude-opus-4.7": 0.000075,
    "claude-sonnet-4.5": 0.000015,
    "gpt-4o": 0.00005,
    "gpt-5.3-codex": 0.00005,
    "grok-4.20": 0.00005,
  };
  return tokens * (rates[model] || 0.00005);
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
