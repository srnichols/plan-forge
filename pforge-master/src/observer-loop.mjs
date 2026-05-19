/**
 * Observer Loop — hub subscription + event-batch buffer (Phase-39, Slice 5).
 *
 * Connects to the Plan Forge hub WebSocket using `.forge/server-ports.json`
 * discovery (mirrors runWatchLive port-discovery path). Buffers incoming
 * hub events in memory and flushes to an `onBatch` callback every
 * `batchWindowMs` milliseconds.
 *
 * Handles WebSocket disconnect with bounded exponential backoff
 * (MAX_RECONNECT_RETRIES = 3). After all retries are exhausted the observer
 * halts and surfaces the error via `getStatus().lastError`.
 *
 * The `observer:narration` outbound event type is reserved for Slice 7 — no
 * LLM call happens here yet.
 *
 * @module forge-master/observer-loop
 */

import WebSocket from "ws";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Constants ────────────────────────────────────────────────────────

export const DEFAULT_BATCH_WINDOW_MS = 60_000;
export const MAX_RECONNECT_RETRIES = 3;
const RECONNECT_BASE_MS = 1_000;

/**
 * Hub event types the observer subscribes to.
 * Extend here when new event types are added to the hub.
 */
export const OBSERVER_SUBSCRIBED_EVENTS = new Set([
  "slice-started",
  "slice-completed",
  "slice-failed",
  "slice-retrying",
  "run-started",
  "run-completed",
  "run-aborted",
  "gate-passed",
  "gate-failed",
  "cost-accrued",
  "ask-telemetry",
]);

/**
 * Reserved outbound event type for Slice 7 narration emission.
 * Defined here so Slice 7 can import the constant without hard-coding the string.
 */
export const OBSERVER_NARRATION_EVENT_TYPE = "observer:narration";

// ─── Port discovery ──────────────────────────────────────────────────

/**
 * Read the active hub WS port from .forge/server-ports.json.
 * Mirrors the discovery path used by runWatchLive.
 *
 * @param {string} cwd
 * @returns {number|null}
 */
function readHubPort(cwd) {
  const portsPath = resolve(cwd, ".forge", "server-ports.json");
  try {
    if (existsSync(portsPath)) {
      const parsed = JSON.parse(readFileSync(portsPath, "utf-8"));
      return typeof parsed.ws === "number" ? parsed.ws : null;
    }
  } catch { /* best-effort */ }
  return null;
}

// ─── startObserver ───────────────────────────────────────────────────

/**
 * Start the observer: connect to hub, buffer events, flush every `batchWindowMs`.
 *
 * @param {object} opts
 * @param {number}   [opts.batchWindowMs=60000]  Flush interval in ms.
 * @param {Function}  opts.onBatch               async (events: object[]) → void — called on each flush.
 * @param {string}   [opts.cwd=process.cwd()]    Project root for .forge/server-ports.json discovery.
 * @param {number|null} [opts.wsPort=null]        Explicit WS port (overrides .forge/server-ports.json).
 * @param {Function} [opts._wsFactory]            Injectable WebSocket constructor for testing.
 *                                                Signature: (url: string) → WebSocket-like object.
 * @returns {{ stop: Function, getStatus: Function }}
 */
export function startObserver(opts = {}) {
  const {
    batchWindowMs = DEFAULT_BATCH_WINDOW_MS,
    onBatch,
    cwd = process.cwd(),
    wsPort = null,
    _wsFactory = (url) => new WebSocket(url),
  } = opts;

  if (typeof onBatch !== "function") {
    throw new Error("startObserver: onBatch must be a function");
  }

  // ── Mutable state ──────────────────────────────────────────────────
  let stopped = false;
  let connected = false;
  let ws = null;
  let retryCount = 0;
  let retryTimer = null;
  let flushTimer = null;
  const buffer = [];
  let lastError = null;
  let lastFlushAt = null;
  let totalEventsReceived = 0;
  let totalBatchesFlushed = 0;

  // ── Port resolution ───────────────────────────────────────────────

  function getPort() {
    if (typeof wsPort === "number") return wsPort;
    return readHubPort(cwd);
  }

  // ── Event batching ────────────────────────────────────────────────

  function flushBuffer() {
    lastFlushAt = new Date().toISOString();
    if (buffer.length === 0) return;
    const batch = buffer.splice(0);
    totalBatchesFlushed++;
    try {
      const result = onBatch(batch);
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          console.error(`[observer-loop] onBatch error: ${err.message}`);
        });
      }
    } catch (err) {
      console.error(`[observer-loop] onBatch error: ${err.message}`);
    }
  }

  function scheduleFlush() {
    if (flushTimer) clearInterval(flushTimer);
    flushTimer = setInterval(() => {
      if (!stopped) flushBuffer();
    }, batchWindowMs);
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────

  function connect() {
    if (stopped) return;
    const port = getPort();
    if (!port) {
      lastError = "hub port not found — hub may not be running";
      console.error(`[observer-loop] ${lastError}`);
      scheduleReconnect();
      return;
    }

    const url = `ws://127.0.0.1:${port}`;
    try {
      ws = _wsFactory(url);

      ws.on("open", () => {
        connected = true;
        retryCount = 0;
        lastError = null;
        console.error(`[observer-loop] connected to hub at ${url}`);
      });

      ws.on("message", (data) => {
        try {
          const event = JSON.parse(data.toString());
          if (event.type === "connected") return; // skip handshake
          if (OBSERVER_SUBSCRIBED_EVENTS.has(event.type)) {
            buffer.push(event);
            totalEventsReceived++;
          }
        } catch { /* ignore malformed messages */ }
      });

      ws.on("error", (err) => {
        connected = false;
        lastError = err?.message ?? String(err);
        if (!stopped) {
          console.error(`[observer-loop] WS error: ${lastError}`);
          scheduleReconnect();
        }
      });

      ws.on("close", () => {
        connected = false;
        if (!stopped) {
          scheduleReconnect();
        }
      });
    } catch (err) {
      lastError = err.message;
      console.error(`[observer-loop] connect failed: ${err.message}`);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (retryCount >= MAX_RECONNECT_RETRIES) {
      lastError = `max retries (${MAX_RECONNECT_RETRIES}) exceeded — observer halted`;
      console.error(`[observer-loop] ${lastError}`);
      return;
    }
    const delay = RECONNECT_BASE_MS * Math.pow(2, retryCount);
    retryCount++;
    retryTimer = setTimeout(() => {
      if (!stopped) connect();
    }, delay);
  }

  // ── Boot ──────────────────────────────────────────────────────────
  connect();
  scheduleFlush();

  // ── Public API ────────────────────────────────────────────────────

  return {
    /**
     * Stop the observer. Flushes any buffered events synchronously before
     * closing the WebSocket and clearing all timers.
     */
    stop() {
      stopped = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
      flushBuffer(); // final flush
      if (ws) {
        try { ws.close(); } catch { /* best-effort */ }
      }
      connected = false;
    },

    /**
     * Return a point-in-time status snapshot.
     *
     * @returns {{
     *   connected: boolean,
     *   stopped: boolean,
     *   retryCount: number,
     *   bufferSize: number,
     *   lastError: string|null,
     *   lastFlushAt: string|null,
     *   totalEventsReceived: number,
     *   totalBatchesFlushed: number,
     *   batchWindowMs: number,
     * }}
     */
    getStatus() {
      return {
        connected,
        stopped,
        retryCount,
        bufferSize: buffer.length,
        lastError,
        lastFlushAt,
        totalEventsReceived,
        totalBatchesFlushed,
        batchWindowMs,
      };
    },
  };
}
