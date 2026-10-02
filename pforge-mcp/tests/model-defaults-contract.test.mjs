/**
 * Model-defaults contract (2026-09-30 GitHub Copilot model refresh).
 *
 * Every model Plan Forge picks on the user's behalf must be priced (or cost
 * estimates silently drop it), must not be a model GitHub Copilot retires in
 * the refresh window, and must agree with every place that restates it.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MODEL_PRICING } from "../cost-service.mjs";
import { CONFIG_SCHEMA } from "../capabilities/schemas.mjs";
import {
  DEFAULT_ESTIMATE_MODEL,
  DEFAULT_FORGE_MASTER_ROUTER_MODEL,
  DEFAULT_GROK_ADDIN_MODEL,
  DEFAULT_QUORUM_MODELS,
  DEFAULT_QUORUM_REVIEWER_MODEL,
  DEFAULT_ROUTING_MODEL,
  defaultedModels,
  QUORUM_PRESETS,
} from "../orchestrator/constants.mjs";
import { isDirectApiOnlyModel } from "../orchestrator/worker-spawn.mjs";
import { TEMPERING_DEFAULT_CONFIG } from "../tempering.mjs";

// GitHub Copilot retirements, shared with scripts/check-model-drift.mjs (#303).
const RETIREMENTS = JSON.parse(readFileSync(new URL("../model-retirements.json", import.meta.url), "utf8"));
const COPILOT_RETIRED = Object.keys(RETIREMENTS.copilot);

const WORKER_CAPABILITIES = JSON.parse(
  readFileSync(new URL("../worker-capabilities.json", import.meta.url), "utf8"),
);

const DEFAULTED_MODELS = defaultedModels();

describe("model defaults contract", () => {
  it.each(DEFAULTED_MODELS)("%s is priced in MODEL_PRICING", (model) => {
    expect(MODEL_PRICING[model], `${model} has no MODEL_PRICING entry`).toBeDefined();
  });

  it("no default points at a model GitHub Copilot is retiring", () => {
    expect(DEFAULTED_MODELS.filter((m) => COPILOT_RETIRED.includes(m))).toEqual([]);
  });

  it("model-retirements.json maps model IDs to YYYY-MM-DD dates", () => {
    expect(COPILOT_RETIRED.length).toBeGreaterThan(0);
    for (const [model, date] of Object.entries(RETIREMENTS.copilot)) {
      expect(date, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(date)), model).toBe(false);
    }
  });

  it("DEFAULT_ESTIMATE_MODEL matches the gh-copilot worker's defaultModel", () => {
    expect(WORKER_CAPABILITIES.workers["gh-copilot"].defaultModel).toBe(DEFAULT_ESTIMATE_MODEL);
  });

  it(".forge.json schema documents the runtime quorum defaults", () => {
    const quorum = CONFIG_SCHEMA.properties.quorum.properties;
    expect(quorum.models.default).toEqual([...DEFAULT_QUORUM_MODELS]);
    expect(quorum.reviewerModel.default).toBe(DEFAULT_QUORUM_REVIEWER_MODEL);
    expect(quorum.grokModel.default).toBe(DEFAULT_GROK_ADDIN_MODEL);
  });

  it.each(["power", "speed"])("%s availableIn only lists the preset's own models", (name) => {
    const preset = QUORUM_PRESETS[name];
    for (const [runtime, models] of Object.entries(preset.availableIn)) {
      const strays = models.filter((m) => !preset.models.includes(m));
      expect(strays, `${name}.availableIn["${runtime}"] lists non-members`).toEqual([]);
    }
  });

  it.each(["power", "speed"])("%s never declares a direct-API-only model as gh-copilot servable", (name) => {
    const ghServable = QUORUM_PRESETS[name].availableIn["cli-gh"] ?? [];
    expect(ghServable.filter((m) => isDirectApiOnlyModel(m))).toEqual([]);
  });
});

// Defaults that live outside defaultedModels(): each one is a model Plan Forge
// calls without the user naming it, so each must be priced and not retiring.
describe("model defaults contract — tempering, workers, Forge-Master, power-gov", () => {
  const OTHER_DEFAULTS = {
    "tempering visualAnalyzer.models": [...TEMPERING_DEFAULT_CONFIG.visualAnalyzer.models],
    "grok worker defaultModel": [WORKER_CAPABILITIES.workers.grok.defaultModel],
    "Forge-Master routerModel": [DEFAULT_FORGE_MASTER_ROUTER_MODEL],
    "power-gov models": [...QUORUM_PRESETS["power-gov"].models, QUORUM_PRESETS["power-gov"].reviewerModel],
  };

  it.each(Object.entries(OTHER_DEFAULTS))("%s are priced and not retiring", (_label, models) => {
    expect(models.filter((m) => !MODEL_PRICING[m])).toEqual([]);
    expect(models.filter((m) => COPILOT_RETIRED.includes(m))).toEqual([]);
  });

  it("the visual analyzer uses the default quorum (Copilot-served, image-capable)", () => {
    expect(TEMPERING_DEFAULT_CONFIG.visualAnalyzer.models).toEqual([...DEFAULT_QUORUM_MODELS]);
  });

  it("the grok worker defaults to the same flagship as the Grok quorum add-in", () => {
    expect(WORKER_CAPABILITIES.workers.grok.defaultModel).toBe(DEFAULT_GROK_ADDIN_MODEL);
  });

  it("every worker defaultModel is priced and not retiring", () => {
    const declared = Object.values(WORKER_CAPABILITIES.workers).map((w) => w.defaultModel).filter(Boolean);
    expect(declared.filter((m) => !MODEL_PRICING[m] || COPILOT_RETIRED.includes(m))).toEqual([]);
  });

  it("power-gov reviews with one of its own models", () => {
    const gov = QUORUM_PRESETS["power-gov"];
    expect(gov.models).toContain(gov.reviewerModel);
    expect(gov.availableIn["microsoft-foundry"]).toEqual(gov.models);
  });
});

// The shells restate these defaults as literals (they can't import ESM), so pin them.
describe("Guard: shell entry points restate the runtime model defaults", () => {
  const readRepoFile = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

  it.each(["setup.ps1", "setup.sh"])("%s seeds modelRouting.default with DEFAULT_ROUTING_MODEL", (file) => {
    const src = readRepoFile(file);
    const seeded = file.endsWith(".ps1")
      ? src.match(/modelRouting\s*=\s*@\{\s*default\s*=\s*"([^"]+)"/)?.[1]
      : src.match(/"modelRouting":\s*\{\s*"default":\s*"([^"]+)"/)?.[1];
    expect(seeded).toBe(DEFAULT_ROUTING_MODEL);
  });

  it("both updaters add missing modelRouting/hooks defaults through migrate-forge-config.mjs", () => {
    // The migration itself uses DEFAULT_ROUTING_MODEL (migrate-forge-config.test.mjs);
    // the shells must not restate a model literal of their own.
    for (const file of ["pforge.ps1", "pforge.sh"]) {
      const src = readRepoFile(file);
      expect(src, file).toContain("pforge-mcp/migrate-forge-config.mjs");
      expect(src, file).not.toMatch(/NotePropertyName "modelRouting"/);
    }
  });

  it.each(["pforge.ps1", "pforge.sh"])("%s doctor reports DEFAULT_QUORUM_REVIEWER_MODEL as the default reviewer", (file) => {
    expect(readRepoFile(file)).toContain(`default (${DEFAULT_QUORUM_REVIEWER_MODEL})`);
  });
});

// Shipped content (runtime code, presets, templates, guidance, the manual) must
// not name a model GitHub Copilot has retired or is retiring: users copy these
// names into .forge.json and plan frontmatter. Checks the whole list, not just
// past dates, so the guard cannot start failing on its own when a date passes.
describe("Guard: shipped content names no model GitHub Copilot is retiring", () => {
  const REPO = fileURLToPath(new URL("../../", import.meta.url));
  const SCAN_ROOTS = ["presets", "templates", ".github", "pforge-mcp", "pforge-master/src", "docs/manual"];
  const SKIP_DIRS = new Set(["node_modules", "tests", "__tests__", "fixtures", "workflows"]);
  const SCAN_EXT = /\.(mjs|js|json|md|html|template|ps1|sh)$/;
  // Each allowed file lists retired models on purpose.
  const ALLOWED = new Map([
    ["pforge-mcp/cost-service.mjs", "historical MODEL_PRICING so past runs still price"],
    ["pforge-master/src/cost.mjs", "historical TURN_PRICING so past turns still price"],
    ["pforge-mcp/model-retirements.json", "the retirement list itself"],
    ["pforge-mcp/copilot-pricing.json", "generated by scripts/sync-copilot-pricing.mjs"],
    ["pforge-mcp/.vitest-results.json", "test-run artifact"],
  ]);

  const walk = (dir) => readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(rel);
    return SCAN_EXT.test(entry.name) && !ALLOWED.has(rel) ? [rel] : [];
  });

  it("finds no retiring model name outside the allow-list", () => {
    const escaped = COPILOT_RETIRED.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(?<![\\w.-])(${escaped.join("|")})(?![\\w-]|\\.\\w)`, "g");
    const hits = SCAN_ROOTS.filter((root) => existsSync(join(REPO, root))).flatMap(walk).flatMap((rel) =>
      readFileSync(join(REPO, rel), "utf8").split("\n").flatMap((line, i) =>
        [...line.matchAll(pattern)].map((m) => `${rel}:${i + 1} ${m[1]}`)));
    expect(hits).toEqual([]);
  });
});

describe("Guard: Forge-Master router default has one source", () => {
  const readRepoFile = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

  it("pforge-master restates DEFAULT_FORGE_MASTER_ROUTER_MODEL (separate package, cannot import it)", () => {
    expect(readRepoFile("pforge-master/src/config.mjs")).toContain(`routerModel: "${DEFAULT_FORGE_MASTER_ROUTER_MODEL}"`);
  });

  it("the capabilities surface uses the constant instead of a literal", () => {
    expect(readRepoFile("pforge-mcp/capabilities/surface.mjs")).not.toContain(`"${DEFAULT_FORGE_MASTER_ROUTER_MODEL}"`);
  });
});