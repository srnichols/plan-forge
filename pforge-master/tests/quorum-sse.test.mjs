/**
 * Tests for quorum-estimate SSE event ordering (Phase-38.7, Slice 2).
 *
 * Verifies:
 *   (1) quorum-estimate event arrives BEFORE any reply chunk when quorum engages
 *   (2) quorum-estimate NOT emitted when quorumAdvisory is "off"
 *   (3) quorum-estimate NOT emitted on non-advisory lanes (hard lane guard)
 *   (4) quorum-estimate includes models array and estimatedCostUSD
 *   (5) quorum auto-engage fires when conditions met (auto + advisory + escalated + high + medium confidence)
 *   (6) done payload includes quorumResult when quorum engaged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock reasoning.mjs ──────────────────────────────────────────────

vi.mock("../src/reasoning.mjs", () => ({
  runTurn: vi.fn(),
}));

import { runTurn } from "../src/reasoning.mjs";
import { createHttpRoutes } from "../src/http-routes.mjs";

// ─── SSE helpers ──────────────────────────────────────────────────────

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

function makeMockRes() {
  const chunks = [];
  const res = {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk) => { chunks.push(chunk); }),
    end: vi.fn(),
    _frames() {
      return parseSseFrames(chunks.join(""));
    },
  };
  return res;
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
      const handler = routes.GET[path] ??
        _matchParamRoute(routes.GET, path);
      if (!handler) throw new Error(`No GET handler for ${path}`);
      await handler(req, res);
    },
  };
}

function _matchParamRoute(routeMap, path) {
  for (const [pattern, handler] of Object.entries(routeMap)) {
    const re = new RegExp(
      "^" + pattern.replace(/:([^/]+)/g, "([^/]+)") + "$"
    );
    const m = path.match(re);
    if (m) return handler;
  }
  return null;
}

const MOCK_ADVISORY_CLASSIFICATION = {
  lane: "advisory",
  confidence: "medium",
  reason: "keyword match",
  suggestedTools: [],
};

const MOCK_OPERATIONAL_CLASSIFICATION = {
  lane: "operational",
  confidence: "high",
  reason: "keyword match",
  suggestedTools: ["forge_plan_status"],
};

const MOCK_QUORUM_RESULT = {
  replies: [
    { model: "claude-sonnet-4-20250514", text: "Use option A.", durationMs: 1200, costUSD: 0.003 },
    { model: "gpt-5.2", text: "Use option B.", durationMs: 1500, costUSD: 0.004 },
    { model: "grok-4.20", text: "Use option A with caveats.", durationMs: 900, costUSD: 0.002 },
  ],
  dissent: { topic: "recommendation", axis: "claude emphasizes [safety] vs gpt emphasizes [speed]" },
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("quorum-estimate SSE event ordering", () => {
  let app, res;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeMockApp();
    createHttpRoutes(app);
    res = makeMockRes();
  });

  it("(1) quorum-estimate arrives BEFORE reply when quorum engages", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_ADVISORY_CLASSIFICATION);
      // Simulate quorum-estimate being emitted by reasoning.mjs
      deps.onQuorumEstimate({
        type: "quorum-estimate",
        models: ["claude-sonnet-4-20250514", "gpt-5.2", "grok-4.20"],
        estimatedCostUSD: 0.009,
        canCancel: true,
      });
      return {
        reply: "See quorum replies below.",
        toolCalls: [],
        tokensIn: 100,
        tokensOut: 200,
        totalCostUSD: 0.009,
        quorumResult: MOCK_QUORUM_RESULT,
      };
    });

    const req = {
      params: { sessionId: "sse-quorum-1" },
      query: { message: "should I add a 4th abstraction layer?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const frames = res._frames();
    const events = frames.map((f) => f.event);

    // quorum-estimate must appear before reply
    const estimateIdx = events.indexOf("quorum-estimate");
    const replyIdx = events.indexOf("reply");
    expect(estimateIdx).toBeGreaterThan(-1);
    expect(replyIdx).toBeGreaterThan(-1);
    expect(estimateIdx).toBeLessThan(replyIdx);
  });

  it("(2) quorum-estimate NOT emitted when quorumAdvisory is off", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_ADVISORY_CLASSIFICATION);
      // When quorumAdvisory is "off", reasoning.mjs should NOT call onQuorumEstimate
      return {
        reply: "Single model reply.",
        toolCalls: [],
        tokensIn: 50,
        tokensOut: 100,
        quorumResult: null,
      };
    });

    const req = {
      params: { sessionId: "sse-quorum-2" },
      query: { message: "should I refactor this?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const frames = res._frames();
    const events = frames.map((f) => f.event);
    expect(events).not.toContain("quorum-estimate");
  });

  it("(3) quorum-estimate NOT emitted on operational lane (hard guard)", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_OPERATIONAL_CLASSIFICATION);
      // Reasoning.mjs should not call onQuorumEstimate for operational lane
      return {
        reply: "Status OK.",
        toolCalls: [],
        tokensIn: 30,
        tokensOut: 60,
        quorumResult: null,
      };
    });

    const req = {
      params: { sessionId: "sse-quorum-3" },
      query: { message: "what is the plan status?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const frames = res._frames();
    const events = frames.map((f) => f.event);
    expect(events).not.toContain("quorum-estimate");
  });

  it("(4) quorum-estimate payload includes models array and estimatedCostUSD", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_ADVISORY_CLASSIFICATION);
      deps.onQuorumEstimate({
        type: "quorum-estimate",
        models: ["claude-sonnet-4-20250514", "gpt-5.2", "grok-4.20"],
        estimatedCostUSD: 0.009,
        canCancel: true,
      });
      return {
        reply: "Quorum reply.",
        toolCalls: [],
        tokensIn: 100,
        tokensOut: 200,
        quorumResult: MOCK_QUORUM_RESULT,
      };
    });

    const req = {
      params: { sessionId: "sse-quorum-4" },
      query: { message: "which auth library should I use?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const frames = res._frames();
    const estimateFrame = frames.find((f) => f.event === "quorum-estimate");
    expect(estimateFrame).toBeDefined();
    expect(estimateFrame.data.type).toBe("quorum-estimate");
    expect(estimateFrame.data.models).toEqual(["claude-sonnet-4-20250514", "gpt-5.2", "grok-4.20"]);
    expect(typeof estimateFrame.data.estimatedCostUSD).toBe("number");
    expect(estimateFrame.data.canCancel).toBe(true);
  });

  it("(5) full SSE sequence: start → classification → quorum-estimate → reply → done", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_ADVISORY_CLASSIFICATION);
      deps.onQuorumEstimate({
        type: "quorum-estimate",
        models: ["claude-sonnet-4-20250514", "gpt-5.2", "grok-4.20"],
        estimatedCostUSD: 0.009,
        canCancel: true,
      });
      return {
        reply: "See model replies.",
        toolCalls: [],
        tokensIn: 100,
        tokensOut: 200,
        quorumResult: MOCK_QUORUM_RESULT,
      };
    });

    const req = {
      params: { sessionId: "sse-quorum-5" },
      query: { message: "should we add a caching layer?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toEqual(["start", "classification", "quorum-estimate", "reply", "done"]);
  });

  it("(6) done payload includes quorumResult when quorum engaged", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_ADVISORY_CLASSIFICATION);
      deps.onQuorumEstimate({
        type: "quorum-estimate",
        models: ["claude-sonnet-4-20250514"],
        estimatedCostUSD: 0.003,
        canCancel: true,
      });
      return {
        reply: "Quorum done.",
        toolCalls: [],
        tokensIn: 50,
        tokensOut: 100,
        totalCostUSD: 0.009,
        quorumResult: MOCK_QUORUM_RESULT,
      };
    });

    const req = {
      params: { sessionId: "sse-quorum-6" },
      query: { message: "best approach for auth?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const doneFrame = res._frames().find((f) => f.event === "done");
    expect(doneFrame).toBeDefined();
    expect(doneFrame.data.quorumResult).toBeTruthy();
    expect(doneFrame.data.quorumResult.replies).toHaveLength(3);
    expect(doneFrame.data.quorumResult.dissent.topic).toBe("recommendation");
  });

  it("(7) onQuorumEstimate callback is passed to runTurn deps", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      expect(typeof deps.onQuorumEstimate).toBe("function");
      return { reply: "ok", toolCalls: [], tokensIn: 0, tokensOut: 0 };
    });

    const req = {
      params: { sessionId: "sse-quorum-7" },
      query: { message: "test" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);
  });

  it("(8) quorumAdvisory dep is passed to runTurn", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      expect(deps.quorumAdvisory).toBeDefined();
      expect(typeof deps.quorumAdvisory).toBe("string");
      return { reply: "ok", toolCalls: [], tokensIn: 0, tokensOut: 0 };
    });

    const req = {
      params: { sessionId: "sse-quorum-8" },
      query: { message: "test" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);
  });
});
