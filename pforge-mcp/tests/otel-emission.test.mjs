/**
 * otel-emission.test.mjs — Tests for OTel span emitters and activation gate.
 *
 * Covers:
 *   - isOtelEnabled gate logic (env var combinations)
 *   - initOtel returns null when gate is closed
 *   - emitAgentSpan / emitWorkflowSpan / emitToolSpan / emitGateSpan
 *     fire-and-forget without throwing when OTel packages are absent
 *   - createTelemetryHandler wires orchestrator events to trace spans
 *     and fires OTel span emitters on chat-completed, gate-passed,
 *     slice-started, run-started events
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { isOtelEnabled, initOtel } from "../otel-init.mjs";
import {
  createTraceContext,
  startRootSpan,
  emitAgentSpan,
  emitWorkflowSpan,
  emitToolSpan,
  emitGateSpan,
  createTelemetryHandler,
} from "../telemetry.mjs";

function makeTmpDir() {
  const dir = resolve(tmpdir(), `otel-emission-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ─── isOtelEnabled ───────────────────────────────────────────────────

describe("isOtelEnabled", () => {
  const saved = {};

  beforeEach(() => {
    saved.OTEL_ENABLED = process.env.OTEL_ENABLED;
    saved.OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterEach(() => {
    if (saved.OTEL_ENABLED !== undefined) process.env.OTEL_ENABLED = saved.OTEL_ENABLED;
    else delete process.env.OTEL_ENABLED;
    if (saved.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined)
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = saved.OTEL_EXPORTER_OTLP_ENDPOINT;
    else delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it("returns false when no env vars are set", () => {
    expect(isOtelEnabled()).toBe(false);
  });

  it('returns true when OTEL_ENABLED="true"', () => {
    process.env.OTEL_ENABLED = "true";
    expect(isOtelEnabled()).toBe(true);
  });

  it('returns true when OTEL_ENABLED="1"', () => {
    process.env.OTEL_ENABLED = "1";
    expect(isOtelEnabled()).toBe(true);
  });

  it("returns true when OTEL_EXPORTER_OTLP_ENDPOINT is set", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    expect(isOtelEnabled()).toBe(true);
  });

  it('returns false when OTEL_ENABLED="false"', () => {
    process.env.OTEL_ENABLED = "false";
    expect(isOtelEnabled()).toBe(false);
  });

  it('returns false when OTEL_ENABLED="0"', () => {
    process.env.OTEL_ENABLED = "0";
    expect(isOtelEnabled()).toBe(false);
  });
});

// ─── initOtel ────────────────────────────────────────────────────────

describe("initOtel", () => {
  const saved = {};

  beforeEach(() => {
    saved.OTEL_ENABLED = process.env.OTEL_ENABLED;
    saved.OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterEach(() => {
    if (saved.OTEL_ENABLED !== undefined) process.env.OTEL_ENABLED = saved.OTEL_ENABLED;
    else delete process.env.OTEL_ENABLED;
    if (saved.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined)
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = saved.OTEL_EXPORTER_OTLP_ENDPOINT;
    else delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it("returns null when gate is closed", () => {
    expect(initOtel()).toBeNull();
  });

  it("returns a promise when gate is open (graceful on missing packages)", async () => {
    process.env.OTEL_ENABLED = "true";
    const result = initOtel();
    // Returns a promise (SDK bootstrap)
    expect(result).not.toBeNull();
    expect(typeof result.then).toBe("function");
    // Resolves to null when the optional OTel packages are absent, or to a
    // started NodeSDK when they are installed (e.g. pulled in transitively).
    // Either outcome is the graceful contract.
    const sdk = await result;
    if (sdk === null) {
      expect(sdk).toBeNull();
    } else {
      expect(typeof sdk.shutdown).toBe("function");
      // Tear down so the live exporter does not leak into other tests.
      await sdk.shutdown();
    }
  });
});

// ─── Fire-and-forget emitters (no throw when OTel packages absent) ───

describe("OTel span emitters — graceful no-op", () => {
  it("emitAgentSpan does not throw", () => {
    expect(() => emitAgentSpan({ sliceId: "3", runId: "r1" })).not.toThrow();
  });

  it("emitWorkflowSpan does not throw", () => {
    expect(() => emitWorkflowSpan({ plan: "test.md", runId: "r1" })).not.toThrow();
  });

  it("emitToolSpan does not throw", () => {
    expect(() => emitToolSpan({ toolName: "forge_search", durationMs: 42, isError: false })).not.toThrow();
  });

  it("emitGateSpan does not throw", () => {
    expect(() => emitGateSpan({ sliceId: "2", runId: "r1", failOpen: false })).not.toThrow();
  });

  it("emitAgentSpan handles undefined data", () => {
    expect(() => emitAgentSpan(undefined)).not.toThrow();
  });

  it("emitWorkflowSpan handles null data", () => {
    expect(() => emitWorkflowSpan(null)).not.toThrow();
  });

  it("emitToolSpan handles empty object", () => {
    expect(() => emitToolSpan({})).not.toThrow();
  });

  it("emitGateSpan handles missing fields", () => {
    expect(() => emitGateSpan({})).not.toThrow();
  });
});

// ─── createTelemetryHandler — trace-span wiring ─────────────────────

describe("createTelemetryHandler", () => {
  let trace;
  let handler;
  let runDir;

  beforeEach(() => {
    runDir = makeTmpDir();
    trace = createTraceContext("test-plan.md", { mode: "auto", model: "test-model", sliceCount: 3 });
    handler = createTelemetryHandler(trace, runDir);
  });

  afterEach(() => cleanup(runDir));

  it("run-started creates root span and records plan", () => {
    handler.handle({ type: "run-started", data: { plan: "test-plan.md", mode: "auto", model: "gpt-4", sliceCount: 3 } });
    const root = trace.spans.find((s) => s.name === "run-plan");
    expect(root).toBeDefined();
    expect(root.attributes.plan).toBe("test-plan.md");
  });

  it("slice-started creates child span with sliceId", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({ type: "slice-started", data: { sliceId: "2", title: "Add tests" } });
    const span = trace.spans.find((s) => s.name === "slice-2");
    expect(span).toBeDefined();
    expect(span.attributes.sliceId).toBe("2");
    expect(span.attributes.title).toBe("Add tests");
  });

  it("slice-completed ends the slice span with OK status", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({ type: "slice-started", data: { sliceId: "1" } });
    handler.handle({ type: "slice-completed", data: { sliceId: "1", duration: 5000, model: "gpt-4" } });
    const span = trace.spans.find((s) => s.name === "slice-1");
    expect(span.status).toBe("OK");
    expect(span.attributes.duration).toBe(5000);
    expect(span.attributes.model).toBe("gpt-4");
  });

  it("slice-failed ends the slice span with ERROR status", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({ type: "slice-started", data: { sliceId: "1" } });
    handler.handle({ type: "slice-failed", data: { sliceId: "1", error: "gate failed" } });
    const span = trace.spans.find((s) => s.name === "slice-1");
    expect(span.status).toBe("ERROR");
  });

  it("chat-completed adds event to parent slice span", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({ type: "slice-started", data: { sliceId: "1" } });
    handler.handle({
      type: "chat-completed",
      data: { sliceId: "1", model: "claude-sonnet-4-20250514", tokens: { tokens_in: 100, tokens_out: 200 }, cost_usd: 0.01 },
    });
    const span = trace.spans.find((s) => s.name === "slice-1");
    const evt = span.events.find((e) => e.name === "chat-completed");
    expect(evt).toBeDefined();
    expect(evt.attributes.model).toBe("claude-sonnet-4-20250514");
    expect(evt.attributes.tokens_in).toBe(100);
    expect(evt.attributes.tokens_out).toBe(200);
  });

  it("gate-passed adds event to parent slice span", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({ type: "slice-started", data: { sliceId: "1" } });
    handler.handle({ type: "gate-passed", data: { sliceId: "1", failOpen: false } });
    const span = trace.spans.find((s) => s.name === "slice-1");
    const evt = span.events.find((e) => e.name === "gate-passed");
    expect(evt).toBeDefined();
    expect(evt.attributes.failOpen).toBe(false);
  });

  it("run-completed ends root span and writes trace", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({
      type: "run-completed",
      data: { status: "completed", results: { passed: 3, failed: 0 } },
    });
    const root = trace.spans.find((s) => s.name === "run-plan");
    expect(root.status).toBe("OK");
  });

  it("run-aborted ends root span with ERROR", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({ type: "run-aborted", data: { reason: "user cancelled" } });
    const root = trace.spans.find((s) => s.name === "run-plan");
    expect(root.status).toBe("ERROR");
  });

  it("quorum-dispatch-started creates child spans for each model leg", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    handler.handle({ type: "slice-started", data: { sliceId: "1" } });
    handler.handle({
      type: "quorum-dispatch-started",
      data: { sliceId: "1", models: ["gpt-4", "claude-sonnet-4-20250514"], score: 7 },
    });
    const parentSpan = trace.spans.find((s) => s.name === "slice-1");
    const legSpans = trace.spans.filter((s) => s.name.startsWith("slice-1-quorum-"));
    expect(legSpans.length).toBe(2);
    expect(legSpans[0].attributes.model).toBe("gpt-4");
    expect(legSpans[1].attributes.model).toBe("claude-sonnet-4-20250514");
    const dispatchEvent = parentSpan.events.find((e) => e.name === "quorum-dispatch");
    expect(dispatchEvent).toBeDefined();
  });

  it("handles events with missing data gracefully", () => {
    expect(() => handler.handle({ type: "run-started", data: {} })).not.toThrow();
    expect(() => handler.handle({ type: "slice-started", data: {} })).not.toThrow();
    expect(() => handler.handle({ type: "chat-completed", data: {} })).not.toThrow();
    expect(() => handler.handle({ type: "gate-passed", data: {} })).not.toThrow();
  });

  it("unknown event type is silently ignored", () => {
    handler.handle({ type: "run-started", data: { plan: "p.md" } });
    expect(() => handler.handle({ type: "nonexistent-event", data: {} })).not.toThrow();
  });
});
