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
  readFileSync, writeFileSync, existsSync, readdirSync, statSync,
  mkdirSync, appendFileSync,
} from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
import { createHash } from "node:crypto";
import { WATCHER_MODES } from "../enums.mjs";
import { buildCrossRunSnapshot } from "../watcher.mjs";
import { ensureForgeDir } from "./forge-io.mjs";
import { compareSliceIds } from "./plan-parser.mjs";
import { spawnWorker } from "./worker-spawn.mjs";
import { recall as brainRecall } from "../brain.mjs";
import {
  readTemperingState,
  TEMPERING_SCAN_STALE_DAYS,
} from "../tempering.mjs";

const [WATCHER_MODE_SNAPSHOT, WATCHER_MODE_ANALYZE, WATCHER_MODE_CROSS_RUN] = WATCHER_MODES;
const DEFAULT_WATCHER_MODEL = "claude-opus-4.7";

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

export function listReviewItems(targetPath, filters = {}) {
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
function _classifyCrucibleEntry(entry, dir, counts, cutoffMs) {
  // Returns { status, mtime } or null if file is unreadable (and counts.other was bumped).
  const fullPath = resolve(dir, entry.name);
  counts.total++;
  try {
    const raw = readFileSync(fullPath, "utf-8");
    const smelt = JSON.parse(raw);
    const status = typeof smelt.status === "string" ? smelt.status : "other";
    const mtime = statSync(fullPath).mtimeMs;
    return { status, mtime, stale: status === "in_progress" && mtime < cutoffMs };
  } catch {
    counts.other++;
    return null;
  }
}

function _bucketCrucibleStatus(info, counts) {
  // Returns mtime when status is in_progress, otherwise null.
  const { status, mtime } = info;
  if (status === "in_progress") { counts.in_progress++; return mtime; }
  if (status === "finalized") counts.finalized++;
  else if (status === "abandoned") counts.abandoned++;
  else counts.other++;
  return null;
}

function _readCrucibleOrphanHandoffs(targetPath) {
  const orphanHandoffs = [];
  const hubEventsPath = resolve(targetPath, ".forge", "hub-events.jsonl");
  if (!existsSync(hubEventsPath)) return orphanHandoffs;
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
  return orphanHandoffs;
}

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

    const info = _classifyCrucibleEntry(entry, dir, counts, cutoffMs);
    if (!info) continue;

    const mtime = _bucketCrucibleStatus(info, counts);
    if (mtime !== null) {
      if (oldestInProgressMs === null || mtime < oldestInProgressMs) {
        oldestInProgressMs = mtime;
      }
      if (info.stale) staleInProgress++;
    }
  }

  return {
    counts,
    oldestInProgressAgeMs: oldestInProgressMs !== null ? Date.now() - oldestInProgressMs : null,
    staleInProgress,
    stallCutoffDays: CRUCIBLE_STALL_CUTOFF_DAYS,
    orphanHandoffs: _readCrucibleOrphanHandoffs(targetPath),
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
function _readWatchSummary(runDir) {
  const summaryPath = resolve(runDir, "summary.json");
  if (!existsSync(summaryPath)) return null;
  try { return JSON.parse(readFileSync(summaryPath, "utf-8")); } catch { return null; }
}

function _computeEventCounts(events) {
  return {
    runStarted: events.find((e) => e.type === "run-started"),
    runCompleted: events.find((e) => e.type === "run-completed" || e.type === "run-aborted"),
    sliceStarted: events.filter((e) => e.type === "slice-started"),
    sliceCompleted: events.filter((e) => e.type === "slice-completed"),
    sliceFailed: events.filter((e) => e.type === "slice-failed"),
    sliceEscalated: events.filter((e) => e.type === "slice-escalated"),
    quorumDispatched: events.filter((e) => e.type === "quorum-dispatch-started"),
    quorumLegsCompleted: events.filter((e) => e.type === "quorum-leg-completed"),
    quorumReviewed: events.filter((e) => e.type === "quorum-review-completed"),
    skillsStarted: events.filter((e) => e.type === "skill-started"),
    skillsCompleted: events.filter((e) => e.type === "skill-completed"),
    skillStepsFailed: events.filter((e) =>
      e.type === "skill-step-completed" && e.data?.status && e.data.status !== "passed" && e.data.status !== "completed"
    ),
  };
}

function _computeDiffEvents(events, sinceTimestamp) {
  if (!sinceTimestamp) return { newEvents: [], hasNewEvents: false };
  const cutoffMs = new Date(sinceTimestamp).getTime();
  if (!Number.isFinite(cutoffMs)) return { newEvents: [], hasNewEvents: false };
  const newEvents = events.filter((e) => new Date(e.ts).getTime() > cutoffMs);
  return { newEvents, hasNewEvents: newEvents.length > 0 };
}

async function _buildHomeChip(targetPath) {
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
}

function _buildReviewQueueChip(targetPath) {
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
}

function _buildNotificationsChip(events) {
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
}

function _normalizeWatchSnapshotOptions(opts = {}) {
  const tailEventsRaw = Number.isFinite(opts.tailEvents) ? opts.tailEvents : 25;
  return {
    tailEvents: Math.min(200, Math.max(1, Math.floor(tailEventsRaw))),
    sinceTimestamp: opts.sinceTimestamp || null,
  };
}

function _readWatchSnapshotRun(targetPath, runId) {
  const located = findLatestRun(targetPath, runId);
  if (!located) {
    return { ok: false, error: `No run directory found under ${targetPath}/.forge/runs/`, targetPath };
  }
  const events = parseEventsLog(located.runDir);
  const artifacts = readSliceArtifacts(located.runDir);
  const ec = _computeEventCounts(events);
  const lastEvent = events[events.length - 1] || null;
  return { located, events, artifacts, ec, lastEvent, summary: _readWatchSummary(located.runDir) };
}

function _buildWatchSnapshotArtifacts(artifacts) {
  return artifacts.map((a) => ({
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
  }));
}

async function _assembleWatchSnapshot({ targetPath, tailEvents, sinceTimestamp, runData }) {
  const { located, events, artifacts, ec, lastEvent, summary } = runData;
  const lastEventAgeMs = lastEvent ? Date.now() - new Date(lastEvent.ts).getTime() : null;
  const runState = normalizeRunState(ec.runCompleted?.type || null, Boolean(ec.runStarted));
  const { newEvents, hasNewEvents } = _computeDiffEvents(events, sinceTimestamp);
  return {
    ok: true,
    targetPath,
    runId: located.runId,
    runDir: located.runDir,
    runState,
    lastEventType: ec.runCompleted?.type || (ec.runStarted ? "run-started" : null),
    plan: ec.runStarted?.data?.plan || null,
    model: ec.runStarted?.data?.model || null,
    sliceCount: ec.runStarted?.data?.sliceCount || null,
    counts: {
      started: ec.sliceStarted.length,
      completed: ec.sliceCompleted.length,
      failed: ec.sliceFailed.length,
      escalated: ec.sliceEscalated.length,
      quorumDispatched: ec.quorumDispatched.length,
      quorumLegsCompleted: ec.quorumLegsCompleted.length,
      quorumReviewed: ec.quorumReviewed.length,
      skillsStarted: ec.skillsStarted.length,
      skillsCompleted: ec.skillsCompleted.length,
      skillStepsFailed: ec.skillStepsFailed.length,
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
    artifacts: _buildWatchSnapshotArtifacts(artifacts),
    tailEvents,
    events: events.slice(-tailEvents),
    crucible: readCrucibleState(targetPath),
    tempering: readTemperingState(targetPath),
    home: await _buildHomeChip(targetPath),
    reviewQueue: _buildReviewQueueChip(targetPath),
    notifications: _buildNotificationsChip(events),
  };
}

export async function buildWatchSnapshot(targetPath, runId = null, opts = {}) {
  const { tailEvents, sinceTimestamp } = _normalizeWatchSnapshotOptions(opts);
  const runData = _readWatchSnapshotRun(targetPath, runId);
  if (runData.ok === false) {
    return runData;
  }
  return _assembleWatchSnapshot({ targetPath, tailEvents, sinceTimestamp, runData });
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
function _detectCrossRunAnomalies(snapshot) {
  const anomalies = [];
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

function _detectRunLevelAnomalies(snapshot) {
  const anomalies = [];
  if (snapshot.runState === "in-progress" && snapshot.lastEventAgeMs && snapshot.lastEventAgeMs > 5 * 60_000) {
    anomalies.push({
      severity: "warn",
      code: "stalled",
      message: `No events for ${Math.round(snapshot.lastEventAgeMs / 60_000)}min — run may be stalled`,
    });
  }
  if (snapshot.counts.failed > 0) {
    anomalies.push({ severity: "error", code: "slice-failed", message: `${snapshot.counts.failed} slice(s) failed` });
  }
  if (snapshot.counts?.escalated > 0) {
    anomalies.push({
      severity: "warn",
      code: "model-escalated",
      message: `${snapshot.counts.escalated} slice(s) were escalated to a stronger model — investigate why initial model failed`,
    });
  }
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
  return anomalies;
}

function _detectArtifactAnomalies(snapshot) {
  const anomalies = [];
  for (const a of snapshot.artifacts) {
    if (a.status === "passed" && (a.tokensOut === 0 || a.tokensOut === null) && a.duration && a.duration > 60_000) {
      anomalies.push({
        severity: "warn",
        code: "tokens-zero",
        message: `Slice ${a.sliceNumber} ran ${Math.round(a.duration / 1000)}s but reports 0 output tokens — parser may be broken`,
      });
    }
    if (a.attempts && a.attempts >= 3) {
      anomalies.push({
        severity: "warn",
        code: "high-retries",
        message: `Slice ${a.sliceNumber} took ${a.attempts} attempts (close to retry limit)`,
      });
    }
    if (a.gateError && /'[\d]+\.'/.test(a.gateError)) {
      anomalies.push({
        severity: "error",
        code: "gate-on-prose",
        message: `Slice ${a.sliceNumber} gate failed on markdown numbered-list prose — coalesceGateLines regression`,
      });
    }
  }
  return anomalies;
}

function _detectQuorumSkillAnomalies(snapshot) {
  const anomalies = [];
  if (snapshot.counts?.quorumReviewed > 0 && snapshot.counts?.failed > 0) {
    anomalies.push({
      severity: "warn",
      code: "quorum-dissent",
      message: `Quorum review completed (${snapshot.counts.quorumReviewed}) but ${snapshot.counts.failed} slice(s) still failed — quorum legs may have disagreed or all proposed flawed plans`,
    });
  }
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
  if (snapshot.counts?.skillStepsFailed > 0) {
    anomalies.push({
      severity: "error",
      code: "skill-step-failed",
      message: `${snapshot.counts.skillStepsFailed} skill step(s) failed — investigate skill execution log`,
    });
  }
  return anomalies;
}

function _detectCrucibleAnomalies(snapshot) {
  const anomalies = [];
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
  if (snapshot.crucible && snapshot.crucible.orphanHandoffs.length > 0) {
    anomalies.push({
      severity: "error",
      code: "crucible-orphan-handoff",
      message: `${snapshot.crucible.orphanHandoffs.length} Crucible handoff(s) reference a plan file that no longer exists — Hardener chain is broken`,
    });
  }
  return anomalies;
}

function _detectTemperingAnomalies(snapshot) {
  const anomalies = [];
  const t = snapshot.tempering;
  if (!t) return anomalies;

  if (t.belowMinimum > 0) {
    anomalies.push({
      severity: "warn",
      code: "tempering-coverage-below-minimum",
      message: `${t.belowMinimum} coverage layer(s) below minimum by ≥ 5 points — run forge_tempering_scan for details`,
    });
  }
  if (t.stale) {
    const days = t.latestScanAgeMs
      ? Math.floor(t.latestScanAgeMs / (24 * 60 * 60 * 1000))
      : t.staleCutoffDays;
    anomalies.push({
      severity: "warn",
      code: "tempering-scan-stale",
      message: `Latest Tempering scan is ${days} days old (cutoff: ${t.staleCutoffDays}d) — re-run forge_tempering_scan`,
    });
  }
  if (t.runFailed) {
    anomalies.push({
      severity: "error",
      code: "tempering-run-failed",
      message: `Latest Tempering run verdict=${t.latestRunVerdict} on ${t.latestRunStack || "unknown stack"} — investigate the run record before the next slice`,
    });
  }
  if (t.contractMismatch > 0) {
    anomalies.push({
      severity: t.contractMismatch >= 5 ? "error" : "warn",
      code: "tempering-contract-mismatch",
      message: `${t.contractMismatch} API contract mismatch(es) detected — run forge_tempering_run for details`,
    });
  }
  if (t.mutationBelowMinimum > 0) {
    anomalies.push({
      severity: t.mutationBelowMinimum >= 3 ? "error" : "warn",
      code: "tempering-mutation-below-minimum",
      message: `${t.mutationBelowMinimum} mutation layer(s) below minimum — run forge_tempering_run --full-mutation for details`,
    });
  }
  if (t.flakyCount > 0) {
    anomalies.push({
      severity: "warn",
      code: "tempering-flake-detected",
      message: `${t.flakyCount} flaky test(s) detected — quarantine or fix to stabilize the suite`,
    });
  }
  if (t.perfRegressionCount > 0) {
    anomalies.push({
      severity: t.perfRegressionCount >= 3 ? "error" : "warn",
      code: "tempering-perf-regression",
      message: `${t.perfRegressionCount} performance regression(s) detected — investigate perf-budget scanner report`,
    });
  }
  if (t.openBugCount?.unaddressed?.length > 0) {
    anomalies.push({
      severity: "warn",
      code: "tempering-bug-unaddressed",
      count: t.openBugCount.unaddressed.length,
      bugIds: t.openBugCount.unaddressed.map(b => b.bugId),
      message: `${t.openBugCount.unaddressed.length} open bug(s) older than 14 days without a linked fix plan — generate a fix proposal or close them`,
    });
  }
  return anomalies;
}

function _detectReviewNotificationAnomalies(snapshot) {
  const anomalies = [];
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
  if (snapshot.notifications && snapshot.notifications.failedLastHour >= 3) {
    anomalies.push({
      severity: "warn",
      code: "notification-delivery-failing",
      message: `${snapshot.notifications.failedLastHour} notification delivery failure(s)${snapshot.notifications.failingAdapter ? ` for adapter "${snapshot.notifications.failingAdapter}"` : ""} in the last hour`,
    });
  }
  return anomalies;
}

export function detectWatchAnomalies(snapshot) {
  if (!snapshot.ok) return [];

  if (snapshot.crossRun) {
    return _detectCrossRunAnomalies(snapshot);
  }

  return [
    ..._detectRunLevelAnomalies(snapshot),
    ..._detectArtifactAnomalies(snapshot),
    ..._detectQuorumSkillAnomalies(snapshot),
    ..._detectCrucibleAnomalies(snapshot),
    ..._detectTemperingAnomalies(snapshot),
    ..._detectReviewNotificationAnomalies(snapshot),
  ];
}

// ─── Recommendations ─────────────────────────────────────────────────

/**
 * Map anomaly codes to concrete corrective recommendations.
 * @param {Array} anomalies - Output of detectWatchAnomalies
 * @param {object} snapshot - Output of buildWatchSnapshot
 * @returns {Array<{ code: string, action: string, command: string|null, severity: string }>}
 */
// ─── Recommendation builders (per anomaly code) ──────────────────────
// Each returns { action, command } given (anomaly, snapshot). The shared
// dispatcher wraps with { code, severity }.

const _RECO_BUILDERS = {
  "stalled": () => ({
    action: "Run appears stuck. Check the worker process and consider aborting if no progress resumes.",
    command: "pforge abort",
  }),
  "tokens-zero": (_a, snapshot) => {
    const slice = snapshot.artifacts?.find((a) => a.tokensOut === 0 && a.duration > 60_000);
    return {
      action: `Token parser may be broken for ${slice?.worker || "this worker"}. Verify CLI version and stderr encoding (Windows UTF-8 fix shipped in v2.33).`,
      command: null,
    };
  },
  "high-retries": (_a, snapshot) => {
    const slice = snapshot.artifacts?.find((a) => a.attempts >= 3);
    return {
      action: `Slice ${slice?.sliceNumber ?? "?"} hit retry limit. Review the slice plan and consider splitting it or escalating to a stronger model.`,
      command: slice ? `pforge fix-proposal slice-${slice.sliceNumber}` : null,
    };
  },
  "slice-failed": (_a, snapshot) => {
    const failed = snapshot.artifacts?.find((a) => a.status === "failed");
    return {
      action: `Slice ${failed?.sliceNumber ?? "?"} failed. Generate a fix proposal and resume from that slice.`,
      command: failed ? `pforge run-plan --resume-from ${failed.sliceNumber} ${snapshot.plan ?? "<plan>"}` : null,
    };
  },
  "model-escalated": () => ({
    action: "Initial model failed and a stronger model was used. Consider promoting the stronger model in escalation chain or reviewing the slice for unstated complexity.",
    command: null,
  }),
  "all-skipped": () => ({
    action: "All slices were skipped — plan was already complete. No action required; this was a no-op re-run.",
    command: null,
  }),
  "gate-on-prose": (_a, snapshot) => {
    const slice = snapshot.artifacts?.find((a) => a.gateError && /'[\d]+\.'/.test(a.gateError));
    return {
      action: "Validation gate parsing rejected markdown prose as a shell command. Update Plan Forge to v2.33+ and re-run the slice.",
      command: slice ? `pforge run-plan --resume-from ${slice.sliceNumber} ${snapshot.plan ?? "<plan>"}` : null,
    };
  },
  "quorum-dissent": (_a, snapshot) => ({
    action: "Quorum agreed on a plan but execution still failed. Review individual leg outputs in events.log and consider running quorum analyze for a deeper merge.",
    command: snapshot.plan ? `pforge analyze --quorum=power ${snapshot.plan}` : null,
  }),
  "quorum-leg-stalled": () => ({
    action: "Quorum review never completed. One or more legs may have hung. Check worker processes and consider aborting.",
    command: "pforge abort",
  }),
  "skill-step-failed": () => ({
    action: "A skill step failed. Inspect the skill execution log and re-run the affected skill manually.",
    command: "pforge skill-status",
  }),
  "crucible-stalled": (_a, snapshot) => ({
    action: `${snapshot.crucible?.staleInProgress ?? "One or more"} Crucible smelt(s) have been idle for 7+ days. Abandon them (if truly stuck) or resume the interview to keep the funnel clean.`,
    command: "forge_crucible_list",
  }),
  "crucible-orphan-handoff": (_a, snapshot) => {
    const orphan = snapshot.crucible?.orphanHandoffs?.[0];
    return {
      action: `Hardener handoff for ${orphan?.phaseName || "a finalized smelt"} points at a missing plan file (${orphan?.planPath || "unknown"}). Either restore the plan from git history or re-run the smelt (the crucibleId in .forge/crucible/ can be re-finalized).`,
      command: orphan?.crucibleId ? `forge_crucible_preview ${orphan.crucibleId}` : null,
    };
  },
  "tempering-coverage-below-minimum": (_a, snapshot) => ({
    action: `${snapshot.tempering?.belowMinimum ?? "One or more"} coverage layer(s) fell below their configured minimum. Inspect the gap report and add targeted tests to the worst-first files listed in the latest scan record.`,
    command: "forge_tempering_status",
  }),
  "tempering-scan-stale": () => ({
    action: "The latest Tempering scan is older than the staleness cutoff. Re-run the scan so downstream dashboards and anomaly rules work against current coverage.",
    command: "forge_tempering_scan",
  }),
  "tempering-run-failed": (_a, snapshot) => ({
    action: `Latest Tempering run verdict=${snapshot.tempering?.latestRunVerdict ?? "unknown"}. Open the most recent .forge/tempering/run-*.json to see per-scanner stdout, then either fix the failing tests or (if this is an infra flake) re-run forge_tempering_run.`,
    command: "forge_tempering_run",
  }),
  "tempering-contract-mismatch": (_a, snapshot) => ({
    action: `${snapshot.tempering?.contractMismatch ?? "One or more"} API contract mismatch(es) detected. Inspect .forge/tempering/artifacts/<runId>/contract/report.json for violation details, then fix API response shapes or update the spec.`,
    command: "forge_tempering_run",
  }),
  "tempering-mutation-below-minimum": (_a, snapshot) => ({
    action: `${snapshot.tempering?.mutationBelowMinimum ?? "One or more"} mutation layer(s) scored below the configured minimum. Run a full mutation scan to identify survived mutants, then add targeted test cases for the weakest layers.`,
    command: "pforge tempering run --full-mutation",
  }),
  "tempering-flake-detected": (_a, snapshot) => ({
    action: `${snapshot.tempering?.flakyCount ?? "One or more"} flaky test(s) detected. Quarantine unreliable tests or fix their root cause (race conditions, shared state, network dependencies) to stabilize the suite.`,
    command: "pforge tempering quarantine",
  }),
  "tempering-perf-regression": (_a, snapshot) => ({
    action: `${snapshot.tempering?.perfRegressionCount ?? "One or more"} performance regression(s) detected. Compare p95 latencies against baselines in .forge/tempering/perf-history.jsonl and investigate the endpoints with the largest delta.`,
    command: "forge_tempering_run",
  }),
  "tempering-bug-unaddressed": (anomaly) => {
    const bugId = anomaly.bugIds?.[0] || "unknown";
    return {
      action: `Run forge_fix_proposal source=tempering-bug bugId=${bugId} to generate a fix plan, or forge_bug_update_status bugId=${bugId} status=wont-fix with rationale.`,
      command: `forge_fix_proposal --source tempering-bug --bugId ${bugId}`,
    };
  },
  "review-queue-backlog": () => ({
    action: "Open the Review tab and clear open items, prioritizing blockers",
    command: null,
  }),
  "notification-delivery-failing": () => ({
    action: "Check adapter config and endpoint availability. Run forge_notify_test to validate.",
    command: "forge_notify_test",
  }),
  "cross-run.recurring-gate-failure": (_a, snapshot) => {
    const rf = snapshot.crossRun?.recurringFailures?.[0];
    return {
      action: `Investigate slice "${rf?.sliceName}" — it has failed in ${rf?.failCount} consecutive runs`,
      command: null,
    };
  },
  "cross-run.retry-rate-spike": () => ({
    action: "Check worker reliability — high retry rates may indicate flaky tests or resource contention",
    command: null,
  }),
  "cross-run.cost-anomaly-trend": (_a, snapshot) => {
    const pct = snapshot.crossRun?.costTrendPercent;
    return {
      action: `Run costs are trending up ~${pct}% — review model selection and slice token budgets`,
      command: null,
    };
  },
  "cross-run.slice-timeout-cluster": (_a, snapshot) => {
    const tc = snapshot.crossRun?.sliceTimeoutClusters?.[0];
    return {
      action: `Slice "${tc?.sliceName}" repeatedly times out — increase its timeout or split it into smaller slices`,
      command: null,
    };
  },
};

export function recommendFromAnomalies(anomalies, snapshot) {
  const recs = [];
  if (!Array.isArray(anomalies) || anomalies.length === 0) return recs;

  const byCode = new Map();
  for (const a of anomalies) {
    if (!byCode.has(a.code)) byCode.set(a.code, a);
  }

  for (const [code, anomaly] of byCode) {
    const builder = _RECO_BUILDERS[code];
    const built = builder
      ? builder(anomaly, snapshot)
      : { action: anomaly.message, command: null };
    recs.push({ code, severity: anomaly.severity, ...built });
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

export const REVIEW_SOURCES = Object.freeze(new Set([
  "crucible-stall", "tempering-quorum-inconclusive",
  "tempering-baseline", "bug-classify", "fix-plan-approval",
]));
export const REVIEW_SEVERITIES = Object.freeze(new Set(["blocker", "high", "medium", "low"]));
export const REVIEW_STATUSES = Object.freeze(new Set(["open", "resolved", "deferred"]));
export const REVIEW_RESOLUTIONS = Object.freeze(new Set(["approve", "reject", "defer"]));

export function ensureReviewQueueDirs(projectRoot) {
  return ensureForgeDir("review-queue", projectRoot);
}

// Phase FORGE-SHOP-03 Slice 03.1 — Notification system
export function ensureNotificationsDirs(projectRoot) {
  return ensureForgeDir("notifications", projectRoot);
}

export function ensureNotificationsConfig(projectRoot) {
  const dir = ensureNotificationsDirs(projectRoot);
  const configPath = resolve(dir, "config.json");
  if (!existsSync(configPath)) {
    const seed = {
      enabled: false,
      adapters: { webhook: { enabled: false, url: "${env:PFORGE_WEBHOOK_URL}" } },
      routes: [
        { when: { event: "slice-failed" }, via: ["webhook"] },
        { when: { event: "run-aborted" }, via: ["webhook"] },
        { when: { event: "run-completed" }, via: ["webhook"] },
      ],
      rateLimit: { perMinute: 10, digestAfter: 5 },
    };
    try {
      writeFileSync(configPath, JSON.stringify(seed, null, 2) + "\n", { flag: "wx" });
    } catch { /* race-safe: another process created it first */ }
  }
  return configPath;
}

export function generateReviewItemId(projectRoot, nowFn = () => new Date()) {
  const dir = ensureReviewQueueDirs(projectRoot);
  const date = nowFn().toISOString().slice(0, 10);
  const prefix = `review-${date}-`;

  let existing = [];
  try {
    existing = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .map((f) => {
        const numStr = f.slice(prefix.length, -5);
        return parseInt(numStr, 10);
      })
      .filter((n) => !isNaN(n));
  } catch { /* empty dir or unreadable */ }

  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export function readReviewItem(targetPath, itemId) {
  const filePath = resolve(targetPath, ".forge", "review-queue", `${itemId}.json`);
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}


export function addReviewItem(targetPath, input, hub = null, captureMemoryFn = null) {
  if (!REVIEW_SOURCES.has(input.source)) {
    const err = new Error(`Invalid source: ${input.source}. Must be one of: ${[...REVIEW_SOURCES].join(", ")}`);
    err.code = "ERR_INVALID_SOURCE";
    throw err;
  }
  if (!REVIEW_SEVERITIES.has(input.severity)) {
    const err = new Error(`Invalid severity: ${input.severity}. Must be one of: ${[...REVIEW_SEVERITIES].join(", ")}`);
    err.code = "ERR_INVALID_SEVERITY";
    throw err;
  }
  if (!input.title || typeof input.title !== "string" || !input.title.trim()) {
    const err = new Error("Title is required and must be a non-empty string");
    err.code = "ERR_INVALID_TITLE";
    throw err;
  }
  if (input.context !== undefined && input.context !== null && typeof input.context !== "object") {
    const err = new Error("Context must be an object, not a string or primitive");
    err.code = "ERR_INVALID_CONTEXT";
    throw err;
  }

  const itemId = generateReviewItemId(targetPath, input._nowFn);
  const now = (input._nowFn || (() => new Date()))().toISOString();
  const record = {
    _v: 1,
    itemId,
    source: input.source,
    severity: input.severity,
    title: input.title.trim(),
    context: input.context || null,
    correlationId: input.correlationId || null,
    status: "open",
    createdAt: now,
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    note: null,
  };

  const dir = ensureReviewQueueDirs(targetPath);
  const filePath = resolve(dir, `${itemId}.json`);
  try {
    writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: "wx" });
  } catch (wxErr) {
    if (wxErr.code === "EEXIST") {
      // Collision: retry with next sequence
      const retryId = generateReviewItemId(targetPath, input._nowFn);
      record.itemId = retryId;
      const retryPath = resolve(dir, `${retryId}.json`);
      writeFileSync(retryPath, JSON.stringify(record, null, 2), { flag: "wx" });
    } else {
      throw wxErr;
    }
  }

  try {
    hub?.broadcast({
      type: "review-queue-item-added",
      itemId: record.itemId,
      source: record.source,
      severity: record.severity,
      correlationId: record.correlationId,
      timestamp: now,
    });
  } catch { /* hub broadcast is best-effort */ }

  return record;
}

export function resolveReviewItem(targetPath, input, hub = null, captureMemoryFn = null) {
  const existing = readReviewItem(targetPath, input.itemId);
  if (!existing) {
    const err = new Error(`Review item not found: ${input.itemId}`);
    err.code = "ERR_ITEM_NOT_FOUND";
    throw err;
  }
  if (!REVIEW_RESOLUTIONS.has(input.resolution)) {
    const err = new Error(`Invalid resolution: ${input.resolution}. Must be one of: ${[...REVIEW_RESOLUTIONS].join(", ")}`);
    err.code = "ERR_INVALID_RESOLUTION";
    throw err;
  }
  if (!input.resolvedBy || typeof input.resolvedBy !== "string" || !input.resolvedBy.trim()) {
    const err = new Error("resolvedBy is required and must be a non-empty string");
    err.code = "ERR_INVALID_RESOLVED_BY";
    throw err;
  }
  if (existing.status !== "open") {
    const err = new Error(`Item ${input.itemId} is already ${existing.status}`);
    err.code = "ERR_ALREADY_RESOLVED";
    throw err;
  }

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    status: input.resolution === "defer" ? "deferred" : "resolved",
    resolution: input.resolution,
    resolvedBy: input.resolvedBy.trim(),
    resolvedAt: now,
    note: input.note || null,
  };

  const filePath = resolve(targetPath, ".forge", "review-queue", `${input.itemId}.json`);
  writeFileSync(filePath, JSON.stringify(updated, null, 2));

  try {
    hub?.broadcast({
      type: "review-queue-item-resolved",
      itemId: input.itemId,
      resolution: input.resolution,
      resolvedBy: input.resolvedBy.trim(),
      timestamp: now,
    });
  } catch { /* hub broadcast is best-effort */ }

  try {
    captureMemoryFn?.(
      `Review ${input.itemId} ${input.resolution} by ${input.resolvedBy}`,
      "decision",
      "forge_review_resolve",
      targetPath
    );
  } catch { /* L3 capture is best-effort */ }

  return updated;
}

// ─── Phase FORGE-SHOP-02 Slice 02.2 — Review Queue Producer Hooks ────

/**
 * Shared producer hook pattern.  Each `maybeAdd*Review` helper:
 *   1. Short-circuits in NODE_ENV=test (no side-effects)
 *   2. Checks for an existing open item with the same correlationId+source (idempotence)
 *   3. Creates a new review item if none exists
 *   4. Catches all errors — never propagates to the caller
 */

export function maybeAddStallReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "crucible-stall",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "crucible-stall",
      severity: "medium",
      title: args.title || `Crucible smelt stalled — ${args.correlationId}`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddStallReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddTemperingReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "tempering-quorum-inconclusive",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "tempering-quorum-inconclusive",
      severity: "medium",
      title: args.title || `Tempering quorum inconclusive — ${args.correlationId}`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddTemperingReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddBugReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "bug-classify",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "bug-classify",
      severity: args.severity || "blocker",
      title: args.title || `Bug ${args.correlationId} needs human review (critical/functional)`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddBugReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddVisualBaselineReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "tempering-baseline",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "tempering-baseline",
      severity: "medium",
      title: args.title || `Visual regression — review baseline update`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddVisualBaselineReview failed: ${err.message}`); } catch {}
    return null;
  }
}

export function maybeAddFixPlanReview(root, args, hub, captureMemoryFn) {
  if (process.env.NODE_ENV === "test") return null;
  try {
    const existing = listReviewItems(root, {
      correlationId: args.correlationId,
      source: "fix-plan-approval",
      status: "open",
    });
    if (existing.length > 0) return existing[0];
    return addReviewItem(root, {
      source: "fix-plan-approval",
      severity: args.severity || "high",
      title: args.title || `Fix proposal ${args.correlationId} pending approval`,
      context: args.context || null,
      correlationId: args.correlationId,
    }, hub, captureMemoryFn);
  } catch (err) {
    try { console.warn(`[review-hook] maybeAddFixPlanReview failed: ${err.message}`); } catch {}
    return null;
  }
}

// Phase-53 S7: buildWatchSnapshot, clampActivityTail, buildCrucibleQuadrant,
// buildActiveRunsQuadrant, buildLiveguardQuadrant, buildTemperingQuadrant,
// buildActivityFeed, readHomeSnapshot → orchestrator/review-watcher.mjs


// Phase-53 S7: detectWatchAnomalies, recommendFromAnomalies → orchestrator/review-watcher.mjs


/**
 * Build the watcher analyzer prompt for the frontier model.
 */
function buildWatcherPrompt(snapshot, anomalies) {
  const lines = [
    "You are the Plan Forge WATCHER — a read-only observer of another AI agent's plan execution.",
    "You CANNOT modify any files. Your job is to:",
    "  1. Summarize the watched run's current state in 2-3 sentences.",
    "  2. Flag anomalies, regressions, or concerning patterns.",
    "  3. Recommend specific corrective actions the executing agent should take.",
    "",
    "Be concise. Prefer concrete recommendations over generic observations.",
    "When advising commands, format them as: `pforge <command>` or shell snippets.",
    "",
    "--- SNAPSHOT ---",
    JSON.stringify({
      targetPath: snapshot.targetPath,
      runId: snapshot.runId,
      runState: snapshot.runState,
      plan: snapshot.plan,
      model: snapshot.model,
      counts: snapshot.counts,
      lastEventAgeMs: snapshot.lastEventAgeMs,
      summary: snapshot.summary
        ? {
            status: snapshot.summary.status,
            results: snapshot.summary.results,
            totalDuration: snapshot.summary.totalDuration,
            totalTokensOut: snapshot.summary.totalTokensOut,
            cost: snapshot.summary.cost?.total_cost_usd,
          }
        : null,
      artifacts: snapshot.artifacts,
    }, null, 2),
    "",
    "--- HEURISTIC ANOMALIES (already detected) ---",
    anomalies.length === 0 ? "(none)" : JSON.stringify(anomalies, null, 2),
    "",
    "--- LAST 25 EVENTS ---",
    JSON.stringify(snapshot.events, null, 2),
    "",
    "Produce your watcher report as Markdown with sections: ## Status / ## Anomalies / ## Recommendations.",
  ];
  return lines.join("\n");
}

/**
 * (v2.35) Append a watcher observation to the watcher's OWN .forge/watch-history.jsonl.
 * NEVER writes inside the target project — preserves the read-only contract.
 *
 * @param {object} report - Watcher report
 * @param {string} watcherCwd - Watcher's own working directory
 */
export function appendWatchHistory(report, watcherCwd = process.cwd()) {
  try {
    const historyDir = resolve(watcherCwd, ".forge");
    if (!existsSync(historyDir)) mkdirSync(historyDir, { recursive: true });
    const historyPath = resolve(historyDir, "watch-history.jsonl");
    const record = {
      ts: report.timestamp || new Date().toISOString(),
      targetPath: report.targetPath,
      runId: report.runId,
      runState: report.runState,
      mode: report.mode,
      anomalyCount: Array.isArray(report.anomalies) ? report.anomalies.length : 0,
      anomalyCodes: Array.isArray(report.anomalies) ? report.anomalies.map((a) => a.code) : [],
      counts: report.counts,
      cursor: report.cursor || null,
    };
    appendFileSync(historyPath, JSON.stringify(record) + "\n");
    return { ok: true, path: historyPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Watch another project's pforge execution. Read-only.
 *
 * Modes:
 *   - "snapshot": Return current state + heuristic anomalies. No AI call. Cheap.
 *   - "analyze":  Snapshot + invoke frontier model for advice. Costs a worker call.
 *
 * @param {object} options
 * @param {string} options.targetPath  - Absolute path to project being watched
 * @param {string} [options.runId]     - Specific run dir; default = latest
 * @param {"snapshot"|"analyze"} [options.mode="snapshot"]
 * @param {string} [options.model]     - Override watcher model (default: claude-opus-4.7)
 * @param {number} [options.timeout=300000] - Worker timeout for analyze mode
 * @param {number} [options.tailEvents=25] - Trailing events (1-200)
 * @param {string} [options.sinceTimestamp] - (v2.35) Only flag events newer than this ISO timestamp
 * @param {boolean} [options.recordHistory=true] - (v2.35) Append to watcher's .forge/watch-history.jsonl
 * @param {object} [options.eventBus] - (v2.35) Optional event bus to emit watch-* events
 * @returns {Promise<object>} Watcher report
 */
function _validateRunWatchTarget(targetPath) {
  if (!targetPath) {
    return { ok: false, error: "targetPath is required" };
  }
  const resolved = resolve(targetPath);
  if (!existsSync(resolved)) {
    return { ok: false, error: `Target path does not exist: ${resolved}` };
  }
  return { ok: true, resolved };
}

async function _runWatchCrossRun(resolved, crossRunWindow) {
  const xSnap = await buildCrossRunSnapshot(resolved, { window: crossRunWindow });
  const xAnomalies = detectWatchAnomalies(xSnap);
  const xRecs = recommendFromAnomalies(xAnomalies, xSnap);
  return {
    ok: xSnap.ok,
    mode: WATCHER_MODE_CROSS_RUN,
    targetPath: resolved,
    crossRunWindow,
    timestamp: new Date().toISOString(),
    totalRuns: xSnap.totalRuns,
    passedRuns: xSnap.passedRuns,
    failedRuns: xSnap.failedRuns,
    runs: xSnap.runs,
    anomalies: xAnomalies,
    recommendations: xRecs,
    snapshot: xSnap,
  };
}

function _buildRunWatchReport({ snapshot, anomalies, recommendations, mode, model }) {
  return {
    ok: true,
    mode,
    watcherModel: mode === WATCHER_MODE_ANALYZE ? model : null,
    targetPath: snapshot.targetPath,
    runId: snapshot.runId,
    runState: snapshot.runState,
    lastEventType: snapshot.lastEventType,
    plan: snapshot.plan,
    counts: snapshot.counts,
    lastEventAgeMs: snapshot.lastEventAgeMs,
    tailEvents: snapshot.tailEvents,
    cursor: snapshot.cursor,
    sinceTimestamp: snapshot.sinceTimestamp,
    hasNewEvents: snapshot.hasNewEvents,
    newEventsCount: snapshot.newEventsCount,
    summary: snapshot.summary
      ? {
          status: snapshot.summary.status,
          results: snapshot.summary.results,
          totalDuration: snapshot.summary.totalDuration,
          totalTokensOut: snapshot.summary.totalTokensOut,
          cost: snapshot.summary.cost?.total_cost_usd,
        }
      : null,
    artifacts: snapshot.artifacts,
    anomalies,
    recommendations,
    crucible: snapshot.crucible,
    tempering: snapshot.tempering,
    timestamp: new Date().toISOString(),
  };
}

function _compactCrucible(crucible) {
  if (!crucible) return null;
  return {
    total: crucible.counts.total,
    finalized: crucible.counts.finalized,
    in_progress: crucible.counts.in_progress,
    abandoned: crucible.counts.abandoned,
    staleInProgress: crucible.staleInProgress,
    orphanHandoffs: crucible.orphanHandoffs.length,
    stallCutoffDays: crucible.stallCutoffDays,
  };
}

function _compactTempering(tempering) {
  if (!tempering) return null;
  return {
    totalScans: tempering.totalScans,
    latestStatus: tempering.latestStatus,
    latestScanAgeMs: tempering.latestScanAgeMs,
    latestScanTs: tempering.latestScanTs,
    gaps: tempering.gaps,
    belowMinimum: tempering.belowMinimum,
    stale: tempering.stale,
    staleCutoffDays: tempering.staleCutoffDays,
  };
}

function _emitWatchSnapshotEvents(eventBus, report, anomalies, snapshot) {
  if (!(eventBus && typeof eventBus.emit === "function")) return;
  try {
    eventBus.emit("watch-snapshot-completed", {
      targetPath: report.targetPath,
      runId: report.runId,
      runState: report.runState,
      anomalyCount: anomalies.length,
      cursor: report.cursor,
      crucible: _compactCrucible(report.crucible),
      tempering: _compactTempering(report.tempering),
      home: snapshot.home || null,
    });
    for (const anomaly of anomalies) {
      eventBus.emit("watch-anomaly-detected", {
        targetPath: report.targetPath,
        runId: report.runId,
        ...anomaly,
      });
    }
  } catch { /* never throw from event emission */ }
}

async function _runWatcherAnalyzeMode({ snapshot, anomalies, report, model, timeout, eventBus }) {
  const prompt = buildWatcherPrompt(snapshot, anomalies);
  const watcherCwd = process.cwd();
  try {
    const result = await spawnWorker(prompt, { model, cwd: watcherCwd, timeout });
    report.advice = result.output || "(no advice returned)";
    report.tokens = result.tokens || null;
    report.workerExitCode = result.exitCode;
    if (eventBus && typeof eventBus.emit === "function") {
      try {
        eventBus.emit("watch-advice-generated", {
          targetPath: report.targetPath,
          runId: report.runId,
          model,
          tokensOut: result.tokens?.tokens_out || null,
        });
      } catch { /* never throw */ }
    }
  } catch (err) {
    report.adviceError = err.message;
  }
}

function _recordWatchHistoryIfEnabled(report, recordHistory) {
  if (recordHistory) appendWatchHistory(report);
}

async function _buildRunWatchSnapshotReport({ resolved, runId, tailEvents, sinceTimestamp, mode, model, eventBus }) {
  const snapshot = await buildWatchSnapshot(resolved, runId, { tailEvents, sinceTimestamp });
  if (!snapshot.ok) return { snapshot };
  snapshot.targetPath = resolved;
  const anomalies = detectWatchAnomalies(snapshot);
  const recommendations = recommendFromAnomalies(anomalies, snapshot);
  const report = _buildRunWatchReport({ snapshot: snapshot, anomalies: anomalies, recommendations: recommendations, mode: mode, model: model });
  _emitWatchSnapshotEvents(eventBus, report, anomalies, snapshot);
  return { snapshot, anomalies, report };
}

export async function runWatch(options = {}) {
  const {
    targetPath,
    runId = null,
    mode = WATCHER_MODE_SNAPSHOT,
    crossRunWindow = "14d",
    model = DEFAULT_WATCHER_MODEL,
    timeout = 300_000,
    tailEvents = 25,
    sinceTimestamp = null,
    recordHistory = true,
    eventBus = null,
  } = options;

  const validated = _validateRunWatchTarget(targetPath);
  if (!validated.ok) return validated;
  const resolved = validated.resolved;
  if (mode === WATCHER_MODE_CROSS_RUN) {
    return _runWatchCrossRun(resolved, crossRunWindow);
  }

  const snapshotResult = await _buildRunWatchSnapshotReport({
    resolved,
    runId,
    tailEvents,
    sinceTimestamp,
    mode,
    model,
    eventBus,
  });
  if (!snapshotResult.snapshot.ok) return snapshotResult.snapshot;
  if (mode === WATCHER_MODE_ANALYZE) {
    await _runWatcherAnalyzeMode(
      { snapshot: snapshotResult.snapshot, anomalies: snapshotResult.anomalies, report: snapshotResult.report, model: model, timeout: timeout, eventBus: eventBus },
    );
  }
  _recordWatchHistoryIfEnabled(snapshotResult.report, recordHistory);
  return snapshotResult.report;
}

/**
 * (v2.35) Connect to a target project's WebSocket hub for live event streaming.
 * Falls back to polling buildWatchSnapshot if hub is not running.
 *
 * Read-only by design: only subscribes to events; never sends any messages
 * to the target hub other than the initial label handshake.
 *
 * @param {object} options
 * @param {string} options.targetPath - Absolute path to project being watched
 * @param {(event: object) => void} options.onEvent - Callback per event received
 * @param {(error: Error) => void} [options.onError] - Optional error callback
 * @param {number} [options.durationMs=60000] - How long to listen (1-3600s window)
 * @param {number} [options.pollIntervalMs=3000] - Polling interval if hub not available
 * @returns {Promise<{ ok: boolean, mode: "websocket"|"polling", events: number, durationMs: number, error?: string }>}
 */
export async function runWatchLive(options = {}) {
  const {
    targetPath,
    onEvent,
    onError,
    durationMs = 60_000,
    pollIntervalMs = 3_000,
  } = options;

  if (!targetPath) return { ok: false, error: "targetPath is required" };
  if (typeof onEvent !== "function") return { ok: false, error: "onEvent callback is required" };
  const resolved = resolve(targetPath);
  if (!existsSync(resolved)) return { ok: false, error: `Target path does not exist: ${resolved}` };

  const cappedDuration = Math.min(3_600_000, Math.max(1_000, durationMs));

  // Try WebSocket connection to target's hub
  const portsPath = resolve(resolved, ".forge", "server-ports.json");
  let hubInfo = null;
  if (existsSync(portsPath)) {
    try { hubInfo = JSON.parse(readFileSync(portsPath, "utf-8")); } catch { /* fall through */ }
  }

  if (hubInfo?.ws) {
    // WebSocket mode
    let ws;
    let WSCtor;
    try {
      WSCtor = (await import("ws")).default;
    } catch (err) {
      // ws library not installed; fall through to polling
      hubInfo = null;
    }

    if (WSCtor) {
      return new Promise((resolveP) => {
        let eventCount = 0;
        let timer = null;
        const url = `ws://127.0.0.1:${hubInfo.ws}?label=watcher-${Date.now()}`;
        try {
          ws = new WSCtor(url);
        } catch (err) {
          return resolveP({ ok: false, mode: "websocket", events: 0, durationMs: 0, error: err.message });
        }

        const cleanup = (result) => {
          if (timer) clearTimeout(timer);
          try { ws.close(); } catch { /* ignore */ }
          resolveP(result);
        };

        ws.on("open", () => {
          timer = setTimeout(() => cleanup({ ok: true, mode: "websocket", events: eventCount, durationMs: cappedDuration }), cappedDuration);
        });

        ws.on("message", (raw) => {
          try {
            const event = JSON.parse(raw.toString());
            eventCount++;
            onEvent(event);
          } catch { /* skip malformed */ }
        });

        ws.on("error", (err) => {
          if (typeof onError === "function") onError(err);
        });

        ws.on("close", () => {
          if (timer) {
            // Connection closed before duration expired — return what we got
            cleanup({ ok: true, mode: "websocket", events: eventCount, durationMs: Date.now() % cappedDuration });
          }
        });
      });
    }
  }

  // Polling fallback — diff cursor pattern
  return new Promise((resolveP) => {
    let cursor = null;
    let eventCount = 0;
    const startTime = Date.now();

    const poll = async () => {
      try {
        const snap = await buildWatchSnapshot(resolved, null, { tailEvents: 200, sinceTimestamp: cursor });
        if (snap.ok) {
          // Yield only events newer than cursor
          if (cursor) {
            const cutoffMs = new Date(cursor).getTime();
            for (const ev of snap.events) {
              if (new Date(ev.ts).getTime() > cutoffMs) {
                eventCount++;
                onEvent(ev);
              }
            }
          } else {
            // First poll — yield all in tail
            for (const ev of snap.events) {
              eventCount++;
              onEvent(ev);
            }
          }
          cursor = snap.cursor || cursor;
        }
      } catch (err) {
        if (typeof onError === "function") onError(err);
      }

      if (Date.now() - startTime >= cappedDuration) {
        return resolveP({ ok: true, mode: "polling", events: eventCount, durationMs: cappedDuration });
      }
      setTimeout(poll, pollIntervalMs);
    };

    poll();
  });
}

