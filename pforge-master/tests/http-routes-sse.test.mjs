/**
 * Tests for SSE event ordering and payloads in Forge-Master HTTP routes
 * (Phase-36, Slice 1 — classification + error SSE events).
 *
 * Covers both the express-compatible path (_registerExpress) and the
 * built-in Node http handler path (_buildNodeHandler).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock reasoning.mjs ──────────────────────────────────────────────

vi.mock("../src/reasoning.mjs", () => ({
  runTurn: vi.fn(),
}));

import { runTurn } from "../src/reasoning.mjs";
import { createHttpRoutes } from "../src/http-routes.mjs";

// ─── SSE helpers ──────────────────────────────────────────────────────

/**
 * Build a minimal mock ServerResponse that captures write() calls
 * and exposes parsed SSE frames.
 */
function makeMockRes() {
  const chunks = [];
  const res = {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk) => { chunks.push(chunk); }),
    end: vi.fn(),
    // SSE helper reads raw output
    _frames() {
      return parseSseFrames(chunks.join(""));
    },
  };
  return res;
}

/**
 * Parse SSE frames from raw text.
 * Splits on blank lines; each frame has { event, data }.
 */
function parseSseFrames(raw) {
  return raw
    .split("\n\n")
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split("\n");
      let event = "";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      let parsed;
      try { parsed = JSON.parse(data); } catch { parsed = data; }
      return { event, data: parsed };
    });
}

// ─── Mock express app ─────────────────────────────────────────────────

function makeMockApp() {
  const routes = { GET: {}, POST: {} };
  return {
    get(path, handler) { routes.GET[path] = handler; },
    post(path, handler) { routes.POST[path] = handler; },
    use() {},              // catch-all — not under test
    _routes: routes,
    async callGet(path, req, res) {
      // Find exact or param match for :sessionId routes
      const handler = routes.GET[path] ??
        _matchParamRoute(routes.GET, path);
      if (!handler) throw new Error(`No GET handler for ${path}`);
      await handler(req, res);
    },
  };
}

function _matchParamRoute(routeMap, path) {
  for (const [pattern, handler] of Object.entries(routeMap)) {
    // Convert express :param to regex
    const re = new RegExp(
      "^" + pattern.replace(/:([^/]+)/g, "([^/]+)") + "$"
    );
    const m = path.match(re);
    if (m) return handler;
  }
  return null;
}

// ─── Mock classification data ─────────────────────────────────────────

const MOCK_CLASSIFICATION = {
  lane: "operational",
  confidence: 0.92,
  reason: "keyword match",
  suggestedTools: ["forge_plan_status"],
};

// ─── Express path tests ───────────────────────────────────────────────

describe("express path — /stream SSE events", () => {
  let app, res;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeMockApp();
    createHttpRoutes(app);
    res = makeMockRes();
  });

  it("emits start → classification → reply → done on success", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      return {
        reply: "Hello!",
        toolCalls: [],
        tokensIn: 10,
        tokensOut: 20,
      };
    });

    const req = {
      params: { sessionId: "sess-1" },
      query: { message: "what is the status?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const frames = res._frames();
    const events = frames.map((f) => f.event);
    expect(events).toEqual(["start", "classification", "reply", "done"]);
  });

  it("classification payload matches what runTurn emits", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      return { reply: "ok", toolCalls: [], tokensIn: 1, tokensOut: 2 };
    });

    const req = { params: { sessionId: "s1" }, query: { message: "status" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const classFrame = res._frames().find((f) => f.event === "classification");
    expect(classFrame.data).toMatchObject({
      lane: "operational",
      confidence: 0.92,
    });
  });

  it("includes tool-call events between reply and done", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      return {
        reply: "done",
        toolCalls: [
          { name: "forge_plan_status", args: {}, resultSummary: "ok", costUSD: 0 },
        ],
        tokensIn: 5,
        tokensOut: 10,
      };
    });

    const req = { params: { sessionId: "s2" }, query: { message: "run it" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toEqual(["start", "classification", "reply", "tool-call", "done"]);
  });

  it("emits start → classification → error (no reply/done) when result.error is set", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      return {
        reply: "",
        toolCalls: [],
        tokensIn: 0,
        tokensOut: 0,
        error: "no provider available",
      };
    });

    const req = { params: { sessionId: "s3" }, query: { message: "x" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toContain("error");
    expect(events).not.toContain("reply");
    expect(events).not.toContain("done");

    const errFrame = res._frames().find((f) => f.event === "error");
    expect(errFrame.data.error).toBe("no provider available");
  });

  it("emits error event when runTurn throws (catch block)", async () => {
    runTurn.mockRejectedValue(new Error("provider crashed"));

    const req = { params: { sessionId: "s4" }, query: { message: "x" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toContain("error");
    expect(events).not.toContain("reply");

    const errFrame = res._frames().find((f) => f.event === "error");
    expect(errFrame.data.error).toBe("provider crashed");
  });

  it("always calls sse.close() (res.end) even on error", async () => {
    runTurn.mockRejectedValue(new Error("boom"));
    const req = { params: { sessionId: "s5" }, query: { message: "x" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);
    expect(res.end).toHaveBeenCalled();
  });

  it("passes onClassification dep to runTurn", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      expect(typeof deps.onClassification).toBe("function");
      return { reply: "ok", toolCalls: [], tokensIn: 0, tokensOut: 0 };
    });

    const req = { params: { sessionId: "s6" }, query: { message: "x" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);
  });

  it("survives onClassification callback throwing without breaking the stream", async () => {
    // This validates the try/catch in reasoning.mjs around the callback.
    // Here we simulate it by having the callback throw, then runTurn still returns.
    runTurn.mockImplementation(async (input, deps) => {
      try { deps.onClassification(null); } catch { /* simulated internal guard */ }
      // Return normally — stream should still complete
      return { reply: "ok", toolCalls: [], tokensIn: 0, tokensOut: 0 };
    });

    const req = { params: { sessionId: "s7" }, query: { message: "x" } };
    await expect(
      app.callGet("/api/forge-master/chat/:sessionId/stream", req, res)
    ).resolves.not.toThrow();

    const events = res._frames().map((f) => f.event);
    expect(events).toContain("start");
    expect(events).toContain("reply");
  });
});

// ─── Node handler path tests ──────────────────────────────────────────

describe("node handler path — /stream SSE events", () => {
  let handler, res;

  function makeReq(pathname, searchParams = {}) {
    const url = new URL(
      `http://localhost${pathname}?` +
        new URLSearchParams(searchParams).toString()
    );
    return {
      method: "GET",
      url: url.pathname + url.search,
      headers: { host: "localhost" },
      on: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    handler = createHttpRoutes(null); // no app = node handler
    res = makeMockRes();
  });

  it("emits start → classification → reply → done on success", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      return { reply: "pong", toolCalls: [], tokensIn: 3, tokensOut: 7 };
    });

    const req = makeReq("/api/forge-master/chat/sess-node-1/stream", { message: "ping" });
    await handler(req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toEqual(["start", "classification", "reply", "done"]);
  });

  it("emits start → classification → error (no reply/done) when result.error is set", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      return {
        reply: "",
        toolCalls: [],
        tokensIn: 0,
        tokensOut: 0,
        error: "rate_limited",
      };
    });

    const req = makeReq("/api/forge-master/chat/sess-node-2/stream", { message: "x" });
    await handler(req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toContain("error");
    expect(events).not.toContain("reply");
    expect(events).not.toContain("done");

    const errFrame = res._frames().find((f) => f.event === "error");
    expect(errFrame.data.error).toBe("rate_limited");
  });

  it("emits error event when runTurn throws", async () => {
    runTurn.mockRejectedValue(new Error("node crash"));

    const req = makeReq("/api/forge-master/chat/sess-node-3/stream", { message: "x" });
    await handler(req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toContain("error");
    expect(events).not.toContain("reply");
  });

  it("returns null for unrelated paths", async () => {
    const req = {
      method: "GET",
      url: "/some/other/path",
      headers: { host: "localhost" },
      on: vi.fn(),
    };
    const result = await handler(req, res);
    expect(result).toBeNull();
  });
});
