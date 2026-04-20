/**
 * Plan Forge — Phase-25 Slice 4 (L6 Gate Synthesis) unit tests
 *
 * Covers:
 *   - tempering.mjs: getMinimaForDomain() read-only accessor
 *   - orchestrator.mjs: loadGateSynthesisConfig(), classifySliceDomain(),
 *                       synthesizeGateSuggestions(), formatGateSuggestions()
 *
 * MUST #9 (docs/plans/Phase-25-INNER-LOOP-ENHANCEMENTS-v2.57-PLAN.md):
 *   new runtime.gateSynthesis config block { mode, domains }, default
 *   { mode: "suggest", domains: ["domain","integration","controller"] }.
 *
 * D8: modes are "off" | "suggest" | "enforce"; default "suggest".
 *
 * Pure-function tests — no plan execution, no network, tmpdir fixtures only.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  loadGateSynthesisConfig,
  classifySliceDomain,
  synthesizeGateSuggestions,
  formatGateSuggestions,
} from "../orchestrator.mjs";
import { getMinimaForDomain } from "../tempering.mjs";

describe("tempering.getMinimaForDomain (Phase-25 read-only accessor)", () => {
  let cwd;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-synth-"));
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns defaults when no tempering config is present", () => {
    const out = getMinimaForDomain(cwd, "domain");
    expect(out.domain).toBe("domain");
    expect(out.coverageMin).toBe(90);
    expect(out.runtimeBudgetMs).toBeGreaterThan(0);
  });

  it("returns the integration bucket distinct from domain", () => {
    const dom = getMinimaForDomain(cwd, "domain");
    const int = getMinimaForDomain(cwd, "integration");
    expect(int.coverageMin).toBe(80);
    // integration budget differs from unit
    expect(int.runtimeBudgetMs).not.toBe(dom.runtimeBudgetMs);
  });

  it("falls back to domain bucket for unknown domain names", () => {
    const weird = getMinimaForDomain(cwd, "totally-made-up");
    expect(weird.coverageMin).toBeNull();
    // budget mapping falls through to unitMaxMs per implementation
    expect(weird.runtimeBudgetMs).toBeGreaterThan(0);
  });

  it("honors operator overrides in .forge/tempering/config.json", () => {
    const dir = resolve(cwd, ".forge", "tempering");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      resolve(dir, "config.json"),
      JSON.stringify({
        coverageMinima: { domain: 95, integration: 85, controller: 70, overall: 85 },
      }),
      "utf-8",
    );
    expect(getMinimaForDomain(cwd, "domain").coverageMin).toBe(95);
  });
});

describe("loadGateSynthesisConfig (Phase-25 D8)", () => {
  let cwd;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-synth-"));
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("defaults to mode='suggest' with canonical domains when .forge.json is absent", () => {
    const cfg = loadGateSynthesisConfig(cwd);
    expect(cfg.mode).toBe("suggest");
    expect(cfg.domains).toEqual(["domain", "integration", "controller"]);
  });

  it("accepts operator override in .forge.json -> runtime.gateSynthesis", () => {
    writeFileSync(
      resolve(cwd, ".forge.json"),
      JSON.stringify({ runtime: { gateSynthesis: { mode: "off", domains: ["domain"] } } }),
      "utf-8",
    );
    const cfg = loadGateSynthesisConfig(cwd);
    expect(cfg.mode).toBe("off");
    expect(cfg.domains).toEqual(["domain"]);
  });

  it("rejects an invalid mode and falls back to the default", () => {
    writeFileSync(
      resolve(cwd, ".forge.json"),
      JSON.stringify({ runtime: { gateSynthesis: { mode: "yolo" } } }),
      "utf-8",
    );
    expect(loadGateSynthesisConfig(cwd).mode).toBe("suggest");
  });

  it("rejects an empty domain array and falls back to the default", () => {
    writeFileSync(
      resolve(cwd, ".forge.json"),
      JSON.stringify({ runtime: { gateSynthesis: { mode: "suggest", domains: [] } } }),
      "utf-8",
    );
    expect(loadGateSynthesisConfig(cwd).domains).toEqual(["domain", "integration", "controller"]);
  });
});

describe("classifySliceDomain", () => {
  it("classifies controller slices", () => {
    expect(classifySliceDomain({ title: "Add user GET endpoint" })).toBe("controller");
    expect(classifySliceDomain({ title: "Wire REST API" })).toBe("controller");
  });
  it("classifies integration slices", () => {
    expect(classifySliceDomain({ title: "End-to-end login workflow test" })).toBe("integration");
  });
  it("classifies domain slices", () => {
    expect(classifySliceDomain({ title: "Invoice domain validation rules" })).toBe("domain");
    expect(classifySliceDomain({ title: "Order aggregate business logic" })).toBe("domain");
  });
  it("returns null when nothing matches", () => {
    expect(classifySliceDomain({ title: "Update README wording" })).toBeNull();
  });
  it("also considers the slice's files list", () => {
    const out = classifySliceDomain({
      title: "Add tests",
      files: ["src/controllers/user.controller.ts"],
    });
    expect(out).toBe("controller");
  });
  it("is null-safe", () => {
    expect(classifySliceDomain(null)).toBeNull();
    expect(classifySliceDomain(undefined)).toBeNull();
  });
});

describe("synthesizeGateSuggestions (Phase-25 MUST #9)", () => {
  let cwd;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "pforge-synth-"));
  });
  afterEach(() => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns no suggestions when mode='off'", () => {
    const out = synthesizeGateSuggestions({
      slices: [{ number: 1, title: "Invoice domain service", validationGate: "" }],
      cwd,
      config: { mode: "off", domains: ["domain"] },
    });
    expect(out.mode).toBe("off");
    expect(out.suggestions).toEqual([]);
  });

  it("suggests for a domain-matched slice that has no gate", () => {
    const out = synthesizeGateSuggestions({
      slices: [{ number: 1, title: "Invoice domain service", validationGate: "" }],
      cwd,
    });
    expect(out.mode).toBe("suggest");
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].domain).toBe("domain");
    expect(out.suggestions[0].sliceNumber).toBe(1);
    expect(out.suggestions[0].suggestedCommand).toContain("vitest");
    expect(out.suggestions[0].minima.coverageMin).toBe(90);
  });

  it("does NOT suggest when the slice already declares a gate", () => {
    const out = synthesizeGateSuggestions({
      slices: [{
        number: 1,
        title: "Invoice domain service",
        validationGate: "npm test",
      }],
      cwd,
    });
    expect(out.suggestions).toEqual([]);
  });

  it("does NOT suggest for domains excluded from cfg.domains", () => {
    const out = synthesizeGateSuggestions({
      slices: [{ number: 1, title: "Add user GET endpoint", validationGate: "" }],
      cwd,
      config: { mode: "suggest", domains: ["domain"] }, // controller excluded
    });
    expect(out.suggestions).toEqual([]);
  });

  it("handles array-form validationGate (same as string)", () => {
    const withGate = synthesizeGateSuggestions({
      slices: [{
        number: 1,
        title: "Invoice domain service",
        validationGate: ["npm test", "echo done"],
      }],
      cwd,
    });
    expect(withGate.suggestions).toEqual([]);
  });

  it("ignores slices that do not match any domain keyword", () => {
    const out = synthesizeGateSuggestions({
      slices: [{ number: 1, title: "Update README wording", validationGate: "" }],
      cwd,
    });
    expect(out.suggestions).toEqual([]);
  });

  it("handles empty or missing slice list gracefully", () => {
    expect(synthesizeGateSuggestions({ slices: [], cwd }).suggestions).toEqual([]);
    expect(synthesizeGateSuggestions({ slices: null, cwd }).suggestions).toEqual([]);
    expect(synthesizeGateSuggestions({ cwd }).suggestions).toEqual([]);
  });
});

describe("formatGateSuggestions (advisory printer)", () => {
  it("returns '' when there are no suggestions", () => {
    expect(formatGateSuggestions({ mode: "suggest", suggestions: [] })).toBe("");
    expect(formatGateSuggestions(null)).toBe("");
  });

  it("prints a block with mode, slice title, domain, and suggested command", () => {
    const out = formatGateSuggestions({
      mode: "suggest",
      suggestions: [{
        sliceNumber: 7,
        sliceTitle: "Invoice domain service",
        domain: "domain",
        reason: "reason text",
        suggestedCommand: "bash -c 'npx vitest run tests/x.test.mjs'",
        minima: { coverageMin: 90, runtimeBudgetMs: 120000 },
      }],
    });
    expect(out).toContain('mode="suggest"');
    expect(out).toContain("Slice 7");
    expect(out).toContain("Invoice domain service");
    expect(out).toContain("Domain:  domain");
    expect(out).toContain("vitest");
  });
});
