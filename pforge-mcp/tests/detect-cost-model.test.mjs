import { describe, it, expect } from "vitest";
import { detectCostModel, SUBSCRIPTION_PROVIDERS } from "../cost-service.mjs";

describe("SUBSCRIPTION_PROVIDERS", () => {
  it("contains the CLI subscription providers (incl. grok-cli)", () => {
    expect(SUBSCRIPTION_PROVIDERS.has("gh-copilot")).toBe(true);
    expect(SUBSCRIPTION_PROVIDERS.has("claude-cli")).toBe(true);
    expect(SUBSCRIPTION_PROVIDERS.has("codex-cli")).toBe(true);
    expect(SUBSCRIPTION_PROVIDERS.has("grok-cli")).toBe(true);
    expect(SUBSCRIPTION_PROVIDERS.size).toBe(4);
  });
});

describe("detectCostModel — precedence", () => {
  it("env:PFORGE_COST_MODEL wins over forge.json and heuristic", () => {
    const result = detectCostModel({
      env: { PFORGE_COST_MODEL: "gh-copilot", ANTHROPIC_API_KEY: "sk-test" },
      forgeConfig: { cost: { model: "anthropic-api" } },
      model: "claude-sonnet-4.6",
    });
    expect(result.provider).toBe("gh-copilot");
    expect(result.source).toBe("env:PFORGE_COST_MODEL");
    expect(result.perRequestUsd).toBe(0.01);
  });

  it("forge.json:cost.model wins over heuristic when env not set", () => {
    const result = detectCostModel({
      env: {},
      forgeConfig: { cost: { model: "openai-api" } },
      model: "claude-sonnet-4.6",
    });
    expect(result.provider).toBe("openai-api");
    expect(result.source).toBe("forge.json:cost.model");
    expect(result.perRequestUsd).toBeNull();
  });

  it("heuristic: claude-* without ANTHROPIC_API_KEY → claude-cli", () => {
    const result = detectCostModel({
      env: {},
      forgeConfig: {},
      model: "claude-sonnet-4.6",
    });
    expect(result.provider).toBe("claude-cli");
    expect(result.source).toBe("model-prefix");
    expect(result.perRequestUsd).toBe(0.01);
  });

  it("heuristic: claude-* with ANTHROPIC_API_KEY → anthropic-api", () => {
    const result = detectCostModel({
      env: { ANTHROPIC_API_KEY: "sk-ant-real" },
      forgeConfig: {},
      model: "claude-opus-4.7",
    });
    expect(result.provider).toBe("anthropic-api");
    expect(result.source).toBe("model-prefix");
    expect(result.perRequestUsd).toBeNull();
  });

  it("heuristic: gpt-* with OPENAI_API_KEY → openai-api", () => {
    // Issue #120: gpt-* only routes to openai-api when an API key is present.
    // Otherwise it routes to gh-copilot (subscription).
    const result = detectCostModel({ env: { OPENAI_API_KEY: "sk-x" }, model: "gpt-5.4" });
    expect(result.provider).toBe("openai-api");
    expect(result.perRequestUsd).toBeNull();
  });

  it("heuristic: gpt-* without OPENAI_API_KEY → gh-copilot (#120)", () => {
    const result = detectCostModel({ env: {}, model: "gpt-5.4" });
    expect(result.provider).toBe("gh-copilot");
    expect(result.perRequestUsd).toBe(0.01);
  });

  it("heuristic: grok-* with XAI_API_KEY → xai-api (metered)", () => {
    const result = detectCostModel({ env: { XAI_API_KEY: "xai-x" }, model: "grok-4.5" });
    expect(result.provider).toBe("xai-api");
    expect(result.perRequestUsd).toBeNull();
  });

  it("heuristic: grok-* without XAI_API_KEY → grok-cli (flat subscription) [Phase GROK-BUILD-WORKER]", () => {
    const result = detectCostModel({ env: {}, model: "grok-4.5" });
    expect(result.provider).toBe("grok-cli");
    expect(result.perRequestUsd).toBe(0.01);
  });

  it("subscription-CLI providers stay flat $0.01 (v2.83.0 byte-identical invariant)", () => {
    for (const p of ["gh-copilot", "claude-cli", "codex-cli"]) {
      const r = detectCostModel({ env: { PFORGE_COST_MODEL: p } });
      expect(r.perRequestUsd).toBe(0.01);
    }
  });

  it("heuristic: gh-copilot model string → gh-copilot", () => {
    const result = detectCostModel({ model: "gh-copilot" });
    expect(result.provider).toBe("gh-copilot");
    expect(result.perRequestUsd).toBe(0.01);
  });

  it("heuristic: string containing 'copilot' → gh-copilot", () => {
    const result = detectCostModel({ model: "github-copilot-latest" });
    expect(result.provider).toBe("gh-copilot");
  });

  it("unknown model returns provider=unknown with perRequestUsd=0 and source=default", () => {
    const result = detectCostModel({ env: {}, forgeConfig: {}, model: "some-future-model" });
    expect(result.provider).toBe("unknown");
    expect(result.perRequestUsd).toBe(0);
    expect(result.source).toBe("default");
  });

  it("no args at all returns unknown/default", () => {
    const result = detectCostModel();
    expect(result.provider).toBe("unknown");
    expect(result.source).toBe("default");
  });

  it("codex-cli provider from env override", () => {
    const result = detectCostModel({ env: { PFORGE_COST_MODEL: "codex-cli" } });
    expect(result.provider).toBe("codex-cli");
    expect(result.perRequestUsd).toBe(0.01);
  });

  it("unrecognised PFORGE_COST_MODEL falls through to heuristic", () => {
    const result = detectCostModel({
      env: { PFORGE_COST_MODEL: "my-custom-provider", OPENAI_API_KEY: "sk-x" },
      model: "gpt-5.4",
    });
    expect(result.provider).toBe("openai-api");
    expect(result.source).toBe("model-prefix");
  });

  it("unrecognised forge.json cost.model falls through to heuristic", () => {
    const result = detectCostModel({
      env: { XAI_API_KEY: "xai-x" },
      forgeConfig: { cost: { model: "not-a-provider" } },
      model: "grok-4",
    });
    expect(result.provider).toBe("xai-api");
    expect(result.source).toBe("model-prefix");
  });
});
