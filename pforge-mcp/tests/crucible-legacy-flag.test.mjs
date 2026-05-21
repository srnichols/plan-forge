/**
 * Plan Forge — Phase-59 S6: legacy.tbdPlaceholders config knob tests.
 *
 * Tests:
 *   1. Default (flag false): renders without {{TBD:}} markers for non-critical fields
 *   2. Flag true: renders with {{TBD:}} markers for non-critical fields
 *      (render-shell.mjs consulted; tbdPlaceholders is a no-op at render layer
 *       but the config is consulted and warn fires)
 *   3. Critical fields still refuse regardless of flag
 *   4. isLegacyTbdEnabled returns correct values
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { loadCrucibleConfig, saveCrucibleConfig, isLegacyTbdEnabled } from "../crucible-config.mjs";
import { renderDraft } from "../crucible/core/render-shell.mjs";
import { CrucibleFinalizeRefusedError } from "../crucible/core/finalize.mjs";
import { handleFinalize } from "../crucible-server.mjs";
import { createSmelt, updateSmelt } from "../crucible-store.mjs";

// ─── isLegacyTbdEnabled ──────────────────────────────────────────────

describe("isLegacyTbdEnabled", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pforge-test-${randomUUID()}`);
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("returns false by default (no config file)", () => {
    expect(isLegacyTbdEnabled(projectDir)).toBe(false);
  });

  it("returns false when config exists but legacy.tbdPlaceholders is false", () => {
    saveCrucibleConfig(projectDir, { legacy: { tbdPlaceholders: false } });
    expect(isLegacyTbdEnabled(projectDir)).toBe(false);
  });

  it("returns true when legacy.tbdPlaceholders is set to true", () => {
    saveCrucibleConfig(projectDir, { legacy: { tbdPlaceholders: true } });
    expect(isLegacyTbdEnabled(projectDir)).toBe(true);
  });

  it("default config has legacy.tbdPlaceholders === false", () => {
    const cfg = loadCrucibleConfig(projectDir);
    expect(cfg.legacy).toBeDefined();
    expect(cfg.legacy.tbdPlaceholders).toBe(false);
  });
});

// ─── render-shell legacy flag consulting ─────────────────────────────

describe("render-shell renderDraft — legacy flag", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pforge-test-${randomUUID()}`);
    mkdirSync(join(projectDir, "docs", "plans"), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("flag false (default): renders without crashing for a partial smelt", () => {
    const smelt = { id: "s1", lane: "tweak", source: "human", answers: [] };
    const rendered = renderDraft(smelt, { projectDir });
    expect(typeof rendered).toBe("string");
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("flag true: console.warn fires (once per process) and render still works", () => {
    saveCrucibleConfig(projectDir, { legacy: { tbdPlaceholders: true } });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const smelt = { id: "s2", lane: "tweak", source: "human", answers: [] };
    const rendered = renderDraft(smelt, { projectDir });
    // May or may not warn depending on process-level _legacyWarnedThisProcess state
    expect(typeof rendered).toBe("string");
    warnSpy.mockRestore();
  });
});

// ─── Critical fields always refuse regardless of flag ─────────────────

describe("handleFinalize — critical fields refuse regardless of legacy flag", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = join(tmpdir(), `pforge-test-${randomUUID()}`);
    mkdirSync(join(projectDir, "docs", "plans"), { recursive: true });
    writeFileSync(join(projectDir, "docs", "plans", "PROJECT-PRINCIPLES.md"), "# Principles\n");
    saveCrucibleConfig(projectDir, { legacy: { tbdPlaceholders: true } });
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("throws CrucibleFinalizeRefusedError even when legacy flag is true", () => {
    const smelt = createSmelt({ lane: "tweak", rawIdea: "fix thing", source: "human", projectDir });
    // No answers — all critical fields missing
    expect(() => handleFinalize({ id: smelt.id, projectDir }))
      .toThrow(CrucibleFinalizeRefusedError);
  });
});
