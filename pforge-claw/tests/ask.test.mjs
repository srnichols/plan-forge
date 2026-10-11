import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import askCommand from "../src/commands/ask.mjs";
import newCommand from "../src/commands/new.mjs";
import proposalCallback, { bindProposalService } from "../src/callbacks/p.mjs";
import { createApp } from "../src/app.mjs";
import { createAskService } from "../src/handlers/ask.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];

async function makeStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claw-ask-"));
  directories.push(directory);
  return createStore(directory);
}

function makeContext(store, {
  result = { reply: "Here is the answer.", sessionId: "session-1" },
  mcpCall,
  features = [],
} = {}) {
  const events = [];
  const channel = {
    id: "telegram",
    typing: vi.fn(async () => { events.push("typing"); }),
    send: vi.fn(async (message) => {
      events.push(`send:${message.text}`);
      return [{ chatId: "chat-1", messageId: "placeholder-1", threadId: "topic-1" }];
    }),
    edit: vi.fn(async (message) => { events.push(`edit:${message.text}`); }),
  };
  const ctx = {
    mcp: { call: mcpCall ?? vi.fn(async (_projectId, _tool, args) => {
      events.push("mcp");
      return typeof result === "function" ? result(args) : result;
    }) },
    store,
    channel,
    config: {
      projects: [{
        id: "project-1", displayName: "Test Project",
        channel: { adapter: "telegram", chatId: "chat-1", topicId: "topic-1" },
      }],
      allowlist: [{ channel: "telegram", userId: "user-1", role: "owner" }],
    },
    logger: { error: vi.fn(), warn: vi.fn() },
    secrets: { redact: (value) => String(value).replaceAll("sensitive-canary", "[redacted]") },
    features,
    events,
  };
  return ctx;
}

function askInput(overrides = {}) {
  return {
    project: { id: "project-1", displayName: "Test Project", visibility: "restricted" },
    caller: { userId: "user-1", role: "owner" },
    chatId: "chat-1",
    threadId: "topic-1",
    text: "What changed?",
    ...overrides,
  };
}

async function recordProposal(store, {
  id = "proposal-1",
  action = { type: "task", args: { description: "Run the task" } },
  chatId = "chat-1",
  topicId = "topic-1",
  expiresAt = Date.now() + 60_000,
  used = false,
} = {}) {
  store.append("proposals", {
    v: 1, id, project: "project-1", chatId, topicId, action, untrusted: false, expiresAt, used,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T21:00:00.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Forge-Master ask service", () => {
  it("sends typing and a placeholder first, bounds the snapshot, chunks the reply, and attaches proposals last", async () => {
    const store = await makeStore();
    const ctx = makeContext(store, {
      result: {
        reply: `${"A long grounded answer. ".repeat(240)} sensitive-canary`,
        sessionId: "session-1",
        usage: { tokensIn: 20, costUsd: null },
        proposedActions: [
          { type: "task", args: { description: "Do this" }, origin: "untrusted" },
        ],
      },
      features: [{
        name: "large",
        available: true,
        snapshot: () => ({ entries: ["safe", "secret"], tokenValue: "must-not-leak", rawMessage: "hidden" }),
      }],
    });
    const originalCall = ctx.mcp.call;
    ctx.mcp.call = vi.fn(async (...args) => {
      ctx.events.push("mcp");
      return originalCall(...args);
    });
    const service = createAskService(ctx);

    expect(await service.ask(askInput())).toEqual([]);
    expect(ctx.events.slice(0, 3)).toEqual(["typing", "send:Thinking…", "mcp"]);
    expect(ctx.mcp.call).toHaveBeenCalledOnce();
    const [projectId, tool, args] = ctx.mcp.call.mock.calls[0];
    expect(projectId).toBe("project-1");
    expect(tool).toBe("forge_master_ask");
    expect(args).toMatchObject({
      message: "What changed?",
      caller: {
        role: "owner",
        channel: "chat",
        surface: "telegram",
        projectId: "project-1",
        topic: "topic-1",
      },
      responseFormat: { style: "brief", maxChars: 3500 },
      proposeActions: true,
    });
    expect(args).not.toHaveProperty("untrustedContext");
    expect(Buffer.byteLength(JSON.stringify(args.contextBlocks[0]), "utf8")).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(args.contextBlocks[0])).not.toContain("must-not-leak");
    expect(ctx.channel.edit).toHaveBeenCalledOnce();
    expect(ctx.channel.send.mock.calls.slice(1).length).toBeGreaterThan(0);
    const finalSend = ctx.channel.send.mock.calls.at(-1)[0];
    expect(finalSend.replyMarkup.inline_keyboard[0][0].callback_data).toMatch(/^p:/);
    expect(Buffer.byteLength(finalSend.replyMarkup.inline_keyboard[0][0].callback_data, "utf8")).toBeLessThanOrEqual(64);
    expect(finalSend.replyMarkup.inline_keyboard[0][0].text).toMatch(/^⚠️ /);
    expect(JSON.stringify([
      ...ctx.channel.send.mock.calls,
      ...ctx.channel.edit.mock.calls,
    ])).not.toContain("sensitive-canary");
    expect([...store.read("budget")].map(({ record }) => record.usage)[0]).toMatchObject({
      tokensIn: 20,
      tokensOut: null,
      model: null,
      costUsd: null,
    });
    expect([...store.read("sessions")].map(({ record }) => record.sessionId)).toEqual(["session-1"]);
  });

  it("reuses, resets, and reloads append-only sessions", async () => {
    const store = await makeStore();
    const calls = [];
    const ctx = makeContext(store, {
      mcpCall: vi.fn(async (_project, _tool, args) => {
        calls.push(args);
        return { reply: "ok", sessionId: `session-${calls.length}` };
      }),
    });
    let service = createAskService(ctx);
    await service.ask(askInput());
    service = createAskService(ctx);
    await service.ask(askInput());
    expect(calls[1].sessionId).toBe("session-1");
    await service.resetSession({ project: askInput().project, chatId: "chat-1", threadId: "topic-1" });
    await service.ask(askInput());
    expect(calls[2]).not.toHaveProperty("sessionId");
    expect(service.getSession("chat-1", "topic-1")).toBe("session-3");
    expect([...store.read("sessions")]).toHaveLength(4);
    expect(askCommand.available).toBe(true);
    expect(newCommand.available).toBe(true);
  });

  it("keeps a reset that is queued behind a slow answer", async () => {
    const store = await makeStore();
    let resolveCall;
    const pendingCall = new Promise((resolve) => { resolveCall = resolve; });
    const ctx = makeContext(store, { mcpCall: vi.fn(async () => pendingCall) });
    const service = createAskService(ctx);
    const asking = service.ask(askInput());
    for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
    expect(ctx.mcp.call).toHaveBeenCalledOnce();
    const resetting = service.resetSession({ project: askInput().project, chatId: "chat-1", threadId: "topic-1" });
    resolveCall({ reply: "late answer", sessionId: "late-session" });
    await Promise.all([asking, resetting]);
    expect(service.getSession("chat-1", "topic-1")).toBeNull();
    expect([...store.read("sessions")].at(-1).record.sessionId).toBeNull();
  });

  it("logs failed usage writes and marks the answer", async () => {
    const store = await makeStore();
    const append = store.append;
    store.append = (stream, record) => {
      if (stream === "budget") throw new Error("usage storage failed");
      return append(stream, record);
    };
    const ctx = makeContext(store, { result: { reply: "Answer.", usage: { tokensIn: 1 } } });
    await createAskService(ctx).ask(askInput());
    expect(ctx.logger.error).toHaveBeenCalledOnce();
    expect(ctx.channel.edit.mock.calls.at(-1)[0].text).toContain("(usage not recorded)");
  });

  it.each([
    ["tool error", { error: "TOOL_FAILED" }, "MCP_TOOL_ERROR"],
    ["transport error", new Error("socket closed"), "MCP_TRANSPORT_ERROR"],
    ["not installed", { error: "pforge-master not installed" }, "Forge-Master isn't installed"],
    ["empty answer", { reply: "" }, "Forge-Master returned an empty answer"],
  ])("renders a friendly response for %s", async (_label, outcome, expected) => {
    const store = await makeStore();
    const ctx = makeContext(store, {
      mcpCall: vi.fn(async () => {
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }),
    });
    const service = createAskService(ctx);
    expect(await service.ask(askInput())).toEqual([]);
    const edited = ctx.channel.edit.mock.calls.map(([message]) => message.text).join("\n");
    expect(edited).toContain(expected);
  });

  it("adds Forge-Master's no-actions message when the response has no proposals", async () => {
    const store = await makeStore();
    const ctx = makeContext(store, {
      result: { reply: "Answer.", proposedActions: [], proposedActionsMessage: "No actions proposed." },
    });
    await createAskService(ctx).ask(askInput());
    expect(ctx.channel.edit.mock.calls.at(-1)[0].text).toContain("No actions proposed.");
  });

  it("rejects unknown, expired, and cross-topic proposals", async () => {
    const store = await makeStore();
    const ctx = makeContext(store);
    const service = createAskService(ctx);
    await expect(service.runProposal({ id: "missing", caller: askInput().caller, chatId: "chat-1", threadId: "topic-1" })).resolves.toEqual([]);
    await recordProposal(store, { id: "expired", expiresAt: Date.now() - 1 });
    await service.runProposal({ id: "expired", caller: askInput().caller, chatId: "chat-1", threadId: "topic-1" });
    await recordProposal(store, { id: "other-topic", topicId: "topic-2" });
    await service.runProposal({ id: "other-topic", caller: askInput().caller, chatId: "chat-1", threadId: "topic-1" });
    const messages = ctx.channel.send.mock.calls.map(([message]) => message.text);
    expect(messages).toContain("This proposed action was not found.");
    expect(messages).toContain("This proposed action has expired.");
    expect(messages).toContain("This proposed action belongs to a different chat or topic.");
  });

  it("does not run unavailable commands and dispatches an eligible proposal only once", async () => {
    const store = await makeStore();
    const ctx = makeContext(store);
    const service = createAskService(ctx);
    const unavailable = vi.fn();
    await recordProposal(store, { id: "unavailable" });
    await service.runProposal({
      id: "unavailable",
      caller: askInput().caller,
      chatId: "chat-1",
      threadId: "topic-1",
      commands: [{ name: "task", available: false, roles: ["owner"], scope: "project", handle: unavailable }],
    });
    expect(unavailable).not.toHaveBeenCalled();

    await recordProposal(store, { id: "once" });
    const handle = vi.fn(async () => ({ text: "Queued for approval." }));
    const input = {
      id: "once",
      caller: askInput().caller,
      chatId: "chat-1",
      threadId: "topic-1",
      commands: [{ name: "task", available: true, roles: ["owner"], scope: "project", handle }],
    };
    await service.runProposal(input);
    await service.runProposal(input);
    expect(handle).toHaveBeenCalledOnce();
    expect(handle.mock.calls[0][1]).toMatchObject({ argsText: "Run the task", chatId: "chat-1" });
    expect(ctx.channel.send.mock.calls.map(([message]) => message.text)).toContain("Queued for approval.");
  });

  it("fails closed and audits callback taps when no proposal service is bound", async () => {
    const auditProposalTap = vi.fn();
    const unbind = bindProposalService({ runProposal: vi.fn(), auditProposalTap });
    unbind();
    await proposalCallback.handle({}, { payload: "not-found", chatId: "chat-1", threadId: "topic-1" });
    expect(auditProposalTap).toHaveBeenCalledWith({ chatId: "chat-1", threadId: "topic-1", id: "not-found" });
  });

  it("rolls back previously started features when startup fails", async () => {
    const calls = [];
    const app = createApp({}, {
      features: [
        { available: true, start: async () => calls.push("start-first"), stop: async () => calls.push("stop-first") },
        { available: true, start: async () => { calls.push("start-second"); throw new Error("startup failed"); } },
      ],
    });
    await expect(app.start()).rejects.toThrow("startup failed");
    expect(calls).toEqual(["start-first", "start-second", "stop-first"]);
  });
});
