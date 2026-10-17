import { createApprovalService, issueApproval } from "../approvals.mjs";
import { collectDigest, renderDigest, sendDigest } from "../digest.mjs";
import { prepareSkill } from "../commands/skill.mjs";
import { ClawError } from "../errors.mjs";
import { ROLES, SCHEDULE_REQUEST_ADAPTER } from "../enums.mjs";
import { currentCaller } from "../handlers/c2-command-context.mjs";
import { currentJobs } from "../jobs/model.mjs";
import { requestKey } from "../jobs/request-identity.mjs";
import { createScheduler } from "../scheduler.mjs";

let scheduler = null;
let channelWarningLogged = false;

function appendAudit(ctx, record) {
  if (typeof ctx.audit === "function") {
    ctx.audit(record);
    return;
  }
  ctx.store?.append?.("audit", record);
}

function projectFor(ctx, schedule) {
  const projectId = schedule.project;
  return ctx.projectRegistry?.byId?.(projectId)
    ?? (ctx.config?.projects ?? []).find((project) => project.id === projectId);
}

function currentOwner(ctx, caller) {
  const authority = currentCaller(ctx.config, caller);
  if (!authority || authority.role !== ROLES[0]
    || authority.userId === undefined || authority.userId === null
    || !String(authority.userId).trim()) {
    throw new ClawError("SCHEDULE_OWNER_UNAVAILABLE");
  }
  return { userId: String(authority.userId), channel: authority.channel, role: authority.role };
}

function scheduleRequest({ ctx, schedule, slot, project, caller }) {
  if (typeof slot?.key !== "string" || !slot.key) throw new ClawError("SCHEDULE_SLOT_INVALID");
  const generalChat = ctx.config?.channels?.telegram?.generalChat;
  return {
    adapter: SCHEDULE_REQUEST_ADAPTER,
    updateId: `schedule:${schedule.id}:${slot.key}`,
    type: "skill",
    projectId: project.id,
    callerId: caller.userId,
    chatId: generalChat?.chatId ?? null,
    threadId: generalChat?.topicId ?? null,
    parentId: null,
  };
}

function preparedSlotJob({ store, prepared, request, skill }) {
  if (!prepared || typeof prepared.jobId !== "string" || !prepared.jobId
    || typeof prepared.state !== "string" || !prepared.state) {
    throw new ClawError("SCHEDULE_SKILL_JOB_MISSING");
  }
  const job = currentJobs(store)[prepared.jobId];
  if (!job) throw new ClawError("SCHEDULE_SKILL_JOB_MISSING");
  if (requestKey(job) !== requestKey(request) || job.skill !== skill || job.state !== prepared.state
    || Object.hasOwn(job, "runtime") || Object.hasOwn(job, "provider")) {
    throw new ClawError("SCHEDULE_SKILL_JOB_MISMATCH");
  }
  return job;
}

async function showApprovalCard({ ctx, service, job, approval }) {
  const card = await service.buildApprovalCard({ job, project: projectFor(ctx, { project: job.projectId }), approval });
  if (!card?.text || !ctx.channel) return false;
  await ctx.channel.send({
    chatId: String(job.chatId),
    threadId: job.threadId ?? null,
    text: card.text,
    replyMarkup: card.keyboard,
  });
  return true;
}

async function dispatchDigest(ctx) {
  const data = await collectDigest({
    store: ctx.store,
    config: ctx.config,
    mcp: ctx.mcp,
    now: ctx.now ?? Date.now,
    timeZone: ctx.config.timezone,
  });
  const rendered = renderDigest(data, { secrets: ctx.secrets });
  await sendDigest({
    store: ctx.store,
    channel: ctx.channel,
    config: ctx.config,
    data,
    secrets: ctx.secrets,
    now: ctx.now ?? Date.now,
    rendered,
  });
}

async function dispatchSkill(schedule, slot, ctx) {
  if (schedule.kind !== "skill") throw new ClawError("SCHEDULE_KIND_INVALID");

  const project = projectFor(ctx, schedule);
  if (!project) throw new ClawError("SCHEDULE_PROJECT_MISSING");
  if (typeof schedule.skill !== "string" || !schedule.skill.trim()) {
    throw new ClawError("SCHEDULE_SKILL_MISSING");
  }
  const owner = (ctx.config?.allowlist ?? []).find((entry) => entry.role === ROLES[0]);
  const caller = currentOwner(ctx, owner);
  const request = scheduleRequest({ ctx, schedule, slot, project, caller });
  const prepared = await prepareSkill({
    store: ctx.store,
    mcp: { call: (tool, args) => ctx.mcp.call(project.id, tool, args) },
    project,
    caller,
    chatId: request.chatId,
    threadId: request.threadId,
    config: ctx.config,
    getConfig: () => ctx.config,
    secrets: ctx.secrets,
    lanes: ctx.lanes,
    now: ctx.now ?? Date.now,
    adapter: request.adapter,
    updateId: request.updateId,
  }, { args: [schedule.skill] });
  currentOwner(ctx, caller);
  const job = preparedSlotJob({ store: ctx.store, prepared, request, skill: schedule.skill });
  if (job.state !== "awaiting-approval" || schedule.preApproved !== true) return;
  await preapproveSkill({ ctx, schedule, job, caller });
}

async function preapproveSkill({ ctx, schedule, job, caller }) {
  const jobId = job.id;
  const owner = currentOwner(ctx, caller);
  if (job.chatId === undefined || job.chatId === null || !String(job.chatId).trim()) {
    appendAudit(ctx, {
      v: 1,
      kind: "schedule.preapproved-fallback",
      scheduleId: schedule.id,
      jobId,
      reason: "general-chat-unavailable",
    });
    return;
  }
  const approvalService = createApprovalService({
    store: ctx.store,
    bus: ctx.bus,
    channel: ctx.channel,
    logger: ctx.logger,
    now: ctx.now ?? Date.now,
  });
  const approval = issueApproval({
    jobId,
    chatId: job.chatId,
    threadId: job.threadId,
    requesterId: job.callerId,
    now: ctx.now ?? Date.now,
  });
  approvalService.issue(job, { approval });
  const approverId = String(owner.userId);
  const decision = await approvalService.decide({
    payload: approval.approve.slice(2),
    caller: owner,
    chatId: job.chatId,
    threadId: job.threadId,
  });
  if (decision.ok) {
    appendAudit(ctx, {
      v: 1,
      kind: "schedule.preapproved",
      scheduleId: schedule.id,
      jobId,
      approverId,
    });
    return;
  }
  appendAudit(ctx, {
    v: 1,
    kind: "schedule.preapproved-fallback",
    scheduleId: schedule.id,
    jobId,
    reason: decision.reason ?? "approval-decision-failed",
  });
  try {
    await showApprovalCard({ ctx, service: approvalService, job, approval });
  } catch (error) {
    appendAudit(ctx, {
      v: 1,
      kind: "schedule.approval-card-failed",
      scheduleId: schedule.id,
      jobId,
      reason: typeof error?.code === "string" ? error.code : "CHANNEL_SEND_FAILED",
    });
  }
}

async function dispatch(schedule, slot, ctx) {
  if (schedule.kind === "digest") return dispatchDigest(ctx);
  return dispatchSkill(schedule, slot, ctx);
}

export default {
  name: "scheduler",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    const schedules = ctx.config?.schedules ?? [];
    if (!schedules.length) return;
    if (!ctx.channel && !channelWarningLogged) {
      channelWarningLogged = true;
      ctx.logger?.error?.("SCHEDULER_CHANNEL_UNAVAILABLE", {
        code: "SCHEDULER_CHANNEL_UNAVAILABLE",
      });
    }
    scheduler = createScheduler({
      store: ctx.store,
      schedules,
      timeZone: ctx.config.timezone,
      run: (schedule, slot) => dispatch(schedule, slot, ctx),
      logger: ctx.logger,
      audit: (record) => appendAudit(ctx, record),
      now: ctx.now ?? Date.now,
      tickMs: ctx.schedulerTickMs,
    });
    await scheduler.start();
  },
  async stop() {
    const active = scheduler;
    scheduler = null;
    await active?.stop();
  },
  snapshot(ctx = {}) {
    const schedules = scheduler?.snapshot()
      ?? (ctx.config?.schedules ?? []).map(({ id, kind, at }) => ({
        id,
        kind,
        at,
        lastRunAt: null,
        status: "pending",
      }));
    return { schedules };
  },
};
