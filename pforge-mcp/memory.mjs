/**
 * Plan Forge — OpenBrain Memory Integration
 *
 * Integrates persistent semantic memory into the orchestrator pipeline.
 * When OpenBrain is configured, the orchestrator:
 *   - Injects memory search results into worker prompts (before each slice)
 *   - Instructs workers to capture decisions (after each slice)
 *   - Captures run summaries as thoughts (after completion)
 *
 * All integration is opt-in: if OpenBrain is not configured, all functions
 * return empty strings / no-ops. Zero impact on non-OpenBrain users.
 *
 * @module memory
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Default keyword patterns mapped to targeted search queries for `search_thoughts`.
 * Matched against slice titles to generate domain-specific context requests.
 * G3.4 (v2.36): projects can override via `.forge.json` → `openbrain.keywordMap`
 * using the same shape — see `loadKeywordSearchMap()`.
 */
const DEFAULT_KEYWORD_SEARCH_MAP = [
  { pattern: /\b(database|migration|schema|alter|seed|index|ef\s+core|dbcontext|repository)\b/i, query: "database migration patterns" },
  { pattern: /\b(auth|token|rbac|jwt|oauth|password|credential|permission|role)\b/i, query: "authentication authorization patterns" },
  { pattern: /\b(api|endpoint|route|controller|http|rest|graphql)\b/i, query: "API endpoint design patterns" },
  { pattern: /\b(test|spec|jest|xunit|mocha|vitest|coverage)\b/i, query: "testing patterns conventions" },
  { pattern: /\b(deploy|ci|cd|pipeline|docker|kubernetes|container)\b/i, query: "deployment pipeline patterns" },
  { pattern: /\b(ui|component|react|vue|angular|frontend|css)\b/i, query: "UI component patterns" },
  { pattern: /\b(cache|redis|memcache|invalidat)\b/i, query: "caching invalidation patterns" },
  { pattern: /\b(error|exception|logging|monitor|alert)\b/i, query: "error handling logging patterns" },
  { pattern: /\b(memory|openbrain|context|semantic)\b/i, query: "memory context integration patterns" },
];

// Back-compat alias — some downstream code / tests imported this symbol.
const KEYWORD_SEARCH_MAP = DEFAULT_KEYWORD_SEARCH_MAP;

/**
 * G3.4 (v2.36): load the active keyword-search map. Order of precedence:
 *   1. `.forge.json` → `openbrain.keywordMap: [{ pattern: "regex", flags?: "i", query: "..." }, ...]`
 *   2. Built-in `DEFAULT_KEYWORD_SEARCH_MAP`
 *
 * Invalid entries (missing pattern/query, malformed regex) are skipped with
 * a console warning — never throws. Returns an array of `{pattern: RegExp, query: string}`.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {Array<{pattern: RegExp, query: string}>}
 */
export function loadKeywordSearchMap(cwd = process.cwd()) {
  try {
    const cfgPath = resolve(cwd, ".forge.json");
    if (!existsSync(cfgPath)) return DEFAULT_KEYWORD_SEARCH_MAP;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    const custom = cfg?.openbrain?.keywordMap;
    if (!Array.isArray(custom) || custom.length === 0) return DEFAULT_KEYWORD_SEARCH_MAP;

    const compiled = [];
    for (const entry of custom) {
      if (!entry || typeof entry.pattern !== "string" || typeof entry.query !== "string") continue;
      try {
        const flags = typeof entry.flags === "string" ? entry.flags : "i";
        compiled.push({ pattern: new RegExp(entry.pattern, flags), query: entry.query });
      } catch (err) {
        console.error(`[memory] skipping invalid keywordMap entry (${entry.pattern}): ${err.message}`);
      }
    }
    return compiled.length > 0 ? compiled : DEFAULT_KEYWORD_SEARCH_MAP;
  } catch {
    return DEFAULT_KEYWORD_SEARCH_MAP;
  }
}

/**
 * Load project-level context to prepend to slice prompts.
 *
 * Reads key project files (README, architecture docs) and generates
 * slice-specific `search_thoughts` instructions based on keywords in the
 * slice title.  Returns an empty string when cwd is falsy or nothing
 * useful can be found — callers can concatenate unconditionally.
 *
 * @param {string} cwd - Working directory
 * @param {string} projectName - Project name for scoping OpenBrain searches
 * @param {string} sliceTitle - Title of the current slice (keyword matching)
 * @returns {string} Context block to prepend to the slice prompt, or ""
 */
export function loadProjectContext(cwd, projectName, sliceTitle) {
  if (!cwd) return "";

  const parts = [];

  // ── Project file snippets ──────────────────────────────────────────────
  const candidates = [
    { path: resolve(cwd, "README.md"),                   label: "Project README",  maxLines: 50 },
    { path: resolve(cwd, "ARCHITECTURE.md"),             label: "Architecture",    maxLines: 80 },
    { path: resolve(cwd, "docs", "ARCHITECTURE.md"),     label: "Architecture",    maxLines: 80 },
    { path: resolve(cwd, ".github", "CONTRIBUTING.md"),  label: "Contributing",    maxLines: 30 },
    { path: resolve(cwd, "CONTRIBUTING.md"),             label: "Contributing",    maxLines: 30 },
  ];

  const seen = new Set();
  for (const { path: filePath, label, maxLines } of candidates) {
    if (seen.has(label)) continue; // only first match per label
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        const snippet = content.split("\n").slice(0, maxLines).join("\n");
        parts.push(`### ${label}\n${snippet}`);
        seen.add(label);
      }
    } catch { /* skip unreadable files */ }
  }

  if (parts.length > 0) {
    parts.unshift("--- PROJECT CONTEXT ---");
    parts.push("--- END PROJECT CONTEXT ---");
  }

  // ── Slice-specific deep-context searches ──────────────────────────────
  if (sliceTitle && projectName) {
    // G3.4 (v2.36): use the configurable map instead of the frozen default.
    const keywordMap = loadKeywordSearchMap(cwd);
    const matchedQueries = keywordMap
      .filter(({ pattern }) => pattern.test(sliceTitle))
      .map(({ query }) => query);

    if (matchedQueries.length > 0) {
      parts.push("");
      parts.push("--- DEEP CONTEXT (OpenBrain) ---");
      parts.push("Search for domain-specific prior decisions before starting:");
      for (const query of matchedQueries) {
        parts.push(`  Use search_thoughts tool with query: "${query}", project: "${projectName}", limit: 5`);
      }
      parts.push("Apply findings to avoid repeating known patterns and mistakes.");
      parts.push("--- END DEEP CONTEXT ---");
    }
  }

  return parts.length > 0 ? parts.join("\n") + "\n" : "";
}

/**
 * Check if OpenBrain is configured in .vscode/mcp.json.
 */
export function isOpenBrainConfigured(cwd) {
  const mcpConfigPaths = [
    resolve(cwd, ".vscode", "mcp.json"),
    resolve(cwd, ".claude", "mcp.json"),
  ];

  for (const configPath of mcpConfigPaths) {
    try {
      if (existsSync(configPath)) {
        const config = readFileSync(configPath, "utf-8");
        if (config.includes("openbrain") || config.includes("open-brain")) {
          return true;
        }
      }
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * Build memory search instructions to prepend to a worker prompt.
 * The worker (gh copilot) will execute the search_thoughts call.
 *
 * @param {string} projectName - Project name for scoping
 * @param {object} slice - Slice metadata
 * @returns {string} Memory context block to prepend to prompt
 */
export function buildMemorySearchBlock(projectName, slice) {
  return `
--- MEMORY CONTEXT (OpenBrain) ---
Before starting work, search for relevant prior decisions:

1. Search for project conventions:
   Use the search_thoughts tool with query: "conventions patterns ${slice.title}"
   project: "${projectName}", type: "convention", limit: 5

2. Search for prior lessons on similar work:
   Use the search_thoughts tool with query: "${slice.title} ${slice.tasks?.[0] || ''}"
   project: "${projectName}", limit: 5

Apply any relevant findings. Do NOT repeat mistakes documented in prior thoughts.
--- END MEMORY CONTEXT ---
`;
}

/**
 * Build memory capture instructions to append to a worker prompt.
 * The worker will capture key decisions after completing work.
 *
 * @param {string} projectName - Project name
 * @param {object} slice - Slice metadata
 * @param {string} planName - Plan file name
 * @returns {string} Capture instructions block
 */
export function buildMemoryCaptureBlock(projectName, slice, planName) {
  return `
--- MEMORY CAPTURE (OpenBrain) ---
After completing all tasks and passing validation gates, capture key decisions:

Use the capture_thought tool for each significant decision:
- content: "Decision: <what you decided and why>"
- project: "${projectName}"
- source: "plan-forge-orchestrator/${planName}/slice-${slice.number}"
- created_by: "gh-copilot-worker"

Capture:
1. Architecture decisions made during this slice
2. Patterns chosen (and why alternatives were rejected)
3. Any gotchas or constraints discovered
4. Conventions established that future slices should follow

Do NOT capture trivial facts. Focus on decisions that would save time in future phases.
--- END MEMORY CAPTURE ---
`;
}

/**
 * Build a run summary thought for capture after completion.
 *
 * @param {object} summary - Run summary object
 * @param {string} projectName - Project name
 * @returns {{ content: string, project: string, source: string, created_by: string }}
 */
export function buildRunSummaryThought(summary, projectName) {
  const parts = [
    `Plan execution completed: ${summary.plan}`,
    `Status: ${summary.status}`,
    `Slices: ${summary.results?.passed || 0} passed, ${summary.results?.failed || 0} failed`,
    `Duration: ${Math.round((summary.totalDuration || 0) / 1000)}s`,
  ];

  if (summary.cost?.total_cost_usd > 0) {
    parts.push(`Cost: $${summary.cost.total_cost_usd}`);
  }

  if (summary.sweep?.ran) {
    parts.push(`Sweep: ${summary.sweep.clean ? "clean" : `${summary.sweep.markerCount || "?"} markers`}`);
  }

  if (summary.analyze?.score != null) {
    parts.push(`Consistency score: ${summary.analyze.score}/100`);
  }

  // Include per-slice outcomes for learning
  if (summary.sliceResults) {
    for (const sr of summary.sliceResults) {
      if (sr.status === "failed") {
        parts.push(`Slice ${sr.number || sr.sliceId} FAILED: ${sr.gateError || sr.error || "unknown"}`);
      }
    }
  }

  return {
    content: parts.join(". "),
    project: projectName,
    source: `plan-forge-orchestrator/${summary.plan}`,
    created_by: "plan-forge-orchestrator",
  };
}

/**
 * Build a cost anomaly thought if current run cost differs significantly.
 *
 * @param {object} summary - Current run summary
 * @param {object} costReport - Historical cost report
 * @param {string} projectName - Project name
 * @returns {object|null} Thought to capture, or null if no anomaly
 */
export function buildCostAnomalyThought(summary, costReport, projectName) {
  if (!summary.cost?.total_cost_usd || !costReport?.total_cost_usd || costReport.runs < 2) {
    return null;
  }

  const avgCostPerRun = costReport.total_cost_usd / costReport.runs;
  const currentCost = summary.cost.total_cost_usd;
  const ratio = currentCost / avgCostPerRun;

  if (ratio > 2.0) {
    return {
      content: `Cost anomaly: ${summary.plan} cost $${currentCost} (${ratio.toFixed(1)}x the average of $${avgCostPerRun.toFixed(2)}). Review slice complexity or model selection.`,
      project: projectName,
      source: `plan-forge-orchestrator/${summary.plan}`,
      created_by: "plan-forge-orchestrator",
      type: "insight",
    };
  }

  return null;
}

// ─── Watcher anomaly → thought shaping (v2.35.1 / G3.1) ─────────────────

/**
 * Shape a watcher anomaly into a capturable thought.
 *
 * Pure function: given an anomaly object + run metadata, returns the
 * `{ content, type, source }` triple that callers pass to `captureMemory()`.
 * Keeps the source attribution format consistent with GX.4: `<tool>/<code>`.
 *
 * Severity → type mapping:
 *   - "info"        → "lesson" (e.g. all-skipped is a learning, not a gotcha)
 *   - "warn"/"error"→ "gotcha" (recurring patterns worth remembering)
 *
 * @param {{ severity: string, code: string, message: string }} anomaly
 * @param {{ targetPath?: string, runId?: string|null, runState?: string }} meta
 * @param {"forge_watch"|"forge_watch_live"} [tool="forge_watch"]
 * @returns {{ content: string, type: string, source: string }}
 */
export function shapeWatcherAnomalyThought(anomaly, meta = {}, tool = "forge_watch") {
  const type = anomaly.severity === "info" ? "lesson" : "gotcha";
  const prefix = tool === "forge_watch_live" ? "Live watcher anomaly" : "Watcher anomaly";
  const parts = [`${prefix} [${anomaly.code}]: ${anomaly.message}`];
  if (meta.targetPath) parts.push(`targetPath=${meta.targetPath}`);
  parts.push(`runId=${meta.runId || "n/a"}`);
  if (meta.runState) parts.push(`state=${meta.runState}`);
  return {
    content: parts.join(". "),
    type,
    source: `${tool}/${anomaly.code}`,
  };
}

/**
 * Deduplicate watcher anomalies within a single session by `code|message`.
 * Pure function — the caller decides what to do with the result.
 *
 * @param {Array<{ code: string, message: string }>} anomalies
 * @returns {Array} unique anomalies preserving first-seen order
 */
export function dedupeWatcherAnomalies(anomalies) {
  if (!Array.isArray(anomalies)) return [];
  const seen = new Set();
  const out = [];
  for (const a of anomalies) {
    if (!a || !a.code) continue;
    const key = `${a.code}|${a.message || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// ─── G2.6 — OpenBrain queue state + DLQ ────────────────────────────────

/**
 * G2.6 (v2.36): wrap an enqueued thought with bookkeeping fields so a worker
 * (or the SessionStart drain hook) can track delivery state across attempts.
 *
 * Pure function — caller appends the result to `.forge/openbrain-queue.jsonl`.
 *
 *  _v             — schema version (G2.2)
 *  _status        — "pending" | "processing" | "failed" | "delivered"
 *  _attempts      — number of delivery attempts so far
 *  _enqueuedAt    — ISO timestamp the thought was first queued
 *  _nextAttemptAt — ISO timestamp the next delivery attempt is allowed
 *
 * @param {object} thought - The captured thought (content/type/source/etc.)
 * @returns {object} enriched queue record
 */
export function shapeQueueRecord(thought) {
  const now = new Date().toISOString();
  return {
    _v: 1,
    _status: "pending",
    _attempts: 0,
    _enqueuedAt: now,
    _nextAttemptAt: now,
    ...thought,
  };
}

/**
 * G2.6 (v2.36): given a current attempt count, return the next-attempt
 * timestamp using exponential backoff with jitter.
 *
 *   attempt 1 → 30s, 2 → 60s, 3 → 120s, 4 → 240s, 5 → 480s
 *   jitter ±20% to avoid thundering herd
 *
 * @param {number} attempts - Current attempt count (after increment)
 * @param {number} [now=Date.now()]
 * @returns {string} ISO timestamp
 */
export function nextBackoffTimestamp(attempts, now = Date.now()) {
  const base = 30_000 * Math.pow(2, Math.max(0, attempts - 1)); // ms
  const jitter = base * (Math.random() * 0.4 - 0.2); // ±20%
  return new Date(now + base + jitter).toISOString();
}

/**
 * G2.6 (v2.36): decide what to do with a queue record after a failed
 * delivery attempt. Pure function — returns either the updated record
 * (still in queue) or a DLQ marker (move to .forge/openbrain-dlq.jsonl).
 *
 *   maxAttempts (default 5) — after this many failures, move to DLQ.
 *
 * @param {object} record - Queue record from shapeQueueRecord
 * @param {{maxAttempts?: number, error?: string, now?: number}} [opts]
 * @returns {{action: "retry"|"dlq", record: object}}
 */
export function applyDeliveryFailure(record, opts = {}) {
  const { maxAttempts = 5, error = "unknown", now = Date.now() } = opts;
  const attempts = (record._attempts || 0) + 1;
  if (attempts >= maxAttempts) {
    return {
      action: "dlq",
      record: {
        ...record,
        _status: "failed",
        _attempts: attempts,
        _failedAt: new Date(now).toISOString(),
        _lastError: String(error).slice(0, 500),
      },
    };
  }
  return {
    action: "retry",
    record: {
      ...record,
      _status: "pending",
      _attempts: attempts,
      _lastError: String(error).slice(0, 500),
      _nextAttemptAt: nextBackoffTimestamp(attempts, now),
    },
  };
}

/**
 * G2.6 (v2.36): partition queue records into those eligible for delivery
 * right now vs those still in backoff. Pure function — caller dispatches
 * the eligible records to the actual ingestor.
 *
 * @param {Array<object>} records
 * @param {number} [now=Date.now()]
 * @returns {{ready: Array, deferred: Array}}
 */
export function partitionByBackoff(records, now = Date.now()) {
  const ready = [];
  const deferred = [];
  if (!Array.isArray(records)) return { ready, deferred };
  const cutoff = now;
  for (const r of records) {
    if (!r || r._status === "delivered" || r._status === "failed") continue;
    const next = r._nextAttemptAt ? Date.parse(r._nextAttemptAt) : 0;
    if (Number.isFinite(next) && next <= cutoff) ready.push(r);
    else deferred.push(r);
  }
  return { ready, deferred };
}

// ─── G2.8 — Capture observability ──────────────────────────────────────

/**
 * G2.8 (v2.36): build a stats record summarising a drain pass for the
 * `.forge/openbrain-stats.jsonl` ledger. Lets the dashboard show queue
 * health (delivered vs deferred vs DLQ over time) without re-reading
 * the queue file every render.
 *
 * Pure function — caller writes the result.
 *
 * @param {{attempted: number, delivered: number, deferred: number, dlq: number, durationMs: number, source?: string}} pass
 * @returns {object}
 */
export function buildDrainStatsRecord(pass) {
  return {
    _v: 1,
    timestamp: new Date().toISOString(),
    source: pass.source || "drain",
    attempted: pass.attempted | 0,
    delivered: pass.delivered | 0,
    deferred: pass.deferred | 0,
    dlq: pass.dlq | 0,
    durationMs: pass.durationMs | 0,
  };
}

// ─── G3.2 — Similarity-based dedupe ────────────────────────────────────

/**
 * G3.2 (v2.36): tokenise a string into a bag of lowercase word tokens.
 * Pure helper used by `cosineSimilarity` and `dedupeThoughtsBySimilarity`.
 *
 * @param {string} text
 * @returns {Map<string, number>} token → count
 */
export function tokenize(text) {
  const out = new Map();
  if (!text || typeof text !== "string") return out;
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
  for (const t of tokens) out.set(t, (out.get(t) || 0) + 1);
  return out;
}

/**
 * G3.2 (v2.36): cosine similarity between two token bags (0..1).
 * Pure — used to suppress near-duplicate thoughts before they land in L2/L3.
 * Uses term-frequency vectors; intentionally simple, no IDF.
 *
 * @param {string|Map<string,number>} a
 * @param {string|Map<string,number>} b
 * @returns {number} in [0, 1]
 */
export function cosineSimilarity(a, b) {
  const va = a instanceof Map ? a : tokenize(a);
  const vb = b instanceof Map ? b : tokenize(b);
  if (va.size === 0 || vb.size === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (const [, v] of va) magA += v * v;
  for (const [, v] of vb) magB += v * v;
  const smaller = va.size < vb.size ? va : vb;
  const larger = smaller === va ? vb : va;
  for (const [t, v] of smaller) {
    const w = larger.get(t);
    if (w) dot += v * w;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * G3.2 (v2.36): dedupe a batch of thoughts by cosine similarity on their
 * `content` field. Keeps the first occurrence; drops later ones whose
 * similarity to any kept thought exceeds `threshold` (default 0.9).
 *
 * Pure function — caller decides which survivors to persist.
 *
 * @param {Array<{content?: string}>} thoughts
 * @param {{threshold?: number}} [opts]
 * @returns {{kept: Array, dropped: Array<{thought: object, similarTo: object, similarity: number}>}}
 */
export function dedupeThoughtsBySimilarity(thoughts, opts = {}) {
  const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.9;
  const kept = [];
  const dropped = [];
  const vectors = [];
  if (!Array.isArray(thoughts)) return { kept, dropped };
  for (const t of thoughts) {
    if (!t || typeof t.content !== "string" || t.content.length === 0) {
      kept.push(t); // nothing to compare — pass through untouched
      vectors.push(null);
      continue;
    }
    const vec = tokenize(t.content);
    let match = null;
    let bestScore = 0;
    for (let i = 0; i < vectors.length; i++) {
      if (!vectors[i]) continue;
      const score = cosineSimilarity(vec, vectors[i]);
      if (score >= threshold && score > bestScore) {
        match = kept[i];
        bestScore = score;
      }
    }
    if (match) {
      dropped.push({ thought: t, similarTo: match, similarity: Math.round(bestScore * 1000) / 1000 });
    } else {
      kept.push(t);
      vectors.push(vec);
    }
  }
  return { kept, dropped };
}

// ─── G3.3 — Proactive search prompt for watcher anomalies ─────────────

/**
 * G3.3 (v2.36): build an OpenBrain search-instruction block tailored to a
 * watcher anomaly. The MCP tool embeds this block in its response so the
 * caller (agent) proactively asks OpenBrain for prior findings on the same
 * anomaly code before reacting — closing the "observer is amnesic" loop.
 *
 * Returns "" when projectName is falsy or the anomaly is shapeless.
 *
 * @param {{code?: string, message?: string}} anomaly
 * @param {string} projectName
 * @returns {string}
 */
export function buildWatcherSearchPrompt(anomaly, projectName) {
  if (!anomaly || !anomaly.code || !projectName) return "";
  const query = `watcher anomaly ${anomaly.code}`;
  const lines = [
    "--- PRIOR FINDINGS (OpenBrain) ---",
    `Before reacting to anomaly '${anomaly.code}', check prior occurrences:`,
    `  Use search_thoughts tool with query: "${query}", project: "${projectName}", limit: 5`,
    "If matches exist, apply their documented mitigations. If not, record this occurrence via capture_thought after investigation.",
    "--- END PRIOR FINDINGS ---",
  ];
  return lines.join("\n") + "\n";
}

// ─── G3.5 — Thought TTL / expiresAt ────────────────────────────────────

/**
 * G3.5 (v2.36): stamp an `expiresAt` field on a thought based on type.
 * Mutates-free: returns a shallow clone. Used by `captureMemory()` so
 * short-lived observations don't haunt searches forever.
 *
 *   lesson   → 365d
 *   decision → 180d
 *   gotcha   → 90d
 *   pattern  → no expiry
 *   convention → no expiry
 *   (default) 90d
 *
 * Caller-supplied `expiresAt` wins.
 *
 * @param {object} thought
 * @param {{now?: number, overrides?: Record<string, number>}} [opts]
 * @returns {object}
 */
export function stampThoughtExpiry(thought, opts = {}) {
  if (!thought || typeof thought !== "object") return thought;
  if (thought.expiresAt) return thought;
  const DAY = 24 * 60 * 60 * 1000;
  const defaults = { lesson: 365, decision: 180, gotcha: 90, pattern: null, convention: null };
  const byType = { ...defaults, ...(opts.overrides || {}) };
  const days = byType[thought.type];
  if (days == null) return thought; // no expiry
  const now = opts.now ?? Date.now();
  return { ...thought, expiresAt: new Date(now + days * DAY).toISOString() };
}

/**
 * G3.5 (v2.36): filter out thoughts whose `expiresAt` is in the past.
 * Missing/invalid `expiresAt` means never-expires.
 *
 * @param {Array<object>} thoughts
 * @param {number} [now=Date.now()]
 * @returns {Array<object>}
 */
export function filterUnexpiredThoughts(thoughts, now = Date.now()) {
  if (!Array.isArray(thoughts)) return [];
  return thoughts.filter((t) => {
    if (!t || !t.expiresAt) return true;
    const ts = Date.parse(t.expiresAt);
    return !Number.isFinite(ts) || ts > now;
  });
}

// ─── G3.6 — Capture telemetry ──────────────────────────────────────────

/**
 * G3.6 (v2.36): shape a capture-telemetry record. Every `captureMemory()`
 * call emits one of these to `.forge/telemetry/memory-captures.jsonl` so
 * we can answer "who's capturing what, and how often" without scraping
 * the memory files themselves.
 *
 * @param {{tool: string, type: string, source: string, content?: string, project?: string, deduped?: boolean}} ctx
 * @returns {object}
 */
export function buildCaptureTelemetry(ctx) {
  const contentLen = typeof ctx.content === "string" ? ctx.content.length : 0;
  return {
    _v: 1,
    timestamp: new Date().toISOString(),
    tool: ctx.tool || "unknown",
    type: ctx.type || "unknown",
    source: ctx.source || "unknown",
    project: ctx.project || null,
    contentLen,
    deduped: !!ctx.deduped,
  };
}

// ─── G3.7 — Search-result caching ──────────────────────────────────────

/**
 * G3.7 (v2.36): the MCP layer caches OpenBrain search results to
 * `.forge/memory-search-cache.jsonl` so agents don't re-query for the
 * same slice. Default TTL 1h.
 *
 * Pure helper: given a cached entry `{cachedAt, ttlMs}`, decide whether
 * it's still fresh.
 *
 * @param {{cachedAt: string|number, ttlMs?: number}} entry
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function isCacheEntryFresh(entry, now = Date.now()) {
  if (!entry || !entry.cachedAt) return false;
  const ts = typeof entry.cachedAt === "number" ? entry.cachedAt : Date.parse(entry.cachedAt);
  if (!Number.isFinite(ts)) return false;
  const ttl = typeof entry.ttlMs === "number" ? entry.ttlMs : 60 * 60 * 1000;
  return now - ts < ttl;
}

/**
 * G3.7 (v2.36): shape a cache entry. `key` should be a deterministic hash
 * of (query, project, limit) — the caller decides. We don't hash here so
 * the helper stays pure + dep-free.
 *
 * @param {{key: string, query: string, project: string, limit: number, results: Array<object>, ttlMs?: number}} ctx
 * @returns {object}
 */
export function buildCacheEntry(ctx) {
  return {
    _v: 1,
    key: ctx.key,
    query: ctx.query,
    project: ctx.project,
    limit: ctx.limit,
    results: Array.isArray(ctx.results) ? ctx.results : [],
    cachedAt: new Date().toISOString(),
    ttlMs: typeof ctx.ttlMs === "number" ? ctx.ttlMs : 60 * 60 * 1000,
  };
}

// ─── GX.4 — Source-attribution format ──────────────────────────────────

/**
 * GX.4 (v2.36): standardised source-attribution format is
 *   `<tool>` or `<tool>/<subsystem>` — e.g. `forge_watch/quorum-dissent`.
 *
 * - tool must match /^forge_[a-z_]+$/
 * - subsystem (when present) must match /^[a-z0-9_-]+$/
 *
 * Returns `{ valid: boolean, reason?: string }`.
 *
 * @param {string} source
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateSourceFormat(source) {
  if (typeof source !== "string" || source.length === 0) {
    return { valid: false, reason: "source must be a non-empty string" };
  }
  const parts = source.split("/");
  if (parts.length > 2) {
    return { valid: false, reason: "source must be '<tool>' or '<tool>/<subsystem>' (exactly one '/')" };
  }
  const [tool, subsystem] = parts;
  if (!/^forge_[a-z_]+$/.test(tool)) {
    return { valid: false, reason: `tool segment '${tool}' must match /^forge_[a-z_]+$/` };
  }
  if (subsystem !== undefined && !/^[a-z0-9_-]+$/.test(subsystem)) {
    return { valid: false, reason: `subsystem segment '${subsystem}' must match /^[a-z0-9_-]+$/` };
  }
  return { valid: true };
}

// ─── GX.3 — forge_memory_report aggregator ─────────────────────────────

function _safeStat(path) {
  try { return statSync(path); } catch { return null; }
}

function _readJsonl(path, limit = Infinity) {
  try {
    const text = readFileSync(path, "utf-8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const slice = Number.isFinite(limit) && lines.length > limit ? lines.slice(-limit) : lines;
    const out = [];
    for (const line of slice) {
      try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return out;
  } catch {
    return [];
  }
}

function _summariseFile(forgeDir, name) {
  const path = join(forgeDir, name);
  const st = _safeStat(path);
  if (!st) return { name, exists: false, size: 0, records: 0 };
  const records = _readJsonl(path);
  const versions = {};
  for (const r of records) {
    const v = r && r._v != null ? String(r._v) : "none";
    versions[v] = (versions[v] || 0) + 1;
  }
  return { name, exists: true, size: st.size, records: records.length, versions };
}

/**
 * GX.3 (v2.36): aggregate the health of every memory surface into a
 * single report — L2 files, OpenBrain queue state, drain stats trend,
 * capture telemetry, search cache. Consumed by the `forge_memory_report`
 * MCP tool (and by the dashboard Memory tab in a follow-up PR).
 *
 * Pure-ish: only reads from `.forge/` — never writes, never calls network.
 *
 * @param {string} [cwd=process.cwd()]
 * @returns {object}
 */
export function buildMemoryReport(cwd = process.cwd()) {
  const forgeDir = resolve(cwd, ".forge");
  const telemetryDir = join(forgeDir, "telemetry");
  const exists = existsSync(forgeDir);

  const l2Files = [
    "liveguard-memories.jsonl",
    "openbrain-queue.jsonl",
    "openbrain-dlq.jsonl",
    "openbrain-stats.jsonl",
    "hub-events.jsonl",
    "drift-history.jsonl",
    "incidents.jsonl",
    "regression-history.jsonl",
    "env-diff-history.jsonl",
    "memory-search-cache.jsonl",
  ].map((n) => _summariseFile(forgeDir, n));

  // Queue health (derived from openbrain-queue.jsonl)
  const queueRecords = exists ? _readJsonl(join(forgeDir, "openbrain-queue.jsonl")) : [];
  const queueBuckets = { pending: 0, delivered: 0, failed: 0, deferred: 0 };
  const now = Date.now();
  for (const r of queueRecords) {
    const status = r?._status || "pending";
    if (status === "delivered") queueBuckets.delivered++;
    else if (status === "failed") queueBuckets.failed++;
    else {
      const next = r?._nextAttemptAt ? Date.parse(r._nextAttemptAt) : 0;
      if (Number.isFinite(next) && next > now) queueBuckets.deferred++;
      else queueBuckets.pending++;
    }
  }
  const dlq = exists ? _readJsonl(join(forgeDir, "openbrain-dlq.jsonl")).length : 0;

  // Drain trend — last 20 drain passes
  const drainRecords = exists ? _readJsonl(join(forgeDir, "openbrain-stats.jsonl"), 20) : [];
  const drainTrend = {
    passes: drainRecords.length,
    lastAttempted: drainRecords.at(-1)?.attempted ?? 0,
    lastDelivered: drainRecords.at(-1)?.delivered ?? 0,
    totalDelivered: drainRecords.reduce((a, r) => a + (r.delivered | 0), 0),
    totalDeferred: drainRecords.reduce((a, r) => a + (r.deferred | 0), 0),
  };

  // Capture telemetry — last 500 records
  const telemetryPath = join(telemetryDir, "memory-captures.jsonl");
  const telemetryRecords = _readJsonl(telemetryPath, 500);
  const telemetry = {
    total: telemetryRecords.length,
    dedupedCount: telemetryRecords.filter((r) => r.deduped).length,
    byTool: {},
    byType: {},
  };
  for (const r of telemetryRecords) {
    if (r?.tool) telemetry.byTool[r.tool] = (telemetry.byTool[r.tool] || 0) + 1;
    if (r?.type) telemetry.byType[r.type] = (telemetry.byType[r.type] || 0) + 1;
  }

  // Search cache health
  const cacheRecords = exists ? _readJsonl(join(forgeDir, "memory-search-cache.jsonl")) : [];
  const uniqueKeys = new Set(cacheRecords.map((r) => r?.key).filter(Boolean));
  const freshEntries = cacheRecords.filter((r) => isCacheEntryFresh(r, now)).length;
  const cache = {
    totalEntries: cacheRecords.length,
    uniqueKeys: uniqueKeys.size,
    freshEntries,
  };

  // Orphan audit — files in .forge/ not listed in the known registry
  const knownFiles = new Set([
    "liveguard-memories.jsonl", "openbrain-queue.jsonl", "openbrain-dlq.jsonl",
    "openbrain-stats.jsonl", "hub-events.jsonl", "drift-history.jsonl",
    "incidents.jsonl", "regression-history.jsonl", "env-diff-history.jsonl",
    "memory-search-cache.jsonl", "runs",
  ]);
  const orphans = [];
  if (exists) {
    try {
      for (const entry of readdirSync(forgeDir)) {
        if (entry.startsWith(".")) continue;
        if (knownFiles.has(entry)) continue;
        if (entry === "telemetry") continue;
        // Tolerate .bak files (from migrate-memory) and directories
        if (entry.endsWith(".bak") || /\.bak-\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
        orphans.push(entry);
      }
    } catch { /* ignore */ }
  }

  return {
    _v: 1,
    timestamp: new Date().toISOString(),
    cwd,
    forgeDirExists: exists,
    l2Files,
    queue: { ...queueBuckets, dlq },
    drainTrend,
    telemetry,
    cache,
    orphans,
  };
}

// ─── GX.2 — L3 → L1 preload on plan-start ──────────────────────────────

/**
 * GX.2 (v2.36): build a "plan boot context" — a small bundle of OpenBrain
 * search hints derived from the plan itself. Emitted into the L1 hub at
 * `run-started` time so the dashboard, watchers, and the first worker
 * see prior decisions about *this plan* and *its slice domains* before
 * the first slice starts (instead of waiting until mid-slice for the
 * worker's own `search_thoughts` call).
 *
 * The hints are deterministic — the actual L3 lookup is still performed
 * by the agent (we don't have OpenBrain credentials server-side). What
 * GX.2 closes is the "no semantic context at boot" gap.
 *
 * Pure function. Returns an empty `hints` array when projectName/plan
 * are absent — caller can broadcast unconditionally.
 *
 * @param {{slices?: Array<{title?: string, name?: string}>, name?: string}} plan
 * @param {string} projectName
 * @param {{maxHints?: number}} [opts]
 * @returns {{_v: number, projectName: string, planName: string, hints: Array<{kind: string, query: string, limit: number}>}}
 */
export function buildPlanBootContext(plan, projectName, opts = {}) {
  const maxHints = typeof opts.maxHints === "number" ? opts.maxHints : 8;
  const planName = (plan && (plan.name || plan.planName)) || "";
  const out = { _v: 1, projectName: projectName || "", planName, hints: [] };
  if (!projectName || !plan) return out;

  // 1) Plan-level hint — prior runs of this exact plan
  if (planName) {
    out.hints.push({ kind: "plan-history", query: `plan ${planName}`, limit: 5 });
  }

  // 2) Slice-keyword hints — dedup by query string
  const map = loadKeywordSearchMap();
  const seen = new Set();
  const slices = Array.isArray(plan.slices) ? plan.slices : [];
  for (const slice of slices) {
    const title = (slice && (slice.title || slice.name)) || "";
    if (!title) continue;
    for (const { pattern, query } of map) {
      if (seen.has(query)) continue;
      if (pattern.test(title)) {
        out.hints.push({ kind: "slice-keyword", query, limit: 5 });
        seen.add(query);
        if (out.hints.length >= maxHints) return out;
      }
    }
  }

  return out;
}


