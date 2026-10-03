import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveAllowlist } from "../src/allowlist.mjs";
import { invokeAllowlisted } from "../src/tool-bridge.mjs";
import { buildToolSchemas, runTurn, autoSelectProvider } from "../src/reasoning.mjs";
import {
  runLoop,
  _denyAllPermissions,
  _defaultCreateSessionForTests,
  _extractUsageForTests,
  _buildClientInfoForTests,
  PROVIDER_NAME,
} from "../src/providers/copilot-sdk-tools.mjs";
import { computeTurnCost } from "../src/cost.mjs";

class FakeToolSet {
  constructor() {
    this.items = [];
  }
  addCustom(name) {
    this.items.push(`custom:${name}`);
    return this;
  }
  toArray() {
    return [...this.items];
  }
}

function makeSdk() {
  return {
    ToolSet: FakeToolSet,
    defineTool: (name, config) => ({ name, ...config }),
  };
}

function makeCreateSession(onSend, captured = []) {
  return async (config) => {
    captured.push(config);
    return {
      session: {
        sendAndWait: async () => onSend(config),
        disconnect: vi.fn(),
      },
      client: { stop: vi.fn() },
    };
  };
}

describe("Forge-Master Copilot SDK provider", () => {
  it("registers only custom Forge-Master tools and denies SDK permissions", async () => {
    const captured = [];
    await runLoop({
      system: "system",
      messages: [{ role: "user", content: "hello" }],
      tools: buildToolSchemas(["forge_search"]),
      dispatchTool: async () => ({ summary: "ok" }),
      model: "claude-sonnet-5.5",
      sdk: makeSdk(),
      createSession: makeCreateSession(() => ({ data: { content: "done" } }), captured),
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].tools.map((tool) => tool.name)).toEqual(["forge_search"]);
    expect(captured[0].tools[0].skipPermission).toBe(true);
    expect(captured[0].tools[0].defer).toBe("never");
    expect(captured[0].availableTools.toArray()).toEqual(["custom:forge_search"]);
    expect(captured[0].excludedTools).toEqual(["builtin:*", "mcp:*"]);
    expect(captured[0].toolSearch).toEqual({ enabled: false });
    expect(captured[0].onPermissionRequest({ kind: "shell" })).toEqual({
      kind: "reject",
      feedback: "Forge-Master denies SDK permission requests (shell).",
    });
    expect(_denyAllPermissions({ kind: "url" }).kind).toBe("reject");
  });

  it("round-trips tool calls through the real allowlist filter", async () => {
    const resolvedAllowlist = resolveAllowlist({ toolMetadata: {}, discoverExtensionTools: false });
    const dispatcher = vi.fn(async () => ({ summary: "should not run" }));
    const result = await runLoop({
      messages: [{ role: "user", content: "try a write tool" }],
      tools: buildToolSchemas(["forge_run_plan"]),
      dispatchTool: (name, args) => invokeAllowlisted(
        { tool: name, args },
        { resolvedAllowlist, dispatcher },
      ),
      model: "claude-sonnet-5.5",
      sdk: makeSdk(),
      createSession: makeCreateSession(async (config) => {
        await config.tools[0].handler({ plan: "docs/plans/NOPE.md" });
        return { data: { content: "blocked" } };
      }),
    });

    expect(dispatcher).not.toHaveBeenCalled();
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].result.error).toContain("tool_not_allowlisted");
  });

  it("returns ceiling errors to the model without executing calls beyond the cap", async () => {
    const dispatcher = vi.fn(async () => ({ summary: "ok" }));
    const result = await runLoop({
      messages: [{ role: "user", content: "call twice" }],
      tools: buildToolSchemas(["forge_search"]),
      dispatchTool: dispatcher,
      maxToolCalls: 1,
      model: "claude-sonnet-5.5",
      sdk: makeSdk(),
      createSession: makeCreateSession(async (config) => {
        await config.tools[0].handler({ q: "one" });
        await config.tools[0].handler({ q: "two" });
        return { data: { content: "done" } };
      }),
    });

    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[1].result.error).toBe("tool_budget_exceeded");
  });

  it("reserves tool-call budget before awaits so concurrent calls cannot exceed maxToolCalls", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const dispatcher = vi.fn(async () => {
      await gate;
      return { summary: "ok" };
    });
    const resultPromise = runLoop({
      messages: [{ role: "user", content: "call concurrently" }],
      tools: buildToolSchemas(["forge_search"]),
      dispatchTool: dispatcher,
      maxToolCalls: 1,
      model: "claude-sonnet-5.5",
      sdk: makeSdk(),
      createSession: makeCreateSession(async (config) => {
        const calls = [1, 2, 3].map((n) => config.tools[0].handler({ n }));
        await Promise.resolve();
        release();
        await Promise.all(calls);
        return { data: { content: "done" } };
      }),
    });
    const result = await resultPromise;

    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(result.toolCalls).toHaveLength(3);
    expect(result.toolCalls.filter((tc) => tc.result.error === "tool_budget_exceeded")).toHaveLength(2);
  });

  it("skips a tool call the runtime already cancelled, without spending budget", async () => {
    const dispatcher = vi.fn(async () => ({ summary: "ok" }));
    const result = await runLoop({
      messages: [{ role: "user", content: "cancelled call" }],
      tools: buildToolSchemas(["forge_search"]),
      dispatchTool: dispatcher,
      maxToolCalls: 1,
      model: "claude-sonnet-5.5",
      sdk: makeSdk(),
      createSession: makeCreateSession(async (config) => {
        const aborted = new AbortController();
        aborted.abort();
        await config.tools[0].handler({ q: "one" }, { signal: aborted.signal });
        await config.tools[0].handler({ q: "two" }, { signal: new AbortController().signal });
        return { data: { content: "done" } };
      }),
    });

    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(result.toolCalls[0].result.error).toBe("tool_cancelled");
    expect(result.toolCalls[1].result).toEqual({ summary: "ok" });
  });

  it("returns as soon as the runtime cancels an in-flight tool call", async () => {
    const dispatcher = vi.fn(() => new Promise(() => {}));
    const result = await runLoop({
      messages: [{ role: "user", content: "slow call" }],
      tools: buildToolSchemas(["forge_search"]),
      dispatchTool: dispatcher,
      model: "claude-sonnet-5.5",
      sdk: makeSdk(),
      createSession: makeCreateSession(async (config) => {
        const controller = new AbortController();
        const pending = config.tools[0].handler({ q: "slow" }, { signal: controller.signal });
        controller.abort();
        await pending;
        return { data: { content: "done" } };
      }),
    });

    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(result.toolCalls[0].result.error).toBe("tool_cancelled");
  });

  it("identifies Forge-Master to the Copilot runtime", async () => {
    let options;
    class RecordingClient {
      constructor(opts) {
        options = opts;
        this.stop = vi.fn(async () => {});
        this.createSession = vi.fn(async () => ({ sendAndWait: vi.fn() }));
      }
    }
    await _defaultCreateSessionForTests({
      model: "claude-sonnet-5.5",
      tools: [],
      availableTools: new FakeToolSet(),
      onPermissionRequest: () => ({ kind: "reject" }),
      onEvent: () => {},
      CopilotClientClass: RecordingClient,
    });
    expect(options.clientInfo).toEqual(_buildClientInfoForTests());
    expect(options.clientInfo).toMatchObject({ applicationName: "plan-forge", integrationName: "forge-master" });
    expect(options.clientInfo.applicationVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("stops the Copilot client when createSession fails", async () => {
    const stop = vi.fn(async () => {});
    class FailingClient {
      constructor() {
        this.stop = stop;
        this.createSession = vi.fn(async () => { throw new Error("not signed in"); });
      }
    }

    await expect(_defaultCreateSessionForTests({
      model: "claude-sonnet-5.5",
      tools: [],
      availableTools: new FakeToolSet(),
      onPermissionRequest: () => ({ kind: "reject" }),
      onEvent: () => {},
      CopilotClientClass: FailingClient,
    })).rejects.toThrow("not signed in");
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("sums assistant.usage tokens across model calls", () => {
    const usage = _extractUsageForTests([
      { type: "assistant.usage", data: { inputTokens: 1000, outputTokens: 50, model: "claude-sonnet-5.5" } },
      { type: "assistant.message", data: { outputTokens: 999, model: "claude-sonnet-5.5" } },
      { type: "assistant.usage", data: { inputTokens: 1200, outputTokens: 80, model: "claude-sonnet-5.5" } },
    ], "claude-sonnet-5.5");

    expect(usage.tokensIn).toBe(2200);
    expect(usage.tokensOut).toBe(130);
  });

  it("auto-selects githubCopilot first when available", async () => {
    const selected = await autoSelectProvider(
      {},
      {},
      {
        githubCopilot: { module: { PROVIDER_NAME }, isAvailable: () => true },
        anthropic: { module: { PROVIDER_NAME: "anthropic" }, isAvailable: () => true },
      },
    );
    expect(selected.PROVIDER_NAME).toBe("githubCopilot");
  });

  it("falls back to the next provider when SDK session start fails", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "forge-master-copilot-fallback-"));
    try {
      const fallbackProvider = {
        PROVIDER_NAME: "anthropic",
        sendTurn: vi.fn(async () => ({
          type: "reply",
          content: "fallback answer",
          tokensIn: 3,
          tokensOut: 4,
        })),
      };
      const result = await runTurn(
        { message: "what is my plan status?", cwd: tmpDir },
        {
          skipPlanner: true,
          config: {
            reasoningModel: "claude-sonnet-5.5",
            reasoningProvider: null,
            defaultProvider: "githubCopilot",
            maxToolCalls: 5,
            discoverExtensionTools: false,
            autoEscalate: false,
          },
          _providers: {
            githubCopilot: {
              module: {
                PROVIDER_NAME: "githubCopilot",
                runLoop: async () => {
                  throw Object.assign(new Error("not signed in"), { code: "COPILOT_SDK_SESSION_FAILED" });
                },
              },
              isAvailable: () => true,
            },
            anthropic: { module: fallbackProvider, isAvailable: () => true },
          },
          dispatcher: async () => ({}),
          recall: async () => null,
        },
      );

      expect(result.reply).toBe("fallback answer");
      expect(result.fallbackFromTier).toBe("githubCopilot");
      expect(fallbackProvider.sendTurn).toHaveBeenCalled();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("falls back from auto-selected Copilot using real config and re-resolves model/apiKey", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "forge-master-copilot-real-config-fallback-"));
    vi.stubEnv("PATH", "");
    vi.stubEnv("Path", "");
    vi.stubEnv("GITHUB_TOKEN", "ghp_fake");
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-fake");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
    try {
      const openaiProvider = {
        PROVIDER_NAME: "openai",
        sendTurn: vi.fn(async () => ({
          type: "reply",
          content: "openai fallback",
          tokensIn: 5,
          tokensOut: 6,
        })),
      };
      const result = await runTurn(
        { message: "what is my plan status?", cwd: tmpDir },
        {
          skipPlanner: true,
          _providers: {
            githubCopilot: {
              module: {
                PROVIDER_NAME: "githubCopilot",
                runLoop: async () => {
                  throw Object.assign(new Error("no Copilot plan"), { code: "COPILOT_SDK_SESSION_FAILED" });
                },
              },
              isAvailable: () => true,
            },
            anthropic: { module: null, isAvailable: () => false },
            openai: { module: openaiProvider, isAvailable: () => true },
            xai: { module: null, isAvailable: () => false },
          },
          dispatcher: async () => ({}),
          recall: async () => null,
        },
      );

      expect(result.reply).toBe("openai fallback");
      expect(result.fallbackFromTier).toBe("githubCopilot");
      expect(openaiProvider.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        model: "gpt-6-sol",
        apiKey: "sk-openai-fake",
      }));
    } finally {
      vi.unstubAllEnvs();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses SDK usage tokens for runTurn cost accounting", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "forge-master-copilot-cost-"));
    try {
      const provider = {
        PROVIDER_NAME,
        runLoop: async () => ({
          reply: "priced",
          toolCalls: [],
          tokensIn: 100,
          tokensOut: 20,
          model: "claude-sonnet-5.5",
        }),
      };
      const result = await runTurn(
        { message: "what is my plan status and cost?", cwd: tmpDir },
        {
          provider,
          skipPlanner: true,
          config: {
            reasoningModel: "claude-sonnet-5.5",
            reasoningProvider: "githubCopilot",
            maxToolCalls: 5,
            discoverExtensionTools: false,
            autoEscalate: false,
          },
          recall: async () => null,
        },
      );

      expect(result.tokensIn).toBe(100);
      expect(result.tokensOut).toBe(20);
      expect(result.totalCostUSD).toBe(computeTurnCost("claude-sonnet-5.5", 100, 20));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
