import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/commands/index.mjs";
import { ClawError } from "../src/errors.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createStore } from "../src/state/store.mjs";
import { createRouter } from "../src/router.mjs";

const directories = [];
const project = (id, chatId, topicId) => ({
  id,
  name: `Project ${id}`,
  channel: { adapter: "telegram", chatId, topicId },
  repo: { path: `/repos/${id}` },
});

function makeConfig() {
  return {
    channels: { telegram: { botUsername: "clawbot", generalChat: { chatId: "general-chat", topicId: "general-topic" } } },
    allowlist: [
      { channel: "telegram", userId: "owner-id", role: "owner" },
      { channel: "telegram", userId: "approver-id", role: "approver" },
      { channel: "telegram", userId: "viewer-id", role: "viewer" },
    ],
    policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
    projects: [project("alpha", "project-chat", "project-topic"), project("beta", "other-chat", "project-topic")],
  };
}

function makeRig({ config = makeConfig(), commandRegistry, storeOverride } = {}) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "claw-router-"));
  directories.push(stateDir);
  const store = createStore(stateDir);
  const calls = [];
  const channel = {
    send: async (payload) => calls.push({ method: "send", ...payload }),
    answerCallback: async (payload) => calls.push({ method: "answerCallback", ...payload }),
    setMenu: async (commands, options) => calls.push({ method: "setMenu", commands, ...options }),
  };
  const router = createRouter({
    config,
    channel,
    store: storeOverride?.(store) ?? store,
    registry: createRegistry(config),
    logger: { error: vi.fn() },
    ...(commandRegistry ? { commandRegistry } : {}),
  });
  return { config, store, calls, channel, router };
}

function update(overrides = {}) {
  return {
    adapter: "telegram",
    updateId: "update-1",
    kind: "message",
    chatId: "project-chat",
    threadId: "project-topic",
    userId: "owner-id",
    text: "/help",
    callbackId: null,
    data: null,
    ...overrides,
  };
}

function auditRecords(store) {
  return [...store.read("audit")].map(({ record }) => record);
}

function availableCommands(handler = async () => ({ text: "ok" })) {
  return COMMANDS.map((command) => ({ ...command, available: true, handle: handler }));
}

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe("identity and topic router", () => {
  it("silent drop: unknown user ignores commands, free text and callbacks without channel calls", async () => {
    for (const value of [
      update({ text: "/help", userId: "stranger" }),
      update({ text: "private free text", userId: "stranger" }),
      update({ kind: "callback", text: null, data: "a:opaque", userId: "stranger" }),
    ]) {
      const rig = makeRig();
      await rig.router.route(value);
      expect(rig.calls).toEqual([]);
      const records = auditRecords(rig.store);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ kind: "drop", reason: "unknown-user" });
      expect(records[0]).not.toHaveProperty("text");
      expect(records[0]).not.toHaveProperty("data");
    }
  });

  it("silent drop: unknown chat", async () => {
    const rig = makeRig();
    await rig.router.route(update({ chatId: "unconfigured-chat" }));
    expect(rig.calls).toEqual([]);
    expect(auditRecords(rig.store)).toMatchObject([{ kind: "drop", reason: "unknown-chat" }]);
  });

  it("silent drop: missing sender", async () => {
    const rig = makeRig();
    await rig.router.route(update({ userId: null }));
    expect(rig.calls).toEqual([]);
    expect(auditRecords(rig.store)).toMatchObject([{ kind: "drop", reason: "missing-user" }]);
  });

  it("routes matching project topics, isolates equal thread ids across chats and resolves general dispatcher", async () => {
    const commandRegistry = availableCommands(async (ctx, args) => ({ text: `${ctx.scope}:${ctx.project?.id ?? "general"}:${args.argsText}` }));
    const rig = makeRig({ commandRegistry });
    await rig.router.route(update({ text: "hello", threadId: "project-topic" }));
    await rig.router.route(update({ text: "hello", chatId: "other-chat", threadId: "project-topic" }));
    await rig.router.route(update({ text: "/help", chatId: "general-chat", threadId: "general-topic" }));
    expect(rig.calls.filter(({ method }) => method === "send").map(({ text }) => text)).toEqual([
      "project:alpha:hello",
      "project:beta:hello",
      "general:general:",
    ]);
  });

  it("replies neutrally to unmapped topics and ignores free text in general", async () => {
    const rig = makeRig();
    await rig.router.route(update({ text: "/help", threadId: "unmapped-topic" }));
    await rig.router.route(update({ text: "not an ask", chatId: "general-chat", threadId: "general-topic" }));
    expect(rig.calls).toEqual([{ method: "send", chatId: "project-chat", threadId: "unmapped-topic", text: "This topic isn't configured." }]);
  });

  it("routes project free text through ask and ignores commands addressed to another bot", async () => {
    const askHandler = vi.fn(async (_ctx, args) => ({ text: args.argsText }));
    const commandRegistry = COMMANDS.map((command) => command.name === "ask"
      ? { ...command, available: true, handle: askHandler }
      : command);
    const rig = makeRig({ commandRegistry });
    await rig.router.route(update({ text: "question from project" }));
    await rig.router.route(update({ text: "/help@otherbot" }));
    expect(askHandler).toHaveBeenCalledOnce();
    expect(askHandler.mock.calls[0][1].argsText).toBe("question from project");
    expect(rig.calls.filter(({ method }) => method === "send").map(({ text }) => text)).toEqual(["question from project"]);
  });

  it("answers callback queries before ignoring unknown and unavailable prefixes", async () => {
    const rig = makeRig();
    await rig.router.route(update({ kind: "callback", text: null, data: "a:opaque:payload", callbackId: "cb-1" }));
    expect(rig.calls).toEqual([{ method: "answerCallback", callbackId: "cb-1" }]);
    expect(auditRecords(rig.store)).toMatchObject([{ kind: "callback-ignored", reason: "unavailable" }]);
    rig.calls.length = 0;
    await rig.router.route(update({ kind: "callback", text: null, data: "z:payload", callbackId: "cb-2" }));
    expect(rig.calls).toEqual([{ method: "answerCallback", callbackId: "cb-2" }]);
    expect(auditRecords(rig.store).at(-1)).toMatchObject({ kind: "callback-ignored", reason: "unknown-prefix" });
  });

  it("authorizes every command against every role, including byok-only mutating execution", async () => {
    const handler = vi.fn(async () => ({ text: "handled" }));
    const rig = makeRig({ commandRegistry: availableCommands(handler) });
    const users = { owner: "owner-id", approver: "approver-id", viewer: "viewer-id" };
    for (const command of COMMANDS) {
      for (const role of ["owner", "approver", "viewer"]) {
        rig.calls.length = 0;
        handler.mockClear();
        const topic = command.scope === "general" ? "general" : "project";
        const payload = topic === "general"
          ? { chatId: "general-chat", threadId: "general-topic" }
          : { chatId: "project-chat", threadId: "project-topic" };
        await rig.router.route(update({ ...payload, userId: users[role], text: `/${command.name}` }));
        const allowed = command.roles.includes(role);
        expect(handler).toHaveBeenCalledTimes(allowed ? 1 : 0);
        if (!allowed) expect(rig.calls.find(({ method }) => method === "send")?.text).toContain("Your role can't run");
        if (allowed && command.mutating && role === "approver") {
          expect(handler.mock.calls[0][1].constraint).toBe("byok-only");
        }
      }
    }
    const realRig = makeRig();
    await realRig.router.route(update({ text: "/run" }));
    expect(realRig.calls[0].text).toBe("/run isn't available yet.");
  });

  it("refuses non-owner mutating execution when byok-only is disabled", async () => {
    const config = makeConfig();
    config.policy.nonOwnerRuntime = "shared";
    const handler = vi.fn();
    const commands = availableCommands(handler);
    const rig = makeRig({ config, commandRegistry: commands });
    await rig.router.route(update({ userId: "approver-id", text: "/run" }));
    expect(handler).not.toHaveBeenCalled();
    expect(rig.calls[0].text).toBe("/run requires an approved runtime.");
    expect(auditRecords(rig.store).at(-1)).toMatchObject({ kind: "refused", reason: "runtime-policy" });
  });

  it("suggests only visible commands for an unknown token", async () => {
    const commands = COMMANDS.map((command) => command.name === "status"
      ? { ...command, available: true }
      : command);
    const rig = makeRig({ commandRegistry: commands });
    await rig.router.route(update({ text: "/stauts" }));
    expect(rig.calls[0].text).toContain("Did you mean /status?");
  });

  it("does not run a command when its accepted-command audit fails", async () => {
    const handler = vi.fn();
    const rig = makeRig({
      commandRegistry: COMMANDS.map((command) => command.name === "help" ? { ...command, handle: handler } : command),
      storeOverride: (store) => ({ ...store, append: () => { throw new Error("audit failed"); } }),
    });
    await rig.router.route(update());
    expect(handler).not.toHaveBeenCalled();
    expect(rig.calls[0].text).toBe("Audit unavailable; command not run.");
  });

  it("returns only a generic error code and never exposes a handler stack", async () => {
    const handler = async () => {
      const error = new ClawError("TEST_FAILURE");
      error.stack = "private-stack-marker";
      throw error;
    };
    const rig = makeRig({
      commandRegistry: COMMANDS.map((command) => command.name === "help" ? { ...command, handle: handler } : command),
    });
    await rig.router.route(update());
    expect(rig.calls[0].text).toBe("TEST_FAILURE: The command could not be completed.");
    expect(rig.calls[0].text).not.toContain("private-stack-marker");
  });
});
