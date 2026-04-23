/**
 * Forge-Master HTTP Routes (Phase-29, Slice 9).
 *
 * Framework-agnostic route registrar — works with Node's built-in http
 * module as well as any express-compatible app object.
 *
 * Routes:
 *   GET  /api/forge-master/prompts         — prompt catalog
 *   GET  /api/forge-master/sessions        — recent sessions list
 *   GET  /api/forge-master/capabilities    — server capabilities
 *   POST /api/forge-master/chat            — start a chat session
 *   GET  /api/forge-master/chat/:id/stream — SSE stream
 *   POST /api/forge-master/chat/:id/approve — resolve approval
 *
 * @module forge-master/http-routes
 */

import { getPromptCatalog } from "./prompts.mjs";
import { getForgeMasterConfig } from "./config.mjs";
import { runTurn } from "./reasoning.mjs";
import { createSseStream } from "./sse.mjs";
import { BASE_ALLOWLIST, WRITE_ALLOWLIST } from "./allowlist.mjs";
import { createHttpDispatcher, invokeForgeTool } from "./http-dispatcher.mjs";
import { randomUUID } from "node:crypto";

const sessions = new Map();
const pendingApprovals = new Map();

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

  app.post("/api/forge-master/chat", (req, res) => {
    const { message, sessionId: reqSessionId } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    const sessionId = reqSessionId || randomUUID();
    const keywordOnly = req.headers["x-pforge-keyword-only"] === "1";
    sessions.set(sessionId, { createdAt: new Date().toISOString(), lastMessage: message, keywordOnly });
    res.json({
      sessionId,
      streamUrl: `/api/forge-master/chat/${sessionId}/stream?message=${encodeURIComponent(message)}`,
    });
  });

  app.get("/api/forge-master/chat/:sessionId/stream", async (req, res) => {
    const { sessionId } = req.params;
    const message = req.query.message || "";
    const session = sessions.get(sessionId) || {};
    const sse = createSseStream(res);
    try {
      sse.send("start", { sessionId });
      const result = await runTurn(
        { message, sessionId },
        {
          dispatcher,
          forceKeywordOnly: session.keywordOnly || false,
          onClassification: (data) => { sse.send("classification", data); },
        },
      );
      if (result.error) {
        sse.send("error", { error: result.error, sessionId });
      } else {
        sse.send("reply", { content: result.reply, sessionId });
        for (const tc of result.toolCalls || []) sse.send("tool-call", tc);
        sse.send("done", { sessionId, tokensIn: result.tokensIn, tokensOut: result.tokensOut });
      }
    } catch (err) {
      sse.send("error", { error: err.message });
    } finally {
      sse.close();
    }
  });

  app.post("/api/forge-master/chat/:sessionId/approve", (req, res) => {
    const { sessionId } = req.params;
    const { approvalId, decision, editedArgs } = req.body || {};
    const gate = pendingApprovals.get(approvalId);
    if (!gate) return res.status(404).json({ error: "approval not found" });
    gate({ decision, editedArgs });
    pendingApprovals.delete(approvalId);
    res.json({ ok: true, approvalId, decision });
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

    if (method === "POST" && path === "/api/forge-master/chat") {
      const body = await readBody(req);
      const { message, sessionId: reqSessionId } = body;
      if (!message) return json(res, 400, { error: "message required" });
      const sessionId = reqSessionId || randomUUID();
      const keywordOnly = req.headers["x-pforge-keyword-only"] === "1";
      sessions.set(sessionId, { createdAt: new Date().toISOString(), lastMessage: message, keywordOnly });
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
      const sse = createSseStream(res);
      try {
        sse.send("start", { sessionId });
        const result = await runTurn(
          { message, sessionId },
          {
            dispatcher,
            forceKeywordOnly: session.keywordOnly || false,
            onClassification: (data) => { sse.send("classification", data); },
          },
        );
        if (result.error) {
          sse.send("error", { error: result.error, sessionId });
        } else {
          sse.send("reply", { content: result.reply, sessionId });
          for (const tc of result.toolCalls || []) sse.send("tool-call", tc);
          sse.send("done", { sessionId, tokensIn: result.tokensIn, tokensOut: result.tokensOut });
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

    return json(res, 404, { error: "not found" });
  };
}
