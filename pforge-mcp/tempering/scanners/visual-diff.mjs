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
  models: ["claude-opus-4.7"],
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

      emit(hub, "tempering-visual-regression-detected", {
        url: entry.url,
        urlHash,
        diffPercent,
        band: "fail",
        sliceRef,
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

    let llmVerdict = null;
    let severity = null;
    let explanation = null;

    if (spawnWorker) {
      try {
        const model = analyzerConfig.models?.[0] || "claude-opus-4.7";
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

        // Parse response
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

          // Track cost
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
      // No spawnWorker — can't analyze, mark inconclusive
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
      diffPath: artifactDir ? resolve(artifactDir, `${urlHash}-diff.png`) : null,
    };
    regressions.push(regression);

    if (llmVerdict === "regression") {
      failCount++;
      emit(hub, "tempering-visual-regression-detected", {
        url: entry.url,
        urlHash,
        diffPercent,
        band: "investigate",
        severity,
        explanation,
        sliceRef,
      });
    } else if (llmVerdict === "acceptable") {
      passCount++;
    } else {
      // inconclusive — count as skipped (advisory, not pass or fail)
      skippedCount++;
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
  // Conservative per-token cost estimates (USD per token)
  const rates = {
    "claude-opus-4.7": 0.000075,
    "claude-sonnet-4.5": 0.000015,
    "gpt-4o": 0.00005,
  };
  return tokens * (rates[model] || 0.00005);
}
