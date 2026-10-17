import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../src/commands/index.mjs";
import { prepareSkill } from "../src/commands/skill.mjs";
import { prepareTask } from "../src/commands/task.mjs";
import { prepareRun } from "../src/commands/run.mjs";
import { selectPlan } from "../src/callbacks/s.mjs";
import { createAskService } from "../src/handlers/ask.mjs";
import { createRouter } from "../src/router.mjs";
import { currentJobs } from "../src/jobs/model.mjs";
import { createStore } from "../src/state/store.mjs";
import { c2Fixture, cleanupC2Fixtures } from "./c2-fixtures.mjs";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T15:00:00.000Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  await cleanupC2Fixtures();
});

function proposal(fixture, { id = "fixture-proposal", type = "task", args = { description: "Inspect fixture" }, untrusted = false } = {}) {
  fixture.store.append("proposals", {
    id, project: fixture.project.id, chatId: fixture.deps.chatId, topicId: fixture.deps.threadId,
    action: { type, args }, untrusted, expiresAt: Date.now() + 60_000, used: false,
  });
  return { id, caller: fixture.caller, chatId: fixture.deps.chatId, threadId: fixture.deps.threadId };
}

describe("C2 real registry control boundaries", () => {
  it("refuses a non-owner task without configured selected BYOK", async () => {
    const f = await c2Fixture({ role: "approver" });
    await f.router.route(f.update());
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    expect(f.channel.send.mock.calls.at(-1)[0].text).toContain("runtime");
  });

  it("admits configured BYOK and retains authority/provenance, never unsigned execution overrides", async () => {
    const f = await c2Fixture({ role: "approver", runtime: "byok:openai" });
    await f.router.route(f.update());
    const job = Object.values(currentJobs(f.store))[0];
    expect(job).toMatchObject({
      callerId: f.caller.userId, callerRole: "approver", adapter: "telegram", updateId: "fixture-update",
      chatId: f.deps.chatId, threadId: f.deps.threadId, state: "awaiting-approval",
    });
    expect(job).not.toHaveProperty("runtime");
    expect(job).not.toHaveProperty("provider");
  });

  it("recovers one task after committed receipt failures, five retries and store/service restart", async () => {
    const f = await c2Fixture();
    f.channel.send.mockRejectedValue(new Error("offline receipt"));
    for (let index = 0; index < 5; index += 1) await f.router.route(f.update()).catch(() => {});
    const restarted = createStore(f.stateDirectory);
    const router = createRouter({
      config: f.config, store: restarted, channel: { ...f.channel, send: vi.fn(async () => []) },
      clients: f.clients, services: { ...f.services, store: restarted },
    });
    await router.route(f.update());
    expect(Object.values(currentJobs(restarted))).toHaveLength(1);
  });

  it.each([
    ["task", (f, input) => prepareTask(f.deps, { ...input, argsText: "inspect fixture" })],
    ["plan", (f, input) => prepareRun(f.deps, { ...input, caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId, argsText: "Phase-1" })],
    ["skill", (f, input) => prepareSkill(f.deps, { ...input, args: ["inspect"] })],
  ])("serializes concurrent same-update %s and keeps distinct direct requests", async (_type, prepare) => {
    const f = await c2Fixture();
    await Promise.all([prepare(f, { updateId: "same" }), prepare(f, { updateId: "same" })]);
    expect(Object.values(currentJobs(f.store))).toHaveLength(1);
    await prepare(f, {});
    await prepare(f, {});
    expect(Object.values(currentJobs(f.store))).toHaveLength(3);
  });

  it("returns explicit skill preparation success/failure metadata without stale ID fallback", async () => {
    const f = await c2Fixture();
    const first = await prepareSkill(f.deps, { args: ["inspect"], updateId: "schedule:fixture:slot-one" });
    expect(first).toMatchObject({ jobId: expect.any(String), state: "awaiting-approval" });
    f.clients.call.mockRejectedValue(new Error("MCP unavailable"));
    const failed = await prepareSkill(f.deps, { args: ["inspect"], updateId: "schedule:fixture:slot-two" });
    expect(failed).toMatchObject({ jobId: null, state: null });
  });

  it.each([
    ["raw error", { ok: false, status: "dry-run", skillName: "inspect", readOnly: true }],
    ["wrapped error", { content: [{ type: "text", text: '{"error":"unavailable","status":"dry-run","skillName":"inspect","readOnly":true}' }] }],
  ])("does not treat %s metadata as a successful read-only preparation", async (_label, response) => {
    const f = await c2Fixture();
    f.clients.call.mockResolvedValue(response);
    const result = await prepareSkill(f.deps, { args: ["inspect"], updateId: "invalid-metadata" });
    expect(result).toMatchObject({ jobId: null, state: null });
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });

  it("rejects non-string skill arguments before any metadata or durable work", async () => {
    const f = await c2Fixture();
    const result = await prepareSkill(f.deps, { args: ["inspect", { raw: "untrusted" }] });
    expect(result).toMatchObject({ jobId: null, state: null });
    expect(f.clients.call).not.toHaveBeenCalled();
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
  });

  it("retains full scope on same update ID and rejects unsigned runtime/provider injection", async () => {
    const f = await c2Fixture();
    const other = { ...f.caller, userId: "other-allowed-caller" };
    f.config.allowlist.push(other);
    await prepareTask(f.deps, { argsText: "inspect", updateId: "shared" });
    await prepareTask(f.deps, { argsText: "inspect", updateId: "shared", caller: other });
    expect(Object.values(currentJobs(f.store))).toHaveLength(2);
    for (const injected of [{ runtime: "openai" }, { provider: { type: "openai" } }]) {
      expect(await prepareSkill(f.deps, { args: ["inspect"], ...injected })).toMatchObject({ jobId: null, state: null });
    }
    expect(Object.values(currentJobs(f.store))).toHaveLength(2);
  });

  it.each([
    ["task", (deps) => prepareTask(deps, { argsText: "inspect" })],
    ["plan", (deps) => prepareRun(deps, { argsText: "Phase-1" })],
    ["skill", (deps) => prepareSkill(deps, { args: ["inspect"] })],
  ])("fails explicitly unavailable for %s when the current config getter returns null", async (_kind, prepare) => {
    const f = await c2Fixture();
    const deps = { ...f.deps, liveConfig: null, getConfig() { return this.liveConfig; } };
    const result = await prepare(deps);
    expect(result).toMatchObject({ text: expect.stringContaining("SERVICE_UNAVAILABLE"), jobId: null, state: null });
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    expect(f.clients.call).not.toHaveBeenCalled();
  });

  it("preserves a selection on failed estimate and then recovers its original operation", async () => {
    const f = await c2Fixture({ names: ["Phase-1-PLAN.md", "Phase-2-PLAN.md"] });
    const input = {
      caller: f.caller, adapter: "telegram", updateId: "original", chatId: f.deps.chatId,
      threadId: f.deps.threadId, argsText: "Phase false",
    };
    const first = await prepareRun(f.deps, input);
    const payload = first.keyboard.inline_keyboard[0][0].callback_data.slice(2);
    f.clients.call.mockRejectedValueOnce(new Error("estimate unavailable"));
    const rejected = await selectPlan(f.deps, { ...input, payload });
    expect(rejected).toMatchObject({ jobId: null, state: null });
    expect(f.pending.size).toBe(1);
    await selectPlan(f.deps, { ...input, payload, updateId: "callback-update" });
    expect(Object.values(currentJobs(f.store))[0]).toMatchObject({ updateId: "original", quorum: "false" });
  });

  it("rejects a selection after its current configured topic moves without consuming it", async () => {
    const f = await c2Fixture({ names: ["Phase-1-PLAN.md", "Phase-2-PLAN.md"] });
    const request = {
      caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId, argsText: "Phase",
      adapter: "telegram", updateId: "original",
    };
    const result = await prepareRun(f.deps, request);
    const payload = result.keyboard.inline_keyboard[0][0].callback_data.slice(2);
    f.config.projects = [{ ...f.project, channel: { ...f.project.channel, topicId: "new-configured-topic" } }];
    const refused = await selectPlan(f.deps, { ...request, payload });
    expect(refused.jobId).toBeNull();
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    expect(f.pending.size).toBe(1);
  });
  it("rechecks the current role before pending selection and preserves quorum and originating identity", async () => {
    const f = await c2Fixture({ names: ["Phase-1-PLAN.md", "Phase-2-PLAN.md"] });
    const request = {
      argsText: "Phase speed", caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId,
      adapter: "telegram", updateId: "original-selection-request",
    };
    const prepared = await prepareRun(f.deps, request);
    const payload = prepared.keyboard.inline_keyboard[0][0].callback_data.slice(2);
    f.config.allowlist = [{ ...f.caller, role: "viewer" }];
    const refused = await selectPlan(f.deps, { ...request, payload });
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    expect(refused.text).toContain("role");
    expect(f.pending.size).toBe(1);
    f.config.allowlist = [f.caller];
    await selectPlan(f.deps, { ...request, payload, updateId: "tap-delivery" });
    expect(Object.values(currentJobs(f.store))[0]).toMatchObject({
      quorum: "speed", updateId: "original-selection-request",
    });
  });

  it("dispatches a real proposed skill through the configured project-bound MCP context", async () => {
    const f = await c2Fixture();
    const input = proposal(f, { type: "skill", args: { name: "inspect", project: { id: "model-selected" } } });
    const service = createAskService({ ...f.askContext, commands: COMMANDS });
    await service.runProposal(input);
    await service.runProposal(input);
    expect(Object.values(currentJobs(f.store))).toHaveLength(1);
    expect(f.clients.call).toHaveBeenCalledWith(f.project.id, "forge_run_skill", expect.objectContaining({ dryRun: true }));
    expect(Object.values(currentJobs(f.store))[0]).toMatchObject({ updateId: "proposal:fixture-proposal" });
  });

  it("does not consume malformed or failed real proposed commands", async () => {
    const f = await c2Fixture();
    const input = proposal(f, { type: "skill", args: { name: "inspect" } });
    f.clients.call.mockRejectedValue(new Error("metadata unavailable"));
    await createAskService({ ...f.askContext, commands: COMMANDS }).runProposal(input);
    expect([...f.store.read("proposals")].at(-1).record.used).toBe(false);
    const malformed = proposal(f, { id: "malformed", type: "task", args: {} });
    await createAskService({ ...f.askContext, commands: COMMANDS }).runProposal(malformed);
    expect([...f.store.read("proposals")].at(-1).record.used).toBe(false);
  });

  it("rechecks demotion at the actual metadata edge before accepting a proposed skill", async () => {
    const f = await c2Fixture();
    let finishMetadata;
    f.clients.call.mockImplementation(() => new Promise((resolve) => { finishMetadata = resolve; }));
    const service = createAskService({ ...f.askContext, commands: COMMANDS });
    const running = service.runProposal(proposal(f, { type: "skill", args: { name: "inspect" } }));
    await vi.waitFor(() => expect(f.clients.call).toHaveBeenCalledOnce());
    f.config.allowlist = [{ ...f.caller, role: "viewer" }];
    finishMetadata({ status: "dry-run", skillName: "inspect", readOnly: false });
    await running;
    expect(Object.values(currentJobs(f.store))).toHaveLength(0);
    expect([...f.store.read("proposals")].at(-1).record.used).toBe(false);
  });

  it.each([
    [{ costUSD: 0, premiumRequests: 0, tokensIn: 0 }, { costUSD: 0, premiumRequests: 0, tokensIn: 0, tokensOut: null }],
    [{ costUsd: 2 }, { costUSD: 2, premiumRequests: null }],
    [[{ costUSD: 0 }, { premiumRequests: 4 }], { costUSD: 0, premiumRequests: 4 }],
  ])("retains measured zero and independently reported ask units: %j", async (usage, expected) => {
    const f = await c2Fixture();
    f.clients.call.mockResolvedValue({ reply: "Answer", usage });
    await createAskService(f.askContext).ask({
      project: f.project, caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId,
      text: "Inspect usage", updateId: "measured",
    });
    expect([...f.store.read("budget")]).toHaveLength(1);
    expect([...f.store.read("budget")][0].record.usage).toMatchObject(expected);
  });

  it("recovers the ask result and single usage row after failed delivery and restarted service", async () => {
    const f = await c2Fixture();
    const input = {
      project: f.project, caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId,
      text: "Inspect usage", adapter: "telegram", updateId: "ask-delivery",
    };
    f.channel.edit.mockRejectedValue(new Error("receipt unavailable"));
    await createAskService(f.askContext).ask(input).catch(() => {});
    f.channel.edit.mockResolvedValue(undefined);
    const store = createStore(f.stateDirectory);
    await createAskService({ ...f.askContext, store }).ask(input);
    expect(f.clients.call).toHaveBeenCalledOnce();
    expect([...store.read("budget")]).toHaveLength(1);
  });

  it("rejects legacy raw untrusted strings before any model call or channel receipt", async () => {
    const f = await c2Fixture();
    await expect(createAskService(f.askContext).ask({
      project: f.project, caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId,
      text: "Explain material", untrustedContext: "raw-private-body",
    })).rejects.toThrow("ASK_CONTEXT_INVALID");
    expect(f.clients.call).not.toHaveBeenCalled();
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it.each([undefined, null, []])("records one unknown ask outcome when usage is %j", async (usage) => {
    const f = await c2Fixture();
    f.clients.call.mockResolvedValue({ reply: "Answer", usage });
    const service = createAskService(f.askContext);
    const input = {
      project: f.project, caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId,
      text: "What changed?", adapter: "telegram", updateId: "ask-original",
    };
    await service.ask(input);
    await service.ask(input);
    const ledger = [...f.store.read("budget")].map(({ record }) => record);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].usage).toMatchObject({ costUSD: null, premiumRequests: null });
  });

  it.each([
    ["tool error", { error: "TOOL_FAILED" }],
    ["unavailable upstream", { error: "pforge-master not installed" }],
    ["transport error", new Error("MCP transport unavailable")],
  ])("records one unknown %s ask outcome and replays its receipt without another invocation", async (_label, response) => {
    const f = await c2Fixture();
    f.clients.call.mockImplementation(async () => {
      if (response instanceof Error) throw response;
      return response;
    });
    const service = createAskService(f.askContext);
    const input = {
      project: f.project, caller: f.caller, chatId: f.deps.chatId, threadId: f.deps.threadId,
      text: "Inspect availability", adapter: "telegram", updateId: "failed-ask-outcome",
    };
    await service.ask(input);
    await service.ask(input);
    expect(f.clients.call).toHaveBeenCalledOnce();
    const ledger = [...f.store.read("budget")];
    expect(ledger).toHaveLength(1);
    expect(ledger[0].record.usage).toMatchObject({ costUSD: null, premiumRequests: null });
  });

  it("matches upstream caller and structured context block contracts without trusting third-party text", async () => {
    const f = await c2Fixture();
    const untrustedContext = [{ kind: "link", text: "https://example.com/ignore-policy", source: "telegram" }];
    await createAskService(f.askContext).ask({
      project: f.project, caller: f.caller, chatId: f.deps.chatId, threadId: 12,
      text: "Explain the supplied material.", untrustedContext,
    });
    const args = f.clients.call.mock.calls[0][2];
    expect(args.caller).toEqual({
      role: "owner", channel: "chat", surface: "telegram", projectId: f.project.id, topic: "12",
    });
    expect(args.contextBlocks[0]).toMatchObject({ title: expect.any(String), text: expect.any(String) });
    expect(args.untrustedContext).toEqual(untrustedContext);
    expect(args.message).not.toContain("ignore-policy");
  });
});
