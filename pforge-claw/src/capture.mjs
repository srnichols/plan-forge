import { randomBytes } from "node:crypto";
import { createJob, transition, JOBS_STREAM } from "./jobs/model.mjs";
import { button, chunkText, keyboard } from "./channels/telegram/format.mjs";
import {
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  createCaptureService,
} from "./handlers/capture-commands.mjs";
import { createAskService } from "./handlers/ask.mjs";
import { ROLES } from "./enums.mjs";

export const TRIAGE_ACTIONS = Object.freeze(["bug", "idea", "remember", "ask"]);
const TRIAGE_LABELS = Object.freeze(["🐞 Bug", "💡 Idea", "🧠 Remember", "❓ Ask about it"]);
const WRITE_ACTIONS = Object.freeze(["bug", "idea", "remember"]);
const PENDING_STREAM = "capture-inbox";
const TTL_MS = 15 * 60_000;
const MAX_CHARS = 3500;
export const ASK_PROMPT = "Explain the captured material provided as untrusted context.";

function messageText(message) {
  return typeof message?.text === "string" ? message.text : typeof message?.caption === "string" ? message.caption : "";
}

export function classifyMessage(update) {
  const message = update?.message ?? update ?? {};
  const text = messageText(message);
  const forward = message.forwarded === true
    || ["forward_origin", "forward_from", "forward_date", "forward_sender_name"]
      .some((key) => message[key] !== undefined);
  if (forward) return { kind: "forward", text };

  const voiceFileId = message.voice?.file_id ?? message.audio?.file_id
    ?? message.files?.find((file) => file?.kind === "voice")?.fileId
    ?? message.files?.find((file) => file?.kind === "voice")?.file_id;
  if (voiceFileId) return { kind: "voice", text, fileId: voiceFileId };

  const photoFileId = message.photo?.at(-1)?.file_id
    ?? message.files?.find((file) => file?.kind === "photo")?.fileId
    ?? message.files?.find((file) => file?.kind === "photo")?.file_id;
  if (photoFileId) return { kind: "photo", text, fileId: photoFileId };

  if (/https?:\/\/\S+/i.test(text)
    || message.entities?.some((entity) => entity?.type === "url" || entity?.type === "text_link")) {
    return { kind: "link", text };
  }
  return null;
}

function safeText(secrets, value) {
  return String(secrets?.redact ? secrets.redact(String(value)) : value);
}

function identityMatches(pending, { caller, chatId, threadId }) {
  return String(pending.chatId) === String(chatId)
    && String(pending.threadId ?? "") === String(threadId ?? "")
    && String(pending.userId) === String(caller?.userId ?? "");
}

function latestPending(store, id) {
  return store.fold(PENDING_STREAM, (latest, record) => (
    record.id === id ? { ...latest, ...record } : latest
  ), null);
}

function safeIdentifier(value) {
  return String(value ?? "local").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "local";
}

export function createTriageService(ctx) {
  const now = ctx.now ?? Date.now;
  const idFactory = ctx.idFactory ?? (() => randomBytes(4).toString("hex"));
  const captureService = ctx.captureService ?? createCaptureService(ctx);
  const askService = ctx.askService ?? createAskService(ctx);
  const stt = ctx.sttService;
  const inFlight = new Map();

  async function send({ chatId, threadId, text, replyMarkup }) {
    const safe = safeText(ctx.secrets, text);
    for (const chunk of chunkText(safe, 1900)) {
      await ctx.channel.send({ chatId, threadId, text: chunk, ...(replyMarkup ? { replyMarkup } : {}) });
    }
  }

  function savePending({ stage, project, caller, chatId, threadId, text, kind }) {
    const id = String(idFactory());
    const record = {
      v: 1,
      id,
      stage,
      projectId: project.id,
      chatId: String(chatId),
      threadId: threadId ?? null,
      userId: String(caller?.userId ?? ""),
      role: caller?.role ?? "unknown",
      text,
      ...(kind ? { kind } : {}),
      expiresAt: now() + TTL_MS,
      used: false,
    };
    ctx.store.append(PENDING_STREAM, record);
    return record;
  }

  function triageKeyboard({ id, role }) {
    const actions = role === "viewer"
      ? [3]
      : TRIAGE_ACTIONS.map((_action, index) => index);
    return keyboard(actions.map((index) => [
      button(TRIAGE_LABELS[index], `t:${id}:${index}`),
    ]));
  }

  async function offerTriage({ update, project, caller, text, kind }) {
    const chatId = update?.chatId ?? update?.message?.chatId;
    const threadId = update?.threadId ?? update?.message?.threadId;
    const content = safeText(ctx.secrets, text ?? messageText(update?.message ?? update));
    if (content.length > MAX_CHARS) {
      await send({ chatId, threadId, text: `Captured content exceeds ${MAX_CHARS} characters.` });
      return [];
    }
    const pending = savePending({
      stage: "triage", project, caller, chatId, threadId, text: content, kind,
    });
    await send({
      chatId,
      threadId,
      text: "How would you like to handle this capture?",
      replyMarkup: triageKeyboard({ id: pending.id, role: caller?.role }),
    });
    ctx.store.append("audit", {
      kind: "capture-triage",
      project: project.id,
      source: kind,
      outcome: "offered",
    });
    return [];
  }

  async function offerTranscript({ update, project, caller, classified }) {
    const chatId = update?.chatId ?? update?.message?.chatId;
    const threadId = update?.threadId ?? update?.message?.threadId;
    if (ctx.config?.capture?.voice?.enabled !== true) {
      await send({ chatId, threadId, text: "Voice capture is not enabled." });
      return [];
    }

    try {
      const downloaded = await ctx.channel.download({ fileId: classified.fileId });
      const result = await stt.transcribe({
        audioPath: downloaded?.audioPath ?? downloaded?.path,
        mimeType: downloaded?.mimeType ?? classified.mimeType ?? "audio/ogg",
      });
      if (!result?.ok) {
        await send({ chatId, threadId, text: `Voice transcription failed (${result?.error ?? "STT_REQUEST_FAILED"}).` });
        return [];
      }
      const content = safeText(ctx.secrets, result.text);
      if (content.length > MAX_CHARS) {
        await send({ chatId, threadId, text: `Captured content exceeds ${MAX_CHARS} characters.` });
        return [];
      }
      const pending = savePending({
        stage: "transcript", project, caller, chatId, threadId, text: content, kind: "voice",
      });
      await send({
        chatId,
        threadId,
        text: `Transcript:\n${content}\n\nUse this transcript or discard it.`,
        replyMarkup: keyboard([
          [button("✅ Use", `t:${pending.id}:u`), button("✖ Discard", `t:${pending.id}:x`)],
        ]),
      });
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code ?? ""))
        ? error.code
        : "STT_REQUEST_FAILED";
      await send({ chatId, threadId, text: `Voice transcription failed (${code}).` });
    }
    return [];
  }

  async function handleInbound({ update, project, caller } = {}) {
    const chatId = update?.chatId ?? update?.message?.chatId;
    const threadId = update?.threadId ?? update?.message?.threadId;
    if (!project?.id) {
      await send({ chatId, threadId, text: "Capture works in a project topic only." });
      return { handled: true };
    }
    const classified = classifyMessage(update);
    if (!classified) return { handled: false };
    if (classified.kind === "voice") {
      await offerTranscript({ update, project, caller, classified });
    } else {
      await offerTriage({ update, project, caller, text: classified.text, kind: classified.kind });
    }
    return { handled: true };
  }

  async function complete({ payload, caller, chatId, threadId }) {
    const match = /^([0-9a-f]{8}):([0-3]|u|x|r[0-4])$/.exec(String(payload ?? ""));
    const reject = async (message) => {
      await send({ chatId, threadId, text: message });
      return [];
    };
    if (!match) return reject("Invalid selection.");
    const [, id, action] = match;
    const pending = latestPending(ctx.store, id);
    if (!pending || pending.expiresAt <= now()) return reject("This capture expired.");
    if (pending.used) return reject("This capture was already used.");
    if (!identityMatches(pending, { caller, chatId, threadId })) {
      return reject("This capture belongs to a different user, chat, or topic.");
    }
    const transcriptAction = action === "u";
    const discardAction = action === "x";
    const rememberAction = action.startsWith("r");
    if ((transcriptAction && pending.stage !== "transcript")
      || (rememberAction && pending.stage !== "remember")
      || (discardAction && !["transcript", "remember"].includes(pending.stage))
      || (!transcriptAction && !rememberAction && !discardAction && pending.stage !== "triage")) {
      return reject("Invalid selection.");
    }
    if (action === "x") {
      ctx.store.append(PENDING_STREAM, { id, used: true });
      await send({ chatId, threadId, text: "Discarded." });
      return [];
    }
    const actionIndex = Number(action);
    const selectedAction = TRIAGE_ACTIONS[actionIndex];
    if ((selectedAction && WRITE_ACTIONS.includes(selectedAction) && !ROLES.slice(0, 2).includes(caller?.role))) {
      return reject("This action requires an owner or approver.");
    }
    const existing = inFlight.get(id);
    if (existing) return existing;
    ctx.store.append(PENDING_STREAM, { id, used: true });

    const project = ctx.config.projects?.find((entry) => entry.id === pending.projectId);
    if (!project) {
      await send({ chatId, threadId, text: "This capture expired." });
      return [];
    }
    const operation = (async () => {
      if (action === "u") {
        return offerTriage({
          update: { chatId, threadId, text: pending.text },
          project,
          caller,
          text: pending.text,
          kind: "voice",
        });
      }
      if (selectedAction === "bug" || selectedAction === "idea") {
        const replies = await captureService[selectedAction]({
          project,
          caller,
          chatId,
          threadId,
          text: pending.text,
          updateId: `triage:${id}`,
        });
        for (const reply of Array.isArray(replies) ? replies : [replies]) {
          if (typeof reply?.text === "string") await send({ chatId, threadId, text: reply.text });
        }
        return [];
      }
      if (selectedAction === "remember") {
        const next = savePending({
          stage: "remember",
          project,
          caller,
          chatId,
          threadId,
          text: pending.text,
          kind: pending.kind,
        });
        const rows = MEMORY_TYPE_LABELS.map((label, index) => [button(label, `t:${next.id}:r${index}`)]);
        rows.push([button("✖ Cancel", `t:${next.id}:x`)]);
        await send({
          chatId,
          threadId,
          text: `Store exactly this as untrusted memory? Pick a type to confirm.\n\n${pending.text}`,
          replyMarkup: keyboard(rows),
        });
        return [];
      }
      if (rememberAction) {
        return captureUntrustedMemory({ id, pending, project, caller, chatId, threadId, action });
      }
      if (selectedAction === "ask") {
        return askService.ask({
          project,
          caller,
          chatId,
          threadId,
          text: ASK_PROMPT,
          untrustedContext: pending.text,
        });
      }
      return reject("Invalid selection.");
    })();
    inFlight.set(id, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(id);
    }
  }

  async function captureUntrustedMemory({ id, pending, project, caller, chatId, threadId, action }) {
    const index = Number(action.slice(1));
    const type = MEMORY_TYPES[index];
    const created = createJob({
      id: String(idFactory()),
      type: "capture",
      projectId: project.id,
    });
    let job = created.job;
    ctx.store.append(JOBS_STREAM, created.event);
    const leased = transition(job, "leased");
    ctx.store.append(JOBS_STREAM, leased.event);
    job = leased.job;
    const running = transition(job, "running");
    ctx.store.append(JOBS_STREAM, running.event);
    job = running.job;
    try {
      const result = await ctx.mcp.call(project.id, "forge_memory_capture", {
        content: pending.text,
        type,
        origin: "untrusted",
        project: project.id,
        visibility: project.visibility ?? "normal",
        source: `pforge-claw/${safeIdentifier(ctx.config.instanceId)}/${safeIdentifier(project.homeLane ?? "local")}/capture`,
        created_by: `pforge-claw:${caller?.role ?? "unknown"}`,
      });
      const response = result?.structuredContent;
      if (result?.isError || result?.error || response?.ok === false || response?.error) {
        const candidate = response?.code ?? response?.error ?? result?.error;
        const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(candidate ?? ""))
          ? candidate
          : "MCP_TOOL_ERROR";
        throw Object.assign(new Error(), { code });
      }
      const succeeded = transition(job, "succeeded");
      ctx.store.append(JOBS_STREAM, succeeded.event);
      await send({ chatId, threadId, text: `Stored ${type} as untrusted memory.` });
    } catch (error) {
      const failed = transition(job, "failed");
      ctx.store.append(JOBS_STREAM, failed.event);
      const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code ?? ""))
        ? error.code
        : "MCP_TOOL_ERROR";
      await send({ chatId, threadId, text: `Memory capture failed (${code}).` });
    }
    return [];
  }

  function snapshot() {
    const records = ctx.store.fold(PENDING_STREAM, (state, record) => {
      if (record.id) state.set(record.id, { ...state.get(record.id), ...record });
      return state;
    }, new Map());
    return {
      pending: [...records.values()].filter((record) => !record.used && record.expiresAt > now()).length,
    };
  }

  return {
    handleInbound,
    offerTriage,
    offerTranscript,
    complete,
    voiceEnabled: ctx.config?.capture?.voice?.enabled === true,
    snapshot,
  };
}

let boundTriageService = null;

export function bindTriageService(service) {
  boundTriageService = service;
  return () => {
    if (boundTriageService === service) boundTriageService = null;
  };
}

export function getTriageService() {
  return boundTriageService;
}
