/**
 * Plan Forge — Phase-53 (ORCHESTRATOR-SPLIT) S7: review-watcher sub-module
 *
 * Read-only watcher and review-queue state readers extracted from orchestrator.mjs:
 * run discovery, event parsing, snapshot building, home dashboard aggregation,
 * anomaly detection, recommendation engine, and slice complexity scoring.
 *
 * Private helpers (readForgeJsonl, listReviewItems) are included here as
 * unexported copies; they will be deduplicated in a later slice when
 * their own sub-modules land.
 */

import {
  readFileSync, existsSync, readdirSync, statSync, mkdirSync,
} from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { compareSliceIds } from "./plan-parser.mjs";
import { recall as brainRecall } from "../brain.mjs";
import {
  readTemperingState,
  TEMPERING_SCAN_STALE_DAYS,
} from "../tempering.mjs";

// ─── Private helpers ──────────────────────────────────────────────────
// These mirror the public implementations in orchestrator.mjs and will be
// removed when the corresponding sub-modules are extracted (Phase-53 S8+).

function readForgeJsonl(filePath, defaultValue = [], cwd = process.cwd()) {
  const fullPath = resolve(cwd, ".forge", filePath);
  try {
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8")
        .split("\n")
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }
    if (filePath.endsWith(".jsonl")) {
      const legacy = resolve(cwd, ".forge", filePath.slice(0, -1));
      if (existsSync(legacy)) {
        return readFileSync(legacy, "utf-8")
          .split("\n")
          .filter(line => line.trim())
          .map(line => JSON.parse(line));
      }
    }
    return defaultValue;
  } catch { return defaultValue; }
}

function listReviewItems(targetPath, filters = {}) {
  const dir = resolve(targetPath, ".forge", "review-queue");
  if (!existsSync(dir)) return [];

  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch { return []; }

  const items = [];
  for (const file of entries) {
    try {
      const raw = readFileSync(resolve(dir, file), "utf-8");
      const item = JSON.parse(raw);
      if (filters.status && item.status !== filters.status) continue;
      if (filters.source && item.source !== filters.source) continue;
      if (filters.severity && item.severity !== filters.severity) continue;
      if (filters.correlationId && item.correlationId !== filters.correlationId) continue;
      items.push(item);
    } catch { /* skip corrupt */ }
  }

  items.sort((a, b) => {
    const ta = a.createdAt || "";
    const tb = b.createdAt || "";
    return tb.localeCompare(ta);
  });

  const cursor = typeof filters.cursor === "number" && filters.cursor > 0 ? filters.cursor : 0;
  const limit = Math.min(Math.max(typeof filters.limit === "number" ? filters.limit : 50, 1), 500);
  return items.slice(cursor, cursor + limit);
}

// ─── Run Discovery ────────────────────────────────────────────────────

/**
 * Discover the most recent run directory under <targetPath>/.forge/runs/.
 * @param {string} targetPath - Absolute path to the project being watched
 * @param {string|null} [runId=null] - Specific run dir name; null = newest
 * @returns {{ runDir: string, runId: string } | null}
 */
export function findLatestRun(targetPath, runId = null) {
  const runsDir = resolve(targetPath, ".forge", "runs");
  if (!existsSync(runsDir)) return null;
  if (runId) {
    const explicit = resolve(runsDir, runId);
    return existsSync(explicit) ? { runDir: explicit, runId } : null;
  }
  let entries;
  try { entries = readdirSync(runsDir, { withFileTypes: true }); } catch { return null; }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (dirs.length === 0) return null;
  const latest = dirs[dirs.length - 1];
  return { runDir: resolve(runsDir, latest), runId: latest };
}

// ─── Event Parsing ────────────────────────────────────────────────────

/**
 * Parse a single events.log line into a structured entry.
 * @param {string} line
 * @returns {{ ts: string, type: string, data: object, source: string|null, security_risk: string|null } | null}
 */
export function parseEventLine(line) {
  const m = line.match(/^\[([^\]]+)\]\s+([a-z-]+):\s*(.*)$/);
  if (!m) return null;
  let data = {};
  try { data = JSON.parse(m[3] || "{}"); } catch { /* keep empty */ }
  return {
    ts: m[1],
    type: m[2],
    data,
    source: data.source ?? null,
    security_risk: data.security_risk ?? null,
  };
}

/**
 * Parse events.log into structured entries.
 * @param {string} runDir
 * @returns {Array<{ ts: string, type: string, data: object, source: string|null, security_risk: string|null }>}
 */
export function parseEventsLog(runDir) {
  const logPath = resolve(runDir, "events.log");
  if (!existsSync(logPath)) return [];
  const events = [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    for (const line of raw.split("\n")) {
      const parsed = parseEventLine(line);
      if (parsed) events.push(parsed);
    }
  } catch { /* ignore */ }
  return events;
}

// ─── Slice Artifacts ──────────────────────────────────────────────────

/**
 * Read all slice-*.json artifacts in a run directory.
 * @param {string} runDir
 * @returns {Array<object>}
 */
export function readSliceArtifacts(runDir) {
  const artifacts = [];
  let entries;
  try { entries = readdirSync(runDir); } catch { return artifacts; }
  for (const name of entries) {
    const m = name.match(/^slice-([\d.]+[A-Za-z]?)\.json$/i);
    if (!m) continue;
    try {
      const data = JSON.parse(readFileSync(resolve(runDir, name), "utf-8"));
      artifacts.push({ sliceNumber: m[1], ...data });
    } catch { /* skip malformed */ }
  }
  return artifacts.sort((a, b) => compareSliceIds(a.sliceNumber, b.sliceNumber));
}

// ─── Run State ────────────────────────────────────────────────────────

/**
 * Map raw event types to a normalized runState taxonomy.
 * @param {string|null} eventType
 * @param {boolean} hasStarted
 * @returns {"completed"|"aborted"|"in-progress"|"unknown"}
 */
export function normalizeRunState(eventType, hasStarted) {
  if (eventType === "run-completed") return "completed";
  if (eventType === "run-aborted") return "aborted";
  if (hasStarted) return "in-progress";
  return "unknown";
}

// ─── Crucible State ───────────────────────────────────────────────────

/**
 * Stall cutoff shared with `pforge smith`.
 */
export const CRUCIBLE_STALL_CUTOFF_DAYS = 7;

/**
 * Read the Crucible funnel state for a watched project.
 * Returns null when `.forge/crucible/` doesn't exist.
 * @param {string} targetPath
 * @returns {object|null}
 */
export function readCrucibleState(targetPath) {
  const dir = resolve(targetPath, ".forge", "crucible");
  if (!existsSync(dir)) return null;

  const counts = { total: 0, in_progress: 0, finalized: 0, abandoned: 0, other: 0 };
  let oldestInProgressMs = null;
  let staleInProgress = 0;
  const cutoffMs = Date.now() - CRUCIBLE_STALL_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch { return null; }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (entry.name === "config.json" || entry.name === "phase-claims.json") continue;

    const fullPath = resolve(dir, entry.name);
    counts.total++;
    let status = "other";
    let mtime = 0;
    try {
      const raw = readFileSync(fullPath, "utf-8");
      const smelt = JSON.parse(raw);
      status = typeof smelt.status === "string" ? smelt.status : "other";
      mtime = statSync(fullPath).mtimeMs;
    } catch {
      counts.other++;
      continue;
    }

    if (status === "in_progress") {
      counts.in_progress++;
      if (oldestInProgressMs === null || mtime < oldestInProgressMs) {
        oldestInProgressMs = mtime;
      }
      if (mtime < cutoffMs) staleInProgress++;
    } else if (status === "finalized") {
      counts.finalized++;
    } else if (status === "abandoned") {
      counts.abandoned++;
    } else {
      counts.other++;
    }
  }

  // Orphan-handoff detection
  const orphanHandoffs = [];
  const hubEventsPath = resolve(targetPath, ".forge", "hub-events.jsonl");
  if (existsSync(hubEventsPath)) {
    try {
      const lines = readFileSync(hubEventsPath, "utf-8").trim().split("\n");
      for (const line of lines) {
        if (!line || !line.includes("crucible-handoff-to-hardener")) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.type !== "crucible-handoff-to-hardener") continue;
          const planPath = ev.data?.planPath;
          if (!planPath) continue;
          const abs = isAbsolute(planPath) ? planPath : resolve(targetPath, planPath);
          if (!existsSync(abs)) {
            orphanHandoffs.push({
              crucibleId: ev.data?.id || null,
              phaseName: ev.data?.phaseName || null,
              planPath,
              ts: ev.ts || null,
            });
          }
        } catch { /* skip malformed line */ }
      }
    } catch { /* unreadable hub log */ }
  }

  return {
    counts,
    oldestInProgressAgeMs: oldestInProgressMs !== null ? Date.now() - oldestInProgressMs : null,
    staleInProgress,
    stallCutoffDays: CRUCIBLE_STALL_CUTOFF_DAYS,
    orphanHandoffs,
  };
}

// ─── Review Queue State ───────────────────────────────────────────────

/**
 * Read aggregated state of the review queue.
 * @param {string} targetPath
 * @returns {object|null}
 */
export function readReviewQueueState(targetPath) {
  const dir = resolve(targetPath, ".forge", "review-queue");
  if (!existsSync(dir)) return null;

  let entries = [];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch { return null; }

  const state = {
    total: 0, open: 0, resolved: 0, deferred: 0,
    lastActivityTs: null,
    bySeverity: { blocker: 0, high: 0, medium: 0, low: 0 },
    bySource: {},
  };

  for (const file of entries) {
    try {
      const raw = readFileSync(resolve(dir, file), "utf-8");
      const item = JSON.parse(raw);
      state.total++;
      if (item.status === "open") state.open++;
      else if (item.status === "resolved") state.resolved++;
      else if (item.status === "deferred") state.deferred++;

      if (item.severity && state.bySeverity[item.severity] !== undefined) {
        state.bySeverity[item.severity]++;
      }
      if (item.source) {
        state.bySource[item.source] = (state.bySource[item.source] || 0) + 1;
      }

      const ts = item.resolvedAt || item.createdAt;
      if (ts && (!state.lastActivityTs || ts > state.lastActivityTs)) {
        state.lastActivityTs = ts;
      }
    } catch {
      console.warn(`[review-queue] skipping corrupt file in state reader: ${file}`);
    }
  }

  return state;
}

// ─── Watch Snapshot ───────────────────────────────────────────────────

/**
 * Build a structured snapshot of the watched run's current state.
 * Cheap to build — pure file reads, no AI calls.
 *
 * @param {string} targetPath - Absolute path to project being watched
 * @param {string|null} runId - Specific run dir, null for latest
 * @param {object} [opts]
 * @param {number} [opts.tailEvents=25] - Number of trailing events to include (1..200)
 * @param {string|null} [opts.sinceTimestamp=null] - ISO timestamp; only events strictly after this are included in diff fields
 * @returns {object} Snapshot object
 */
export async function buildWatchSnapshot(targetPath, runId = null, opts = {}) {
  const tailEventsRaw = Number.isFinite(opts.tailEvents) ? opts.tailEvents : 25;
  const tailEvents = Math.min(200, Math.max(1, Math.floor(tailEventsRaw)));
  const sinceTimestamp = opts.sinceTimestamp || null;

  const located = findLatestRun(targetPath, runId);
  if (!located) {
    return { ok: false, error: `No run directory found under ${targetPath}/.forge/runs/`, targetPath };
  }
  const events = parseEventsLog(located.runDir);
  const artifacts = readSliceArtifacts(located.runDir);

  // Read summary.json if present (means run completed)
  let summary = null;
  const summaryPath = resolve(located.runDir, "summary.json");
  if (existsSync(summaryPath)) {
    try { summary = JSON.parse(readFileSync(summaryPath, "utf-8")); } catch { /* ignore */ }
  }

  // Compute live status from events
  const runStarted = events.find((e) => e.type === "run-started");
  const runCompleted = events.find((e) => e.type === "run-completed" || e.type === "run-aborted");
  const sliceStarted = events.filter((e) => e.type === "slice-started");
  const sliceCompleted = events.filter((e) => e.type === "slice-completed");
  const sliceFailed = events.filter((e) => e.type === "slice-failed");
  const sliceEscalated = events.filter((e) => e.type === "slice-escalated");
  const quorumDispatched = events.filter((e) => e.type === "quorum-dispatch-started");
  const quorumLegsCompleted = events.filter((e) => e.type === "quorum-leg-completed");
  const quorumReviewed = events.filter((e) => e.type === "quorum-review-completed");
  const skillsStarted = events.filter((e) => e.type === "skill-started");
  const skillsCompleted = events.filter((e) => e.type === "skill-completed");
  const skillStepsFailed = events.filter((e) =>
    e.type === "skill-step-completed" && e.data?.status && e.data.status !== "passed" && e.data.status !== "completed"
  );

  const lastEvent = events[events.length - 1] || null;
  const lastEventAgeMs = lastEvent ? Date.now() - new Date(lastEvent.ts).getTime() : null;
  const runState = normalizeRunState(runCompleted?.type || null, Boolean(runStarted));

  // v2.35 diff support: events strictly after sinceTimestamp
  let newEvents = [];
  let hasNewEvents = false;
  if (sinceTimestamp) {
    const cutoffMs = new Date(sinceTimestamp).getTime();
    if (Number.isFinite(cutoffMs)) {
      newEvents = events.filter((e) => new Date(e.ts).getTime() > cutoffMs);
      hasNewEvents = newEvents.length > 0;
    }
  }

  return {
    ok: true,
    targetPath,
    runId: located.runId,
    runDir: located.runDir,
    runState,
    lastEventType: runCompleted?.type || (runStarted ? "run-started" : null),
    plan: runStarted?.data?.plan || null,
    model: runStarted?.data?.model || null,
    sliceCount: runStarted?.data?.sliceCount || null,
    counts: {
      started: sliceStarted.length,
      completed: sliceCompleted.length,
      failed: sliceFailed.length,
      escalated: sliceEscalated.length,
      quorumDispatched: quorumDispatched.length,
      quorumLegsCompleted: quorumLegsCompleted.length,
      quorumReviewed: quorumReviewed.length,
      skillsStarted: skillsStarted.length,
      skillsCompleted: skillsCompleted.length,
      skillStepsFailed: skillStepsFailed.length,
      events: events.length,
      artifacts: artifacts.length,
    },
    lastEvent,
    lastEventAgeMs,
    cursor: lastEvent?.ts || null,
    sinceTimestamp,
    hasNewEvents,
    newEventsCount: newEvents.length,
    summary,
    artifacts: artifacts.map((a) => ({
      sliceNumber: a.sliceNumber,
      title: a.title || a.slice?.title || null,
      status: a.status || null,
      attempts: a.attempts || null,
      duration: a.duration || null,
      worker: a.worker || null,
      model: a.model || null,
      tokensIn: a.tokens?.tokens_in ?? null,
      tokensOut: a.tokens?.tokens_out ?? null,
      gateError: a.gateError || null,
    })),
    tailEvents,
    events: events.slice(-tailEvents),
    crucible: readCrucibleState(targetPath),
    tempering: readTemperingState(targetPath),
    home: await (async () => {
      try {
        const snap = await readHomeSnapshot(targetPath, { activityTail: 0 });
        if (!snap.ok) return null;
        const q = snap.quadrants;
        const inFlightRuns    = q.activeRuns?.inFlight    ?? null;
        const openIncidents   = q.liveguard?.openIncidents ?? null;
        const openBugs        = q.tempering?.openBugs      ?? null;
        if (inFlightRuns === null && openIncidents === null && openBugs === null) return null;
        return { inFlightRuns, openIncidents, openBugs };
      } catch { return null; }
    })(),
    reviewQueue: (() => {
      try {
        const rqState = readReviewQueueState(targetPath);
        if (!rqState) return null;
        const blockerItems = listReviewItems(targetPath, { status: "open", severity: "blocker", limit: 500 });
        const oldestBlockerAge = blockerItems.reduce((max, it) => {
          const age = Date.now() - new Date(it.createdAt).getTime();
          return age > max ? age : max;
        }, 0);
        return { open: rqState.open ?? 0, blockerAgeMs: oldestBlockerAge || null };
      } catch { return null; }
    })(),
    notifications: (() => {
      try {
        const nowMs = Date.now();
        const hourAgo = nowMs - 3_600_000;
        const todayStr = new Date().toISOString().slice(0, 10);
        let sentToday = 0, failedToday = 0, failedLastHour = 0;
        let failingAdapter = null;
        const adapterFailCounts = {};
        for (const ev of events) {
          if (!ev.ts) continue;
          const evMs = new Date(ev.ts).getTime();
          const evDate = ev.ts.slice(0, 10);
          if (ev.type === "notification-sent" && evDate === todayStr) sentToday++;
          if (ev.type === "notification-send-failed") {
            if (evDate === todayStr) failedToday++;
            if (evMs >= hourAgo) {
              failedLastHour++;
              const adName = ev.data?.adapter || "unknown";
              adapterFailCounts[adName] = (adapterFailCounts[adName] || 0) + 1;
            }
          }
        }
        for (const [ad, count] of Object.entries(adapterFailCounts)) {
          if (!failingAdapter || count > (adapterFailCounts[failingAdapter] || 0)) failingAdapter = ad;
        }
        if (sentToday === 0 && failedToday === 0 && failedLastHour === 0) return null;
        return { sentToday, failedToday, failedLastHour, failingAdapter };
      } catch { return null; }
    })(),
  };
}

// ─── Home Snapshot ────────────────────────────────────────────────────

function clampActivityTail(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 25;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

async function buildCrucibleQuadrant(root) {
  try {
    const state = await brainRecall("project.crucible.state", {}, {
      cwd: root, readCrucibleState,
    });
    if (!state) return null;
    return {
      total: state.counts.total ?? 0,
      finalized: state.counts.finalized ?? 0,
      stalled: state.staleInProgress ?? 0,
      lastActivity: null,
    };
  } catch { return null; }
}

async function buildActiveRunsQuadrant(root) {
  try {
    const located = await brainRecall("project.run.latest", {}, {
      cwd: root, findLatestRun,
    });
    if (!located) return null;
    const events = parseEventsLog(located.runDir);
    if (events.length === 0) return null;

    let runState = "pending";
    let hasStarted = false;
    for (const ev of events) {
      if (ev.type === "run-started") hasStarted = true;
      runState = normalizeRunState(ev.type, hasStarted);
    }

    let lastSliceOutcome = null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "slice-completed") { lastSliceOutcome = "pass"; break; }
      if (events[i].type === "slice-failed") { lastSliceOutcome = "fail"; break; }
    }

    const lastTs = new Date(events[events.length - 1].ts).getTime();
    const result = {
      inFlight: runState === "in-progress" ? 1 : 0,
      lastSliceOutcome,
      lastRunId: located.runId,
      lastRunAgeMs: Date.now() - lastTs,
    };

    try {
      const rqState = await brainRecall("project.review.counts", {}, {
        cwd: root, readReviewQueueState,
      });
      result.openReviews = rqState?.open ?? 0;
    } catch { result.openReviews = 0; }

    try {
      const gatePassed = events.filter((e) => e.type === "gate-passed").length;
      const gateBlocked = events.filter((e) => e.type === "gate-blocked").length;
      const gateFailOpen = events.filter((e) => e.type === "gate-passed" && e.failOpen).length;
      result.gateChecks = { passed: gatePassed, blocked: gateBlocked, failOpen: gateFailOpen };
    } catch { result.gateChecks = null; }

    return result;
  } catch { return null; }
}

async function buildLiveguardQuadrant(root) {
  try {
    const brainDeps = { cwd: root, readForgeJsonl };
    const driftHistory = await brainRecall("project.liveguard.drift", {}, brainDeps) || [];
    const incidents = await brainRecall("project.liveguard.incidents", {}, brainDeps) || [];
    const fixProposals = await brainRecall("project.liveguard.fix-proposals", {}, brainDeps) || [];

    const lastDrift = driftHistory.length > 0 ? driftHistory[driftHistory.length - 1] : null;
    const driftScore = lastDrift?.score ?? null;
    const openIncidents = incidents.filter(i => !i.resolvedAt).length;
    const openFixProposals = fixProposals.filter(
      fp => fp.status !== "validated" && fp.status !== "rejected"
    ).length;
    const lastDriftAgeMs = lastDrift?.timestamp
      ? Date.now() - new Date(lastDrift.timestamp).getTime()
      : null;

    if (driftScore === null && openIncidents === 0 && openFixProposals === 0 && lastDriftAgeMs === null) {
      return null;
    }

    return { driftScore, openIncidents, openFixProposals, lastDriftAgeMs };
  } catch { return null; }
}

async function buildTemperingQuadrant(root) {
  try {
    const state = await brainRecall("project.tempering.state", {}, {
      cwd: root, readTemperingState,
    });
    if (!state) return null;
    const coverageStatus = state.stale
      ? "stale"
      : state.latestRunVerdict === "fail" ? "failing" : "ok";
    return {
      coverageStatus,
      openBugs: state.openBugCount?.total ?? 0,
      lastScanAgeMs: state.latestScanAgeMs ?? null,
    };
  } catch { return null; }
}

function buildActivityFeed(root, tail, cursor = null) {
  const hubPath = resolve(root, ".forge", "hub-events.jsonl");
  if (!existsSync(hubPath)) {
    return { entries: [], hasMore: false, nextCursor: null, totalLines: 0 };
  }

  let lines;
  try {
    lines = readFileSync(hubPath, "utf-8").split("\n").filter(Boolean);
  } catch {
    return { entries: [], hasMore: false, nextCursor: null, totalLines: 0 };
  }

  const all = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const ev = JSON.parse(lines[i]);
      all.push({
        type: ev.type ?? null,
        timestamp: ev.ts ?? ev.timestamp ?? null,
        correlationId: ev.correlationId ?? ev.data?.correlationId ?? null,
        summary: ev.summary ?? ev.data?.summary ?? null,
      });
    } catch { /* skip malformed */ }
  }

  let pool = all;
  if (cursor) {
    const cursorTs = new Date(cursor).getTime();
    if (Number.isFinite(cursorTs)) {
      pool = all.filter(e => {
        const ts = new Date(e.timestamp).getTime();
        return Number.isFinite(ts) && ts < cursorTs;
      });
    }
  }

  const entries = pool.slice(0, tail);
  const hasMore = pool.length > tail;
  const nextCursor = hasMore && entries.length > 0
    ? entries[entries.length - 1].timestamp
    : null;

  return { entries, hasMore, nextCursor, totalLines: all.length };
}

/**
 * Read-only aggregated snapshot of the four shop-floor subsystems
 * (Crucible, active runs, LiveGuard, Tempering) plus a trimmed activity feed.
 *
 * @param {string} targetPath - Project root (absolute)
 * @param {object} [opts]
 * @param {number} [opts.activityTail=25] - Recent hub events to include (clamped 1..200)
 * @param {string} [opts.drill] - If set, return only the named quadrant
 * @param {string|null} [opts.activityCursor=null] - ISO timestamp; return entries strictly older
 * @returns {Promise<object>} Snapshot
 */
export async function readHomeSnapshot(targetPath, opts = {}) {
  const activityTail = clampActivityTail(opts.activityTail);
  const drill = typeof opts.drill === "string" ? opts.drill : null;
  const cursor = opts.activityCursor || null;
  try {
    if (drill) {
      const result = {
        ok: true,
        targetPath,
        generatedAt: new Date().toISOString(),
        drill,
      };
      switch (drill) {
        case "crucible":
          result.quadrant = await buildCrucibleQuadrant(targetPath);
          break;
        case "activeRuns":
          result.quadrant = await buildActiveRunsQuadrant(targetPath);
          break;
        case "liveguard":
          result.quadrant = await buildLiveguardQuadrant(targetPath);
          break;
        case "tempering":
          result.quadrant = await buildTemperingQuadrant(targetPath);
          break;
        case "activity": {
          const feed = buildActivityFeed(targetPath, activityTail, cursor);
          result.activityFeed = feed.entries;
          result.activityPagination = {
            hasMore: feed.hasMore,
            nextCursor: feed.nextCursor,
            totalLines: feed.totalLines,
          };
          break;
        }
        default:
          return {
            ok: false,
            targetPath,
            error: `Unknown drill target: '${drill}'. Valid: crucible, activeRuns, liveguard, tempering, activity.`,
          };
      }
      return result;
    }

    const feed = buildActivityFeed(targetPath, activityTail, cursor);
    return {
      ok: true,
      targetPath,
      generatedAt: new Date().toISOString(),
      quadrants: {
        crucible: await buildCrucibleQuadrant(targetPath),
        activeRuns: await buildActiveRunsQuadrant(targetPath),
        liveguard: await buildLiveguardQuadrant(targetPath),
        tempering: await buildTemperingQuadrant(targetPath),
      },
      activityFeed: feed.entries,
      activityPagination: {
        hasMore: feed.hasMore,
        nextCursor: feed.nextCursor,
        totalLines: feed.totalLines,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message, targetPath };
  }
}

// ─── Anomaly Detection ────────────────────────────────────────────────

/**
 * Detect anomalies in a snapshot without calling an AI model.
 * @param {object} snapshot - Output of buildWatchSnapshot()
 * @returns {Array<{ severity: "info"|"warn"|"error", code: string, message: string }>}
 */
export function detectWatchAnomalies(snapshot) {
  const anomalies = [];
  if (!snapshot.ok) return anomalies;

  // Cross-run mode
  if (snapshot.crossRun) {
    const { recurringFailures, retryRateSpike, costTrend, costTrendPercent, sliceTimeoutClusters } = snapshot.crossRun;
    if (recurringFailures.length > 0) {
      const worst = recurringFailures[0];
      anomalies.push({ severity: "error", code: "cross-run.recurring-gate-failure",
        message: `Slice "${worst.sliceName}" failed in ${worst.failCount} of ${worst.totalCount} runs — recurring gate failure` });
    }
    if (retryRateSpike) {
      anomalies.push({ severity: "warn", code: "cross-run.retry-rate-spike",
        message: "One or more slices are averaging >2 retry attempts across runs — retry rate is spiking" });
    }
    if (costTrend === "up") {
      anomalies.push({ severity: "warn", code: "cross-run.cost-anomaly-trend",
        message: `Run costs have increased ~${costTrendPercent}% compared to earlier runs in the window` });
    }
    if (sliceTimeoutClusters.length > 0) {
      const worst = sliceTimeoutClusters[0];
      anomalies.push({ severity: "warn", code: "cross-run.slice-timeout-cluster",
        message: `Slice "${worst.sliceName}" timed out in ${worst.timeoutCount} runs — likely needs a longer timeout or should be split` });
    }
    return anomalies;
  }

  // 1. Stalled run
  if (snapshot.runState === "in-progress" && snapshot.lastEventAgeMs && snapshot.lastEventAgeMs > 5 * 60_000) {
    anomalies.push({
      severity: "warn",
      code: "stalled",
      message: `No events for ${Math.round(snapshot.lastEventAgeMs / 60_000)}min — run may be stalled`,
    });
  }

  // 2. Token-parsing regression
  for (const a of snapshot.artifacts) {
    if (a.status === "passed" && (a.tokensOut === 0 || a.tokensOut === null) && a.duration && a.duration > 60_000) {
      anomalies.push({
        severity: "warn",
        code: "tokens-zero",
        message: `Slice ${a.sliceNumber} ran ${Math.round(a.duration / 1000)}s but reports 0 output tokens — parser may be broken`,
      });
    }
  }

  // 3. High retry attempts
  for (const a of snapshot.artifacts) {
    if (a.attempts && a.attempts >= 3) {
      anomalies.push({
        severity: "warn",
        code: "high-retries",
        message: `Slice ${a.sliceNumber} took ${a.attempts} attempts (close to retry limit)`,
      });
    }
  }

  // 4. Failed slice present
  if (snapshot.counts.failed > 0) {
    anomalies.push({
      severity: "error",
      code: "slice-failed",
      message: `${snapshot.counts.failed} slice(s) failed`,
    });
  }

  // 4b. Slice escalated
  if (snapshot.counts?.escalated > 0) {
    anomalies.push({
      severity: "warn",
      code: "model-escalated",
      message: `${snapshot.counts.escalated} slice(s) were escalated to a stronger model — investigate why initial model failed`,
    });
  }

  // 5. All slices skipped
  if (
    snapshot.runState === "completed" &&
    snapshot.summary?.results?.skipped === snapshot.summary?.results?.total &&
    snapshot.summary?.results?.total > 0
  ) {
    anomalies.push({
      severity: "info",
      code: "all-skipped",
      message: "All slices were skipped — likely a no-op re-run of an already-executed plan",
    });
  }

  // 6. Gate-on-prose failures
  for (const a of snapshot.artifacts) {
    if (a.gateError && /'[\d]+\.'/.test(a.gateError)) {
      anomalies.push({
        severity: "error",
        code: "gate-on-prose",
        message: `Slice ${a.sliceNumber} gate failed on markdown numbered-list prose — coalesceGateLines regression`,
      });
    }
  }

  // 7. Quorum dissent
  if (snapshot.counts?.quorumReviewed > 0 && snapshot.counts?.failed > 0) {
    anomalies.push({
      severity: "warn",
      code: "quorum-dissent",
      message: `Quorum review completed (${snapshot.counts.quorumReviewed}) but ${snapshot.counts.failed} slice(s) still failed — quorum legs may have disagreed or all proposed flawed plans`,
    });
  }

  // 8. Quorum legs incomplete
  if (
    snapshot.counts?.quorumDispatched > 0 &&
    snapshot.counts?.quorumDispatched > snapshot.counts?.quorumReviewed &&
    snapshot.runState === "in-progress" &&
    snapshot.lastEventAgeMs && snapshot.lastEventAgeMs > 8 * 60_000
  ) {
    anomalies.push({
      severity: "warn",
      code: "quorum-leg-stalled",
      message: `Quorum dispatched but review never completed (${snapshot.counts.quorumDispatched - snapshot.counts.quorumReviewed} pending, no events for ${Math.round(snapshot.lastEventAgeMs / 60_000)}min)`,
    });
  }

  // 9. Skill steps failed
  if (snapshot.counts?.skillStepsFailed > 0) {
    anomalies.push({
      severity: "error",
      code: "skill-step-failed",
      message: `${snapshot.counts.skillStepsFailed} skill step(s) failed — investigate skill execution log`,
    });
  }

  // 10. Stalled Crucible smelt
  if (snapshot.crucible && snapshot.crucible.staleInProgress > 0) {
    const ageDays = snapshot.crucible.oldestInProgressAgeMs
      ? Math.floor(snapshot.crucible.oldestInProgressAgeMs / (24 * 60 * 60 * 1000))
      : snapshot.crucible.stallCutoffDays;
    anomalies.push({
      severity: "warn",
      code: "crucible-stalled",
      message: `${snapshot.crucible.staleInProgress} Crucible smelt(s) idle ≥ ${snapshot.crucible.stallCutoffDays} days (oldest: ${ageDays}d) — abandon via forge_crucible_abandon or resume the interview`,
    });
  }

  // 11. Orphan handoff
  if (snapshot.crucible && snapshot.crucible.orphanHandoffs.length > 0) {
    anomalies.push({
      severity: "error",
      code: "crucible-orphan-handoff",
      message: `${snapshot.crucible.orphanHandoffs.length} Crucible handoff(s) reference a plan file that no longer exists — Hardener chain is broken`,
    });
  }

  // 12. Coverage below minimum
  if (snapshot.tempering && snapshot.tempering.belowMinimum > 0) {
    anomalies.push({
      severity: "warn",
      code: "tempering-coverage-below-minimum",
      message: `${snapshot.tempering.belowMinimum} coverage layer(s) below minimum by ≥ 5 points — run forge_tempering_scan for details`,
    });
  }

  // 13. Scan stale
  if (snapshot.tempering && snapshot.tempering.stale) {
    const days = snapshot.tempering.latestScanAgeMs
      ? Math.floor(snapshot.tempering.latestScanAgeMs / (24 * 60 * 60 * 1000))
      : snapshot.tempering.staleCutoffDays;
    anomalies.push({
      severity: "warn",
      code: "tempering-scan-stale",
      message: `Latest Tempering scan is ${days} days old (cutoff: ${snapshot.tempering.staleCutoffDays}d) — re-run forge_tempering_scan`,
    });
  }

  // 14. Run failed
  if (snapshot.tempering && snapshot.tempering.runFailed) {
    anomalies.push({
      severity: "error",
      code: "tempering-run-failed",
      message: `Latest Tempering run verdict=${snapshot.tempering.latestRunVerdict} on ${snapshot.tempering.latestRunStack || "unknown stack"} — investigate the run record before the next slice`,
    });
  }

  // 15. Contract mismatch
  if (snapshot.tempering && snapshot.tempering.contractMismatch > 0) {
    anomalies.push({
      severity: snapshot.tempering.contractMismatch >= 5 ? "error" : "warn",
      code: "tempering-contract-mismatch",
      message: `${snapshot.tempering.contractMismatch} API contract mismatch(es) detected — run forge_tempering_run for details`,
    });
  }

  // 16. Mutation score below minimum
  if (snapshot.tempering && snapshot.tempering.mutationBelowMinimum > 0) {
    anomalies.push({
      severity: snapshot.tempering.mutationBelowMinimum >= 3 ? "error" : "warn",
      code: "tempering-mutation-below-minimum",
      message: `${snapshot.tempering.mutationBelowMinimum} mutation layer(s) below minimum — run forge_tempering_run --full-mutation for details`,
    });
  }

  // 17. Flaky tests detected
  if (snapshot.tempering && snapshot.tempering.flakyCount > 0) {
    anomalies.push({
      severity: "warn",
      code: "tempering-flake-detected",
      message: `${snapshot.tempering.flakyCount} flaky test(s) detected — quarantine or fix to stabilize the suite`,
    });
  }

  // 18. Performance regression
  if (snapshot.tempering && snapshot.tempering.perfRegressionCount > 0) {
    anomalies.push({
      severity: snapshot.tempering.perfRegressionCount >= 3 ? "error" : "warn",
      code: "tempering-perf-regression",
      message: `${snapshot.tempering.perfRegressionCount} performance regression(s) detected — investigate perf-budget scanner report`,
    });
  }

  // 19. Unaddressed bugs
  if (snapshot.tempering && snapshot.tempering.openBugCount?.unaddressed?.length > 0) {
    anomalies.push({
      severity: "warn",
      code: "tempering-bug-unaddressed",
      count: snapshot.tempering.openBugCount.unaddressed.length,
      bugIds: snapshot.tempering.openBugCount.unaddressed.map(b => b.bugId),
      message: `${snapshot.tempering.openBugCount.unaddressed.length} open bug(s) older than 14 days without a linked fix plan — generate a fix proposal or close them`,
    });
  }

  // 20. Review queue backlog
  if (snapshot.reviewQueue) {
    const rq = snapshot.reviewQueue;
    if (rq.open > 10 || (rq.blockerAgeMs && rq.blockerAgeMs > 4 * 60 * 60 * 1000)) {
      anomalies.push({
        severity: "warn",
        code: "review-queue-backlog",
        message: rq.blockerAgeMs > 4 * 60 * 60 * 1000
          ? `Blocker review open for ${Math.round(rq.blockerAgeMs / 3600000)}h — requires immediate attention`
          : `${rq.open} open reviews in queue — consider clearing backlog`,
      });
    }
  }

  // 21. Notification delivery failing
  if (snapshot.notifications && snapshot.notifications.failedLastHour >= 3) {
    anomalies.push({
      severity: "warn",
      code: "notification-delivery-failing",
      message: `${snapshot.notifications.failedLastHour} notification delivery failure(s)${snapshot.notifications.failingAdapter ? ` for adapter "${snapshot.notifications.failingAdapter}"` : ""} in the last hour`,
    });
  }

  return anomalies;
}

// ─── Recommendations ─────────────────────────────────────────────────

/**
 * Map anomaly codes to concrete corrective recommendations.
 * @param {Array} anomalies - Output of detectWatchAnomalies
 * @param {object} snapshot - Output of buildWatchSnapshot
 * @returns {Array<{ code: string, action: string, command: string|null, severity: string }>}
 */
export function recommendFromAnomalies(anomalies, snapshot) {
  const recs = [];
  if (!Array.isArray(anomalies) || anomalies.length === 0) return recs;

  const byCode = new Map();
  for (const a of anomalies) {
    if (!byCode.has(a.code)) byCode.set(a.code, a);
  }

  for (const [code, anomaly] of byCode) {
    switch (code) {
      case "stalled":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "Run appears stuck. Check the worker process and consider aborting if no progress resumes.",
          command: "pforge abort",
        });
        break;

      case "tokens-zero": {
        const slice = snapshot.artifacts?.find((a) => a.tokensOut === 0 && a.duration > 60_000);
        recs.push({
          code,
          severity: anomaly.severity,
          action: `Token parser may be broken for ${slice?.worker || "this worker"}. Verify CLI version and stderr encoding (Windows UTF-8 fix shipped in v2.33).`,
          command: null,
        });
        break;
      }

      case "high-retries": {
        const slice = snapshot.artifacts?.find((a) => a.attempts >= 3);
        recs.push({
          code,
          severity: anomaly.severity,
          action: `Slice ${slice?.sliceNumber ?? "?"} hit retry limit. Review the slice plan and consider splitting it or escalating to a stronger model.`,
          command: slice ? `pforge fix-proposal slice-${slice.sliceNumber}` : null,
        });
        break;
      }

      case "slice-failed": {
        const failed = snapshot.artifacts?.find((a) => a.status === "failed");
        recs.push({
          code,
          severity: anomaly.severity,
          action: `Slice ${failed?.sliceNumber ?? "?"} failed. Generate a fix proposal and resume from that slice.`,
          command: failed ? `pforge run-plan --resume-from ${failed.sliceNumber} ${snapshot.plan ?? "<plan>"}` : null,
        });
        break;
      }

      case "model-escalated":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "Initial model failed and a stronger model was used. Consider promoting the stronger model in escalation chain or reviewing the slice for unstated complexity.",
          command: null,
        });
        break;

      case "all-skipped":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "All slices were skipped — plan was already complete. No action required; this was a no-op re-run.",
          command: null,
        });
        break;

      case "gate-on-prose": {
        const slice = snapshot.artifacts?.find((a) => a.gateError && /'[\d]+\.'/.test(a.gateError));
        recs.push({
          code,
          severity: anomaly.severity,
          action: "Validation gate parsing rejected markdown prose as a shell command. Update Plan Forge to v2.33+ and re-run the slice.",
          command: slice ? `pforge run-plan --resume-from ${slice.sliceNumber} ${snapshot.plan ?? "<plan>"}` : null,
        });
        break;
      }

      case "quorum-dissent":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "Quorum agreed on a plan but execution still failed. Review individual leg outputs in events.log and consider running quorum analyze for a deeper merge.",
          command: snapshot.plan ? `pforge analyze --quorum=power ${snapshot.plan}` : null,
        });
        break;

      case "quorum-leg-stalled":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "Quorum review never completed. One or more legs may have hung. Check worker processes and consider aborting.",
          command: "pforge abort",
        });
        break;

      case "skill-step-failed":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "A skill step failed. Inspect the skill execution log and re-run the affected skill manually.",
          command: "pforge skill-status",
        });
        break;

      case "crucible-stalled":
        recs.push({
          code,
          severity: anomaly.severity,
          action: `${snapshot.crucible?.staleInProgress ?? "One or more"} Crucible smelt(s) have been idle for 7+ days. Abandon them (if truly stuck) or resume the interview to keep the funnel clean.`,
          command: "forge_crucible_list",
        });
        break;

      case "crucible-orphan-handoff": {
        const orphan = snapshot.crucible?.orphanHandoffs?.[0];
        recs.push({
          code,
          severity: anomaly.severity,
          action: `Hardener handoff for ${orphan?.phaseName || "a finalized smelt"} points at a missing plan file (${orphan?.planPath || "unknown"}). Either restore the plan from git history or re-run the smelt (the crucibleId in .forge/crucible/ can be re-finalized).`,
          command: orphan?.crucibleId ? `forge_crucible_preview ${orphan.crucibleId}` : null,
        });
        break;
      }

      case "tempering-coverage-below-minimum":
        recs.push({
          code,
          severity: anomaly.severity,
          action: `${snapshot.tempering?.belowMinimum ?? "One or more"} coverage layer(s) fell below their configured minimum. Inspect the gap report and add targeted tests to the worst-first files listed in the latest scan record.`,
          command: "forge_tempering_status",
        });
        break;

      case "tempering-scan-stale":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "The latest Tempering scan is older than the staleness cutoff. Re-run the scan so downstream dashboards and anomaly rules work against current coverage.",
          command: "forge_tempering_scan",
        });
        break;

      case "tempering-run-failed":
        recs.push({
          code,
          severity: anomaly.severity,
          action: `Latest Tempering run verdict=${snapshot.tempering?.latestRunVerdict ?? "unknown"}. Open the most recent .forge/tempering/run-*.json to see per-scanner stdout, then either fix the failing tests or (if this is an infra flake) re-run forge_tempering_run.`,
          command: "forge_tempering_run",
        });
        break;

      case "tempering-contract-mismatch":
        recs.push({
          code,
          severity: anomaly.severity,
          action: `${snapshot.tempering?.contractMismatch ?? "One or more"} API contract mismatch(es) detected. Inspect .forge/tempering/artifacts/<runId>/contract/report.json for violation details, then fix API response shapes or update the spec.`,
          command: "forge_tempering_run",
        });
        break;

      case "tempering-mutation-below-minimum":
        recs.push({
          code,
          severity: anomaly.severity,
          action: `${snapshot.tempering?.mutationBelowMinimum ?? "One or more"} mutation layer(s) scored below the configured minimum. Run a full mutation scan to identify survived mutants, then add targeted test cases for the weakest layers.`,
          command: "pforge tempering run --full-mutation",
        });
        break;

      case "tempering-flake-detected":
        recs.push({
          code,
          severity: anomaly.severity,
          action: `${snapshot.tempering?.flakyCount ?? "One or more"} flaky test(s) detected. Quarantine unreliable tests or fix their root cause (race conditions, shared state, network dependencies) to stabilize the suite.`,
          command: "pforge tempering quarantine",
        });
        break;

      case "tempering-perf-regression":
        recs.push({
          code,
          severity: anomaly.severity,
          action: `${snapshot.tempering?.perfRegressionCount ?? "One or more"} performance regression(s) detected. Compare p95 latencies against baselines in .forge/tempering/perf-history.jsonl and investigate the endpoints with the largest delta.`,
          command: "forge_tempering_run",
        });
        break;

      case "tempering-bug-unaddressed": {
        const bugId = anomaly.bugIds?.[0] || "unknown";
        recs.push({
          code,
          severity: anomaly.severity,
          action: `Run forge_fix_proposal source=tempering-bug bugId=${bugId} to generate a fix plan, or forge_bug_update_status bugId=${bugId} status=wont-fix with rationale.`,
          command: `forge_fix_proposal --source tempering-bug --bugId ${bugId}`,
        });
        break;
      }

      case "review-queue-backlog":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "Open the Review tab and clear open items, prioritizing blockers",
          command: null,
        });
        break;

      case "notification-delivery-failing":
        recs.push({
          code,
          severity: anomaly.severity,
          action: "Check adapter config and endpoint availability. Run forge_notify_test to validate.",
          command: "forge_notify_test",
        });
        break;

      case "cross-run.recurring-gate-failure": {
        const rf = snapshot.crossRun?.recurringFailures?.[0];
        recs.push({ code, severity: anomaly.severity,
          action: `Investigate slice "${rf?.sliceName}" — it has failed in ${rf?.failCount} consecutive runs`,
          command: null });
        break;
      }
      case "cross-run.retry-rate-spike":
        recs.push({ code, severity: anomaly.severity,
          action: "Check worker reliability — high retry rates may indicate flaky tests or resource contention",
          command: null });
        break;
      case "cross-run.cost-anomaly-trend": {
        const pct = snapshot.crossRun?.costTrendPercent;
        recs.push({ code, severity: anomaly.severity,
          action: `Run costs are trending up ~${pct}% — review model selection and slice token budgets`,
          command: null });
        break;
      }
      case "cross-run.slice-timeout-cluster": {
        const tc = snapshot.crossRun?.sliceTimeoutClusters?.[0];
        recs.push({ code, severity: anomaly.severity,
          action: `Slice "${tc?.sliceName}" repeatedly times out — increase its timeout or split it into smaller slices`,
          command: null });
        break;
      }
      default:
        recs.push({
          code,
          severity: anomaly.severity,
          action: anomaly.message,
          command: null,
        });
    }
  }

  return recs;
}

// ─── Slice Complexity Scoring ─────────────────────────────────────────

const SECURITY_KEYWORDS = /\b(auth|token|rbac|encryption|secret|cors|jwt|oauth|password|credential|permission|role)\b/gi;
const DATABASE_KEYWORDS = /\b(migration|schema|alter|create\s+table|drop|seed|index|foreign\s+key|constraint|ef\s+core|dbcontext|repository)\b/gi;

/**
 * Scan historical runs for failure rate of slices with similar titles/keywords.
 * Returns 0-1.
 */
function getHistoricalFailureRate(slice, cwd) {
  if (!cwd) return 0;
  const runsDir = resolve(cwd, ".forge", "runs");
  if (!existsSync(runsDir)) return 0;

  const titleWords = (slice.title || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (titleWords.length === 0) return 0;

  let matches = 0;
  let failures = 0;

  try {
    const indexPath = resolve(runsDir, "index.jsonl");
    if (!existsSync(indexPath)) return 0;

    const lines = readFileSync(indexPath, "utf-8").split("\n").filter((l) => l.trim());
    const recent = lines.slice(-20);

    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        const runDir = resolve(runsDir, entry.runDir || entry.runId || "");
        const summaryPath = resolve(runDir, "summary.json");
        if (!existsSync(summaryPath)) continue;

        const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
        if (!summary.slices) continue;

        for (const s of summary.slices) {
          const sTitle = (s.title || "").toLowerCase();
          const isMatch = titleWords.some((w) => sTitle.includes(w));
          if (isMatch) {
            matches++;
            if (s.status === "failed") failures++;
          }
        }
      } catch { /* skip malformed entries */ }
    }
  } catch { /* no history */ }

  return matches > 0 ? failures / matches : 0;
}

/**
 * Score slice complexity on a 1-10 scale using weighted signals.
 * @param {object} slice - Parsed slice object
 * @param {string} cwd - Project root for historical lookup
 * @returns {{ score: number, signals: object }}
 */
export function scoreSliceComplexity(slice, cwd) {
  const signals = {};

  const scopeCount = (slice.scope && slice.scope.length) || 0;
  signals.scopeWeight = Math.min(scopeCount / 3, 1);

  const depCount = (slice.depends && slice.depends.length) || 0;
  signals.dependencyWeight = Math.min(depCount / 3, 1);

  const allText = [slice.title || "", ...(slice.tasks || []), slice.validationGate || ""].join(" ");
  const securityHits = (allText.match(SECURITY_KEYWORDS) || []).length;
  signals.securityWeight = Math.min(securityHits / 2, 1);

  const dbHits = (allText.match(DATABASE_KEYWORDS) || []).length;
  signals.databaseWeight = Math.min(dbHits / 2, 1);

  const gateLines = slice.validationGate
    ? slice.validationGate.split("\n").filter((l) => l.trim().length > 0).length
    : 0;
  signals.gateWeight = Math.min(gateLines / 3, 1);

  const taskCount = (slice.tasks && slice.tasks.length) || 0;
  signals.taskWeight = Math.min(taskCount / 6, 1);

  signals.historicalWeight = getHistoricalFailureRate(slice, cwd);

  const raw =
    signals.scopeWeight * 0.20 +
    signals.dependencyWeight * 0.20 +
    signals.securityWeight * 0.15 +
    signals.databaseWeight * 0.15 +
    signals.gateWeight * 0.10 +
    signals.taskWeight * 0.10 +
    signals.historicalWeight * 0.10;

  const score = Math.max(1, Math.min(10, Math.round(raw * 9) + 1));

  return { score, signals };
}
