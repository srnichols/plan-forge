import path from "node:path";
import { createRegistry } from "../registry.mjs";
import { resolveHome } from "../config.mjs";
import { createAskService } from "../handlers/ask.mjs";
import { createTelegramAdapter } from "../channels/telegram/poller.mjs";
import { bindProposalService } from "../callbacks/p.mjs";

let channel;
let service;
let unbind = null;

function reportPollerError(ctx, error) {
  ctx.logger?.error?.("Telegram poller error", { code: error?.code ?? "TELEGRAM_ERROR" });
}

function createChatChannel(ctx) {
  return createTelegramAdapter({
    config: ctx.config,
    secrets: ctx.secrets,
    stateDir: path.join(ctx.home ?? resolveHome(), "state"),
    store: ctx.store,
    now: ctx.telegramTiming?.now ?? Date.now,
    sleep: ctx.telegramTiming?.sleep,
    onUpdate: (update) => ctx.onTelegramUpdate(update),
    onError: (error) => reportPollerError(ctx, error),
  });
}

function boundAskCommands(commands, askService) {
  return commands.map((command) => {
    if (command.name !== "ask" && command.name !== "new") return command;
    return {
      ...command,
      handle: (context, input) => command.handle.call({
        service: command.name === "ask" ? {
          ask: (args) => askService.ask({
            ...args, updateId: input.updateId, adapter: input.adapter, messageId: input.messageId,
            untrustedContext: input.untrustedContext,
          }),
        } : askService,
      }, context, input),
    };
  });
}

export default {
  name: "chat",
  available: true,
  async start(ctx) {
    let router;
    try {
      const [{ createRouter }, { COMMANDS }] = await Promise.all([
        import("../router.mjs"),
        import("../commands/index.mjs"),
      ]);
      channel = createChatChannel(ctx);
      ctx.channel = channel;
      ctx.onTelegramUpdate = (update) => router.route(update);
      const askContext = {
        ...ctx,
        channel,
        config: ctx.config,
        features: ctx.features,
      };
      service = createAskService(askContext);
      const commandRegistry = boundAskCommands(COMMANDS, service);
      askContext.commands = commandRegistry;
      const registry = ctx.projectRegistry ?? createRegistry(ctx.config);
      router = createRouter({
        config: ctx.config,
        channel,
        store: ctx.store,
        registry,
        logger: ctx.logger,
        commandRegistry,
        services: { ...ctx.services, secrets: ctx.secrets, lanes: ctx.lanes },
        clients: ctx.mcp,
        now: ctx.now ?? Date.now,
      });
      askContext.control = router;
      unbind = bindProposalService(service);
      await router.syncMenus();
      if ((ctx.config?.channels?.telegram?.mode ?? "poll") === "poll") {
        void Promise.resolve(channel.start()).catch((error) => reportPollerError(ctx, error));
      }
    } catch (error) {
      unbind?.();
      unbind = null;
      await channel?.stop();
      channel = null;
      ctx.channel = null;
      service = null;
      throw error;
    }
  },
  async stop(ctx) {
    await channel?.stop();
    unbind?.();
    unbind = null;
    channel = null;
    if (ctx) ctx.channel = null;
    service = null;
  },
  snapshot(ctx, { project } = {}) {
    const records = ctx.store.fold("sessions", (state, record) => {
      if (project?.channel
        && (String(record.chatId ?? "") !== String(project.channel.chatId ?? "")
          || String(record.topicId ?? "") !== String(project.channel.topicId ?? ""))) return state;
      state.set(`${record.chatId}:${record.topicId ?? 0}`, record.sessionId ?? null);
      return state;
    }, new Map());
    return { sessions: [...records.values()].filter(Boolean).length };
  },
};
