/**
 * Model-defaults contract (2026-09-30 GitHub Copilot model refresh).
 *
 * Every model Plan Forge picks on the user's behalf must be priced (or cost
 * estimates silently drop it), must not be a model GitHub Copilot retires in
 * the refresh window, and must agree with every place that restates it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_PRICING } from "../cost-service.mjs";
import { CONFIG_SCHEMA } from "../capabilities/schemas.mjs";
import {
  DEFAULT_ESCALATION_CHAIN,
  DEFAULT_ESTIMATE_MODEL,
  DEFAULT_GROK_ADDIN_MODEL,
  DEFAULT_QUORUM_MODELS,
  DEFAULT_QUORUM_REVIEWER_MODEL,
  DEFAULT_ROUTING_MODEL,
  DEFAULT_WATCHER_MODEL,
  QUORUM_PRESETS,
} from "../orchestrator/constants.mjs";
import { isDirectApiOnlyModel } from "../orchestrator/worker-spawn.mjs";

// GitHub Copilot retirements announced for 2026-09-01 .. 2026-10-19.
// grok-4.5 is omitted: Plan Forge routes grok-* to the xAI API, where it stays.
const COPILOT_RETIRED = [
  "claude-sonnet-4.6",
  "claude-opus-4.7",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "kimi-k2.7-code",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5-mini",
];

const WORKER_CAPABILITIES = JSON.parse(
  readFileSync(new URL("../worker-capabilities.json", import.meta.url), "utf8"),
);

const DEFAULTED_MODELS = [
  DEFAULT_WATCHER_MODEL,
  DEFAULT_GROK_ADDIN_MODEL,
  DEFAULT_ROUTING_MODEL,
  DEFAULT_ESTIMATE_MODEL,
  DEFAULT_QUORUM_REVIEWER_MODEL,
  ...DEFAULT_QUORUM_MODELS,
  ...DEFAULT_ESCALATION_CHAIN.filter((m) => m !== "auto"),
  ...["power", "speed"].flatMap((p) => [...QUORUM_PRESETS[p].models, QUORUM_PRESETS[p].reviewerModel]),
];

describe("model defaults contract", () => {
  it.each([...new Set(DEFAULTED_MODELS)])("%s is priced in MODEL_PRICING", (model) => {
    expect(MODEL_PRICING[model], `${model} has no MODEL_PRICING entry`).toBeDefined();
  });

  it("no default points at a model GitHub Copilot is retiring", () => {
    expect(DEFAULTED_MODELS.filter((m) => COPILOT_RETIRED.includes(m))).toEqual([]);
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

  it("pforge.ps1 update migration seeds modelRouting.default with DEFAULT_ROUTING_MODEL", () => {
    const src = readRepoFile("pforge.ps1");
    const seeded = [...src.matchAll(/NotePropertyName "modelRouting" -NotePropertyValue @\{ default = "([^"]+)" \}|modelRouting\.default = ([\w.-]+)/g)]
      .map((m) => m[1] || m[2]);
    expect(seeded.length).toBeGreaterThan(0);
    expect(new Set(seeded)).toEqual(new Set([DEFAULT_ROUTING_MODEL]));
  });

  it.each(["pforge.ps1", "pforge.sh"])("%s doctor reports DEFAULT_QUORUM_REVIEWER_MODEL as the default reviewer", (file) => {
    expect(readRepoFile(file)).toContain(`default (${DEFAULT_QUORUM_REVIEWER_MODEL})`);
  });
});
