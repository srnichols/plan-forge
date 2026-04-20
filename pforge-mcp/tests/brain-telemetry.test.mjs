/**
 * brain-telemetry.test.mjs — Tests for brain telemetry integration
 *
 * Covers: span creation, attributes, duration, dual-write events.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { recall, remember, forget, _resetL1 } from "../brain.mjs";
import { createTraceContext, startRootSpan } from "../telemetry.mjs";

function makeTempDir() {
  const dir = resolve(tmpdir(), `brain-telemetry-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function makeTrace() {
  const trace = createTraceContext("test-plan.md", { mode: "auto", model: "test" });
  startRootSpan(trace, "test-root");
  return trace;
}

describe("brain telemetry", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTempDir();
    _resetL1();
  });
  afterEach(() => cleanup(tmpDir));

  it("recall creates span with correct name and attributes", async () => {
    const trace = makeTrace();
    await recall("project.tempering.state", {}, {
      cwd: tmpDir,
      readTemperingState: () => ({ scans: 1 }),
      trace,
    });
    const span = trace.spans.find(s => s.name === "brain.recall");
    expect(span).toBeDefined();
    expect(span.attributes.key).toBe("project.tempering.state");
    expect(span.attributes["tier-attempted"]).toBeDefined();
    expect(span.attributes["tier-served"]).toBe("l2");
    expect(span.status).toBe("OK");
  });

  it("remember creates span with tier-served attribute", () => {
    const trace = makeTrace();
    remember("session.ctx", { v: 1 }, { runId: "r1" }, {
      cwd: tmpDir,
      trace,
    });
    const span = trace.spans.find(s => s.name === "brain.remember");
    expect(span).toBeDefined();
    expect(span.attributes["tier-served"]).toBe("l1");
    expect(span.status).toBe("OK");
  });

  it("forget creates span", () => {
    const trace = makeTrace();
    forget("session.ctx", { runId: "r1" }, {
      cwd: tmpDir,
      trace,
    });
    const span = trace.spans.find(s => s.name === "brain.forget");
    expect(span).toBeDefined();
    expect(span.status).toBe("OK");
  });

  it("L3 dual-write queued → span has brain.l3.dual_write_queued event with WARN severity", () => {
    const trace = makeTrace();
    const appendForgeJsonl = () => {}; // mock succeeds
    remember("project.tempering.state", { scans: 1 }, {
      scope: "project-durable",
    }, {
      cwd: tmpDir,
      appendForgeJsonl,
      trace,
    });
    const span = trace.spans.find(s => s.name === "brain.remember");
    expect(span).toBeDefined();
    const dualWriteEvent = span.events.find(e => e.name === "brain.l3.dual_write_queued");
    expect(dualWriteEvent).toBeDefined();
    expect(dualWriteEvent.severity).toBe("WARN");
  });

  it("span includes durationMs > 0", async () => {
    const trace = makeTrace();
    await recall("project.tempering.state", {}, {
      cwd: tmpDir,
      readTemperingState: () => ({ scans: 1 }),
      trace,
    });
    const span = trace.spans.find(s => s.name === "brain.recall");
    expect(span.attributes.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("tier-attempted and tier-served differ on fallback (L2 miss → L3 hit)", async () => {
    const trace = makeTrace();
    await recall("project.tempering.state", { fallback: "l3" }, {
      cwd: tmpDir,
      readTemperingState: () => null, // L2 miss
      searchMemory: async () => ({ content: "from L3" }), // L3 hit
      trace,
    });
    const span = trace.spans.find(s => s.name === "brain.recall");
    expect(span).toBeDefined();
    expect(span.attributes["tier-attempted"]).toContain("l2");
    expect(span.attributes["tier-attempted"]).toContain("l3");
    expect(span.attributes["tier-served"]).toBe("l3");
  });
});
