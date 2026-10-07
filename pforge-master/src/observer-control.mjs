/**
 * Observer control — owns the in-process observer used by `forge_master_observe`.
 *
 * Each batch flushed by the observer loop runs one `runObserverTurn`, which
 * enforces the daily/hourly budget, emits `observer:narration` and
 * `forge-master-insight` on the supplied hub, and retains insights in the ring
 * that `status` pages through. Batch handling never throws.
 *
 * @module forge-master/observer-control
 */

import { getForgeMasterConfig } from "./config.mjs";
import { startObserver as defaultStartObserver } from "./observer-loop.mjs";
import { insightRing as defaultInsightRing, paginateInsights } from "./observer-insights.mjs";
import { runObserverTurn as defaultRunObserverTurn } from "./reasoning.mjs";

export const OBSERVER_KILL_SWITCH_ENV = "PFORGE_FORGE_MASTER_OBSERVE_DISABLE";
export const MAX_OBSERVED_BATCHES = 20;
const STATUS_BATCH_ECHO = 5;
const MAX_REASON_CHARS = 200;

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean} Whether the process-level observer kill switch is set
 */
export function isObserverKillSwitchOn(env = process.env) {
  return env?.[OBSERVER_KILL_SWITCH_ENV] === "1";
}

function summarizeTurn(result) {
  return {
    at: new Date().toISOString(),
    ok: Boolean(result?.ok),
    ...(result?.skipped && { skipped: true }),
    ...(result?.reason && { reason: String(result.reason).slice(0, MAX_REASON_CHARS) }),
    insightCount: Array.isArray(result?.insights) ? result.insights.length : 0,
  };
}

function describeEmptyInsights({ running, batchesAnalysed, lastTurn, killSwitch, batchWindowMs }) {
  if (killSwitch) return `No observer insights — observer turns are disabled because ${OBSERVER_KILL_SWITCH_ENV}=1.`;
  if (!running && batchesAnalysed === 0) return "No observer insights — the observer is not running. Start it with action:'start'; insights appear after a batch with notable events is analysed.";
  if (lastTurn && !lastTurn.ok) return `No observer insights yet — the last observer turn did not complete (${lastTurn.reason ?? "unknown reason"}).`;
  if (batchesAnalysed === 0) {
    const window = Number.isFinite(batchWindowMs) ? ` (batches flush every ${Math.round(batchWindowMs / 1000)} s)` : "";
    return `No observer insights yet — waiting for the first batch of hub events${window}.`;
  }
  return `No observer insights yet — ${batchesAnalysed} batch(es) analysed and nothing notable was reported.`;
}

/**
 * Create the observer controller backing `forge_master_observe`.
 *
 * @param {{
 *   hub?: { broadcast: Function } | null,  Hub for observer:narration and forge-master-insight events.
 *   getConfig?: Function,                  getForgeMasterConfig override.
 *   startObserver?: Function,              observer-loop startObserver override.
 *   runObserverTurn?: Function,            reasoning runObserverTurn override.
 *   insightRing?: object,                  Insight ring override.
 *   env?: Record<string, string|undefined>,
 *   turnOptions?: object,                  Extra runObserverTurn options (provider, budget overrides).
 * }} [deps]
 * @returns {{ start: Function, stop: Function, status: Function, handleBatch: Function, getObserver: Function }}
 */
export function createObserverController({
  hub = null,
  getConfig = getForgeMasterConfig,
  startObserver = defaultStartObserver,
  runObserverTurn = defaultRunObserverTurn,
  insightRing = defaultInsightRing,
  env = process.env,
  turnOptions = {},
} = {}) {
  let observer = null;
  let turnInFlight = false;
  let batchesAnalysed = 0;
  let lastTurn = null;
  const batches = [];

  function recordBatch(batch) {
    batches.push({ receivedAt: new Date().toISOString(), events: batch });
    if (batches.length > MAX_OBSERVED_BATCHES) batches.shift();
  }

  async function analyseBatch(batch, cwd) {
    turnInFlight = true;
    try {
      const config = getConfig({ cwd });
      const result = await runObserverTurn(batch, { ...turnOptions, hub, cwd, config, insightRing });
      batchesAnalysed += 1;
      lastTurn = summarizeTurn(result);
      return result;
    } finally {
      turnInFlight = false;
    }
  }

  async function handleBatch(batch, cwd) {
    try {
      recordBatch(batch);
      console.error(`[forge_master_observe] batch: ${batch.length} event(s)`);
      if (isObserverKillSwitchOn(env)) {
        lastTurn = summarizeTurn({ ok: false, skipped: true, reason: `${OBSERVER_KILL_SWITCH_ENV}=1` });
        return null;
      }
      if (turnInFlight) {
        console.error("[forge_master_observe] previous observer turn still running — batch not analysed");
        return null;
      }
      return await analyseBatch(batch, cwd);
    } catch (err) {
      console.error(`[forge_master_observe] observer turn failed (non-fatal): ${err?.message ?? err}`);
      lastTurn = summarizeTurn({ ok: false, reason: err?.message ?? String(err) });
      return null;
    }
  }

  function isRunning() {
    return Boolean(observer && !observer.getStatus().stopped);
  }

  function start(cwd) {
    if (isObserverKillSwitchOn(env)) {
      return { ok: false, error: "observer-disabled", message: `Observer is disabled by ${OBSERVER_KILL_SWITCH_ENV}=1.` };
    }
    if (!getConfig({ cwd }).observer?.enabled) {
      return { ok: false, error: "observer-disabled", message: "Observer is disabled. Set forgeMaster.observer.enabled: true in .forge.json to enable." };
    }
    if (isRunning()) return { ok: true, message: "Observer already running.", status: observer.getStatus() };

    batches.length = 0;
    batchesAnalysed = 0;
    lastTurn = null;
    observer = startObserver({ cwd, onBatch: (batch) => handleBatch(batch, cwd) });
    console.error("forge-master-server: observer started");
    return { ok: true, message: "Observer started. Subscribing to hub events.", status: observer.getStatus() };
  }

  function stop() {
    if (!isRunning()) return { ok: true, message: "Observer is not running." };
    observer.stop();
    console.error("forge-master-server: observer stopped");
    return { ok: true, message: "Observer stopped.", status: observer.getStatus() };
  }

  function status(args = {}) {
    const includeInsights = args.limit !== undefined || args.cursor !== undefined;
    const page = includeInsights ? paginateInsights(args, insightRing) : null;
    if (page && !page.ok) return page;

    const observerStatus = observer
      ? observer.getStatus()
      : { connected: false, stopped: true, message: "Observer has not been started." };
    const response = {
      ok: true,
      status: observerStatus,
      recentBatches: batches.slice(-STATUS_BATCH_ECHO),
      lastTurn,
    };
    if (page) {
      response.insights = page.total === 0
        ? { ...page, message: describeEmptyInsights({ running: isRunning(), batchesAnalysed, lastTurn, killSwitch: isObserverKillSwitchOn(env), batchWindowMs: observerStatus.batchWindowMs }) }
        : page;
    }
    return response;
  }

  return { start, stop, status, handleBatch, getObserver: () => observer };
}
