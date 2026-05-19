import { resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
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

  // Build dispatcher: POST to local /api/memory/capture
  const dispatcher = deps.dispatcher || async function defaultDispatcher(record) {
    const port = process.env.PFORGE_DASHBOARD_PORT || "3100";
    let secret = null;
    try {
      const secretPath = resolve(forgeDir, "bridge-secret");
      if (existsSync(secretPath)) secret = readFileSync(secretPath, "utf-8").trim();
    } catch { /* no secret */ }
    if (!secret) secret = process.env.PFORGE_BRIDGE_SECRET || null;

    const headers = { "Content-Type": "application/json" };
    if (secret) headers["Authorization"] = `Bearer ${secret}`;

    const resp = await fetch(`http://127.0.0.1:${port}/api/memory/capture`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: record.content,
        project: record.project,
        type: record.type,
        source: record.source,
        created_by: record.created_by,
      }),
    });
    return { ok: resp.ok, error: resp.ok ? undefined : `HTTP_${resp.status}` };
  };

  const t0 = Date.now();
  const result = await drainOpenBrainQueue(records, dispatcher, { source });

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


/** Reset the planPath-alias deprecation warning flag. Exported for testing only. */
export function __resetPlanPathAliasWarned() {
  setPlanPathAliasWarned(false);
}

/** Check whether the initialize-time drain should run. Exported for testing. */
export function __shouldDrainOnInit() {
  return process.env.PFORGE_DRAIN_ON_INIT !== "false";
}
