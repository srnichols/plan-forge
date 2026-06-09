import { resolve } from "node:path";
import { existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { drainOpenBrainQueue, isOpenBrainConfigured } from "../memory.mjs";
import { readForgeJsonl, appendForgeJsonl } from "../orchestrator.mjs";
import { setPlanPathAliasWarned } from "./state.mjs";

export async function runDrainPass(cwd, source, hub, deps = {}) {
  if (!isOpenBrainConfigured(cwd)) {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  const forgeDir = resolve(cwd, ".forge");
  const queuePath = resolve(forgeDir, "openbrain-queue.jsonl");

  // Read queue — empty/missing is a no-op success
  const records = readForgeJsonl("openbrain-queue.jsonl", [], cwd);
  if (!records.length) {
    return { ok: true, attempted: 0, delivered: 0, deferred: 0, dlq: 0, durationMs: 0 };
  }

  // Build dispatcher. The default path opens a SINGLE SSE client to OpenBrain
  // and captures each normalized record through it. The local Express endpoint
  // `POST /api/memory/capture` is an intentional no-op echo and MUST NOT be
  // used for delivery — records POSTed there are counted as "delivered" but
  // never reach OpenBrain (issue #215). Tests inject `deps.dispatcher` directly.
  let dispatcher = deps.dispatcher;
  let closeClient = async () => {};
  if (!dispatcher) {
    const built = await buildSseDispatcher(cwd);
    if (built.error) return { ok: false, error: built.error };
    dispatcher = built.dispatcher;
    closeClient = built.closeClient;
  }

  const t0 = Date.now();
  let result;
  try {
    result = await drainOpenBrainQueue(records, dispatcher, { source });
  } finally {
    await closeClient();
  }

  // Atomic write: survivors (deferred) → tmp file, then rename over original
  const tmpPath = queuePath + ".tmp";
  try {
    mkdirSync(forgeDir, { recursive: true });
    const survivorLines = result.deferred.map(r => JSON.stringify(r)).join("\n");
    writeFileSync(tmpPath, survivorLines ? survivorLines + "\n" : "", "utf-8");
    renameSync(tmpPath, queuePath);
  } catch (err) {
    // Atomic write failed — preserve original queue file
    try { if (existsSync(tmpPath)) writeFileSync(tmpPath, "", "utf-8"); } catch { /* cleanup best-effort */ }
    return { ok: false, error: `atomic-write-failed: ${err.message}` };
  }

  // Append archive records
  for (const rec of result.archive) {
    appendForgeJsonl("openbrain-queue.archive.jsonl", rec, cwd);
  }

  // Append DLQ records
  for (const rec of result.dlq) {
    appendForgeJsonl("openbrain-dlq.jsonl", rec, cwd);
  }

  // Append stats record
  appendForgeJsonl("openbrain-stats.jsonl", result.stats, cwd);

  // Broadcast hub event
  if (hub && typeof hub.broadcast === "function") {
    hub.broadcast({
      type: "openbrain-flush",
      attempted: result.stats.attempted,
      delivered: result.stats.delivered,
      deferred: result.stats.deferred,
      dlq: result.stats.dlq,
      durationMs: result.stats.durationMs,
      source,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    ok: true,
    attempted: result.stats.attempted,
    delivered: result.stats.delivered,
    deferred: result.stats.deferred,
    dlq: result.stats.dlq,
    durationMs: Date.now() - t0,
  };
}

/**
 * Build the default SSE dispatcher used by `runDrainPass` when no test
 * dispatcher is injected. Opens a single OpenBrain SSE client and captures
 * each normalized queue record through it — mirrors the working
 * `_buildOpenBrainDispatcher` path in `memory.mjs` (issue #215).
 *
 * @param {string} cwd
 * @returns {Promise<{ dispatcher?: Function, closeClient?: () => Promise<void>, error?: string }>}
 */
async function buildSseDispatcher(cwd) {
  const { createSseClient, readOpenBrainConfig, normalizeQueueRecord } =
    await import("../openbrain-replay.mjs");

  const cfg = readOpenBrainConfig(cwd);
  if (!cfg || !cfg.url || !cfg.key) return { error: "NO_CONFIG" };

  let client;
  try {
    client = await createSseClient(cfg);
  } catch (err) {
    return { error: `connect: ${err.message}` };
  }
  const closeClient = async () => { try { await client.close(); } catch { /* best-effort */ } };

  const dispatcher = async (record) => {
    const payload = normalizeQueueRecord(record);
    if (!payload) return { ok: true };
    try {
      await client.capture(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  };
  return { dispatcher, closeClient };
}


/** Reset the planPath-alias deprecation warning flag. Exported for testing only. */
export function __resetPlanPathAliasWarned() {
  setPlanPathAliasWarned(false);
}

/** Check whether the initialize-time drain should run. Exported for testing. */
export function __shouldDrainOnInit() {
  return process.env.PFORGE_DRAIN_ON_INIT !== "false";
}
