import { COMMANDS, parseText, suggest, visibleCommands } from "./commands/index.mjs";
import { callbackFor, parseCallback } from "./callbacks/index.mjs";
import { ClawError } from "./errors.mjs";
import { createRegistry } from "./registry.mjs";
import { classifyMessage, getTriageService } from "./capture.mjs";
import { getBudgetService } from "./budget.mjs";

const NEUTRAL_TOPIC_REPLY = "This topic isn't configured.";
const AUDIT_UNAVAILABLE_REPLY = "Audit unavailable; command not run.";
const GROUP_CHANNEL = "telegram";
const DEFAULT_MESSAGES_PER_MINUTE = 20;
const DEFAULT_RATE_WINDOW_MS = 60_000;

function createInboundLimiter({ perMinute, windowMs, now }) {
  const hits = new Map();
  const notified = new Set();
  return {
    admit(key) {
      const cutoff = now() - windowMs;
      const active = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
      if (active.length === 0) {
        hits.delete(key);
        notified.delete(key);
      }
      if (active.length >= perMinute) {
        const firstDrop = !notified.has(key);
        notified.add(key);
        return { ok: false, firstDrop };
      }
      active.push(cutoff + windowMs);
      hits.set(key, active);
      return { ok: true };
    },
  };
}

function createIndexes(config) {
  const identities = new Map();
  for (const entry of config.allowlist ?? []) {
    if (entry.channel === GROUP_CHANNEL) identities.set(String(entry.userId), entry);
  }
  const chatIds = new Set();
  for (const project of config.projects ?? []) {
    if (project.channel?.adapter === GROUP_CHANNEL && project.channel.chatId !== undefined) {
      chatIds.add(String(project.channel.chatId));
    }
  }
  const generalChat = config.channels?.telegram?.generalChat;
  if (generalChat?.chatId !== undefined) chatIds.add(String(generalChat.chatId));
  return { identities, chatIds };
}

function metadataFor(update) {
  return {
    adapter: update.adapter ?? null,
    chatId: update.chatId ?? null,
    threadId: update.threadId ?? null,
    userId: update.userId ?? null,
    updateId: update.updateId ?? null,
  };
}

async function safeAudit(store, logger, record) {
  try {
    store.append("audit", record);
    return true;
  } catch {
    logger?.error?.("Claw audit write failed");
    return false;
  }
}

async function checkIdentity(update, indexes, store, logger) {
  const userId = update.userId === undefined || update.userId === null ? null : String(update.userId);
  const chatId = update.chatId === undefined || update.chatId === null ? null : String(update.chatId);
  const caller = userId === null ? null : indexes.identities.get(userId);
  let reason = null;
  if (userId === null) reason = "missing-user";
  else if (chatId === null) reason = "missing-chat";
  else if (!caller) reason = "unknown-user";
  else if (!indexes.chatIds.has(chatId)) reason = "unknown-chat";
  if (!reason) return { caller, userId, chatId };
  await safeAudit(store, logger, { kind: "drop", reason, ...metadataFor(update) });
  return null;
}

function resolveContext(config, registry, chatId, threadId, { services, clients } = {}) {
  const project = registry.byChat(chatId, threadId);
  if (project?.channel?.adapter === GROUP_CHANNEL) {
    return {
      scope: "project",
      project,
      services,
      ...(clients ? { mcp: { call: (tool, args) => clients.call(project.id, tool, args) } } : {}),
    };
  }
  const general = config.channels?.telegram?.generalChat;
  if (general && String(general.chatId) === chatId
    && String(general.topicId ?? "") === String(threadId ?? "")) {
    return { scope: "general", services };
  }
  return null;
}

function refusalFor({ caller, command, context, config }) {
  if (!command.available) return { ok: false, reason: "unavailable", text: `/${command.name} isn't available yet.` };
  if (command.scope !== "both" && command.scope !== context.scope) {
    const location = command.scope === "project" ? "project topics" : "#general";
    return { ok: false, reason: "wrong-scope", text: `/${command.name} works in ${location}.` };
  }
  if (!command.roles.includes(caller.role)) {
    return { ok: false, reason: "role", text: `Your role can't run /${command.name}.` };
  }
  const ghcpRoles = config.policy?.ghcpRoles ?? ["owner"];
  if (command.mutating && !ghcpRoles.includes(caller.role)) {
    if ((config.policy?.nonOwnerRuntime ?? config.runtimes?.nonOwnerRuntime) === "byok-only") {
      return { ok: true, constraint: "byok-only" };
    }
    return { ok: false, reason: "runtime-policy", text: `/${command.name} requires an approved runtime.` };
  }
  return { ok: true };
}

function escapeToken(token) {
  return String(token).replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
}

async function sendText(channel, update, text) {
  await channel.send({ chatId: update.chatId, threadId: update.threadId, text });
}

async function replyRefusal({ channel, update, caller, command, context, config, store, logger }) {
  const decision = refusalFor({ caller, command, context, config });
  if (decision.ok) return decision;
  await safeAudit(store, logger, {
    kind: "refused", reason: decision.reason, name: command.name, userId: caller.userId,
    chatId: update.chatId, threadId: update.threadId, updateId: update.updateId,
  });
  await sendText(channel, update, decision.text);
  return decision;
}

async function dispatchCallback({ update, caller, context, channel, store, logger }) {
  await channel.answerCallback({ callbackId: update.callbackId });
  const parsed = parseCallback(update.data);
  const callback = parsed && callbackFor(parsed.prefix);
  if (!callback || !callback.available) {
    await safeAudit(store, logger, {
      kind: "callback-ignored", reason: callback ? "unavailable" : "unknown-prefix",
      ...metadataFor(update),
    });
    return;
  }
  if (callback.roles && !callback.roles.includes(caller.role)) {
    await safeAudit(store, logger, { kind: "callback-ignored", reason: "role", ...metadataFor(update) });
    return;
  }
  await callback.handle(context, { payload: parsed.payload, caller, ...metadataFor(update) });
}

function unknownCommandReply(token, caller, scope, commands) {
  const suggestion = suggest(token, visibleCommands({ role: caller.role, scope, commands }));
  return `Unknown command \`${escapeToken(token)}\` — try /help${suggestion ? `\nDid you mean /${suggestion}?` : ""}`;
}

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
// Handlers that predate ClawError return bare "SERVICE_UNAVAILABLE: <service>" text.
const RAW_SERVICE_UNAVAILABLE_TEXT = /^SERVICE_UNAVAILABLE(?::\s*[\w .-]{0,64})?$/;

function friendlyErrorReply(commandName, error) {
  const code = error instanceof ClawError && ERROR_CODE_PATTERN.test(String(error.code)) ? error.code : "INTERNAL";
  if (code === "SERVICE_UNAVAILABLE") {
    return `/${commandName} can't run right now: a required service isn't running. Try again later or check \`pforge claw doctor\`.`;
  }
  return `/${commandName} couldn't be completed (${code}). Try again later or check \`pforge claw doctor\`.`;
}

async function sendHandlerResult(channel, update, result, commandName) {
  const messages = Array.isArray(result) ? result : [result];
  for (const message of messages) {
    if (!message || typeof message.text !== "string") continue;
    const text = RAW_SERVICE_UNAVAILABLE_TEXT.test(message.text.trim())
      ? friendlyErrorReply(commandName, new ClawError("SERVICE_UNAVAILABLE"))
      : message.text;
    await sendText(channel, update, text);
  }
}

async function dispatchCommand({
  command, parsed, update, caller, context, channel, store, logger, config, commandRegistry,
}) {
  const authorization = await replyRefusal({ channel, update, caller, command, context, config, store, logger });
  if (!authorization.ok) return;
  const accepted = await safeAudit(store, logger, {
    kind: "command", name: command.name, userId: caller.userId, chatId: update.chatId,
    threadId: update.threadId, project: context.project?.id ?? null, updateId: update.updateId,
  });
  if (!accepted) {
    await sendText(channel, update, AUDIT_UNAVAILABLE_REPLY);
    return;
  }
  const argsText = parsed.argsText ?? parsed.topic ?? "";
  try {
    const result = await command.handle(context, {
      args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      argsText,
      caller,
      project: context.project,
      scope: context.scope,
      chatId: update.chatId,
      threadId: update.threadId,
      updateId: update.updateId,
      constraint: authorization.constraint,
      commands: commandRegistry,
      helpCommand: command.name === "help" && argsText
        ? commandByName(commandRegistry, argsText.split(/\s+/)[0])
        : null,
    });
    await sendHandlerResult(channel, update, result, command.name);
  } catch (error) {
    await sendText(channel, update, friendlyErrorReply(command.name, error));
  }
}

async function throttleGate({ update, userId, limiter, store, logger }) {
  const result = limiter.admit(`${update.adapter}:${userId}`);
  if (result.ok) return null;
  if (result.firstDrop) {
    await safeAudit(store, logger, {
      kind: "throttled",
      reason: "rate-limit",
      ...metadataFor(update),
    });
  }
  return { dropped: true, throttled: true };
}

async function routeForward({
  update, caller, config, registry, chatId, store, logger, contextOptions,
}) {
  if (classifyMessage(update)?.kind !== "forward") return null;
  const context = resolveContext(config, registry, chatId, update.threadId, contextOptions);
  const service = getTriageService();
  if (context?.scope !== "project" || !service) {
    await safeAudit(store, logger, {
      kind: "refused",
      reason: "capture-unavailable",
      ...metadataFor(update),
    });
    return { dropped: true };
  }
  await service.handleInbound({ update, project: context.project, caller });
  return { handled: true, captured: true };
}

function buildMenuCommands({ role, topics }) {
  const available = new Map();
  for (const scope of topics) {
    for (const command of visibleCommands({ role, scope })) available.set(command.name, command);
  }
  return COMMANDS.filter((command) => available.has(command.name))
    .map((command) => ({ command: command.name.toLowerCase(), description: command.summary.slice(0, 256) }));
}

function menuTopicsForChat(config, registry, chatId) {
  const topics = new Set();
  for (const project of registry.all()) {
    if (project.channel?.adapter === GROUP_CHANNEL && String(project.channel.chatId) === chatId) topics.add("project");
  }
  const general = config.channels?.telegram?.generalChat;
  if (general && String(general.chatId) === chatId) topics.add("general");
  return [...topics];
}

/**
 * Telegram menus have no forum-topic scope; each chat menu is the union of its
 * topic-specific commands, with chat-member scopes overriding non-owner roles.
 */
function buildMenuEntries(config, registry, indexes) {
  const entries = [];
  for (const chatId of indexes.chatIds) {
    const topics = menuTopicsForChat(config, registry, chatId);
    entries.push({
      scope: { type: "chat", chat_id: chatId },
      commands: buildMenuCommands({ role: "owner", topics }),
    });
    for (const caller of indexes.identities.values()) {
      if (caller.role === "owner") continue;
      entries.push({
        scope: { type: "chat_member", chat_id: chatId, user_id: String(caller.userId) },
        commands: buildMenuCommands({ role: caller.role, topics }),
      });
    }
  }
  return entries;
}

function commandByName(commands, name) {
  const token = String(name ?? "").replace(/^\/+/, "").replace(/@[^@/]+$/, "").toLowerCase();
  return commands.find((command) => command.name.toLowerCase() === token
    || command.aliases.some((alias) => alias.toLowerCase() === token));
}

export function createRouter({
  config, channel, store, registry = createRegistry(config), logger, commandRegistry = COMMANDS,
  services = {}, clients,
  rateLimit = { perMinute: DEFAULT_MESSAGES_PER_MINUTE, windowMs: DEFAULT_RATE_WINDOW_MS },
  now = Date.now,
} = {}) {
  let currentConfig = config;
  let currentRegistry = registry;
  let indexes = createIndexes(config);
  const limiter = createInboundLimiter({ ...rateLimit, now });
  const pending = services.pending instanceof Map ? services.pending : new Map();
  const contextServices = {
    ...services,
    store,
    config,
    registry,
    pending,
    now,
    get budget() { return getBudgetService(); },
  };
  const contextOptions = { services: contextServices, clients };

  async function route(update) {
    const identity = await checkIdentity(update, indexes, store, logger);
    if (!identity) return { dropped: true };
    const { caller, chatId } = identity;
    if (update.kind === "callback") {
      await dispatchCallback({
        update, caller, context: resolveContext(currentConfig, currentRegistry, chatId, update.threadId, contextOptions),
        channel, store, logger,
      });
      return { handled: true };
    }
    const throttled = await throttleGate({
      update, userId: identity.userId, limiter, store, logger,
    });
    if (throttled) return throttled;
    const forwarded = await routeForward({
      update, caller, config: currentConfig, registry: currentRegistry, chatId, store, logger,
      contextOptions,
    });
    if (forwarded) return forwarded;
    const parsed = parseText(update.text, { botUsername: currentConfig.channels?.telegram?.botUsername });
    if (parsed.kind === "other-bot" || parsed.kind === "empty") return { handled: false };
    const context = resolveContext(currentConfig, currentRegistry, chatId, update.threadId, contextOptions);
    if (!context) {
      if (parsed.kind === "command" || parsed.kind === "unknown" || parsed.kind === "help-text") {
        await sendText(channel, update, NEUTRAL_TOPIC_REPLY);
      }
      return { handled: false };
    }
    if (parsed.kind === "free") {
      if (context.scope !== "project") return { handled: false };
      const command = commandByName(commandRegistry, "ask");
      return dispatchCommand({
        command, parsed: { ...parsed, argsText: parsed.text }, update, caller, context,
        channel, store, logger, config: currentConfig, commandRegistry,
      });
    }
    if (parsed.kind === "unknown") {
      await sendText(channel, update, unknownCommandReply(parsed.token, caller, context.scope, commandRegistry));
      return { handled: false };
    }
    const command = parsed.kind === "help-text"
      ? commandByName(commandRegistry, "help")
      : commandByName(commandRegistry, parsed.name);
    const routed = parsed.kind === "help-text"
      ? { ...parsed, argsText: parsed.topic ?? "" }
      : parsed;
    await dispatchCommand({
      command, parsed: routed, update, caller, context, channel, store, logger,
      config: currentConfig, commandRegistry,
    });
    return { handled: true };
  }

  function buildMenus() {
    return buildMenuEntries(currentConfig, currentRegistry, indexes);
  }

  async function syncMenus() {
    const result = { ok: true, synced: 0, failed: [] };
    for (const entry of buildMenus()) {
      try {
        await channel.setMenu(entry.commands, { scope: entry.scope });
        result.synced += 1;
      } catch (error) {
        result.ok = false;
        result.failed.push({ scope: entry.scope, code: error?.code ?? "MENU_SYNC_FAILED" });
      }
    }
    return result;
  }

  async function reload(newConfig) {
    const newRegistry = createRegistry(newConfig);
    const newIndexes = createIndexes(newConfig);
    currentConfig = newConfig;
    currentRegistry = newRegistry;
    indexes = newIndexes;
    return syncMenus();
  }

  return { route, reload, buildMenus, syncMenus };
}
