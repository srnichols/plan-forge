/**
 * Plan Forge — GitHub Copilot Metrics Ingestion (Phase GITHUB-D Slice 1).
 *
 * Provides three operations:
 *   - `pullMetrics`  — fetch from GitHub Copilot Metrics API via `gh api`
 *   - `writeMetrics` — persist normalized records to JSONL under storeDir
 *   - `loadMetrics`  — read merged, sorted time series back from disk
 *
 * All API calls are made through the user's existing `gh` CLI auth — no new
 * secret management needed.  Tests mock `gh` via the createMockGh helper;
 * no real Copilot Metrics API calls are made during tests.
 *
 * JSONL on-disk layout:
 *   <storeDir>/<org>/<YYYY-MM-DD>.jsonl   (one normalized record per line)
 *
 * @module github-metrics
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// ─── Error classes ──────────────────────────────────────────────────────────

export class MetricsError extends Error {
  constructor(message) {
    super(message);
    this.name = "MetricsError";
  }
}

export class MetricsAuthError extends MetricsError {
  constructor(message) {
    super(message);
    this.name = "MetricsAuthError";
  }
}

export class MetricsNotFoundError extends MetricsError {
  constructor(message) {
    super(message);
    this.name = "MetricsNotFoundError";
  }
}

export class MetricsRateLimitError extends MetricsError {
  constructor(message) {
    super(message);
    this.name = "MetricsRateLimitError";
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch Copilot metrics for an org from the GitHub Copilot Metrics API.
 *
 * @param {Object} opts
 * @param {string}  opts.org      - GitHub org slug (required)
 * @param {string}  [opts.since]  - ISO date or shorthand like "30d" (default: "30d")
 * @param {string}  [opts.until]  - ISO date or shorthand (default: today)
 * @param {string}  [opts.ghCmd]  - Path to `gh` binary (default: "gh")
 * @param {Object}  [opts.env]    - Process environment override (used in tests)
 * @returns {NormalizedRecord[]} Normalized daily records, sorted by date ascending
 * @throws {MetricsAuthError}       on 403 / missing copilot:read scope
 * @throws {MetricsNotFoundError}   on 404 / org not found
 * @throws {MetricsRateLimitError}  on 429 / API rate limit
 * @throws {MetricsError}           on other failures
 */
export function pullMetrics({ org, since, until, ghCmd = "gh", env } = {}) {
  if (!org) throw new MetricsError("org is required");

  const sinceDate = parseDateArg(since ?? "30d");
  const params = [`since=${sinceDate}`];
  if (until) params.push(`until=${parseDateArg(until)}`);

  const url = `/orgs/${encodeURIComponent(org)}/copilot/metrics?${params.join("&")}`;

  const result = spawnSync(ghCmd, ["api", url], {
    encoding: "utf-8",
    env: env ?? process.env,
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw new MetricsError(`Failed to spawn gh: ${result.error.message}`);
  }

  if (result.status !== 0) {
    raiseGhError(result, org);
  }

  let data;
  try {
    data = JSON.parse(result.stdout || "[]");
  } catch {
    throw new MetricsError(`gh api returned non-JSON output: ${result.stdout?.slice(0, 200)}`);
  }

  if (!Array.isArray(data)) {
    if (data?.message) raiseErrorBody(data, org);
    return [];
  }

  return data
    .map((raw) => normalizeRecord(raw, org))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Write normalized records to per-date JSONL files under storeDir.
 * Idempotent: existing date files are skipped (not overwritten).
 *
 * @param {NormalizedRecord[]} records
 * @param {{ storeDir: string }} opts
 * @returns {{ written: string[], skipped: string[] }}
 */
export function writeMetrics(records, { storeDir }) {
  if (!storeDir) throw new MetricsError("storeDir is required");

  const grouped = new Map();
  for (const rec of records) {
    if (!rec?.date || !rec?.org) continue;
    const key = `${rec.org}\x00${rec.date}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(rec);
  }

  const written = [];
  const skipped = [];

  for (const [key, recs] of grouped) {
    const [org, date] = key.split("\x00");
    const dir = join(storeDir, org);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${date}.jsonl`);

    if (existsSync(file)) {
      skipped.push(date);
      continue;
    }

    const content = recs.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(file, content, "utf-8");
    written.push(date);
  }

  return { written, skipped };
}

/**
 * Load normalized records from disk, merged across dates and sorted ascending.
 *
 * @param {Object} opts
 * @param {string}  opts.storeDir - Root directory for the JSONL store
 * @param {string}  opts.org      - Org slug to read
 * @param {string}  [opts.since]  - ISO date or shorthand for lower bound (inclusive)
 * @param {string}  [opts.until]  - ISO date or shorthand for upper bound (inclusive)
 * @returns {NormalizedRecord[]}
 */
export function loadMetrics({ storeDir, org, since, until } = {}) {
  if (!storeDir) throw new MetricsError("storeDir is required");
  if (!org) throw new MetricsError("org is required");

  const orgDir = join(storeDir, org);
  if (!existsSync(orgDir)) return [];

  const sinceDate = since ? parseDateArg(since) : null;
  const untilDate = until ? parseDateArg(until) : null;

  let files;
  try {
    files = readdirSync(orgDir);
  } catch {
    return [];
  }

  const filtered = files
    .filter((f) => f.endsWith(".jsonl"))
    .filter((f) => {
      const date = f.slice(0, -".jsonl".length);
      if (sinceDate && date < sinceDate) return false;
      if (untilDate && date > untilDate) return false;
      return true;
    })
    .sort();

  const records = [];
  for (const file of filtered) {
    let content;
    try {
      content = readFileSync(join(orgDir, file), "utf-8").trim();
    } catch {
      continue;
    }
    if (!content) continue;
    for (const line of content.split("\n")) {
      try {
        records.push(JSON.parse(line));
      } catch { /* skip malformed lines */ }
    }
  }

  return records.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} NormalizedRecord
 * @property {"1.0"} schema
 * @property {string} date  - ISO date string (YYYY-MM-DD)
 * @property {string} org
 * @property {number} totalActiveUsers
 * @property {number} totalEngagedUsers
 * @property {Object} codeCompletions
 * @property {number} ideChatEngagedUsers
 * @property {number} dotcomChatEngagedUsers
 * @property {number} prEngagedUsers
 */

function normalizeRecord(raw, org) {
  const completions = raw.copilot_ide_code_completions ?? {};
  const languages = (completions.languages ?? []).map((l) => ({
    name: l.name,
    engagedUsers: l.total_engaged_users ?? 0,
    suggestions: l.total_code_suggestions ?? 0,
    acceptances: l.total_code_acceptances ?? 0,
    linesSuggested: l.total_code_lines_suggested ?? 0,
    linesAccepted: l.total_code_lines_accepted ?? 0,
  }));

  const totalSuggestions = languages.reduce((s, l) => s + l.suggestions, 0);
  const totalAcceptances = languages.reduce((s, l) => s + l.acceptances, 0);

  return {
    schema: "1.0",
    date: raw.date,
    org,
    totalActiveUsers: raw.total_active_users ?? 0,
    totalEngagedUsers: raw.total_engaged_users ?? 0,
    codeCompletions: {
      totalEngagedUsers: completions.total_engaged_users ?? 0,
      totalSuggestions,
      totalAcceptances,
      acceptanceRate:
        totalSuggestions > 0
          ? Math.round((totalAcceptances / totalSuggestions) * 10000) / 10000
          : 0,
      languages,
    },
    ideChatEngagedUsers: raw.copilot_ide_chat?.total_engaged_users ?? 0,
    dotcomChatEngagedUsers: raw.copilot_dotcom_chat?.total_engaged_users ?? 0,
    prEngagedUsers: raw.copilot_dotcom_pull_requests?.total_engaged_users ?? 0,
  };
}

// ─── Date helpers ────────────────────────────────────────────────────────────

/**
 * Parse a date argument into ISO YYYY-MM-DD format.
 * Supports "Nd" shorthand (e.g. "30d") and ISO date strings.
 *
 * @param {string|Date} value
 * @returns {string} ISO date string
 */
export function parseDateArg(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const shorthand = String(value).match(/^(\d+)d$/i);
  if (shorthand) {
    const days = parseInt(shorthand[1], 10);
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

// ─── Error dispatch ─────────────────────────────────────────────────────────

function raiseGhError(result, org) {
  let body = null;
  try {
    body = JSON.parse(result.stdout || "{}");
  } catch { /* ignore */ }

  const message = body?.message ?? "";
  const status = body?.status ?? "";
  const combined = `${message} ${status} ${result.stderr ?? ""}`;

  if (/403|forbidden|copilot.*scope|scope.*copilot|required scope/i.test(combined)) {
    throw new MetricsAuthError(
      "Token lacks `copilot:read` scope. Run `gh auth refresh -s copilot:read --hostname github.com`"
    );
  }

  if (/404|not found/i.test(combined)) {
    throw new MetricsNotFoundError(`Org not found or access denied: ${org}`);
  }

  if (/429|rate.?limit/i.test(combined)) {
    const m = (result.stderr ?? "").match(/retry.?after[:\s]+(\d+)/i);
    const hint = m ? ` --retry-after ${m[1]}` : "";
    throw new MetricsRateLimitError(`Rate limit hit.${hint}`);
  }

  throw new MetricsError(
    `gh api failed (exit ${result.status}): ${message || result.stderr?.trim() || "unknown error"}`
  );
}

function raiseErrorBody(body, org) {
  raiseGhError({ status: 1, stdout: JSON.stringify(body), stderr: "" }, org);
}
