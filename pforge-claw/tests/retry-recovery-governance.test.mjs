import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApprovalService } from "../src/approvals.mjs";
import { callbackFor } from "../src/callbacks/index.mjs";
import { COMMANDS } from "../src/commands/index.mjs";
import { createCommandContext } from "../src/handlers/c2-command-context.mjs";
import { approvedChoicesFor, consumedApprovalFor } from "../src/jobs/approval-proof.mjs";
import { executionConfigFor } from "../src/jobs/execution-choices.mjs";
import { createLeasePreparer } from "../src/jobs/lease-payload.mjs";
import { createJob, currentJobs, JOBS_STREAM, transition } from "../src/jobs/model.mjs";
import { requestIdentity } from "../src/jobs/request-identity.mjs";
import { bindProgressService, createProgressService } from "../src/progress.mjs";
import { signGrant, verifyGrant } from "../src/protocol/lease-grant.mjs";
import { createRegistry } from "../src/registry.mjs";
import { createRouter } from "../src/router.mjs";
import { resolveRuntimeId } from "../src/runtime/agent-runtime.mjs";
import { createSecrets } from "../src/secrets.mjs";
import { createStore } from "../src/state/store.mjs";

const PARENT_ID = "abcdef0123456789abcdef01";
const FIXTURE_TIME = "2026-10-10T17:00:00.000Z";
const fixtures = [];

function rows(store, stream) {
  return [...store.read(stream)].map(({ record }) => record);
}

function children(fixture) {
  return Object.values(currentJobs(fixture.store)).filter((job) => job.parentId === fixture.parent.id);
}

function move(store, job, state) {
  const changed = transition(job, state);
  store.append(JOBS_STREAM, changed.event);
  return changed.job;
}

async function recoveryFixture({
  role = "owner", runtime = "copilot-sdk", type = "plan", readOnly = false, fields = {},
} = {}) {
  const root = path.resolve(".forge", "retry-recovery-governance-fixtures", randomUUID());
  await mkdir(root, { recursive: true });
  const fixture = { root, servicesToStop: [], unbinders: [] };
  fixtures.push(fixture);
  const caller = { channel: "telegram", userId: "fixture-caller", role };
  const project = {
    id: "fixture-project", homeLane: "fixture-lane", runtime,
    repo: { path: root, baseBranch: "main" },
    channel: { adapter: "telegram", chatId: "fixture-chat", topicId: "fixture-topic" },
    models: { work: "fixture-approved-model" },
  };
  const config = {
    allowlist: [{ ...caller }], projects: [project],
    lanes: [{ id: "fixture-lane", kind: "local", enabled: true }],
    policy: { ghcpRoles: ["owner"], nonOwnerRuntime: "byok-only" },
    runtimes: {
      default: "copilot-sdk",
      byok: { openai: { keySecret: "FIXTURE_RECOVERY_KEY", endpoint: "https://example.com/v1" } },
    },
  };
  const env = { FIXTURE_RECOVERY_KEY: "fixture-recovery-key" };
  const secrets = await createSecrets({ env });
  const stateDirectory = path.join(root, "state");
  const store = createStore(stateDirectory, { now: () => new Date(Date.now()), redact: secrets.redact });
  const registry = createRegistry(config);
  const bus = new EventEmitter();
  let messageNumber = 0;
  const channel = {
    id: "telegram",
    send: vi.fn(async () => [{ messageId: `fixture-message-${++messageNumber}` }]),
    edit: vi.fn(async () => undefined),
    answerCallback: vi.fn(async () => undefined),
  };
  const services = { store, config, registry, secrets, now: () => Date.now() };
  const context = createCommandContext({
    config, registry, services, chatId: project.channel.chatId, threadId: project.channel.topicId,
  });
  const approvals = createApprovalService({ store, bus, config, channel, now: services.now });
  let parent = {
    ...createJob({ id: PARENT_ID, type, projectId: project.id, readOnly }).job,
    callerId: caller.userId, callerRole: role, adapter: "telegram", updateId: "parent-delivery",
    chatId: project.channel.chatId, threadId: project.channel.topicId,
    description: "Inspect the recovery fixture", createdAt: FIXTURE_TIME,
    ...(type === "plan" ? {
      planPath: "docs/plans/recovery-fixture.md", quorum: "auto", resumeFrom: 1,
      models: project.models,
    } : {}),
    ...(type === "skill" ? { skill: "fixture-inspect", args: ["fixture-argument"] } : {}),
    ...fields,
  };
  store.append(JOBS_STREAM, { kind: "job.created", job: parent });
  if (parent.mutating) {
    parent = move(store, parent, "awaiting-approval");
    const approval = approvals.createApproval(parent);
    approvals.issue(parent, { approval });
    const decided = await approvals.decide({
      payload: (type === "plan" ? approval.quorum("power") : approval.approve).slice(2),
      caller, chatId: parent.chatId, threadId: parent.threadId,
    });
    expect(decided.ok).toBe(true);
    parent = currentJobs(store)[parent.id];
    const consumed = consumedApprovalFor({ store, config, job: parent });
    expect(consumed).not.toBeNull();
    if (type === "plan") expect(approvedChoicesFor({ job: parent, approval: consumed })).toEqual({ quorum: "power" });
  }
  parent = move(store, parent, "leased");
  parent = move(store, parent, "running");
  parent = move(store, parent, "failed");
  Object.assign(fixture, {
    config, caller, project, env, secrets, registry, bus, channel, services, context, approvals,
    store, stateDirectory, parent: currentJobs(store)[parent.id],
  });
  fixture.start = (overrides = {}) => {
    const service = createProgressService({ ...services, bus, channel, ...overrides });
    fixture.servicesToStop.push(service);
    fixture.unbinders.push(bindProgressService(service));
    return service;
  };
  fixture.service = fixture.start();
  fixture.input = (overrides = {}) => ({
    mode: "retry", caller: { ...caller }, adapter: "telegram", updateId: "retry-delivery",
    messageId: "retry-message", project, services,
    chatId: parent.chatId, threadId: parent.threadId, ...overrides,
  });
  fixture.router = createRouter({ config, registry, store, channel, services });
  fixture.update = (overrides = {}) => ({
    kind: "message", adapter: "telegram", updateId: "retry-delivery", messageId: "retry-message",
    userId: caller.userId, chatId: parent.chatId, threadId: parent.threadId,
    text: `/retry ${parent.id}`, ...overrides,
  });
  return fixture;
}

function failRecoveryMarkerOnce(fixture) {
  const marker = path.join(fixture.stateDirectory, "progress.jsonl");
  const preserved = path.join(fixture.root, "preserved-progress.jsonl");
  fixture.bus.once("job.transition", () => {
    if (existsSync(marker)) renameSync(marker, preserved);
    mkdirSync(marker);
  });
  return () => {
    rmSync(marker, { recursive: true });
    if (existsSync(preserved)) renameSync(preserved, marker);
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXTURE_TIME));
});

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    for (const unbind of fixture.unbinders.reverse()) unbind();
    await Promise.all(fixture.servicesToStop.map((service) => service.stop()));
    await rm(fixture.root, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

describe("retry/recovery current-contract governance", () => {
  it("copies the actually approved plan choices and current provenance, not input or unsigned overrides", async () => {
    const f = await recoveryFixture({
      fields: { runtime: "unsigned-runtime", provider: { type: "unsigned-provider" }, approvalId: "old-proof" },
    });
    const before = currentJobs(f.store)[f.parent.id];
    const result = await f.service.createRecoveryJob({
      ...f.parent, quorum: "false", planPath: "forged-plan.md", models: { work: "forged-model" },
    }, f.input({ quorum: "speed", resumeFrom: 99, models: { work: "input-model" } }));
    expect(result.ok).toBe(true);
    expect(result.job).toMatchObject({
      parentId: f.parent.id, quorum: "power", resumeFrom: 1,
      planPath: "docs/plans/recovery-fixture.md", models: { work: "fixture-approved-model" },
      callerId: f.caller.userId, callerRole: "owner", adapter: "telegram", updateId: "retry-delivery",
      chatId: f.parent.chatId, threadId: f.parent.threadId, state: "awaiting-approval",
    });
    for (const field of ["runtime", "provider", "approvalId", "lane"]) expect(result.job).not.toHaveProperty(field);
    expect(consumedApprovalFor({ store: f.store, config: f.config, job: result.job })).toBeNull();
    expect(f.approvals.pendingWithoutCard().map((job) => job.id)).toContain(result.jobId);
    expect(currentJobs(f.store)[f.parent.id]).toEqual(before);
  });

  it("admits a real configured BYOK approver without using the stale supplied owner role", async () => {
    const f = await recoveryFixture({ role: "approver", runtime: "byok:openai" });
    expect(resolveRuntimeId({ config: f.config, project: f.project })).toBe("openai");
    const result = await f.service.createRecoveryJob(f.parent, f.input({ caller: { ...f.caller, role: "owner" } }));
    expect(result).toMatchObject({ ok: true, job: { state: "awaiting-approval", callerRole: "approver" } });
    expect(result.job).not.toHaveProperty("runtime");
    expect(result.job).not.toHaveProperty("provider");
  });

  it.each(["viewer", "removed"])("rechecks current %s authority before both creation and cached replay", async (change) => {
    const f = await recoveryFixture();
    const accepted = await f.service.createRecoveryJob(f.parent, f.input());
    expect(accepted.ok).toBe(true);
    f.config.allowlist = change === "removed" ? [] : [{ ...f.caller, role: "viewer" }];
    const replay = await f.service.createRecoveryJob(f.parent, f.input());
    const fresh = await f.service.createRecoveryJob(f.parent, f.input({ updateId: "another-delivery" }));
    expect(replay).toMatchObject({ ok: false, error: change === "removed" ? "CALLER_NOT_ALLOWED" : "ROLE_DENIED" });
    expect(fresh.ok).toBe(false);
    expect(children(f)).toHaveLength(1);
  });

  it.each(["sdk", "key", "provider"])("rechecks changed BYOK %s eligibility before cached acceptance", async (change) => {
    const f = await recoveryFixture({ role: "approver", runtime: "byok:openai" });
    const accepted = await f.service.createRecoveryJob(f.parent, f.input());
    expect(accepted.ok).toBe(true);
    if (change === "sdk") f.project.runtime = "copilot-sdk";
    if (change === "key") f.env.FIXTURE_RECOVERY_KEY = "";
    if (change === "provider") delete f.config.runtimes.byok.openai;
    const replay = await f.service.createRecoveryJob(f.parent, f.input());
    expect(replay).toMatchObject({
      ok: false,
      error: change === "sdk" ? "RUNTIME_POLICY_DENIED" : change === "key" ? "BYOK_KEY_MISSING" : "BYOK_CONFIG_INVALID",
    });
    expect(children(f)).toHaveLength(1);
  });

  it("preserves a current config getter receiver and refuses explicit null instead of its old snapshot", async () => {
    const f = await recoveryFixture();
    const services = {
      ...f.services, liveConfig: f.config,
      getConfig() { return this.liveConfig; },
    };
    const input = f.input({ services });
    expect((await f.service.createRecoveryJob(f.parent, input)).ok).toBe(true);
    services.liveConfig = null;
    expect(await f.service.createRecoveryJob(f.parent, input))
      .toMatchObject({ ok: false, error: "SERVICE_UNAVAILABLE" });
    expect(children(f)).toHaveLength(1);
  });

  it.each(["project", "chat", "topic", "caller", "adapter"])("refuses wrong %s scope even after a recovery was accepted", async (scope) => {
    const f = await recoveryFixture();
    expect((await f.service.createRecoveryJob(f.parent, f.input())).ok).toBe(true);
    const otherCaller = { ...f.caller, userId: "fixture-other-caller" };
    f.config.allowlist.push(otherCaller);
    const overrides = {
      project: { project: { ...f.project, id: "fixture-other-project" } },
      chat: { chatId: "fixture-other-chat" },
      topic: { threadId: "fixture-other-topic" },
      caller: { caller: otherCaller },
      adapter: { adapter: "fixture-other-adapter" },
    };
    expect((await f.service.createRecoveryJob(f.parent, f.input(overrides[scope]))).ok).toBe(false);
    expect(children(f)).toHaveLength(1);
  });

  it("refuses a moved current project route without rewriting the failed parent", async () => {
    const f = await recoveryFixture();
    expect((await f.service.createRecoveryJob(f.parent, f.input())).ok).toBe(true);
    const before = currentJobs(f.store)[f.parent.id];
    f.project.channel.topicId = "fixture-moved-topic";
    expect((await f.service.createRecoveryJob(f.parent, f.input())).ok).toBe(false);
    expect(currentJobs(f.store)[f.parent.id]).toEqual(before);
    expect(children(f)).toHaveLength(1);
  });

  it("requires a durable actually failed parent, not a caller's failed-looking object", async () => {
    const f = await recoveryFixture();
    const invented = { ...f.parent, id: "abcdef0123456789abcdef02" };
    expect((await f.service.createRecoveryJob(invented, f.input())).ok).toBe(false);
    const other = {
      ...createJob({ id: "abcdef0123456789abcdef03", type: "task", projectId: f.project.id }).job,
      callerId: f.caller.userId, chatId: f.parent.chatId, threadId: f.parent.threadId,
    };
    f.store.append(JOBS_STREAM, { kind: "job.created", job: other });
    expect(await f.service.createRecoveryJob({ ...other, state: "failed" }, f.input()))
      .toMatchObject({ ok: false, error: "NOT_RETRYABLE" });
    expect(children(f)).toHaveLength(0);
  });

  it.each([{ runtime: "openai" }, { provider: { type: "openai" } }])("rejects unsigned input execution overrides %j", async (override) => {
    const f = await recoveryFixture();
    expect(await f.service.createRecoveryJob(f.parent, f.input(override)))
      .toMatchObject({ ok: false, error: "RUNTIME_POLICY_DENIED" });
    expect(children(f)).toHaveLength(0);
  });

  it("deduplicates one exact delivery but retains distinct and identity-less manual retries", async () => {
    const f = await recoveryFixture();
    const [first, duplicate] = await Promise.all([
      f.service.createRecoveryJob(f.parent, f.input()),
      f.service.createRecoveryJob(f.parent, f.input()),
    ]);
    expect(duplicate.jobId).toBe(first.jobId);
    const second = await f.service.createRecoveryJob(f.parent, f.input({ updateId: "different-delivery" }));
    expect(second.jobId).not.toBe(first.jobId);
    const manualOne = await f.service.createRecoveryJob(f.parent, f.input({ updateId: undefined, messageId: undefined }));
    const manualTwo = await f.service.createRecoveryJob(f.parent, f.input({ updateId: undefined, messageId: undefined }));
    expect(manualOne.jobId).not.toBe(manualTwo.jobId);
    expect(children(f)).toHaveLength(4);
    expect(requestIdentity(currentJobs(f.store)[first.jobId])).toEqual({
      adapter: "telegram", updateId: "retry-delivery", type: "plan", projectId: f.project.id,
      callerId: f.caller.userId, chatId: f.parent.chatId, threadId: f.parent.threadId, parentId: f.parent.id,
    });
  });

  it("passes current delivery metadata through the real /retry registry handler", async () => {
    const f = await recoveryFixture();
    const command = COMMANDS.find((candidate) => candidate.name === "retry");
    expect(command.available).toBe(true);
    await f.router.route(f.update({ updateId: 71, messageId: 72 }));
    expect(children(f)).toHaveLength(1);
    expect(children(f)[0]).toMatchObject({
      callerRole: "owner", adapter: "telegram", updateId: "71", messageId: "72",
      chatId: f.parent.chatId, threadId: f.parent.threadId,
    });
  });

  it("resolves /retry latest for the current requester instead of a newer failed job from another caller", async () => {
    const f = await recoveryFixture();
    const otherCaller = { ...f.caller, userId: "fixture-other-caller" };
    f.config.allowlist.push(otherCaller);
    vi.advanceTimersByTime(60_000);
    let other = {
      ...f.parent,
      ...createJob({ id: "bbbbbbbb23456789abcdef01", type: "plan", projectId: f.project.id }).job,
      callerId: otherCaller.userId, updateId: "other-parent-delivery",
      createdAt: new Date(Date.now()).toISOString(),
    };
    f.store.append(JOBS_STREAM, { kind: "job.created", job: other });
    other = move(f.store, other, "awaiting-approval");
    const approval = f.approvals.createApproval(other);
    f.approvals.issue(other, { approval });
    expect(await f.approvals.decide({
      payload: approval.approve.slice(2), caller: otherCaller, chatId: other.chatId, threadId: other.threadId,
    })).toMatchObject({ ok: true });
    other = currentJobs(f.store)[other.id];
    for (const state of ["leased", "running", "failed"]) other = move(f.store, other, state);
    await f.router.route(f.update({ text: "/retry latest" }));
    expect(children(f)).toHaveLength(1);
    expect(Object.values(currentJobs(f.store)).filter((job) => job.parentId === other.id)).toHaveLength(0);
  });

  it("treats repeat f taps on the same failure card as one scoped action while preserving the first delivery", async () => {
    const f = await recoveryFixture();
    expect(callbackFor("f").available).toBe(true);
    const callback = f.update({
      kind: "callback", data: `f:r:${f.parent.id.slice(0, 8)}`,
      messageId: "failure-card", callbackId: "first-callback", updateId: "first-tap",
    });
    await Promise.all([
      f.router.route(callback),
      f.router.route({ ...callback, callbackId: "second-callback", updateId: "second-tap" }),
    ]);
    expect(children(f)).toHaveLength(1);
    expect(children(f)[0]).toMatchObject({
      adapter: "telegram", updateId: "first-tap", messageId: "failure-card", callerRole: "owner",
    });
    await f.service.stop();
    f.store = createStore(f.stateDirectory);
    f.services.store = f.store;
    f.service = f.start({ store: f.store });
    const restarted = createRouter({ config: f.config, registry: f.registry, store: f.store, channel: f.channel, services: f.services });
    await restarted.route({ ...callback, callbackId: "third-callback", updateId: "third-tap" });
    expect(children(f)).toHaveLength(1);
  });

  it.each(["retry", "resume"])("recovers a committed %s child after marker failure and actual store/service restart", async (mode) => {
    const f = await recoveryFixture();
    if (mode === "resume") f.service.onLaneEvent({ jobId: f.parent.id, seq: 1, type: "slice", data: { index: 2, total: 5 } });
    await Promise.resolve();
    await Promise.resolve();
    const restore = failRecoveryMarkerOnce(f);
    const input = f.input({ mode });
    const failedReceipt = await f.service.createRecoveryJob(f.parent, input);
    expect(failedReceipt.ok).toBe(false);
    expect(children(f)).toHaveLength(1);
    const committed = children(f)[0];
    restore();
    await f.service.stop();
    f.store = createStore(f.stateDirectory);
    f.services.store = f.store;
    f.service = f.start({ store: f.store });
    const result = await f.service.createRecoveryJob(f.parent, input);
    expect(result).toMatchObject({ ok: true, jobId: committed.id, existing: true });
    expect(children(f)).toHaveLength(1);
    expect(children(f)[0]).toMatchObject({
      quorum: "power", resumeFrom: mode === "resume" ? 3 : 1, state: "awaiting-approval",
    });
    expect(rows(f.store, "progress").filter((record) => record.kind === "progress.recovered")).toHaveLength(1);
    expect(currentJobs(f.store)[f.parent.id]).toEqual(f.parent);
  });

  it("recovers a callback's committed child after response failure instead of creating another on a new tap", async () => {
    const f = await recoveryFixture();
    const callback = f.update({
      kind: "callback", data: `f:r:${f.parent.id.slice(0, 8)}`,
      messageId: "failure-card", callbackId: "first-callback", updateId: "first-tap",
    });
    f.channel.send.mockRejectedValueOnce(new Error("fixture response unavailable"));
    expect(await f.router.route(callback)).toEqual({ handled: true });
    await expect(f.channel.send.mock.results[0].value).rejects.toThrow("fixture response unavailable");
    const committed = children(f)[0];
    await f.service.stop();
    f.store = createStore(f.stateDirectory);
    f.services.store = f.store;
    f.service = f.start({ store: f.store });
    const restarted = createRouter({ config: f.config, registry: f.registry, store: f.store, channel: f.channel, services: f.services });
    await restarted.route({ ...callback, callbackId: "second-callback", updateId: "second-tap" });
    expect(children(f)).toHaveLength(1);
    expect(children(f)[0].id).toBe(committed.id);
  });

  it("does not trust a callback recovery receipt whose durable child has another actual scope", async () => {
    const f = await recoveryFixture();
    const request = requestIdentity({
      adapter: "telegram", updateId: "first-tap", type: "plan", projectId: f.project.id,
      callerId: f.caller.userId, chatId: f.parent.chatId, threadId: f.parent.threadId, parentId: f.parent.id,
    });
    const child = {
      ...createJob({
        id: "abcdef0123456789abcdef04", type: "plan", projectId: "fixture-other-project",
        parentId: f.parent.id,
      }).job,
      callerId: "fixture-other-caller", adapter: "telegram", updateId: "first-tap",
      chatId: "fixture-other-chat", threadId: "fixture-other-topic",
      recoveryMode: "retry",
      recoveryRequest: { ...request, updateId: '["retry","callback","failure-card",null]' },
    };
    f.store.append(JOBS_STREAM, { kind: "job.created", job: child });
    move(f.store, child, "awaiting-approval");
    const result = await f.service.createRecoveryJob(f.parent, f.input({
      updateId: "second-tap", messageId: "failure-card", fromCallback: true,
    }));
    expect(result).toMatchObject({ ok: false, error: "RECOVERY_REQUEST_CONFLICT" });
    expect(result).not.toHaveProperty("jobId");
    expect(children(f)).toHaveLength(1);
  });

  it("repairs an actually durable queued child after restart without creating or approving another child", async () => {
    const f = await recoveryFixture();
    const request = requestIdentity({
      adapter: "telegram", updateId: "retry-delivery", type: "plan", projectId: f.project.id,
      callerId: f.caller.userId, chatId: f.parent.chatId, threadId: f.parent.threadId, parentId: f.parent.id,
    });
    const choices = approvedChoicesFor({
      job: f.parent, approval: consumedApprovalFor({ store: f.store, config: f.config, job: f.parent }),
    });
    const child = {
      ...createJob({
        id: "abcdef0123456789abcdef05", type: "plan", projectId: f.project.id, parentId: f.parent.id,
      }).job,
      ...request, callerRole: f.caller.role, planPath: f.parent.planPath,
      quorum: choices.quorum, models: f.parent.models, resumeFrom: f.parent.resumeFrom,
      recoveryMode: "retry",
      recoveryRequest: { ...request, updateId: '["retry","delivery","retry-delivery",null]' },
    };
    f.store.append(JOBS_STREAM, { kind: "job.created", job: child });
    await f.service.stop();
    f.store = createStore(f.stateDirectory);
    f.services.store = f.store;
    f.service = f.start({ store: f.store });
    const result = await f.service.createRecoveryJob(f.parent, f.input());
    expect(result).toMatchObject({ ok: true, jobId: child.id, existing: true });
    expect(children(f)).toHaveLength(1);
    expect(children(f)[0]).toMatchObject({ state: "awaiting-approval", quorum: "power" });
    expect(rows(f.store, JOBS_STREAM).filter((record) => record.kind === "job.transition"
      && record.jobId === child.id)).toEqual([expect.objectContaining({
      from: "queued", to: "awaiting-approval", reason: "progress:retry",
    })]);
    expect(consumedApprovalFor({ store: f.store, config: f.config, job: children(f)[0] })).toBeNull();
  });

  it("validates scalar identity even on identity-less requests before a coercible caller can grant authority", async () => {
    const f = await recoveryFixture();
    const result = await f.service.createRecoveryJob(f.parent, f.input({
      updateId: undefined, caller: { userId: { toString: () => f.caller.userId }, role: "owner" },
    }));
    expect(result).toMatchObject({ ok: false, error: "REQUEST_BAD_IDENTITY" });
    expect(children(f)).toHaveLength(0);
  });

  it("requires the child's own consumed approval and signs its retained quorum/resume/model choices", async () => {
    const f = await recoveryFixture();
    f.service.onLaneEvent({ jobId: f.parent.id, seq: 1, type: "slice", data: { index: 2, total: 5 } });
    const recovered = await f.service.createRecoveryJob(f.parent, f.input({
      mode: "resume", updateId: "resume-delivery", quorum: "false", resumeFrom: 99,
      models: { work: "input-model" },
    }));
    expect(recovered.ok).toBe(true);
    const prepareLease = createLeasePreparer({
      ctx: { store: f.store, config: f.config }, laneConfig: f.config.lanes[0], now: f.services.now,
    });
    await expect(prepareLease(recovered.job)).rejects.toMatchObject({ code: "LEASE_PROOF_MISSING" });
    const approval = f.approvals.createApproval(recovered.job);
    f.approvals.issue(recovered.job, { approval });
    expect(await f.approvals.decide({
      payload: approval.approve.slice(2), caller: f.caller,
      chatId: recovered.job.chatId, threadId: recovered.job.threadId,
    })).toMatchObject({ ok: true, jobId: recovered.jobId });
    const prepared = await prepareLease(currentJobs(f.store)[recovered.jobId]);
    expect(prepared).toMatchObject({
      quorum: "power", resumeFrom: 3, runtime: "copilot-sdk",
      project: { models: { work: "fixture-approved-model" } },
      leaseGrant: { approval: { kind: "consumed" } },
    });
    const key = randomBytes(32).toString("hex");
    const subject = "fixture-worker";
    const grant = signGrant({ grant: prepared.leaseGrant, subject, key });
    const signed = { ...prepared, leaseGrant: grant };
    const verification = { grant, job: signed, subject, key, laneId: f.project.homeLane, now: f.services.now };
    expect(verifyGrant(verification)).toBe(true);
    for (const override of [
      { quorum: "false" }, { resumeFrom: 99 },
      { project: { ...prepared.project, models: { work: "input-model" } } },
    ]) {
      expect(() => verifyGrant({ ...verification, job: { ...signed, ...override } }))
        .toThrowError(expect.objectContaining({ code: "LEASE_GRANT_INVALID" }));
    }
    f.project.models.work = "fixture-later-model";
    const approvedConfig = executionConfigFor({ job: signed, config: f.config });
    expect(approvedConfig.projects[0].models.work).toBe("fixture-approved-model");
    expect(children(f)).toHaveLength(1);
    expect(currentJobs(f.store)[f.parent.id]).toEqual(f.parent);
  });

  it("keeps an actually read-only skill recovery queued with stored arguments and no synthetic approval", async () => {
    const f = await recoveryFixture({ type: "skill", readOnly: true });
    const result = await f.service.createRecoveryJob(f.parent, f.input({ readOnly: false, args: ["injected"] }));
    expect(result).toMatchObject({
      ok: true, job: { type: "skill", readOnly: true, mutating: false, state: "queued", args: ["fixture-argument"] },
    });
    expect(result.text).toContain("queued");
    expect(rows(f.store, "approvals")).toEqual([]);
  });
});
