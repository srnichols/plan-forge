import { describe, it, expect } from "vitest";
import { detectCostModel, SUBSCRIPTION_PROVIDERS } from "../cost-service.mjs";

describe("SUBSCRIPTION_PROVIDERS", () => {
  it("contains exactly the three CLI providers", () => {
    expect(SUBSCRIPTION_PROVIDERS.has("gh-copilot")).toBe(true);
    expect(SUBSCRIPTION_PROVIDERS.has("claude-cli")).toBe(true);
    expect(SUBSCRIPTION_PROVIDERS.has("codex-cli")).toBe(true);
    expect(SUBSCRIPTION_PROVIDERS.size).toBe(3);
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

  it("heuristic: gpt-* → openai-api", () => {
    const result = detectCostModel({ model: "gpt-5.4" });
    expect(result.provider).toBe("openai-api");
    expect(result.perRequestUsd).toBeNull();
  });

  it("heuristic: grok-* → xai-api", () => {
    const result = detectCostModel({ model: "grok-4" });
    expect(result.provider).toBe("xai-api");
    expect(result.perRequestUsd).toBeNull();
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
      env: { PFORGE_COST_MODEL: "my-custom-provider" },
      model: "gpt-5.4",
    });
    expect(result.provider).toBe("openai-api");
    expect(result.source).toBe("model-prefix");
  });

  it("unrecognised forge.json cost.model falls through to heuristic", () => {
    const result = detectCostModel({
      env: {},
      forgeConfig: { cost: { model: "not-a-provider" } },
      model: "grok-4",
    });
    expect(result.provider).toBe("xai-api");
    expect(result.source).toBe("model-prefix");
  });
});
