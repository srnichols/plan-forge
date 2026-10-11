import {
  bindProgressService,
  createProgressService,
} from "../progress.mjs";

let service = null;
let unbind = null;
let context = null;
let listeners = [];
let channelWarningLogged = false;

function attach(ctx, eventName, handler) {
  ctx.bus?.on?.(eventName, handler);
  listeners.push([eventName, handler]);
}

function reportFailure(ctx, message, error) {
  ctx?.logger?.error?.(message, {
    code: typeof error?.code === "string" ? error.code : "PROGRESS_HANDLER_FAILED",
  });
}

export default {
  name: "progress",
  available: true,
  async start(ctx = {}) {
    await this.stop();
    context = ctx;
    service = createProgressService({
      store: ctx.store,
      bus: ctx.bus,
      channel: ctx.channel,
      mcp: ctx.mcp,
      secrets: ctx.secrets,
      lanes: ctx.lanes,
      now: ctx.now ?? Date.now,
      setTimer: ctx.setTimer ?? setTimeout,
      clearTimer: ctx.clearTimer ?? clearTimeout,
      logger: ctx.logger,
    });
    unbind = bindProgressService(service);
    if (!ctx.channel && !channelWarningLogged) {
      channelWarningLogged = true;
      ctx.logger?.error?.("PROGRESS_CHANNEL_UNAVAILABLE", { code: "PROGRESS_CHANNEL_UNAVAILABLE" });
    }
    attach(ctx, "job.transition", (event) => {
      void service?.onJobTransition(event).catch((error) => {
        reportFailure(ctx, "Progress transition handler failed", error);
      });
    });
    attach(ctx, "lane.event", (event) => {
      try {
        service?.onLaneEvent(event);
      } catch (error) {
        reportFailure(ctx, "Progress lane handler failed", error);
      }
    });
    attach(ctx, "job.finished", (event) => {
      try {
        service?.onJobFinished(event);
      } catch (error) {
        reportFailure(ctx, "Progress finish handler failed", error);
      }
    });
  },
  async stop() {
    if (context?.bus) {
      for (const [eventName, handler] of listeners) context.bus.off?.(eventName, handler);
    }
    listeners = [];
    const activeService = service;
    unbind?.();
    unbind = null;
    service = null;
    context = null;
    await activeService?.stop();
  },
  snapshot() {
    return service?.snapshot() ?? { tracked: 0, pendingEdits: 0 };
  },
};
