/**
 * Contract tests for the Phase-39 audit loop MCP tools:
 *   - forge_tempering_drain
 *   - forge_triage_route
 *
 * Validates:
 *   1. Both tools are registered in tools.json with valid schemas
 *   2. Both tools are wired as handlers in server.mjs (TOOLS array)
 *   3. forge_tempering_drain handler delegates to runTemperingDrain
 *   4. forge_triage_route handler delegates to routeFinding
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── tools.json contract ─────────────────────────────────────────────

const toolsJsonPath = resolve(import.meta.dirname, "..", "tools.json");
const toolsJson = JSON.parse(readFileSync(toolsJsonPath, "utf-8"));

describe("tools.json — forge_tempering_drain", () => {
  const entry = toolsJson.find((t) => t.name === "forge_tempering_drain");

  it("is registered in tools.json", () => {
    expect(entry).toBeDefined();
  });

  it("has a description with USE FOR and DO NOT USE FOR", () => {
    expect(entry.description).toContain("USE FOR");
    expect(entry.description).toContain("DO NOT USE FOR");
  });

  it("has a valid inputSchema", () => {
    expect(entry.inputSchema).toBeDefined();
    expect(entry.inputSchema.type).toBe("object");
    expect(entry.inputSchema.properties).toBeDefined();
    expect(entry.inputSchema.properties.path).toBeDefined();
    expect(entry.inputSchema.properties.maxRounds).toBeDefined();
  });

  it("has errors with recovery guidance", () => {
    expect(entry.errors).toBeDefined();
    expect(entry.errors.MISSING_PROJECTDIR).toBeDefined();
    expect(entry.errors.MISSING_PROJECTDIR.recovery).toBeDefined();
    expect(entry.errors.MAX_ROUNDS_EXCEEDED).toBeDefined();
    expect(entry.errors.MAX_ROUNDS_EXCEEDED.recovery).toBeDefined();
  });

  it("declares cost as high (multi-round)", () => {
    expect(entry.cost).toBe("high");
  });

  it("produces drain-history.jsonl and audit artifact", () => {
    expect(entry.produces).toContain(".forge/tempering/drain-history.jsonl");
    expect(entry.produces).toContain(".forge/audits/dev-<ts>.json");
  });

  it("has addedIn 2.80.0", () => {
    expect(entry.addedIn).toBe("2.80.0");
  });
});

describe("tools.json — forge_triage_route", () => {
  const entry = toolsJson.find((t) => t.name === "forge_triage_route");

  it("is registered in tools.json", () => {
    expect(entry).toBeDefined();
  });

  it("has a description with USE FOR and DO NOT USE FOR", () => {
    expect(entry.description).toContain("USE FOR");
    expect(entry.description).toContain("DO NOT USE FOR");
  });

  it("has a valid inputSchema with required finding", () => {
    expect(entry.inputSchema).toBeDefined();
    expect(entry.inputSchema.type).toBe("object");
    expect(entry.inputSchema.required).toContain("finding");
    expect(entry.inputSchema.properties.finding).toBeDefined();
    expect(entry.inputSchema.properties.classifierResult).toBeDefined();
  });

  it("has errors with recovery guidance", () => {
    expect(entry.errors).toBeDefined();
    expect(entry.errors.MISSING_FINDING).toBeDefined();
    expect(entry.errors.MISSING_FINDING.recovery).toBeDefined();
  });

  it("declares cost as low (pure function)", () => {
    expect(entry.cost).toBe("low");
  });

  it("has no side effects", () => {
    expect(entry.sideEffects).toEqual([]);
  });

  it("has addedIn 2.80.0", () => {
    expect(entry.addedIn).toBe("2.80.0");
  });
});

// ─── Server TOOLS array contract ─────────────────────────────────────

describe("server.mjs — tool wiring", () => {
  const serverSrc = readFileSync(
    resolve(import.meta.dirname, "..", "server.mjs"),
    "utf-8",
  );

  it("contains forge_tempering_drain handler", () => {
    expect(serverSrc).toContain('name === "forge_tempering_drain"');
  });

  it("contains forge_triage_route handler", () => {
    expect(serverSrc).toContain('name === "forge_triage_route"');
  });

  it("imports runTemperingDrain from drain.mjs", () => {
    expect(serverSrc).toContain("runTemperingDrain");
    expect(serverSrc).toContain("./tempering/drain.mjs");
  });

  it("imports routeFinding from triage.mjs", () => {
    expect(serverSrc).toContain("routeFinding");
    expect(serverSrc).toContain("./tempering/triage.mjs");
  });

  it("forge_tempering_drain handler calls writeAuditArtifact", () => {
    expect(serverSrc).toContain("writeAuditArtifact");
  });

  it("forge_tempering_drain handler emits telemetry", () => {
    expect(serverSrc).toContain('emitToolTelemetry("forge_tempering_drain"');
  });

  it("forge_triage_route handler emits telemetry", () => {
    expect(serverSrc).toContain('emitToolTelemetry("forge_triage_route"');
  });
});
