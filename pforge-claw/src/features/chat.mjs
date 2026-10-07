import path from "node:path";
import { createRegistry } from "../registry.mjs";
import { resolveHome } from "../config.mjs";
import { createAskService } from "../handlers/ask.mjs";
import { createTelegramAdapter } from "../channels/telegram/poller.mjs";
import { bindProposalService } from "../callbacks/p.mjs";

let channel;
let service;
let unbind = null;

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
      channel = createTelegramAdapter({
        config: ctx.config,
        secrets: ctx.secrets,
        stateDir: path.join(ctx.home ?? resolveHome(), "state"),
        store: ctx.store,
        onUpdate: (update) => router.route(update),
        onError: (error) => ctx.logger?.error?.("Telegram poller error", { code: error?.code ?? "TELEGRAM_ERROR" }),
      });
      const askContext = {
        ...ctx,
        channel,
        config: ctx.config,
        features: ctx.features,
      };
      service = createAskService(askContext);
      const commandRegistry = COMMANDS.map((command) => {
        if (command.name !== "ask" && command.name !== "new") return command;
        return {
          ...command,
          handle: (context, args) => command.handle.call({ service }, context, args),
        };
      });
      askContext.commands = commandRegistry;
      const registry = ctx.projectRegistry ?? createRegistry(ctx.config);
      router = createRouter({
        config: ctx.config,
        channel,
        store: ctx.store,
        registry,
        logger: ctx.logger,
        commandRegistry,
      });
      unbind = bindProposalService(service);
      await router.syncMenus();
      await channel.start();
    } catch (error) {
      unbind?.();
      unbind = null;
      await channel?.stop();
      await ctx.mcp.closeAll();
      channel = null;
      service = null;
      throw error;
    }
  },
  async stop(ctx) {
    await channel?.stop();
    unbind?.();
    unbind = null;
    await ctx.mcp.closeAll();
    channel = null;
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
