import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSecrets } from "../src/secrets.mjs";
import { buildByokProvider } from "../src/runtime/byok.mjs";
import {
  createAgentRuntime,
  normalizeRuntimeId,
  resolveRuntimeId,
} from "../src/runtime/agent-runtime.mjs";

const temporaryDirectories = [];

async function createSecretFixture(value) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-byok-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "secrets.json");
  await writeFile(file, JSON.stringify({ OPENAI_API_KEY: value }), "utf8");
  return { file, secrets: await createSecrets({ env: {}, file }) };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("BYOK provider construction", () => {
  it("requires a non-empty key and honors a custom key secret", async () => {
    const missing = await createSecrets({ env: { OPENAI_API_KEY: "" } });
    expect(buildByokProvider({
      type: "openai",
      config: { runtimes: { byok: { openai: { endpoint: "https://byok.example" } } } },
      secrets: missing,
    })).toMatchObject({ ok: false, error: "BYOK_KEY_MISSING" });

    const fixture = await createSecretFixture("file-canary");
    expect(buildByokProvider({
      type: "openai",
      config: {
        runtimes: {
          byok: { openai: { endpoint: "https://byok.example", keySecret: "OPENAI_API_KEY" } },
        },
      },
      secrets: fixture.secrets,
    })).toMatchObject({ ok: true, provider: { apiKey: "file-canary" } });

    const custom = createSecrets({ env: { CUSTOM_BYOK_KEY: "custom-canary" } });
    const resolved = await custom;
    const input = {
      runtimes: {
        byok: { openai: { endpoint: "https://byok.example", keySecret: "CUSTOM_BYOK_KEY" } },
      },
    };
    const result = buildByokProvider({ type: "openai", config: input, secrets: resolved });
    expect(result).toMatchObject({ ok: true, provider: { apiKey: "custom-canary" } });
    expect(input.runtimes.byok.openai.keySecret).toBe("CUSTOM_BYOK_KEY");
  });

  it("prefers environment keys to file keys", async () => {
    const fixture = await createSecretFixture("file-canary");
    const secrets = await createSecrets({
      env: { OPENAI_API_KEY: "environment-canary" },
      file: fixture.file,
    });
    expect(secrets.get("OPENAI_API_KEY")).toBe("environment-canary");
  });

  it("reports unsupported providers and missing endpoints", async () => {
    const secrets = await createSecrets({ env: { OPENAI_API_KEY: "canary-key-xyz" } });
    expect(buildByokProvider({ type: "other", config: {}, secrets })).toMatchObject({
      ok: false,
      error: "BYOK_UNSUPPORTED_PROVIDER",
    });
    expect(buildByokProvider({
      type: "openai",
      config: {},
      secrets,
    })).toMatchObject({ ok: false, error: "BYOK_ENDPOINT_MISSING" });
  });
});

describe("runtime selection and construction", () => {
  it("normalizes BYOK prefixes and resolves runtime precedence", () => {
    expect(normalizeRuntimeId("byok:openai")).toBe("openai");
    expect(resolveRuntimeId({
      config: { runtimes: { default: "anthropic" } },
      lane: { runtime: "azure" },
      project: { runtime: "byok:openai" },
    })).toBe("openai");
    expect(resolveRuntimeId({
      config: { runtimes: { default: "anthropic" } },
      lane: { runtime: "azure" },
    })).toBe("azure");
    expect(resolveRuntimeId({})).toBe("copilot-sdk");
    expect(() => normalizeRuntimeId("unknown")).toThrow("RUNTIME_UNKNOWN");
    expect(() => resolveRuntimeId({ project: { runtime: "unknown" } })).toThrow("RUNTIME_UNKNOWN");
  });

  it("returns a structured missing-key runtime without creating a session", async () => {
    let sessionCalls = 0;
    const runtime = await createAgentRuntime({
      id: "openai",
      config: { runtimes: { byok: { openai: { endpoint: "https://byok.example" } } } },
      secrets: await createSecrets({ env: {} }),
      createSession: async () => {
        sessionCalls += 1;
        throw new Error("must not run");
      },
    });
    const result = await runtime.run({});
    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      error: "BYOK_KEY_MISSING",
      provider: "openai",
      usage: { tokensIn: null, tokensOut: null, model: null },
    });
    expect(sessionCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain("canary-key-xyz");
  });

  it("keeps the key out of the constructed runtime's serialized shape", async () => {
    const secrets = await createSecrets({ env: { OPENAI_API_KEY: "canary-key-xyz" } });
    let suppliedProvider;
    const runtime = await createAgentRuntime({
      id: "openai",
      config: { runtimes: { byok: { openai: { endpoint: "https://byok.example" } } } },
      secrets,
      createCopilotRuntime: (options) => {
        suppliedProvider = options.provider;
        return { id: options.provider.type, run: async () => ({ ok: true }) };
      },
    });
    expect(suppliedProvider.apiKey).toBe("canary-key-xyz");
    expect(JSON.stringify(runtime)).not.toContain("canary-key-xyz");
  });
});
