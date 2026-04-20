/**
 * Plan Forge WebSocket Hub — Real-Time Event Broadcasting
 *
 * Architecture (C5): Single Node.js process.
 *   - MCP SDK uses stdio (unchanged)
 *   - WebSocket hub on port 3101 (configurable via PLAN_FORGE_WS_PORT)
 *   - Port fallback: increment on conflict (M3)
 *   - Store active port in .forge/server-ports.json
 *
 * Phase 3: Hub subscribes to orchestrator events, broadcasts to connected clients.
 * Phase 4: Dashboard connects as a WS client.
 *
 * @module hub
 */

import { WebSocketServer } from "ws";
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, appendFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

// ─── Constants ────────────────────────────────────────────────────────
const DEFAULT_WS_PORT = 3101;
const MAX_PORT_RETRIES = 10;
const HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_ASK_TIMEOUT_MS = 5_000;
// G1.1 (v2.36): was 100 — a 20-slice plan burned through that in one run.
// Raised to 500 so dashboards connecting mid-run see a representative history.
const EVENT_HISTORY_SIZE = 500;
// G1.1 (v2.36): on startup, rehydrate history from the last N runs' events.log
// so late-connecting clients aren't limited to only the most-recent run.
const REHYDRATE_RUN_COUNT = 3;

// ─── Port Availability Check ──────────────────────────────────────────

/**
 * Check if a port is available.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find an available port starting from the given port (M3: port fallback).
 * @param {number} startPort
 * @returns {Promise<number>}
 */
async function findAvailablePort(startPort) {
  for (let i = 0; i < MAX_PORT_RETRIES; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + MAX_PORT_RETRIES - 1}`);
}

// ─── Hub ──────────────────────────────────────────────────────────────

/**
 * Create and start the WebSocket hub.
 *
 * @param {object} options
 * @param {number} options.port - Starting port (default: 3101 or PLAN_FORGE_WS_PORT)
 * @param {string} options.cwd - Project directory for .forge/server-ports.json
 * @returns {Promise<Hub>}
 */
export async function createHub(options = {}) {
  const {
    port = parseInt(process.env.PLAN_FORGE_WS_PORT || String(DEFAULT_WS_PORT), 10),
    cwd = process.cwd(),
  } = options;

  const actualPort = await findAvailablePort(port);

  const wss = new WebSocketServer({
    port: actualPort,
    host: "127.0.0.1", // Localhost only — no external access
  });

  const hub = new Hub(wss, actualPort, cwd);

  // Write port info to .forge/server-ports.json (M3)
  hub._writePortsFile();

  // G1.1 (v2.36): rehydrate event history from the last N runs so
  // dashboards connecting right after startup get context from more
  // than just the most-recent run. Best-effort: never fail startup.
  try {
    const { runsScanned, eventsLoaded } = hub.rehydrateFromRuns();
    if (eventsLoaded > 0) {
      console.error(`[hub] rehydrated ${eventsLoaded} events from ${runsScanned} run(s)`);
    }
  } catch (err) {
    console.error(`[hub] rehydrate skipped: ${err.message}`);
  }

  console.error(`[hub] WebSocket server listening on ws://127.0.0.1:${actualPort}`);

  return hub;
}

/**
 * Hub manages WebSocket connections, event broadcasting, and session registry.
 * Exported so tests can construct it with a stub `wss` without binding a port.
 */
export class Hub {
  constructor(wss, port, cwd) {
    this.wss = wss;
    this.port = port;
    this.cwd = cwd;
    this.clients = new Map(); // clientId → { ws, label, connectedAt, alive }
    this.eventHistory = [];    // Last N events (ring buffer)
    this._pendingAsks = new Map(); // requestId → { resolve, reject, timer, topic, ts }
    this._responders = new Map(); // topic → handler
    this._askSpans = [];          // OTEL-style telemetry spans for ask/respond pairs
    this._closed = false;

    // Handle new connections
    wss.on("connection", (ws, req) => {
      const clientId = randomUUID();
      const label = new URL(req.url || "/", "http://localhost").searchParams.get("label") || "anonymous";

      this.clients.set(clientId, {
        ws,
        label,
        connectedAt: new Date().toISOString(),
        alive: true,
      });

      // Send connection ack + recent history
      ws.send(JSON.stringify({
        type: "connected",
        version: "1.0",
        clientId,
        label,
        historySize: this.eventHistory.length,
        timestamp: new Date().toISOString(),
      }));

      // Send event history buffer for clients that connect mid-run
      for (const event of this.eventHistory) {
        ws.send(JSON.stringify(event));
      }

      // Handle pong for heartbeat
      ws.on("pong", () => {
        const client = this.clients.get(clientId);
        if (client) client.alive = true;
      });

      // Handle disconnect
      ws.on("close", () => {
        this.clients.delete(clientId);
      });

      // Handle incoming messages (future: commands from dashboard)
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "set-label") {
            const client = this.clients.get(clientId);
            if (client) client.label = msg.label;
          }
        } catch {
          // Ignore malformed messages
        }
      });
    });

    // Heartbeat interval — clean up dead connections
    this._heartbeatInterval = setInterval(() => {
      for (const [id, client] of this.clients) {
        if (!client.alive) {
          client.ws.terminate();
          this.clients.delete(id);
          continue;
        }
        client.alive = false;
        client.ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Broadcast an event to all connected clients, add to history, and
   * append a durable copy to `.forge/hub-events.jsonl` (G1.2).
   *
   * All events include version: "1.0" per M4.
   *
   * @param {object} event - { type, ...data }
   */
  broadcast(event) {
    const enriched = {
      version: "1.0", // M4: Event schema versioning
      timestamp: new Date().toISOString(),
      ...event,
    };

    // Add to ring buffer
    this.eventHistory.push(enriched);
    if (this.eventHistory.length > EVENT_HISTORY_SIZE) {
      this.eventHistory.shift();
    }

    // G1.2 (v2.36): durable mirror. Every broadcast is persisted to
    // `.forge/hub-events.jsonl` so dashboards, bridges, and post-mortems
    // have a replayable source of truth independent of per-run events.log
    // and independent of hub restarts. Best-effort: filesystem failure
    // never breaks broadcasting.
    try {
      this._appendDurableEvent(enriched);
    } catch { /* best-effort durability */ }

    // Send to all connected clients
    const payload = JSON.stringify(enriched);
    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) { // OPEN
        client.ws.send(payload);
      }
    }
  }

  /**
   * G1.2: Append an enriched event to .forge/hub-events.jsonl.
   * Kept as a method so tests can stub it and so the write path is named.
   * @private
   */
  _appendDurableEvent(enriched) {
    const dir = resolve(this.cwd, ".forge");
    mkdirSync(dir, { recursive: true });
    const logPath = resolve(dir, "hub-events.jsonl");
    appendFileSync(logPath, JSON.stringify(enriched) + "\n");
  }

  /**
   * Get the session registry — list of connected clients.
   * @returns {Array<{ clientId, label, connectedAt }>}
   */
  getClients() {
    const result = [];
    for (const [id, client] of this.clients) {
      result.push({
        clientId: id,
        label: client.label,
        connectedAt: client.connectedAt,
      });
    }
    return result;
  }

  /**
   * Get recent event history.
   * @param {number} count - Number of recent events (default: all in buffer)
   * @returns {Array}
   */
  getHistory(count = EVENT_HISTORY_SIZE) {
    return this.eventHistory.slice(-count);
  }

  /**
   * G1.1 (v2.36): Rehydrate `eventHistory` from the last N runs' events.log
   * files so that dashboards connecting right after hub startup see context
   * from more than just the most-recent run.
   *
   * Called once by the server during hub initialisation (after construct,
   * before accepting the first connection).
   *
   * @param {number} [runCount=REHYDRATE_RUN_COUNT]
   * @returns {{ runsScanned: number, eventsLoaded: number }}
   */
  rehydrateFromRuns(runCount = REHYDRATE_RUN_COUNT) {
    const runsDir = resolve(this.cwd, ".forge", "runs");
    if (!existsSync(runsDir)) return { runsScanned: 0, eventsLoaded: 0 };

    let dirs;
    try {
      dirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .reverse()
        .slice(0, runCount);
    } catch {
      return { runsScanned: 0, eventsLoaded: 0 };
    }

    const loaded = [];
    for (const dir of dirs.reverse()) { // oldest first so timestamps stay ordered
      const logPath = resolve(runsDir, dir, "events.log");
      if (!existsSync(logPath)) continue;
      try {
        const lines = readFileSync(logPath, "utf-8").split("\n").filter((l) => l.trim());
        for (const line of lines) {
          const match = line.match(/^\[([^\]]+)\]\s+(\S+):\s+(.*)$/);
          if (!match) continue;
          const [, timestamp, type, jsonStr] = match;
          try {
            const data = JSON.parse(jsonStr);
            loaded.push({ version: "1.0", type, data, timestamp, source: "rehydrate" });
          } catch { /* skip malformed */ }
        }
      } catch { /* skip unreadable runs */ }
    }

    // Keep only the most recent EVENT_HISTORY_SIZE entries if we overflowed
    const tail = loaded.slice(-EVENT_HISTORY_SIZE);
    this.eventHistory.push(...tail);
    if (this.eventHistory.length > EVENT_HISTORY_SIZE) {
      this.eventHistory = this.eventHistory.slice(-EVENT_HISTORY_SIZE);
    }

    return { runsScanned: dirs.length, eventsLoaded: tail.length };
  }

  /**
   * Write active port info to .forge/server-ports.json (M3).
   */
  _writePortsFile() {
    const portsPath = resolve(this.cwd, ".forge", "server-ports.json");
    mkdirSync(resolve(this.cwd, ".forge"), { recursive: true });
    writeFileSync(portsPath, JSON.stringify({
      ws: this.port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }, null, 2));
  }

  /**
   * Send a request and await a response from the registered handler.
   *
   * @param {string} topic - The topic to address (e.g. "brain.gate-check")
   * @param {*} payload - Arbitrary request payload
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=5000] - Timeout in milliseconds
   * @param {string} [opts.correlationId] - Optional correlation ID for tracing
   * @returns {Promise<{ ok: boolean, payload?: *, error?: { code: string, message: string } }>}
   */
  ask(topic, payload, { timeoutMs = DEFAULT_ASK_TIMEOUT_MS, correlationId } = {}) {
    if (this._closed) {
      return Promise.reject(new Error("hub-closed"));
    }

    const requestId = `req-${randomUUID()}`;
    const ts = new Date().toISOString();

    // No responder registered → immediate ok:false (never hang)
    if (!this._responders.has(topic)) {
      return Promise.resolve({
        ok: false,
        error: { code: "no-responder", message: `No responder registered for topic: ${topic}` },
      });
    }

    const handler = this._responders.get(topic);
    const askStartTime = Date.now();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pendingAsks.has(requestId)) {
          this._pendingAsks.delete(requestId);
          const span = {
            name: "hub.ask",
            topic,
            requestId,
            correlationId,
            durationMs: Date.now() - askStartTime,
            ok: false,
          };
          this._askSpans.push(span);
          this.broadcast({ type: "ask-telemetry", data: span });
          console.warn(`[hub] ask timeout: topic=${topic} requestId=${requestId}`);
          reject(Object.assign(new Error(`Ask timed out for topic: ${topic}`), {
            code: "ask-timeout",
            topic,
            requestId,
          }));
        }
      }, timeoutMs);

      this._pendingAsks.set(requestId, { resolve, reject, timer, topic, ts });

      // Dispatch to handler without blocking the event loop
      Promise.resolve()
        .then(() => handler(payload, { requestId, topic, correlationId, ts }))
        .then((result) => {
          this._deliverResponse(requestId, result, true, askStartTime, topic, correlationId);
        })
        .catch((err) => {
          this._deliverResponse(
            requestId,
            { code: "responder-error", message: err.message },
            false,
            askStartTime,
            topic,
            correlationId,
          );
        });
    });
  }

  /**
   * Register a handler for a topic. Only one handler per topic allowed.
   *
   * @param {string} topic - The topic to handle
   * @param {function} handler - async (payload, meta) → response value
   */
  onAsk(topic, handler) {
    if (this._responders.has(topic)) {
      throw new Error(`Responder already registered for topic: ${topic}`);
    }
    this._responders.set(topic, handler);
  }

  /**
   * Remove the handler for a topic. Useful for test teardown.
   * @param {string} topic
   */
  removeAskHandler(topic) {
    this._responders.delete(topic);
  }

  /**
   * List all registered responder topics (debugging infrastructure).
   * @returns {string[]}
   */
  listResponders() {
    return [...this._responders.keys()];
  }

  /**
   * Deliver a response for a pending ask.
   * Late responses (after timeout eviction) are dropped with a warn log.
   * @private
   */
  _deliverResponse(requestId, result, ok, askStartTime, topic, correlationId) {
    const pending = this._pendingAsks.get(requestId);
    if (!pending) {
      console.warn(`[hub] late respond dropped for requestId=${requestId}`);
      return;
    }

    clearTimeout(pending.timer);
    this._pendingAsks.delete(requestId);

    const span = {
      name: "hub.ask",
      topic,
      requestId,
      correlationId,
      durationMs: Date.now() - askStartTime,
      ok,
    };
    this._askSpans.push(span);
    this.broadcast({ type: "ask-telemetry", data: span });

    if (ok) {
      pending.resolve({ ok: true, payload: result });
    } else {
      pending.resolve({ ok: false, error: result });
    }
  }

  /**
   * Shut down the hub gracefully.
   */
  close() {
    this._closed = true;
    clearInterval(this._heartbeatInterval);

    // Reject all pending asks
    for (const [requestId, pending] of this._pendingAsks) {
      clearTimeout(pending.timer);
      pending.reject(Object.assign(new Error("Hub closed"), {
        code: "hub-closed",
        topic: pending.topic,
        requestId,
      }));
    }
    this._pendingAsks.clear();
    this._responders.clear();

    for (const [, client] of this.clients) {
      client.ws.close(1000, "Server shutting down");
    }
    this.clients.clear();

    this.wss.close();

    // Clean up ports file
    const portsPath = resolve(this.cwd, ".forge", "server-ports.json");
    try {
      if (existsSync(portsPath)) unlinkSync(portsPath);
    } catch {
      // Best effort cleanup
    }
  }
}

/**
 * Read the active hub port from .forge/server-ports.json.
 * Used by forge_plan_status to forward to live hub when running.
 *
 * @param {string} cwd - Project directory
 * @returns {{ ws: number, pid: number } | null}
 */
export function readHubPort(cwd) {
  const portsPath = resolve(cwd, ".forge", "server-ports.json");
  try {
    if (existsSync(portsPath)) {
      return JSON.parse(readFileSync(portsPath, "utf-8"));
    }
  } catch {
    // File might be stale or corrupt
  }
  return null;
}
