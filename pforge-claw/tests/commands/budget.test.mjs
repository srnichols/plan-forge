import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindBudgetService, createBudgetService, getBudgetService } from "../../src/budget.mjs";
import budgetCallback from "../../src/callbacks/b.mjs";
import budgetCommand from "../../src/commands/budget.mjs";
import budgetFeature from "../../src/features/budget.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../../src/jobs/model.mjs";
import { createStore } from "../../src/state/store.mjs";

const directories = [];
const storeDirectories = new WeakMap();
const FIXTURE_PREFIX = path.join(path.dirname(fileURLToPath(import.meta.url)), ".budget-command-fixture-");
const NOW = Date.parse("2026-10-07T12:00:00Z");
const CHAT = "budget-chat";
const TOPIC = "budget-topic";
const OWNER = { role: "owner", userId: "budget-owner" };
let unbind = null;

function makeStore() {
  const directory = mkdtempSync(FIXTURE_PREFIX);
  directories.push(directory);
  const store = createStore(directory, { now: () => new Date(NOW) });
  storeDirectories.set(store, directory);
  return store;
}

function addHeldJob(store, id, projectId, { state = "held-budget", ...binding } = {}) {
  const created = createJob({ id, type: "task", projectId });
  const job = { ...created.job, ...binding };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  const waiting = transition(job, "awaiting-approval");
  store.append(JOBS_STREAM, waiting.event);
  const approved = transition(waiting.job, "approved");
  store.append(JOBS_STREAM, approved.event);
  if (state === "approved") return approved.job;
  const held = transition(approved.job, "held-budget", { reason: "budget:cap-usd" });
  store.append(JOBS_STREAM, held.event);
  return held.job;
}

function budgetRows(store) {
  return [...store.read("budget")].map(({ record }) => record);
}

function ownerConfig() {
  return {
    timezone: "Etc/UTC",
    budget: { dailyUSD: 1 },
    allowlist: [
      { channel: "telegram", ...OWNER },
      { channel: "telegram", role: "owner", userId: "other-owner" },
      { channel: "telegram", role: "approver", userId: "approver" },
    ],
    projects: [{ id: "p1" }, { id: "p2" }],
  };
}

async function heldFixture({ now = () => NOW } = {}) {
  const store = makeStore();
  const bus = new EventEmitter();
  const channel = { send: vi.fn(async () => []), edit: vi.fn(async () => {}) };
  const ctx = { store, bus, channel, config: ownerConfig(), now };
  await budgetFeature.start(ctx);
  const job = addHeldJob(store, "recoverable-budget-job", "p1", {
    state: "approved", chatId: CHAT, threadId: TOPIC, callerId: OWNER.userId,
  });
  getBudgetService().recordUsage({
    source: "session", projectId: "p1", jobId: "prior-spend", usage: { costUSD: 2 },
  });
  getBudgetService().gate(job.id);
  await Promise.resolve();
  return { store, bus, channel, ctx, job };
}

function ownerRequest(overrides = {}) {
  return { args: ["today"], caller: OWNER, chatId: CHAT, threadId: TOPIC, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  await budgetFeature.stop();
  unbind?.();
  unbind = null;
  vi.useRealTimers();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("/budget", () => {
  it("renders only the project in a project topic and all visible projects in general", async () => {
    const store = makeStore();
    const service = createBudgetService({
      store,
      now: () => NOW,
      config: {
        timezone: "Etc/UTC",
        budget: { dailyUSD: 20 },
        projects: [
          { id: "p1", budget: { dailyUSD: 5 } },
          { id: "p2", budget: { dailyUSD: 8 } },
          { id: "secret", visibility: "restricted" },
        ],
      },
    });
    service.recordUsage({ source: "session", projectId: "p1", usage: { costUSD: 1 } });
    service.recordUsage({ source: "session", projectId: "p2", usage: { costUSD: 2 } });
    service.recordUsage({ source: "session", projectId: "secret", usage: { costUSD: 3 } });
    unbind = bindBudgetService(service);

    const projectResult = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } },
      { args: [], caller: { role: "approver" } },
    );
    expect(projectResult.text).toContain("p1");
    expect(projectResult.text).not.toContain("p2");

    const generalResult = await budgetCommand.handle(
      { scope: "general" },
      { args: ["today"], caller: { role: "approver" } },
    );
    expect(generalResult.text).toContain("p1");
    expect(generalResult.text).toContain("p2");
    expect(generalResult.text).not.toContain("secret");
    expect(generalResult.text).toContain("global");
  });

  it("renders the empty day, unreported usage, missing caps, and held jobs", async () => {
    const store = makeStore();
    const service = createBudgetService({
      store,
      now: () => NOW,
      config: { timezone: "Etc/UTC", projects: [{ id: "p1" }] },
    });
    unbind = bindBudgetService(service);
    expect((await budgetCommand.handle({ scope: "project", project: { id: "p1" } }, {})).text)
      .toContain("No budget activity recorded today (2026-10-07, Etc/UTC).");

    service.recordUsage({ source: "session", projectId: "p1", jobId: "unknown-job", usage: {} });
    addHeldJob(store, "held-budget-job", "p1");
    const rendered = (await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, { args: ["today"] },
    )).text;
    expect(rendered).toContain("unreported / no cap");
    expect(rendered).toContain("unknown 1");
    expect(rendered).toContain("held-budget-job  budget:cap-usd");
  });

  it("returns an unavailable message and usage hint for invalid arguments", async () => {
    expect((await budgetCommand.handle({}, {})).text).toBe("SERVICE_UNAVAILABLE: budget");
    const service = createBudgetService({ store: makeStore(), now: () => NOW });
    unbind = bindBudgetService(service);
    expect((await budgetCommand.handle({ scope: "general" }, { args: ["yesterday"] })).text)
      .toBe("Usage: /budget [today]");
  });

  it("CP12: explicitly retrieves a fresh owner-bound card after expiry and actual store restart", async () => {
    let now = NOW;
    const fixture = await heldFixture({ now: () => now });
    const oldPayload = fixture.channel.send.mock.calls[0][0].replyMarkup.inline_keyboard[0][0].callback_data;
    const oldIssue = budgetRows(fixture.store).find((record) => record.kind === "override.issued");
    now = oldIssue.expiresAt + 1;
    await budgetFeature.stop();

    const restarted = createStore(storeDirectories.get(fixture.store), { now: () => new Date(now) });
    await budgetFeature.start({ ...fixture.ctx, store: restarted });
    const service = getBudgetService();
    service.gate(fixture.job.id);
    expect(currentJobs(restarted)[fixture.job.id].state).toBe("held-budget");
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);

    const response = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, ownerRequest(),
    );
    expect(response.text).toContain(fixture.job.id);
    expect(response.replyMarkup?.inline_keyboard).toHaveLength(1);
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    expect(currentJobs(restarted)[fixture.job.id].state).toBe("held-budget");
    const freshPayload = response.replyMarkup.inline_keyboard[0][0].callback_data;
    expect(freshPayload).not.toBe(oldPayload);
    const freshIssue = budgetRows(restarted).filter((record) => record.kind === "override.issued").at(-1);
    expect(freshIssue).toMatchObject({
      jobId: fixture.job.id, chatId: CHAT, threadId: TOPIC, ownerId: OWNER.userId,
      expiresAt: now + 15 * 60_000,
    });
    expect(JSON.stringify(budgetRows(restarted))).not.toContain(freshPayload.split(":").at(-1));
    expect(service.override({
      payload: oldPayload, caller: OWNER, chatId: CHAT, threadId: TOPIC,
    })).toMatchObject({ ok: false, reason: "expired" });
    for (const binding of [
      { caller: { role: "owner", userId: "other-owner" } },
      { caller: { role: "owner" } },
      { caller: { role: "approver", userId: OWNER.userId } },
      { chatId: "other-chat" },
      { threadId: "other-topic" },
    ]) {
      expect(service.override({
        payload: freshPayload, caller: OWNER, chatId: CHAT, threadId: TOPIC, ...binding,
      })).toMatchObject({ ok: false });
      expect(currentJobs(restarted)[fixture.job.id].state).toBe("held-budget");
    }

    await budgetCallback.handle({}, {
      payload: freshPayload, caller: OWNER, chatId: CHAT, threadId: TOPIC, messageId: "fresh-budget-card",
    });
    expect(currentJobs(restarted)[fixture.job.id].state).toBe("approved");
    expect(fixture.channel.edit).toHaveBeenCalledWith({
      chatId: CHAT, threadId: TOPIC, messageId: "fresh-budget-card",
      text: `✅ Released over budget by ${OWNER.userId}`, replyMarkup: { inline_keyboard: [] },
    });
    expect(service.override({
      payload: freshPayload, caller: OWNER, chatId: CHAT, threadId: TOPIC,
    })).toMatchObject({ ok: false, reason: "used" });
    expect(budgetRows(restarted).filter((record) => record.kind === "override.consumed")).toHaveLength(1);
    expect(service.check(currentJobs(restarted)[fixture.job.id])).toEqual({ ok: true });
    expect(service.today().global).toEqual({ costUSD: 2, premiumRequests: null, unknownUsageJobs: 0 });
  });

  it("CP12: reissue supersedes an unexpired older card without approving the job", async () => {
    const fixture = await heldFixture();
    const oldPayload = fixture.channel.send.mock.calls[0][0].replyMarkup.inline_keyboard[0][0].callback_data;
    const response = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, ownerRequest(),
    );
    expect(response.replyMarkup?.inline_keyboard).toHaveLength(1);
    const freshPayload = response.replyMarkup.inline_keyboard[0][0].callback_data;
    const service = getBudgetService();

    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("held-budget");
    expect(service.override({
      payload: oldPayload, caller: OWNER, chatId: CHAT, threadId: TOPIC,
    })).toMatchObject({ ok: false, reason: "stale" });
    expect(service.override({
      payload: freshPayload, caller: OWNER, chatId: CHAT, threadId: TOPIC,
    })).toEqual({ ok: true, jobId: fixture.job.id });
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
  });

  it("CP12: returns recovery markup for router delivery and never double-sends a committed release", async () => {
    const fixture = await heldFixture();
    const response = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, ownerRequest(),
    );
    expect(response.replyMarkup?.inline_keyboard).toHaveLength(1);
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
    const payload = response.replyMarkup.inline_keyboard[0][0].callback_data;
    fixture.channel.edit.mockRejectedValue(Object.assign(new Error("offline"), { code: "CHANNEL_OFFLINE" }));

    expect(await budgetCallback.handle({}, {
      payload, caller: OWNER, chatId: CHAT, threadId: TOPIC, messageId: "recovery-card",
    })).toBeUndefined();
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("approved");
    expect(budgetRows(fixture.store).filter((record) => record.kind === "override.consumed")).toHaveLength(1);
    expect(fixture.channel.edit).toHaveBeenCalledTimes(1);
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);

    expect(await budgetCallback.handle({}, {
      payload, caller: OWNER, chatId: CHAT, threadId: TOPIC, messageId: "recovery-card",
    })).toBeUndefined();
    expect(fixture.channel.edit).toHaveBeenCalledTimes(1);
    expect(fixture.channel.send).toHaveBeenCalledTimes(2);
    expect(fixture.channel.send).toHaveBeenLastCalledWith({
      chatId: CHAT, threadId: TOPIC, text: "This override is no longer valid.",
    });
    expect(budgetRows(fixture.store).filter((record) => record.kind === "override.consumed")).toHaveLength(1);
  });

  it.each([
    ["approver", { caller: { role: "approver", userId: "approver" } }, { scope: "project", project: { id: "p1" } }],
    ["unknown owner identity", { caller: { role: "owner", userId: "not-allowlisted" } }, { scope: "project", project: { id: "p1" } }],
    ["missing owner identity", { caller: { role: "owner" } }, { scope: "project", project: { id: "p1" } }],
    ["another chat", { chatId: "another-chat" }, { scope: "project", project: { id: "p1" } }],
    ["another topic", { threadId: "another-topic" }, { scope: "project", project: { id: "p1" } }],
    ["another project", {}, { scope: "project", project: { id: "p2" } }],
    ["invalid argument", { args: ["yesterday"] }, { scope: "project", project: { id: "p1" } }],
  ])("CP12: does not reissue a card for %s", async (_name, overrides, context) => {
    const fixture = await heldFixture();
    const response = await budgetCommand.handle(context, ownerRequest(overrides));
    expect(response.replyMarkup).toBeUndefined();
    expect(budgetRows(fixture.store).filter((record) => record.kind === "override.issued")).toHaveLength(1);
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("held-budget");
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);
  });

  it("CP12: refuses a reissued card if its bound owner is no longer a current owner", async () => {
    const fixture = await heldFixture();
    const response = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, ownerRequest(),
    );
    expect(response.replyMarkup?.inline_keyboard).toHaveLength(1);
    const payload = response.replyMarkup.inline_keyboard[0][0].callback_data;
    fixture.ctx.config.allowlist.find((identity) => identity.userId === OWNER.userId).role = "approver";

    expect(getBudgetService().override({
      payload, caller: OWNER, chatId: CHAT, threadId: TOPIC,
    })).toMatchObject({ ok: false });
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("held-budget");
    expect(budgetRows(fixture.store).filter((record) => record.kind === "override.consumed")).toHaveLength(0);
  });

  it("CP12: keeps yesterday's hold until a fresh explicit owner decision even when today's caps are clear", async () => {
    let now = NOW;
    const fixture = await heldFixture({ now: () => now });
    now += 86_400_000;
    await budgetFeature.stop();
    await budgetFeature.start(fixture.ctx);
    const service = getBudgetService();
    expect(service.check(currentJobs(fixture.store)[fixture.job.id])).toEqual({ ok: true });
    service.gate(fixture.job.id);
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("held-budget");
    expect(fixture.channel.send).toHaveBeenCalledTimes(1);

    const response = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, ownerRequest(),
    );
    expect(response.replyMarkup?.inline_keyboard).toHaveLength(1);
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("held-budget");
    const payload = response.replyMarkup.inline_keyboard[0][0].callback_data;
    const issue = budgetRows(fixture.store).filter((record) => record.kind === "override.issued").at(-1);
    now = issue.expiresAt;
    expect(service.override({ payload, caller: OWNER, chatId: CHAT, threadId: TOPIC }))
      .toMatchObject({ ok: false, reason: "expired" });
    expect(currentJobs(fixture.store)[fixture.job.id].state).toBe("held-budget");
  });

  it("CP12: bounds fresh cards to twenty same-topic jobs and keeps colliding short IDs independent", async () => {
    const store = makeStore();
    const config = ownerConfig();
    const channel = { send: vi.fn(), edit: vi.fn() };
    const service = createBudgetService({ store, config, channel, now: () => NOW });
    unbind = bindBudgetService(service);
    for (let index = 0; index < 25; index += 1) {
      addHeldJob(store, `shared00-job-${index}`, "p1", { chatId: CHAT, threadId: TOPIC });
    }
    addHeldJob(store, "other-topic-job", "p1", { chatId: CHAT, threadId: "other-topic" });
    addHeldJob(store, "other-project-job", "p2", { chatId: CHAT, threadId: TOPIC });

    const response = await budgetCommand.handle(
      { scope: "project", project: { id: "p1" } }, ownerRequest({ args: [] }),
    );
    expect(response.replyMarkup?.inline_keyboard).toHaveLength(20);
    const issued = budgetRows(store).filter((record) => record.kind === "override.issued");
    expect(issued).toHaveLength(20);
    expect(issued.every((record) => record.ownerId === OWNER.userId)).toBe(true);
    expect(issued.every((record) => record.shortId === "shared00")).toBe(true);
    for (const [index, row] of response.replyMarkup.inline_keyboard.entries()) {
      const payload = row[0].callback_data;
      expect(Buffer.byteLength(payload, "utf8")).toBeLessThanOrEqual(64);
      expect(service.override({ payload, caller: OWNER, chatId: CHAT, threadId: TOPIC }))
        .toEqual({ ok: true, jobId: `shared00-job-${index}` });
    }
    expect(currentJobs(store)["shared00-job-24"].state).toBe("held-budget");
    expect(currentJobs(store)["other-topic-job"].state).toBe("held-budget");
    expect(currentJobs(store)["other-project-job"].state).toBe("held-budget");
    expect(channel.send).not.toHaveBeenCalled();
  });
});
