import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Hub } from "../hub.mjs";
import { SequentialScheduler } from "../orchestrator.mjs";

function makeStubWss() {
  const wss = new EventEmitter();
  wss.close = () => {};
  return wss;
}

function makeHub(cwd) {
  const wss = makeStubWss();
  const hub = new Hub(wss, 0, cwd);
  hub._appendDurableEvent = () => {};
  return { hub, wss };
}

function makeNodes(ids) {
  const nodes = new Map();
  for (const id of ids) {
    nodes.set(id, { id, title: `Slice ${id}`, status: "pending", complexityScore: 3 });
  }
  return nodes;
}

function passingExecuteFn() {
  return async () => ({ status: "passed" });
}

describe("Executor gate wire-in — Slice 06.2", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-executor-gate-"));
    ({ hub } = makeHub(tmpDir));
  });

  afterEach(() => {
    hub.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Gate-check skipped when disabled (default) ─────────────────

  it("skips gate-check when gateCheckConfig.enabled = false", async () => {
    const eventBus = new EventEmitter();
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2"]);

    const results = await scheduler.execute(
      nodes, ["1", "2"], passingExecuteFn(),
      { gateCheckConfig: { enabled: false }, hub },
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "passed")).toBe(true);
  });

  // ── 2. Gate-check skipped when hub is null ────────────────────────

  it("skips gate-check when hub is null", async () => {
    const eventBus = new EventEmitter();
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2"]);

    const results = await scheduler.execute(
      nodes, ["1", "2"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true }, hub: null },
    );

    expect(results).toHaveLength(2);
  });

  // ── 3. Run continues on proceed: true ─────────────────────────────

  it("continues run when gate-check returns proceed: true", async () => {
    hub.onAsk("brain.gate-check", async () => ({
      proceed: true,
      reason: "all checks passed",
      openBlockingReviews: 0,
      driftScore: null,
      openIncidents: 0,
    }));

    const eventBus = new EventEmitter();
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2"]);

    const results = await scheduler.execute(
      nodes, ["1", "2"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 1000 }, hub },
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "passed")).toBe(true);
  });

  // ── 4. Run pauses on proceed: false ───────────────────────────────

  it("pauses run when gate-check returns proceed: false", async () => {
    hub.onAsk("brain.gate-check", async () => ({
      proceed: false,
      reason: "1 blocker-severity review(s) open",
      openBlockingReviews: 1,
      driftScore: null,
      openIncidents: 0,
    }));

    const eventBus = new EventEmitter();
    const blocked = [];
    eventBus.on("gate-blocked", (data) => blocked.push(data));
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2", "3"]);

    const results = await scheduler.execute(
      nodes, ["1", "2", "3"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 1000 }, hub },
    );

    // Only slice 1 should complete — slice 2 and 3 never start
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("passed");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].sliceId).toBe("1");
    expect(blocked[0].reason).toContain("blocker");
  });

  // ── 5. Fail-open on timeout ───────────────────────────────────────

  it("continues on timeout (fail-open)", async () => {
    // Register a responder that takes too long
    hub.onAsk("brain.gate-check", async () => {
      await new Promise((r) => setTimeout(r, 2000));
      return { proceed: false };
    });

    const eventBus = new EventEmitter();
    const passed = [];
    eventBus.on("gate-passed", (data) => passed.push(data));
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2"]);

    const results = await scheduler.execute(
      nodes, ["1", "2"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 50 }, hub },
    );

    // Both slices should complete due to fail-open
    expect(results).toHaveLength(2);
    expect(passed.some((p) => p.failOpen)).toBe(true);
  });

  // ── 6. Fail-open on no responder ──────────────────────────────────

  it("continues when no responder is registered (fail-open)", async () => {
    // No responder registered for brain.gate-check
    const eventBus = new EventEmitter();
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2"]);

    const results = await scheduler.execute(
      nodes, ["1", "2"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 1000 }, hub },
    );

    // hub.ask returns { ok: false } for no-responder — treated as proceed in catch
    expect(results).toHaveLength(2);
  });

  // ── 7. gate-blocked event emitted ─────────────────────────────────

  it("emits gate-blocked event with reason and slice info on block", async () => {
    hub.onAsk("brain.gate-check", async () => ({
      proceed: false,
      reason: "drift below threshold",
      openBlockingReviews: 0,
      driftScore: 0.3,
      openIncidents: 0,
    }));

    const eventBus = new EventEmitter();
    const events = [];
    eventBus.on("gate-blocked", (data) => events.push(data));
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1"]);

    await scheduler.execute(
      nodes, ["1"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 1000 }, hub },
    );

    expect(events).toHaveLength(1);
    expect(events[0].sliceId).toBe("1");
    expect(events[0].reason).toContain("drift");
    expect(events[0].driftScore).toBe(0.3);
  });

  // ── 8. gate-passed event emitted ──────────────────────────────────

  it("emits gate-passed event on successful gate-check", async () => {
    hub.onAsk("brain.gate-check", async () => ({
      proceed: true,
      reason: "all checks passed",
    }));

    const eventBus = new EventEmitter();
    const events = [];
    eventBus.on("gate-passed", (data) => events.push(data));
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1"]);

    await scheduler.execute(
      nodes, ["1"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 1000 }, hub },
    );

    expect(events).toHaveLength(1);
    expect(events[0].sliceId).toBe("1");
  });

  // ── 9. Gate-check uses configured timeoutMs ───────────────────────

  it("uses configured timeoutMs from gateCheckConfig", async () => {
    let receivedTimeout = null;
    const origAsk = hub.ask.bind(hub);
    hub.ask = async (topic, payload, opts) => {
      receivedTimeout = opts?.timeoutMs;
      return origAsk(topic, payload, opts);
    };
    hub.onAsk("brain.gate-check", async () => ({ proceed: true }));

    const eventBus = new EventEmitter();
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1"]);

    await scheduler.execute(
      nodes, ["1"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 7777 }, hub },
    );

    expect(receivedTimeout).toBe(7777);
  });

  // ── 10. Abort signal respected during gate-check ──────────────────

  it("respects abort signal after gate-check", async () => {
    const ac = new AbortController();
    hub.onAsk("brain.gate-check", async () => {
      ac.abort();
      return { proceed: true };
    });

    const eventBus = new EventEmitter();
    const aborted = [];
    eventBus.on("run-aborted", (data) => aborted.push(data));
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2"]);

    const results = await scheduler.execute(
      nodes, ["1", "2"], passingExecuteFn(),
      { gateCheckConfig: { enabled: true, timeoutMs: 1000 }, hub, abortSignal: ac.signal },
    );

    // Slice 1 passes, but abort before slice 2
    expect(results).toHaveLength(1);
    expect(aborted).toHaveLength(1);
  });

  // ── 11. No gate-check for failed slices ───────────────────────────

  it("does not run gate-check for failed slices", async () => {
    let gateCheckCalled = false;
    hub.onAsk("brain.gate-check", async () => {
      gateCheckCalled = true;
      return { proceed: true };
    });

    const eventBus = new EventEmitter();
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1"]);

    await scheduler.execute(
      nodes, ["1"],
      async () => ({ status: "failed", error: "test failure" }),
      { gateCheckConfig: { enabled: true, timeoutMs: 1000 }, hub },
    );

    expect(gateCheckCalled).toBe(false);
  });

  // ── 12. Backward compat — no hub/config still works ───────────────

  it("works without hub or gateCheckConfig (backward compatibility)", async () => {
    const eventBus = new EventEmitter();
    const scheduler = new SequentialScheduler(eventBus);
    const nodes = makeNodes(["1", "2"]);

    const results = await scheduler.execute(
      nodes, ["1", "2"], passingExecuteFn(),
      {},
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "passed")).toBe(true);
  });
});
