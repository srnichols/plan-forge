/**
 * 06-slag-heap-dlq.test.mjs — Scenario 6: Slag-heap Dead Letter Queue.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 6):
 *   MUST: Mock OpenBrain configured to return 500 once. Memory write attempt results
 *         in `.forge/anvil/dlq/` (in tmp) gaining one record. Hub event `l3-deferred`
 *         was emitted.
 *   MUST: A subsequent `anvilDlqDrain` with mock now returning 200 drains the record
 *         and the DLQ is empty (or file is deleted).
 *
 * The hub event collector is implemented inline as a lightweight spy — the full
 * WebSocket hub is not required for these unit-level assertions. When Phase-MEMORY
 * ships its brain.mjs integration, replace the inline `writeMemoryWithDlqFallback`
 * with the production import.
 *
 * All file I/O is isolated to a tmp directory via useTmpForgeHome so the real
 * `.forge/anvil/` in the workspace is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockOpenBrain } from "./helpers/mock-openbrain.mjs";
import {
  anvilDlqAppend,
  anvilDlqList,
  anvilDlqDrain,
} from "../../../anvil.mjs";
import { useTmpForgeHome } from "./helpers/with-tmp-forge-home.mjs";

// ─── Inline hub-event collector (Phase-MEMORY placeholder) ───────────────────
// When Phase-MEMORY ships, replace with production hub event emission.

let _hubEvents = [];

function _resetHubEvents() {
  _hubEvents = [];
}

function emitHubEvent(type, data) {
  _hubEvents.push({ type, data, timestamp: new Date().toISOString() });
}

// ─── Inline write-with-DLQ-fallback (Phase-MEMORY placeholder) ───────────────
// When Phase-MEMORY ships, import writeMemoryWithDlqFallback from production brain.mjs.

/**
 * Attempt to write a memory to OpenBrain. On failure (non-ok response),
 * append a record to the local DLQ and emit a `l3-deferred` hub event.
 *
 * @param {string} url - OpenBrain base URL
 * @param {{ content: string, toolName?: string, metadata?: object }} thought
 * @param {{ cwd?: string }} [deps]
 * @returns {Promise<{ ok: boolean, id?: string, dlqId?: string }>}
 */
async function writeMemoryWithDlqFallback(url, thought, deps = {}) {
  let res;
  try {
    res = await fetch(`${url}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: thought.content,
        metadata: thought.metadata ?? {},
      }),
    });
  } catch (err) {
    const { id: dlqId } = anvilDlqAppend(
      {
        toolName: thought.toolName ?? null,
        inputs: { content: thought.content, metadata: thought.metadata ?? {} },
        error: err.message,
      },
      deps
    );
    emitHubEvent("l3-deferred", { dlqId, toolName: thought.toolName ?? null });
    return { ok: false, dlqId };
  }

  if (!res.ok) {
    const { id: dlqId } = anvilDlqAppend(
      {
        toolName: thought.toolName ?? null,
        inputs: { content: thought.content, metadata: thought.metadata ?? {} },
        error: `http-${res.status}`,
      },
      deps
    );
    emitHubEvent("l3-deferred", { dlqId, toolName: thought.toolName ?? null });
    return { ok: false, dlqId };
  }

  const body = await res.json();
  return { ok: true, id: body.id };
}

/**
 * Drain all DLQ records by re-submitting each to OpenBrain.
 * Returns { drained, remaining }.
 *
 * @param {string} url - OpenBrain base URL
 * @param {{ cwd?: string }} [deps]
 */
async function drainDlqToOpenBrain(url, deps = {}) {
  return anvilDlqDrain(async (rec) => {
    const res = await fetch(`${url}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: rec.inputs?.content ?? "",
        metadata: rec.inputs?.metadata ?? {},
      }),
    });
    return { ok: res.ok };
  }, deps);
}

// ─── Scenario 6a — 500 response lands a record on the DLQ ────────────────────

describe("Scenario 6a — OpenBrain 500 causes a DLQ record to be written", () => {
  const home = useTmpForgeHome();
  let ob;

  beforeEach(async () => {
    _resetHubEvents();
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
    ob.state.nextFailCount = 1; // Force first POST /memories to return 500
  });

  afterEach(async () => {
    await ob.close();
  });

  it("write attempt returns ok: false when OpenBrain returns 500", async () => {
    const result = await writeMemoryWithDlqFallback(
      ob.url,
      { content: "test thought", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    expect(result.ok).toBe(false);
  });

  it("DLQ gains exactly one record after a single failed write", async () => {
    await writeMemoryWithDlqFallback(
      ob.url,
      { content: "test thought", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const { total } = anvilDlqList({}, { cwd: home.cwd });
    expect(total).toBe(1);
  });

  it("DLQ record has a non-empty id", async () => {
    const { dlqId } = await writeMemoryWithDlqFallback(
      ob.url,
      { content: "test thought", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    expect(typeof dlqId).toBe("string");
    expect(dlqId.length).toBeGreaterThan(0);
  });

  it("DLQ record id matches the dlqId returned by writeMemoryWithDlqFallback", async () => {
    const { dlqId } = await writeMemoryWithDlqFallback(
      ob.url,
      { content: "test thought", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const { items } = anvilDlqList({}, { cwd: home.cwd });
    expect(items[0].id).toBe(dlqId);
  });

  it("DLQ record preserves toolName", async () => {
    await writeMemoryWithDlqFallback(
      ob.url,
      { content: "x", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const { items } = anvilDlqList({}, { cwd: home.cwd });
    expect(items[0].toolName).toBe("forge_analyze");
  });

  it("DLQ record has a failedAt ISO timestamp", async () => {
    await writeMemoryWithDlqFallback(
      ob.url,
      { content: "x", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const { items } = anvilDlqList({}, { cwd: home.cwd });
    expect(items[0].failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("hub event l3-deferred is emitted after a failed write", async () => {
    await writeMemoryWithDlqFallback(
      ob.url,
      { content: "x", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const deferred = _hubEvents.filter((e) => e.type === "l3-deferred");
    expect(deferred.length).toBe(1);
  });

  it("hub event l3-deferred carries the dlqId", async () => {
    const { dlqId } = await writeMemoryWithDlqFallback(
      ob.url,
      { content: "x", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const event = _hubEvents.find((e) => e.type === "l3-deferred");
    expect(event?.data?.dlqId).toBe(dlqId);
  });

  it("hub event l3-deferred carries the toolName", async () => {
    await writeMemoryWithDlqFallback(
      ob.url,
      { content: "x", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const event = _hubEvents.find((e) => e.type === "l3-deferred");
    expect(event?.data?.toolName).toBe("forge_analyze");
  });

  it("successful write (no failure) does not add a DLQ record", async () => {
    // Reset fail count so this write succeeds
    ob.state.nextFailCount = 0;
    await writeMemoryWithDlqFallback(
      ob.url,
      { content: "successful thought", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const { total } = anvilDlqList({}, { cwd: home.cwd });
    expect(total).toBe(0);
  });

  it("successful write does not emit a l3-deferred hub event", async () => {
    ob.state.nextFailCount = 0;
    await writeMemoryWithDlqFallback(
      ob.url,
      { content: "x", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    const deferred = _hubEvents.filter((e) => e.type === "l3-deferred");
    expect(deferred.length).toBe(0);
  });
});

// ─── Scenario 6b — anvilDlqDrain with mock returning 200 drains the record ────

describe("Scenario 6b — anvilDlqDrain (mock now 200) clears the DLQ", () => {
  const home = useTmpForgeHome();
  let ob;

  beforeEach(async () => {
    _resetHubEvents();
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("drained count is 1 after draining a single record", async () => {
    // Seed the DLQ manually (mock the 500 scenario without needing a live OpenBrain)
    anvilDlqAppend(
      { toolName: "forge_analyze", inputs: { content: "deferred thought", metadata: {} }, error: "http-500" },
      { cwd: home.cwd }
    );

    // Drain — mock is healthy (200)
    const { drained } = await drainDlqToOpenBrain(ob.url, { cwd: home.cwd });
    expect(drained).toBe(1);
  });

  it("remaining count is 0 after full drain", async () => {
    anvilDlqAppend(
      { toolName: "forge_analyze", inputs: { content: "x", metadata: {} }, error: "http-500" },
      { cwd: home.cwd }
    );

    const { remaining } = await drainDlqToOpenBrain(ob.url, { cwd: home.cwd });
    expect(remaining).toBe(0);
  });

  it("DLQ is empty after successful drain", async () => {
    anvilDlqAppend(
      { toolName: "forge_analyze", inputs: { content: "x", metadata: {} }, error: "http-500" },
      { cwd: home.cwd }
    );

    await drainDlqToOpenBrain(ob.url, { cwd: home.cwd });

    const { total } = anvilDlqList({}, { cwd: home.cwd });
    expect(total).toBe(0);
  });

  it("OpenBrain receives the re-submitted memory after drain", async () => {
    anvilDlqAppend(
      { toolName: "forge_analyze", inputs: { content: "resubmit-me", metadata: {} }, error: "http-500" },
      { cwd: home.cwd }
    );

    await drainDlqToOpenBrain(ob.url, { cwd: home.cwd });

    expect(ob.hitCounts.memories).toBe(1);
    expect(ob.requests.memories[0].body.content).toBe("resubmit-me");
  });

  it("partial drain: record whose callback returns { ok: false } stays on DLQ", async () => {
    anvilDlqAppend(
      { toolName: "forge_analyze", inputs: { content: "keep-me", metadata: {} }, error: "http-500" },
      { cwd: home.cwd }
    );
    anvilDlqAppend(
      { toolName: "forge_analyze", inputs: { content: "drain-me", metadata: {} }, error: "http-500" },
      { cwd: home.cwd }
    );

    // Callback drains only records where content is "drain-me"
    const { drained, remaining } = await anvilDlqDrain(async (rec) => {
      return { ok: rec.inputs?.content === "drain-me" };
    }, { cwd: home.cwd });

    expect(drained).toBe(1);
    expect(remaining).toBe(1);
    const { total } = anvilDlqList({}, { cwd: home.cwd });
    expect(total).toBe(1);
  });

  it("drain on empty DLQ returns drained:0 remaining:0", async () => {
    const { drained, remaining } = await anvilDlqDrain(async () => ({ ok: true }), { cwd: home.cwd });
    expect(drained).toBe(0);
    expect(remaining).toBe(0);
  });

  it("full end-to-end: 500 → DLQ → drain → DLQ empty", async () => {
    // Step 1: Seed a failed write via the full inline helper
    ob.state.nextFailCount = 1;
    _resetHubEvents();
    const { ok: writeOk, dlqId } = await writeMemoryWithDlqFallback(
      ob.url,
      { content: "end-to-end test", toolName: "forge_analyze" },
      { cwd: home.cwd }
    );
    expect(writeOk).toBe(false);
    expect(dlqId).toBeTruthy();

    // Step 2: Verify DLQ has the record
    const before = anvilDlqList({}, { cwd: home.cwd });
    expect(before.total).toBe(1);

    // Step 3: Hub event was emitted
    expect(_hubEvents.some((e) => e.type === "l3-deferred")).toBe(true);

    // Step 4: Drain (mock now 200)
    const { drained } = await drainDlqToOpenBrain(ob.url, { cwd: home.cwd });
    expect(drained).toBe(1);

    // Step 5: DLQ is now empty
    const after = anvilDlqList({}, { cwd: home.cwd });
    expect(after.total).toBe(0);
  });
});

// ─── Scenario 6c — DLQ list and filter utilities ──────────────────────────────

describe("Scenario 6c — anvilDlqList filtering and ordering", () => {
  const home = useTmpForgeHome();

  it("anvilDlqList returns items ordered by failedAt ascending (oldest first)", async () => {
    anvilDlqAppend({ toolName: "t", error: "e1" }, { cwd: home.cwd });
    // Small delay to ensure distinct timestamps
    await new Promise((r) => setTimeout(r, 5));
    anvilDlqAppend({ toolName: "t", error: "e2" }, { cwd: home.cwd });

    const { items } = anvilDlqList({}, { cwd: home.cwd });
    expect(items.length).toBe(2);
    const t0 = new Date(items[0].failedAt).getTime();
    const t1 = new Date(items[1].failedAt).getTime();
    expect(t0).toBeLessThanOrEqual(t1);
  });

  it("anvilDlqList with tool filter returns only matching records", async () => {
    anvilDlqAppend({ toolName: "tool_a", error: "e" }, { cwd: home.cwd });
    anvilDlqAppend({ toolName: "tool_b", error: "e" }, { cwd: home.cwd });

    const { items, total } = anvilDlqList({ tool: "tool_a" }, { cwd: home.cwd });
    expect(total).toBe(1);
    expect(items[0].toolName).toBe("tool_a");
  });

  it("anvilDlqList with limit cap returns at most limit items", async () => {
    for (let i = 0; i < 5; i++) {
      anvilDlqAppend({ toolName: "t", error: "e" }, { cwd: home.cwd });
    }
    const { items, total } = anvilDlqList({ limit: 2 }, { cwd: home.cwd });
    expect(total).toBe(5);
    expect(items.length).toBe(2);
  });

  it("anvilDlqList on empty DLQ returns items:[] and total:0", () => {
    const { items, total } = anvilDlqList({}, { cwd: home.cwd });
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });
});

// ─── Scenario 6d — no DLQ files written outside tmp ──────────────────────────

describe("Scenario 6d — no DLQ side effects outside tmp directory", () => {
  const home = useTmpForgeHome();

  it("DLQ record path resolves inside the tmp cwd, not process.cwd()", async () => {
    const { id } = anvilDlqAppend({ toolName: "t", error: "e" }, { cwd: home.cwd });

    // Verify the record is in our tmp directory
    const { items } = anvilDlqList({}, { cwd: home.cwd });
    expect(items.some((m) => m.id === id)).toBe(true);

    // Verify it's NOT in the real process cwd DLQ (different tmp dir)
    const { items: realItems } = anvilDlqList({}, { cwd: process.cwd() });
    expect(realItems.some((m) => m.id === id)).toBe(false);
  });
});
