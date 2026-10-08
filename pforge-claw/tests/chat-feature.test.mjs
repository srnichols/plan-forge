import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  channel: null,
  createAdapter: vi.fn(),
  createRouter: vi.fn(),
  createAskService: vi.fn(() => ({})),
  bindProposal: vi.fn(() => () => {}),
  syncMenus: vi.fn(async () => ({ ok: true })),
  route: vi.fn(async () => ({ handled: true })),
}));

vi.mock("../src/channels/telegram/poller.mjs", () => ({
  createTelegramAdapter: mocks.createAdapter,
}));
vi.mock("../src/handlers/ask.mjs", () => ({
  createAskService: mocks.createAskService,
}));
vi.mock("../src/callbacks/p.mjs", () => ({
  bindProposalService: mocks.bindProposal,
}));
vi.mock("../src/router.mjs", () => ({
  createRouter: mocks.createRouter,
}));
vi.mock("../src/commands/index.mjs", () => ({
  COMMANDS: [],
}));

const { default: chat } = await import("../src/features/chat.mjs");

afterEach(async () => {
  await chat.stop({});
  vi.clearAllMocks();
});

function setup({ mode = "poll", start = vi.fn(), stop = vi.fn(async () => {}) } = {}) {
  mocks.channel = { start, stop, send: vi.fn() };
  mocks.createAdapter.mockReturnValue(mocks.channel);
  mocks.createRouter.mockReturnValue({ route: mocks.route, syncMenus: mocks.syncMenus });
  return {
    config: { channels: { telegram: { mode, generalChat: { chatId: "general" } } }, projects: [] },
    secrets: { getSecret: () => "test-token", redact: (text) => text },
    home: "claw-home",
    store: {},
    logger: { error: vi.fn() },
    mcp: { closeAll: vi.fn() },
  };
}

describe("chat feature lifecycle", () => {
  it("poller keeps running while later features start", async () => {
    let finishPoll;
    const pollerStart = vi.fn(() => new Promise((resolve) => { finishPoll = resolve; }));
    const ctx = setup({ start: pollerStart });
    const laterStart = vi.fn();
    const laterFeature = { available: true, start: laterStart };
    const { createApp } = await import("../src/app.mjs");
    const app = createApp(ctx, { features: [chat, laterFeature] });
    await app.start();
    expect(pollerStart).toHaveBeenCalledOnce();
    expect(laterStart).toHaveBeenCalledOnce();
    finishPoll();
    await app.stop();
  });

  it("shared feature context exposes the channel and update handler to later features", async () => {
    const ctx = setup();
    let shared;
    const laterFeature = {
      available: true,
      start(value) { shared = value; },
    };
    const { createApp } = await import("../src/app.mjs");
    const app = createApp(ctx, { features: [chat, laterFeature] });
    await app.start();
    expect(shared.channel).toBe(mocks.channel);
    expect(shared.onTelegramUpdate).toBeTypeOf("function");
    await shared.onTelegramUpdate({ updateId: "u1" });
    expect(mocks.route).toHaveBeenCalledWith({ updateId: "u1" });
    await app.stop();
  });

  it("webhook mode never starts polling and stop awaits the channel", async () => {
    let finishStop;
    const stop = vi.fn(() => new Promise((resolve) => { finishStop = resolve; }));
    const ctx = setup({ mode: "webhook", start: vi.fn(), stop });
    await chat.start(ctx);
    expect(mocks.channel.start).not.toHaveBeenCalled();
    let stopped = false;
    const pending = chat.stop(ctx).then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finishStop();
    await pending;
    expect(stopped).toBe(true);
    expect(ctx.mcp.closeAll).not.toHaveBeenCalled();
  });

  it("handles poller rejection without rejecting feature startup", async () => {
    const ctx = setup({ start: () => Promise.reject(Object.assign(new Error("poll failed"), { code: "POLL_FAILED" })) });
    await expect(chat.start(ctx)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(ctx.logger.error).toHaveBeenCalledWith(
      "Telegram poller error", { code: "POLL_FAILED" },
    ));
  });
});
