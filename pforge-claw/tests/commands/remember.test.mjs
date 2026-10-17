import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import command from "../../src/commands/remember.mjs";
import { bindCaptureService, createCaptureService } from "../../src/handlers/capture-commands.mjs";
import { ClawError } from "../../src/errors.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const caller = { userId: "user-memory", role: "owner", channel: "telegram" };
const project = { id: "project-memory", homeLane: "local" };

async function fixture() {
  const directory = await mkdtemp(path.join(TEST_DIRECTORY, ".capture-remember-"));
  directories.push(directory);
  const context = {
    project,
    config: { instanceId: "instance-memory", projects: [project], allowlist: [caller] },
    store: createStore(directory),
    channel: { id: "telegram", send: vi.fn(async () => []) },
    mcp: { call: vi.fn(async () => ({ structuredContent: { id: "tool-memory" } })) },
    now: () => 1_800_000_000_000,
    idFactory: () => "capture-card",
  };
  return { context, service: createCaptureService(context) };
}

afterEach(async () => {
  bindCaptureService(null)();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("/remember command adapter", () => {
  it("is available and keeps real service proposal provenance until explicit confirmation", async () => {
    expect(command).toMatchObject({ available: true, mutating: false, sinceSlice: 7 });
    const { context, service } = await fixture();
    const args = {
      argsText: "fact", caller, chatId: "chat-memory", threadId: "topic-memory", updateId: "proposal:memory",
      adapter: "telegram", messageId: "proposal-message", origin: "untrusted",
      untrustedContext: [{ kind: "forward", source: "telegram", text: "fact" }],
    };
    await expect(command.handle.call({ service }, context, args)).resolves.toEqual([]);
    const pending = context.store.fold("memory-pending", (_latest, record) => record, null);
    expect(pending).toMatchObject({
      projectId: project.id, userId: caller.userId, chatId: args.chatId, threadId: args.threadId,
      updateId: "proposal:memory", text: "fact", origin: "untrusted", used: false,
    });
    expect(context.channel.send.mock.calls[0][0].text).toContain("untrusted memory");
    expect(context.mcp.call).not.toHaveBeenCalled();
  });

  it("delegates through the bound service and fails explicitly when unavailable", async () => {
    const { context, service } = await fixture();
    const unbind = bindCaptureService(service);
    await expect(command.handle(context, {
      argsText: "fact", caller, chatId: "chat-memory", threadId: "topic-memory",
    })).resolves.toEqual([]);
    expect(context.channel.send.mock.calls[0][0].text).toContain("trusted memory");
    expect(context.mcp.call).not.toHaveBeenCalled();
    unbind();
    await expect(command.handle({}, {})).rejects.toMatchObject(new ClawError("SERVICE_UNAVAILABLE"));
  });
});
