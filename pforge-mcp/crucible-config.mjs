/**
 * Plan Forge — Crucible Config (Slice 01.6).
 *
 * Persists dashboard Config-tab settings for the Crucible subsystem
 * to `.forge/crucible/config.json`. Tiny surface — load / save / merge
 * with validation so bad UI input can't corrupt the file.
 *
 * Fields:
 *   - defaultLane: "tweak" | "feature" | "full"
 *   - recursionDepth: 0..3   (self-referral cap on child smelts)
 *   - autoApproveAgent: boolean  (auto-finalize agent smelts)
 *   - sourceWeights: { memory, principles, plans }  (sum ~= 100)
 *   - staleDefaultsHours: 1..168  (warning threshold)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_CRUCIBLE_CONFIG = Object.freeze({
  defaultLane: "feature",
  recursionDepth: 1,
  autoApproveAgent: false,
  sourceWeights: { memory: 34, principles: 33, plans: 33 },
  staleDefaultsHours: 24,
});

const VALID_LANES = new Set(["tweak", "feature", "full"]);

export function configPath(projectDir) {
  return resolve(projectDir, ".forge", "crucible", "config.json");
}

/**
 * Load + sanitize the config. Missing file -> defaults. Malformed file
 * -> defaults (never throws, never corrupts caller).
 */
export function loadCrucibleConfig(projectDir) {
  const path = configPath(projectDir);
  if (!existsSync(path)) return { ...DEFAULT_CRUCIBLE_CONFIG, sourceWeights: { ...DEFAULT_CRUCIBLE_CONFIG.sourceWeights } };
  let raw;
  try { raw = JSON.parse(readFileSync(path, "utf-8")); }
  catch { return { ...DEFAULT_CRUCIBLE_CONFIG, sourceWeights: { ...DEFAULT_CRUCIBLE_CONFIG.sourceWeights } }; }
  return sanitize(raw);
}

/**
 * Merge + validate + persist. Returns the sanitized config that was
 * written so the caller can echo it back to the UI.
 */
export function saveCrucibleConfig(projectDir, patch) {
  const current = loadCrucibleConfig(projectDir);
  const merged = sanitize({ ...current, ...patch, sourceWeights: { ...current.sourceWeights, ...(patch?.sourceWeights || {}) } });
  const path = configPath(projectDir);
  mkdirSync(resolve(projectDir, ".forge", "crucible"), { recursive: true });
  writeFileSync(path, JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}

/**
 * Coerce caller-supplied values to the canonical shape. Unknown fields
 * are dropped. Out-of-range numbers snap to the nearest valid bound.
 * Weights are normalized to sum 100.
 */
export function sanitize(input) {
  const out = { ...DEFAULT_CRUCIBLE_CONFIG, sourceWeights: { ...DEFAULT_CRUCIBLE_CONFIG.sourceWeights } };
  if (!input || typeof input !== "object") return out;

  if (typeof input.defaultLane === "string" && VALID_LANES.has(input.defaultLane)) {
    out.defaultLane = input.defaultLane;
  }
  if (Number.isFinite(input.recursionDepth)) {
    out.recursionDepth = Math.max(0, Math.min(3, Math.trunc(input.recursionDepth)));
  }
  if (typeof input.autoApproveAgent === "boolean") {
    out.autoApproveAgent = input.autoApproveAgent;
  }
  if (Number.isFinite(input.staleDefaultsHours)) {
    out.staleDefaultsHours = Math.max(1, Math.min(168, Math.trunc(input.staleDefaultsHours)));
  }

  const w = input.sourceWeights;
  if (w && typeof w === "object") {
    const m = Number(w.memory);
    const p = Number(w.principles);
    const pl = Number(w.plans);
    if (Number.isFinite(m) && Number.isFinite(p) && Number.isFinite(pl)) {
      const raw = { memory: Math.max(0, m), principles: Math.max(0, p), plans: Math.max(0, pl) };
      const sum = raw.memory + raw.principles + raw.plans;
      if (sum > 0) {
        // Normalize to sum 100 while keeping integer values
        const scaled = {
          memory: Math.round((raw.memory / sum) * 100),
          principles: Math.round((raw.principles / sum) * 100),
          plans: Math.round((raw.plans / sum) * 100),
        };
        // Fix rounding drift so the sum is exactly 100
        const drift = 100 - (scaled.memory + scaled.principles + scaled.plans);
        scaled.plans += drift;
        out.sourceWeights = scaled;
      }
    }
  }

  return out;
}
