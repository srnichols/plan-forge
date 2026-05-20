/** Plan Forge — Phase-53 S9: event bus sub-module */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";
import { EVENT_SOURCE, SECURITY_RISK, SECURITY_RISK_FOR_TYPE } from "./constants.mjs";

export class LogEventHandler {
  constructor(logDir) {
    this.logDir = logDir;
    this.events = [];
  }

  handle(event) {
    const data = appendEvent(event.type, event.data, this.logDir);
    this.events.push({ type: event.type, data, timestamp: event.timestamp });
  }
}

/**
 * Orchestrator event bus with dependency-injected handler.
 * Wraps Node EventEmitter. Handler can be swapped for WebSocket hub (Phase 3).
 */
export class OrchestratorEventBus extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler || new LogEventHandler(null);
    // Proxy all known events to the handler
    const events = [
      "run-started", "slice-started", "slice-completed",
      "slice-failed", "slice-escalated", "run-completed", "run-aborted",
      "quorum-dispatch-started", "quorum-leg-completed", "quorum-review-completed",
      "skill-started", "skill-step-started", "skill-step-completed", "skill-completed",
      "slice-model-routed", "self-repair-missed",
      "tool-call", "bridge-edit-blocked", "bridge-edit-approved",
      "pforge.foundry.quota",
      "snapshot-janitor",
    ];
    for (const evt of events) {
      this.on(evt, (data) => this.handler.handle({ type: evt, data, timestamp: new Date().toISOString() }));
    }
  }
}

/**
 * Stamp `source` and `security_risk` into event data and write the event
 * to the run's events.log file. This is the canonical write path for all
 * lifecycle events.
 *
 * Defaults:
 *   source        → EVENT_SOURCE.ORCHESTRATOR ("orchestrator")
 *   security_risk → SECURITY_RISK.NONE ("none")
 *
 * Callers that know the risk level (e.g. slice-started, bridge-edit-blocked)
 * should pass the appropriate value in `data`; it overrides the default.
 *
 * Line format (byte-for-byte stable): [ISO-timestamp] type: {json}
 *
 * @param {string} type    - Event type identifier (e.g. "slice-started")
 * @param {object} data    - Event payload; may include source / security_risk overrides
 * @param {string|null} logDir - Directory where events.log lives; null = skip write
 * @returns {object} stamped - The stamped data object (with source + security_risk)
 */
export function appendEvent(type, data, logDir) {
  const stamped = {
    source: EVENT_SOURCE.ORCHESTRATOR,
    security_risk: SECURITY_RISK_FOR_TYPE.get(type) ?? SECURITY_RISK.NONE,
    ...data,
  };
  // bridge-edit-blocked is always HIGH — enforce unconditionally after spread
  if (type === "bridge-edit-blocked") {
    stamped.security_risk = SECURITY_RISK.HIGH;
  }
  if (logDir) {
    try {
      const ts = new Date().toISOString();
      const line = `[${ts}] ${type}: ${JSON.stringify(stamped)}\n`;
      writeFileSync(resolve(logDir, "events.log"), line, { flag: "a" });
    } catch {
      // Log dir may not exist yet during early events
    }
  }
  return stamped;
}

/**
 * Issue #197 — Write a slice-failed record when the process exits while a
 * slice is still in-progress (silent-death guard). Exported for tests.
 *
 * Returns `true` if a record was written, `false` when sliceId is falsy
 * (no slice was active, nothing to write).
 *
 * @param {string|null} sliceId  - Active slice ID, or null if none.
 * @param {string}      title    - Slice title (may be "").
 * @param {string|null} runDir   - Run directory for events.log; null = skip.
 * @returns {boolean}
 */
export function writeSilentExitRecord(sliceId, title, runDir) {
  if (!sliceId) return false;
  appendEvent(
    "slice-failed",
    {
      sliceId,
      title: title || "",
      status: "error",
      error:
        "orchestrator-silent-exit: process exited while slice was in-progress. " +
        "Possible cause: gh copilot CLI requires an attached console on Windows " +
        "and the background launcher did not allocate one (Issue #197). " +
        "Re-run with --foreground to diagnose.",
      reason: "worker-exited-without-output",
    },
    runDir,
  );
  return true;
}
