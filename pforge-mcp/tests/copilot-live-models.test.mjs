import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverCopilotModels, normalizeModelInfo, LIVE_MODELS_TTL_MS, availableEscalationChain,
} from "../orchestrator/copilot-live-models.mjs";
import {
  isServedByCopilot, isUnavailableToUser, useLiveCopilotModels, isRecommendableModel,
} from "../copilot-models.mjs";

const LIVE = [
  { id: "auto", name: "Auto", capabilities: {} },
  { id: "claude-sonnet-5.5", name: "Claude Sonnet 5.5", capabilities: {}, policy: { state: "enabled", terms: "" } },
  { id: "gpt-6-luna", name: "GPT-6 Luna", capabilities: {}, policy: { state: "enabled", terms: "" }, billing: { multiplier: 0.33 } },
  { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", capabilities: {} },
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", capabilities: {}, policy: { state: "disabled", terms: "" } },
  { id: "brand-new-model", name: "Brand New", capabilities: {}, policy: { state: "enabled", terms: "" } },
];

describe("normalizeModelInfo", () => {
  it("keeps id, availability and multiplier", () => {
    expect(normalizeModelInfo(LIVE[2])).toEqual({ id: "gpt-6-luna", enabled: true, multiplier: 0.33 });
  });

  it("treats a model without a policy as enabled and a disabled policy as unavailable", () => {
    expect(normalizeModelInfo(LIVE[3]).enabled).toBe(true);
    expect(normalizeModelInfo(LIVE[4]).enabled).toBe(false);
  });

  it("drops entries without an id", () => {
    expect(normalizeModelInfo({ name: "x" })).toBeNull();
  });
});

describe("discoverCopilotModels", () => {
  let dir;
  const savedEnv = process.env.PFORGE_LIVE_MODELS;
  const NOW = Date.parse("2026-10-03T12:00:00Z");
  const cachePath = () => join(dir, ".forge", "copilot-models.json");
  const writeCache = (fetchedAt, models) => {
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify({ fetchedAt, models }));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pf-live-models-"));
    delete process.env.PFORGE_LIVE_MODELS;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (savedEnv === undefined) delete process.env.PFORGE_LIVE_MODELS;
    else process.env.PFORGE_LIVE_MODELS = savedEnv;
  });

  it("lists live models and writes the cache", async () => {
    const listModels = vi.fn(async () => LIVE);
    const r = await discoverCopilotModels({ cwd: dir, listModels, now: NOW });
    expect(r.source).toBe("live");
    expect(r.models.map((m) => m.id)).toContain("gpt-6-luna");
    expect(r.models.find((m) => m.id === "auto")).toBeUndefined();
    expect(existsSync(cachePath())).toBe(true);
    expect(JSON.parse(readFileSync(cachePath(), "utf8")).fetchedAt).toBe(new Date(NOW).toISOString());
  });

  it("uses a fresh cache without listing", async () => {
    writeCache(new Date(NOW - 60_000).toISOString(), [{ id: "gpt-6-luna", enabled: true, multiplier: null }]);
    const listModels = vi.fn(async () => LIVE);
    const r = await discoverCopilotModels({ cwd: dir, listModels, now: NOW });
    expect(listModels).not.toHaveBeenCalled();
    expect(r.source).toBe("cache");
    expect(r.models).toEqual([{ id: "gpt-6-luna", enabled: true, multiplier: null }]);
  });

  it("refreshes a stale cache", async () => {
    writeCache(new Date(NOW - LIVE_MODELS_TTL_MS - 1).toISOString(), [{ id: "old-model", enabled: true, multiplier: null }]);
    const listModels = vi.fn(async () => LIVE);
    const r = await discoverCopilotModels({ cwd: dir, listModels, now: NOW });
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(r.source).toBe("live");
  });

  it("falls back to a stale cache when listing fails", async () => {
    writeCache(new Date(NOW - LIVE_MODELS_TTL_MS - 1).toISOString(), [{ id: "gpt-6-luna", enabled: true, multiplier: null }]);
    const r = await discoverCopilotModels({ cwd: dir, listModels: async () => { throw new Error("not signed in"); }, now: NOW });
    expect(r.source).toBe("stale-cache");
    expect(r.models).toHaveLength(1);
    expect(r.error).toMatch(/not signed in/);
  });

  it("reports unavailable when listing fails and nothing is cached", async () => {
    const r = await discoverCopilotModels({ cwd: dir, listModels: async () => { throw new Error("offline"); }, now: NOW });
    expect(r).toMatchObject({ source: "unavailable", models: null });
    expect(r.error).toMatch(/offline/);
  });

  it("times out a hung listing", async () => {
    const r = await discoverCopilotModels({ cwd: dir, listModels: () => new Promise(() => {}), now: NOW, timeoutMs: 20 });
    expect(r.source).toBe("unavailable");
    expect(r.error).toMatch(/timed out/i);
  });

  it("treats an empty listing as a failure, not as 'no models'", async () => {
    const r = await discoverCopilotModels({ cwd: dir, listModels: async () => [], now: NOW });
    expect(r.source).toBe("unavailable");
  });

  it("is skipped with PFORGE_LIVE_MODELS=0", async () => {
    process.env.PFORGE_LIVE_MODELS = "0";
    const listModels = vi.fn(async () => LIVE);
    const r = await discoverCopilotModels({ cwd: dir, listModels, now: NOW });
    expect(listModels).not.toHaveBeenCalled();
    expect(r.source).toBe("disabled");
  });

  it("ignores a corrupt cache", async () => {
    mkdirSync(join(dir, ".forge"), { recursive: true });
    writeFileSync(cachePath(), "{ nope");
    const r = await discoverCopilotModels({ cwd: dir, listModels: async () => LIVE, now: NOW });
    expect(r.source).toBe("live");
  });
});

describe("copilot-models live overlay", () => {
  afterEach(() => useLiveCopilotModels(null));

  it("uses the snapshot catalog until a live list is applied", () => {
    expect(isServedByCopilot("gemini-3.8-flash")).toBe(true);
    expect(isUnavailableToUser("gemini-3.8-flash")).toBe(false);
  });

  it("follows the live list once applied", () => {
    useLiveCopilotModels(LIVE.map(normalizeModelInfo).filter(Boolean));
    expect(isServedByCopilot("gpt-6-luna")).toBe(true);
    expect(isServedByCopilot("brand-new-model")).toBe(true);
    expect(isServedByCopilot("gemini-3.8-flash")).toBe(false);
    expect(isServedByCopilot("claude-opus-5.5")).toBe(false);
  });

  it("flags only snapshot Copilot models the user cannot use", () => {
    useLiveCopilotModels(LIVE.map(normalizeModelInfo).filter(Boolean));
    expect(isUnavailableToUser("gemini-3.8-flash")).toBe(true);
    expect(isUnavailableToUser("claude-opus-5.5")).toBe(true);
    expect(isUnavailableToUser("gpt-6-luna")).toBe(false);
    // Not a Copilot catalog model (e.g. a direct-API model): never flagged.
    expect(isUnavailableToUser("some-api-only-model")).toBe(false);
  });

  it("lets the recommender pick a model new to Copilot", () => {
    expect(isRecommendableModel("brand-new-model")).toBe(false);
    useLiveCopilotModels(LIVE.map(normalizeModelInfo).filter(Boolean));
    expect(isRecommendableModel("brand-new-model")).toBe(true);
  });

  it("clears the overlay with null or an empty list", () => {
    useLiveCopilotModels([{ id: "x", enabled: true, multiplier: null }]);
    useLiveCopilotModels([]);
    expect(isServedByCopilot("gemini-3.8-flash")).toBe(true);
  });
});

describe("availableEscalationChain", () => {
  afterEach(() => useLiveCopilotModels(null));
  const apply = () => useLiveCopilotModels(LIVE.map(normalizeModelInfo).filter(Boolean));

  it("returns the chain unchanged without a live list", () => {
    const chain = ["auto", "claude-opus-5.5", "gpt-6-astra"];
    expect(availableEscalationChain(chain)).toEqual({ chain, dropped: [] });
  });

  it("drops models this account cannot use and keeps auto", () => {
    apply();
    expect(availableEscalationChain(["auto", "claude-opus-5.5", "gpt-6-luna"]))
      .toEqual({ chain: ["auto", "gpt-6-luna"], dropped: ["claude-opus-5.5"] });
  });

  it("keeps models outside Copilot's catalog", () => {
    apply();
    expect(availableEscalationChain(["some-api-only-model", "gemini-3.8-flash"]))
      .toEqual({ chain: ["some-api-only-model"], dropped: ["gemini-3.8-flash"] });
  });

  it("keeps the whole chain rather than leave nothing to escalate to", () => {
    apply();
    expect(availableEscalationChain(["claude-opus-5.5", "gemini-3.8-flash"]))
      .toEqual({ chain: ["claude-opus-5.5", "gemini-3.8-flash"], dropped: [] });
  });
});
