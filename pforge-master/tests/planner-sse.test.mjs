/**
 * Tests for planner SSE event ordering in Forge-Master HTTP routes
 * (Phase-38.4, Slice 3 — plan event wiring).
 *
 * Verifies that:
 *   - `plan` SSE event is emitted after `classification` and before `reply`
 *   - When planner skips (skipReason), event still fires with skipReason
 *   - When planner returns steps, plan event contains them
 *   - Planner failure falls through to reactive loop (no crash)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock reasoning.mjs ──────────────────────────────────────────────

vi.mock("../src/reasoning.mjs", () => ({
  runTurn: vi.fn(),
}));

import { runTurn } from "../src/reasoning.mjs";
import { createHttpRoutes } from "../src/http-routes.mjs";

// ─── SSE helpers ──────────────────────────────────────────────────────

function makeMockRes() {
  const chunks = [];
  const res = {
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn((chunk) => { chunks.push(chunk); }),
    end: vi.fn(),
    _frames() { return parseSseFrames(chunks.join("")); },
  };
  return res;
}

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
    if (path.match(re)) return handler;
  }
  return null;
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const MOCK_CLASSIFICATION = {
  lane: "operational",
  confidence: "high",
  reason: "keyword match",
  suggestedTools: ["forge_plan_status"],
};

const MOCK_PLAN_WITH_STEPS = {
  steps: [
    { id: "step-0", tool: "forge_plan_status", args: {}, rationale: "check status" },
    { id: "step-1", tool: "forge_bug_list", args: {}, rationale: "check bugs" },
  ],
};

const MOCK_PLAN_SKIPPED = {
  steps: [],
  skipReason: "single-tool-obvious",
};

// ─── Express path tests ───────────────────────────────────────────────

describe("express path — plan SSE event ordering", () => {
  let app, res;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeMockApp();
    createHttpRoutes(app);
    res = makeMockRes();
  });

  it("emits start → classification → plan → reply → done when planner returns steps", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      deps.onPlan(MOCK_PLAN_WITH_STEPS);
      return {
        reply: "Status looks good.",
        toolCalls: [],
        tokensIn: 50,
        tokensOut: 30,
      };
    });

    const req = {
      params: { sessionId: "plan-1" },
      query: { message: "what is the plan status?" },
    };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toEqual(["start", "classification", "plan", "reply", "done"]);
  });

  it("plan event payload contains steps array", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      deps.onPlan(MOCK_PLAN_WITH_STEPS);
      return { reply: "ok", toolCalls: [], tokensIn: 1, tokensOut: 2 };
    });

    const req = { params: { sessionId: "plan-2" }, query: { message: "status" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const planFrame = res._frames().find((f) => f.event === "plan");
    expect(planFrame).toBeDefined();
    expect(planFrame.data.steps).toHaveLength(2);
    expect(planFrame.data.steps[0].tool).toBe("forge_plan_status");
    expect(planFrame.data.steps[1].tool).toBe("forge_bug_list");
  });

  it("plan event payload contains skipReason when planner skips", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      deps.onPlan(MOCK_PLAN_SKIPPED);
      return { reply: "done", toolCalls: [], tokensIn: 5, tokensOut: 10 };
    });

    const req = { params: { sessionId: "plan-3" }, query: { message: "run it" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const planFrame = res._frames().find((f) => f.event === "plan");
    expect(planFrame).toBeDefined();
    expect(planFrame.data.skipReason).toBe("single-tool-obvious");
    expect(planFrame.data.steps).toEqual([]);
  });

  it("plan event appears after classification and before reply", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      deps.onPlan(MOCK_PLAN_WITH_STEPS);
      return { reply: "ok", toolCalls: [], tokensIn: 1, tokensOut: 1 };
    });

    const req = { params: { sessionId: "plan-4" }, query: { message: "check" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const events = res._frames().map((f) => f.event);
    const classIdx = events.indexOf("classification");
    const planIdx = events.indexOf("plan");
    const replyIdx = events.indexOf("reply");
    expect(planIdx).toBeGreaterThan(classIdx);
    expect(planIdx).toBeLessThan(replyIdx);
  });

  it("onPlan callback is passed to runTurn deps", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      expect(typeof deps.onPlan).toBe("function");
      return { reply: "ok", toolCalls: [], tokensIn: 0, tokensOut: 0 };
    });

    const req = { params: { sessionId: "plan-5" }, query: { message: "x" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);
  });

  it("stream completes normally when onPlan is never called", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      // Planner skipped entirely — onPlan not called
      return { reply: "ok", toolCalls: [], tokensIn: 1, tokensOut: 1 };
    });

    const req = { params: { sessionId: "plan-6" }, query: { message: "x" } };
    await app.callGet("/api/forge-master/chat/:sessionId/stream", req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toContain("start");
    expect(events).toContain("reply");
    expect(events).toContain("done");
    expect(events).not.toContain("plan");
  });
});

// ─── Node handler path tests ──────────────────────────────────────────

describe("node handler path — plan SSE event ordering", () => {
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
    handler = createHttpRoutes(null);
    res = makeMockRes();
  });

  it("emits start → classification → plan → reply → done on success", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      deps.onPlan(MOCK_PLAN_WITH_STEPS);
      return { reply: "pong", toolCalls: [], tokensIn: 3, tokensOut: 7 };
    });

    const req = makeReq("/api/forge-master/chat/node-plan-1/stream", { message: "ping" });
    await handler(req, res);

    const events = res._frames().map((f) => f.event);
    expect(events).toEqual(["start", "classification", "plan", "reply", "done"]);
  });

  it("plan event has steps in node handler path", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      deps.onPlan(MOCK_PLAN_WITH_STEPS);
      return { reply: "ok", toolCalls: [], tokensIn: 1, tokensOut: 1 };
    });

    const req = makeReq("/api/forge-master/chat/node-plan-2/stream", { message: "go" });
    await handler(req, res);

    const planFrame = res._frames().find((f) => f.event === "plan");
    expect(planFrame).toBeDefined();
    expect(planFrame.data.steps).toHaveLength(2);
  });

  it("plan event with skipReason in node handler path", async () => {
    runTurn.mockImplementation(async (input, deps) => {
      deps.onClassification(MOCK_CLASSIFICATION);
      deps.onPlan(MOCK_PLAN_SKIPPED);
      return { reply: "ok", toolCalls: [], tokensIn: 1, tokensOut: 1 };
    });

    const req = makeReq("/api/forge-master/chat/node-plan-3/stream", { message: "go" });
    await handler(req, res);

    const planFrame = res._frames().find((f) => f.event === "plan");
    expect(planFrame).toBeDefined();
    expect(planFrame.data.skipReason).toBe("single-tool-obvious");
  });
});
