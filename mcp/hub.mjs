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
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";

// ─── Constants ────────────────────────────────────────────────────────
const DEFAULT_WS_PORT = 3101;
const MAX_PORT_RETRIES = 10;
const HEARTBEAT_INTERVAL_MS = 30_000;
const EVENT_HISTORY_SIZE = 100;

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

  console.error(`[hub] WebSocket server listening on ws://127.0.0.1:${actualPort}`);

  return hub;
}

/**
 * Hub manages WebSocket connections, event broadcasting, and session registry.
 */
class Hub {
  constructor(wss, port, cwd) {
    this.wss = wss;
    this.port = port;
    this.cwd = cwd;
    this.clients = new Map(); // clientId → { ws, label, connectedAt, alive }
    this.eventHistory = [];    // Last N events (ring buffer)

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
   * Broadcast an event to all connected clients and add to history.
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

    // Send to all connected clients
    const payload = JSON.stringify(enriched);
    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) { // OPEN
        client.ws.send(payload);
      }
    }
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
   * Shut down the hub gracefully.
   */
  close() {
    clearInterval(this._heartbeatInterval);

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
