import {
  bindApprovalService,
  createApprovalService,
} from "../approvals.mjs";

let service = null;
let unbind = null;
let interval = null;
let context = null;
let inFlight = false;
let activeTick = null;

function appendAudit(ctx, record) {
  try {
    ctx?.store?.append?.("audit", record);
  } catch {
    ctx?.logger?.error?.("Claw audit write failed");
  }
}

function projectFor(ctx, job) {
  return ctx.projectRegistry?.byId?.(job.projectId)
    ?? (ctx.config?.projects ?? []).find((project) => project.id === job.projectId);
}

async function runTick() {
  if (!service || !context) return;
  const ctx = context;
  const activeService = service;
  if (activeService.channel) {
    for (const job of activeService.pendingWithoutCard()) {
      if (job.chatId === undefined || job.chatId === null || String(job.chatId).length === 0) {
        appendAudit(ctx, { kind: "approval-card-skipped", reason: "missing-chat", jobId: job.id });
        continue;
      }
      const approval = activeService.createApproval(job);
      const card = await activeService.buildApprovalCard({
        job,
        project: projectFor(ctx, job),
        approval,
      });
      if (!card || card.error === "ESTIMATE_UNAVAILABLE") {
        appendAudit(ctx, { kind: "approval-card-skipped", reason: "estimate-unavailable", jobId: job.id });
        continue;
      }
      try {
        const sent = await activeService.channel.send({
          chatId: String(job.chatId),
          threadId: job.threadId,
          text: card.text,
          replyMarkup: card.keyboard,
        });
        const messageRef = Array.isArray(sent) ? sent[0] : sent;
        activeService.issue(job, { messageRef, approval });
      } catch (error) {
        appendAudit(ctx, {
          kind: "approval-card-failed",
          reason: typeof error?.code === "string" ? error.code : "CHANNEL_SEND_FAILED",
          jobId: job.id,
        });
      }
    }
  }
  try {
    const expired = activeService.sweep();
    if (!activeService.channel) return;
    for (const record of expired) {
      const ref = record.messageRef;
      if (!ref?.chatId || !ref?.messageId) continue;
      try {
        await activeService.channel.edit({
          chatId: ref.chatId,
          messageId: ref.messageId,
          threadId: ref.threadId ?? record.threadId,
          text: "⌛ Expired",
          replyMarkup: { inline_keyboard: [] },
        });
      } catch {
        appendAudit(ctx, { kind: "approval-card-edit-failed", reason: "CHANNEL_EDIT_FAILED", jobId: record.jobId });
      }
    }
  } catch (error) {
    appendAudit(ctx, {
      kind: "approval-sweep-failed",
      reason: typeof error?.code === "string" ? error.code : "APPROVAL_SWEEP_FAILED",
    });
  }
}

function tick() {
  if (inFlight) return activeTick ?? Promise.resolve();
  inFlight = true;
  activeTick = runTick().catch((error) => {
    context?.logger?.error?.("Approval tick failed", {
      code: typeof error?.code === "string" ? error.code : "APPROVAL_TICK_FAILED",
    });
  }).finally(() => {
    inFlight = false;
    activeTick = null;
  });
  return activeTick;
}

export default {
  name: "approvals",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    context = ctx;
    service = createApprovalService({
      store: ctx.store,
      bus: ctx.bus,
      mcp: ctx.mcp,
      channel: ctx.channel,
      logger: ctx.logger,
      now: ctx.now ?? Date.now,
      ttlMs: ctx.approvalTtlMs,
    });
    unbind = bindApprovalService(service);
    await tick();
    interval = setInterval(() => { void tick(); }, ctx.approvalIntervalMs ?? 30_000);
    interval.unref?.();
  },
  async stop() {
    if (interval) clearInterval(interval);
    interval = null;
    unbind?.();
    unbind = null;
    if (activeTick) await activeTick;
    service = null;
    context = null;
  },
  tick,
  snapshot(ctx = {}) {
    if (!ctx.store) return { pending: 0 };
    return createApprovalService({ store: ctx.store }).snapshot();
  },
};
