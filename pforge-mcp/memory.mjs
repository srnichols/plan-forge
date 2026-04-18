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

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Keyword patterns mapped to targeted search queries for `search_thoughts`.
 * Matched against slice titles to generate domain-specific context requests.
 */
const KEYWORD_SEARCH_MAP = [
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
    const matchedQueries = KEYWORD_SEARCH_MAP
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
