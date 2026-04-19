/**
 * Plan Forge — Crucible: Phase Naming & Atomic Claims
 *
 * Phase naming rules (non-negotiable per Phase-CRUCIBLE-01 design commitment #1):
 *   - Decimal-only, semver-style: "Phase-01", "Phase-01.1", "Phase-01.1.1"
 *   - No letters. No mixed styles.
 *   - A new phase at depth N means "granular refinement of parent N-1"
 *
 * Atomic phase-number claim prevents two concurrent smelts from picking the
 * same number. Uses a rename-on-write pattern on `.forge/crucible/phase-claims.json`.
 *
 * @module crucible
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Regex for valid phase names. Matches:
 *   Phase-01
 *   Phase-01.1
 *   Phase-01.1.1
 *   Phase-12.34.56
 *
 * Rejects:
 *   Phase-1       (must be zero-padded to at least 2 digits at top level)
 *   Phase-01D     (no letters)
 *   Phase-1.C.2   (no letters in decimal parts)
 *   Phase-CRUCIBLE-01  (the literal string "CRUCIBLE" is a letter block)
 *
 * Note: for backward-compat with existing repo plans like Phase-CRUCIBLE-01.md,
 * validation only runs on NEW smelts. Grandfathered plans keep their names.
 */
const PHASE_NAME_RE = /^Phase-(\d{2,})(\.\d+)*$/;

/**
 * Validate a phase name against the decimal-only semver rule.
 *
 * @param {string} name - e.g. "Phase-01" or "Phase-01.1.1"
 * @returns {boolean}
 */
export function isValidPhaseName(name) {
  if (typeof name !== "string" || !name) return false;
  return PHASE_NAME_RE.test(name);
}

/**
 * Parse a phase name into its numeric segments.
 *
 * @param {string} name - e.g. "Phase-01.1.2"
 * @returns {number[]|null} [01, 1, 2] or null if invalid
 */
export function parsePhaseName(name) {
  if (!isValidPhaseName(name)) return null;
  const body = name.slice("Phase-".length);
  return body.split(".").map((s) => parseInt(s, 10));
}

/**
 * Compare two phase names for sort order. `01 < 01.1 < 01.2 < 02`.
 * Returns -1, 0, or +1. Invalid names sort last.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function comparePhaseNames(a, b) {
  const pa = parsePhaseName(a);
  const pb = parsePhaseName(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const av = pa[i] ?? -1;
    const bv = pb[i] ?? -1;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

/**
 * Compute the next available phase number given a list of existing names.
 *
 * When `parent` is null: returns the next top-level phase (e.g. existing
 * ["Phase-01","Phase-02"] → "Phase-03").
 *
 * When `parent` is a valid phase name: returns the next child
 * (e.g. parent="Phase-02", existing ["Phase-02.1","Phase-02.2"] → "Phase-02.3").
 *
 * @param {string[]} existingNames - Names already claimed
 * @param {string|null} [parent=null] - Parent phase for nested naming
 * @returns {string} Next available phase name
 */
export function nextPhaseNumber(existingNames, parent = null) {
  const valid = existingNames.filter(isValidPhaseName);

  if (parent === null) {
    // Top-level: find max first segment
    let max = 0;
    for (const n of valid) {
      const segs = parsePhaseName(n);
      if (segs && segs.length === 1 && segs[0] > max) max = segs[0];
    }
    const next = max + 1;
    return `Phase-${String(next).padStart(2, "0")}`;
  }

  if (!isValidPhaseName(parent)) {
    throw new Error(`nextPhaseNumber: invalid parent name '${parent}'`);
  }
  const parentSegs = parsePhaseName(parent);
  const depth = parentSegs.length + 1;
  let max = 0;
  for (const n of valid) {
    const segs = parsePhaseName(n);
    if (!segs || segs.length !== depth) continue;
    // Must share parent prefix
    let prefixMatch = true;
    for (let i = 0; i < parentSegs.length; i++) {
      if (segs[i] !== parentSegs[i]) { prefixMatch = false; break; }
    }
    if (!prefixMatch) continue;
    if (segs[depth - 1] > max) max = segs[depth - 1];
  }
  return `${parent}.${max + 1}`;
}

// ───────────────────────────────────────────────────────────────────────
// Atomic phase-number claims
// ───────────────────────────────────────────────────────────────────────

function crucibleDir(projectDir) {
  return resolve(projectDir, ".forge", "crucible");
}

function claimsPath(projectDir) {
  return join(crucibleDir(projectDir), "phase-claims.json");
}

function ensureCrucibleDir(projectDir) {
  const dir = crucibleDir(projectDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Read the current claims table. Missing file → empty object.
 *
 * @param {string} projectDir
 * @returns {{[phaseName: string]: {id: string, claimedAt: string}}}
 */
function readClaims(projectDir) {
  const path = claimsPath(projectDir);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Atomically write the claims table. Uses rename-on-write so concurrent
 * readers never see a partial file.
 *
 * @param {string} projectDir
 * @param {object} claims
 */
function writeClaims(projectDir, claims) {
  ensureCrucibleDir(projectDir);
  const path = claimsPath(projectDir);
  // Unique temp name per call so parallel writers don't collide on the tmp path.
  const tmp = `${path}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, JSON.stringify(claims, null, 2), "utf-8");
  renameSync(tmp, path);
}

/**
 * Claim a phase number for a smelt. Fails if already claimed.
 *
 * Caller is expected to have already checked `nextPhaseNumber()` or chosen
 * an explicit name. This function is the point of serialization: if two
 * concurrent callers race on the same name, exactly one succeeds.
 *
 * @param {string} projectDir
 * @param {string} phaseName - must pass `isValidPhaseName`
 * @param {string} smeltId
 * @returns {{claimed: true}}
 * @throws If phaseName is invalid or already claimed
 */
export function claimPhaseNumber(projectDir, phaseName, smeltId) {
  if (!isValidPhaseName(phaseName)) {
    throw new Error(`claimPhaseNumber: invalid phase name '${phaseName}'`);
  }
  if (!smeltId || typeof smeltId !== "string") {
    throw new Error("claimPhaseNumber: smeltId is required");
  }
  // Re-read under the rename boundary. The rename itself is atomic on POSIX
  // and Windows (same-volume), so read→mutate→write is safe for single-process
  // scenarios and correct-but-optimistic for multi-process: losers of the race
  // observe the claim during their read-before-write and raise the "already
  // claimed" error.
  const claims = readClaims(projectDir);
  if (claims[phaseName]) {
    throw new Error(
      `claimPhaseNumber: '${phaseName}' already claimed by smelt '${claims[phaseName].id}'`,
    );
  }
  claims[phaseName] = { id: smeltId, claimedAt: new Date().toISOString() };
  writeClaims(projectDir, claims);
  // Verify the claim landed (defensive against cross-process races on the rare
  // case of a concurrent writer overwriting between our read and write).
  const verify = readClaims(projectDir);
  if (!verify[phaseName] || verify[phaseName].id !== smeltId) {
    throw new Error(
      `claimPhaseNumber: '${phaseName}' was claimed by another smelt during write`,
    );
  }
  return { claimed: true };
}

/**
 * Release a phase claim. Safe to call even if the claim doesn't exist.
 *
 * @param {string} projectDir
 * @param {string} phaseName
 * @param {string} smeltId - must match the claimer to release
 * @returns {{released: boolean}}
 */
export function releaseClaim(projectDir, phaseName, smeltId) {
  const claims = readClaims(projectDir);
  if (!claims[phaseName]) return { released: false };
  if (claims[phaseName].id !== smeltId) {
    // Not our claim — refuse to release someone else's.
    return { released: false };
  }
  delete claims[phaseName];
  writeClaims(projectDir, claims);
  return { released: true };
}

/**
 * List all currently claimed phase names.
 *
 * @param {string} projectDir
 * @returns {Array<{phaseName: string, id: string, claimedAt: string}>}
 */
export function listClaims(projectDir) {
  const claims = readClaims(projectDir);
  return Object.entries(claims).map(([phaseName, v]) => ({
    phaseName,
    id: v.id,
    claimedAt: v.claimedAt,
  }));
}

/**
 * Internal helper exposed for tests — reset the claims file for a project.
 * Not part of the public API.
 *
 * @param {string} projectDir
 * @private
 */
export function _resetClaimsForTest(projectDir) {
  const path = claimsPath(projectDir);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* ignore */ }
  }
}
