/**
 * Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) S4: run-plan sub-module
 *
 * Contains the self-contained helpers extracted from the Orchestrator section
 * of orchestrator.mjs: competitive config, adaptive gate synthesis, incident
 * fix-proposal auto-retry, cost-anomaly detection, and plan-postmortem helpers.
 *
 * runPlan itself remains in orchestrator.mjs until S9, when all of its
 * transitive dependencies (executeSlice, buildEstimate, loadQuorumConfig, etc.)
 * have been extracted to their own sub-modules and the circular-import cycle
 * with cost-service.mjs has been cleared.
 */

// runPlan — main plan execution entry point (orchestrator.mjs); wired here at S9.

import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { execSync } from "node:child_process";
import {
  GATE_SUGGESTION_AUTO_INJECT_THRESHOLD,
  PROPOSED_FIX_DIR,
  COST_ANOMALY_MULTIPLIER,
  POSTMORTEM_RETENTION_COUNT,
} from "./constants.mjs";
import { computeGateSuggestionKey, getGateSuggestionCounter } from "../memory.mjs";
import { getMinimaForDomain } from "../tempering.mjs";

// ─── Phase-26 Slice 2 — Competitive config ────────────────────────────

/**
 * Phase-26 Slice 2 — load runtime.competitive configuration.
 * Schema:
 *   { "runtime": { "competitive": { "maxVariants": 3, "archiveDays": 7 } } }
 * Defaults: maxVariants=3 (clamped [2,5]); archiveDays=7.
 * @param {string} cwd
 * @returns {{ maxVariants: number, archiveDays: number }}
 */
export function loadCompetitiveConfig(cwd) {
  const defaults = { maxVariants: 3, archiveDays: 7 };
  const configPath = resolve(cwd, ".forge.json");
  try {
    if (!existsSync(configPath)) return defaults;
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const raw = config?.runtime?.competitive ?? {};
    const out = { ...defaults };
    if (Number.isFinite(raw.maxVariants)) {
      const n = Math.trunc(raw.maxVariants);
      out.maxVariants = Math.min(5, Math.max(2, n));
    }
    if (Number.isFinite(raw.archiveDays) && raw.archiveDays > 0) {
      out.archiveDays = Math.trunc(raw.archiveDays);
    }
    return out;
  } catch {
    return defaults;
  }
}

// ─── Phase-25 Slice 4: Adaptive gate synthesis (L6) ──────────────────

/**
 * Domain-keyword patterns used by `synthesizeGateSuggestions` to tag a slice
 * with a Tempering profile (domain / integration / controller). Order matters
 * — first match wins. Patterns are intentionally conservative; false positives
 * here produce advisory noise, false negatives are silent no-ops.
 */
const GATE_SYNTH_DOMAIN_PATTERNS = [
  { domain: "controller",  pattern: /\b(controller|endpoint|route|api|http|rest)\b/i },
  { domain: "integration", pattern: /\b(integration|e2e|end-to-end|contract|workflow|pipeline|migrat)\b/i },
  { domain: "domain",      pattern: /\b(domain|service|aggregate|entity|repository|model|business|validation)\b/i },
];

/**
 * Vitest/jest-style suggested gate commands per domain, keyed for portability.
 *
 * Uses the per-line `node -e "process.chdir(); execSync()"` pattern proven by
 * Phase 41 and Phase 51. This is dispatched by runGate() via the inline-node
 * fast path (execFileSync with shell:false) — no PowerShell or cmd.exe
 * parsing, so the script body survives Windows verbatim.
 *
 * Earlier versions emitted `bash -c "cd pforge-mcp && npx vitest run ..."`
 * here. That pattern was mangled by the Windows cmd→bash quoting shim
 * whenever it was combined with `&&` and a nested `node -e "..."` (Phase 51
 * S0 hit this; recovery cost a partial worker run). See memory note
 * /memories/repo/phase-51-gate-recovery.md.
 */
const GATE_SYNTH_TEMPLATES = {
  domain:      "node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/<your-domain>.test.mjs', {stdio:'inherit',shell:true});\"",
  integration: "node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/<your-integration>.test.mjs', {stdio:'inherit',shell:true});\"",
  controller:  "node -e \"process.chdir('pforge-mcp'); require('child_process').execSync('npx vitest run tests/<your-controller>.test.mjs', {stdio:'inherit',shell:true});\"",
};

export { GATE_SUGGESTION_AUTO_INJECT_THRESHOLD };

/**
 * Load the `runtime.gateSynthesis` config block with defaults.
 * Schema: { mode: "off" | "suggest" | "enforce", domains: string[] }
 * Default: { mode: "suggest", domains: ["domain","integration","controller"] }
 * (Phase-25 D8.)
 */
export function loadGateSynthesisConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  const defaults = { mode: "suggest", domains: ["domain", "integration", "controller"] };
  try {
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      const block = cfg?.runtime?.gateSynthesis;
      if (block && typeof block === "object") {
        const mode = ["off", "suggest", "enforce"].includes(block.mode) ? block.mode : defaults.mode;
        const domains = Array.isArray(block.domains) && block.domains.length > 0
          ? block.domains.filter((d) => typeof d === "string" && d.length > 0)
          : defaults.domains;
        return { mode, domains };
      }
    }
  } catch { /* fall through */ }
  return { ...defaults };
}

/**
 * Classify a slice's domain profile by matching its title + files against
 * `GATE_SYNTH_DOMAIN_PATTERNS`. Returns `null` when no keyword matches.
 */
export function classifySliceDomain(slice) {
  if (!slice) return null;
  const fileList = Array.isArray(slice.files) ? slice.files : [];
  const haystack = [slice.title || "", ...fileList].join(" ").toLowerCase();
  for (const { domain, pattern } of GATE_SYNTH_DOMAIN_PATTERNS) {
    if (pattern.test(haystack)) return domain;
  }
  return null;
}

/**
 * Phase-25 MUST #9 — Suggest gates for slices that lack a domain-matched
 * validation gate. Pure function: reads Tempering minima (read-only),
 * inspects the parsed slices, emits suggestion records. Does NOT mutate the
 * plan — Slice 4 is "suggest-only" (D8); the enforce-mode promotion path is
 * tracked in Phase-26 Slice 7 via `.forge/gate-suggestions.jsonl`.
 *
 * @param {object} args
 * @param {Array<object>} args.slices - parsed plan slices
 * @param {string} [args.cwd=process.cwd()]
 * @param {object} [args.config] - override `loadGateSynthesisConfig(cwd)`
 * @returns {{
 *   mode: "off" | "suggest" | "enforce",
 *   suggestions: Array<{
 *     sliceNumber: (number|string),
 *     sliceTitle: string,
 *     domain: string,
 *     reason: string,
 *     suggestedCommand: string,
 *     minima: { coverageMin: (number|null), runtimeBudgetMs: (number|null) }
 *   }>,
 * }}
 */
export function synthesizeGateSuggestions({ slices, cwd = process.cwd(), config } = {}) {
  const cfg = config || loadGateSynthesisConfig(cwd);
  if (cfg.mode === "off") return { mode: cfg.mode, suggestions: [] };
  if (!Array.isArray(slices) || slices.length === 0) return { mode: cfg.mode, suggestions: [] };
  const enabledDomains = new Set(cfg.domains || []);
  const out = [];
  for (const slice of slices) {
    const domain = classifySliceDomain(slice);
    if (!domain) continue;
    if (!enabledDomains.has(domain)) continue;
    // If the slice already declares a gate we stay silent — no churn.
    const gateText = typeof slice.validationGate === "string"
      ? slice.validationGate.trim()
      : (Array.isArray(slice.validationGate) ? slice.validationGate.join("\n").trim() : "");
    if (gateText.length > 0) continue;
    const minima = getMinimaForDomain(cwd, domain);
    const suggestion = {
      sliceNumber: slice.number ?? "?",
      sliceTitle: slice.title || "",
      domain,
      reason: `Slice matches '${domain}' profile but declares no validation gate. Tempering coverage-min ${minima.coverageMin ?? "n/a"}%, runtime-budget ${minima.runtimeBudgetMs ?? "n/a"}ms apply.`,
      suggestedCommand: GATE_SYNTH_TEMPLATES[domain] || GATE_SYNTH_TEMPLATES.domain,
      minima: { coverageMin: minima.coverageMin, runtimeBudgetMs: minima.runtimeBudgetMs },
    };
    // Phase-26 Slice 7 (C4): attach per-suggestion accept counter + auto-inject
    // flag in `enforce` mode. The key is derived from `(domain, suggestedCommand)`
    // so accepts aggregate across plans. Auto-inject threshold: 5.
    const suggestionKey = computeGateSuggestionKey(suggestion);
    const acceptCount = getGateSuggestionCounter(suggestionKey, cwd);
    suggestion.suggestionKey = suggestionKey;
    suggestion.acceptCount = acceptCount;
    suggestion.autoInjected = cfg.mode === "enforce" && acceptCount >= GATE_SUGGESTION_AUTO_INJECT_THRESHOLD;
    out.push(suggestion);
  }
  return {
    mode: cfg.mode,
    suggestions: out,
    autoInjected: out.filter((s) => s.autoInjected).map((s) => ({
      suggestionKey: s.suggestionKey,
      sliceNumber: s.sliceNumber,
      sliceTitle: s.sliceTitle,
      domain: s.domain,
      suggestedCommand: s.suggestedCommand,
      acceptCount: s.acceptCount,
    })),
  };
}

/**
 * Format gate-synthesis suggestions for printing to stdout during plan
 * pre-flight. Returns `""` when there are no suggestions.
 */
export function formatGateSuggestions(result) {
  if (!result || !Array.isArray(result.suggestions) || result.suggestions.length === 0) return "";
  const lines = [
    "",
    `--- GATE SYNTHESIS (Phase-25 L6, mode="${result.mode}") ---`,
    `${result.suggestions.length} slice(s) lack a domain-matched validation gate.`,
    "Add the suggested commands to the slice's Validation Gate block, or set",
    "runtime.gateSynthesis.mode = \"off\" in .forge.json to silence this advisory.",
    "",
  ];
  for (const s of result.suggestions) {
    lines.push(`Slice ${s.sliceNumber} — "${s.sliceTitle}"`);
    lines.push(`  Domain:  ${s.domain}`);
    lines.push(`  Reason:  ${s.reason}`);
    lines.push(`  Suggest: ${s.suggestedCommand}`);
    lines.push("");
  }
  lines.push("--- END GATE SYNTHESIS ---");
  return lines.join("\n");
}

// ─── Phase-26 Slice 9: Incident → fix-proposal auto-retry (C5) ────────
//
// Pure-ish helpers for applying LiveGuard-authored fix proposals against
// slice-level incidents. Keeps the 6900-line executeSlice untouched —
// callers wire these helpers into the retry path once Slice 12 surfaces
// them via `/api/innerloop/proposed-fixes`.
//
// MUST (Phase-26 plan §Slice 9):
//   - dry-run is the default (write patch file only, never touch the tree)
//   - apply mode re-runs the gate; any failure triggers rollback
//   - 1-attempt cap per incident, tracked via `autoFixAttempted: true`

export { PROPOSED_FIX_DIR };

/**
 * Default runner for `git apply` / `git apply -R` invocations. Callers may
 * substitute a stub in tests. Returns `{ ok: boolean, stderr?: string }`.
 * Never throws — converts spawn failures into structured results so the
 * state machine above remains deterministic.
 */
export function defaultRunGitApply({ cwd, args, stdin }) {
  try {
    execSync(`git ${args.join(" ")}`, {
      cwd,
      input: stdin,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      stderr: err.stderr ? String(err.stderr) : err.message,
    };
  }
}

/**
 * Locate the most recent fix-proposal matching a given incident. Matching
 * order (most → least specific):
 *   1. `proposal.correlationId === incident.id`
 *   2. `proposal.incidentId === incident.id`
 *   3. same `sliceNumber` (proposals whose generatedAt is newest wins)
 *
 * Pure function. Returns the matching record or `null`.
 */
export function findMatchingFixProposal({ incident, proposals } = {}) {
  if (!incident || !Array.isArray(proposals) || proposals.length === 0) return null;
  const incidentId = incident.id || incident.incidentId || null;
  const sliceNumber = incident.sliceNumber ?? null;

  const byCorrelation = proposals.filter((p) => p && incidentId && p.correlationId === incidentId);
  if (byCorrelation.length > 0) return pickNewest(byCorrelation);

  const byIncidentId = proposals.filter((p) => p && incidentId && p.incidentId === incidentId);
  if (byIncidentId.length > 0) return pickNewest(byIncidentId);

  if (sliceNumber !== null) {
    const bySlice = proposals.filter((p) => p && p.sliceNumber === sliceNumber);
    if (bySlice.length > 0) return pickNewest(bySlice);
  }
  return null;
}

function pickNewest(list) {
  const sorted = [...list].sort((a, b) => {
    const ta = Date.parse(a.generatedAt || "") || 0;
    const tb = Date.parse(b.generatedAt || "") || 0;
    return tb - ta;
  });
  return sorted[0] || null;
}

/**
 * Gate for the 1-attempt cap. Returns `false` when the incident already has
 * `autoFixAttempted: true` (regardless of outcome). Pure function.
 */
export function shouldAutoRetryFix(incident) {
  if (!incident || typeof incident !== "object") return false;
  if (incident.autoFixAttempted === true) return false;
  return true;
}

/**
 * Mark an incident record as having consumed its single auto-fix attempt.
 * Returns a new object — does not mutate the input.
 */
export function markFixAttempted(incident, { now = new Date() } = {}) {
  const ts = now instanceof Date ? now.toISOString() : String(now);
  return {
    ...incident,
    autoFixAttempted: true,
    autoFixAttemptedAt: ts,
  };
}

/**
 * Persist a proposed fix as `.forge/proposed-fixes/<fixId>.patch`. Creates
 * the directory if needed. Returns the absolute patch path.
 */
export function writeProposedFixPatch({ cwd = process.cwd(), fixId, patch } = {}) {
  if (!fixId || typeof fixId !== "string") {
    throw new Error("writeProposedFixPatch: fixId (string) required");
  }
  if (typeof patch !== "string") {
    throw new Error("writeProposedFixPatch: patch (string) required");
  }
  const dir = resolve(cwd, ".forge", PROPOSED_FIX_DIR);
  mkdirSync(dir, { recursive: true });
  let safeId = fixId.replace(/[^A-Za-z0-9._-]/g, "_");
  while (safeId.includes("..")) safeId = safeId.replace(/\.\./g, "_");
  const path = resolve(dir, `${safeId}.patch`);
  writeFileSync(path, patch, "utf-8");
  return path;
}

/**
 * Apply (or dry-run write) a fix proposal. Three outcomes:
 *   - `mode = "dry-run"` (default): writes patch, does NOT modify the tree.
 *     Returns `{ ok: true, mode: "dry-run", patchPath }`.
 *   - `mode = "apply"`: writes patch, runs `git apply`. On success returns
 *     `{ ok: true, mode: "apply", patchPath, applied: true }`. On failure
 *     returns `{ ok: false, mode: "apply", patchPath, applied: false, error }`.
 *
 * Never throws on git failures — surfaces them via the return shape. Callers
 * decide whether to invoke `rollbackFixProposal` or propagate the failure.
 *
 * @param {object} opts
 * @param {string} opts.cwd — project root
 * @param {string} opts.fixId — proposal identifier
 * @param {string} opts.patch — unified-diff text
 * @param {"dry-run"|"apply"} [opts.mode="dry-run"]
 * @param {Function} [opts.runGit=defaultRunGitApply] — injectable for tests
 */
export function applyFixProposal({ cwd = process.cwd(), fixId, patch, mode = "dry-run", runGit = defaultRunGitApply } = {}) {
  if (mode !== "dry-run" && mode !== "apply") {
    return { ok: false, mode, error: `invalid mode '${mode}' — expected 'dry-run' or 'apply'` };
  }
  let patchPath;
  try {
    patchPath = writeProposedFixPatch({ cwd, fixId, patch });
  } catch (err) {
    return { ok: false, mode, error: err.message };
  }
  if (mode === "dry-run") {
    return { ok: true, mode, patchPath, applied: false };
  }
  // apply mode
  const res = runGit({ cwd, args: ["apply", "--whitespace=nowarn", patchPath], stdin: null });
  if (res.ok) {
    return { ok: true, mode, patchPath, applied: true };
  }
  return {
    ok: false,
    mode,
    patchPath,
    applied: false,
    error: res.stderr || "git apply failed",
  };
}

/**
 * Reverse an applied fix proposal using `git apply -R`. Returns
 * `{ ok, error? }`. Safe to call when the patch file is missing — returns
 * `{ ok: false, error: "patch not found" }`.
 */
export function rollbackFixProposal({ cwd = process.cwd(), fixId, runGit = defaultRunGitApply } = {}) {
  if (!fixId) return { ok: false, error: "fixId required" };
  let safeId = String(fixId).replace(/[^A-Za-z0-9._-]/g, "_");
  while (safeId.includes("..")) safeId = safeId.replace(/\.\./g, "_");
  const patchPath = resolve(cwd, ".forge", PROPOSED_FIX_DIR, `${safeId}.patch`);
  if (!existsSync(patchPath)) return { ok: false, error: "patch not found" };
  const res = runGit({ cwd, args: ["apply", "-R", "--whitespace=nowarn", patchPath], stdin: null });
  if (res.ok) return { ok: true };
  return { ok: false, error: res.stderr || "git apply -R failed" };
}

// ─── Phase-26 Slice 10: Cost-anomaly detector + escalation re-ranking ─
//
// Pure helpers. When a slice attempt costs > `threshold` × the plan median,
// the NEXT retry's escalation chain is re-ranked by `avg_cost_usd` ascending
// so cheaper-proven models are tried first. Scoped per-plan; callers reset
// at plan start by dropping the `sliceCosts` collector.

export { COST_ANOMALY_MULTIPLIER };

/**
 * Compute the median of a numeric array. Returns 0 for empty input.
 * Skips non-finite values.
 */
export function computeMedian(values) {
  if (!Array.isArray(values)) return 0;
  const nums = values
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

/**
 * Detect whether a slice attempt is a cost outlier relative to the plan's
 * running median. Returns a deterministic report (never throws):
 *
 *   {
 *     isAnomaly: boolean,
 *     median: number,
 *     currentCost: number,
 *     ratio: number | null,        // currentCost / median, null when median=0
 *     threshold: number,
 *   }
 *
 * MUST (Phase-26 §Slice 10):
 *   - Compute median of the plan's observed slice costs so far.
 *   - Flag when `currentCost > multiplier * median`.
 *   - Never flag when the sample is empty — no signal yet.
 */
export function detectCostAnomaly({
  sliceCosts = [],
  currentCost = 0,
  threshold = COST_ANOMALY_MULTIPLIER,
} = {}) {
  const cost = Number(currentCost);
  const mult = Number.isFinite(threshold) && threshold > 0 ? threshold : COST_ANOMALY_MULTIPLIER;
  const median = computeMedian(sliceCosts);
  if (!Number.isFinite(cost) || cost <= 0) {
    return { isAnomaly: false, median, currentCost: cost, ratio: null, threshold: mult };
  }
  if (median <= 0) {
    return { isAnomaly: false, median, currentCost: cost, ratio: null, threshold: mult };
  }
  const ratio = cost / median;
  return {
    isAnomaly: ratio > mult,
    median,
    currentCost: cost,
    ratio,
    threshold: mult,
  };
}

/**
 * Re-rank an escalation chain so cheaper-proven models are tried first.
 * Stable: models absent from `modelStats` keep their relative input order and
 * trail after known cheaper models. `"auto"` (and any string-equal sentinel
 * in `preserveLeading`) is always pinned at the head of the returned chain.
 *
 * @param {object} opts
 * @param {string[]} opts.chain — input escalation chain (order preserved for unknowns)
 * @param {object} opts.modelStats — output of `aggregateModelStats()`; shape per-model `{ avg_cost_usd, ... }`
 * @param {string[]} [opts.preserveLeading=["auto"]] — pinned-at-head sentinels
 * @returns {string[]} new chain, re-ranked by avg_cost_usd ascending for known models
 */
export function rerankEscalationChain({
  chain = [],
  modelStats = {},
  preserveLeading = ["auto"],
} = {}) {
  if (!Array.isArray(chain) || chain.length === 0) return [];
  const leading = [];
  const rest = [];
  for (const entry of chain) {
    if (typeof entry !== "string") { rest.push(entry); continue; }
    if (preserveLeading.includes(entry)) leading.push(entry);
    else rest.push(entry);
  }
  const withStats = [];
  const withoutStats = [];
  rest.forEach((model, idx) => {
    const s = modelStats && typeof modelStats === "object" ? modelStats[model] : null;
    if (s && Number.isFinite(Number(s.avg_cost_usd))) {
      withStats.push({ model, cost: Number(s.avg_cost_usd), idx });
    } else {
      withoutStats.push({ model, idx });
    }
  });
  // Stable sort: ascending by cost, ties keep original order.
  withStats.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.idx - b.idx;
  });
  // Preserve original order for unknowns.
  withoutStats.sort((a, b) => a.idx - b.idx);
  return [
    ...leading,
    ...withStats.map((e) => e.model),
    ...withoutStats.map((e) => e.model),
  ];
}

// ─── Phase-25 Slice 5: Plan postmortem (L5 closed research loop) ──────

/** Subdirectory under `.forge/` where postmortems are stored per-plan. */
const POSTMORTEM_DIR = "plans";

export { POSTMORTEM_RETENTION_COUNT };

function sanitizePlanBasenameForPath(s) {
  const cleaned = String(s ?? "").replace(/[^A-Za-z0-9._-]/g, "_");
  let out = cleaned;
  while (out.includes("..")) out = out.replace(/\.\./g, "_");
  out = out.slice(0, 128);
  return out.length > 0 ? out : "_";
}

/**
 * Build a postmortem record from a completed run's summary. Pure function —
 * no fs, deterministic. Schema per Phase-25 MUST #5:
 *   { retriesPerSlice, gateFlaps, driftDelta, costDelta, topFailureReason,
 *     totalDurationMs, planBasename, status, createdAt }
 *
 * @param {object} args
 * @param {object} args.summary - runPlan summary object
 * @param {string} args.planBasename
 * @param {Array<object>} [args.priorPostmortems=[]] - sorted newest-first, used
 *   to compute driftDelta (via `analyze.score` when present) and costDelta
 *   (via `cost.total_cost_usd`). Delta is `null` when no prior data exists.
 * @param {string} [args.now] - ISO timestamp override (testing only)
 * @returns {object}
 */
export function buildPlanPostmortem({ summary, planBasename, priorPostmortems = [], now } = {}) {
  if (!summary || !planBasename) {
    throw new Error("buildPlanPostmortem: summary + planBasename required");
  }

  const sliceResults = Array.isArray(summary.sliceResults) ? summary.sliceResults : [];

  // retriesPerSlice — { "<sliceNumber>": retryCount }; skip 0-retry successes
  const retriesPerSlice = {};
  let gateFlaps = 0;
  const failureReasons = {};
  for (const r of sliceResults) {
    const n = r.number ?? "?";
    const retries = Math.max(0, Number(r.attempts || 1) - 1);
    if (retries > 0) retriesPerSlice[n] = retries;
    // Gate flaps = gate-fail attempts before eventual pass. A slice that
    // passed with attempts>1 flapped (attempts - 1) times.
    if (r.status === "passed" && Number(r.attempts || 1) > 1) {
      gateFlaps += Number(r.attempts) - 1;
    }
    if (r.status === "failed" || r.status === "error") {
      const key = String(r.failedCommand || r.gateError || r.silentFailure?.reason || "unknown").slice(0, 120);
      failureReasons[key] = (failureReasons[key] || 0) + 1;
    }
  }

  let topFailureReason = null;
  let topCount = 0;
  for (const [k, v] of Object.entries(failureReasons)) {
    if (v > topCount) { topCount = v; topFailureReason = k; }
  }

  // Deltas vs. most-recent prior postmortem for same planBasename
  const prev = Array.isArray(priorPostmortems) && priorPostmortems.length > 0 ? priorPostmortems[0] : null;
  const currentCost = Number(summary.cost?.total_cost_usd);
  const prevCost = Number(prev?.costDelta?.after);
  const costDelta = (Number.isFinite(currentCost) && Number.isFinite(prevCost))
    ? { before: prevCost, after: currentCost, delta: Number((currentCost - prevCost).toFixed(4)) }
    : (Number.isFinite(currentCost) ? { before: null, after: currentCost, delta: null } : null);

  const currentScore = Number(summary.analyze?.score);
  const prevScore = Number(prev?.driftDelta?.after);
  const driftDelta = (Number.isFinite(currentScore) && Number.isFinite(prevScore))
    ? { before: prevScore, after: currentScore, delta: Number((currentScore - prevScore).toFixed(2)) }
    : (Number.isFinite(currentScore) ? { before: null, after: currentScore, delta: null } : null);

  return {
    planBasename,
    createdAt: typeof now === "string" && now.length > 0 ? now : new Date().toISOString(),
    status: String(summary.status || "unknown"),
    totalDurationMs: Number(summary.totalDuration || 0),
    retriesPerSlice,
    gateFlaps,
    topFailureReason,
    costDelta,
    driftDelta,
  };
}

/**
 * List existing postmortems for a plan basename, sorted newest-first.
 * Returns `[]` when the directory does not exist. Reads are tolerant of
 * malformed files (skipped silently).
 */
export function listPlanPostmortems({ cwd = process.cwd(), planBasename }) {
  if (!planBasename) return [];
  const safe = sanitizePlanBasenameForPath(planBasename);
  const dir = resolve(cwd, ".forge", POSTMORTEM_DIR, safe);
  if (!existsSync(dir)) return [];
  let files;
  try { files = readdirSync(dir); } catch { return []; }
  const entries = [];
  for (const f of files) {
    if (!f.startsWith("postmortem-") || !f.endsWith(".json")) continue;
    const path = resolve(dir, f);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8"));
      entries.push({ path, record: parsed });
    } catch { /* skip malformed */ }
  }
  entries.sort((a, b) => String(b.record.createdAt || "").localeCompare(String(a.record.createdAt || "")));
  return entries;
}

/**
 * Persist a postmortem record, then prune the per-plan directory to keep only
 * the newest POSTMORTEM_RETENTION_COUNT (Phase-25 D7).
 *
 * @returns {string} Absolute path of the written postmortem file.
 */
export function writePlanPostmortem({ cwd = process.cwd(), planBasename, record }) {
  if (!planBasename || !record) {
    throw new Error("writePlanPostmortem: planBasename + record required");
  }
  const safe = sanitizePlanBasenameForPath(planBasename);
  const dir = resolve(cwd, ".forge", POSTMORTEM_DIR, safe);
  mkdirSync(dir, { recursive: true });
  const fname = `postmortem-${record.createdAt.replace(/[:.]/g, "-")}.json`;
  const path = resolve(dir, fname);
  writeFileSync(path, JSON.stringify(record, null, 2), "utf-8");

  // Age out: keep only the newest POSTMORTEM_RETENTION_COUNT
  try {
    const entries = listPlanPostmortems({ cwd, planBasename });
    const overflow = entries.slice(POSTMORTEM_RETENTION_COUNT);
    for (const e of overflow) {
      try { unlinkSync(e.path); } catch { /* ignore */ }
    }
  } catch { /* non-fatal */ }

  return path;
}
