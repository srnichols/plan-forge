import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStt } from "../src/stt.mjs";

const directories = [];

async function makeAudio() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-stt-"));
  directories.push(directory);
  const audioPath = path.join(directory, "voice.ogg");
  await writeFile(audioPath, "audio bytes");
  return audioPath;
}

async function doesNotExist(file) {
  await expect(readFile(file)).rejects.toMatchObject({ code: "ENOENT" });
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("speech-to-text provider", () => {
  it("does not read a key or fetch when voice capture is disabled", async () => {
    const audioPath = await makeAudio();
    const get = vi.fn();
    const fetch = vi.fn();
    const stt = createStt({
      config: { capture: { voice: { enabled: false } } },
      secrets: { get },
      fetch,
    });
    expect(await stt.transcribe({ audioPath })).toEqual({ ok: false, error: "STT_DISABLED" });
    expect(get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await doesNotExist(audioPath);
  });

  it("returns a redacted key-missing result without making a request", async () => {
    const audioPath = await makeAudio();
    const fetch = vi.fn();
    const stt = createStt({
      config: { capture: { voice: { enabled: true, provider: "openai" } } },
      secrets: { get: vi.fn(() => null) },
      fetch,
    });
    const result = await stt.transcribe({ audioPath });
    expect(result).toEqual({ ok: false, error: "BYOK_KEY_MISSING", provider: "openai" });
    expect(JSON.stringify(result)).not.toContain("sensitive-canary");
    expect(fetch).not.toHaveBeenCalled();
    await doesNotExist(audioPath);
  });

  it.each([
    ["openai", { text: "recognized words" }, "recognized words", "Authorization"],
    ["azure", { DisplayText: "Azure words" }, "Azure words", "Ocp-Apim-Subscription-Key"],
  ])("sends multipart audio and reads %s transcript responses", async (provider, body, expected, header) => {
    const audioPath = await makeAudio();
    const fetch = vi.fn(async () => ({ ok: true, json: async () => body }));
    const stt = createStt({
      config: {
        capture: { voice: { enabled: true, provider, endpoint: "https://stt.example/transcribe", model: "configured-model" } },
      },
      secrets: { get: vi.fn(() => "key-value") },
      fetch,
    });
    expect(await stt.transcribe({ audioPath, mimeType: "audio/ogg" })).toEqual({ ok: true, text: expected });
    const [endpoint, request] = fetch.mock.calls[0];
    expect(endpoint).toBe("https://stt.example/transcribe");
    expect(request.headers).toHaveProperty(header);
    expect(request.headers[header]).toContain(provider === "openai" ? "Bearer " : "key-value");
    if (provider === "openai") {
      expect(request.body.get("model")).toBe("configured-model");
      expect(request.body.get("file")).toBeInstanceOf(Blob);
    } else {
      expect(request.body.get("audio")).toBeInstanceOf(Blob);
      expect(request.body.get("definition")).toBe(JSON.stringify({ locales: ["en-US"] }));
    }
    await doesNotExist(audioPath);
  });

  it("does not expose a key echoed by a provider error response", async () => {
    const audioPath = await makeAudio();
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "sensitive-canary" }),
    }));
    const stt = createStt({
      config: {
        capture: { voice: { enabled: true, provider: "openai", endpoint: "https://stt.example/transcribe" } },
      },
      secrets: { get: vi.fn(() => "sensitive-canary") },
      fetch,
    });
    const result = await stt.transcribe({ audioPath });
    expect(result).toEqual({ ok: false, error: "STT_PROVIDER_ERROR", provider: "openai", status: 500 });
    expect(JSON.stringify(result)).not.toContain("sensitive-canary");
    await doesNotExist(audioPath);
  });

  it.each([
    ["provider error", async () => ({ ok: false, status: 503 })],
    ["fetch failure", async () => { throw new Error("transport details"); }],
  ])("deletes audio after a %s", async (_label, response) => {
    const audioPath = await makeAudio();
    const stt = createStt({
      config: {
        capture: { voice: { enabled: true, provider: "openai", endpoint: "https://stt.example/transcribe" } },
      },
      secrets: { get: vi.fn(() => "key-value") },
      fetch: vi.fn(response),
    });
    await stt.transcribe({ audioPath });
    await doesNotExist(audioPath);
  });

  it("falls back to the configured runtime endpoint and reads Azure phrase results", async () => {
    const audioPath = await makeAudio();
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ combinedPhrases: [{ text: "phrase transcript" }] }),
    }));
    const stt = createStt({
      config: {
        capture: { voice: { enabled: true, provider: "azure" } },
        runtimes: { byok: { azure: { endpoint: "https://stt.example/azure" } } },
      },
      secrets: { get: vi.fn(() => "azure-key") },
      fetch,
    });
    expect(await stt.transcribe({ audioPath })).toEqual({ ok: true, text: "phrase transcript" });
    expect(fetch.mock.calls[0][0]).toBe("https://stt.example/azure");
    await doesNotExist(audioPath);
  });

  it("returns an explicit empty transcript result", async () => {
    const audioPath = await makeAudio();
    const stt = createStt({
      config: {
        capture: { voice: { enabled: true, provider: "openai", endpoint: "https://stt.example/transcribe" } },
      },
      secrets: { get: vi.fn(() => "key-value") },
      fetch: vi.fn(async () => ({ ok: true, json: async () => ({ text: "  " }) })),
    });
    expect(await stt.transcribe({ audioPath })).toEqual({
      ok: false, error: "STT_EMPTY_TRANSCRIPT", provider: "openai",
    });
    await doesNotExist(audioPath);
  });
});
