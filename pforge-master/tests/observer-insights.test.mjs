import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_INSIGHTS_MESSAGE,
  INSIGHTS_TAG,
  buildInsightEvent,
  createInsightRing,
  emitObserverInsights,
  finalizeInsights,
  fingerprintInsight,
  insightRing,
  paginateInsights,
  validateInsights,
} from "../src/observer-insights.mjs";
import { OBSERVER_SYSTEM_PROMPT } from "../src/observer-prompt.mjs";
import { runObserverTurn } from "../src/reasoning.mjs";
import { FORGE_MASTER_INSIGHT_EVENT as REGISTERED_INSIGHT_EVENT } from "../../pforge-mcp/enums.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(here, "../server.mjs"), "utf8");
const insightSource = readFileSync(join(here, "../src/observer-insights.mjs"), "utf8");

const insightItem = (overrides = {}) => ({
  severity: "warn",
  summary: "Repeated gate failures",
  evidence: [{ eventType: "gate-failed", ref: "slice-2" }],
  suggestedAction: null,
  ...overrides,
});

const fencedReply = (items) => `Notable pattern found.\n\n${"`".repeat(3)}${INSIGHTS_TAG}\n${JSON.stringify(items)}\n${"`".repeat(3)}`;

function makeProvider(content) {
  return {
    PROVIDER_NAME: "stub",
    sendTurn: vi.fn(async () => ({ type: "reply", content, tokensIn: 10, tokensOut: 20 })),
  };
}

function observerOptions(provider, overrides = {}) {
  return {
    provider,
    config: {
      observer: { enabled: true, maxUsdPerDay: 1, maxNarrationsPerHour: 6, brainCapture: false },
      reasoningModel: "stub-model",
    },
    budgetState: { dailyUsd: 0, dailyDate: "2099-01-01", hourlyNarrations: 0, hourlyHour: "2099-01-01T00" },
    _checkBudget: () => ({ ok: true }),
    _recordSpend: (state) => state,
    _saveBudgetState: () => {},
    ...overrides,
  };
}

afterEach(() => {
  insightRing.clear();
  vi.useRealTimers();
});

describe("structured observer insight parsing", () => {
  it("parses a valid tagged block and removes it from narration", () => {
    const reply = fencedReply([insightItem()]);
    const result = finalizeInsights(reply);

    expect(result.found).toBe(true);
    expect(result.insights).toHaveLength(1);
    expect(result.narration).toBe("Notable pattern found.");
    expect(result.insights[0].severity).toBe("warn");
  });

  it("drops malformed JSON and removes its block", () => {
    const result = finalizeInsights(`Text\n${"`".repeat(3)}${INSIGHTS_TAG}\n{broken\n${"`".repeat(3)}`);
    expect(result.insights).toEqual([]);
    expect(result.narration).toBe("Text");
  });

  it("drops a non-array JSON root", () => {
    expect(validateInsights({ severity: "info" })).toEqual({ insights: [], dropped: 0 });
    expect(finalizeInsights(fencedReply({ severity: "info" })).insights).toEqual([]);
  });

  it("drops unknown severity and empty summaries", () => {
    const result = validateInsights([
      insightItem({ severity: "urgent" }),
      insightItem({ summary: "  " }),
    ]);
    expect(result).toEqual({ insights: [], dropped: 2 });
  });

  it("bounds summaries and evidence", () => {
    const result = validateInsights([insightItem({
      summary: "s".repeat(250),
      evidence: Array.from({ length: 7 }, (_, index) => ({ eventType: `event-${index}`, ref: "r".repeat(250) })),
    })]);
    expect(result.insights[0].summary).toHaveLength(200);
    expect(result.insights[0].evidence).toHaveLength(5);
    expect(result.insights[0].evidence[0].eventType).toBe("event-0");
    expect(result.insights[0].evidence[0].ref).toHaveLength(200);
  });

  it("drops malformed evidence and nulls invalid suggested actions", () => {
    const result = validateInsights([insightItem({
      evidence: [{ eventType: "gate-failed", ref: "slice-2" }, {}, { eventType: 3, ref: "bad" }],
      suggestedAction: { type: "task", args: { description: "" } },
    })]);
    expect(result.insights[0].evidence).toEqual([{ eventType: "gate-failed", ref: "slice-2" }]);
    expect(result.insights[0].suggestedAction).toBeNull();
  });

  it("ignores supplied ids and copies only declared fields", () => {
    const raw = JSON.parse('{"severity":"info","summary":"safe","evidence":[],"id":"attacker-id","__proto__":{"polluted":true},"extra":"ignored"}');
    const [result] = validateInsights([raw]).insights;
    expect(result.id).not.toBe("attacker-id");
    expect(Object.keys(result).sort()).toEqual(["evidence", "id", "severity", "suggestedAction", "summary"]);
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect({}.polluted).toBeUndefined();
  });

  it("caps insights at five per turn and counts excess items as dropped", () => {
    const result = validateInsights(Array.from({ length: 7 }, (_, index) => insightItem({ summary: `item ${index}` })));
    expect(result.insights).toHaveLength(5);
    expect(result.dropped).toBe(2);
  });

  it("uses the first block and strips every complete tagged block", () => {
    const reply = `${fencedReply([insightItem({ summary: "first" })])}\n\n${fencedReply([insightItem({ summary: "second" })])}`;
    const result = finalizeInsights(reply);
    expect(result.insights.map(({ summary }) => summary)).toEqual(["first"]);
    expect(result.narration).toBe("Notable pattern found.\n\nNotable pattern found.");
  });

  it("removes an unfinished tagged fence", () => {
    const result = finalizeInsights(`Opening prose\n${"`".repeat(3)}${INSIGHTS_TAG}\n[`);
    expect(result.found).toBe(true);
    expect(result.insights).toEqual([]);
    expect(result.narration).toBe("Opening prose");
  });

  it("preserves a prose-only reply byte-for-byte", () => {
    const reply = "  prose only\nwith spacing  \n";
    expect(finalizeInsights(reply)).toEqual({ insights: [], narration: reply, found: false });
  });
});

describe("observer insight fingerprints", () => {
  it("stays stable across key order, case, whitespace, refs, and time", () => {
    vi.useFakeTimers();
    const first = fingerprintInsight({
      severity: "warn",
      summary: "Repeated   Gate\nFailures",
      evidence: [{ eventType: "slice-failed", ref: "run-a" }, { eventType: "gate-failed", ref: "ref-a" }],
    });
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const second = fingerprintInsight({
      evidence: [{ ref: "different", eventType: "gate-failed" }, { ref: "other", eventType: "slice-failed" }],
      summary: " repeated gate failures ",
      severity: "warn",
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^fmi-[a-f0-9]{16}$/);
  });

  it("changes when severity or normalized summary changes", () => {
    const base = insightItem();
    expect(fingerprintInsight(base)).not.toBe(fingerprintInsight({ ...base, severity: "critical" }));
    expect(fingerprintInsight(base)).not.toBe(fingerprintInsight({ ...base, summary: "Different failure" }));
  });
});

describe("observer insight hub emission", () => {
  it("returns insights and broadcasts the registered envelope after narration", async () => {
    const ring = createInsightRing();
    const hub = { broadcast: vi.fn() };
    const provider = makeProvider(fencedReply([insightItem()]));
    const result = await runObserverTurn([{ type: "gate-failed", runId: "run-1" }], observerOptions(provider, { hub, insightRing: ring }));

    expect(result.ok).toBe(true);
    expect(result.narration).toBe("Notable pattern found.");
    expect(result.insights).toHaveLength(1);
    expect(REGISTERED_INSIGHT_EVENT).toBe("forge-master-insight");
    expect(hub.broadcast).toHaveBeenCalledTimes(2);
    const event = hub.broadcast.mock.calls[1][0];
    expect(event.type).toBe(REGISTERED_INSIGHT_EVENT);
    expect(event).toMatchObject({
      type: REGISTERED_INSIGHT_EVENT,
      source: "forge-master",
      runId: "run-1",
      insight: result.insights[0],
    });
    expect(typeof event.ts).toBe("string");
    expect(ring.size()).toBe(1);
  });

  it("broadcasts exactly the narration event for a prose-only reply", async () => {
    const hub = { broadcast: vi.fn() };
    const result = await runObserverTurn([], observerOptions(makeProvider("plain narration"), { hub }));
    expect(result.narration).toBe("plain narration");
    expect(result.insights).toEqual([]);
    expect(hub.broadcast).toHaveBeenCalledTimes(1);
  });

  it("does not retain or broadcast insights when budget blocks the turn", async () => {
    const ring = createInsightRing();
    const hub = { broadcast: vi.fn() };
    const provider = makeProvider(fencedReply([insightItem()]));
    const result = await runObserverTurn([], observerOptions(provider, {
      hub,
      insightRing: ring,
      _checkBudget: () => ({ ok: false, reason: "budget exceeded" }),
    }));
    expect(result.ok).toBe(false);
    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(ring.size()).toBe(0);
    expect(hub.broadcast.mock.calls.some(([event]) => event.type === REGISTERED_INSIGHT_EVENT)).toBe(false);
  });

  it("does not fail the successful turn when insight broadcasting throws", async () => {
    const hub = {
      broadcast: vi.fn((event) => {
        if (event.type === REGISTERED_INSIGHT_EVENT) throw new Error("hub disconnected");
      }),
    };
    const result = await runObserverTurn([], observerOptions(makeProvider(fencedReply([insightItem()])), {
      hub,
    }));
    expect(result.ok).toBe(true);
    expect(result.insights).toHaveLength(1);
    expect(hub.broadcast).toHaveBeenCalledTimes(2);
  });

  it("only attaches a run id when every batch event shares the same non-empty id", () => {
    expect(buildInsightEvent(insightItem(), { runId: "run", ts: "now" }).runId).toBe("run");
    expect(buildInsightEvent(insightItem(), { runId: "", ts: "now" })).not.toHaveProperty("runId");
    const hub = { broadcast: vi.fn() };
    emitObserverInsights({
      hub,
      batch: [{ runId: "run-a" }, { runId: "run-b" }],
      insights: [insightItem()],
      ring: createInsightRing(),
    });
    expect(hub.broadcast.mock.calls[0][0]).not.toHaveProperty("runId");
  });
});

describe("observer insight ring and pagination", () => {
  it("retains the newest 50 entries and reports eviction", () => {
    const ring = createInsightRing();
    for (let index = 0; index < 60; index += 1) {
      ring.push({ ...insightItem({ summary: `entry ${index}`, evidence: [{ eventType: `event-${index}`, ref: "ref" }] }), id: `id-${index}` });
    }
    const page = ring.page({ limit: 25 });
    const finalPage = ring.page({ limit: 25, cursor: page.nextCursor });
    expect(ring.size()).toBe(50);
    expect(page.insights[0].insight.summary).toBe("entry 59");
    expect(finalPage.insights.at(-1).insight.summary).toBe("entry 10");
    expect(page.truncated).toBe(true);
  });

  it("updates duplicate ids without increasing total", () => {
    const ring = createInsightRing();
    const insight = insightItem({ id: "same-id" });
    ring.push(insight, { ts: "2030-01-01T00:00:00.000Z" });
    ring.push(insight, { ts: "2030-01-02T00:00:00.000Z" });
    const page = ring.page({});
    expect(page.total).toBe(1);
    expect(page.insights[0].count).toBe(2);
    expect(page.insights[0].lastSeenAt).toBe("2030-01-02T00:00:00.000Z");
  });

  it("follows sequence cursors and returns the final page", () => {
    const ring = createInsightRing();
    for (let index = 0; index < 12; index += 1) {
      ring.push({ ...insightItem({ summary: `entry-${index}`, evidence: [{ eventType: `event-${index}`, ref: "ref" }] }), id: `id-${index}` });
    }
    const first = paginateInsights({ limit: 5 }, ring);
    const second = paginateInsights({ limit: 5, cursor: first.nextCursor }, ring);
    const third = paginateInsights({ limit: 5, cursor: second.nextCursor }, ring);
    expect(first.insights).toHaveLength(5);
    expect(first.nextCursor).toBeTruthy();
    expect(second.insights).toHaveLength(5);
    expect(third.insights).toHaveLength(2);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();
  });

  it("defaults to ten, clamps limits, and rejects invalid input", () => {
    const ring = createInsightRing();
    for (let index = 0; index < 30; index += 1) {
      ring.push({ ...insightItem({ summary: `entry-${index}`, evidence: [{ eventType: `event-${index}`, ref: "ref" }] }), id: `id-${index}` });
    }
    expect(paginateInsights({}, ring).limit).toBe(10);
    expect(paginateInsights({ limit: 99 }, ring).limit).toBe(25);
    expect(paginateInsights({ limit: 1.5 }, ring).ok).toBe(false);
    expect(paginateInsights({ cursor: "not-a-number" }, ring).ok).toBe(false);
    expect(paginateInsights({ cursor: 10 }, ring).ok).toBe(false);
  });

  it("keeps the default page below 10 KB", () => {
    const ring = createInsightRing();
    for (let index = 0; index < 10; index += 1) {
      ring.push({ ...insightItem({ summary: "s".repeat(200), evidence: [{ eventType: "e".repeat(80), ref: "r".repeat(200) }] }), id: `id-${index}` });
    }
    expect(JSON.stringify(paginateInsights({}, ring)).length).toBeLessThan(10_000);
  });

  it("describes empty and past-end pages", () => {
    const ring = createInsightRing();
    expect(paginateInsights({}, ring)).toMatchObject({
      insights: [],
      total: 0,
      hasMore: false,
      message: EMPTY_INSIGHTS_MESSAGE,
    });
    ring.push(insightItem());
    expect(paginateInsights({ cursor: "0" }, ring)).toMatchObject({
      insights: [],
      hasMore: false,
      message: expect.stringContaining("No observer insights"),
    });
  });
});

describe("observer integration source guards", () => {
  it("advertises paginated observer status without importing the tool dispatcher", () => {
    expect(serverSource).toContain("paginateInsights");
    expect(serverSource).toContain("limit:");
    expect(serverSource).toContain("cursor:");
    expect(insightSource).not.toContain("invokeForgeTool");
    expect(insightSource).not.toContain("dispatcher");
  });

  it("keeps observer scheduling separate from runObserverTurn", () => {
    const onBatch = serverSource.match(/onBatch:\s*\(batch\)\s*=>\s*\{([\s\S]*?)\n\s*\},/);
    expect(onBatch).not.toBeNull();
    expect(onBatch[1]).not.toMatch(/runObserverTurn\s*\(/);
  });

  it("includes the structured insight contract in the system prompt", () => {
    expect(OBSERVER_SYSTEM_PROMPT).toContain(INSIGHTS_TAG);
  });
});
