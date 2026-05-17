import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const TEAM_ACTIVITY_FILE = "team-activity.jsonl";
const TEAM_ACTIVITY_VERSION = "1.0";

function readGitConfig(cwd, key) {
  try {
    const result = spawnSync("git", ["config", key], {
      cwd,
      encoding: "utf-8",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return "";
    return (result.stdout || "").trim();
  } catch {
    return "";
  }
}

export function getOperator(cwd = process.cwd()) {
  const resolvedCwd = resolve(cwd);
  const name = readGitConfig(resolvedCwd, "user.name");
  const email = readGitConfig(resolvedCwd, "user.email");
  if (name && email) return `${name} <${email}>`;
  return name || email || "unknown";
}

function normalizeActivity(summary = {}, storeDir) {
  const resolvedStoreDir = resolve(storeDir ?? join(process.cwd(), ".forge"));
  return {
    timestamp: summary.timestamp || new Date().toISOString(),
    run_id: summary.run_id || summary.runId || null,
    plan: summary.plan ?? null,
    status: summary.status || "unknown",
    slice_count: summary.slice_count ?? summary.sliceCount ?? null,
    duration_ms: summary.duration_ms ?? summary.totalDuration ?? null,
    cost_usd: summary.cost_usd ?? summary.cost?.total_cost_usd ?? null,
    operator: summary.operator || getOperator(dirname(resolvedStoreDir)),
    version: TEAM_ACTIVITY_VERSION,
  };
}

export function recordActivity(summary, { storeDir } = {}) {
  const resolvedStoreDir = resolve(storeDir ?? join(process.cwd(), ".forge"));
  mkdirSync(resolvedStoreDir, { recursive: true });
  const record = normalizeActivity(summary, resolvedStoreDir);
  appendFileSync(join(resolvedStoreDir, TEAM_ACTIVITY_FILE), `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

export function loadActivity({ storeDir, limit = 20, since } = {}) {
  const resolvedStoreDir = resolve(storeDir ?? join(process.cwd(), ".forge"));
  const feedPath = join(resolvedStoreDir, TEAM_ACTIVITY_FILE);
  if (!existsSync(feedPath)) return [];

  let content = "";
  try {
    content = readFileSync(feedPath, "utf-8");
  } catch {
    return [];
  }

  const max = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 20;
  const sinceMs = since ? Date.parse(since) : NaN;
  const filterSince = Number.isFinite(sinceMs);

  const activities = [];
  for (const line of content.split(/\r?\n/).filter(Boolean).reverse()) {
    try {
      const entry = JSON.parse(line);
      const tsMs = Date.parse(entry?.timestamp);
      if (filterSince && (!Number.isFinite(tsMs) || tsMs < sinceMs)) continue;
      activities.push(entry);
      if (activities.length >= max) break;
    } catch {
      // Skip malformed lines to keep the shared feed resilient.
    }
  }

  return activities;
}
