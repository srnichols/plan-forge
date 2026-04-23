/**
 * Plan Forge — Forge-Master Hammer Harness Tests (Phase-37.2, Slice 1).
 *
 * Covers:
 *   - Scorer correctness (all 6 scorers)
 *   - SSE frame parsing (normal, CRLF, multi-data, chunk boundaries)
 *   - Scenario loader validation (valid, missing, invalid JSON, empty prompts, duplicate IDs)
 *   - Exit-code behavior via injected fetchFn (connection failure → 2, dry-run → 0, scorer fail → 1)
 *
 * All network calls are mocked via injected fetchFn / openStreamFn — no live server required.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  laneMatch,
  toolSetOverlap,
  replyContains,
  replyNotContains,
  toolSuccessRate,
  noErrorEvents,
  ALL_SCORERS,
} from "../../scripts/hammer-fm/scorers.mjs";
import { _parseSseFrame, openStream } from "../../scripts/hammer-fm/sse-client.mjs";
import { loadScenario, main } from "../../scripts/hammer-fm.mjs";

// ── Test fixtures ──────────────────────────────────────────────────

const CLASSIFICATION_OP = { event: "classification", data: { lane: "operational", confidence: 0.9 } };
const CLASSIFICATION_BUILD = { event: "classification", data: { lane: "build", confidence: 0.8 } };
const REPLY_EVENT = { event: "reply", data: { content: "Here is the plan status: everything is green." } };
const TOOL_PLAN_STATUS = { event: "tool-call", data: { name: "forge_plan_status", resultSummary: "status ok" } };
const TOOL_UNKNOWN = { event: "tool-call", data: { name: "forge_plan_status", resultSummary: '{"success":false,"error":"Unknown tool: forge_plan_status"}' } };
const DONE_EVENT = { event: "done", data: { tokensIn: 10, tokensOut: 20 } };
const ERROR_EVENT = { event: "error", data: { error: "reasoning failed" } };

let tmpDir;
let scenariosDir;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "hammer-fm-test-"));
  scenariosDir = join(tmpDir, "scenarios");
  mkdirSync(scenariosDir, { recursive: true });

  // Write a minimal valid scenario
  writeFileSync(
    join(scenariosDir, "test-scenario.json"),
    JSON.stringify({
      name: "test-scenario",
      description: "Test scenario",
      prompts: [
        {
          id: "p1",
          message: "What is the plan status?",
          expectedLane: "operational",
          expectedTools: ["forge_plan_status"],
        },
      ],
    }),
    "utf-8",
  );

  // Write a scenario with duplicate IDs
  writeFileSync(
    join(scenariosDir, "dup-ids.json"),
    JSON.stringify({
      name: "dup-ids",
      prompts: [
        { id: "same", message: "msg1" },
        { id: "same", message: "msg2" },
      ],
    }),
    "utf-8",
  );

  // Write a scenario with no prompts
  writeFileSync(
    join(scenariosDir, "empty.json"),
    JSON.stringify({ name: "empty", prompts: [] }),
    "utf-8",
  );
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Scorer: lane-match ─────────────────────────────────────────────

describe("scorer: laneMatch", () => {
  it("passes when classification lane matches expectedLane", () => {
    const result = laneMatch({ expectedLane: "operational" }, [CLASSIFICATION_OP, REPLY_EVENT, DONE_EVENT]);
    expect(result.pass).toBe(true);
    expect(result.reason).toContain("operational");
  });

  it("fails when classification lane does not match", () => {
    const result = laneMatch({ expectedLane: "operational" }, [CLASSIFICATION_BUILD, REPLY_EVENT]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("build");
  });

  it("passes with no expectedLane constraint", () => {
    const result = laneMatch({}, []);
    expect(result.pass).toBe(true);
  });

  it("fails when no classification event is present", () => {
    const result = laneMatch({ expectedLane: "operational" }, [REPLY_EVENT]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("no classification event");
  });
});

// ── Scorer: toolSetOverlap ─────────────────────────────────────────

describe("scorer: toolSetOverlap", () => {
  it("passes when expected tool appears in tool-call events", () => {
    const result = toolSetOverlap(
      { expectedTools: ["forge_plan_status"] },
      [TOOL_PLAN_STATUS, DONE_EVENT],
    );
    expect(result.pass).toBe(true);
    expect(result.reason).toContain("forge_plan_status");
  });

  it("fails when no expected tool appears in tool-call events", () => {
    const result = toolSetOverlap(
      { expectedTools: ["forge_cost_report"] },
      [TOOL_PLAN_STATUS, DONE_EVENT],
    );
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("forge_cost_report");
  });

  it("passes with no expectedTools constraint", () => {
    const result = toolSetOverlap({}, []);
    expect(result.pass).toBe(true);
  });
});

// ── Scorer: replyContains ──────────────────────────────────────────

describe("scorer: replyContains", () => {
  it("passes when all mustContain strings are in the reply", () => {
    const result = replyContains({ mustContain: ["plan status", "green"] }, [REPLY_EVENT]);
    expect(result.pass).toBe(true);
  });

  it("fails when a mustContain string is missing from the reply", () => {
    const result = replyContains({ mustContain: ["error", "failed"] }, [REPLY_EVENT]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("missing");
  });

  it("passes with no mustContain constraint (null)", () => {
    const result = replyContains({ mustContain: null }, []);
    expect(result.pass).toBe(true);
  });
});

// ── Scorer: replyNotContains ───────────────────────────────────────

describe("scorer: replyNotContains", () => {
  it("passes when none of the mustNotContain strings appear in the reply", () => {
    const result = replyNotContains({ mustNotContain: ["Unknown tool", "error"] }, [REPLY_EVENT]);
    expect(result.pass).toBe(true);
  });

  it("fails when a forbidden string appears in the reply", () => {
    const badReply = { event: "reply", data: { content: "Unknown tool: forge_plan_status" } };
    const result = replyNotContains({ mustNotContain: ["Unknown tool"] }, [badReply]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("Unknown tool");
  });
});

// ── Scorer: toolSuccessRate ────────────────────────────────────────

describe("scorer: toolSuccessRate", () => {
  it("passes when all tool calls succeed", () => {
    const result = toolSuccessRate({}, [TOOL_PLAN_STATUS]);
    expect(result.pass).toBe(true);
    expect(result.reason).toContain("1/1");
  });

  it("fails when majority of tool calls have Unknown tool error", () => {
    const result = toolSuccessRate({}, [TOOL_UNKNOWN]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("0/1");
  });

  it("passes when no tool calls occurred", () => {
    const result = toolSuccessRate({}, [REPLY_EVENT, DONE_EVENT]);
    expect(result.pass).toBe(true);
    expect(result.reason).toBe("no tool calls");
  });
});

// ── Scorer: noErrorEvents ──────────────────────────────────────────

describe("scorer: noErrorEvents", () => {
  it("passes when no error events are present", () => {
    const result = noErrorEvents({}, [CLASSIFICATION_OP, REPLY_EVENT, DONE_EVENT]);
    expect(result.pass).toBe(true);
  });

  it("fails when an error event is present", () => {
    const result = noErrorEvents({}, [CLASSIFICATION_OP, ERROR_EVENT]);
    expect(result.pass).toBe(false);
    expect(result.reason).toContain("1 error event");
  });
});

// ── ALL_SCORERS registry ───────────────────────────────────────────

describe("ALL_SCORERS registry", () => {
  it("exports all 6 scorers", () => {
    expect(ALL_SCORERS).toHaveLength(6);
    const names = ALL_SCORERS.map((s) => s.name);
    expect(names).toContain("lane-match");
    expect(names).toContain("tool-set-overlap");
    expect(names).toContain("reply-contains");
    expect(names).toContain("reply-not-contains");
    expect(names).toContain("tool-success-rate");
    expect(names).toContain("no-error-events");
  });
});

// ── SSE frame parser ───────────────────────────────────────────────

describe("_parseSseFrame", () => {
  it("parses a basic event:classification + data: frame", () => {
    const frame = 'event: classification\ndata: {"lane":"operational"}';
    const result = _parseSseFrame(frame);
    expect(result).not.toBeNull();
    expect(result.event).toBe("classification");
    expect(result.data).toEqual({ lane: "operational" });
  });

  it("handles CRLF line endings", () => {
    const frame = "event: reply\r\ndata: {\"content\":\"hello\"}";
    const result = _parseSseFrame(frame);
    expect(result).not.toBeNull();
    expect(result.event).toBe("reply");
    expect(result.data.content).toBe("hello");
  });

  it("defaults event type to 'message' when no event: field", () => {
    const frame = "data: hello";
    const result = _parseSseFrame(frame);
    expect(result).not.toBeNull();
    expect(result.event).toBe("message");
    expect(result.data).toBe("hello");
  });

  it("returns null for frames with no data: field", () => {
    const result = _parseSseFrame("event: start");
    expect(result).toBeNull();
  });

  it("handles non-JSON data as raw string", () => {
    const result = _parseSseFrame("data: plain text");
    expect(result).not.toBeNull();
    expect(result.data).toBe("plain text");
  });
});

// ── Scenario loader ────────────────────────────────────────────────

describe("loadScenario", () => {
  it("loads a valid scenario file successfully", () => {
    const { scenario, error } = loadScenario("test-scenario", { scenariosDir });
    expect(error).toBeUndefined();
    expect(scenario).toBeDefined();
    expect(scenario.prompts).toHaveLength(1);
    expect(scenario.prompts[0].id).toBe("p1");
  });

  it("returns error for missing file", () => {
    const { error } = loadScenario("does-not-exist", { scenariosDir });
    expect(error).toBeDefined();
    expect(error).toContain("not found");
  });

  it("returns error for empty prompts array", () => {
    const { error } = loadScenario("empty", { scenariosDir });
    expect(error).toBeDefined();
    expect(error).toContain("empty");
  });

  it("returns error for duplicate prompt IDs", () => {
    const { error } = loadScenario("dup-ids", { scenariosDir });
    expect(error).toBeDefined();
    expect(error).toContain("duplicate");
  });

  it("returns error for invalid JSON", () => {
    writeFileSync(join(scenariosDir, "bad-json.json"), "{ not valid json }", "utf-8");
    const { error } = loadScenario("bad-json", { scenariosDir });
    expect(error).toBeDefined();
    expect(error).toContain("invalid JSON");
  });
});

// ── Exit-code behavior (mocked fetch) ─────────────────────────────

describe("main() exit codes", () => {
  it("returns 0 for --dry-run with valid scenario", async () => {
    const code = await main(
      ["--scenario=test-scenario", "--dry-run"],
      { scenariosDir },
    );
    expect(code).toBe(0);
  });

  it("returns 1 when --scenario is missing", async () => {
    const code = await main([], {});
    expect(code).toBe(1);
  });

  it("returns 1 when scenario file not found", async () => {
    const code = await main(
      ["--scenario=nonexistent-scenario", "--dry-run"],
      { scenariosDir },
    );
    expect(code).toBe(1);
  });

  it("returns 2 when server is unreachable (connection error)", async () => {
    const failFetch = () => Promise.reject(new Error("ECONNREFUSED"));
    const code = await main(
      ["--scenario=test-scenario", "--tier=keyword-only"],
      { scenariosDir, fetchFn: failFetch },
    );
    expect(code).toBe(2);
  });

  it("returns 0 when all prompts pass all scorers (mocked good response)", async () => {
    const sessionId = "sess-abc123";
    const streamUrl = `/api/forge-master/chat/${sessionId}/stream`;

    const mockFetch = async (url) => {
      if (url.includes("/api/forge-master/capabilities")) {
        return { ok: true, json: async () => ({ status: "ok" }) };
      }
      if (url.includes("/api/forge-master/chat") && !url.includes("/stream")) {
        return {
          ok: true,
          json: async () => ({ sessionId, streamUrl }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const mockOpenStream = async () => ({
      events: [
        { event: "classification", data: { lane: "operational", confidence: 0.9 } },
        { event: "tool-call", data: { name: "forge_plan_status", resultSummary: "ok" } },
        { event: "reply", data: { content: "Status: all slices complete." } },
        { event: "done", data: { tokensIn: 5, tokensOut: 15 } },
      ],
      closedReason: "done",
    });

    const code = await main(
      ["--scenario=test-scenario", "--tier=keyword-only", "--out-dir=/tmp/hammer-test-out"],
      { scenariosDir, fetchFn: mockFetch, openStreamFn: mockOpenStream },
    );
    expect(code).toBe(0);
  });

  it("returns 1 when a prompt fails lane-match scorer (mocked wrong lane)", async () => {
    const sessionId = "sess-fail-lane";
    const streamUrl = `/api/forge-master/chat/${sessionId}/stream`;

    const mockFetch = async (url) => {
      if (url.includes("/api/forge-master/capabilities")) {
        return { ok: true, json: async () => ({ status: "ok" }) };
      }
      if (url.includes("/api/forge-master/chat") && !url.includes("/stream")) {
        return {
          ok: true,
          json: async () => ({ sessionId, streamUrl }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const mockOpenStream = async () => ({
      events: [
        { event: "classification", data: { lane: "offtopic", confidence: 0.6 } },
        { event: "reply", data: { content: "I cannot help with that." } },
        { event: "done", data: { tokensIn: 3, tokensOut: 8 } },
      ],
      closedReason: "done",
    });

    const code = await main(
      ["--scenario=test-scenario", "--tier=keyword-only", "--out-dir=/tmp/hammer-test-out"],
      { scenariosDir, fetchFn: mockFetch, openStreamFn: mockOpenStream },
    );
    expect(code).toBe(1);
  });
});

// ── openStream: chunk boundary handling ───────────────────────────

describe("openStream chunk boundary handling", () => {
  it("handles frames split across multiple chunks", async () => {
    // Simulate an SSE stream split at an arbitrary boundary
    const fullMsg =
      'event: classification\ndata: {"lane":"operational"}\n\n' +
      'event: done\ndata: {"tokensIn":1}\n\n';

    // Split at an arbitrary mid-frame position
    const mid = Math.floor(fullMsg.length / 2);
    const chunk1 = fullMsg.slice(0, mid);
    const chunk2 = fullMsg.slice(mid);

    let readCount = 0;
    const enc = new TextEncoder();
    const mockBody = {
      getReader() {
        return {
          read: async () => {
            if (readCount === 0) { readCount++; return { value: enc.encode(chunk1), done: false }; }
            if (readCount === 1) { readCount++; return { value: enc.encode(chunk2), done: false }; }
            return { value: undefined, done: true };
          },
        };
      },
    };

    const mockFetch = async () => ({ ok: true, body: mockBody });
    const { events, closedReason } = await openStream("http://fake/stream", { fetchFn: mockFetch });

    expect(closedReason).toBe("done");
    const cls = events.find((e) => e.event === "classification");
    expect(cls).toBeDefined();
    expect(cls.data.lane).toBe("operational");
  });
});
