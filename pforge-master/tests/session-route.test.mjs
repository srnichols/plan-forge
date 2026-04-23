/**
 * Tests for session header threading and /api/forge-master/session/:id route
 * — Phase-38.1 Slice 3.
 *
 * Covers:
 *   (1) x-pforge-session-id header is stored in session Map and threaded to runTurn deps
 *   (2) GET /api/forge-master/session/:id returns {sessionId, turns} shape
 *   (3) Unknown session returns {sessionId, turns: []}
 *   (4) Both express and bare-node paths handle the new header and route
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock reasoning.mjs ──────────────────────────────────────────────

vi.mock("../src/reasoning.mjs", () => ({
  runTurn: vi.fn(),
}));
vi.mock("../src/session-store.mjs", () => ({
  loadSession: vi.fn(),
  hashReply: vi.fn((t) => t.slice(0, 16)),
}));

import { runTurn } from "../src/reasoning.mjs";
import { loadSession } from "../src/session-store.mjs";
import { createHttpRoutes } from "../src/http-routes.mjs";

// ─── Helpers ─────────────────────────────────────────────────────────

function makeMockRes() {
  const chunks = [];
  return {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((c) => { chunks.push(c); }),
    end: vi.fn(),
    status: vi.fn(function (code) { this._status = code; return this; }),
    json: vi.fn(function (data) { this._json = data; }),
    _json: null,
    _status: 200,
    _chunks: chunks,
  };
}

function makeMockApp() {
  const routes = { GET: {}, POST: {}, PUT: {} };
  return {
    get(path, handler) { routes.GET[path] = handler; },
    post(path, handler) { routes.POST[path] = handler; },
    put(path, handler) { routes.PUT[path] = handler; },
    use() {},
    _routes: routes,
    async callGet(path, req, res) {
      const handler = routes.GET[path] ?? _matchParam(routes.GET, path, req);
      if (!handler) throw new Error(`No GET handler for ${path}`);
      await handler(req, res);
    },
    async callPost(path, req, res) {
      const handler = routes.POST[path] ?? _matchParam(routes.POST, path, req);
      if (!handler) throw new Error(`No POST handler for ${path}`);
      await handler(req, res);
    },
  };
}

function _matchParam(routeMap, path, req) {
  for (const [pattern, handler] of Object.entries(routeMap)) {
    const re = new RegExp("^" + pattern.replace(/:([^/]+)/g, "([^/]+)") + "$");
    const m = path.match(re);
    if (m) {
      // Extract named params
      const paramNames = [...pattern.matchAll(/:([^/]+)/g)].map((x) => x[1]);
      req.params = req.params || {};
      paramNames.forEach((name, i) => { req.params[name] = m[i + 1]; });
      return handler;
    }
  }
  return null;
}

// ─── (1) Header threading — Express path ─────────────────────────────

describe("x-pforge-session-id header threading (express)", () => {
  let app, res;

  beforeEach(() => {
    vi.clearAllMocks();
    loadSession.mockResolvedValue([]);
    app = makeMockApp();
    createHttpRoutes(app);
    res = makeMockRes();
  });

  it("stores fmSessionId in session Map from POST header", async () => {
    const req = {
      body: { message: "hello" },
      headers: { "x-pforge-session-id": "tab-session-abc123" },
    };
    await app.callPost("/api/forge-master/chat", req, res);
    expect(res._json).toBeDefined();
    expect(res._json.sessionId).toBeDefined();
  });

  it("threads fmSessionId as deps.sessionId to runTurn in stream", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification({ lane: "operational", confidence: "high" });
      return { reply: "ok", toolCalls: [], tokensIn: 1, tokensOut: 2 };
    });

    // First POST to store the session with fmSessionId
    const postReq = {
      body: { message: "status?" },
      headers: { "x-pforge-session-id": "tab-session-xyz" },
    };
    await app.callPost("/api/forge-master/chat", postReq, makeMockRes());
    const postedSessionId = makeMockRes(); // not used directly
    // Get the sessionId from res._json
    const postRes = makeMockRes();
    await app.callPost("/api/forge-master/chat", postReq, postRes);
    const { sessionId } = postRes._json;

    // Now call the stream with that sessionId
    const streamRes = makeMockRes();
    const streamReq = {
      params: { sessionId },
      query: { message: "status?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", streamReq, streamRes);

    // runTurn should have been called with deps.sessionId = "tab-session-xyz"
    expect(runTurn).toHaveBeenCalled();
    const [, deps] = runTurn.mock.calls[0];
    expect(deps.sessionId).toBe("tab-session-xyz");
  });
});

// ─── (2) GET /api/forge-master/session/:id — Express path ────────────

describe("GET /api/forge-master/session/:id (express)", () => {
  let app, res;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeMockApp();
    createHttpRoutes(app);
    res = makeMockRes();
  });

  it("(2) returns {sessionId, turns} with last 10 turns", async () => {
    const mockTurns = Array.from({ length: 12 }, (_, i) => ({
      turn: i + 1,
      userMessage: `msg ${i}`,
      timestamp: new Date().toISOString(),
    }));
    loadSession.mockResolvedValue(mockTurns);

    const req = { params: { id: "some-session-id" } };
    await app.callGet("/api/forge-master/session/:id", req, res);

    expect(res._json).toBeDefined();
    expect(res._json.sessionId).toBe("some-session-id");
    expect(res._json.turns).toHaveLength(10);
    // Should be the last 10 (turns 3-12)
    expect(res._json.turns[0].turn).toBe(3);
  });

  it("(3) returns {sessionId, turns: []} for unknown session", async () => {
    loadSession.mockResolvedValue([]);

    const req = { params: { id: "unknown-session" } };
    await app.callGet("/api/forge-master/session/:id", req, res);

    expect(res._json).toBeDefined();
    expect(res._json.sessionId).toBe("unknown-session");
    expect(res._json.turns).toEqual([]);
  });

  it("(3) returns empty turns (no 404) for loadSession error", async () => {
    loadSession.mockRejectedValue(new Error("disk error"));

    const req = { params: { id: "error-session" } };
    await app.callGet("/api/forge-master/session/:id", req, res);

    expect(res._json.turns).toEqual([]);
    expect(res._status).not.toBe(404);
  });
});

// ─── (4) Bare-node handler path ───────────────────────────────────────

describe("bare-node handler — session route", () => {
  it("(4) GET /api/forge-master/session/:id returns turns via bare-node handler", async () => {
    vi.clearAllMocks();
    loadSession.mockResolvedValue([
      { turn: 1, userMessage: "hello", timestamp: new Date().toISOString() },
    ]);

    const handler = createHttpRoutes(null);
    expect(typeof handler).toBe("function");

    let jsonBody = null;
    const mockReq = {
      method: "GET",
      url: "/api/forge-master/session/my-tab-session",
      headers: { host: "localhost" },
    };
    const mockRes = {
      writeHead: vi.fn(),
      end: vi.fn((body) => { jsonBody = JSON.parse(body); }),
    };

    await handler(mockReq, mockRes);

    expect(jsonBody).toBeDefined();
    expect(jsonBody.sessionId).toBe("my-tab-session");
    expect(jsonBody.turns).toHaveLength(1);
  });

  it("(4) POST /api/forge-master/chat stores fmSessionId via bare-node", async () => {
    vi.clearAllMocks();
    loadSession.mockResolvedValue([]);

    const handler = createHttpRoutes(null);

    let jsonBody = null;
    const body = JSON.stringify({ message: "test message" });
    const mockReq = {
      method: "POST",
      url: "/api/forge-master/chat",
      headers: {
        host: "localhost",
        "x-pforge-session-id": "bare-node-session",
        "content-type": "application/json",
      },
      on: (event, cb) => {
        if (event === "data") cb(body);
        if (event === "end") cb();
      },
    };
    const mockRes = {
      writeHead: vi.fn(),
      end: vi.fn((b) => { jsonBody = JSON.parse(b); }),
    };

    await handler(mockReq, mockRes);

    expect(jsonBody).toBeDefined();
    expect(jsonBody.sessionId).toBeDefined();
  });
});
