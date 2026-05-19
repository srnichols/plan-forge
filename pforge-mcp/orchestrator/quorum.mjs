/** Plan Forge — Phase-53 S9: quorum sub-module */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildMemorySearchBlock } from "../memory.mjs";
import { QUORUM_PRESETS } from "./constants.mjs";
import { readForgeJsonl } from "./forge-io.mjs";
import { scoreSliceComplexity } from "./review-watcher.mjs";
import { spawnWorker } from "./worker-spawn.mjs";
import { buildSlicePrompt } from "./prompt-builders.mjs";
import { priceSlice as _priceSlice, priceRun as _priceRun } from "../cost-service.mjs";

export function loadQuorumConfig(cwd, presetOverride = null) {
  const defaults = {
    enabled: false,
    auto: true,
    // Phase-31 Slice 5: recalibrated from 6 → 3 based on empirical distribution
    // across Phase-25–30 plans (63 slices). At threshold=6 only 1/63 slices
    // triggered quorum. At threshold=3 (60th-percentile score), 56/63 slices
    // qualify — matching the intent of "complex slices get multi-model review".
    threshold: 3,
    // Bug #107: default uses the standard tier (opus-4.6). Users who want
    // the premium tier (opus-4.7) opt in via --quorum=power. Reviewer stays
    // on 4.7 since it only runs once per slice and the spend is bounded.
    models: ["claude-opus-4.6", "gpt-5.3-codex", "grok-4.20-0309-reasoning"],
    reviewerModel: "claude-opus-4.7",
    dryRunTimeout: 300_000, // 5 min per dry-run leg
    strictAvailability: false, // H.3: true = fast-fail if any model unavailable
  };

  // Adaptive threshold: learn from quorum history which slices actually need quorum
  try {
    const qHistory = readForgeJsonl("quorum-history.jsonl", [], cwd); // G2.1
    if (qHistory.length >= 5) {
      const needed = qHistory.filter(q => q.quorumNeeded).length;
      const total = qHistory.length;
      const neededRate = needed / total;
      // If <20% of slices needed quorum, raise threshold (fewer get quorum)
      // If >60% needed quorum, lower threshold (more get quorum)
      if (neededRate < 0.2 && defaults.threshold < 9) defaults.threshold = Math.min(9, defaults.threshold + 1);
      else if (neededRate > 0.6 && defaults.threshold > 3) defaults.threshold = Math.max(3, defaults.threshold - 1);
    }
  } catch { /* use static default */ }
  const configPath = resolve(cwd, ".forge.json");
  let userConfig = {};
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config.quorum && typeof config.quorum === "object") {
        userConfig = config.quorum;
      }
    }
  } catch { /* defaults */ }

  // Resolve preset: CLI override > .forge.json preset > none
  const presetName = presetOverride || userConfig.preset || null;
  const preset = presetName ? QUORUM_PRESETS[presetName] || {} : {};

  // Merge order: defaults < preset < userConfig (explicit fields win)
  return { ...defaults, ...preset, ...userConfig, ...(presetOverride ? { preset: presetOverride } : {}) };
}

/**
 * Score a slice's technical complexity on a 1-10 scale.
 *
 * Weighted signals:
 *   - File count in scope (20%) — saturates at 3 files
 *   - Cross-module dependencies (20%) — saturates at 3 deps
 *   - Security-sensitive keywords (15%) — saturates at 2 hits
 *   - Database/migration keywords (15%) — saturates at 2 hits
 *   - Acceptance criteria / gate length (10%) — saturates at 3 lines
 *   - Task count (10%) — saturates at 6 tasks
 *   - Historical failure rate (10%)
 *
 * @param {object} slice - Parsed slice from plan
 * @param {string} cwd - Working directory (for historical data)
 * @returns {{ score: number, signals: object }}
 */
// Phase-53 S7: scoreSliceComplexity, getHistoricalFailureRate → orchestrator/review-watcher.mjs

/**
 * Build the dry-run prompt for quorum dispatch.
 * Wraps the original slice prompt with dry-run instructions.
 */
function buildDryRunPrompt(slice) {
  const originalPrompt = buildSlicePrompt(slice);
  return [
    "You are in QUORUM DRY-RUN mode. Do NOT execute any code changes.",
    "Do NOT create, modify, or delete any files.",
    "",
    "Instead, produce a detailed implementation plan for the slice below:",
    "",
    "1. **Files to create or modify** — exact paths, one per line",
    "2. **Implementation approach** — for each file, describe the key changes (classes, methods, patterns)",
    "3. **Edge cases and failure modes** — what could go wrong, how to handle it",
    "4. **Testing strategy** — how to verify the validation gate passes",
    "5. **Risk assessment** — rate confidence (high/medium/low) and explain concerns",
    "",
    "--- ORIGINAL SLICE INSTRUCTIONS ---",
    originalPrompt,
  ].join("\n");
}

/**
 * Build the reviewer synthesis prompt from dry-run responses.
 */
function buildReviewerPrompt(dryRunResults, slice) {
  const originalPrompt = buildSlicePrompt(slice);
  const parts = [
    "You are the QUORUM REVIEWER. Three AI models independently analyzed the same coding task",
    "and produced implementation plans. Your job is to synthesize the BEST execution plan.",
    "",
    "Rules:",
    "- Pick the BEST approach for each file/component (not necessarily from the same model)",
    "- When models DISAGREE on architecture, choose the approach with better error handling and testability",
    "- Flag any RISK AREAS where all three models expressed concerns",
    "- Produce a CONCRETE execution plan (not vague guidance) — the output will be used as instructions for the executing agent",
    "- Include specific file paths, class names, method signatures, and patterns to use",
    "",
  ];

  for (let i = 0; i < dryRunResults.length; i++) {
    const r = dryRunResults[i];
    parts.push(`--- MODEL ${String.fromCharCode(65 + i)} (${r.model}) ---`);
    parts.push(r.output || "(no response)");
    parts.push("");
  }

  parts.push("--- ORIGINAL SLICE ---");
  parts.push(originalPrompt);
  parts.push("");
  parts.push("Produce the unified execution plan now.");

  return parts.join("\n");
}

const LEG_ERROR_PATTERNS = [
  [/timed?\s*out|ETIMEDOUT|SIGTERM/i, "timeout"],
  [/rate[- ]?limit|429/i, "rate-limit"],
  [/context|token limit|max tokens/i, "context-overflow"],
  [/ENOENT|spawn\s+\w+\s+ENOENT|EACCES/i, "spawn-failed"],
];
export function classifyLegError(stderr) {
  const text = String(stderr || "");
  for (const [re, reason] of LEG_ERROR_PATTERNS) {
    if (re.test(text)) return reason;
  }
  return "unknown";
}

function emitQuorumLegCompleted(eventBus, sliceNumber, legResult) {
  if (eventBus) {
    eventBus.emit("quorum-leg-completed", { sliceId: sliceNumber, ...legResult });
  }
}

function createSuccessfulLegResult(model, result, legStart) {
  const legResult = {
    model,
    output: result.output || result.stderr || "",
    tokens: result.tokens,
    duration: Date.now() - legStart,
    exitCode: result.exitCode,
    success: true,
  };
  legResult.success = (legResult.output || "").trim().length > 50;
  if (!legResult.success) {
    const stderr = String(result?.stderr || "").slice(-2048);
    legResult.error = {
      code: legResult.exitCode ?? 1,
      reason: classifyLegError(stderr),
      stderr,
    };
  }
  return legResult;
}

function createFailedLegResult(model, err, legStart) {
  const rawStderr = err?.stderr ?? err?.message ?? String(err ?? "");
  const stderr = rawStderr.slice(-2048);
  const exitCode = Number.isInteger(err?.exitCode) ? err.exitCode : (err?.code ?? 1);
  return {
    model,
    output: "",
    tokens: { tokens_in: null, tokens_out: null, model },
    duration: Date.now() - legStart,
    exitCode,
    success: false,
    error: { code: exitCode, reason: classifyLegError(stderr), stderr },
  };
}

async function executeQuorumLeg({ model, dryPrompt, cwd, timeoutMs, eventBus, sliceNumber }) {
  const legStart = Date.now();
  try {
    const result = await spawnWorker(dryPrompt, {
      model,
      cwd,
      timeout: timeoutMs,
      role: "quorum-dry-run",
    });
    const legResult = createSuccessfulLegResult(model, result, legStart);
    emitQuorumLegCompleted(eventBus, sliceNumber, legResult);
    return legResult;
  } catch (err) {
    const legResult = createFailedLegResult(model, err, legStart);
    emitQuorumLegCompleted(eventBus, sliceNumber, legResult);
    return legResult;
  }
}

/**
 * Dispatch a slice to multiple models for parallel dry-run analysis.
 * Returns array of dry-run results.
 *
 * @param {object} slice - Parsed slice
 * @param {object} config - Quorum config from loadQuorumConfig()
 * @param {object} options - { cwd, eventBus, memoryEnabled, projectName }
 * @returns {Promise<{ model: string, output: string, tokens: object, duration: number, exitCode: number }[]>}
 */
export async function quorumDispatch(slice, config, options = {}) {
  const { cwd = process.cwd(), eventBus = null, memoryEnabled = false, projectName = "" } = options;

  let dryPrompt = buildDryRunPrompt(slice);

  // OpenBrain: inject memory search for dry-run agents too
  if (memoryEnabled) {
    dryPrompt = buildMemorySearchBlock(projectName, slice) + "\n" + dryPrompt;
  }

  if (eventBus) {
    eventBus.emit("quorum-dispatch-started", {
      sliceId: slice.number,
      models: config.models,
      score: options.complexityScore || null,
    });
  }

  const startTime = Date.now();
  const timeoutMs = config.dryRunTimeout || 300_000;
  const promises = config.models.map((model) => executeQuorumLeg({
    model,
    dryPrompt,
    cwd,
    timeoutMs,
    eventBus,
    sliceNumber: slice.number,
  }));

  const results = await Promise.all(promises);

  // Filter to successful responses
  const successful = results.filter((r) => r.success && (r.output || "").trim().length > 0);

  return { all: results, successful, totalDuration: Date.now() - startTime };
}

/**
 * Synthesize multiple dry-run responses into a unified execution plan.
 * Spawns a reviewer agent to merge the best elements.
 *
 * @param {{ successful: object[] }} dispatchResult - Output from quorumDispatch()
 * @param {object} slice - Original slice
 * @param {object} config - Quorum config
 * @param {object} options - { cwd, eventBus }
 * @returns {Promise<{ enhancedPrompt: string, reviewerTokens: object, reviewerCost: number, modelResponses: object[] }>}
 */
export async function quorumReview(dispatchResult, slice, config, options = {}) {
  const { cwd = process.cwd(), eventBus = null } = options;
  const { successful } = dispatchResult;

  // Need at least 2 responses for meaningful consensus
  if (successful.length < 2) {
    // Fall back: use the single best response or original prompt
    const fallback = successful.length === 1
      ? `Based on analysis, here is the recommended approach:\n\n${successful[0].output}\n\n--- EXECUTE ---\n${buildSlicePrompt(slice)}`
      : buildSlicePrompt(slice);

    return {
      enhancedPrompt: fallback,
      reviewerTokens: { tokens_in: 0, tokens_out: 0, model: "none" },
      reviewerCost: 0,
      modelResponses: successful,
      fallback: true,
    };
  }

  const reviewerPrompt = buildReviewerPrompt(successful, slice);

  try {
    const reviewerResult = await spawnWorker(reviewerPrompt, {
      model: config.reviewerModel,
      cwd,
      timeout: config.dryRunTimeout || 300_000,
      role: "reviewer", // bug #80: API providers see system-framed prompt
    });

    const enhancedPrompt = [
      `Execute Slice ${slice.number}: ${slice.title}`,
      "",
      "The following execution plan was synthesized from multi-model consensus analysis.",
      "Follow this plan precisely:",
      "",
      reviewerResult.output,
      "",
      "--- ORIGINAL REQUIREMENTS ---",
      // Include scope and gate from original so they're not lost
      ...(slice.scope && slice.scope.length > 0
        ? [`SCOPE: Only modify files matching: ${slice.scope.join(", ")}`, "Do NOT create or modify files outside this scope.", ""]
        : []),
      ...(slice.validationGate
        ? ["Validation gate (run these after completion):", slice.validationGate, ""]
        : []),
    ].join("\n");

    if (eventBus) {
      eventBus.emit("quorum-review-completed", {
        sliceId: slice.number,
        reviewerModel: config.reviewerModel,
        tokens: reviewerResult.tokens,
        modelCount: successful.length,
      });
    }

    return {
      enhancedPrompt,
      reviewerTokens: reviewerResult.tokens,
      reviewerCost: calculateSliceCost(reviewerResult.tokens).cost_usd,
      modelResponses: successful,
      fallback: false,
    };
  } catch (err) {
    // Reviewer failed — fall back to best single dry-run
    const best = successful.reduce((a, b) =>
      (a.output || "").length > (b.output || "").length ? a : b);

    return {
      enhancedPrompt: `Based on analysis by ${best.model}, here is the recommended approach:\n\n${best.output || ""}\n\n--- EXECUTE ---\n${buildSlicePrompt(slice)}`,
      reviewerTokens: { tokens_in: 0, tokens_out: 0, model: "none" },
      reviewerCost: 0,
      modelResponses: successful,
      fallback: true,
      error: err.message,
    };
  }
}

// ─── Quorum Analysis ─────────────────────────────────────────────────

/**
 * Multi-model analysis of a plan or file.
 * Dispatches independent analysis to N models, then synthesizes findings.
 *
 * Modes:
 *   - plan: Analyze a hardened plan for consistency, coverage gaps, risk
 *   - file: Analyze source file(s) for bugs, patterns, improvements
 *
 * @param {object} options - { target, mode, models, cwd }
 * @returns {Promise<{ results, synthesis, cost }>}
 */
export async function analyzeWithQuorum(options = {}) {
  const {
    target,
    mode = "plan",   // "plan" | "file" | "diagnose"
    models = null,
    cwd = process.cwd(),
  } = options;

  const config = loadQuorumConfig(cwd);
  const analyzeModels = models || config.models;

  // Build analysis prompt based on mode
  let content;
  try {
    content = readFileSync(resolve(cwd, target), "utf-8");
  } catch (err) {
    throw new Error(`Cannot read analysis target: ${target} — ${err.message}`);
  }

  const prompt = mode === "plan"
    ? buildPlanAnalysisPrompt(content, target)
    : mode === "diagnose"
      ? buildDiagnosePrompt(content, target)
      : buildFileAnalysisPrompt(content, target);

  console.log(`\n🗳️  Quorum Analysis — dispatching to ${analyzeModels.length} models...`);
  console.log(`   Target: ${target} (${mode} mode)`);
  console.log(`   Models: ${analyzeModels.join(", ")}\n`);

  // Dispatch to all models in parallel
  const startTime = Date.now();
  const promises = analyzeModels.map(async (model) => {
    const legStart = Date.now();
    console.log(`   ⏳ ${model} — analyzing...`);
    try {
      const result = await spawnWorker(prompt, {
        model,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
        role: "analysis", // bug #80: API providers see system-framed prompt
      });
      const duration = Date.now() - legStart;
      console.log(`   ✅ ${model} — done (${Math.round(duration / 1000)}s)`);
      return {
        model,
        output: result.output || "",
        tokens: result.tokens,
        duration,
        success: (result.output || "").trim().length > 50,
        worker: result.worker,
      };
    } catch (err) {
      const duration = Date.now() - legStart;
      console.log(`   ❌ ${model} — failed: ${err.message}`);
      return {
        model,
        output: "",
        tokens: { tokens_in: 0, tokens_out: 0, model },
        duration,
        success: false,
        error: err.message,
        worker: "failed",
      };
    }
  });

  const results = await Promise.all(promises);
  const successful = results.filter((r) => r.success);
  const totalDuration = Date.now() - startTime;

  console.log(`\n   📊 ${successful.length}/${results.length} models returned results (${Math.round(totalDuration / 1000)}s total)`);

  // Synthesize findings if we have 2+ responses
  let synthesis = null;
  let synthesisCost = 0;
  if (successful.length >= 2) {
    console.log(`   🔄 Synthesizing with ${config.reviewerModel}...`);
    const synthPrompt = buildAnalysisSynthesisPrompt(successful, target, mode);
    try {
      const synthResult = await spawnWorker(synthPrompt, {
        model: config.reviewerModel,
        cwd,
        timeout: config.dryRunTimeout || 300_000,
        role: "reviewer", // bug #80: API providers see system-framed prompt
      });
      synthesis = synthResult.output || "";
      synthesisCost = calculateSliceCost(synthResult.tokens).cost_usd;
      console.log(`   ✅ Synthesis complete`);
    } catch (err) {
      console.log(`   ⚠️  Synthesis failed: ${err.message} — returning raw results`);
    }
  } else if (successful.length === 1) {
    synthesis = successful[0].output;
  }

  // Calculate total cost
  let totalCost = synthesisCost;
  for (const r of results) {
    totalCost += calculateSliceCost(r.tokens).cost_usd;
  }

  return {
    target,
    mode,
    models: analyzeModels,
    results: results.map((r) => ({
      model: r.model,
      output: r.output,
      duration: r.duration,
      success: r.success,
      worker: r.worker,
      cost: calculateSliceCost(r.tokens).cost_usd,
      error: r.error,
    })),
    synthesis,
    totalDuration,
    totalCost: Math.round(totalCost * 100) / 100,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build analysis prompt for a hardened plan file.
 */
function buildPlanAnalysisPrompt(content, filename) {
  return [
    "You are a senior software architect performing an independent code review of a hardened execution plan.",
    "Analyze the following plan and report on:",
    "",
    "1. **Consistency**: Are slice dependencies correct? Do scopes overlap or conflict?",
    "2. **Coverage Gaps**: Are there untested edge cases, missing error handlers, or validation gaps?",
    "3. **Risk Assessment**: Which slices have the highest failure risk and why?",
    "4. **Naming & Style**: Are naming conventions consistent across slices?",
    "5. **Security**: Any security concerns in the planned implementation?",
    "6. **Improvement Suggestions**: Concrete, actionable improvements.",
    "",
    "Format your response as structured Markdown with clear headings for each category.",
    "Rate each category as: ✅ Good | ⚠️ Needs Attention | ❌ Critical Issue",
    "End with an overall confidence score (1-10) for plan readiness.",
    "",
    `--- PLAN: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build analysis prompt for source file(s).
 */
function buildFileAnalysisPrompt(content, filename) {
  return [
    "You are a senior software engineer performing an independent code review.",
    "Analyze the following file and report on:",
    "",
    "1. **Bugs**: Logic errors, null reference risks, race conditions, off-by-one errors",
    "2. **Security**: Input validation gaps, injection risks, auth issues, secret exposure",
    "3. **Performance**: Hot paths, unnecessary allocations, N+1 queries, missing caching",
    "4. **Architecture**: Separation of concerns, testability, coupling issues",
    "5. **Error Handling**: Missing error handlers, swallowed exceptions, incomplete recovery",
    "6. **Improvements**: Concrete, actionable fixes with code snippets where helpful",
    "",
    "Format your response as structured Markdown with clear headings.",
    "Rate each category as: ✅ Good | ⚠️ Needs Attention | ❌ Critical Issue",
    "End with an overall code quality score (1-10).",
    "",
    `--- FILE: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build diagnosis prompt for bug investigation.
 * Focused on root cause analysis, failure modes, and fix recommendations.
 */
function buildDiagnosePrompt(content, filename) {
  return [
    "You are a senior software engineer performing a focused bug investigation.",
    "The user suspects there may be bugs or reliability issues in this file.",
    "Investigate thoroughly and report on:",
    "",
    "1. **Root Cause Analysis**: What bugs exist? Trace the exact code path for each.",
    "2. **Failure Modes**: How will each bug manifest at runtime? Under what conditions?",
    "3. **Reproduction Steps**: How would you trigger each bug? What inputs or state?",
    "4. **Impact Assessment**: Severity (crash/data loss/wrong result/cosmetic) and blast radius",
    "5. **Fix Recommendations**: Exact code changes needed. Show before/after snippets.",
    "6. **Regression Risk**: Could the fixes break other functionality? What tests should be added?",
    "",
    "Be thorough — examine every code path, every edge case, every null/undefined risk.",
    "Check for: race conditions, boundary values, error propagation, resource leaks,",
    "unhandled promise rejections, type coercion bugs, off-by-one errors, stale closures.",
    "",
    "Format your response as structured Markdown with clear headings.",
    "Rate overall reliability as: ✅ Solid | ⚠️ Has Issues | ❌ Unreliable",
    "End with a prioritized fix list (fix most critical bugs first).",
    "",
    `--- FILE UNDER INVESTIGATION: ${filename} ---`,
    content,
  ].join("\n");
}

/**
 * Build synthesis prompt from multiple model analysis results.
 */
function buildAnalysisSynthesisPrompt(successful, target, mode) {
  const type = mode === "plan" ? "plan analysis" : mode === "diagnose" ? "bug investigation" : "code review";
  let prompt = [
    `You are a senior technical reviewer synthesizing ${type} results from ${successful.length} independent AI models.`,
    `Each model independently analyzed: ${target}`,
    "",
    "Your job is to:",
    "1. Identify findings that MULTIPLE models agree on (high confidence)",
    "2. Flag unique findings from single models that seem valid (medium confidence)",
    "3. Resolve any contradictions between models",
    "4. Produce a unified, prioritized report",
    "",
    "Format: Structured Markdown with priority levels (🔴 Critical, 🟡 Important, 🟢 Minor).",
    "Include a confidence indicator for each finding: [Consensus: N/M models agree]",
    "End with an overall assessment and top 3 action items.",
    "",
  ].join("\n");

  for (const r of successful) {
    prompt += `\n--- ANALYSIS BY ${r.model} ---\n${r.output}\n`;
  }

  return prompt;
}

// ─── Pricing + Cost Estimation ────────────────────────────────────────
// Phase-27 (v2.60.0): Canonical pricing + estimation logic lives in
// ./cost-service.mjs. This block imports and re-exports the functions so
// existing `import { calculateSliceCost, buildCostBreakdown, buildEstimate }
// from "./orchestrator.mjs"` call sites (tests, sdk consumers, internal
// orchestrator code below) remain drop-in compatible.
//
// NOTE: We use function declarations (hoisted, live from module-init) rather
// than `export const` aliases. Under vitest with circular imports the const

export function calculateSliceCost(tokens, worker) {
  return _priceSlice(tokens, worker);
}
export function buildCostBreakdown(sliceResults) {
  return _priceRun(sliceResults);
}
