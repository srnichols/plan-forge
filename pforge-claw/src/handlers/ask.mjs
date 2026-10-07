import { randomBytes } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { buildClawSnapshot } from "../snapshot.mjs";
import { chunkText } from "../channels/telegram/format.mjs";

const EMPTY_ANSWER = "Forge-Master returned an empty answer. Try rephrasing your question.";
const ASK_USAGE = "Usage: /ask <question>";
const STUB_REPLY = "Forge-Master isn't installed for this project. Run `pforge claw doctor`.";
const PROPOSAL_TTL_MS = 15 * 60 * 1000;
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
  return (secrets?.redact ?? String)(String(text));
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

export function createAskService(ctx) {
  const sessions = foldSessions(ctx.store);
  const chains = new Map();

  function serialize(key, operation) {
    const previous = chains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    chains.set(key, current);
    return current.finally(() => {
      if (chains.get(key) === current) chains.delete(key);
    });
  }

  async function sendReply({ chatId, threadId, messageId, text, replyMarkup }) {
    const safe = safeText(ctx.secrets, text);
    const chunks = chunkText(safe, 1900);
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

  async function persistUsage(result, { project, chatId }) {
    const usage = Array.isArray(result?.usage) ? result.usage : result?.usage ? [result.usage] : [];
    let failed = false;
    for (const record of usage) {
      try {
        const normalized = {
          tokensIn: record?.tokensIn ?? record?.inputTokens ?? null,
          tokensOut: record?.tokensOut ?? record?.outputTokens ?? null,
          model: record?.model ?? null,
          costUsd: record?.costUsd ?? record?.usd ?? null,
          ...Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [key, value ?? null])),
        };
        ctx.store.append("budget", { v: 1, kind: "ask", project: project.id, chatId, usage: normalized });
      } catch (error) {
        failed = true;
        ctx.logger?.error?.("Forge-Master usage could not be recorded", { code: error?.code ?? "STORE_WRITE_FAILED" });
      }
    }
    return failed;
  }

  async function persistProposals(actions, { project, chatId, threadId, untrustedContext }) {
    const accepted = [];
    for (const action of actions) {
      if (!isProposal(action) || (action.projectId && action.projectId !== project.id)) continue;
      const kind = action.kind ?? action.type;
      const safeAction = {
        kind,
        args: Object.fromEntries(Object.entries(action.args).filter(([key]) => (
          ["description", "name", "plan", "quorum", "jobId", "text"].includes(key)
        ))),
        ...(action.origin === "untrusted" ? { origin: "untrusted" } : {}),
      };
      const id = randomBytes(6).toString("base64url");
      const proposal = {
        v: 1,
        id,
        project: project.id,
        chatId: String(chatId),
        topicId: threadId ?? null,
        action: safeAction,
        untrusted: safeAction.origin === "untrusted" || Boolean(untrustedContext),
        expiresAt: Date.now() + PROPOSAL_TTL_MS,
        used: false,
      };
      ctx.store.append("proposals", proposal);
      accepted.push({ id, text: proposalLabel({ ...safeAction, origin: proposal.untrusted ? "untrusted" : safeAction.origin }) });
    }
    return accepted;
  }

  async function ask(input) {
    const { project, caller, chatId, threadId, text, untrustedContext } = input;
    if (typeof text !== "string" || !text.trim()) {
      await ctx.channel.send({ chatId, threadId, text: safeText(ctx.secrets, ASK_USAGE) });
      return [];
    }
    return serialize(sessionKey(chatId, threadId), async () => {
      await ctx.channel.typing({ chatId, threadId });
      const placeholder = await ctx.channel.send({ chatId, threadId, text: safeText(ctx.secrets, "Thinking…") });
      const messageId = placeholder?.[0]?.messageId ?? placeholder?.messageId;
      if (!messageId) throw new ClawError("CHANNEL_MESSAGE_REFERENCE_MISSING");
      try {
        const sessionId = sessions.get(sessionKey(chatId, threadId));
        const args = {
          message: text,
          ...(sessionId ? { sessionId } : {}),
          caller: {
            role: caller.role,
            channel: "chat",
            surface: ctx.channel.id ?? "telegram",
            project: project.id,
            topic: threadId,
          },
          responseFormat: { style: "brief", maxChars: 3500 },
          proposeActions: true,
          contextBlocks: [buildClawSnapshot(ctx, { project, features: ctx.features })],
          ...(untrustedContext ? { untrustedContext } : {}),
        };
        const result = await ctx.mcp.call(project.id, "forge_master_ask", args);
        if (result?.error === "pforge-master not installed") {
          await sendReply({ chatId, threadId, messageId, text: STUB_REPLY });
          return [];
        }
        if (result?.error) throw new ClawError("MCP_TOOL_ERROR", { tool: "forge_master_ask" });
        let answer = replyText(result);
        if (!answer) answer = EMPTY_ANSWER;
        const proposals = await persistProposals(result?.proposedActions ?? [], {
          project, chatId, threadId, untrustedContext,
        });
        if (!proposals.length && result?.proposedActionsMessage) {
          answer = `${answer}\n\n${result.proposedActionsMessage}`;
        }
        const usageFailed = await persistUsage(result, { project, chatId });
        if (usageFailed) answer += "\n\n(usage not recorded)";
        if (result?.sessionId) {
          const record = { v: 1, chatId: String(chatId), topicId: threadId ?? null, sessionId: result.sessionId, ts: new Date().toISOString() };
          ctx.store.append("sessions", record);
          sessions.set(sessionKey(chatId, threadId), result.sessionId);
        }
        const keyboard = proposals.length
          ? { inline_keyboard: proposals.map(({ id, text: label }) => [{ text: safeText(ctx.secrets, label), callback_data: `p:${id}` }]) }
          : null;
        await sendReply({ chatId, threadId, messageId, text: answer, replyMarkup: keyboard });
      } catch (error) {
        const code = error instanceof ClawError ? error.code : "MCP_TRANSPORT_ERROR";
        const friendly = code.startsWith("MCP_") || code === "HOME_LANE_REMOTE" || code.startsWith("MCP_CONFIG_")
          || code === "MCP_SERVER_MISSING" || code === "MCP_COMMAND_NOT_FOUND" || code === "MCP_UNRESOLVED_VAR";
        if (!friendly) throw error;
        await sendReply({
          chatId, threadId, messageId,
          text: `Couldn't reach Forge-Master (${code}). Try \`pforge claw doctor\`.`,
        });
      }
      return [];
    });
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

  async function runProposal({ id, caller, chatId, threadId, commands = ctx.commands ?? [] }) {
    const key = String(id ?? "");
    const records = ctx.store.fold("proposals", (state, record) => {
      if (record.id === key) state = record;
      return state;
    }, null);
    const reject = async (reason) => {
      await ctx.channel.send({ chatId, threadId, text: safeText(ctx.secrets, reason) });
      return [];
    };
    if (!records) return reject("This proposed action was not found.");
    if (records.expiresAt <= Date.now()) return reject("This proposed action has expired.");
    if (records.used) return reject("This proposed action was already used.");
    if (String(records.chatId) !== String(chatId) || String(records.topicId ?? "") !== String(threadId ?? "")) {
      return reject("This proposed action belongs to a different chat or topic.");
    }
    const kind = records.action?.kind ?? records.action?.type;
    const commandName = PROPOSAL_COMMANDS[kind];
    if (!commandName || (records.action.projectId && records.action.projectId !== records.project)) {
      return reject("This proposed action is not valid for this project.");
    }
    const command = commands?.find((candidate) => candidate.name === commandName);
    if (!command?.available || !command.roles?.includes(caller.role)
      || (command.scope !== "project" && command.scope !== "both")) {
      return reject("Not available yet.");
    }
    const project = ctx.config.projects?.find((candidate) => candidate.id === records.project);
    if (!project) return reject("This proposed action is not valid for this project.");
    ctx.store.append("proposals", { ...records, used: true });
    const argsText = commandArgs(records.action);
    const result = await command.handle.call({ service: ctx }, { scope: "project", project, services: ctx }, {
      argsText,
      args: typeof argsText === "string" ? argsText.trim().split(/\s+/) : [],
      caller,
      project,
      chatId,
      threadId,
      commands,
    });
    for (const message of Array.isArray(result) ? result : [result]) {
      if (typeof message?.text === "string") {
        await ctx.channel.send({ chatId, threadId, text: safeText(ctx.secrets, message.text) });
      }
    }
    return [];
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
