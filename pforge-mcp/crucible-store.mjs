/**
 * Plan Forge — Crucible: Smelt Persistence
 *
 * A "smelt" is an in-progress conversion of a raw idea into a hardened
 * phase spec. Each smelt is persisted as `.forge/crucible/<id>.json` and
 * survives across dashboard refreshes and CLI sessions.
 *
 * Record schema:
 *   {
 *     id: string,            // UUID
 *     lane: "tweak" | "feature" | "full",
 *     rawIdea: string,       // original prompt that started the smelt
 *     answers: Array<{questionId, answer, answeredAt}>,
 *     draftMarkdown: string, // rendered via crucible-draft.renderDraft()
 *     phaseName: string|null,// assigned on finalize
 *     createdAt: string,     // ISO
 *     updatedAt: string,     // ISO
 *     status: "in-progress" | "finalized" | "abandoned",
 *     source: "human" | "agent",
 *     parentSmeltId: string|null, // for agent self-referrals
 *   }
 *
 * @module crucible-store
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

import { releaseClaim } from "./crucible.mjs";

const VALID_LANES = new Set(["tweak", "feature", "full"]);
const VALID_SOURCES = new Set(["human", "agent"]);
const VALID_STATUSES = new Set(["in-progress", "finalized", "abandoned"]);

function crucibleDir(projectDir) {
  return resolve(projectDir, ".forge", "crucible");
}

function smeltPath(projectDir, id) {
  return join(crucibleDir(projectDir), `${id}.json`);
}

function ensureCrucibleDir(projectDir) {
  const dir = crucibleDir(projectDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Atomic write via rename-on-write.
 * @private
 */
function atomicWrite(path, content) {
  const tmp = `${path}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

/**
 * Create a new smelt record.
 *
 * @param {object} opts
 * @param {string} opts.lane - "tweak" | "feature" | "full"
 * @param {string} opts.rawIdea - original prompt
 * @param {string} opts.projectDir
 * @param {string} [opts.source="human"]
 * @param {string|null} [opts.parentSmeltId=null] - for agent self-referrals
 * @returns {object} the created smelt record
 */
export function createSmelt({ lane, rawIdea, projectDir, source = "human", parentSmeltId = null }) {
  if (!VALID_LANES.has(lane)) {
    throw new Error(`createSmelt: invalid lane '${lane}' (must be tweak|feature|full)`);
  }
  if (typeof rawIdea !== "string" || !rawIdea.trim()) {
    throw new Error("createSmelt: rawIdea is required");
  }
  if (!VALID_SOURCES.has(source)) {
    throw new Error(`createSmelt: invalid source '${source}'`);
  }
  ensureCrucibleDir(projectDir);
  const now = new Date().toISOString();
  const record = {
    id: randomUUID(),
    lane,
    rawIdea: rawIdea.trim(),
    answers: [],
    draftMarkdown: "",
    phaseName: null,
    createdAt: now,
    updatedAt: now,
    status: "in-progress",
    source,
    parentSmeltId,
  };
  atomicWrite(smeltPath(projectDir, record.id), JSON.stringify(record, null, 2));
  return record;
}

/**
 * Load a smelt by id. Returns null if not found.
 *
 * @param {string} id
 * @param {string} projectDir
 * @returns {object|null}
 */
export function loadSmelt(id, projectDir) {
  if (!id || typeof id !== "string") return null;
  const path = smeltPath(projectDir, id);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Update a smelt with a patch object. Always refreshes `updatedAt`.
 *
 * Rejects changes to immutable fields: id, createdAt, source, parentSmeltId.
 * Validates `lane` and `status` if present in the patch.
 *
 * @param {string} id
 * @param {object} patch
 * @param {string} projectDir
 * @returns {object} updated record
 */
export function updateSmelt(id, patch, projectDir) {
  const existing = loadSmelt(id, projectDir);
  if (!existing) throw new Error(`updateSmelt: smelt '${id}' not found`);
  if (patch.lane !== undefined && !VALID_LANES.has(patch.lane)) {
    throw new Error(`updateSmelt: invalid lane '${patch.lane}'`);
  }
  if (patch.status !== undefined && !VALID_STATUSES.has(patch.status)) {
    throw new Error(`updateSmelt: invalid status '${patch.status}'`);
  }
  const immutable = ["id", "createdAt", "source", "parentSmeltId"];
  const next = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (immutable.includes(k)) continue;
    next[k] = v;
  }
  next.updatedAt = new Date().toISOString();
  atomicWrite(smeltPath(projectDir, id), JSON.stringify(next, null, 2));
  return next;
}

/**
 * List all smelts in the project, optionally filtered by status.
 *
 * @param {string} projectDir
 * @param {object} [opts]
 * @param {string} [opts.status] - filter: "in-progress" | "finalized" | "abandoned"
 * @returns {object[]} list of smelt records (most recent first)
 */
export function listSmelts(projectDir, { status } = {}) {
  const dir = crucibleDir(projectDir);
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const smelts = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (entry.name === "phase-claims.json" || entry.name === "config.json") continue;
    if (entry.name === "manual-imports.jsonl") continue;
    const id = entry.name.slice(0, -".json".length);
    const rec = loadSmelt(id, projectDir);
    if (!rec) continue;
    if (status && rec.status !== status) continue;
    smelts.push(rec);
  }
  smelts.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return smelts;
}

/**
 * Abandon a smelt. Marks status and releases any held phase claim.
 *
 * @param {string} id
 * @param {string} projectDir
 * @returns {{abandoned: boolean}}
 */
export function abandonSmelt(id, projectDir) {
  const existing = loadSmelt(id, projectDir);
  if (!existing) return { abandoned: false };
  if (existing.status === "abandoned") return { abandoned: true };
  if (existing.phaseName) {
    releaseClaim(projectDir, existing.phaseName, id);
  }
  updateSmelt(id, { status: "abandoned" }, projectDir);
  return { abandoned: true };
}

/**
 * Test helper — delete a smelt file outright. Not part of the public API.
 * @private
 */
export function _deleteSmeltForTest(id, projectDir) {
  const path = smeltPath(projectDir, id);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* ignore */ }
  }
}
