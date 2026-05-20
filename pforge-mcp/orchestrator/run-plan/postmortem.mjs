/** Plan Forge — Phase-55 S1: postmortem sub-module (extracted from run-plan.mjs) */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { POSTMORTEM_RETENTION_COUNT } from "../constants.mjs";

export { POSTMORTEM_RETENTION_COUNT };

// ─── Phase-25 Slice 5: Plan postmortem (L5 closed research loop) ──────

/** Subdirectory under `.forge/` where postmortems are stored per-plan. */
const POSTMORTEM_DIR = "plans";

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
function _computePostmortemSliceStats(sliceResults) {
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
  return { retriesPerSlice, gateFlaps, failureReasons };
}

function _pickTopFailureReason(failureReasons) {
  let topFailureReason = null;
  let topCount = 0;
  for (const [k, v] of Object.entries(failureReasons)) {
    if (v > topCount) { topCount = v; topFailureReason = k; }
  }
  return topFailureReason;
}

function _computeDelta(currentRaw, prevRaw, precision) {
  const current = Number(currentRaw);
  const prev = Number(prevRaw);
  if (Number.isFinite(current) && Number.isFinite(prev)) {
    return { before: prev, after: current, delta: Number((current - prev).toFixed(precision)) };
  }
  if (Number.isFinite(current)) {
    return { before: null, after: current, delta: null };
  }
  return null;
}

export function buildPlanPostmortem({ summary, planBasename, priorPostmortems = [], now } = {}) {
  if (!summary || !planBasename) {
    throw new Error("buildPlanPostmortem: summary + planBasename required");
  }

  const sliceResults = Array.isArray(summary.sliceResults) ? summary.sliceResults : [];

  // retriesPerSlice — { "<sliceNumber>": retryCount }; skip 0-retry successes
  const { retriesPerSlice, gateFlaps, failureReasons } = _computePostmortemSliceStats(sliceResults);
  const topFailureReason = _pickTopFailureReason(failureReasons);

  // Deltas vs. most-recent prior postmortem for same planBasename
  const prev = Array.isArray(priorPostmortems) && priorPostmortems.length > 0 ? priorPostmortems[0] : null;
  const costDelta = _computeDelta(summary.cost?.total_cost_usd, prev?.costDelta?.after, 4);
  const driftDelta = _computeDelta(summary.analyze?.score, prev?.driftDelta?.after, 2);

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
