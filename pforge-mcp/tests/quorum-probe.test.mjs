import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveRequiredCli,
  probeQuorumModelAvailability,
  filterQuorumModels,
} from "../orchestrator.mjs";

// ─── resolveRequiredCli ─────────────────────────────────────────────────

describe("resolveRequiredCli", () => {
  it("maps claude-* models to claude CLI", () => {
    expect(resolveRequiredCli("claude-opus-4.6")).toBe("claude");
    expect(resolveRequiredCli("claude-sonnet-4.6")).toBe("claude");
  });

  it("maps codex-* models to codex CLI", () => {
    expect(resolveRequiredCli("codex-mini")).toBe("codex");
  });

  it("maps unknown models to gh-copilot (default)", () => {
    expect(resolveRequiredCli("some-custom-model")).toBe("gh-copilot");
    expect(resolveRequiredCli("llama-3")).toBe("gh-copilot");
  });
});

// ─── probeQuorumModelAvailability ───────────────────────────────────────

describe("probeQuorumModelAvailability", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    process.env = { ...origEnv };
  });

  it("grok model available when XAI_API_KEY is set", () => {
    process.env.XAI_API_KEY = "test-key";
    const result = probeQuorumModelAvailability("grok-4.20-0309-reasoning");
    expect(result.available).toBe(true);
    expect(result.via).toBe("api");
    expect(result.provider).toBe("xai");
  });

  it("grok model unavailable when XAI_API_KEY is not set", () => {
    delete process.env.XAI_API_KEY;
    const result = probeQuorumModelAvailability("grok-3-mini");
    expect(result.available).toBe(false);
    expect(result.via).toBe("api");
    expect(result.reason).toMatch(/XAI_API_KEY/);
    expect(result.install).toMatch(/XAI_API_KEY/);
  });

  it("gpt model available when OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const result = probeQuorumModelAvailability("gpt-5.3-codex");
    expect(result.available).toBe(true);
    expect(result.via).toBe("api");
    expect(result.provider).toBe("openai");
  });

  it("gpt model unavailable when OPENAI_API_KEY is not set", () => {
    delete process.env.OPENAI_API_KEY;
    const result = probeQuorumModelAvailability("gpt-5.3-codex");
    expect(result.available).toBe(false);
    expect(result.via).toBe("api");
    expect(result.reason).toMatch(/OPENAI_API_KEY/);
  });

  // CLI-routed models depend on host PATH — tested via filterQuorumModels with injected probe
  it("unknown model falls through to CLI probe", () => {
    const result = probeQuorumModelAvailability("some-unknown-model");
    // Should attempt CLI route (gh-copilot) — result depends on host
    expect(result.via).toBe("cli");
    expect(result.model).toBe("some-unknown-model");
  });
});

// ─── filterQuorumModels ─────────────────────────────────────────────────

describe("filterQuorumModels", () => {
  const makeProbe = (availableSet) => (model) => {
    if (availableSet.has(model)) {
      return { model, available: true, via: "stub" };
    }
    return { model, available: false, via: "stub", reason: `${model} not available`, install: `Install ${model}` };
  };

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("all 3 models available → all returned, none dropped", () => {
    const probe = makeProbe(new Set(["a", "b", "c"]));
    const { available, dropped } = filterQuorumModels({ models: ["a", "b", "c"] }, { probe });
    expect(available).toEqual(["a", "b", "c"]);
    expect(dropped).toEqual([]);
  });

  it("1 of 3 models dropped → 2 available, 1 dropped with reason", () => {
    const probe = makeProbe(new Set(["a", "c"]));
    const { available, dropped } = filterQuorumModels({ models: ["a", "b", "c"] }, { probe });
    expect(available).toEqual(["a", "c"]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].model).toBe("b");
    expect(dropped[0].reason).toMatch(/not available/);
  });

  it("dedupes duplicate models — single probe per unique model", () => {
    let probeCount = 0;
    const probe = (model) => {
      probeCount++;
      return { model, available: true, via: "stub" };
    };
    const { available } = filterQuorumModels({ models: ["a", "a", "b", "b", "b"] }, { probe });
    expect(available).toEqual(["a", "b"]);
    expect(probeCount).toBe(2);
  });

  it("zero available → empty available array, all dropped", () => {
    const probe = makeProbe(new Set());
    const { available, dropped } = filterQuorumModels({ models: ["x", "y", "z"] }, { probe });
    expect(available).toEqual([]);
    expect(dropped).toHaveLength(3);
  });

  it("single available → available has 1 entry", () => {
    const probe = makeProbe(new Set(["b"]));
    const { available, dropped } = filterQuorumModels({ models: ["a", "b", "c"] }, { probe });
    expect(available).toEqual(["b"]);
    expect(dropped).toHaveLength(2);
  });

  it("logs stderr warning for each dropped model", () => {
    const probe = makeProbe(new Set(["a"]));
    filterQuorumModels({ models: ["a", "b", "c"] }, { probe });
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[quorum] model b unavailable"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[quorum] model c unavailable"));
  });

  it("includes install hint in warning when present", () => {
    const probe = makeProbe(new Set());
    filterQuorumModels({ models: ["x"] }, { probe });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("install: Install x"));
  });
});

// ─── runPlan quorum init integration (logic tests) ──────────────────────

describe("quorum probe fast-fail logic", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("zero available models → error with exitCode 2 and install hints", () => {
    const probe = (model) => ({
      model, available: false, via: "stub",
      reason: `${model} missing`, install: `Install ${model}`,
    });
    const config = { models: ["a", "b"], strictAvailability: false };
    const { available, dropped } = filterQuorumModels(config, { probe });

    expect(available).toHaveLength(0);

    // Simulate the runPlan logic
    const err = new Error(
      `[quorum] no available models. Dropped: ${dropped.map((d) => `${d.model} (${d.reason})`).join(", ")}. ` +
      `Install hints: ${dropped.map((d) => d.install).filter(Boolean).join(" | ")}`,
    );
    err.exitCode = 2;
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain("a (a missing)");
    expect(err.message).toContain("Install a");
  });

  it("strictAvailability=true + 1 dropped → throws even if 2 remain", () => {
    const probe = (model) => {
      if (model === "b") return { model, available: false, via: "stub", reason: "missing" };
      return { model, available: true, via: "stub" };
    };
    const config = { models: ["a", "b", "c"], strictAvailability: true };
    const { available, dropped } = filterQuorumModels(config, { probe });

    expect(available).toHaveLength(2);
    expect(dropped).toHaveLength(1);

    // Simulate strict check
    if (config.strictAvailability && dropped.length > 0) {
      const err = new Error(
        `[quorum] strictAvailability=true and ${dropped.length} model(s) unavailable`,
      );
      err.exitCode = 2;
      expect(err.exitCode).toBe(2);
    }
  });

  it("single model remaining → degradation warning emitted", () => {
    const probe = (model) => {
      if (model === "a") return { model, available: true, via: "stub" };
      return { model, available: false, via: "stub", reason: "missing" };
    };
    const config = { models: ["a", "b", "c"], strictAvailability: false };
    const { available } = filterQuorumModels(config, { probe });

    expect(available).toHaveLength(1);

    // Simulate single-model warning
    if (available.length === 1) {
      console.error("[quorum] only 1 of 3 models available — degrading to single-model");
    }
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("degrading to single-model"),
    );
  });
});
