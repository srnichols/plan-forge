import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chat from "../src/features/chat.mjs";
import capture from "../src/features/capture.mjs";
import memory from "../src/features/memory.mjs";
import { bindApprovalService, createApprovalService } from "../src/approvals.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";
import { normalize } from "../src/channels/telegram/poller.mjs";
import { c2Fixture, cleanupC2Fixtures } from "./c2-fixtures.mjs";

const edge = vi.hoisted(() => ({ createAdapter: vi.fn() }));
vi.mock("../src/channels/telegram/poller.mjs", async (importOriginal) => ({
  ...await importOriginal(), createTelegramAdapter: edge.createAdapter,
}));

const contexts = [];
const unbinders = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T15:00:00.000Z"));
});
afterEach(async () => {
  for (const unbind of unbinders.splice(0)) unbind();
  for (const ctx of contexts.splice(0)) {
    await memory.stop(ctx);
    await capture.stop(ctx);
    await chat.stop(ctx);
  }
  vi.useRealTimers();
  await cleanupC2Fixtures();
  edge.createAdapter.mockReset();
});

async function startChat(options = {}) {
  const f = await c2Fixture(options);
  const channel = { ...f.channel, start: vi.fn(), stop: vi.fn(async () => {}) };
  edge.createAdapter.mockReturnValue(channel);
  f.config.channels.telegram.mode = "webhook";
  const ctx = {
    config: f.config, store: f.store, mcp: f.clients, secrets: f.secrets, home: f.root,
    projectRegistry: f.registry, services: f.services, bus: new EventEmitter(), now: Date.now,
    features: [chat, capture, memory], logger: { error: vi.fn(), warn: vi.fn() },
  };
  contexts.push(ctx);
  await chat.start(ctx);
  return { ...f, channel, ctx, receive: (update) => ctx.onTelegramUpdate(update) };
}

function telegramUpdate(f, { id = 1, text, callback, userId = f.caller.userId, messageId = "original-card" } = {}) {
  const message = {
    message_id: messageId, chat: { id: f.deps.chatId }, message_thread_id: f.deps.threadId,
    from: { id: userId }, text,
  };
  return normalize(callback ? {
    update_id: id,
    callback_query: { id: `callback-${id}`, from: { id: userId }, data: callback, message },
  } : { update_id: id, message });
}

describe("C2 real feature/registry with external channel and MCP edges", () => {
  it("retains Ask update identity through the real bound command and records one outcome across receipt retry", async () => {
    const f = await startChat();
    f.channel.edit.mockRejectedValueOnce(new Error("receipt unavailable"));
    const update = telegramUpdate(f, { text: "/ask Explain the phase" });
    await f.receive(update);
    await f.receive(update);
    expect(f.clients.call.mock.calls.filter(([, tool]) => tool === "forge_master_ask")).toHaveLength(1);
    expect([...f.store.read("budget")]).toHaveLength(1);
    const args = f.clients.call.mock.calls[0][2];
    expect(args.caller).toMatchObject({ projectId: f.project.id, topic: f.deps.threadId, role: "owner" });
  });

  it("delivers real ambiguous-plan keyboards, callback success and original selection/quorum across restart", async () => {
    const f = await startChat({ names: ["Phase-1-PLAN.md", "Phase-2-PLAN.md"] });
    await f.receive(telegramUpdate(f, { text: "/run Phase power" }));
    const card = f.channel.send.mock.calls.at(-1)[0];
    const callback = card.replyMarkup.inline_keyboard[0][0].callback_data;
    expect(callback).toMatch(/^s:/);
    await f.receive(telegramUpdate(f, { id: 2, callback }));
    expect(f.channel.send.mock.calls.at(-1)[0].text).toContain("awaiting approval");
    const original = Object.values(currentJobs(f.store))[0];
    expect(original).toMatchObject({ updateId: "1", quorum: "power", callerRole: "owner" });
    await chat.stop(f.ctx);
    f.ctx.store = createStore(f.stateDirectory);
    f.ctx.services = { ...f.services, store: f.ctx.store, pending: new Map() };
    await chat.start(f.ctx);
    await f.receive(telegramUpdate(f, { id: 3, callback }));
    expect(Object.values(currentJobs(f.ctx.store))).toHaveLength(1);
  });

  it("passes the original callback messageId to real approval edits without duplicate channel sends", async () => {
    const f = await startChat();
    await f.receive(telegramUpdate(f, { text: "/task Inspect the fixture" }));
    const job = Object.values(currentJobs(f.store))[0];
    const service = createApprovalService({
      config: f.config, store: f.store, bus: f.ctx.bus, channel: f.channel, now: Date.now,
    });
    unbinders.push(bindApprovalService(service));
    const approval = service.createApproval(job);
    service.issue(job, { approval });
    f.channel.send.mockClear();
    await f.receive(telegramUpdate(f, { id: 2, callback: approval.approve, messageId: "original-approval-card" }));
    expect(f.channel.edit).toHaveBeenCalledWith(expect.objectContaining({ messageId: "original-approval-card" }));
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it("completes a real proposal-target plan selection originating in configured general", async () => {
    const f = await startChat({ names: ["Phase-1-PLAN.md", "Phase-2-PLAN.md"] });
    f.store.append("proposals", {
      id: "general-proposal", project: f.project.id, chatId: f.deps.chatId, topicId: "general-topic",
      action: { type: "plan", args: { plan: "Phase", quorum: "speed" } },
      expiresAt: Date.now() + 60_000, used: false,
    });
    const tap = telegramUpdate(f, { callback: "p:general-proposal" });
    tap.threadId = "general-topic";
    await f.receive(tap);
    const selection = f.channel.send.mock.calls.at(-1)[0].replyMarkup.inline_keyboard[0][0].callback_data;
    const choose = telegramUpdate(f, { id: 2, callback: selection });
    choose.threadId = "general-topic";
    await f.receive(choose);
    expect(Object.values(currentJobs(f.store))).toHaveLength(1);
    expect(Object.values(currentJobs(f.store))[0]).toMatchObject({
      projectId: f.project.id, chatId: f.deps.chatId, threadId: "general-topic",
      updateId: "proposal:general-proposal", quorum: "speed",
    });
  });

  it("invokes actual proposed remember and preserves untrusted provenance through explicit type confirmation", async () => {
    const f = await startChat();
    await capture.start(f.ctx);
    await memory.start(f.ctx);
    f.clients.call.mockImplementation(async (_projectId, tool) => {
      if (tool === "forge_master_ask") return {
        reply: "A capture was proposed", proposedActions: [
          { type: "remember", args: { text: "Untrusted fixture fact" }, origin: "untrusted" },
        ],
      };
      return { ok: true, status: "captured", id: "fixture-capture" };
    });
    await f.receive(telegramUpdate(f, { text: "/ask Propose a capture" }));
    const proposed = f.channel.edit.mock.calls.at(-1)[0].replyMarkup.inline_keyboard[0][0].callback_data;
    await f.receive(telegramUpdate(f, { id: 2, callback: proposed }));
    const typeCard = f.channel.send.mock.calls.at(-1)[0];
    const chooseType = typeCard.replyMarkup.inline_keyboard[0][0].callback_data;
    expect(chooseType).toMatch(/^m:/);
    expect(typeCard.text).toContain("Untrusted fixture fact");
    expect(typeCard.text).toMatch(/untrusted|confirm|⚠/i);
    expect([...f.store.read("proposals")].at(-1).record.used).toBe(true);
    expect(f.clients.call.mock.calls.filter(([, tool]) => tool === "forge_memory_capture")).toHaveLength(0);
    f.config.allowlist = [{ ...f.caller, role: "viewer" }];
    await f.receive(telegramUpdate(f, { id: 3, callback: chooseType }));
    expect(f.clients.call.mock.calls.filter(([, tool]) => tool === "forge_memory_capture")).toHaveLength(0);
    f.config.allowlist = [f.caller];
    await f.receive(telegramUpdate(f, { id: 4, callback: chooseType }));
    await f.receive(telegramUpdate(f, { id: 5, callback: chooseType }));
    expect(f.clients.call.mock.calls.filter(([, tool]) => tool === "forge_memory_capture")).toHaveLength(1);
    const [, , args] = f.clients.call.mock.calls.find(([, tool]) => tool === "forge_memory_capture");
    expect(JSON.stringify(args)).toContain("untrusted");
    expect(JSON.stringify(args)).not.toContain(f.caller.userId);
  });

  it("routes normalized links as untrusted triage rather than trusted Ask; unknown callers remain silent and body-free in audit", async () => {
    const f = await startChat();
    await capture.start(f.ctx);
    await f.receive(telegramUpdate(f, { text: "https://example.com/private-body-marker" }));
    expect(f.clients.call).not.toHaveBeenCalled();
    expect(f.channel.send.mock.calls.at(-1)[0].replyMarkup.inline_keyboard).toBeDefined();
    f.channel.send.mockClear();
    f.channel.answerCallback.mockClear();
    await f.receive(telegramUpdate(f, { id: 2, userId: "not-allowlisted", text: "private-body-marker" }));
    await f.receive(telegramUpdate(f, { id: 3, userId: "not-allowlisted", callback: "p:private-body-marker" }));
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.channel.answerCallback).not.toHaveBeenCalled();
    expect(JSON.stringify([...f.store.read("audit")].map(({ record }) => record))).not.toContain("private-body-marker");
  });
});
