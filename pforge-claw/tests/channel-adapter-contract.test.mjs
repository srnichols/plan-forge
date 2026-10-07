import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertChannelAdapter, runChannelAdapterContract } from "../src/channels/channel-adapter.mjs";
import { createTelegramAdapter } from "../src/channels/telegram/poller.mjs";
import { startFakeTelegram } from "./helpers/fake-telegram.mjs";

const TOKEN = "test-token-canary";
const directories = [];
let fake;

function makeAdapter() {
  const stateDir = mkdtempSync(join(tmpdir(), "claw-contract-"));
  directories.push(stateDir);
  return createTelegramAdapter({
    config: { channels: { telegram: { apiBase: fake.apiBase } } },
    secrets: { getSecret: () => TOKEN, redact: (value) => String(value) },
    stateDir,
    onUpdate: vi.fn(),
    signals: new (class {
      listeners = new Map();
      on(name, handler) { this.listeners.set(name, handler); }
      off(name) { this.listeners.delete(name); }
    })(),
  });
}

beforeAll(async () => {
  fake = await startFakeTelegram();
});

afterAll(async () => {
  await fake.close();
  directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

runChannelAdapterContract({ describe, it, expect, makeAdapter });

describe("channel adapter validation", () => {
  it("reports missing methods and limits", () => {
    try {
      assertChannelAdapter({ start() {} });
      throw new Error("expected adapter validation");
    } catch (error) {
      expect(error.code).toBe("CHANNEL_ADAPTER_INVALID");
      expect(error.details.missing).toContain("send");
      expect(error.details.missing).toContain("limits");
    }
  });

  it("accepts a complete channel adapter", () => {
    const adapter = makeAdapter();
    expect(assertChannelAdapter(adapter)).toBe(adapter);
  });
});
