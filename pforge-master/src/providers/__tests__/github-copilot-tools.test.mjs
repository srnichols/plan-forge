/**
 * Tests for the back-compatible github-copilot-tools.mjs module path.
 *
 * The provider now delegates to the Copilot SDK implementation rather than the
 * retired GitHub Models HTTP endpoint.
 */

import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_COPILOT_MODEL,
  PROVIDER_NAME,
  _denyAllPermissions,
  isAvailable,
  runLoop,
} from "../github-copilot-tools.mjs";

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

const fakeSdk = {
  ToolSet: FakeToolSet,
  defineTool: (name, config) => ({ name, ...config }),
};

describe("githubCopilot provider module", () => {
  it("keeps the back-compatible provider name and Copilot default model", () => {
    expect(PROVIDER_NAME).toBe("githubCopilot");
    expect(DEFAULT_COPILOT_MODEL).toBe("claude-sonnet-5.5");
  });

  it("isAvailable is false without an SDK/auth source and true with token env", () => {
    vi.stubEnv("PATH", "");
    vi.stubEnv("Path", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    expect(isAvailable()).toBe(false);
    vi.stubEnv("GITHUB_TOKEN", "ghp_fake");
    expect(isAvailable()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("permission handler rejects every SDK permission request", () => {
    expect(_denyAllPermissions({ kind: "write" })).toEqual({
      kind: "reject",
      feedback: "Forge-Master denies SDK permission requests (write).",
    });
  });

  it("runLoop executes registered Forge-Master tools and returns usage", async () => {
    const captured = [];
    const result = await runLoop({
      messages: [{ role: "user", content: "status" }],
      tools: [{ name: "forge_search", description: "Search", parameters: { type: "object" } }],
      dispatchTool: async () => ({ summary: "search ok" }),
      model: "claude-sonnet-5.5",
      sdk: fakeSdk,
      createSession: async (config) => {
        captured.push(config);
        return {
          session: {
            sendAndWait: async () => {
              await config.tools[0].handler({ query: "status" });
              config.onEvent({
                type: "assistant.usage",
                data: { inputTokens: 11, outputTokens: 7, model: "claude-sonnet-5.5" },
              });
              return { data: { content: "done" } };
            },
            disconnect: vi.fn(),
          },
        };
      },
    });

    expect(captured[0].availableTools.toArray()).toEqual(["custom:forge_search"]);
    expect(result.reply).toBe("done");
    expect(result.toolCalls[0].result.summary).toBe("search ok");
    expect(result.tokensIn).toBe(11);
    expect(result.tokensOut).toBe(7);
  });
});
