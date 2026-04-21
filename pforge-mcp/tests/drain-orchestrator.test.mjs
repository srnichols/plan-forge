import { describe, it, expect } from "vitest";
import {
  drainOpenBrainQueue,
  shapeQueueRecord,
} from "../memory.mjs";

const NOW = Date.parse("2026-04-21T18:00:00.000Z");

/** Helper: build a shaped queue record with _nextAttemptAt in the past relative to NOW. */
function makeRecord(overrides = {}) {
  const base = shapeQueueRecord({
    content: "test thought",
    project: "Plan-Forge",
    type: "convention",
    source: "test",
    created_by: "test-worker",
  });
  // Ensure records are eligible (ready) by default
  base._nextAttemptAt = new Date(NOW - 60_000).toISOString();
  base._enqueuedAt = base._nextAttemptAt;
  return { ...base, ...overrides };
}

describe("drainOpenBrainQueue", () => {
  it("all-success: delivers all ready records", async () => {
    const records = Array.from({ length: 5 }, () => makeRecord());
    const dispatcher = async () => ({ ok: true });

    const result = await drainOpenBrainQueue(records, dispatcher, { now: NOW });

    expect(result.delivered).toHaveLength(5);
    expect(result.archive).toHaveLength(5);
    expect(result.deferred).toHaveLength(0);
    expect(result.dlq).toHaveLength(0);
    expect(result.stats.delivered).toBe(5);
    expect(result.stats.attempted).toBe(5);

    for (const d of result.delivered) {
      expect(d._status).toBe("delivered");
      expect(d._deliveredAt).toBeDefined();
    }
  });

  it("all-failure under maxAttempts: retries with incremented attempts", async () => {
    const records = Array.from({ length: 3 }, () =>
      makeRecord({ _attempts: 0 })
    );
    const dispatcher = async () => ({ ok: false, error: "boom" });

    const result = await drainOpenBrainQueue(records, dispatcher, {
      now: NOW,
      maxAttempts: 5,
    });

    expect(result.delivered).toHaveLength(0);
    expect(result.deferred).toHaveLength(3);
    expect(result.dlq).toHaveLength(0);

    for (const d of result.deferred) {
      expect(d._attempts).toBe(1);
      expect(d._lastError).toBe("boom");
      expect(d._nextAttemptAt).toBeDefined();
    }
  });

  it("DLQ promotion: record with _attempts:4 fails → moves to DLQ", async () => {
    const records = [makeRecord({ _attempts: 4 })];
    const dispatcher = async () => ({ ok: false, error: "still failing" });

    const result = await drainOpenBrainQueue(records, dispatcher, {
      now: NOW,
      maxAttempts: 5,
    });

    expect(result.delivered).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
    expect(result.dlq).toHaveLength(1);
    expect(result.dlq[0]._status).toBe("failed");
    expect(result.dlq[0]._failedAt).toBeDefined();
    expect(result.dlq[0]._lastError).toBe("still failing");
    expect(result.dlq[0]._attempts).toBe(5);
  });

  it("mixed: some succeed, some fail", async () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ content: `thought-${i}` })
    );
    const dispatcher = async (r) => {
      const idx = parseInt(r.content.split("-")[1], 10);
      return idx % 2 === 0 ? { ok: true } : { ok: false, error: "flaky" };
    };

    const result = await drainOpenBrainQueue(records, dispatcher, { now: NOW });

    expect(result.delivered).toHaveLength(3); // indices 0, 2, 4
    expect(result.deferred).toHaveLength(2); // indices 1, 3
    expect(result.dlq).toHaveLength(0);
  });

  it("per-batch ceiling: only attempts maxBatch records", async () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      makeRecord({ content: `thought-${i}` })
    );
    let attempted = 0;
    const dispatcher = async () => {
      attempted++;
      return { ok: true };
    };

    const result = await drainOpenBrainQueue(records, dispatcher, {
      now: NOW,
      maxBatch: 25,
    });

    expect(attempted).toBe(25);
    expect(result.delivered).toHaveLength(25);
    expect(result.deferred).toHaveLength(75);
    expect(result.stats.attempted).toBe(25);

    // Surplus records should be untouched — no _attempts increment
    for (const d of result.deferred) {
      expect(d._attempts).toBe(0);
    }
  });

  it("skips records with _status 'delivered' or 'failed'", async () => {
    const records = [
      makeRecord({ _status: "delivered" }),
      makeRecord({ _status: "failed" }),
      makeRecord({ _status: "pending" }),
    ];
    const dispatcher = async () => ({ ok: true });

    const result = await drainOpenBrainQueue(records, dispatcher, { now: NOW });

    // partitionByBackoff filters delivered/failed, so only 1 is attempted
    expect(result.delivered).toHaveLength(1);
    expect(result.archive).toHaveLength(1);
    expect(result.stats.attempted).toBe(1);
  });

  it("returns valid stats object", async () => {
    const records = [makeRecord()];
    const dispatcher = async () => ({ ok: true });

    const result = await drainOpenBrainQueue(records, dispatcher, {
      now: NOW,
      source: "test-drain",
    });

    expect(result.stats._v).toBe(1);
    expect(result.stats.source).toBe("test-drain");
    expect(result.stats.attempted).toBe(1);
    expect(result.stats.delivered).toBe(1);
    expect(result.stats.deferred).toBe(0);
    expect(result.stats.dlq).toBe(0);
    expect(typeof result.stats.durationMs).toBe("number");
    expect(result.stats.timestamp).toBeDefined();
  });

  it("handles empty records array", async () => {
    const dispatcher = async () => ({ ok: true });

    const result = await drainOpenBrainQueue([], dispatcher, { now: NOW });

    expect(result.delivered).toHaveLength(0);
    expect(result.deferred).toHaveLength(0);
    expect(result.dlq).toHaveLength(0);
    expect(result.stats.attempted).toBe(0);
  });

  it("handles dispatcher returning undefined gracefully", async () => {
    const records = [makeRecord()];
    const dispatcher = async () => undefined;

    const result = await drainOpenBrainQueue(records, dispatcher, {
      now: NOW,
      maxAttempts: 5,
    });

    // undefined result → treated as failure
    expect(result.delivered).toHaveLength(0);
    expect(result.deferred).toHaveLength(1);
    expect(result.deferred[0]._lastError).toBe("unknown");
  });
});
