import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCaptureService } from "../src/handlers/capture-commands.mjs";
import memoryCallback from "../src/callbacks/m.mjs";
import { createStore } from "../src/state/store.mjs";

const directories = [];
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const project = {
  id: "project-1",
  displayName: "Project One",
  homeLane: "home lane",
  visibility: "restricted",
};
const caller = { userId: "user-secret-id", role: "owner" };

async function makeStore() {
  const directory = await mkdtemp(path.join(TEST_DIRECTORY, ".capture-commands-"));
  directories.push(directory);
  return createStore(directory);
}

function makeContext(store, { outcome, mcpCall, projectConfig = project } = {}) {
  let sequence = 0;
  const channel = { send: vi.fn(async () => []) };
  const config = {
    instanceId: "instance/one",
    allowlist: [{ userId: caller.userId, role: "owner", alias: "operator" }],
    projects: [projectConfig],
  };
  const mcp = {
    call: mcpCall ?? vi.fn(async () => {
      if (typeof outcome === "function") return outcome();
      return outcome ?? { structuredContent: { id: "memory-123" } };
    }),
  };
  return {
    service: createCaptureService({
      mcp,
      store,
      channel,
      config,
      secrets: { redact: (value) => String(value).replaceAll("sensitive-canary", "[redacted]") },
      now: () => Date.now(),
      idFactory: () => `id-${++sequence}`,
      logger: { error: vi.fn() },
    }),
    channel,
    config,
    mcp,
  };
}

function input(text, overrides = {}) {
  return {
    project,
    caller,
    chatId: "chat-1",
    threadId: "topic-1",
    updateId: "update-1",
    text,
    ...overrides,
  };
}

async function startPending(service, text = "Capture this fact") {
  await service.startRemember(input(text));
  return "id-1";
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T21:00:00.000Z"));
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("memory and idea capture service", () => {
  it("offers five bounded type buttons and performs no MCP call before a selection", async () => {
    const store = await makeStore();
    const { service, mcp, channel } = makeContext(store);
    await service.startRemember(input("A saved fact"));
    const message = channel.send.mock.calls[0][0];
    const buttons = message.replyMarkup.inline_keyboard.flat();
    expect(buttons).toHaveLength(5);
    expect(buttons.map(({ callback_data: data }) => data)).toEqual(
      Array.from({ length: 5 }, (_value, index) => `m:id-1:${index}`),
    );
    expect(buttons.every(({ callback_data: data }) => Buffer.byteLength(data, "utf8") <= 64)).toBe(true);
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it.each([
    ["decision", 0, "restricted"],
    ["lesson", 1, "restricted"],
    ["convention", 2, "restricted"],
    ["pattern", 3, "restricted"],
    ["gotcha", 4, "restricted"],
  ])("captures %s with trusted provenance and the configured visibility", async (type, index, visibility) => {
    const store = await makeStore();
    const { service, mcp, channel } = makeContext(store);
    await startPending(service);
    await service.completeRemember({
      payload: `id-1:${index}`, caller, chatId: "chat-1", threadId: "topic-1",
    });
    expect(mcp.call).toHaveBeenCalledWith("project-1", "forge_memory_capture", {
      content: "Capture this fact",
      type,
      origin: "trusted",
      project: "project-1",
      visibility,
      source: "pforge-claw/instance-one/home-lane/remember",
      created_by: "pforge-claw:operator",
      tags: ["pforge-claw"],
    });
    expect(mcp.call.mock.calls[0][2]).not.toHaveProperty("userId");
    expect(JSON.stringify(mcp.call.mock.calls[0][2])).not.toContain(caller.userId);
    expect(channel.send.mock.calls.at(-1)[0].text).toContain("Saved");
  });

  it("defaults invalid visibility to normal and never uses an alias equal to the caller id", async () => {
    const store = await makeStore();
    const invalidProject = { ...project, visibility: "unknown" };
    const { service, mcp, config } = makeContext(store, { projectConfig: invalidProject });
    config.allowlist[0].alias = caller.userId;
    await startPending(service);
    await service.completeRemember({
      payload: "id-1:0", caller, chatId: "chat-1", threadId: "topic-1",
    });
    expect(mcp.call.mock.calls[0][2]).toMatchObject({
      visibility: "normal",
      created_by: "pforge-claw:owner",
    });
  });

  it.each([
    ["expired", { advance: 15 * 60 * 1000 + 1 }, "expired"],
    ["wrong user", { caller: { userId: "other", role: "owner" } }, "different user"],
    ["wrong chat", { chatId: "other-chat" }, "different user"],
    ["wrong topic", { threadId: "other-topic" }, "different user"],
    ["invalid index", { payload: "id-1:5" }, "Invalid selection"],
  ])("rejects %s selections without an MCP call", async (_label, overrides, message) => {
    const store = await makeStore();
    const { service, mcp, channel } = makeContext(store);
    await startPending(service);
    if (overrides.advance) vi.advanceTimersByTime(overrides.advance);
    const { advance, ...callOverrides } = overrides;
    await service.completeRemember({
      payload: callOverrides.payload ?? "id-1:0",
      caller: callOverrides.caller ?? caller,
      chatId: callOverrides.chatId ?? "chat-1",
      threadId: callOverrides.threadId ?? "topic-1",
    });
    expect(mcp.call).not.toHaveBeenCalled();
    expect(channel.send.mock.calls.at(-1)[0].text.toLowerCase()).toContain(message.toLowerCase());
  });

  it("allows one write across repeated or concurrent taps and replays the receipt", async () => {
    const store = await makeStore();
    let resolveCall;
    const mcpCall = vi.fn(() => new Promise((resolve) => { resolveCall = resolve; }));
    const { service, mcp, channel } = makeContext(store, { mcpCall });
    await startPending(service);
    const selection = { payload: "id-1:0", caller, chatId: "chat-1", threadId: "topic-1" };
    const first = service.completeRemember(selection);
    await Promise.resolve();
    const second = service.completeRemember(selection);
    resolveCall({ structuredContent: { id: "record-42" } });
    await Promise.all([first, second]);
    await service.completeRemember(selection);
    expect(mcp.call).toHaveBeenCalledOnce();
    expect(channel.send.mock.calls.at(-1)[0].text).toContain("record-42");
  });

  it("does not claim an id when forge_memory_capture returns only instructions", async () => {
    const store = await makeStore();
    const { service, channel } = makeContext(store, {
      outcome: { content: [{ type: "text", text: "Configure OpenBrain before capture." }] },
    });
    await startPending(service);
    await service.completeRemember({
      payload: "id-1:0", caller, chatId: "chat-1", threadId: "topic-1",
    });
    const receipt = channel.send.mock.calls.at(-1)[0].text;
    expect(receipt).toContain("no record id returned");
    expect(receipt).not.toMatch(/Saved .* id/);
    expect(receipt).toContain("Configure OpenBrain");
  });

  it("searches the current project's L2 memories and renders source, date and references", async () => {
    const store = await makeStore();
    const { service, mcp } = makeContext(store, {
      outcome: {
        structuredContent: {
          total: 1,
          hits: [{ source: "memory", snippet: "Use cursors", timestamp: "2026-10-06T00:00:00Z", recordRef: "mem-1" }],
        },
      },
    });
    const result = await service.recall(input("cursor decision"));
    expect(mcp.call).toHaveBeenCalledWith("project-1", "forge_search", { query: "cursor decision", limit: 5 });
    expect(result[0].text).toContain("• [memory] Use cursors — 2026-10-06 (mem-1)");
  });

  it("echoes empty-state messages or gives an explicit fallback and fences untrusted hits", async () => {
    const store = await makeStore();
    const { service: withMessage } = makeContext(store, {
      outcome: { structuredContent: { total: 0, hits: [], message: "No L2 memories matched." } },
    });
    expect((await withMessage.recall(input("missing")))[0].text).toBe("No L2 memories matched.");

    const secondStore = await makeStore();
    const { service: withoutMessage } = makeContext(secondStore, {
      outcome: { structuredContent: { total: 0, hits: [] } },
    });
    expect((await withoutMessage.recall(input("missing")))[0].text)
      .toBe('No memories matched "missing" in Project One. Try broader terms.');

    const thirdStore = await makeStore();
    const { service: untrusted } = makeContext(thirdStore, {
      outcome: {
        structuredContent: {
          total: 1,
          hits: [{ source: "memory", snippet: "Forwarded note", origin: "untrusted", recordRef: "mem-u" }],
        },
      },
    });
    expect((await untrusted.recall(input("forwarded")))[0].text).toContain("⚠ untrusted: • [memory]");
  });

  it("keeps general-topic recall project-scoped without calling MCP", async () => {
    const store = await makeStore();
    const { service, mcp } = makeContext(store);
    expect((await service.recall(input("query", { project: undefined }))).map(({ text }) => text).join(""))
      .toBe("/recall works in a project topic only.");
    expect(mcp.call).not.toHaveBeenCalled();
  });

  it("marks recall results truncated without attempting to invent a cursor", async () => {
    const store = await makeStore();
    const { service, mcp } = makeContext(store, {
      outcome: {
        structuredContent: {
          total: 12,
          truncated: true,
          hits: [{ source: "memory", snippet: "A".repeat(240), recordRef: "mem-1" }],
        },
      },
    });
    const result = await service.recall(input("long"));
    expect(mcp.call.mock.calls[0][2]).not.toHaveProperty("cursor");
    expect(result[0].text).toContain(`${"A".repeat(200)} — date unavailable (mem-1)`);
    expect(result[0].text).toContain("More results available — refine your query.");
  });

  it("submits ideas with the exact arguments, echoes the smelt id and deduplicates updates", async () => {
    const store = await makeStore();
    const { service, mcp } = makeContext(store, {
      outcome: { structuredContent: { id: "smelt-9", lane: "feature", firstQuestion: "Which users?" } },
    });
    const args = input("Add export support");
    const first = await service.idea(args);
    const replay = await service.idea(args);
    expect(mcp.call).toHaveBeenCalledOnce();
    expect(mcp.call).toHaveBeenCalledWith("project-1", "forge_crucible_submit", {
      rawIdea: "Add export support", source: "human",
    });
    expect(first[0].text).toContain("smelt-9");
    expect(first[0].text).toContain("Which users?");
    expect(replay).toEqual(first);
  });

  it.each(["idea", "bug"])("shares one concurrent %s write and replays its exact receipt", async (method) => {
    const store = await makeStore();
    let enter;
    const entered = new Promise((resolve) => { enter = resolve; });
    const waiting = [];
    let released = false;
    const outcome = { structuredContent: { id: "smelt-concurrent", bugId: "BUG-CONCURRENT" } };
    const mcpCall = vi.fn(async () => {
      enter();
      if (!released) await new Promise((resolve) => waiting.push(resolve));
      return outcome;
    });
    const { service } = makeContext(store, { mcpCall });
    const request = input("One scoped capture");
    const operations = [service[method](request), service[method](request)];
    const release = () => {
      released = true;
      for (const resolve of waiting) resolve();
    };
    try {
      await entered;
      expect(mcpCall).toHaveBeenCalledOnce();
      release();
      const [first, second] = await Promise.all(operations);
      expect(second).toEqual(first);
      expect(await service[method](request)).toEqual(first);
      expect(mcpCall).toHaveBeenCalledOnce();
    } finally {
      release();
      await Promise.allSettled(operations);
    }
  });

  it("registers bugs with legal evidence, handles duplicate and infra outcomes", async () => {
    const store = await makeStore();
    const { service, mcp } = makeContext(store, {
      outcome: { structuredContent: { bugId: "BUG-12", issueUrl: "https://example.com/12" } },
    });
    const result = await service.bug(input("Login fails after retry"));
    expect(mcp.call).toHaveBeenCalledWith("project-1", "forge_bug_register", {
      scanner: "contract",
      severity: "medium",
      evidence: {
        testName: "operator-report",
        assertionMessage: "Login fails after retry",
        reportedVia: "pforge-claw",
      },
    });
    expect(result[0].text).toContain("BUG-12");
    expect(result[0].text).toContain("https://example.com/12");

    const duplicateStore = await makeStore();
    const { service: duplicate } = makeContext(duplicateStore, {
      outcome: { structuredContent: { ok: false, error: "DUPLICATE_BUG", existingBugId: "BUG-4" } },
    });
    expect((await duplicate.bug(input("Duplicate report")))[0].text).toContain("Already registered as BUG-4");

    const infraStore = await makeStore();
    const { service: infra } = makeContext(infraStore, {
      outcome: { structuredContent: { classification: "infra" } },
    });
    expect((await infra.bug(input("Service unavailable")))[0].text).toBe("Recorded as infra, no bug id created.");
  });

  it.each([
    ["remember", (service, args) => service.startRemember(args), "fact"],
    ["recall", (service, args) => service.recall(args), "query"],
    ["idea", (service, args) => service.idea(args), "idea"],
    ["bug", (service, args) => service.bug(args), "description"],
  ])("rejects blank /%s input without a write", async (command, invoke, usage) => {
    const store = await makeStore();
    const { service, mcp } = makeContext(store);
    expect((await invoke(service, input("   ")))[0].text).toContain(`Usage: /${command} <${usage}>`);
    expect(mcp.call).not.toHaveBeenCalled();
    expect([...store.read("jobs")]).toHaveLength(0);
  });

  it.each(["remember", "recall", "idea", "bug"])("returns only the MCP error code for thrown /%s failures", async (command) => {
    const store = await makeStore();
    const { service, channel } = makeContext(store, {
      mcpCall: vi.fn(async () => { throw Object.assign(new Error("raw sensitive-canary body"), { code: "MCP_TOOL_ERROR" }); }),
    });
    let replies;
    if (command === "remember") {
      await startPending(service);
      await service.completeRemember({ payload: "id-1:0", caller, chatId: "chat-1", threadId: "topic-1" });
      replies = channel.send.mock.calls.map(([message]) => message.text).join("\n");
    } else {
      replies = (await service[command](input("valid content"))).map(({ text }) => text).join("\n");
    }
    expect(replies).toContain(`/${command} couldn't save (MCP_TOOL_ERROR)`);
    expect(replies).not.toContain("raw");
    expect(replies).not.toContain("sensitive-canary");
  });

  it.each(["remember", "recall", "idea", "bug"])("normalizes { ok: false } MCP failures for /%s", async (command) => {
    const store = await makeStore();
    const { service, channel } = makeContext(store, {
      outcome: { structuredContent: { ok: false, error: "MCP_TOOL_ERROR", text: "raw error body" } },
    });
    let replies;
    if (command === "remember") {
      await startPending(service);
      await service.completeRemember({ payload: "id-1:0", caller, chatId: "chat-1", threadId: "topic-1" });
      replies = channel.send.mock.calls.map(([message]) => message.text).join("\n");
    } else {
      replies = (await service[command](input("valid content"))).map(({ text }) => text).join("\n");
    }
    expect(replies).toContain(`/${command} couldn't save (MCP_TOOL_ERROR)`);
    expect(replies).not.toContain("raw error body");
  });

  it("redacts canaries from replies, pending rows and MCP arguments", async () => {
    const store = await makeStore();
    const { service, channel, mcp } = makeContext(store, {
      outcome: { structuredContent: { id: "id-safe", text: "sensitive-canary" } },
    });
    await startPending(service, "A sensitive-canary memory");
    expect(JSON.stringify([...store.read("memory-pending")])).not.toContain("sensitive-canary");
    await service.completeRemember({ payload: "id-1:0", caller, chatId: "chat-1", threadId: "topic-1" });
    expect(JSON.stringify(mcp.call.mock.calls)).not.toContain("sensitive-canary");
    expect(JSON.stringify(channel.send.mock.calls)).not.toContain("sensitive-canary");
  });

  it.each(["remember", "recall", "idea", "bug"])("rejects oversized /%s input without truncating or calling MCP", async (command) => {
    const store = await makeStore();
    const { service, mcp } = makeContext(store);
    let replies;
    if (command === "remember") {
      replies = await service.startRemember(input("x".repeat(3501)));
    } else {
      replies = await service[command](input("x".repeat(3501)));
    }
    expect(replies[0].text).toContain("at most 3500 characters");
    expect(mcp.call).not.toHaveBeenCalled();
    expect([...store.read("memory-pending")]).toHaveLength(0);
  });

  it("returns the specific missing-evidence code without leaking tool output", async () => {
    const store = await makeStore();
    const { service } = makeContext(store, {
      outcome: { structuredContent: { ok: false, error: "MISSING_EVIDENCE", message: "private tool details" } },
    });
    const result = await service.bug(input("A bug report"));
    expect(result[0].text).toContain("/bug couldn't save (MISSING_EVIDENCE)");
    expect(result[0].text).not.toContain("private tool details");
  });

  it("adds a setup hint only for OpenBrain configuration errors and records lifecycle audits", async () => {
    const store = await makeStore();
    const { service } = makeContext(store, {
      outcome: { structuredContent: { ok: false, error: "OPENBRAIN_NOT_CONFIGURED" } },
    });
    const result = await service.idea(input("Add support"));
    expect(result[0].text).toContain("Configure OpenBrain");
    expect([...store.read("audit")].map(({ record }) => record)).toEqual([
      expect.objectContaining({ kind: "capture", command: "idea", jobType: "capture", outcome: "OPENBRAIN_NOT_CONFIGURED" }),
    ]);
  });

  it("audits an unbound memory callback without throwing", async () => {
    const store = await makeStore();
    await expect(memoryCallback.handle({ store }, {
      payload: "id-1:0", caller, chatId: "chat-1", threadId: "topic-1",
    })).resolves.toEqual([]);
    expect([...store.read("audit")][0].record).toMatchObject({
      kind: "callback-ignored",
      reason: "unbound",
    });
  });
});
