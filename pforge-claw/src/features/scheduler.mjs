import { createApprovalService, issueApproval } from "../approvals.mjs";
import { collectDigest, renderDigest, sendDigest } from "../digest.mjs";
import { prepareSkill } from "../commands/skill.mjs";
import { ClawError } from "../errors.mjs";
import { currentJobs } from "../jobs/model.mjs";
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

function jobFromText(text) {
  const match = /\b([0-9a-f]{24})\b/i.exec(String(text ?? ""));
  return match?.[1] ?? null;
}

function latestScheduledJob(store, requesterId) {
  let latest = null;
  for (const { record } of store.read("jobs")) {
    if (record?.kind === "job.created" && record.job?.callerId === requesterId) latest = record.job;
  }
  return latest ?? Object.values(currentJobs(store))
    .findLast((job) => job.callerId === requesterId) ?? null;
}

async function showApprovalCard(ctx, service, job, approval) {
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

async function dispatch(schedule, _slot, ctx) {
  if (schedule.kind === "digest") {
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
    return;
  }
  if (schedule.kind !== "skill") throw new ClawError("SCHEDULE_KIND_INVALID");

  const project = projectFor(ctx, schedule);
  const generalChat = ctx.config?.channels?.telegram?.generalChat;
  if (!project) throw new ClawError("SCHEDULE_PROJECT_MISSING");
  if (typeof schedule.skill !== "string" || !schedule.skill.trim()) {
    throw new ClawError("SCHEDULE_SKILL_MISSING");
  }
  const requesterId = `scheduler:${schedule.id}`;
  const result = await prepareSkill({
    store: ctx.store,
    mcp: { call: (tool, args) => ctx.mcp.call(project.id, tool, args) },
    project,
    caller: { userId: requesterId, role: "owner" },
    chatId: generalChat?.chatId ?? null,
    threadId: generalChat?.topicId ?? null,
  }, { args: [schedule.skill] });
  let jobId = jobFromText(result?.text);
  let job = jobId ? currentJobs(ctx.store)[jobId] : null;
  if (!job) {
    job = latestScheduledJob(ctx.store, requesterId);
    jobId = job?.id ?? null;
  }
  if (!job) throw new ClawError("SCHEDULE_SKILL_JOB_MISSING");
  if (job.state !== "awaiting-approval" || schedule.preApproved !== true) return;

  const owner = (ctx.config?.allowlist ?? []).find((entry) => entry.role === "owner");
  if (!owner || job.chatId === undefined || job.chatId === null) {
    appendAudit(ctx, {
      v: 1,
      kind: "schedule.preapproved-fallback",
      scheduleId: schedule.id,
      jobId,
      reason: !owner ? "owner-unavailable" : "general-chat-unavailable",
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
    requesterId,
    now: ctx.now ?? Date.now,
  });
  approvalService.issue(job, { approval });
  const approverId = String(owner.userId);
  const decision = await approvalService.decide({
    payload: approval.approve.slice(2),
    caller: { role: "owner", userId: approverId },
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
    await showApprovalCard(ctx, approvalService, job, approval);
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
