/**
 * Plan Forge — Forge-Master Cross-Session Recall Index (Phase-38.2).
 *
 * Builds and queries a BM25 index over past fm-session JSONL files so
 * `runTurn` can surface related prior interactions for operational,
 * troubleshoot, and advisory lanes.
 *
 * Index file: `.forge/fm-sessions/recall-index.json`
 *   { version, projectDir, lastBuiltAt, docs: [...], idf: {...} }
 *
 * Turn doc shape in index:
 *   { turnId, sessionId, timestamp, userMessage, lane, replyHash }
 *
 * BM25 parameters: k1 = 1.5, b = 0.75 (standard TREC defaults)
 *
 * Exports:
 *   buildIndex(projectDir) → Promise<void>
 *   loadIndex(projectDir)  → Promise<void>   (lazy refresh by staleness)
 *   queryIndex(text, opts) → Promise<Array<RecallHit>>
 *
 * @module forge-master/recall-index
 */

import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// ─── BM25 constants ──────────────────────────────────────────────────

const K1 = 1.5;
const B = 0.75;
const INDEX_VERSION = 1;
const MIN_QUERY_TOKENS = 3;

// ─── Path helpers ────────────────────────────────────────────────────

function sessionsDir(projectDir) {
  return join(projectDir || process.cwd(), ".forge", "fm-sessions");
}

function indexPath(projectDir) {
  return join(sessionsDir(projectDir), "recall-index.json");
}

// ─── Tokenizer ───────────────────────────────────────────────────────

/**
 * Tokenize a string into lowercase terms.
 * Splits on whitespace and punctuation, but also expands hyphenated/dotted
 * Plan Forge terms (e.g. "meta-bug-triage" → ["meta", "bug", "triage", "meta-bug-triage"]).
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const lower = text.toLowerCase();
  // Split on whitespace and common delimiters
  const parts = lower.split(/[\s/\\,;|]+/).filter(Boolean);
  const tokens = new Set();
  for (const part of parts) {
    // Add the whole part (may include hyphens/dots — Plan Forge IDs)
    if (part.length > 0) tokens.add(part);
    // Also split on hyphens and dots for sub-term matching
    const sub = part.split(/[-.]/).filter((s) => s.length > 1);
    for (const s of sub) tokens.add(s);
  }
  return [...tokens];
}

// ─── Per-projectDir build mutex ──────────────────────────────────────

const _buildInFlight = new Map();

// ─── JSONL reader ────────────────────────────────────────────────────

async function readJsonlFile(filePath) {
  try {
    const text = await readFile(filePath, "utf-8");
    const lines = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { lines.push(JSON.parse(trimmed)); } catch { /* skip malformed */ }
    }
    return lines;
  } catch {
    return [];
  }
}

// ─── Module-level index cache (by projectDir) ───────────────────────

const _indexCache = new Map(); // projectDir → { index, mtime }

// ─── Build ───────────────────────────────────────────────────────────

/**
 * Build (or rebuild) the BM25 recall index from all active + archive
 * JSONL files in `.forge/fm-sessions/`, excluding OFFTOPIC turns.
 * Writes result to `.forge/fm-sessions/recall-index.json`.
 * Concurrent calls for the same projectDir are serialized.
 *
 * @param {string} [projectDir] — defaults to process.cwd()
 */
export async function buildIndex(projectDir = process.cwd()) {
  // Serialize concurrent builds for the same project
  const prev = _buildInFlight.get(projectDir) || Promise.resolve();
  let resolveBuild;
  const thisBuild = new Promise((res) => { resolveBuild = res; });
  _buildInFlight.set(projectDir, thisBuild);

  try {
    await prev;
    await _doBuild(projectDir);
  } finally {
    resolveBuild();
    if (_buildInFlight.get(projectDir) === thisBuild) {
      _buildInFlight.delete(projectDir);
    }
  }
}

async function _doBuild(projectDir) {
  const dir = sessionsDir(projectDir);
  await mkdir(dir, { recursive: true });

  // Enumerate session files (active + archive, not the index itself)
  let files = [];
  try {
    const entries = await readdir(dir);
    files = entries
      .filter((f) => f.endsWith(".jsonl") && f !== "recall-index.json")
      .map((f) => join(dir, f));
  } catch {
    files = [];
  }

  // Parse all turns
  const docs = [];
  for (const file of files) {
    const sessionId = _sessionIdFromFile(file);
    if (!sessionId) continue;
    const turns = await readJsonlFile(file);
    for (const turn of turns) {
      // Skip OFFTOPIC turns — they are noise
      if (turn.classification?.lane === "offtopic") continue;
      if (!turn.userMessage) continue;
      const turnId = `${sessionId}:${turn.turn ?? docs.length}`;
      docs.push({
        turnId,
        sessionId,
        timestamp: turn.timestamp || "",
        userMessage: turn.userMessage,
        lane: turn.classification?.lane || "unknown",
        replyHash: turn.replyHash || "",
        _tokens: tokenize(turn.userMessage),
      });
    }
  }

  // Build IDF table
  const df = {};
  for (const doc of docs) {
    const seen = new Set(doc._tokens);
    for (const t of seen) {
      df[t] = (df[t] || 0) + 1;
    }
  }
  const N = docs.length;
  const idf = {};
  for (const [t, freq] of Object.entries(df)) {
    idf[t] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
  }

  // Compute average doc length
  const avgdl = docs.length > 0
    ? docs.reduce((s, d) => s + d._tokens.length, 0) / docs.length
    : 1;

  const index = {
    version: INDEX_VERSION,
    projectDir,
    lastBuiltAt: new Date().toISOString(),
    avgdl,
    idf,
    docs: docs.map(({ _tokens, ...rest }) => ({ ...rest, dl: _tokens.length, termFreq: _termFreq(_tokens) })),
  };

  // Atomic write via tmp file + rename
  const target = indexPath(projectDir);
  const tmp = target + ".tmp";
  await writeFile(tmp, JSON.stringify(index), "utf-8");
  await writeFile(target, JSON.stringify(index), "utf-8"); // direct write (Windows lacks atomic rename to existing)

  // Update in-memory cache
  _indexCache.set(projectDir, { index, mtime: Date.now() });
}

function _termFreq(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  return tf;
}

function _sessionIdFromFile(filePath) {
  const base = filePath.replace(/\\/g, "/").split("/").pop() || "";
  if (base.endsWith(".archive.jsonl")) return base.slice(0, -".archive.jsonl".length);
  if (base.endsWith(".jsonl")) return base.slice(0, -".jsonl".length);
  return null;
}

// ─── Load (lazy refresh) ─────────────────────────────────────────────

/**
 * Load the recall index from disk, rebuilding if absent or stale.
 * Staleness = any session JSONL file is newer than the index, OR
 * the index was built on a prior calendar day, OR the index file is absent.
 *
 * @param {string} [projectDir]
 */
export async function loadIndex(projectDir = process.cwd()) {
  const path = indexPath(projectDir);

  // Check in-memory cache freshness first
  const cached = _indexCache.get(projectDir);

  let indexStat = null;
  try { indexStat = await stat(path); } catch { /* absent */ }

  if (!indexStat) {
    // Index absent — build it
    await buildIndex(projectDir);
    return;
  }

  // Stale if last-built is a prior calendar day
  let existingIndex = null;
  try {
    const raw = await readFile(path, "utf-8");
    existingIndex = JSON.parse(raw);
  } catch {
    await buildIndex(projectDir);
    return;
  }

  const builtDate = existingIndex.lastBuiltAt
    ? existingIndex.lastBuiltAt.slice(0, 10)
    : "";
  const today = new Date().toISOString().slice(0, 10);
  if (builtDate !== today) {
    await buildIndex(projectDir);
    return;
  }

  // Stale if any session file is newer than the index
  const dir = sessionsDir(projectDir);
  let sessionFiles = [];
  try {
    const entries = await readdir(dir);
    sessionFiles = entries
      .filter((f) => f.endsWith(".jsonl") && f !== "recall-index.json")
      .map((f) => join(dir, f));
  } catch { /* no sessions */ }

  for (const f of sessionFiles) {
    try {
      const s = await stat(f);
      if (s.mtimeMs > indexStat.mtimeMs) {
        await buildIndex(projectDir);
        return;
      }
    } catch { /* skip */ }
  }

  // Index is fresh — load into cache if not already there
  if (!cached) {
    _indexCache.set(projectDir, { index: existingIndex, mtime: indexStat.mtimeMs });
  }
}

// ─── Query ───────────────────────────────────────────────────────────

/**
 * Query the recall index with BM25 ranking.
 * Returns up to `topK` results sorted by descending score.
 * Returns [] when the query is too short (< 3 tokens) or the index is empty.
 *
 * @param {string} text
 * @param {{ topK?: number, projectDir?: string }} [opts]
 * @returns {Promise<Array<{turnId,sessionId,timestamp,userMessage,lane,replyHash,score}>>}
 */
export async function queryIndex(text, opts = {}) {
  const { topK = 3, projectDir = process.cwd() } = opts;

  const queryTokens = tokenize(text);
  if (queryTokens.length < MIN_QUERY_TOKENS) return [];

  // Ensure cache is populated
  await loadIndex(projectDir);
  const cached = _indexCache.get(projectDir);
  if (!cached) return [];

  const { index } = cached;
  if (!index || !index.docs || index.docs.length === 0) return [];

  const { docs, idf, avgdl } = index;

  const scores = docs.map((doc) => {
    let score = 0;
    for (const qt of queryTokens) {
      const idfScore = idf[qt] || 0;
      if (idfScore === 0) continue;
      const tf = doc.termFreq?.[qt] || 0;
      if (tf === 0) continue;
      const dl = doc.dl || 1;
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * dl / (avgdl || 1)));
      score += idfScore * norm;
    }
    return { doc, score };
  });

  return scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ doc, score }) => ({
      turnId: doc.turnId,
      sessionId: doc.sessionId,
      timestamp: doc.timestamp,
      userMessage: doc.userMessage,
      lane: doc.lane,
      replyHash: doc.replyHash,
      score,
    }));
}

/** For testing only — clears the in-memory index cache. */
export function _resetIndexCache() {
  _indexCache.clear();
}
