/**
 * Plan Forge — Team Dashboard (Phase-TEAM-DASHBOARD, v3.4.0)
 *
 * Server-side aggregation for the multi-developer plan coordination dashboard.
 * Reads team-activity.jsonl, groups by operator, computes per-developer stats,
 * and detects coordination risk when multiple developers are concurrently active.
 *
 * Exports:
 *   aggregateTeamActivity(activities)             → per-operator stats array
 *   detectConflictRisk(operators)                 → { level, active_count, message }
 *   buildTeamDashboard({ storeDir, limit, since }) → full dashboard payload
 */

import { loadActivity } from "../team-activity.mjs";

const RECENT_WINDOW_MS = 8 * 60 * 60 * 1000; // 8 hours for conflict detection

/**
 * Group a flat activity array by operator and compute per-developer stats.
 * @param {Array} activities  — from loadActivity(), newest-first
 * @returns {Array} operators sorted by last_active descending
 */
export function aggregateTeamActivity(activities) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const byOp = new Map();

  for (const a of activities) {
    const key = a.operator || "unknown";
    if (!byOp.has(key)) {
      byOp.set(key, {
        operator: key,
        last_active: null,
        runs_total: 0,
        runs_today: 0,
        runs_completed: 0,
        runs_failed: 0,
        total_cost_usd: 0,
        recent_plans: [],
      });
    }

    const entry = byOp.get(key);
    const ts = new Date(a.timestamp);

    entry.runs_total++;

    if (!entry.last_active || ts > new Date(entry.last_active)) {
      entry.last_active = a.timestamp;
    }

    if (ts >= todayStart) entry.runs_today++;

    if (a.status === "completed") entry.runs_completed++;
    else if (a.status === "failed" || a.status === "aborted") entry.runs_failed++;

    if (a.cost_usd) entry.total_cost_usd += Number(a.cost_usd);

    if (a.plan && !entry.recent_plans.includes(a.plan) && entry.recent_plans.length < 3) {
      entry.recent_plans.push(a.plan);
    }
  }

  return Array.from(byOp.values())
    .sort((a, b) => {
      const aMs = a.last_active ? Date.parse(a.last_active) : 0;
      const bMs = b.last_active ? Date.parse(b.last_active) : 0;
      return bMs - aMs;
    })
    .map((e) => ({
      ...e,
      total_cost_usd: Math.round(e.total_cost_usd * 100) / 100,
    }));
}

/**
 * Compute coordination risk level based on how many operators have been
 * active within the RECENT_WINDOW_MS window.
 * @param {Array} operators — output of aggregateTeamActivity()
 * @returns {{ level: string, active_count: number, message: string }}
 */
export function detectConflictRisk(operators) {
  const now = Date.now();
  const recentlyActive = operators.filter(
    (op) => op.last_active && now - Date.parse(op.last_active) < RECENT_WINDOW_MS
  );
  const count = recentlyActive.length;

  if (count >= 3) {
    return {
      level: "high",
      active_count: count,
      message: `${count} developers active in the last 8 h — high coordination risk. Sync before starting new plan runs.`,
    };
  }
  if (count === 2) {
    return {
      level: "medium",
      active_count: count,
      message: `${count} developers active in the last 8 h — coordinate before overlapping plan runs.`,
    };
  }
  if (count === 1) {
    return {
      level: "low",
      active_count: count,
      message: "Single developer active — no coordination needed.",
    };
  }
  return {
    level: "none",
    active_count: 0,
    message: "No recent activity in the last 8 h.",
  };
}

/**
 * Build the full team-dashboard payload.
 * @param {{ storeDir?: string, limit?: number, since?: string }} opts
 * @returns {{ ok, operators, conflict_risk, summary, message }}
 */
export function buildTeamDashboard({ storeDir, limit = 50, since } = {}) {
  const activities = loadActivity({ storeDir, limit, since });
  const operators = aggregateTeamActivity(activities);
  const conflict_risk = detectConflictRisk(operators);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayActivities = activities.filter((a) => new Date(a.timestamp) >= todayStart);
  const completedToday = todayActivities.filter((a) => a.status === "completed").length;
  const active24h = operators.filter(
    (op) => op.last_active && Date.now() - Date.parse(op.last_active) < 24 * 60 * 60 * 1000
  ).length;
  const totalCost = Math.round(operators.reduce((s, op) => s + op.total_cost_usd, 0) * 100) / 100;

  return {
    ok: true,
    operators,
    conflict_risk,
    summary: {
      total_runs_today: todayActivities.length,
      active_operators: active24h,
      total_cost_usd: totalCost,
      success_rate:
        todayActivities.length > 0
          ? Math.round((completedToday / todayActivities.length) * 100)
          : null,
    },
    message:
      operators.length > 0
        ? `${operators.length} developer(s) tracked. ${conflict_risk.message}`
        : "No team activity recorded yet. Activity appears after the first plan run.",
  };
}
