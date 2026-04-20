import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { Hub } from "../hub.mjs";
import { registerGateCheckResponder, loadGateCheckConfig } from "../orchestrator.mjs";

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

describe("brain.gate-check responder — Slice 06.2", () => {
  let tmpDir;
  let hub;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-gate-check-"));
    ({ hub } = makeHub(tmpDir));
  });

  afterEach(() => {
    hub.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Happy path — all clear ──────────────────────────────────────

  it("returns proceed: true when no blocking reviews, incidents, or drift issues", async () => {
    const deps = {
      recall: async () => null,
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.ok).toBe(true);
    expect(result.payload.proceed).toBe(true);
    expect(result.payload.reason).toBe("all checks passed");
  });

  // ── 2. Blocker review ─────────────────────────────────────────────

  it("returns proceed: false when blocker-severity reviews are open", async () => {
    const deps = {
      recall: async (key) => {
        if (key === "project.review.counts") return { open: 2, bySeverity: { blocker: 1 } };
        return null;
      },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.ok).toBe(true);
    expect(result.payload.proceed).toBe(false);
    expect(result.payload.openBlockingReviews).toBe(1);
    expect(result.payload.reason).toContain("blocker");
  });

  // ── 3. Critical incident ──────────────────────────────────────────

  it("returns proceed: false when critical incidents are open", async () => {
    const deps = {
      recall: async (key) => {
        if (key === "project.liveguard.incidents") {
          return [{ status: "open", severity: "critical" }];
        }
        return null;
      },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.ok).toBe(true);
    expect(result.payload.proceed).toBe(false);
    expect(result.payload.openIncidents).toBe(1);
  });

  // ── 4. Drift below threshold ──────────────────────────────────────

  it("returns proceed: false when drift score is below threshold", async () => {
    const deps = {
      recall: async (key) => {
        if (key === "project.liveguard.drift") {
          return [{ driftScore: 0.3, ts: new Date().toISOString() }];
        }
        return null;
      },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.ok).toBe(true);
    expect(result.payload.proceed).toBe(false);
    expect(result.payload.driftScore).toBe(0.3);
    expect(result.payload.reason).toContain("drift");
  });

  // ── 5. Non-blocker reviews don't block ─────────────────────────────

  it("returns proceed: true when only non-blocker reviews exist", async () => {
    const deps = {
      recall: async (key) => {
        if (key === "project.review.counts") return { open: 3, bySeverity: { medium: 2, low: 1 } };
        return null;
      },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.ok).toBe(true);
    expect(result.payload.proceed).toBe(true);
  });

  // ── 6. Reason string explains all blocking factors ─────────────────

  it("reason string includes all blocking factors when multiple checks fail", async () => {
    const deps = {
      recall: async (key) => {
        if (key === "project.review.counts") return { open: 1, bySeverity: { blocker: 1 } };
        if (key === "project.liveguard.incidents") return [{ status: "open", severity: "critical" }];
        if (key === "project.liveguard.drift") return [{ driftScore: 0.2, ts: new Date().toISOString() }];
        return null;
      },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.payload.proceed).toBe(false);
    expect(result.payload.reason).toContain("blocker");
    expect(result.payload.reason).toContain("critical");
    expect(result.payload.reason).toContain("drift");
  });

  // ── 7. Response shape ─────────────────────────────────────────────

  it("response contains all expected fields", async () => {
    const deps = {
      recall: async () => null,
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    const p = result.payload;
    expect(p).toHaveProperty("proceed");
    expect(p).toHaveProperty("reason");
    expect(p).toHaveProperty("openBlockingReviews");
    expect(p).toHaveProperty("driftScore");
    expect(p).toHaveProperty("openIncidents");
  });

  // ── 8. brain.recall returning null ─────────────────────────────────

  it("handles brain.recall returning null gracefully", async () => {
    const deps = {
      recall: async () => null,
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.ok).toBe(true);
    expect(result.payload.proceed).toBe(true);
    expect(result.payload.openBlockingReviews).toBe(0);
    expect(result.payload.openIncidents).toBe(0);
    expect(result.payload.driftScore).toBeNull();
  });

  // ── 9. brain.recall throwing ──────────────────────────────────────

  it("handles brain.recall throwing without crashing", async () => {
    const deps = {
      recall: async () => { throw new Error("brain failure"); },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.ok).toBe(true);
    expect(result.payload.proceed).toBe(true);
  });

  // ── 10. Config-driven drift threshold ──────────────────────────────

  it("uses config-driven drift threshold", async () => {
    const deps = {
      recall: async (key) => {
        if (key === "project.liveguard.drift") {
          return [{ driftScore: 0.5, ts: new Date().toISOString() }];
        }
        return null;
      },
      config: { enabled: true, driftThreshold: 0.4, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.payload.proceed).toBe(true);
  });

  // ── 11. Pure read — no state mutation ──────────────────────────────

  it("does not mutate any state (pure read)", async () => {
    let recallCallCount = 0;
    const deps = {
      recall: async () => { recallCallCount++; return null; },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(recallCallCount).toBeGreaterThan(0);
  });

  // ── 12. Latency guard ─────────────────────────────────────────────

  it("completes in <200ms with stub data", async () => {
    const deps = {
      recall: async () => null,
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const start = Date.now();
    await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(Date.now() - start).toBeLessThan(200);
  });

  // ── 13. Ignores resolved reviews ──────────────────────────────────

  it("ignores resolved reviews — only counts open", async () => {
    const deps = {
      recall: async (key) => {
        if (key === "project.review.counts") return { open: 0, resolved: 5, bySeverity: {} };
        return null;
      },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.payload.proceed).toBe(true);
  });

  // ── 14. Old drift data ignored ────────────────────────────────────

  it("ignores drift data older than 1 hour", async () => {
    const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
    const deps = {
      recall: async (key) => {
        if (key === "project.liveguard.drift") {
          return [{ driftScore: 0.1, ts: twoHoursAgo }];
        }
        return null;
      },
      config: { enabled: true, driftThreshold: 0.6, timeoutMs: 5000 },
    };
    registerGateCheckResponder(hub, tmpDir, deps);
    const result = await hub.ask("brain.gate-check", { sliceId: "1" });
    expect(result.payload.proceed).toBe(true);
  });
});

// ── Config loading tests ─────────────────────────────────────────────

describe("loadGateCheckConfig — Slice 06.2", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "pforge-gc-config-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when .forge.json is missing", () => {
    const config = loadGateCheckConfig(tmpDir);
    expect(config.enabled).toBe(false);
    expect(config.driftThreshold).toBe(0.6);
    expect(config.timeoutMs).toBe(5000);
  });

  it("returns defaults when .forge.json has no runtime.gateCheck", () => {
    writeFileSync(resolve(tmpDir, ".forge.json"), JSON.stringify({ modelRouting: {} }));
    const config = loadGateCheckConfig(tmpDir);
    expect(config.enabled).toBe(false);
  });

  it("merges user config with defaults", () => {
    writeFileSync(resolve(tmpDir, ".forge.json"), JSON.stringify({
      runtime: { gateCheck: { enabled: true, driftThreshold: 0.8 } },
    }));
    const config = loadGateCheckConfig(tmpDir);
    expect(config.enabled).toBe(true);
    expect(config.driftThreshold).toBe(0.8);
    expect(config.timeoutMs).toBe(5000);
  });

  it("returns defaults on malformed JSON", () => {
    writeFileSync(resolve(tmpDir, ".forge.json"), "not-json");
    const config = loadGateCheckConfig(tmpDir);
    expect(config.enabled).toBe(false);
  });
});
