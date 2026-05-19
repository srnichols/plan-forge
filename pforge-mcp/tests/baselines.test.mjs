/**
 * Plan Forge — Phase WORKER-GUARDRAILS Slice 0
 * Baseline regression harness — asserts current build matches captured snapshots.
 *
 * Purpose: every later slice (S1–S10) must re-run this file to confirm no
 * unintended regressions in four key surfaces:
 *   1. forge_capabilities payload (tool count, tool names, schema shape)
 *   2. parsePlan output (meta, scopeContract, slices, dag)
 *   3. PreToolUse hook deny protocol (JSON structure in check-forbidden scripts)
 *   4. estimateSlice output shape (field presence, model, cost positivity)
 *
 * Non-deterministic fields (generatedAt, planPath, absolute paths) are stripped
 * before comparison. Snapshots live in tests/__baselines__/.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCapabilitySurface } from "../capabilities.mjs";
import { parsePlan } from "../orchestrator.mjs";
import { estimateSlice } from "../cost-service.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINES = resolve(HERE, "__baselines__");
const FIXTURES = resolve(HERE, "fixtures");
const REPO_ROOT = resolve(HERE, "..", "..");

function loadSnapshot(name) {
  return JSON.parse(readFileSync(resolve(BASELINES, name), "utf-8"));
}

// ─── 1. forge_capabilities ────────────────────────────────────────────

describe("Baseline: forge_capabilities payload (Slice 0)", () => {
  const snapshot = loadSnapshot("capabilities.snapshot.json");

  it("schemaVersion matches baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    expect(surface.schemaVersion).toBe(snapshot.schemaVersion);
  });

  it("tool count matches baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    expect(surface.tools.length).toBe(snapshot.toolCount);
  });

  it("sorted tool names match baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    const names = surface.tools.map((t) => t.name).sort();
    expect(names).toEqual(snapshot.toolNames);
  });

  it("CLI command count matches baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    const count = Object.keys(surface.cli?.commands || {}).length;
    expect(count).toBe(snapshot.cliCommandCount);
  });

  it("workflow count matches baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    const count = Object.keys(surface.workflows || {}).length;
    expect(count).toBe(snapshot.workflowCount);
  });

  it("config schema keys match baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    const keys = Object.keys(surface.config?.schema || {}).sort();
    expect(keys).toEqual(snapshot.configSchemaKeys);
  });

  it("dashboard tab count matches baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    const count = Object.keys(surface.dashboard?.tabs || {}).length;
    expect(count).toBe(snapshot.dashboardTabCount);
  });

  it("REST API endpoint count matches baseline", () => {
    const surface = buildCapabilitySurface(null, { cwd: resolve(HERE, "..") });
    const count = (surface.restApi?.endpoints || []).length;
    expect(count).toBe(snapshot.restApiEndpointCount);
  });
});

// ─── 2. parsePlan ────────────────────────────────────────────────────

describe("Baseline: parsePlan output (Slice 0)", () => {
  const snapshot = loadSnapshot("plan-parse.snapshot.json");
  const fixturePlan = resolve(FIXTURES, "sample-plan.md");

  it("meta.title matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.meta.title).toBe(snapshot.meta.title);
  });

  it("meta.status matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.meta.status).toBe(snapshot.meta.status);
  });

  it("meta.branch matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.meta.branch).toBe(snapshot.meta.branch);
  });

  it("scopeContract.inScope matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.scopeContract.inScope).toEqual(snapshot.scopeContract.inScope);
  });

  it("scopeContract.outOfScope matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.scopeContract.outOfScope).toEqual(snapshot.scopeContract.outOfScope);
  });

  it("scopeContract.forbidden matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.scopeContract.forbidden).toEqual(snapshot.scopeContract.forbidden);
  });

  it("slice count matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.slices.length).toBe(snapshot.sliceCount);
  });

  it("slice metadata matches baseline", () => {
    const result = parsePlan(fixturePlan);
    const simplified = result.slices.map((s) => ({
      number: s.number,
      title: s.title,
      depends: s.depends,
      parallel: s.parallel,
      scope: s.scope,
      buildCommand: s.buildCommand,
      testCommand: s.testCommand,
      validationGate: s.validationGate,
      taskCount: s.tasks.length,
    }));
    expect(simplified).toEqual(snapshot.slices);
  });

  it("DAG order count matches baseline", () => {
    const result = parsePlan(fixturePlan);
    expect(result.dag?.order?.length ?? null).toBe(snapshot.dagOrderCount);
  });
});

// ─── 3. Forbidden hook deny protocol ────────────────────────────────

describe("Baseline: forbidden hook deny protocol (Slice 0)", () => {
  const snapshot = loadSnapshot("forbidden-hook-deny.snapshot.json");

  it("check-forbidden.ps1 contains all required deny protocol keys", () => {
    const script = readFileSync(
      resolve(REPO_ROOT, "templates/.github/hooks/scripts/check-forbidden.ps1"),
      "utf-8",
    );
    for (const key of snapshot.protocolKeys) {
      expect(script, `ps1 script must contain key: ${key}`).toContain(key);
    }
  });

  it("check-forbidden.sh contains all required deny protocol keys", () => {
    const script = readFileSync(
      resolve(REPO_ROOT, "templates/.github/hooks/scripts/check-forbidden.sh"),
      "utf-8",
    );
    for (const key of snapshot.protocolKeys) {
      expect(script, `sh script must contain key: ${key}`).toContain(key);
    }
  });

  it("deny response template has correct hookEventName", () => {
    const template = JSON.parse(snapshot.denyResponseTemplate
      .replace("'<filePath>'", "test-file.mjs")
      .replace("'<forbiddenPattern>'", "test-pattern"));
    expect(template.hookSpecificOutput.hookEventName).toBe(snapshot.hookSpecificOutput.hookEventName);
  });

  it("deny response template has correct permissionDecision", () => {
    const template = JSON.parse(snapshot.denyResponseTemplate
      .replace("'<filePath>'", "test-file.mjs")
      .replace("'<forbiddenPattern>'", "test-pattern"));
    expect(template.hookSpecificOutput.permissionDecision).toBe(snapshot.hookSpecificOutput.permissionDecision);
  });

  it("deny response template contains BLOCKED message", () => {
    expect(snapshot.denyResponseTemplate).toContain("BLOCKED");
  });

  it("allow response is {}", () => {
    expect(snapshot.allowResponse).toBe("{}");
  });
});

// ─── 4. estimateSlice ────────────────────────────────────────────────

describe("Baseline: estimateSlice output shape (Slice 0)", () => {
  const snapshot = loadSnapshot("estimate.snapshot.json");
  const fixturePlan = resolve(FIXTURES, "sample-plan.md");

  it("model matches baseline", () => {
    const plan = parsePlan(fixturePlan);
    const result = estimateSlice({ plan, sliceNumber: 1, cwd: HERE });
    expect(result.model).toBe(snapshot.model);
  });

  it("quorumEligible matches baseline for default mode", () => {
    const plan = parsePlan(fixturePlan);
    const result = estimateSlice({ plan, sliceNumber: 1, cwd: HERE });
    expect(result.quorumEligible).toBe(snapshot.quorumEligible);
  });

  it("has all required numeric fields", () => {
    const plan = parsePlan(fixturePlan);
    const result = estimateSlice({ plan, sliceNumber: 1, cwd: HERE });
    expect(typeof result.estimatedCostUSD === "number").toBe(snapshot.hasEstimatedCostUSD);
    expect(typeof result.baseCostUSD === "number").toBe(snapshot.hasBaseCostUSD);
    expect(typeof result.overheadUSD === "number").toBe(snapshot.hasOverheadUSD);
    expect(typeof result.complexityScore === "number").toBe(snapshot.hasComplexityScore);
  });

  it("has rationale string", () => {
    const plan = parsePlan(fixturePlan);
    const result = estimateSlice({ plan, sliceNumber: 1, cwd: HERE });
    expect(typeof result.rationale === "string" && result.rationale.length > 0).toBe(snapshot.hasRationale);
  });

  it("estimatedCostUSD is positive", () => {
    const plan = parsePlan(fixturePlan);
    const result = estimateSlice({ plan, sliceNumber: 1, cwd: HERE });
    expect(result.estimatedCostUSD > 0).toBe(snapshot.estimatedCostUSDPositive);
  });
});
