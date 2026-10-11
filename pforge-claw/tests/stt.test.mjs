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

function createAudioFs() {
  return {
    readFile: vi.fn(async () => Buffer.from("audio bytes")),
    unlink: vi.fn(async () => undefined),
  };
}

const CLEANUP_CANARY = "stt-cleanup-canary";
const KEY_CANARY = "stt-key-canary";

describe("STT extraction characterizations", () => {
  it("rejects unsupported providers before key access and still removes the audio", async () => {
    const fs = createAudioFs();
    const get = vi.fn();
    const fetch = vi.fn();
    const stt = createStt({
      config: { capture: { voice: { enabled: true, provider: "unsupported" } } },
      secrets: { get },
      fs,
      fetch,
    });
    expect(await stt.transcribe({ audioPath: "voice.ogg" })).toEqual({
      ok: false, error: "STT_UNSUPPORTED_PROVIDER", provider: "unsupported",
    });
    expect(get).not.toHaveBeenCalled();
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith("voice.ogg");
  });

  it.each([undefined, "", " ", 7])("preserves the missing endpoint guard for %s", async (endpoint) => {
    const fs = createAudioFs();
    const get = vi.fn(() => "sensitive-canary");
    const fetch = vi.fn();
    const stt = createStt({
      config: { capture: { voice: { enabled: true, provider: "openai", endpoint } } },
      secrets: { get },
      fs,
      fetch,
    });
    expect(await stt.transcribe({ audioPath: "voice.ogg" })).toEqual({
      ok: false, error: "STT_ENDPOINT_MISSING", provider: "openai",
    });
    expect(get).toHaveBeenCalledExactlyOnceWith("OPENAI_API_KEY");
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith("voice.ogg");
  });

  it("preserves the abort signal, MIME type and blank-model omission", async () => {
    const fs = createAudioFs();
    const signal = new AbortController().signal;
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ text: " words " }) }));
    const stt = createStt({
      config: {
        capture: { voice: { enabled: true, provider: "openai", endpoint: "https://stt.example/transcribe", model: " " } },
      },
      secrets: { get: vi.fn(() => "sensitive-canary") },
      fs,
      fetch,
    });
    expect(await stt.transcribe({ audioPath: "voice.ogg", mimeType: "audio/wav", signal }))
      .toEqual({ ok: true, text: "words" });
    const request = fetch.mock.calls[0][1];
    expect(request.signal).toBe(signal);
    expect(request.body.get("file").type).toBe("audio/wav");
    expect(request.body.get("model")).toBeNull();
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith("voice.ogg");
  });

  it.each([
    [{ text: " ", DisplayText: "not selected" }, { ok: false, error: "STT_EMPTY_TRANSCRIPT", provider: "azure" }],
    [{ text: 0, DisplayText: " display ", combinedPhrases: [{ text: "not selected" }] }, { ok: true, text: "display" }],
    [{ combinedPhrases: [{ text: " first " }, { text: "not selected" }] }, { ok: true, text: "first" }],
  ])("preserves transcript field precedence for %s", async (body, expected) => {
    const stt = createStt({
      config: { capture: { voice: { enabled: true, provider: "azure", endpoint: "https://stt.example/transcribe" } } },
      secrets: { get: vi.fn(() => "sensitive-canary") },
      fs: createAudioFs(),
      fetch: vi.fn(async () => ({ ok: true, json: async () => body })),
    });
    expect(await stt.transcribe({ audioPath: "voice.ogg" })).toEqual(expected);
  });

  it("keeps request failures neutral and attempts cleanup when reading audio fails", async () => {
    const fs = createAudioFs();
    fs.readFile.mockRejectedValueOnce(new Error("sensitive-canary"));
    const fetch = vi.fn();
    const stt = createStt({
      config: { capture: { voice: { enabled: true, provider: "openai", endpoint: "https://stt.example/transcribe" } } },
      secrets: { get: vi.fn(() => "sensitive-canary") },
      fs,
      fetch,
    });
    expect(await stt.transcribe({ audioPath: "voice.ogg" })).toEqual({ ok: false, error: "STT_REQUEST_FAILED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith("voice.ogg");
  });

  it("waits for cleanup and returns the cleanup flag without changing the primary result", async () => {
    const fs = createAudioFs();
    let rejectCleanup;
    fs.unlink.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCleanup = reject; }));
    const logger = { error: vi.fn() };
    const stt = createStt({ config: { capture: { voice: { enabled: false } } }, fs, logger });
    let hasResolved = false;
    const transcribing = stt.transcribe({ audioPath: "voice.ogg" }).then((result) => {
      hasResolved = true;
      return result;
    });
    await Promise.resolve();
    expect(hasResolved).toBe(false);
    rejectCleanup(Object.assign(new Error(CLEANUP_CANARY), { code: "EACCES" }));
    const result = await transcribing;
    expect(result).toEqual({ ok: false, error: "STT_DISABLED", cleanupFailed: true });
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("STT_AUDIO_CLEANUP_FAILED", { code: "STT_AUDIO_CLEANUP_FAILED" });
    expect(JSON.stringify({ result, logs: logger.error.mock.calls })).not.toContain(CLEANUP_CANARY);
  });
});

describe("STT cleanup reporting", () => {
  it.each([
    ["unsupported provider", { enabled: true, provider: "unsupported" }, undefined,
      { ok: false, error: "STT_UNSUPPORTED_PROVIDER", provider: "unsupported" }],
    ["missing key", { enabled: true, provider: "openai" }, undefined,
      { ok: false, error: "BYOK_KEY_MISSING", provider: "openai" }],
    ["missing endpoint", { enabled: true, provider: "openai" }, KEY_CANARY,
      { ok: false, error: "STT_ENDPOINT_MISSING", provider: "openai" }],
  ])("adds the existing cleanup flag without replacing the %s preflight result", async (_label, voice, key, primary) => {
    const fs = createAudioFs();
    fs.unlink.mockRejectedValueOnce(Object.assign(new Error(CLEANUP_CANARY), { code: "EACCES" }));
    const logger = { error: vi.fn() };
    const fetch = vi.fn();
    const stt = createStt({
      config: { capture: { voice } },
      secrets: { get: vi.fn(() => key) },
      fs,
      logger,
      fetch,
    });
    const result = await stt.transcribe({ audioPath: "voice.ogg" });
    expect(result).toEqual({ ...primary, cleanupFailed: true });
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith("voice.ogg");
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("STT_AUDIO_CLEANUP_FAILED", { code: "STT_AUDIO_CLEANUP_FAILED" });
    const output = JSON.stringify({ result, logs: logger.error.mock.calls });
    expect(output).not.toContain(CLEANUP_CANARY);
    expect(output).not.toContain(KEY_CANARY);
  });

  it.each(["openai", "azure"])("awaits cleanup and retains the successful %s transcript when unlink rejects", async (provider) => {
    const fs = createAudioFs();
    let rejectCleanup;
    let announceCleanup;
    const cleanupStarted = new Promise((resolve) => { announceCleanup = resolve; });
    fs.unlink.mockImplementationOnce(() => {
      announceCleanup();
      return new Promise((_resolve, reject) => { rejectCleanup = reject; });
    });
    const logger = { error: vi.fn() };
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => provider === "openai" ? { text: " words " } : { DisplayText: " words " },
    }));
    const stt = createStt({
      config: { capture: { voice: { enabled: true, provider, endpoint: "https://stt.example/transcribe" } } },
      secrets: { get: vi.fn(() => KEY_CANARY) },
      fs,
      logger,
      fetch,
    });
    let hasResolved = false;
    const transcribing = stt.transcribe({ audioPath: "voice.ogg" }).then((result) => {
      hasResolved = true;
      return result;
    });
    await cleanupStarted;
    expect(hasResolved).toBe(false);
    rejectCleanup(Object.assign(new Error(CLEANUP_CANARY), { code: "EACCES" }));
    const result = await transcribing;
    expect(result).toEqual({ ok: true, text: "words", cleanupFailed: true });
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith("voice.ogg");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith("STT_AUDIO_CLEANUP_FAILED", { code: "STT_AUDIO_CLEANUP_FAILED" });
    const output = JSON.stringify({ result, logs: logger.error.mock.calls });
    expect(output).not.toContain(CLEANUP_CANARY);
    expect(output).not.toContain(KEY_CANARY);
  });

  it.each([false, true])("does not flag or log ENOENT cleanup with voice enabled=%s", async (enabled) => {
    const fs = createAudioFs();
    fs.unlink.mockRejectedValueOnce(Object.assign(new Error(CLEANUP_CANARY), { code: "ENOENT" }));
    const logger = { error: vi.fn() };
    const stt = createStt({
      config: { capture: { voice: { enabled, provider: "openai", endpoint: "https://stt.example/transcribe" } } },
      secrets: { get: vi.fn(() => KEY_CANARY) },
      fs,
      logger,
      fetch: vi.fn(async () => ({ ok: true, json: async () => ({ text: "words" }) })),
    });
    expect(await stt.transcribe({ audioPath: "voice.ogg" }))
      .toEqual(enabled ? { ok: true, text: "words" } : { ok: false, error: "STT_DISABLED" });
    expect(fs.unlink).toHaveBeenCalledExactlyOnceWith("voice.ogg");
    expect(logger.error).not.toHaveBeenCalled();
  });
});
