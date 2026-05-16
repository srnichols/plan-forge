/**
 * 02-capability-negotiation.test.mjs — Scenario 2: OpenBrain capability probe caching.
 *
 * Acceptance criteria (Phase-MEMORY-QA-PLAN § Scenario 2):
 *   MUST: first call to writeMemoryDirect probes GET /health exactly once
 *   MUST: second call uses the cached capability list — no additional GET /health probe
 *   MUST: _resetCapabilityCache() clears the cache, enabling a fresh probe on the next call
 *
 * NOTE: brain.mjs does not yet export _resetCapabilityCache (Phase-PROVENANCE not complete).
 * Per Plan Decision 5, this file implements the capability-caching behavior inline as
 * both the test subject and the specification for future production code.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockOpenBrain } from "./helpers/mock-openbrain.mjs";

// ─── Inline capability cache (Phase-PROVENANCE placeholder) ──────────────────
// When Phase-PROVENANCE ships, replace these three items with production imports, e.g.:
//   import { writeMemoryDirect, _resetCapabilityCache } from "../../../memory.mjs";

let _capabilityCache = null;

function _resetCapabilityCache() {
  _capabilityCache = null;
}

async function probeCapabilities(url) {
  if (_capabilityCache !== null) return _capabilityCache;
  const res = await fetch(`${url}/health`);
  if (!res.ok) {
    _capabilityCache = [];
    return _capabilityCache;
  }
  const body = await res.json();
  _capabilityCache = Array.isArray(body.capabilities) ? body.capabilities : [];
  return _capabilityCache;
}

async function writeMemoryDirect(url, thought) {
  const caps = await probeCapabilities(url);
  const payload = {
    content: thought.content,
    metadata: thought.metadata ?? {},
  };
  const res = await fetch(`${url}/memories`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, status: res.status, capabilities: caps };
}

// ─── Scenario 2 tests ─────────────────────────────────────────────────────────

describe("Scenario 2 — OpenBrain capability probe caching", () => {
  let ob;

  beforeEach(async () => {
    _resetCapabilityCache(); // ensure clean module-level cache state
    ob = await createMockOpenBrain({ capabilities: ["provenance", "search", "write"] });
  });

  afterEach(async () => {
    await ob.close();
  });

  it("first write probes GET /health exactly once", async () => {
    await writeMemoryDirect(ob.url, { content: "first thought" });
    expect(ob.hitCounts.health).toBe(1);
    expect(ob.hitCounts.memories).toBe(1);
  });

  it("second write hits the cache — no additional GET /health call", async () => {
    await writeMemoryDirect(ob.url, { content: "thought-A" });
    await writeMemoryDirect(ob.url, { content: "thought-B" });

    expect(ob.hitCounts.health).toBe(1); // only the first call probed health
    expect(ob.hitCounts.memories).toBe(2); // both calls wrote a memory
  });

  it("cached capability list matches what /health returned", async () => {
    const { capabilities } = await writeMemoryDirect(ob.url, { content: "x" });
    expect(capabilities).toEqual(["provenance", "search", "write"]);
  });

  it("_resetCapabilityCache() clears cache — next write re-probes GET /health", async () => {
    await writeMemoryDirect(ob.url, { content: "before-reset" });
    expect(ob.hitCounts.health).toBe(1);

    _resetCapabilityCache();
    await writeMemoryDirect(ob.url, { content: "after-reset" });
    expect(ob.hitCounts.health).toBe(2); // re-probed after reset
    expect(ob.hitCounts.memories).toBe(2);
  });

  it("each successive reset triggers one fresh probe", async () => {
    for (let i = 1; i <= 3; i++) {
      _resetCapabilityCache();
      await writeMemoryDirect(ob.url, { content: `thought-${i}` });
      expect(ob.hitCounts.health).toBe(i);
    }
    expect(ob.hitCounts.memories).toBe(3);
  });

  it("resetting before the first write still yields exactly one probe", async () => {
    // beforeEach already reset; a second reset must not break things
    _resetCapabilityCache();
    await writeMemoryDirect(ob.url, { content: "after-double-reset" });
    expect(ob.hitCounts.health).toBe(1);
  });

  it("N writes after priming only ever probe /health once total", async () => {
    const N = 5;
    for (let i = 0; i < N; i++) {
      await writeMemoryDirect(ob.url, { content: `thought-${i}` });
    }
    expect(ob.hitCounts.health).toBe(1);
    expect(ob.hitCounts.memories).toBe(N);
  });

  it("cache survives different thought content — capability stays constant", async () => {
    await writeMemoryDirect(ob.url, { content: "alpha" });
    await writeMemoryDirect(ob.url, { content: "beta" });
    await writeMemoryDirect(ob.url, { content: "gamma" });

    // Still only one health probe regardless of content variation
    expect(ob.hitCounts.health).toBe(1);
  });

  it("when /health is not available, writeMemoryDirect still posts the memory", async () => {
    ob.state.healthStatus = 503;
    const result = await writeMemoryDirect(ob.url, { content: "degraded" });
    // POST /memories was still attempted even when /health returned 503
    expect(ob.hitCounts.memories).toBe(1);
    expect(result.ok).toBe(true);
  });
});
