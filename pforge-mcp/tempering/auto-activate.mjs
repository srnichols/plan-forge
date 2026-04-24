/**
 * Audit-loop activation surface — off / auto / always (Phase-39 Slice 7).
 *
 * Provides:
 *   - `AUDIT_DEFAULTS` — frozen default config (mode: "off")
 *   - `loadAuditConfig(cwd)` — reads `.forge.json#audit`, merges with defaults
 *   - `saveAuditConfig(cwd, patch)` — persists audit config to `.forge.json`
 *   - `shouldAutoDrain(planContext)` — threshold evaluator for "auto" mode
 *
 * Design contracts:
 *   - Never throws — returns safe defaults on any error
 *   - `forbidProduction` is immutable — cannot be overridden at runtime
 *   - Config source of truth is `.forge.json#audit`
 *   - Gate-compatible: the literal `"mode": "off"` appears in AUDIT_DEFAULTS
 *
 * @module tempering/auto-activate
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Default config ──────────────────────────────────────────────────

/**
 * Default audit activation config. `"mode": "off"` is the safe default.
 * The string `"mode": "off"` must remain as a JSON-compatible literal
 * for gate validation (`grep -q '"mode": *"off"'`).
 */
export const AUDIT_DEFAULTS = Object.freeze({
  "mode": "off",
  maxRounds: 5,
  forbidProduction: true,
  autoThresholds: Object.freeze({
    minFilesChanged: 5,
    minDaysSinceLastDrain: 3,
    requireFindings: true,
  }),
  environments: Object.freeze(["dev", "staging"]),
});

// ─── Config loader ───────────────────────────────────────────────────

/**
 * Load audit config from `.forge.json#audit`. Never throws.
 *
 * @param {string} cwd — project root
 * @returns {object} merged config with `_source` stamp
 */
export function loadAuditConfig(cwd) {
  const configPath = resolve(cwd, ".forge.json");
  if (!existsSync(configPath)) {
    return { ...AUDIT_DEFAULTS, _source: "defaults" };
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.audit || typeof parsed.audit !== "object") {
      return { ...AUDIT_DEFAULTS, _source: "defaults" };
    }
    const merged = { ...AUDIT_DEFAULTS, ...parsed.audit };
    // forbidProduction is immutable — always true
    merged.forbidProduction = true;
    merged._source = "file";
    return merged;
  } catch {
    return { ...AUDIT_DEFAULTS, _source: "defaults-fallback" };
  }
}

// ─── Config saver ────────────────────────────────────────────────────

/**
 * Persist audit config to `.forge.json#audit`. Merges with existing
 * `.forge.json` content. Never throws — returns `{ ok, error? }`.
 *
 * @param {string} cwd — project root
 * @param {object} patch — partial audit config to merge
 * @returns {{ ok: boolean, config?: object, error?: string }}
 */
export function saveAuditConfig(cwd, patch) {
  try {
    const configPath = resolve(cwd, ".forge.json");
    let existing = {};
    if (existsSync(configPath)) {
      try {
        existing = JSON.parse(readFileSync(configPath, "utf-8"));
      } catch {
        existing = {};
      }
    }
    const current = existing.audit && typeof existing.audit === "object"
      ? existing.audit
      : {};
    const merged = { ...AUDIT_DEFAULTS, ...current, ...patch };
    // forbidProduction is immutable
    merged.forbidProduction = true;
    delete merged._source;
    existing.audit = merged;
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    return { ok: true, config: { ...merged, _source: "file" } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Threshold evaluator ────────────────────────────────────────────

/**
 * Evaluate whether an automatic drain should fire based on plan context
 * and change-surface signals.
 *
 * Returns `{ fire: boolean, signals: object }` — never just a boolean,
 * so callers can log/display the decision reasoning.
 *
 * @param {object} planContext
 * @param {string}   planContext.cwd — project root
 * @param {object}   [planContext.config] — pre-loaded audit config (skips re-read)
 * @param {number}   [planContext.filesChanged] — number of files changed in the plan run
 * @param {number}   [planContext.lastDrainTs] — epoch ms of last drain (0 = never)
 * @param {string}   [planContext.lastVerdict] — verdict from last drain ("converged"|"max-rounds"|etc.)
 * @param {number}   [planContext.recentFindingCount] — findings from most recent tempering run
 * @param {string}   [planContext.env] — current environment
 * @param {Function} [planContext.now] — injectable clock
 * @returns {{ fire: boolean, signals: object }}
 */
export function shouldAutoDrain(planContext = {}) {
  const {
    cwd = process.cwd(),
    config: preloadedConfig,
    filesChanged = 0,
    lastDrainTs = 0,
    lastVerdict = null,
    recentFindingCount = 0,
    env = "dev",
    now = () => Date.now(),
  } = planContext;

  const config = preloadedConfig || loadAuditConfig(cwd);
  const signals = {};

  // Mode: "off" → never fire
  if (config.mode === "off") {
    return { fire: false, signals: { mode: "off", reason: "audit-loop disabled" } };
  }

  // Mode: "always" → always fire (unless production)
  if (config.mode === "always") {
    if (config.forbidProduction && env === "production") {
      return { fire: false, signals: { mode: "always", blocked: true, reason: "production-forbidden" } };
    }
    return { fire: true, signals: { mode: "always", reason: "always-mode active" } };
  }

  // Mode: "auto" → evaluate thresholds
  const thresholds = config.autoThresholds || AUDIT_DEFAULTS.autoThresholds;

  // Production guard
  if (config.forbidProduction && env === "production") {
    return { fire: false, signals: { mode: "auto", blocked: true, reason: "production-forbidden" } };
  }

  // Environment guard
  const allowedEnvs = config.environments || AUDIT_DEFAULTS.environments;
  if (!allowedEnvs.includes(env)) {
    signals.envBlocked = true;
    return { fire: false, signals: { ...signals, mode: "auto", reason: `env '${env}' not in allowed list` } };
  }

  // Signal: files changed
  signals.filesChanged = filesChanged;
  signals.filesThreshold = thresholds.minFilesChanged;
  const filesSignal = filesChanged >= thresholds.minFilesChanged;

  // Signal: days since last drain
  const currentMs = now();
  const daysSinceLastDrain = lastDrainTs > 0
    ? (currentMs - lastDrainTs) / (1000 * 60 * 60 * 24)
    : Infinity;
  signals.daysSinceLastDrain = Math.round(daysSinceLastDrain * 10) / 10;
  signals.daysThreshold = thresholds.minDaysSinceLastDrain;
  const daysSignal = daysSinceLastDrain >= thresholds.minDaysSinceLastDrain;

  // Signal: recent findings exist
  signals.recentFindingCount = recentFindingCount;
  signals.requireFindings = thresholds.requireFindings;
  const findingsSignal = !thresholds.requireFindings || recentFindingCount > 0;

  // Signal: last drain did not converge (still work to do)
  signals.lastVerdict = lastVerdict;
  const verdictSignal = lastVerdict !== "converged";

  // Decision: fire if enough signals trip
  // Require: (files OR days) AND (findings if required) AND (not recently converged)
  const fire = (filesSignal || daysSignal) && findingsSignal && verdictSignal;

  signals.mode = "auto";
  signals.decision = { filesSignal, daysSignal, findingsSignal, verdictSignal };
  signals.reason = fire ? "threshold signals tripped" : "no drain signals tripped";

  return { fire, signals };
}
