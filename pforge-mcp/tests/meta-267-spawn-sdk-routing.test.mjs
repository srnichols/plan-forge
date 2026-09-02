/**
 * Plan Forge — meta-bug #267: characterization tests for the Phase-60 BYOK / SDK
 * routing inside _spawnWorkerAsync (worker-spawn.mjs).
 *
 * These branches had NO direct coverage: sdk-worker.test.mjs tests runSdkSession
 * (the callee), and every tempering test injects its own mock spawnWorker so the
 * real one never runs. The suite passed whether or not the routing worked, which
 * made the file unsafe to refactor despite carrying the repo's only ESLint error.
 *
 * Seams used, none of which require a production change:
 *   - callApiWorker calls global fetch → mock it to prove fall-through offline
 *   - the SDK is reached via `await import("./sdk-worker.mjs")` → vi.mock
 *   - a truthy apiProvider returns before spawnCliWorkerExecution → no child process
 *
 * Pins:
 *   (1) BYOK route taken; provider config + role guard applied on success.
 *   (2) BYOK_KEY_MISSING falls through to the direct API path.
 *   (3) an err.sdkError throw falls through.
 *   (4) any other throw propagates.
 *   (5) a registry entry mapped to null (xai) never consults the SDK.
 *   (6) copilotSdk "off" never consults the SDK.
 *   (7) the API role guard still rejects code-writing roles on the SDK path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runSdkSession = vi.fn();
vi.mock("../orchestrator/sdk-worker.mjs", () => ({
  runSdkSession: (...args) => runSdkSession(...args),
}));

const { spawnWorker } = await import("../orchestrator/worker-spawn.mjs");

const ENV_KEYS = ["OPENAI_API_KEY", "XAI_API_KEY"];

function writeForgeConfig(dir, copilotSdk) {
  writeFileSync(join(dir, ".forge.json"), JSON.stringify({ routing: { copilotSdk } }));
}

/** Minimal well-formed chat-completions payload so _buildApiSuccess can parse it. */
function apiResponse() {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content: "from-direct-api" } }], usage: {} }),
  };
}

describe("meta #267 — _spawnWorkerAsync BYOK / SDK routing", () => {
  let tempDir;
  let savedEnv;
  let fetchMock;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pforge-267-"));
    savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.OPENAI_API_KEY = "test-key-not-a-real-secret";
    process.env.XAI_API_KEY = "test-key-not-a-real-secret";
    runSdkSession.mockReset();
    fetchMock = vi.fn().mockResolvedValue(apiResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("(1) routes a DIRECT_API_ONLY model through the SDK with the mapped BYOK provider", async () => {
    writeForgeConfig(tempDir, "prefer");
    runSdkSession.mockResolvedValue({ output: "from-sdk", exitCode: 0 });

    const result = await spawnWorker("draw a cat", { model: "dall-e-3", cwd: tempDir, role: "image" });

    expect(result).toEqual({ output: "from-sdk", exitCode: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    const arg = runSdkSession.mock.calls[0][0];
    expect(arg.model).toBe("dall-e-3");
    expect(arg.provider).toEqual({ type: "openai", envKey: "OPENAI_API_KEY" });
  });

  it("(1) never passes a resolved API key to the SDK — only the env var name", async () => {
    writeForgeConfig(tempDir, "prefer");
    runSdkSession.mockResolvedValue({ output: "from-sdk", exitCode: 0 });

    await spawnWorker("draw a cat", { model: "dall-e-3", cwd: tempDir, role: "image" });

    const serialized = JSON.stringify(runSdkSession.mock.calls[0][0]);
    expect(serialized).not.toContain("test-key-not-a-real-secret");
  });

  it("(2) falls through to the direct API path on BYOK_KEY_MISSING", async () => {
    writeForgeConfig(tempDir, "prefer");
    runSdkSession.mockResolvedValue({ ok: false, error: "BYOK_KEY_MISSING", provider: "openai" });

    const result = await spawnWorker("draw a cat", { model: "dall-e-3", cwd: tempDir, role: "image" });

    expect(runSdkSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("from-direct-api");
  });

  it("(3) falls through to the direct API path when the SDK throws err.sdkError", async () => {
    writeForgeConfig(tempDir, "prefer");
    const err = new Error("sdk unavailable");
    err.sdkError = true;
    runSdkSession.mockRejectedValue(err);

    const result = await spawnWorker("draw a cat", { model: "dall-e-3", cwd: tempDir, role: "image" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.output).toContain("from-direct-api");
  });

  it("(4) propagates a non-sdkError throw instead of silently falling back", async () => {
    writeForgeConfig(tempDir, "prefer");
    runSdkSession.mockRejectedValue(new Error("programmer error"));

    await expect(
      spawnWorker("draw a cat", { model: "dall-e-3", cwd: tempDir, role: "image" }),
    ).rejects.toThrow(/programmer error/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("(5) a registry entry mapped to null (xai) never consults the SDK", async () => {
    writeForgeConfig(tempDir, "prefer");

    await spawnWorker("review this", { model: "grok-4.20", cwd: tempDir, role: "reviewer" });

    expect(runSdkSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("(6) copilotSdk 'off' keeps the direct API path and never consults the SDK", async () => {
    writeForgeConfig(tempDir, "off");

    await spawnWorker("draw a cat", { model: "dall-e-3", cwd: tempDir, role: "image" });

    expect(runSdkSession).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("(7) the API role guard rejects a code-writing role before any SDK call", async () => {
    writeForgeConfig(tempDir, "prefer");
    runSdkSession.mockResolvedValue({ output: "from-sdk", exitCode: 0 });

    // spawnWorker enforces the guard synchronously, before _spawnWorkerAsync is
    // reached — so this throws rather than returning a rejected promise.
    expect(() => spawnWorker("write code", { model: "dall-e-3", cwd: tempDir, role: "code" }))
      .toThrow(/cannot execute/i);
    expect(runSdkSession).not.toHaveBeenCalled();
  });
});
