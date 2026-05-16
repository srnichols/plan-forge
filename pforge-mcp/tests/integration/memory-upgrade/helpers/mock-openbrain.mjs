/**
 * mock-openbrain.mjs — In-process HTTP mock server for OpenBrain.
 *
 * Designed for integration tests that need a deterministic, zero-network,
 * zero-dependency stand-in for the OpenBrain HTTP API.
 *
 * Usage:
 *   const ob = await createMockOpenBrain();
 *   // ob.url  — base URL (e.g. http://127.0.0.1:<port>)
 *   // ob.url  — set process.env.OPENBRAIN_URL to this
 *   await ob.close();
 *
 * Configurable state (mutate ob.state directly or use the helpers):
 *   ob.state.capabilities    — array returned by GET /health (default: ["provenance","search","write"])
 *   ob.state.healthStatus    — HTTP status code for GET /health (default: 200)
 *   ob.state.memoriesStatus  — HTTP status code for POST /memories (default: 200)
 *   ob.state.nextFailCount   — force the next N POST /memories to return 500
 *
 * Recorded data:
 *   ob.requests.health       — list of { method, url, body } for /health
 *   ob.requests.memories     — list of { method, url, body } for POST /memories
 *   ob.requests.rpc          — list of { method, url, body } for /rpc/*
 *
 * Counters:
 *   ob.hitCounts.health
 *   ob.hitCounts.memories
 *   ob.hitCounts.rpc
 */

import { createServer } from "node:http";

/**
 * Create and start a mock OpenBrain HTTP server.
 *
 * @param {{ port?: number, capabilities?: string[] }} [opts]
 * @returns {Promise<MockOpenBrain>}
 */
export async function createMockOpenBrain(opts = {}) {
  const state = {
    capabilities: opts.capabilities ?? ["provenance", "search", "write"],
    healthStatus: 200,
    memoriesStatus: 200,
    nextFailCount: 0,
    healthVersion: "0.7.0",
    /** Stored memories for match_thoughts_by_source lookups. */
    storedMemories: [],
  };

  const requests = {
    health: [],
    memories: [],
    rpc: [],
  };

  const hitCounts = {
    health: 0,
    memories: 0,
    rpc: 0,
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve(raw.length > 0 ? JSON.parse(raw) : null);
        } catch {
          resolve(raw);
        }
      });
      req.on("error", reject);
    });
  }

  function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : null;

    // ── GET /health ──────────────────────────────────────────────────
    if (method === "GET" && url === "/health") {
      hitCounts.health += 1;
      requests.health.push({ method, url, body });

      if (state.healthStatus !== 200) {
        res.writeHead(state.healthStatus);
        res.end();
        return;
      }

      sendJson(res, 200, {
        ok: true,
        version: state.healthVersion,
        capabilities: state.capabilities,
      });
      return;
    }

    // ── POST /memories ────────────────────────────────────────────────
    if (method === "POST" && url === "/memories") {
      hitCounts.memories += 1;
      requests.memories.push({ method, url, body });

      if (state.nextFailCount > 0) {
        state.nextFailCount -= 1;
        sendJson(res, 500, { ok: false, error: "forced_failure" });
        return;
      }

      if (state.memoriesStatus !== 200) {
        sendJson(res, state.memoriesStatus, { ok: false, error: "configured_error" });
        return;
      }

      const id = `mem-${Date.now()}-${hitCounts.memories}`;
      if (body && typeof body === "object") {
        state.storedMemories.push({ id, ...body });
      }
      sendJson(res, 201, { ok: true, id });
      return;
    }

    // ── POST /rpc/match_thoughts_by_source ────────────────────────────
    if (method === "POST" && (url === "/rpc/match_thoughts_by_source" || url.startsWith("/rpc/"))) {
      hitCounts.rpc += 1;
      requests.rpc.push({ method, url, body });

      if (url === "/rpc/match_thoughts_by_source") {
        const file = body?.file ?? null;
        const hash = body?.hash ?? null;

        const matches = state.storedMemories.filter((m) => {
          const prov = m?.metadata?.provenance ?? m?.provenance ?? null;
          if (!prov) return false;
          if (file && prov.sourceFile !== file) return false;
          if (hash && prov.contentHash !== hash) return false;
          return true;
        });

        sendJson(res, 200, { ok: true, items: matches, total: matches.length });
        return;
      }

      // Unknown RPC — 404
      sendJson(res, 404, { ok: false, error: `unknown rpc: ${url}` });
      return;
    }

    // ── 404 fallback ──────────────────────────────────────────────────
    sendJson(res, 404, { ok: false, error: `not found: ${url}` });
  });

  // Bind to a random available port.
  await new Promise((resolve, reject) => {
    server.listen(opts.port ?? 0, "127.0.0.1", (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    state,
    requests,
    hitCounts,

    /** Reset all recorded requests and counters without stopping the server. */
    reset() {
      requests.health.length = 0;
      requests.memories.length = 0;
      requests.rpc.length = 0;
      hitCounts.health = 0;
      hitCounts.memories = 0;
      hitCounts.rpc = 0;
      state.storedMemories.length = 0;
      state.nextFailCount = 0;
    },

    /** Stop the server. Call in afterEach/afterAll. */
    close() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
