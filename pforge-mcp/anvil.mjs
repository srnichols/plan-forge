/**
 * Plan Forge — Anvil (Δ-only Memoization Cache)
 *
 * Provides a pure memoization wrapper (`withAnvil`) for read-only tools,
 * plus stat/clear/rebuild surface for operator visibility. Slice 1 covers
 * the core cache only — DLQ is added in Slice 2.
 *
 * On-disk layout:
 *   .forge/anvil/<toolName>/<sha256>.json   — cached payload
 *   .forge/anvil/stats.json                 — per-tool hit/miss counters
 *
 * Cache key: sha256(toolName + ":" + sha256(JSON.stringify(inputs, sortedReplacer)) + ":" + sha256(codeHashSeed))
 *
 * @module anvil
 */

import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
  readdirSync, rmSync, statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * SHA-256 hex of a string.
 * @param {string} data
 * @returns {string}
 */
function sha256(data) {
  return createHash("sha256").update(data, "utf-8").digest("hex");
}

/**
 * JSON.stringify replacer that sorts object keys for canonical output.
 * @param {string} _key
 * @param {*} value
 * @returns {*}
 */
function sortedReplacer(_key, value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = value[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Resolve the root directory for all anvil entries.
 * @param {{ cwd?: string }} deps
 * @returns {string}
 */
function anvilRoot(deps = {}) {
  const cwd = deps.cwd || process.cwd();
  return resolve(cwd, ".forge", "anvil");
}

/**
 * Path to the stats file.
 * @param {{ cwd?: string }} deps
 * @returns {string}
 */
function statsPath(deps = {}) {
  return join(anvilRoot(deps), "stats.json");
}

// ─── Stats I/O ───────────────────────────────────────────────────────────────

/**
 * Read the stats file, returning a default structure if absent.
 * @param {{ cwd?: string }} deps
 * @returns {{ perTool: Record<string, { hits: number, misses: number }> }}
 */
function readStats(deps = {}) {
  const p = statsPath(deps);
  if (!existsSync(p)) return { perTool: {} };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { perTool: {} };
  }
}

/**
 * Persist the stats object atomically.
 * @param {{ perTool: Record<string, { hits: number, misses: number }> }} stats
 * @param {{ cwd?: string }} deps
 */
function writeStats(stats, deps = {}) {
  const p = statsPath(deps);
  mkdirSync(resolve(p, ".."), { recursive: true });
  writeFileSync(p, JSON.stringify(stats, null, 2), "utf-8");
}

/**
 * Increment a hit or miss counter for a tool.
 * @param {string} toolName
 * @param {"hit"|"miss"} kind
 * @param {{ cwd?: string }} deps
 */
function recordStat(toolName, kind, deps = {}) {
  try {
    const stats = readStats(deps);
    if (!stats.perTool[toolName]) stats.perTool[toolName] = { hits: 0, misses: 0 };
    if (kind === "hit") stats.perTool[toolName].hits++;
    else stats.perTool[toolName].misses++;
    writeStats(stats, deps);
  } catch {
    // Stats are best-effort — never block the caller
  }
}

// ─── Cache Key ───────────────────────────────────────────────────────────────

/**
 * Compute the canonical cache key.
 * @param {string} toolName
 * @param {*} inputs
 * @param {string} codeHashSeed
 * @returns {string}
 */
function computeCacheKey(toolName, inputs, codeHashSeed) {
  const inputsHash = sha256(JSON.stringify(inputs, sortedReplacer));
  const seedHash = sha256(String(codeHashSeed));
  return sha256(`${toolName}:${inputsHash}:${seedHash}`);
}

// ─── Entry I/O ───────────────────────────────────────────────────────────────

/**
 * Resolve the path for a given toolName + key.
 * @param {string} toolName
 * @param {string} key
 * @param {{ cwd?: string }} deps
 * @returns {string}
 */
function entryPath(toolName, key, deps = {}) {
  return join(anvilRoot(deps), toolName, `${key}.json`);
}

/**
 * Read a cached entry, returning null on any error.
 * @param {string} toolName
 * @param {string} key
 * @param {{ cwd?: string }} deps
 * @returns {{ payload: *, storedAt: string, codeHashSeed: string } | null}
 */
function readEntry(toolName, key, deps = {}) {
  const p = entryPath(toolName, key, deps);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Write a cache entry to disk.
 * @param {string} toolName
 * @param {string} key
 * @param {*} payload
 * @param {string} codeHashSeed
 * @param {{ cwd?: string }} deps
 */
function writeEntry({ toolName, key, payload, codeHashSeed, deps = {} }) {
  const p = entryPath(toolName, key, deps);
  mkdirSync(resolve(p, ".."), { recursive: true });
  const record = {
    toolName,
    cacheKey: key,
    codeHashSeed: String(codeHashSeed),
    storedAt: new Date().toISOString(),
    payload,
  };
  writeFileSync(p, JSON.stringify(record, null, 2), "utf-8");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Memoization wrapper for a pure tool function.
 *
 * On cache hit: returns `{ ...payload, anvil: { hit: true, key, ageMs } }`
 * On cache miss: runs `toolFn`, stores result, returns `{ ...payload, anvil: { hit: false, key } }`
 *
 * Supports both synchronous and asynchronous `toolFn`.
 *
 * @param {Function} toolFn
 * @param {{ toolName: string, inputs: *, codeHashSeed: string }} opts
 * @param {{ cwd?: string }} [deps]
 * @returns {Promise<*>}
 */
export async function withAnvil(toolFn, opts = {}, deps = {}) {
  const { toolName, inputs, codeHashSeed } = opts;
  const key = computeCacheKey(toolName, inputs, codeHashSeed);

  const cached = readEntry(toolName, key, deps);
  if (cached !== null) {
    const ageMs = Date.now() - new Date(cached.storedAt).getTime();
    recordStat(toolName, "hit", deps);
    return { ...cached.payload, anvil: { hit: true, key, ageMs: Math.max(0, ageMs) } };
  }

  const result = await toolFn();

  writeEntry({ toolName: toolName, key: key, payload: result, codeHashSeed: codeHashSeed, deps: deps });
  recordStat(toolName, "miss", deps);

  return { ...result, anvil: { hit: false, key } };
}

/**
 * Read-only summary of the anvil cache.
 *
 * Returns: `{ entries, totalBytes, oldestMtime, perTool: { [tool]: { hits, misses, count } } }`
 *
 * @param {{ cwd?: string }} [deps]
 * @returns {{ entries: number, totalBytes: number, oldestMtime: number|null, perTool: Record<string, { hits: number, misses: number, count: number }> }}
 */
export function anvilStat(deps = {}) {
  const root = anvilRoot(deps);
  const stats = readStats(deps);

  let entries = 0;
  let totalBytes = 0;
  let oldestMtime = null;

  // Per-tool entry counts from disk
  const diskCounts = {};
  if (existsSync(root)) {
    for (const toolDir of readdirSync(root)) {
      if (toolDir === "stats.json" || toolDir === "dlq") continue;
      const toolPath = join(root, toolDir);
      let st;
      try { st = statSync(toolPath); } catch { continue; }
      if (!st.isDirectory()) continue;

      let count = 0;
      for (const file of readdirSync(toolPath)) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(toolPath, file);
        try {
          const fst = statSync(filePath);
          count++;
          entries++;
          totalBytes += fst.size;
          const mtimeMs = fst.mtimeMs;
          if (oldestMtime === null || mtimeMs < oldestMtime) oldestMtime = mtimeMs;
        } catch {
          // skip unreadable files
        }
      }
      diskCounts[toolDir] = count;
    }
  }

  // Merge disk counts with stats.json counters
  const perTool = {};
  const allTools = new Set([...Object.keys(diskCounts), ...Object.keys(stats.perTool)]);
  for (const tool of allTools) {
    const s = stats.perTool[tool] || { hits: 0, misses: 0 };
    perTool[tool] = { hits: s.hits, misses: s.misses, count: diskCounts[tool] || 0 };
  }

  return { entries, totalBytes, oldestMtime, perTool };
}

/**
 * Bounded cache deletion. Requires at least one of `tool` or `olderThanMs`.
 * Calling with no filters throws `ERR_ANVIL_NO_FILTER`.
 *
 * @param {{ tool?: string, olderThanMs?: number }} [opts]
 * @param {{ cwd?: string }} [deps]
 * @returns {{ deleted: number }}
 */
export function anvilClear(opts = {}, deps = {}) {
  const { tool, olderThanMs } = opts;

  if (!tool && olderThanMs == null) {
    const err = new Error(
      "anvilClear requires at least one filter (tool or olderThanMs) to prevent accidental full-cache nuke"
    );
    err.code = "ERR_ANVIL_NO_FILTER";
    throw err;
  }

  const root = anvilRoot(deps);
  if (!existsSync(root)) return { deleted: 0 };

  let deleted = 0;
  const nowMs = Date.now();

  const toolDirs = tool
    ? [tool]
    : readdirSync(root).filter(d => d !== "stats.json" && d !== "dlq");

  for (const toolDir of toolDirs) {
    const toolPath = join(root, toolDir);
    if (!existsSync(toolPath)) continue;
    let st;
    try { st = statSync(toolPath); } catch { continue; }
    if (!st.isDirectory()) continue;

    if (olderThanMs == null) {
      // Delete the entire tool directory
      rmSync(toolPath, { recursive: true, force: true });
      deleted++;
      continue;
    }

    // Delete individual files at least olderThanMs old (inclusive,
    // so olderThanMs:0 deletes everything regardless of mtime).
    for (const file of readdirSync(toolPath)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(toolPath, file);
      try {
        const fst = statSync(filePath);
        if (Math.max(0, nowMs - fst.mtimeMs) >= olderThanMs) {
          rmSync(filePath, { force: true });
          deleted++;
        }
      } catch {
        // skip
      }
    }
  }

  return { deleted };
}

/**
 * Selectively invalidates cache entries whose `codeHashSeed` references a
 * file that changed since `since` (a git SHA). Uses `git diff --name-only`.
 *
 * Does NOT re-run the tool — the next caller gets a clean miss.
 *
 * @param {{ since: string }} opts
 * @param {{ cwd?: string, exec?: Function }} [deps]
 * @returns {{ invalidated: number, changedFiles: string[] }}
 */
export function anvilRebuild(opts = {}, deps = {}) {
  const { since } = opts;
  if (!since) {
    throw new Error("anvilRebuild requires { since: '<sha>' }");
  }

  const cwd = deps.cwd || process.cwd();
  const exec = deps.exec || ((file, a, o) => execFileSync(file, a, o).toString());

  let diffOutput = "";
  try {
    diffOutput = exec("git", ["diff", "--name-only", since, "HEAD"], {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: "pipe",
    });
  } catch {
    return { invalidated: 0, changedFiles: [] };
  }

  const changedFiles = diffOutput
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  if (changedFiles.length === 0) {
    return { invalidated: 0, changedFiles: [] };
  }

  const root = anvilRoot(deps);
  if (!existsSync(root)) return { invalidated: 0, changedFiles };

  let invalidated = 0;

  for (const toolDir of readdirSync(root)) {
    if (toolDir === "stats.json" || toolDir === "dlq") continue;
    const toolPath = join(root, toolDir);
    let st;
    try { st = statSync(toolPath); } catch { continue; }
    if (!st.isDirectory()) continue;

    for (const file of readdirSync(toolPath)) {
      if (!file.endsWith(".json")) continue;
      const filePath = join(toolPath, file);
      try {
        const entry = JSON.parse(readFileSync(filePath, "utf-8"));
        const seed = String(entry.codeHashSeed || "");
        // An entry "references" a changed file if its codeHashSeed ends with
        // or contains the changed file path (handles absolute vs. relative)
        const references = changedFiles.some(
          f => seed === f || seed.endsWith(`/${f}`) || seed.endsWith(`\\${f}`) || seed.includes(f)
        );
        if (references) {
          rmSync(filePath, { force: true });
          invalidated++;
        }
      } catch {
        // skip unreadable entries
      }
    }
  }

  return { invalidated, changedFiles };
}

// ─── DLQ Helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the DLQ directory path.
 * @param {{ cwd?: string }} deps
 * @returns {string}
 */
function dlqDir(deps = {}) {
  return join(anvilRoot(deps), "dlq");
}

/**
 * Resolve the path for a specific DLQ entry.
 * @param {string} id
 * @param {{ cwd?: string }} deps
 * @returns {string}
 */
function dlqEntryPath(id, deps = {}) {
  return join(dlqDir(deps), `${id}.json`);
}

// ─── DLQ Public API ──────────────────────────────────────────────────────────

/**
 * Append a failure record to the Dead Letter Queue.
 *
 * The caller supplies whatever fields are known (`toolName`, `inputs`,
 * `error`). The function assigns a UUID `id` and a `failedAt` ISO timestamp.
 *
 * @param {{ toolName?: string, inputs?: *, error?: string, [key: string]: * }} [entry]
 * @param {{ cwd?: string }} [deps]
 * @returns {{ id: string }}
 */
export function anvilDlqAppend(entry = {}, deps = {}) {
  const id = randomUUID();
  const dir = dlqDir(deps);
  mkdirSync(dir, { recursive: true });
  const record = {
    ...entry,
    id,
    toolName: entry.toolName ?? null,
    inputs: entry.inputs ?? null,
    error: entry.error ?? null,
    failedAt: new Date().toISOString(),
  };
  writeFileSync(dlqEntryPath(id, deps), JSON.stringify(record, null, 2), "utf-8");
  return { id };
}

/**
 * List DLQ entries, optionally filtered by tool name and/or capped by limit.
 *
 * Returns all matching entries ordered by `failedAt` ascending (oldest first).
 * `total` reflects the count of matching entries before `limit` is applied.
 *
 * @param {{ tool?: string, limit?: number }} [opts]
 * @param {{ cwd?: string }} [deps]
 * @returns {{ items: Array<{ id: string, toolName: string|null, failedAt: string, [key: string]: * }>, total: number }}
 */
export function anvilDlqList(opts = {}, deps = {}) {
  const { tool, limit } = opts;
  const dir = dlqDir(deps);
  if (!existsSync(dir)) return { items: [], total: 0 };

  const items = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, file), "utf-8"));
      if (tool != null && rec.toolName !== tool) continue;
      items.push(rec);
    } catch {
      // skip unreadable entries
    }
  }

  items.sort((a, b) => {
    const ta = a.failedAt ? new Date(a.failedAt).getTime() : 0;
    const tb = b.failedAt ? new Date(b.failedAt).getTime() : 0;
    return ta - tb;
  });

  const total = items.length;
  return { items: limit != null ? items.slice(0, limit) : items, total };
}

/**
 * Remove DLQ entries — by specific `id`, by `tool`, or all entries when no
 * filter is provided.
 *
 * Unlike `anvilClear`, a full drain (no opts) is intentional and permitted.
 *
 * **Callback form** (Phase-ANVIL Slice 4):
 * When the first argument is an async function, the drain iterates every
 * DLQ record oldest-first and calls `callback(record)`. A record is deleted
 * only when the callback returns `{ ok: true }`. Records whose callback
 * returns `{ ok: false }` (or throws) remain on the heap.
 *
 * The callback form returns a Promise of `{ drained: number, remaining: number }`.
 *
 * **Opts form** (backward-compatible, synchronous):
 * When the first argument is an opts object `{ id?, tool? }`, the function
 * behaves as before and returns `{ drained: number }` synchronously.
 *
 * @overload
 * @param {(rec: object) => Promise<{ ok: boolean }>} callback
 * @param {{ cwd?: string }} [deps]
 * @returns {Promise<{ drained: number, remaining: number }>}
 *
 * @overload
 * @param {{ id?: string, tool?: string }} [opts]
 * @param {{ cwd?: string }} [deps]
 * @returns {{ drained: number }}
 */
export function anvilDlqDrain(callbackOrOpts = {}, deps = {}) {
  // ── Callback-based async drain ──────────────────────────────────────────────
  if (typeof callbackOrOpts === "function") {
    const callback = callbackOrOpts;
    const dir = dlqDir(deps);
    if (!existsSync(dir)) return Promise.resolve({ drained: 0, remaining: 0 });

    return (async () => {
      const { items } = anvilDlqList({}, deps);
      let drained = 0;
      let remaining = 0;
      for (const rec of items) {
        let result;
        try {
          result = await callback(rec);
        } catch {
          result = { ok: false };
        }
        if (result && result.ok === true) {
          try { rmSync(dlqEntryPath(rec.id, deps), { force: true }); } catch { /* skip */ }
          drained++;
        } else {
          remaining++;
        }
      }
      return { drained, remaining };
    })();
  }

  // ── Legacy opts-based synchronous drain ─────────────────────────────────────
  const { id, tool } = callbackOrOpts;
  const dir = dlqDir(deps);
  if (!existsSync(dir)) return { drained: 0 };

  if (id != null) {
    const p = dlqEntryPath(id, deps);
    if (existsSync(p)) {
      rmSync(p, { force: true });
      return { drained: 1 };
    }
    return { drained: 0 };
  }

  let drained = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const filePath = join(dir, file);
    try {
      if (tool != null) {
        const rec = JSON.parse(readFileSync(filePath, "utf-8"));
        if (rec.toolName !== tool) continue;
      }
      rmSync(filePath, { force: true });
      drained++;
    } catch {
      // skip unreadable entries
    }
  }
  return { drained };
}
