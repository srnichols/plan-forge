import { createHash, randomUUID } from "node:crypto";
import {
  lstat, mkdir, readFile, readdir, rename, rm, writeFile, appendFile,
} from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { assertInside } from "../path-safety.mjs";

export const L2_COPY_DIRS = Object.freeze(["runs", "trajectories", "hallmarks", "bugs", "skills-auto"]);
export const L2_JSONL_STREAMS = Object.freeze([
  "openbrain-queue.jsonl", "openbrain-dlq.jsonl", "openbrain-queue.archive.jsonl",
  "liveguard-memories.jsonl", "quorum-history.jsonl", "watch-history.jsonl",
  "drift-history.jsonl", "incidents.jsonl", "regression-history.jsonl",
  "team-activity.jsonl", "hub-events.jsonl",
]);
export const L2_JSON_MAPS = Object.freeze([
  "cost-history.json", "model-performance.json", "skills-auto/state.json",
]);
export const L2_DENY = Object.freeze([
  "secrets.json", "bridge-secret", "fm-prefs.json", "server-ports.json", "cache", "worktrees",
]);
export const CHUNK_RAW_BYTES = 256 * 1024;
export const L2_MAX_DELTA_BYTES = 64 * 1024 * 1024;
export const L2_SYNC_INCOMPLETE = "l2-sync-incomplete";
export const L2_ERROR_CODES = Object.freeze({
  CONFLICT: "L2_CONFLICT",
  CHECKSUM_MISMATCH: "L2_CHECKSUM_MISMATCH",
  CHUNK_MISSING: "L2_CHUNK_MISSING",
  CHUNK_DUP: "L2_CHUNK_DUP",
  PATH_REJECTED: "L2_PATH_REJECTED",
  DELTA_TOO_LARGE: "L2_DELTA_TOO_LARGE",
  MALFORMED: "L2_MALFORMED",
});

const mapSnapshots = new WeakMap();
const homeQueues = new Map();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const knownJsonl = new Set(L2_JSONL_STREAMS);
const knownMaps = new Set(L2_JSON_MAPS);
const sameJson = (left, right) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

function throwL2(code) {
  throw new ClawError(code);
}

function laneIds(config) {
  const lanes = config?.lanes;
  if (Array.isArray(lanes)) return lanes.map((lane) => lane?.id).filter(Boolean);
  if (lanes && typeof lanes === "object") return Object.keys(lanes);
  return config?.lane?.id ? [config.lane.id] : [];
}

/**
 * Resolve the lane and canonical `.forge` path for a project.
 * @param {{project: object, config?: object}} options
 * @returns {{laneId: string, path: string}}
 */
function configuredForgeHome({ project, config, configured }) {
  if (typeof configured !== "string" || !configured) throwL2(L2_ERROR_CODES.MALFORMED);
  const isAbsolute = path.win32.isAbsolute(configured) || path.posix.isAbsolute(configured);
  const colon = isAbsolute ? -1 : configured.indexOf(":");
  if (colon >= 0) {
    const laneId = configured.slice(0, colon);
    const homePath = configured.slice(colon + 1);
    if (!laneIds(config).includes(laneId) || !homePath) throwL2(L2_ERROR_CODES.PATH_REJECTED);
    return { laneId, path: homePath };
  }
  if (typeof project?.homeLane !== "string" || !project.homeLane) throwL2(L2_ERROR_CODES.MALFORMED);
  return { laneId: project.homeLane, path: configured };
}

export function resolveForgeHome({ project, config = {} } = {}) {
  const repo = project?.repo ?? {};
  if (repo.forgeHome !== undefined) return configuredForgeHome({ project, config, configured: repo.forgeHome });
  if (typeof project?.homeLane !== "string" || !project.homeLane
    || typeof repo.path !== "string" || !repo.path) throwL2(L2_ERROR_CODES.MALFORMED);
  return { laneId: project.homeLane, path: path.join(repo.path, ".forge") };
}

function deniedPath(rel) {
  const normalized = rel.toLowerCase();
  const parts = normalized.split("/");
  return L2_DENY.some((deny) => parts.includes(deny.toLowerCase()))
    || parts.some((part) => part.endsWith(".pid") || part.endsWith(".log"))
    || normalized.startsWith("skills-auto/rejected/");
}

function allowedPath(rel) {
  if (deniedPath(rel)) return false;
  const first = rel.split("/")[0];
  return L2_COPY_DIRS.includes(first) || knownJsonl.has(rel) || knownMaps.has(rel);
}

function validateRelativePath(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\\") || rel.includes("\0")
    || rel.split("/").includes("..") || path.posix.isAbsolute(rel)
    || path.win32.isAbsolute(rel) || /^[a-z]:/i.test(rel) || !allowedPath(rel)) {
    throwL2(L2_ERROR_CODES.PATH_REJECTED);
  }
}

async function listAllowedFiles(forgeDir) {
  const found = [];
  async function walk(relative) {
    const directory = path.join(forgeDir, ...relative.split("/"));
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const rel = `${relative}/${entry.name}`;
      if (deniedPath(rel) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.isFile() && allowedPath(rel)) {
        found.push(rel);
      }
    }
  }
  for (const directory of L2_COPY_DIRS) await walk(directory);
  for (const rel of [...L2_JSONL_STREAMS, ...L2_JSON_MAPS]) {
    validateRelativePath(rel);
    found.push(rel);
  }
  return [...new Set(found)].sort();
}

function mapEntries(file, parsed) {
  if (file === "cost-history.json") {
    if (!Array.isArray(parsed)) throwL2(L2_ERROR_CODES.MALFORMED);
    return parsed.map((value) => [
      String(value?.id ?? `${value?.date ?? ""}|${value?.plan ?? ""}`), value,
    ]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throwL2(L2_ERROR_CODES.MALFORMED);
  return Object.entries(parsed);
}

/**
 * Capture hashes and JSONL identities for the allow-listed L2 tree.
 * @param {{forgeDir: string}} options
 */
export async function snapshotForge({ forgeDir } = {}) {
  if (typeof forgeDir !== "string" || !forgeDir) throwL2(L2_ERROR_CODES.MALFORMED);
  const files = {};
  const lines = Object.fromEntries(L2_JSONL_STREAMS.map((stream) => [stream, new Set()]));
  const maps = {};
  for (const rel of await listAllowedFiles(forgeDir)) {
    const target = path.join(forgeDir, ...rel.split("/"));
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) continue;
    const contents = await readFile(target);
    files[rel] = { size: contents.byteLength, sha256: sha256(contents) };
    if (knownJsonl.has(rel)) {
      for (const line of jsonlRawLines(contents)) {
        lines[rel].add(recordIdentity(line));
      }
    }
    if (knownMaps.has(rel)) maps[rel] = mapEntries(rel, JSON.parse(contents.toString("utf8")));
  }
  const snapshot = { files, lines };
  mapSnapshots.set(snapshot, maps);
  return snapshot;
}

/**
 * Choose a stable identity for JSONL records, retaining malformed lines by hash.
 * @param {string} line
 * @returns {string}
 */
export function recordIdentity(line) {
  const raw = String(line);
  try {
    const value = JSON.parse(raw);
    for (const key of ["id", "_id", "recordId", "bugId"]) {
      if (value?.[key] !== undefined && value[key] !== null && String(value[key])) {
        return String(value[key]);
      }
    }
  } catch {
    return sha256(Buffer.from(raw.trimEnd()));
  }
  return sha256(Buffer.from(raw.trimEnd()));
}

function jsonlRawLines(contents) {
  const text = contents.toString("utf8");
  const lines = [];
  let start = 0;
  for (let index = text.indexOf("\n"); index >= 0; index = text.indexOf("\n", start)) {
    lines.push(text.slice(start, index + 1));
    start = index + 1;
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

function countDeltaBytes(delta) {
  let size = delta.files.reduce((sum, file) => sum + Buffer.from(file.dataB64, "base64").byteLength, 0);
  for (const records of Object.values(delta.jsonl)) {
    for (const line of records) size += Buffer.byteLength(line);
  }
  for (const entries of Object.values(delta.maps)) size += Buffer.byteLength(JSON.stringify(entries));
  return size;
}

/**
 * Collect changed files, unseen JSONL records, and new map ids.
 * @param {{forgeDir: string, snapshot: object, maxBytes?: number}} options
 */
export async function computeDelta({ forgeDir, snapshot, maxBytes = L2_MAX_DELTA_BYTES } = {}) {
  if (typeof forgeDir !== "string" || !snapshot || !Number.isFinite(maxBytes) || maxBytes <= 0) {
    throwL2(L2_ERROR_CODES.MALFORMED);
  }
  const delta = { files: [], jsonl: {}, maps: {} };
  const oldMaps = mapSnapshots.get(snapshot) ?? {};
  for (const rel of await listAllowedFiles(forgeDir)) {
    await collectFileDelta({ forgeDir, snapshot, oldMaps, delta, rel });
  }
  if (!delta.files.length && !Object.keys(delta.jsonl).length && !Object.keys(delta.maps).length) return null;
  if (countDeltaBytes(delta) > maxBytes) throwL2(L2_ERROR_CODES.DELTA_TOO_LARGE);
  return delta;
}

function unseenLines(contents, prior) {
  const identities = new Set(prior);
  return jsonlRawLines(contents).filter((line) => {
    const identity = recordIdentity(line);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
}

async function collectFileDelta({ forgeDir, snapshot, oldMaps, delta, rel }) {
  const contents = await readFile(path.join(forgeDir, ...rel.split("/"))).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!contents) return;
  if (knownJsonl.has(rel)) {
    const additions = unseenLines(contents, snapshot.lines?.[rel] ?? []);
    if (additions.length) delta.jsonl[rel] = additions;
  } else if (knownMaps.has(rel)) {
    const entries = mapEntries(rel, JSON.parse(contents.toString("utf8")));
    const before = new Map(oldMaps[rel] ?? []);
    const changed = Object.fromEntries(entries.filter(([id, value]) => !before.has(id) || !sameJson(before.get(id), value)));
    if (Object.keys(changed).length) delta.maps[rel] = changed;
  } else {
    const hash = sha256(contents);
    if (snapshot.files[rel]?.sha256 !== hash) delta.files.push({ rel, dataB64: contents.toString("base64"), sha256: hash });
  }
}

function recordObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validateFileData(file) {
  if (typeof file?.dataB64 !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)
    || Buffer.from(file.dataB64, "base64").toString("base64") !== file.dataB64) throwL2(L2_ERROR_CODES.MALFORMED);
  if (sha256(Buffer.from(file.dataB64, "base64")) !== file.sha256) throwL2(L2_ERROR_CODES.CHECKSUM_MISMATCH);
}

function validateDeltaPaths(delta) {
  if (!delta || !Array.isArray(delta.files) || !recordObject(delta.jsonl) || !recordObject(delta.maps)) {
    throwL2(L2_ERROR_CODES.MALFORMED);
  }
  for (const file of delta.files) validateFileData(file);
  for (const records of Object.values(delta.jsonl)) {
    if (!Array.isArray(records) || records.some((line) => typeof line !== "string")) {
      throwL2(L2_ERROR_CODES.MALFORMED);
    }
  }
  for (const entries of Object.values(delta.maps)) {
    if (!recordObject(entries)) {
      throwL2(L2_ERROR_CODES.MALFORMED);
    }
  }
  const rels = [
    ...delta.files.map((file) => file?.rel),
    ...Object.keys(delta.jsonl),
    ...Object.keys(delta.maps),
  ];
  if (new Set(rels).size !== rels.length) throwL2(L2_ERROR_CODES.MALFORMED);
  for (const rel of rels) validateRelativePath(rel);
  if (Object.keys(delta.jsonl).some((rel) => !knownJsonl.has(rel))
    || Object.keys(delta.maps).some((rel) => !knownMaps.has(rel))) throwL2(L2_ERROR_CODES.PATH_REJECTED);
}

async function checkTargets(forgeHome, delta) {
  validateDeltaPaths(delta);
  for (const rel of [
    ...delta.files.map((file) => file.rel),
    ...Object.keys(delta.jsonl),
    ...Object.keys(delta.maps),
  ]) {
    const target = path.resolve(forgeHome, ...rel.split("/"));
    await assertInside(forgeHome, target, "L2_PATH_REJECTED");
    let info;
    try {
      info = await lstat(target);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink()) throwL2(L2_ERROR_CODES.PATH_REJECTED);
  }
}

async function writeMissingFile(forgeHome, file, result) {
  const bytes = Buffer.from(file.dataB64, "base64");
  if (sha256(bytes) !== file.sha256) throwL2(L2_ERROR_CODES.CHECKSUM_MISMATCH);
  const target = path.join(forgeHome, ...file.rel.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = await readFile(target);
    if (existing.equals(bytes)) return;
    result.conflicts.push({ rel: file.rel, code: L2_ERROR_CODES.CONFLICT });
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
    result.applied.files += 1;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function appendMissingLines(forgeHome, rel, newLines, result) {
  const target = path.join(forgeHome, ...rel.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  let existing = Buffer.alloc(0);
  try {
    existing = await readFile(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const identities = new Set(jsonlRawLines(existing).map(recordIdentity));
  const additions = newLines.filter((line) => {
    const identity = recordIdentity(line);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
  if (!additions.length) return;
  const prefix = existing.length && existing[existing.length - 1] !== 10 ? Buffer.from("\n") : Buffer.alloc(0);
  const suffix = Buffer.concat(additions.map((line) => Buffer.from(line.endsWith("\n") ? line : `${line}\n`)));
  await appendFile(target, Buffer.concat([prefix, suffix]));
  result.applied.lines += additions.length;
}

function normalizeMapValue(file, entries) {
  return Object.entries(entries).map(([id, value]) => [String(id), value]);
}

async function mergeMap(forgeHome, rel, entries, result) {
  const target = path.join(forgeHome, ...rel.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  let parsed = rel === "cost-history.json" ? [] : {};
  try {
    parsed = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const current = new Map(mapEntries(rel, parsed));
  const incoming = normalizeMapValue(rel, entries);
  let changed = false;
  for (const [id, value] of incoming) {
    if (!current.has(id)) {
      current.set(id, value);
      result.applied.keys += 1;
      changed = true;
    } else if (!sameJson(current.get(id), value)) {
      result.conflicts.push({ rel, code: L2_ERROR_CODES.CONFLICT });
    }
  }
  if (!changed) return;
  const serialized = rel === "cost-history.json"
    ? JSON.stringify([...current.values()], null, 2)
    : JSON.stringify(Object.fromEntries(current), null, 2);
  await writeFile(target, `${serialized}\n`);
}

async function applyDeltaUnlocked(forgeHome, delta) {
  await checkTargets(forgeHome, delta);
  await mkdir(forgeHome, { recursive: true });
  const result = {
    ok: true,
    applied: { files: 0, lines: 0, keys: 0 },
    skipped: 0,
    conflicts: [],
  };
  for (const file of delta.files) {
    const before = result.applied.files;
    const conflicts = result.conflicts.length;
    await writeMissingFile(forgeHome, file, result);
    if (before === result.applied.files && conflicts === result.conflicts.length) result.skipped += 1;
  }
  for (const [rel, lines] of Object.entries(delta.jsonl)) {
    const before = result.applied.lines;
    await appendMissingLines(forgeHome, rel, lines, result);
    if (before === result.applied.lines) result.skipped += lines.length;
  }
  for (const [rel, entries] of Object.entries(delta.maps)) {
    const before = result.applied.keys;
    await mergeMap(forgeHome, rel, entries, result);
    if (before === result.applied.keys) result.skipped += Object.keys(entries).length;
  }
  result.ok = result.conflicts.length === 0;
  return result;
}

/**
 * Apply a delta without replacing canonical records; calls for one home serialize.
 * @param {{forgeHome: string, delta: object}} options
 */
export async function applyDelta({ forgeHome, delta } = {}) {
  if (typeof forgeHome !== "string" || !forgeHome) throwL2(L2_ERROR_CODES.MALFORMED);
  const key = path.resolve(forgeHome);
  const prior = homeQueues.get(key) ?? Promise.resolve();
  const pending = prior.then(
    () => applyDeltaUnlocked(key, delta),
    () => applyDeltaUnlocked(key, delta),
  );
  homeQueues.set(key, pending);
  try {
    return await pending;
  } finally {
    if (homeQueues.get(key) === pending) homeQueues.delete(key);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

/**
 * Canonicalize and split a delta into independently checksummed transport frames.
 * @param {{delta: object, deltaId: string, chunkBytes?: number, maxBytes?: number}} options
 */
export function encodeDeltaChunks({
  delta, deltaId, chunkBytes = CHUNK_RAW_BYTES, maxBytes = L2_MAX_DELTA_BYTES,
} = {}) {
  if (!delta || typeof deltaId !== "string" || !deltaId || !Number.isInteger(chunkBytes)
    || chunkBytes <= 0 || chunkBytes > CHUNK_RAW_BYTES
    || !Number.isFinite(maxBytes) || maxBytes <= 0) throwL2(L2_ERROR_CODES.MALFORMED);
  const bytes = Buffer.from(JSON.stringify(canonicalize(delta)));
  if (bytes.byteLength > maxBytes) throwL2(L2_ERROR_CODES.DELTA_TOO_LARGE);
  const total = Math.max(1, Math.ceil(bytes.byteLength / chunkBytes));
  const sha256Total = sha256(bytes);
  return Array.from({ length: total }, (_, index) => {
    const section = bytes.subarray(index * chunkBytes, (index + 1) * chunkBytes);
    return {
      kind: "l2-delta", deltaId, index, total,
      sha256Chunk: sha256(section), sha256Total, data: section.toString("base64"),
    };
  });
}

/**
 * Verify and reconstruct all delta chunks without touching the filesystem.
 * @param {{chunks: object[]}} options
 */
export function assembleDeltaChunks({ chunks } = {}) {
  if (!Array.isArray(chunks) || !chunks.length) throwL2(L2_ERROR_CODES.CHUNK_MISSING);
  const first = chunks[0];
  if (!first || !Number.isInteger(first.total) || first.total < 1
    || typeof first.deltaId !== "string") throwL2(L2_ERROR_CODES.MALFORMED);
  const indexed = new Map();
  for (const chunk of chunks) {
    validateDeltaChunk({ chunk, first });
    if (indexed.has(chunk.index)) throwL2(L2_ERROR_CODES.CHUNK_DUP);
    indexed.set(chunk.index, decodeDeltaChunk(chunk));
  }
  if (indexed.size !== first.total) throwL2(L2_ERROR_CODES.CHUNK_MISSING);
  if ([...indexed.values()].reduce((sum, chunk) => sum + chunk.byteLength, 0) > L2_MAX_DELTA_BYTES) {
    throwL2(L2_ERROR_CODES.DELTA_TOO_LARGE);
  }
  const bytes = Buffer.concat(Array.from({ length: first.total }, (_, index) => indexed.get(index)));
  if (chunks.some((chunk) => chunk.sha256Total !== first.sha256Total) || sha256(bytes) !== first.sha256Total) {
    throwL2(L2_ERROR_CODES.CHECKSUM_MISMATCH);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throwL2(L2_ERROR_CODES.MALFORMED);
  }
}

function validateDeltaChunk({ chunk, first }) {
  if (!chunk || chunk.kind !== "l2-delta" || chunk.deltaId !== first.deltaId
    || chunk.total !== first.total || !Number.isInteger(chunk.index)
    || chunk.index < 0 || chunk.index >= chunk.total || typeof chunk.data !== "string") throwL2(L2_ERROR_CODES.MALFORMED);
}

function decodeDeltaChunk(chunk) {
  const bytes = Buffer.from(chunk.data, "base64");
  if (sha256(bytes) !== chunk.sha256Chunk) throwL2(L2_ERROR_CODES.CHECKSUM_MISMATCH);
  if (bytes.byteLength > CHUNK_RAW_BYTES) throwL2(L2_ERROR_CODES.DELTA_TOO_LARGE);
  return bytes;
}

/**
 * Verify the source hash recorded by a local hallmark.
 * @param {{forgeHome: string, id: string}} options
 * @returns {Promise<{ok: boolean, drift: boolean}>}
 */
export async function verifyHallmark({ forgeHome, id } = {}) {
  try {
    const hallmarkPath = path.join(forgeHome, "hallmarks", `${id}.json`);
    await assertInside(forgeHome, hallmarkPath, "L2_PATH_REJECTED");
    const hallmark = JSON.parse(await readFile(hallmarkPath, "utf8"));
    if (!hallmark.source || !hallmark.sourceHash) return { ok: true, drift: false };
    validateRelativePath(hallmark.source);
    const sourcePath = path.join(forgeHome, ...hallmark.source.split("/"));
    await assertInside(forgeHome, sourcePath, "L2_PATH_REJECTED");
    const drift = sha256(await readFile(sourcePath)) !== hallmark.sourceHash;
    return { ok: !drift, drift };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return { ok: false, drift: true };
    throw error;
  }
}

/**
 * Apply a delta on the canonical lane, forwarding rather than mutating other lanes.
 * This routing helper does not promote transport receipts to application proof;
 * the registered receiver verifies the returned ApplicationAck identity.
 * @param {object} options
 */
export async function forwardDelta({
  project, config, delta, currentLaneId, applyLocal, sendToLane,
} = {}) {
  const home = resolveForgeHome({ project, config });
  if (home.laneId === currentLaneId) return applyLocal({ forgeHome: home.path, delta });
  return sendToLane(home.laneId, { tool: "l2.apply", args: { forgeHome: home.path, delta } });
}

/**
 * Report jobs whose L2 transfer ended without its terminal event.
 * @param {{records: object[]}} options
 */
export function doctorCheckIncompleteSync({ records = [] } = {}) {
  const failing = records.filter((record) => record?.reason === L2_SYNC_INCOMPLETE)
    .map(({ jobId, laneId }) => ({ jobId, laneId }));
  return { ok: failing.length === 0, failing };
}
