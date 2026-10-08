import { afterEach, describe, expect, it, vi } from "vitest";

import { FORGE_MASTER_INSIGHT_EVENT } from "../../pforge-mcp/enums.mjs";
import { OBSERVER_NARRATION_EVENT_TYPE } from "../src/observer-loop.mjs";
import {
  createObserverController,
  isObserverKillSwitchOn,
  OBSERVER_KILL_SWITCH_ENV,
} from "../src/observer-control.mjs";
import { createInsightRing, INSIGHTS_TAG } from "../src/observer-insights.mjs";

const FENCE = "`".repeat(3);
const ENABLED_CONFIG = {
  observer: { enabled: true, maxUsdPerDay: 1, maxNarrationsPerHour: 6, brainCapture: false, modelTier: null },
  reasoningModel: "stub-model",
};
const BATCH = [{ type: "gate-failed", runId: "run-7" }, { type: "gate-failed", runId: "run-7" }];

function insightReply() {
  const insight = { severity: "warn", summary: "Gate failing repeatedly", evidence: [{ eventType: "gate-failed", ref: "slice-3" }], suggestedAction: null };
  return `Gate failures are repeating.\n\n${FENCE}${INSIGHTS_TAG}\n${JSON.stringify([insight])}\n${FENCE}`;
}

function makeProvider(content = insightReply(), name = "stub") {
  return { PROVIDER_NAME: name, sendTurn: vi.fn(async () => ({ type: "reply", content, tokensIn: 10, tokensOut: 20 })) };
}

function budgetOptions(overrides = {}) {
  return {
    budgetState: { dailyUsd: 0, dailyDate: "2099-01-01", hourlyNarrations: 0, hourlyHour: "2099-01-01T00" },
    _checkBudget: () => ({ ok: true }),
    _recordSpend: (state) => state,
    _saveBudgetState: () => {},
    ...overrides,
  };
}

function fakeStartObserver() {
  const handle = { onBatch: null, stopped: false };
  const startObserver = vi.fn(({ onBatch }) => {
    handle.onBatch = onBatch;
    return {
      stop: () => { handle.stopped = true; },
      getStatus: () => ({ connected: true, stopped: handle.stopped, batchWindowMs: 60_000 }),
    };
  });
  return { handle, startObserver };
}

function makeController({ provider = makeProvider(), hub = { broadcast: vi.fn() }, env = {}, config = ENABLED_CONFIG, turnOverrides = {}, runObserverTurn } = {}) {
  const { handle, startObserver } = fakeStartObserver();
  const insightRing = createInsightRing();
  const controller = createObserverController({
    hub,
    env,
    insightRing,
    startObserver,
    getConfig: () => config,
    turnOptions: { provider, ...budgetOptions(turnOverrides) },
    ...(runObserverTurn && { runObserverTurn }),
  });
  return { controller, handle, hub, provider, insightRing, startObserver };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("observer controller — server observer path", () => {
  it("turns a delivered batch into a forge-master-insight hub event and a non-empty status page", async () => {
    const { controller, handle, hub, provider } = makeController();

    expect(controller.start("C:\\project")).toMatchObject({ ok: true });
    const result = await handle.onBatch(BATCH);

    expect(provider.sendTurn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    const types = hub.broadcast.mock.calls.map(([event]) => event.type);
    expect(types).toEqual([OBSERVER_NARRATION_EVENT_TYPE, FORGE_MASTER_INSIGHT_EVENT]);
    const insightEvent = hub.broadcast.mock.calls[1][0];
    expect(insightEvent).toMatchObject({ source: "forge-master", runId: "run-7", insight: { severity: "warn" } });

    const status = controller.status({ limit: 10 });
    expect(status.ok).toBe(true);
    expect(status.insights.total).toBe(1);
    expect(status.insights.insights[0].insight.summary).toBe("Gate failing repeatedly");
    expect(status.insights.message).toBeUndefined();
    expect(status.lastTurn).toMatchObject({ ok: true, insightCount: 1 });
    expect(status.recentBatches).toHaveLength(1);
  });

  it("passes the provider's environment API key to the observer model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-observer-test");
    const provider = makeProvider(insightReply(), "anthropic");
    const { controller, handle } = makeController({ provider });

    controller.start("C:\\project");
    await handle.onBatch(BATCH);

    expect(provider.sendTurn.mock.calls[0][0].apiKey).toBe("sk-observer-test");
  });

  it("never throws out of onBatch and records the failure", async () => {
    const runObserverTurn = vi.fn(async () => { throw new Error("provider exploded"); });
    const { controller, handle } = makeController({ runObserverTurn });

    controller.start("C:\\project");
    await expect(handle.onBatch(BATCH)).resolves.toBeNull();

    const status = controller.status({ limit: 5 });
    expect(status.lastTurn).toMatchObject({ ok: false, reason: "provider exploded" });
    expect(status.insights.message).toContain("provider exploded");
  });

  it("makes no model call when the budget blocks the turn", async () => {
    const { controller, handle, hub, provider } = makeController({
      turnOverrides: { _checkBudget: () => ({ ok: false, reason: "daily USD cap reached" }) },
    });

    controller.start("C:\\project");
    await handle.onBatch(BATCH);

    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(hub.broadcast.mock.calls.some(([event]) => event.type === FORGE_MASTER_INSIGHT_EVENT)).toBe(false);
    expect(controller.status({ limit: 5 }).insights.message).toContain("daily USD cap reached");
  });

  it("does not overlap observer turns", async () => {
    let release;
    const runObserverTurn = vi.fn(async () => ({ ok: true, insights: [] }))
      .mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true, insights: [] }); }));
    const { controller, handle } = makeController({ runObserverTurn });

    controller.start("C:\\project");
    const first = handle.onBatch(BATCH);
    await expect(handle.onBatch(BATCH)).resolves.toBeNull();
    expect(runObserverTurn).toHaveBeenCalledTimes(1);
    release();
    await first;
    await handle.onBatch(BATCH);
    expect(runObserverTurn).toHaveBeenCalledTimes(2);
  });
});

describe("observer controller — kill switch and config", () => {
  it("honours the kill switch for start and for batches already flowing", async () => {
    expect(isObserverKillSwitchOn({ [OBSERVER_KILL_SWITCH_ENV]: "1" })).toBe(true);
    expect(isObserverKillSwitchOn({})).toBe(false);

    const env = {};
    const { controller, handle, provider } = makeController({ env });
    controller.start("C:\\project");
    env[OBSERVER_KILL_SWITCH_ENV] = "1";
    await handle.onBatch(BATCH);

    expect(provider.sendTurn).not.toHaveBeenCalled();
    expect(controller.status({ limit: 5 }).insights.message).toContain(OBSERVER_KILL_SWITCH_ENV);
    controller.stop();
    expect(controller.start("C:\\project")).toMatchObject({ ok: false, error: "observer-disabled" });
  });

  it("refuses to start when the observer is disabled in config", () => {
    const { controller, startObserver } = makeController({ config: { ...ENABLED_CONFIG, observer: { enabled: false } } });
    expect(controller.start("C:\\project")).toMatchObject({ ok: false, error: "observer-disabled" });
    expect(startObserver).not.toHaveBeenCalled();
  });
});

describe("observer controller — status empty states", () => {
  it("explains that the observer is not running", () => {
    const { controller } = makeController();
    const status = controller.status({ limit: 5 });
    expect(status.insights).toMatchObject({ insights: [], total: 0, hasMore: false });
    expect(status.insights.message).toContain("not running");
    expect(status.status.message).toBe("Observer has not been started.");
  });

  it("explains that a running observer is waiting for its first batch", () => {
    const { controller } = makeController();
    controller.start("C:\\project");
    expect(controller.status({ limit: 5 }).insights.message).toMatch(/waiting for the first batch.*60 s/);
  });

  it("reports analysed batches when nothing notable was found", async () => {
    const { controller, handle } = makeController({ provider: makeProvider("All quiet.") });
    controller.start("C:\\project");
    await handle.onBatch(BATCH);
    expect(controller.status({ limit: 5 }).insights.message).toContain("1 batch(es) analysed");
  });

  it("omits insights unless a page is requested and rejects invalid cursors", () => {
    const { controller } = makeController();
    expect(controller.status()).not.toHaveProperty("insights");
    expect(controller.status({ cursor: "abc" })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
  });
});
