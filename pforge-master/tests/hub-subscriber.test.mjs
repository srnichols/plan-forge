/**
 * Tests for forge-master hub-subscriber (Phase-29).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createHubSubscriber } from "../src/hub-subscriber.mjs";

describe("createHubSubscriber", () => {
  it("returns object with expected methods", () => {
    const sub = createHubSubscriber();
    expect(typeof sub.subscribe).toBe("function");
    expect(typeof sub.getRecentEvents).toBe("function");
    expect(typeof sub.close).toBe("function");
    expect(typeof sub.isConnected).toBe("function");
  });

  it("starts disconnected", () => {
    const sub = createHubSubscriber();
    expect(sub.isConnected()).toBe(false);
  });

  it("returns empty array before subscribe", () => {
    const sub = createHubSubscriber();
    expect(sub.getRecentEvents()).toEqual([]);
  });

  it("getRecentEvents respects n parameter", () => {
    const sub = createHubSubscriber();
    expect(sub.getRecentEvents(5)).toEqual([]);
    expect(sub.getRecentEvents(0)).toEqual([]);
  });

  it("close() is safe when not subscribed", () => {
    const sub = createHubSubscriber();
    expect(() => sub.close()).not.toThrow();
  });

  it("subscribe() handles unreachable port gracefully", () => {
    // Use a port unlikely to have a WS server, should not throw
    const sub = createHubSubscriber({ wsPort: 19999 });
    expect(() => sub.subscribe()).not.toThrow();
    sub.close();
  });

  it("accepts custom onEvent callback", () => {
    const onEvent = vi.fn();
    const sub = createHubSubscriber({ onEvent });
    expect(sub.isConnected()).toBe(false);
  });
});

describe("fetchContext hub integration", () => {
  it("includes Recent Operational Events when hubSubscriber has events", async () => {
    const { fetchContext } = await import("../src/retrieval.mjs");
    const events = [
      { type: "slice-started", sliceId: "Slice-01", timestamp: "2024-01-01T00:00:00Z" },
      { type: "slice-completed", sliceId: "Slice-01", timestamp: "2024-01-01T01:00:00Z" },
    ];
    const hubSubscriber = { getRecentEvents: (n) => events.slice(-n) };
    const result = await fetchContext({}, {
      recall: async () => null,
      getForgeMasterConfig: () => ({ l3Enabled: false }),
      hubSubscriber,
    });
    expect(result.contextBlock).toContain("Recent Operational Events");
    expect(result.contextBlock).toContain("slice-started");
    expect(result.contextBlock).toContain("Slice-01");
  });

  it("omits hub section when hubSubscriber has no events", async () => {
    const { fetchContext } = await import("../src/retrieval.mjs");
    const hubSubscriber = { getRecentEvents: () => [] };
    const result = await fetchContext({}, {
      recall: async () => null,
      getForgeMasterConfig: () => ({ l3Enabled: false }),
      hubSubscriber,
    });
    expect(result.contextBlock).not.toContain("Recent Operational Events");
  });

  it("omits hub section when no hubSubscriber in deps", async () => {
    const { fetchContext } = await import("../src/retrieval.mjs");
    const result = await fetchContext({}, {
      recall: async () => null,
      getForgeMasterConfig: () => ({ l3Enabled: false }),
    });
    expect(result.contextBlock).not.toContain("Recent Operational Events");
  });
});
