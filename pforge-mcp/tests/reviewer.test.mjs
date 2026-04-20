/**
 * Plan Forge — Phase-25 Slice 7 (Reviewer-agent in-loop) tests
 *
 * Covers:
 *   brain.mjs — REVIEWER_DEFAULTS, loadReviewerConfig, parseReviewerResponse,
 *   invokeReviewer (with mock quorumInvoke).
 *   orchestrator.mjs — registerGateCheckResponder integration with reviewer
 *   (advisory mode vs blockOnCritical).
 *
 * D5: default quorumPreset = "speed".
 * D6: blockOnCritical defaults false (advisory-only in v2.57).
 * MUST #7: runtime.reviewer config block.
 * MUST #8: reviewer invocation inside the gate-check loop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  REVIEWER_DEFAULTS,
  loadReviewerConfig,
  parseReviewerResponse,
  invokeReviewer,
} from "../brain.mjs";
import { registerGateCheckResponder } from "../orchestrator.mjs";

function writeConfig(cwd, block) {
  writeFileSync(resolve(cwd, ".forge.json"), JSON.stringify(block, null, 2), "utf-8");
}

describe("REVIEWER_DEFAULTS (D5 + D6 contract)", () => {
  it("is opt-in (enabled=false)", () => {
    expect(REVIEWER_DEFAULTS.enabled).toBe(false);
  });
  it("defaults to speed quorum preset (D5)", () => {
    expect(REVIEWER_DEFAULTS.quorumPreset).toBe("speed");
  });
  it("is advisory-only in v2.57 (blockOnCritical=false, D6)", () => {
    expect(REVIEWER_DEFAULTS.blockOnCritical).toBe(false);
  });
  it("is frozen so callers cannot mutate shared defaults", () => {
    expect(Object.isFrozen(REVIEWER_DEFAULTS)).toBe(true);
  });
});

describe("loadReviewerConfig", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-rev-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns defaults when .forge.json is absent", () => {
    expect(loadReviewerConfig(cwd)).toEqual(REVIEWER_DEFAULTS);
  });
  it("parses runtime.reviewer block from .forge.json", () => {
    writeConfig(cwd, { runtime: { reviewer: { enabled: true, quorumPreset: "power", blockOnCritical: true, timeoutMs: 5000 } } });
    const cfg = loadReviewerConfig(cwd);
    expect(cfg.enabled).toBe(true);
    expect(cfg.quorumPreset).toBe("power");
    expect(cfg.blockOnCritical).toBe(true);
    expect(cfg.timeoutMs).toBe(5000);
  });
  it("rejects unknown quorumPreset and falls back to speed", () => {
    writeConfig(cwd, { runtime: { reviewer: { enabled: true, quorumPreset: "yolo" } } });
    expect(loadReviewerConfig(cwd).quorumPreset).toBe("speed");
  });
  it("rejects non-positive timeoutMs and keeps the default", () => {
    writeConfig(cwd, { runtime: { reviewer: { enabled: true, timeoutMs: -1 } } });
    expect(loadReviewerConfig(cwd).timeoutMs).toBe(REVIEWER_DEFAULTS.timeoutMs);
  });
  it("tolerates malformed JSON by returning defaults", () => {
    writeFileSync(resolve(cwd, ".forge.json"), "{ not json", "utf-8");
    expect(loadReviewerConfig(cwd)).toEqual(REVIEWER_DEFAULTS);
  });
});

describe("parseReviewerResponse", () => {
  it("accepts a structured object", () => {
    const out = parseReviewerResponse({ score: 85, critical: false, summary: "ok" });
    expect(out.ok).toBe(true);
    expect(out.score).toBe(85);
    expect(out.critical).toBe(false);
    expect(out.summary).toBe("ok");
  });
  it("clamps score into [0,100]", () => {
    expect(parseReviewerResponse({ score: 150, critical: false }).score).toBe(100);
    expect(parseReviewerResponse({ score: -10, critical: false }).score).toBe(0);
  });
  it("extracts JSON from a fenced code block in a string", () => {
    const raw = '```json\n{"score": 70, "critical": true, "summary": "bad"}\n```';
    const out = parseReviewerResponse(raw);
    expect(out.ok).toBe(true);
    expect(out.score).toBe(70);
    expect(out.critical).toBe(true);
  });
  it("extracts bare JSON from a prose-wrapped string", () => {
    const out = parseReviewerResponse('Verdict: {"score": 90, "critical": false, "summary": "lgtm"} end');
    expect(out.ok).toBe(true);
    expect(out.score).toBe(90);
  });
  it("returns error for empty, missing-score, or unparseable inputs", () => {
    expect(parseReviewerResponse(null).ok).toBe(false);
    expect(parseReviewerResponse(undefined).ok).toBe(false);
    expect(parseReviewerResponse({ critical: true }).ok).toBe(false);
    expect(parseReviewerResponse("no json here").ok).toBe(false);
    expect(parseReviewerResponse("{ malformed").ok).toBe(false);
  });
});

describe("invokeReviewer", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-rev-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns skipped when config.enabled=false (opt-in invariant)", async () => {
    const out = await invokeReviewer({ cwd });
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
  });

  it("returns skipped when no quorumInvoke dep is provided", async () => {
    const config = { ...REVIEWER_DEFAULTS, enabled: true };
    const out = await invokeReviewer({ cwd, config });
    expect(out.ok).toBe(false);
    expect(out.skipped).toBe(true);
    expect(out.error).toMatch(/quorumInvoke/);
  });

  it("invokes the quorum worker with the configured preset and parses its response", async () => {
    const quorumInvoke = vi.fn(async () => ({ score: 88, critical: false, summary: "looks good" }));
    const config = { ...REVIEWER_DEFAULTS, enabled: true, quorumPreset: "power" };
    const out = await invokeReviewer(
      { cwd, config, sliceNumber: 7, sliceTitle: "Test slice", diffSummary: "+ new file\n" },
      { quorumInvoke },
    );
    expect(out.ok).toBe(true);
    expect(out.score).toBe(88);
    expect(out.critical).toBe(false);
    expect(out.summary).toBe("looks good");
    expect(out.quorumPreset).toBe("power");
    expect(quorumInvoke).toHaveBeenCalledTimes(1);
    const [prompt, opts] = quorumInvoke.mock.calls[0];
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("Slice: 7");
    expect(prompt).toContain("Test slice");
    expect(opts.preset).toBe("power");
  });

  it("returns timedOut:true when the quorum worker exceeds timeoutMs", async () => {
    const quorumInvoke = () => new Promise((r) => setTimeout(() => r({ score: 100, critical: false }), 200));
    const config = { ...REVIEWER_DEFAULTS, enabled: true, timeoutMs: 20 };
    const out = await invokeReviewer({ cwd, config }, { quorumInvoke });
    expect(out.ok).toBe(false);
    expect(out.timedOut).toBe(true);
  });

  it("surfaces parseReviewerResponse errors as ok:false", async () => {
    const quorumInvoke = async () => "not json at all";
    const config = { ...REVIEWER_DEFAULTS, enabled: true };
    const out = await invokeReviewer({ cwd, config }, { quorumInvoke });
    expect(out.ok).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it("catches exceptions thrown by quorumInvoke", async () => {
    const quorumInvoke = async () => { throw new Error("worker exploded"); };
    const config = { ...REVIEWER_DEFAULTS, enabled: true };
    const out = await invokeReviewer({ cwd, config }, { quorumInvoke });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/exploded/);
  });
});

// ─── Gate-check responder integration ──────────────────────────────────────

function makeFakeHub() {
  const handlers = new Map();
  return {
    onAsk(topic, fn) { handlers.set(topic, fn); },
    async ask(topic, payload) {
      const fn = handlers.get(topic);
      if (!fn) throw new Error(`no handler: ${topic}`);
      return fn(payload);
    },
  };
}

describe("registerGateCheckResponder — reviewer integration (Slice 7)", () => {
  let cwd;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pforge-rev-")); });
  afterEach(() => { try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ } });

  // Stub recall so the existing 3 checks all report clean.
  const cleanDeps = {
    recall: async () => null,
    readReviewQueueState: () => ({ bySeverity: {} }),
    readForgeJsonl: () => [],
    config: { enabled: true, driftThreshold: 0, timeoutMs: 1000 },
  };

  it("reviewer absent from response when disabled (default)", async () => {
    const hub = makeFakeHub();
    registerGateCheckResponder(hub, cwd, {
      ...cleanDeps,
      reviewerConfig: { ...REVIEWER_DEFAULTS, enabled: false },
    });
    const out = await hub.ask("brain.gate-check", {});
    expect(out.proceed).toBe(true);
    expect(out.reviewer).toBeNull();
  });

  it("advisory-only: critical verdict does NOT block when blockOnCritical=false (D6)", async () => {
    const hub = makeFakeHub();
    const quorumInvoke = async () => ({ score: 20, critical: true, summary: "unsafe query" });
    registerGateCheckResponder(hub, cwd, {
      ...cleanDeps,
      reviewerConfig: { ...REVIEWER_DEFAULTS, enabled: true, blockOnCritical: false },
      quorumInvoke,
    });
    const out = await hub.ask("brain.gate-check", { sliceNumber: 7, sliceTitle: "Demo" });
    expect(out.reviewer.ok).toBe(true);
    expect(out.reviewer.critical).toBe(true);
    expect(out.proceed).toBe(true); // still proceeds — advisory only
  });

  it("blocking: critical verdict blocks when blockOnCritical=true", async () => {
    const hub = makeFakeHub();
    const quorumInvoke = async () => ({ score: 15, critical: true, summary: "SQL injection" });
    registerGateCheckResponder(hub, cwd, {
      ...cleanDeps,
      reviewerConfig: { ...REVIEWER_DEFAULTS, enabled: true, blockOnCritical: true },
      quorumInvoke,
    });
    const out = await hub.ask("brain.gate-check", { sliceNumber: 7, sliceTitle: "Demo" });
    expect(out.reviewer.critical).toBe(true);
    expect(out.proceed).toBe(false);
    expect(out.reason).toMatch(/reviewer flagged critical/);
    expect(out.reason).toMatch(/SQL injection/);
  });

  it("non-critical verdict never blocks, even with blockOnCritical=true", async () => {
    const hub = makeFakeHub();
    const quorumInvoke = async () => ({ score: 92, critical: false, summary: "lgtm" });
    registerGateCheckResponder(hub, cwd, {
      ...cleanDeps,
      reviewerConfig: { ...REVIEWER_DEFAULTS, enabled: true, blockOnCritical: true },
      quorumInvoke,
    });
    const out = await hub.ask("brain.gate-check", { sliceNumber: 7 });
    expect(out.reviewer.critical).toBe(false);
    expect(out.proceed).toBe(true);
  });

  it("reviewer infra failure never blocks (try/catch envelope)", async () => {
    const hub = makeFakeHub();
    const quorumInvoke = async () => { throw new Error("boom"); };
    registerGateCheckResponder(hub, cwd, {
      ...cleanDeps,
      reviewerConfig: { ...REVIEWER_DEFAULTS, enabled: true, blockOnCritical: true },
      quorumInvoke,
    });
    const out = await hub.ask("brain.gate-check", {});
    // reviewer.ok is false but proceed still true — advisory/fail-open
    expect(out.reviewer.ok).toBe(false);
    expect(out.proceed).toBe(true);
  });
});
