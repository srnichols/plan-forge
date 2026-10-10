import { createHash } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { buildClawSnapshot } from "../snapshot.mjs";
import { chunkText } from "../channels/telegram/format.mjs";
import { createRegistry } from "../registry.mjs";
import { authorizeCommand, createCommandContext, currentCaller, readCurrentConfig } from "./c2-command-context.mjs";
import { commandErrorText, sendCommandResult } from "./c2-command-result.mjs";
import { askRequest, createAskHistory, normalizeUntrustedContext } from "./c2-ask-outcome.mjs";
import { requestIdentity, withRequestIdentity } from "../jobs/request-identity.mjs";

const EMPTY_ANSWER = "Forge-Master returned an empty answer. Try rephrasing your question.";
const ASK_USAGE = "Usage: /ask <question>";
const STUB_REPLY = "Forge-Master isn't installed for this project. Run `pforge claw doctor`.";
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
const REPLY_CHUNK_CHARS = 1900;
const MAX_PROPOSALS = 3;
const PROPOSAL_ID_LENGTH = 8;
const SNAPSHOT_TEXT_BYTES = 3800;
const PROPOSAL_COMMANDS = Object.freeze({
  task: "task",
  skill: "skill",
  plan: "run",
  run: "run",
  retry: "retry",
  abort: "abort",
  bug: "bug",
  idea: "idea",
  remember: "remember",
});

function safeText(secrets, text) {
  return secrets?.redact ? secrets.redact(String(text)) : String(text);
}

function sessionKey(chatId, threadId) {
  return `${chatId}:${threadId ?? 0}`;
}

function foldSessions(store) {
  return store.fold("sessions", (state, record) => {
    state.set(sessionKey(record.chatId, record.topicId), record.sessionId ?? null);
    return state;
  }, new Map());
}

function isProposal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const kind = value.kind ?? value.type;
  const argumentNames = {
    task: ["description"],
    skill: ["name"],
    plan: ["plan", "quorum"],
    run: ["plan", "quorum"],
    retry: ["jobId"],
    abort: ["jobId"],
    bug: ["text"],
    idea: ["text"],
    remember: ["text"],
  }[kind];
  if (!argumentNames || !value.args || typeof value.args !== "object" || Array.isArray(value.args)) return false;
  const requiredName = argumentNames[0];
  const requiredValue = value.args[requiredName];
  if (typeof requiredValue !== "string" || !requiredValue.trim() || requiredValue.length > 1000) return false;
  return argumentNames.slice(1).every((name) => value.args[name] === undefined
    || (typeof value.args[name] === "string" && value.args[name].length <= 100));
}

function proposalLabel(action) {
  const name = action.kind ?? action.type;
  const detail = action.args?.description ?? action.args?.text ?? action.args?.name ?? action.args?.plan ?? name;
  return `${action.origin === "untrusted" ? "⚠️ " : ""}${name}: ${String(detail).slice(0, 36)}`;
}

function replyText(result) {
  const text = result?.reply ?? result?.text ?? result?.answer;
  return typeof text === "string" ? text.trim() : "";
}

function commandArgs(action) {
  const kind = action.kind ?? action.type;
  const args = action.args;
  if (kind === "task") return args.description;
  if (kind === "skill") return args.name;
  if (kind === "plan" || kind === "run") return [args.plan, args.quorum].filter(Boolean).join(" ");
  if (kind === "retry" || kind === "abort") return args.jobId;
  return args.text;
}

function snapshotBlock(ctx, project) {
  let text = JSON.stringify(buildClawSnapshot(ctx, { project, features: ctx.features }));
  while (Buffer.byteLength(text, "utf8") > SNAPSHOT_TEXT_BYTES) text = text.slice(0, -1);
  return { title: "Forge-Claw state", text };
}

function safeAction(action) {
  return {
    kind: action.kind ?? action.type,
    args: Object.fromEntries(Object.entries(action.args).filter(([key]) => (
      ["description", "name", "plan", "quorum", "jobId", "text"].includes(key)
    ))),
    ...(action.origin === "untrusted" ? { origin: "untrusted" } : {}),
  };
}

function acceptedActions(result, project) {
  if (!Array.isArray(result?.proposedActions)) return [];
  return result.proposedActions
    .filter((action) => isProposal(action) && (!action.projectId || action.projectId === project.id))
    .slice(0, MAX_PROPOSALS).map(safeAction);
}

function proposalAccepted(result) {
  if (Array.isArray(result)) return true;
  if (!result || result.accepted === false || result.ok === false) return false;
  if (Object.hasOwn(result, "jobId")) return Boolean(result.jobId || result.keyboard || result.replyMarkup);
  return typeof result.text === "string";
}

function askArguments({ ctx, input, sessionId, untrustedContext }) {
  const { project, caller, threadId, text } = input;
  return {
    message: text,
    ...(sessionId ? { sessionId } : {}),
    caller: {
      role: caller.role, channel: "chat", surface: input.adapter ?? ctx.channel.id ?? "telegram",
      projectId: project.id,
      ...(threadId !== undefined && threadId !== null ? { topic: String(threadId) } : {}),
    },
    responseFormat: { style: "brief", maxChars: 3500 },
    proposeActions: true,
    contextBlocks: [snapshotBlock(ctx, project)],
    ...(untrustedContext.length ? { untrustedContext } : {}),
  };
}

function friendlyAskError(error) {
  const code = error instanceof ClawError ? error.code : "MCP_TRANSPORT_ERROR";
  const friendly = code.startsWith("MCP_") || code === "HOME_LANE_REMOTE"
    || code === "MCP_SERVER_MISSING" || code === "MCP_COMMAND_NOT_FOUND" || code === "MCP_UNRESOLVED_VAR";
  return friendly ? `Couldn't reach Forge-Master (${code}). Try \`pforge claw doctor\`.` : null;
}

function modelReply(result, project) {
  if (result?.error === "pforge-master not installed") return { reply: STUB_REPLY, actions: [] };
  if (result?.error || result?.isError || result?.ok === false) throw new ClawError("MCP_TOOL_ERROR");
  const actions = acceptedActions(result, project);
  let reply = replyText(result) || EMPTY_ANSWER;
  if (!actions.length && typeof result?.proposedActionsMessage === "string") {
    reply += `\n\n${result.proposedActionsMessage}`;
  }
  return { reply, actions };
}

export function createAskService(ctx) {
  const sessions = foldSessions(ctx.store);
  const chains = new Map();
  const history = createAskHistory(ctx);
  const pending = ctx.pending ?? ctx.services?.pending ?? new Map();
  const now = ctx.now ?? Date.now;
  const configFor = () => readCurrentConfig(ctx.control ?? ctx);
  const registryFor = () => ctx.control?.getRegistry?.() ?? ctx.registry ?? createRegistry(configFor());

  function serialize(key, operation) {
    const previous = chains.get(key) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    chains.set(key, current);
    return current.finally(() => {
      if (chains.get(key) === current) chains.delete(key);
    });
  }

  async function sendReply({ chatId, threadId, messageId, text, replyMarkup }) {
    const safe = safeText(ctx.secrets, text);
    const chunks = chunkText(safe, REPLY_CHUNK_CHARS);
    await ctx.channel.edit({
      chatId,
      threadId,
      messageId,
      text: chunks[0],
      ...(chunks.length === 1 && replyMarkup ? { replyMarkup } : {}),
    });
    for (let index = 1; index < chunks.length; index += 1) {
      await ctx.channel.send({
        chatId,
        threadId,
        text: chunks[index],
        ...(index === chunks.length - 1 && replyMarkup ? { replyMarkup } : {}),
      });
    }
  }

  function persistProposals(outcome, { project, chatId, threadId, caller }) {
    const accepted = [];
    for (const [index, action] of outcome.actions.entries()) {
      const id = createHash("sha256").update(`${outcome.id}:${index}`).digest("base64url").slice(0, PROPOSAL_ID_LENGTH);
      const proposal = {
        v: 1,
        id,
        project: project.id,
        chatId: String(chatId),
        topicId: threadId ?? null,
        requesterId: String(caller.userId),
        action,
        untrusted: action.origin === "untrusted" || outcome.untrusted,
        expiresAt: now() + PROPOSAL_TTL_MS,
        used: false,
      };
      if (!loadProposal(id)) ctx.store.append("proposals", proposal);
      accepted.push({ id, text: proposalLabel({ ...action, origin: proposal.untrusted ? "untrusted" : action.origin }) });
    }
    return accepted;
  }

  function persistSession(outcome, { chatId, threadId }) {
    if (!outcome.sessionId) return;
    const committed = ctx.store.fold("sessions", (found, record) => found || record.outcomeId === outcome.id, false);
    if (committed) return;
    ctx.store.append("sessions", {
      v: 1, chatId: String(chatId), topicId: threadId ?? null,
      sessionId: outcome.sessionId, outcomeId: outcome.id,
    });
    sessions.set(sessionKey(chatId, threadId), outcome.sessionId);
  }

  async function finishAsk(outcome, input, messageId) {
    const proposals = persistProposals(outcome, input);
    let text = outcome.reply;
    if (history.persistUsage(outcome, input)) text += "\n\n(usage not recorded)";
    persistSession(outcome, input);
    const replyMarkup = proposals.length ? {
      inline_keyboard: proposals.map(({ id, text: label }) => [{
        text: safeText(ctx.secrets, label), callback_data: `p:${id}`,
      }]),
    } : null;
    await sendReply({ ...input, messageId, text, replyMarkup });
  }

  async function performAsk(input, request, untrustedContext) {
    const { project, chatId, threadId } = input;
    await ctx.channel.typing({ chatId, threadId });
    const placeholder = await ctx.channel.send({ chatId, threadId, text: "Thinking…" });
    const messageId = placeholder?.[0]?.messageId ?? placeholder?.messageId;
    if (messageId === undefined || messageId === null) throw new ClawError("CHANNEL_MESSAGE_REFERENCE_MISSING");
    let outcome;
    let result;
    try {
      outcome = history.load(request);
      if (!outcome) {
        const args = askArguments({ ctx, input, sessionId: sessions.get(sessionKey(chatId, threadId)), untrustedContext });
        result = await ctx.mcp.call(project.id, "forge_master_ask", args);
        outcome = history.save({
          request, result, ...modelReply(result, project), untrusted: untrustedContext.length > 0,
        });
      }
      await finishAsk(outcome, input, messageId);
    } catch (error) {
      const text = friendlyAskError(error);
      if (!text) throw error;
      if (outcome) await sendReply({ chatId, threadId, messageId, text });
      else {
        outcome = history.save({ request, result, reply: text, actions: [], untrusted: untrustedContext.length > 0 });
        await finishAsk(outcome, input, messageId);
      }
    }
    return [];
  }

  async function ask(input) {
    const caller = currentCaller(configFor(), input.caller);
    if (!caller) return [];
    if (typeof input.text !== "string" || !input.text.trim()) {
      await ctx.channel.send({ chatId: input.chatId, threadId: input.threadId, text: ASK_USAGE });
      return [];
    }
    const untrustedContext = normalizeUntrustedContext(input.untrustedContext);
    const project = configFor().projects?.find((candidate) => candidate.id === input.project?.id);
    if (!project) throw new ClawError("PROJECT_NOT_CONFIGURED");
    const authorized = { ...input, caller, project, adapter: input.adapter ?? ctx.channel.id };
    const request = askRequest(authorized);
    return withRequestIdentity({ identity: request }, () => serialize(sessionKey(input.chatId, input.threadId),
      () => performAsk(authorized, request, untrustedContext)));
  }

  async function resetSession({ project, chatId, threadId }) {
    return serialize(sessionKey(chatId, threadId), async () => {
      const record = { v: 1, chatId: String(chatId), topicId: threadId ?? null, sessionId: null, ts: new Date().toISOString() };
      ctx.store.append("sessions", record);
      sessions.set(sessionKey(chatId, threadId), null);
      return {
        text: safeText(ctx.secrets, `Started a fresh Forge-Master conversation for ${project?.displayName ?? project?.id ?? "this project"}.`),
      };
    });
  }

  function getSession(chatId, threadId) {
    return sessions.get(sessionKey(chatId, threadId)) ?? null;
  }

  function loadProposal(id) {
    return ctx.store.fold("proposals", (latest, record) => record.id === id ? record : latest, null);
  }

  function proposalContext(record, input, commands) {
    const config = configFor();
    const registry = registryFor();
    const services = {
      ...ctx.services, store: ctx.store, config, registry, pending, now,
      secrets: ctx.secrets, lanes: ctx.lanes, getConfig: configFor, getRegistry: registryFor,
      commands,
    };
    return ctx.control?.contextFor?.({ ...input, projectId: record.project })
      ?? createCommandContext({ config, registry, services, clients: ctx.mcp, ...input, projectId: record.project });
  }

  function proposalProblem(record, { chatId, threadId }) {
    if (!record) return "This proposed action was not found.";
    if (!Number.isFinite(record.expiresAt) || record.expiresAt <= now()) return "This proposed action has expired.";
    if (record.used) return "This proposed action was already used.";
    if (String(record.chatId) !== String(chatId) || String(record.topicId ?? "") !== String(threadId ?? "")) {
      return "This proposed action belongs to a different chat or topic.";
    }
    if (!isProposal(record.action) || (record.action.projectId && record.action.projectId !== record.project)) {
      return "This proposed action is not valid for this project.";
    }
    return null;
  }

  async function dispatchProposal(record, input) {
    const commands = ctx.commands ?? input.commands ?? (await import("../commands/index.mjs")).COMMANDS;
    const commandName = PROPOSAL_COMMANDS[record.action.kind ?? record.action.type];
    const command = commands.find((candidate) => candidate.name === commandName);
    const context = proposalContext(record, input, commands);
    const authorization = authorizeCommand({ config: configFor(), command, caller: input.caller, context });
    if (!authorization.ok) {
      await sendCommandResult({ channel: ctx.channel, ...input, result: authorization, commandName, secrets: ctx.secrets });
      return [];
    }
    const argsText = commandArgs(record.action);
    const untrusted = record.untrusted || record.action.origin === "untrusted";
    const result = await command.handle(context, {
      ...input, caller: authorization.caller, project: context.project, scope: context.scope,
      argsText, args: argsText.trim().split(/\s+/), commands,
      adapter: input.adapter ?? ctx.channel.id ?? "telegram", updateId: `proposal:${record.id}`,
      ...(authorization.constraint ? { constraint: authorization.constraint } : {}),
      ...(untrusted ? { origin: "untrusted", untrustedContext: [{ kind: "other", source: "proposal", text: argsText }] } : {}),
    });
    if (proposalAccepted(result)) ctx.store.append("proposals", { ...record, used: true });
    await sendCommandResult({ channel: ctx.channel, ...input, result, commandName, secrets: ctx.secrets });
    return [];
  }

  async function runProposal(input) {
    const { id, chatId, threadId } = input;
    const key = String(id ?? "");
    if (!currentCaller(configFor(), input.caller)) return [];
    const identity = requestIdentity({
      type: "proposal", updateId: `proposal:${key}`, adapter: ctx.channel.id,
      projectId: loadProposal(key)?.project, callerId: null, chatId, threadId,
    });
    return withRequestIdentity({ identity }, async () => {
      const record = loadProposal(key);
      const problem = proposalProblem(record, input);
      if (problem) {
        await ctx.channel.send({ chatId, threadId, text: safeText(ctx.secrets, problem) });
        return [];
      }
      try {
        ctx.store.append("audit", { kind: "proposal-command", id: key, userId: input.caller.userId, chatId, threadId });
        return await dispatchProposal(record, input);
      } catch (error) {
        await ctx.channel.send({ chatId, threadId, text: commandErrorText(PROPOSAL_COMMANDS[record.action.kind ?? record.action.type], error) });
        return [];
      }
    });
  }

  return {
    ask,
    resetSession,
    getSession,
    runProposal,
    auditProposalTap({ chatId, threadId, id }) {
      try {
        ctx.store.append("audit", {
          kind: "proposal-tap",
          id: String(id ?? ""),
          chatId: String(chatId ?? ""),
          threadId: threadId ?? null,
        });
      } catch (error) {
        ctx.logger?.error?.("Proposal tap audit could not be recorded", { code: error?.code ?? "STORE_WRITE_FAILED" });
      }
    },
  };
}
