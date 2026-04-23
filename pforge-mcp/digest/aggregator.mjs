/**
 * Plan Forge — Daily Digest Aggregator (Phase-38.5 Slice 1)
 *
 * Builds a structured digest covering five sections:
 *   1. probe-deltas   — lane-match regressions between two probe result sets
 *   2. aging-bugs     — meta-bugs open > 7 days
 *   3. stalled-phases — roadmap phases in-progress > 14 days
 *   4. drift-trend    — drift score drops below threshold
 *   5. cost-anomaly   — cost spikes > 2× the 7-day moving average
 *
 * Pure reader — never modifies any artifact.
 *
 * @module digest/aggregator
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";

// ─── Helpers ──────────────────────────────────────────────────────────

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function safeReadJsonl(filePath) {
  try {
    const raw = readFileSync(filePath, "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function listJsonFiles(dirPath) {
  try {
    if (!existsSync(dirPath)) return [];
    return readdirSync(dirPath)
      .filter((f) => f.endsWith(".json"))
      .map((f) => resolve(dirPath, f));
  } catch {
    return [];
  }
}

function daysBetween(a, b) {
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function isoDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// ─── Section: probe-deltas ────────────────────────────────────────────

function findProbeResultByDate(validationDir, dateStr) {
  if (!existsSync(validationDir)) return null;
  const files = readdirSync(validationDir)
    .filter((f) => f.startsWith("results-") && f.endsWith(".json"))
    .sort();

  // Find the latest result file whose timestamp matches dateStr
  const matching = files.filter((f) => f.includes(dateStr));
  if (matching.length > 0) {
    return safeReadJson(resolve(validationDir, matching[matching.length - 1]));
  }

  // Fallback: find the latest result file on or before dateStr
  const beforeOrOn = files.filter((f) => {
    const ts = f.replace("results-", "").replace(".json", "").slice(0, 10);
    return ts <= dateStr;
  });
  if (beforeOrOn.length > 0) {
    return safeReadJson(resolve(validationDir, beforeOrOn[beforeOrOn.length - 1]));
  }
  return null;
}

function computeLaneMatch(probeResults) {
  if (!Array.isArray(probeResults)) return {};
  const counts = {};
  for (const r of probeResults) {
    const expected = r.probe?.lane;
    const actual = r.classification?.lane;
    if (!expected) continue;
    if (!counts[expected]) counts[expected] = { matched: 0, total: 0 };
    counts[expected].total++;
    if (actual === expected) counts[expected].matched++;
  }
  return counts;
}

function buildProbeDeltas(projectDir, dateStr, baselineDateStr) {
  const section = { id: "probe-deltas", title: "Probe Lane-Match Deltas", severity: "info", items: [] };
  const validationDir = resolve(projectDir, ".forge", "validation");

  const current = findProbeResultByDate(validationDir, dateStr);
  const baseline = findProbeResultByDate(validationDir, baselineDateStr);

  if (!current || !baseline) return section;

  const currentCounts = computeLaneMatch(current);
  const baselineCounts = computeLaneMatch(baseline);

  const allLanes = new Set([...Object.keys(currentCounts), ...Object.keys(baselineCounts)]);
  for (const lane of allLanes) {
    const cur = currentCounts[lane] || { matched: 0, total: 0 };
    const base = baselineCounts[lane] || { matched: 0, total: 0 };
    const curRate = cur.total > 0 ? cur.matched / cur.total : 0;
    const baseRate = base.total > 0 ? base.matched / base.total : 0;
    const delta = curRate - baseRate;

    if (delta < 0) {
      section.items.push({
        lane,
        currentRate: Math.round(curRate * 100),
        baselineRate: Math.round(baseRate * 100),
        delta: Math.round(delta * 100),
      });
      section.severity = "warn";
    }
  }

  if (section.items.length === 0) section.severity = "info";
  return section;
}

// ─── Section: aging-bugs ──────────────────────────────────────────────

function buildAgingBugs(projectDir, dateStr) {
  const section = { id: "aging-bugs", title: "Aging Meta-Bugs", severity: "info", items: [] };
  const bugsDir = resolve(projectDir, ".forge", "bugs");
  const files = listJsonFiles(bugsDir);
  const now = new Date(dateStr + "T00:00:00Z");

  for (const f of files) {
    const bug = safeReadJson(f);
    if (!bug) continue;
    if (bug.status !== "open") continue;

    const created = bug.createdAt || bug.created_at || bug.timestamp;
    if (!created) continue;

    const age = daysBetween(now, new Date(created));
    if (age >= 7) {
      section.items.push({
        id: bug.id || basename(f, ".json"),
        title: bug.title || bug.summary || basename(f, ".json"),
        ageDays: Math.floor(age),
        severity: bug.severity || "medium",
      });
    }
  }

  if (section.items.length > 0) {
    section.severity = section.items.some((i) => i.ageDays > 30) ? "alert" : "warn";
  }
  return section;
}

// ─── Section: stalled-phases ──────────────────────────────────────────

function parseRoadmapPhases(projectDir) {
  const candidates = [
    resolve(projectDir, "docs", "plans", "DEPLOYMENT-ROADMAP.md"),
    resolve(projectDir, "ROADMAP.md"),
  ];

  for (const roadmapPath of candidates) {
    if (!existsSync(roadmapPath)) continue;
    try {
      const content = readFileSync(roadmapPath, "utf-8");
      return extractInProgressPhases(content);
    } catch {
      continue;
    }
  }
  return [];
}

function extractInProgressPhases(content) {
  const phases = [];
  // Match patterns like "Phase-NN" or "v2.XX.X" with "in-progress" or "In flight" or similar markers
  const lines = content.split("\n");
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("in-progress") || lower.includes("in flight") || lower.includes("in progress")) {
      // Try to extract phase reference and date
      const phaseMatch = line.match(/Phase[- ]?([\d.]+\S*)/i);
      const dateMatch = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
      const versionMatch = line.match(/v(\d+\.\d+(?:\.\d+)?)/);

      phases.push({
        name: phaseMatch ? `Phase-${phaseMatch[1]}` : (versionMatch ? `v${versionMatch[1]}` : line.trim().slice(0, 80)),
        startDate: dateMatch ? dateMatch[1] : null,
        raw: line.trim(),
      });
    }
  }
  return phases;
}

function buildStalledPhases(projectDir, dateStr) {
  const section = { id: "stalled-phases", title: "Stalled Phases", severity: "info", items: [] };
  const now = new Date(dateStr + "T00:00:00Z");
  const phases = parseRoadmapPhases(projectDir);

  for (const phase of phases) {
    if (!phase.startDate) continue;
    const start = new Date(phase.startDate + "T00:00:00Z");
    const age = daysBetween(now, start);

    if (age >= 14) {
      section.items.push({
        name: phase.name,
        startDate: phase.startDate,
        ageDays: Math.floor(age),
      });
    }
  }

  if (section.items.length > 0) {
    section.severity = section.items.some((i) => i.ageDays > 30) ? "alert" : "warn";
  }
  return section;
}

// ─── Section: drift-trend ─────────────────────────────────────────────

function buildDriftTrend(projectDir, dateStr, opts = {}) {
  const threshold = opts.driftThreshold ?? 15;
  const section = { id: "drift-trend", title: "Drift Trend", severity: "info", items: [] };
  const driftPath = resolve(projectDir, ".forge", "drift-history.json");
  const entries = safeReadJsonl(driftPath);
  if (entries.length === 0) return section;

  // Find entries on or before dateStr
  const relevant = entries.filter((e) => {
    const ts = (e.timestamp || "").slice(0, 10);
    return ts <= dateStr;
  });

  if (relevant.length === 0) return section;

  const latest = relevant[relevant.length - 1];
  if (typeof latest.score === "number" && latest.score > threshold) {
    section.items.push({
      score: latest.score,
      threshold,
      trend: latest.trend || "unknown",
      timestamp: latest.timestamp,
      violationCount: Array.isArray(latest.violations) ? latest.violations.length : 0,
    });
    section.severity = latest.score > threshold * 2 ? "alert" : "warn";
  }

  return section;
}

// ─── Section: cost-anomaly ────────────────────────────────────────────

function buildCostAnomaly(projectDir, dateStr) {
  const section = { id: "cost-anomaly", title: "Cost Anomaly", severity: "info", items: [] };
  const costPath = resolve(projectDir, ".forge", "cost-history.json");
  const entries = safeReadJson(costPath);
  if (!Array.isArray(entries) || entries.length === 0) return section;

  // Sort by date ascending
  const sorted = [...entries]
    .filter((e) => e.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Filter entries on or before dateStr
  const relevant = sorted.filter((e) => (e.date || "").slice(0, 10) <= dateStr);
  if (relevant.length === 0) return section;

  const latest = relevant[relevant.length - 1];
  const latestDate = (latest.date || "").slice(0, 10);

  // Compute 7-day moving average (entries before latest)
  const sevenDayAgo = new Date(latestDate + "T00:00:00Z");
  sevenDayAgo.setDate(sevenDayAgo.getDate() - 7);
  const sevenDayStr = isoDate(sevenDayAgo);

  const windowEntries = relevant.filter((e) => {
    const d = (e.date || "").slice(0, 10);
    return d >= sevenDayStr && d < latestDate;
  });

  if (windowEntries.length === 0) return section;

  const avgCost = windowEntries.reduce((sum, e) => sum + (e.total_cost_usd || 0), 0) / windowEntries.length;
  const latestCost = latest.total_cost_usd || 0;

  if (avgCost > 0 && latestCost > avgCost * 2) {
    section.items.push({
      latestCost: Math.round(latestCost * 100) / 100,
      averageCost: Math.round(avgCost * 100) / 100,
      multiplier: Math.round((latestCost / avgCost) * 10) / 10,
      plan: latest.plan || "unknown",
      date: latestDate,
    });
    section.severity = latestCost > avgCost * 5 ? "alert" : "warn";
  }

  return section;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Build the daily digest for a project.
 *
 * @param {object} opts
 * @param {string} opts.projectDir - Project root directory
 * @param {string} opts.date       - ISO date string (YYYY-MM-DD) for the digest
 * @param {string} opts.baselineDate - ISO date string for probe comparison baseline
 * @param {object} [opts.thresholds] - Optional thresholds override
 * @returns {{ sections: Array<{id: string, title: string, severity: string, items: any[]}>, generatedAt: string }}
 */
export function buildDigest({ projectDir, date, baselineDate, thresholds = {} }) {
  const dateStr = isoDate(date);
  const baselineDateStr = baselineDate ? isoDate(baselineDate) : dateStr;

  const sections = [
    buildProbeDeltas(projectDir, dateStr, baselineDateStr),
    buildAgingBugs(projectDir, dateStr),
    buildStalledPhases(projectDir, dateStr),
    buildDriftTrend(projectDir, dateStr, { driftThreshold: thresholds.drift }),
    buildCostAnomaly(projectDir, dateStr),
  ];

  return {
    sections,
    generatedAt: new Date().toISOString(),
  };
}
