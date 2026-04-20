/**
 * Plan Forge — Phase-25 Slice 8 (Capabilities & tool-discovery surface) tests
 *
 * Covers:
 *   - INNER_LOOP_SURFACE contract shape (7 subsystems, opt-in invariant).
 *   - buildCapabilitySurface() exposes innerLoop at top level.
 *   - CONFIG_SCHEMA declares runtime.gateSynthesis, runtime.reviewer, brain.federation.
 *   - worker-capabilities.json advertises innerLoop flags.
 *
 * Traces to Phase-25 MUST #11 (forge_capabilities surface) and SHOULD
 * (tools.json, worker-capabilities.json).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INNER_LOOP_SURFACE,
  buildCapabilitySurface,
  CONFIG_SCHEMA,
} from "../capabilities.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PFORGE_MCP_DIR = resolve(HERE, "..");

describe("INNER_LOOP_SURFACE (Phase-25 v2.57 + Phase-26 v2.58 subsystem surface)", () => {
  it("is frozen (prevents runtime mutation by tools)", () => {
    expect(Object.isFrozen(INNER_LOOP_SURFACE)).toBe(true);
  });

  it("declares exactly the 10 subsystems (7 Phase-25 + 3 Phase-26)", () => {
    expect(Object.keys(INNER_LOOP_SURFACE.subsystems).sort()).toEqual([
      "autoFix",
      "autoSkills",
      "competitive",
      "costAnomaly",
      "federation",
      "gateSynthesis",
      "postmortem",
      "reflexion",
      "reviewer",
      "trajectory",
    ]);
  });

  it("every subsystem declares { level, addedIn, enabledByDefault, description, module }", () => {
    for (const [name, sub] of Object.entries(INNER_LOOP_SURFACE.subsystems)) {
      expect(typeof sub.level, `${name}.level`).toBe("string");
      // Phase-25 subsystems addedIn 2.57.0; Phase-26 subsystems addedIn 2.58.0.
      expect(["2.57.0", "2.58.0"], `${name}.addedIn`).toContain(sub.addedIn);
      expect(typeof sub.enabledByDefault, `${name}.enabledByDefault`).toBe("boolean");
      expect(typeof sub.description, `${name}.description`).toBe("string");
      expect(sub.description.length, `${name}.description not empty`).toBeGreaterThan(20);
      expect(typeof sub.module, `${name}.module`).toBe("string");
    }
  });

  it("reviewer and federation are opt-in (enabledByDefault=false) to honor the Phase-25 opt-in invariant", () => {
    expect(INNER_LOOP_SURFACE.subsystems.reviewer.enabledByDefault).toBe(false);
    expect(INNER_LOOP_SURFACE.subsystems.federation.enabledByDefault).toBe(false);
  });

  it("reviewer is advisory-only in v2.57 (D6)", () => {
    expect(INNER_LOOP_SURFACE.subsystems.reviewer.advisoryOnly).toBe(true);
    expect(INNER_LOOP_SURFACE.subsystems.reviewer.configDefaults.blockOnCritical).toBe(false);
    expect(INNER_LOOP_SURFACE.subsystems.reviewer.configDefaults.quorumPreset).toBe("speed");
  });

  it("gateSynthesis defaults to suggest-mode (D8)", () => {
    expect(INNER_LOOP_SURFACE.subsystems.gateSynthesis.configDefaults.mode).toBe("suggest");
    expect(INNER_LOOP_SURFACE.subsystems.gateSynthesis.configDefaults.domains).toEqual([
      "domain", "integration", "controller",
    ]);
  });

  it("federation declares absolute-path-only security posture (D9)", () => {
    expect(INNER_LOOP_SURFACE.subsystems.federation.securityPosture).toMatch(/absolute-local-paths-only/);
  });

  it("postmortem declares retention-10 (D7)", () => {
    expect(INNER_LOOP_SURFACE.subsystems.postmortem.retentionCount).toBe(10);
  });

  // ─── Phase-26 invariants ────────────────────────────────────────
  it("competitive is opt-in (off by default) — worktree spawning never happens without explicit enable", () => {
    expect(INNER_LOOP_SURFACE.subsystems.competitive.enabledByDefault).toBe(false);
    expect(INNER_LOOP_SURFACE.subsystems.competitive.configDefaults.enabled).toBe(false);
  });

  it("autoFix drafts patches but never auto-applies without applyWithoutReview=true", () => {
    expect(INNER_LOOP_SURFACE.subsystems.autoFix.advisoryOnly).toBe(true);
    expect(INNER_LOOP_SURFACE.subsystems.autoFix.configDefaults.applyWithoutReview).toBe(false);
  });

  it("costAnomaly is advisory — detection only, never halts a run", () => {
    expect(INNER_LOOP_SURFACE.subsystems.costAnomaly.advisoryOnly).toBe(true);
    expect(INNER_LOOP_SURFACE.subsystems.costAnomaly.configDefaults.ratio).toBe(2.0);
  });
});

describe("buildCapabilitySurface — innerLoop section (MUST #11)", () => {
  it("exposes innerLoop at the top level of the surface", () => {
    const surface = buildCapabilitySurface([]);
    expect(surface.innerLoop).toBeDefined();
    expect(surface.innerLoop.schemaVersion).toBe("1.1");
    expect(surface.innerLoop.subsystems).toBeDefined();
  });

  it("the innerLoop surface references INNER_LOOP_SURFACE (same schema)", () => {
    const surface = buildCapabilitySurface([]);
    expect(Object.keys(surface.innerLoop.subsystems).sort()).toEqual(
      Object.keys(INNER_LOOP_SURFACE.subsystems).sort(),
    );
  });

  it("does not break pre-existing top-level sections (tools, cli, workflows, config, dashboard, extensions, memory, system)", () => {
    const surface = buildCapabilitySurface([]);
    for (const key of ["tools", "cli", "workflows", "config", "dashboard", "extensions", "memory", "system"]) {
      expect(surface[key], `surface.${key}`).toBeDefined();
    }
  });
});

describe("CONFIG_SCHEMA — Phase-25 config blocks", () => {
  it("declares runtime.gateSynthesis with mode enum and default", () => {
    const block = CONFIG_SCHEMA.properties.runtime.properties.gateSynthesis;
    expect(block).toBeDefined();
    expect(block.properties.mode.enum).toEqual(["off", "suggest", "enforce"]);
    expect(block.properties.mode.default).toBe("suggest");
  });

  it("declares runtime.reviewer with opt-in + speed-preset + advisory defaults", () => {
    const block = CONFIG_SCHEMA.properties.runtime.properties.reviewer;
    expect(block).toBeDefined();
    expect(block.properties.enabled.default).toBe(false);
    expect(block.properties.quorumPreset.default).toBe("speed");
    expect(block.properties.blockOnCritical.default).toBe(false);
  });

  it("declares brain.federation with enabled=false + empty repos default", () => {
    const block = CONFIG_SCHEMA.properties.brain.properties.federation;
    expect(block).toBeDefined();
    expect(block.properties.enabled.default).toBe(false);
    expect(block.properties.repos.default).toEqual([]);
  });
});

describe("worker-capabilities.json — innerLoop flags", () => {
  it("declares an innerLoop block with all 10 subsystem flags = true", () => {
    const raw = readFileSync(resolve(PFORGE_MCP_DIR, "worker-capabilities.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.innerLoop).toBeDefined();
    expect(parsed.innerLoop.schemaVersion).toBe("1.1");
    expect(parsed.innerLoop.addedIn).toBe("2.57.0");
    const subs = parsed.innerLoop.subsystems;
    for (const name of [
      "reflexion", "trajectory", "autoSkills", "gateSynthesis", "postmortem",
      "federation", "reviewer", "competitive", "autoFix", "costAnomaly",
    ]) {
      expect(subs[name], `subsystems.${name}`).toBe(true);
    }
  });
});
