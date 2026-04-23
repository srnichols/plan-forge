/**
 * Forge-Master HTTP Routes (Phase-29, Slice 9).
 *
 * Framework-agnostic route registrar — works with Node's built-in http
 * module as well as any express-compatible app object.
 *
 * Routes:
 *   GET  /api/forge-master/prompts           — prompt catalog
 *   GET  /api/forge-master/sessions          — recent sessions list
 *   GET  /api/forge-master/capabilities      — server capabilities
 *   POST /api/forge-master/chat              — start a chat session
 *   GET  /api/forge-master/chat/:id/stream   — SSE stream
 *   POST /api/forge-master/chat/:id/approve  — resolve approval
 *   GET  /api/forge-master/session/:id       — last 10 turns for a session
 *
 * @module forge-master/http-routes
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getPromptCatalog } from "./prompts.mjs";
import { getForgeMasterConfig } from "./config.mjs";
import { runTurn } from "./reasoning.mjs";
import { createSseStream } from "./sse.mjs";
import { BASE_ALLOWLIST, WRITE_ALLOWLIST } from "./allowlist.mjs";
import { createHttpDispatcher, invokeForgeTool } from "./http-dispatcher.mjs";
import { VALID_TIERS } from "./reasoning-tier.mjs";
import { loadSession } from "./session-store.mjs";
import { size as embeddingCacheSize } from "./embedding/cache.mjs";
import { randomUUID } from "node:crypto";

const sessions = new Map();
const pendingApprovals = new Map();
let _embeddingCacheQueries = 0;
let _embeddingCacheHits = 0;

/** Record a cache query (called by reasoning loop or externally). */
export function recordCacheQuery(hit) {
  _embeddingCacheQueries++;
  if (hit) _embeddingCacheHits++;
}

/** Get cache stats for the dashboard tile. */
export function getCacheStats() {
  const sz = embeddingCacheSize();
  const hitRate = _embeddingCacheQueries > 0
    ? _embeddingCacheHits / _embeddingCacheQueries
    : 0;
  return { size: sz, hitRate: Math.round(hitRate * 1000) / 1000, maxSize: 500 };
}

const PREFS_FILE = ".forge/fm-prefs.json";
const VALID_QUORUM_MODES = ["off", "auto", "always"];
const PREFS_DEFAULTS = { tier: null, autoEscalate: false, quorumAdvisory: "off", embeddingFallback: true };

/**
 * Load Forge-Master user prefs from `<cwd>/.forge/fm-prefs.json`.
 * Returns defaults when the file is missing or the stored tier is invalid.
 *
 * @param {string} [cwd] — project root (defaults to process.cwd())
 * @returns {{ tier: string|null, autoEscalate: boolean }}
 */
export function loadPrefs(cwd = process.cwd()) {
  const prefsPath = join(cwd, PREFS_FILE);
  if (!existsSync(prefsPath)) return { ...PREFS_DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(prefsPath, "utf-8"));
    const tier = raw.tier && VALID_TIERS.includes(raw.tier) ? raw.tier : null;
    const autoEscalate = typeof raw.autoEscalate === "boolean" ? raw.autoEscalate : false;
    const quorumAdvisory = VALID_QUORUM_MODES.includes(raw.quorumAdvisory) ? raw.quorumAdvisory : "off";
    const embeddingFallback = typeof raw.embeddingFallback === "boolean" ? raw.embeddingFallback : true;
    return { tier, autoEscalate, quorumAdvisory, embeddingFallback };
  } catch {
    return { ...PREFS_DEFAULTS };
  }
}

/**
 * Persist Forge-Master user prefs to `<cwd>/.forge/fm-prefs.json`.
 *
 * @param {{ tier: string|null, autoEscalate: boolean }} prefs
 * @param {string} [cwd] — project root (defaults to process.cwd())
 */
export function savePrefs(prefs, cwd = process.cwd()) {
  const forgeDir = join(cwd, ".forge");
  mkdirSync(forgeDir, { recursive: true });
  writeFileSync(join(cwd, PREFS_FILE), JSON.stringify(prefs, null, 2), "utf-8");
}

// ─── Route handler map ───────────────────────────────────────────────

/**
 * Register Forge-Master routes on an express-compatible app or bare
 * Node http IncomingMessage/ServerResponse router.
 *
 * When `app` has `app.get` / `app.post` methods we use them (express mode).
 * Otherwise the function returns a request handler function suitable for
 * `http.createServer(handler)`.
 *
 * @param {object} app — express app or null
 * @param {{ mcpCall?: Function }} [opts] — optional in-process tool invoker
 * @returns {Function|undefined} — request handler when app is null
 */
export function createHttpRoutes(app, { mcpCall = invokeForgeTool } = {}) {
  const dispatcher = createHttpDispatcher({ allowlist: BASE_ALLOWLIST, mcpCall });
  if (app && typeof app.get === "function") {
    _registerExpress(app, dispatcher);
  } else {
    return _buildNodeHandler(dispatcher);
  }
}

// ─── Express-mode registration ───────────────────────────────────────

function _registerExpress(app, dispatcher) {
  app.get("/api/forge-master/prompts", (req, res) => {
    res.json(getPromptCatalog());
  });

  app.get("/api/forge-master/sessions", (req, res) => {
    res.json(Array.from(sessions.entries()).map(([id, s]) => ({ id, ...s })));
  });

  app.get("/api/forge-master/capabilities", (req, res) => {
    const config = getForgeMasterConfig();
    const catalog = getPromptCatalog();
    const promptCount = catalog.categories.reduce((n, c) => n + c.prompts.length, 0);
    res.json({
      reasoningModel: config.reasoningModel,
      routerModel: config.routerModel,
      allowlistedTools: BASE_ALLOWLIST.length,
      writeAllowlist: WRITE_ALLOWLIST.length,
      promptCategories: catalog.categories.length,
      promptCount,
    });
  });

  app.get("/api/forge-master/prefs", (req, res) => {
    res.json(loadPrefs(process.cwd()));
  });

  app.get("/api/forge-master/cache-stats", (req, res) => {
    res.json(getCacheStats());
  });

  app.put("/api/forge-master/prefs", (req, res) => {
    const { tier, autoEscalate, quorumAdvisory, embeddingFallback } = req.body || {};
    const normalized = {
      tier: tier && VALID_TIERS.includes(tier) ? tier : null,
      autoEscalate: typeof autoEscalate === "boolean" ? autoEscalate : false,
      quorumAdvisory: VALID_QUORUM_MODES.includes(quorumAdvisory) ? quorumAdvisory : "off",
      embeddingFallback: typeof embeddingFallback === "boolean" ? embeddingFallback : true,
    };
    savePrefs(normalized, process.cwd());
    res.json(normalized);
  });

  app.post("/api/forge-master/chat", (req, res) => {
    const { message, sessionId: reqSessionId } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    const sessionId = reqSessionId || randomUUID();
    const keywordOnly = req.headers["x-pforge-keyword-only"] === "1";
    const fmSessionId = req.headers["x-pforge-session-id"] || null;
    sessions.set(sessionId, { createdAt: new Date().toISOString(), lastMessage: message, keywordOnly, fmSessionId });
    res.json({
      sessionId,
      streamUrl: `/api/forge-master/chat/${sessionId}/stream?message=${encodeURIComponent(message)}`,
    });
  });

  app.get("/api/forge-master/chat/:sessionId/stream", async (req, res) => {
    const { sessionId } = req.params;
    const message = req.query.message || "";
    const session = sessions.get(sessionId) || {};
    const prefs = loadPrefs(process.cwd());
    const sse = createSseStream(res);
    try {
      sse.send("start", { sessionId });
      const result = await runTurn(
        { message, sessionId },
        {
          dispatcher,
          sessionId: session.fmSessionId || null,
          forceKeywordOnly: session.keywordOnly || false,
          quorumAdvisory: prefs.quorumAdvisory || "off",
          onClassification: (data) => { sse.send("classification", data); },
          onPlan: (data) => { sse.send("plan", data); },
          onQuorumEstimate: (data) => { sse.send("quorum-estimate", data); },
        },
      );
      if (result.error) {
        sse.send("error", { error: result.error, sessionId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, totalCostUSD: result.totalCostUSD || 0 });
      } else {
        sse.send("reply", { content: result.reply, sessionId });
        for (const tc of result.toolCalls || []) sse.send("tool-call", tc);
        sse.send("done", { sessionId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, totalCostUSD: result.totalCostUSD || 0, resolvedModel: result.resolvedModel || null, relatedTurns: result.relatedTurns || [], quorumResult: result.quorumResult || null });
      }
    } catch (err) {
      sse.send("error", { error: err.message });
    } finally {
      sse.close();
    }
  });

  app.post("/api/forge-master/chat/:sessionId/approve",(req, res) => {
    const { sessionId } = req.params;
    const { approvalId, decision, editedArgs } = req.body || {};
    const gate = pendingApprovals.get(approvalId);
    if (!gate) return res.status(404).json({ error: "approval not found" });
    gate({ decision, editedArgs });
    pendingApprovals.delete(approvalId);
    res.json({ ok: true, approvalId, decision });
  });

  app.get("/api/forge-master/session/:id", async (req, res) => {
    const { id } = req.params;
    try {
      const turns = await loadSession(id, process.cwd());
      res.json({ sessionId: id, turns: turns.slice(-10) });
    } catch {
      res.json({ sessionId: id, turns: [] });
    }
  });

  app.use("/api/forge-master", (req, res) => {
    res.status(404).json({ error: "not found" });
  });
}

// ─── Built-in http handler (no express) ─────────────────────────────

function _buildNodeHandler(dispatcher) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;
    const method = req.method;

    function json(res, code, data) {
      const body = JSON.stringify(data);
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(body);
    }

    async function readBody(req) {
      return new Promise((resolve) => {
        let data = "";
        req.on("data", (c) => { data += c; });
        req.on("end", () => {
          try { resolve(JSON.parse(data)); } catch { resolve({}); }
        });
      });
    }

    if (!path.startsWith("/api/forge-master")) return null; // not handled

    if (method === "GET" && path === "/api/forge-master/prompts") {
      return json(res, 200, getPromptCatalog());
    }

    if (method === "GET" && path === "/api/forge-master/sessions") {
      return json(res, 200, Array.from(sessions.entries()).map(([id, s]) => ({ id, ...s })));
    }

    if (method === "GET" && path === "/api/forge-master/capabilities") {
      const config = getForgeMasterConfig();
      const catalog = getPromptCatalog();
      const promptCount = catalog.categories.reduce((n, c) => n + c.prompts.length, 0);
      return json(res, 200, {
        reasoningModel: config.reasoningModel,
        routerModel: config.routerModel,
        allowlistedTools: BASE_ALLOWLIST.length,
        writeAllowlist: WRITE_ALLOWLIST.length,
        promptCategories: catalog.categories.length,
        promptCount,
      });
    }

    if (method === "GET" && path === "/api/forge-master/prefs") {
      return json(res, 200, loadPrefs(process.cwd()));
    }

    if (method === "GET" && path === "/api/forge-master/cache-stats") {
      return json(res, 200, getCacheStats());
    }

    if (method === "PUT" && path === "/api/forge-master/prefs") {
      const body = await readBody(req);
      const { tier, autoEscalate, quorumAdvisory, embeddingFallback } = body;
      const normalized = {
        tier: tier && VALID_TIERS.includes(tier) ? tier : null,
        autoEscalate: typeof autoEscalate === "boolean" ? autoEscalate : false,
        quorumAdvisory: VALID_QUORUM_MODES.includes(quorumAdvisory) ? quorumAdvisory : "off",
        embeddingFallback: typeof embeddingFallback === "boolean" ? embeddingFallback : true,
      };
      savePrefs(normalized, process.cwd());
      return json(res, 200, normalized);
    }

    if (method === "POST" && path === "/api/forge-master/chat") {
      const body = await readBody(req);
      const { message, sessionId: reqSessionId } = body;
      if (!message) return json(res, 400, { error: "message required" });
      const sessionId = reqSessionId || randomUUID();
      const keywordOnly = req.headers["x-pforge-keyword-only"] === "1";
      const fmSessionId = req.headers["x-pforge-session-id"] || null;
      sessions.set(sessionId, { createdAt: new Date().toISOString(), lastMessage: message, keywordOnly, fmSessionId });
      return json(res, 200, {
        sessionId,
        streamUrl: `/api/forge-master/chat/${sessionId}/stream?message=${encodeURIComponent(message)}`,
      });
    }

    // GET /api/forge-master/chat/:sessionId/stream
    const streamMatch = path.match(/^\/api\/forge-master\/chat\/([^/]+)\/stream$/);
    if (method === "GET" && streamMatch) {
      const sessionId = streamMatch[1];
      const message = url.searchParams.get("message") || "";
      const session = sessions.get(sessionId) || {};
      const prefs = loadPrefs(process.cwd());
      const sse = createSseStream(res);
      try {
        sse.send("start", { sessionId });
        const result = await runTurn(
          { message, sessionId },
          {
            dispatcher,
            sessionId: session.fmSessionId || null,
            forceKeywordOnly: session.keywordOnly || false,
            quorumAdvisory: prefs.quorumAdvisory || "off",
            onClassification: (data) => { sse.send("classification", data); },
            onPlan: (data) => { sse.send("plan", data); },
            onQuorumEstimate: (data) => { sse.send("quorum-estimate", data); },
          },
        );
        if (result.error) {
          sse.send("error", { error: result.error, sessionId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, totalCostUSD: result.totalCostUSD || 0 });
        } else {
          sse.send("reply", { content: result.reply, sessionId });
          for (const tc of result.toolCalls || []) sse.send("tool-call", tc);
          sse.send("done", { sessionId, tokensIn: result.tokensIn, tokensOut: result.tokensOut, totalCostUSD: result.totalCostUSD || 0, resolvedModel: result.resolvedModel || null, relatedTurns: result.relatedTurns || [], quorumResult: result.quorumResult || null });
        }
      } catch (err) {
        sse.send("error", { error: err.message });
      } finally {
        sse.close();
      }
      return;
    }

    // POST /api/forge-master/chat/:sessionId/approve
    const approveMatch = path.match(/^\/api\/forge-master\/chat\/([^/]+)\/approve$/);
    if (method === "POST" && approveMatch) {
      const body = await readBody(req);
      const { approvalId, decision, editedArgs } = body;
      const gate = pendingApprovals.get(approvalId);
      if (!gate) return json(res, 404, { error: "approval not found" });
      gate({ decision, editedArgs });
      pendingApprovals.delete(approvalId);
      return json(res, 200, { ok: true, approvalId, decision });
    }

    // GET /api/forge-master/session/:id
    const sessionMatch = path.match(/^\/api\/forge-master\/session\/([^/]+)$/);
    if (method === "GET" && sessionMatch) {
      const id = sessionMatch[1];
      try {
        const turns = await loadSession(id, process.cwd());
        return json(res, 200, { sessionId: id, turns: turns.slice(-10) });
      } catch {
        return json(res, 200, { sessionId: id, turns: [] });
      }
    }

    return json(res, 404, { error: "not found" });
  };
}
