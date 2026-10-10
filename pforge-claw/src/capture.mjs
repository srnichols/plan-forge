import { randomBytes } from "node:crypto";
import { button, chunkText, keyboard } from "./channels/telegram/format.mjs";
import {
  MEMORY_TYPES,
  MEMORY_TYPE_LABELS,
  createCaptureService,
} from "./handlers/capture-commands.mjs";
import { createAskService } from "./handlers/ask.mjs";
import { MAX_CONTENT, sanitizeRecord } from "./memory/memory-client.mjs";
import {
  captureErrorCode, captureWriteCaller, CAPTURE_ID_BYTES, CAPTURE_PENDING_TTL_MS,
  CAPTURE_REPLY_CHARS, CAPTURE_WRITE_DENIED,
} from "./capture-policy.mjs";
import { transcribeCaptureAudio } from "./capture-media.mjs";

export const TRIAGE_ACTIONS = Object.freeze(["bug", "idea", "remember", "ask"]);
const TRIAGE_LABELS = Object.freeze(["🐞 Bug", "💡 Idea", "🧠 Remember", "❓ Ask about it"]);
const PENDING_STREAM = "capture-inbox";
const TTL_MS = CAPTURE_PENDING_TTL_MS;
const MAX_CHARS = MAX_CONTENT;
const ASK_TRIAGE_INDEX = TRIAGE_ACTIONS.indexOf("ask");
const UNTRUSTED_KINDS = Object.freeze({
  forward: "forward", link: "link", voice: "transcript", photo: "file", file: "file",
});
export const ASK_PROMPT = "Explain the captured material provided as untrusted context.";

function messageText(message) {
  return typeof message?.text === "string" ? message.text : "";
}

function captureAddress(ctx, update) {
  return {
    chatId: update?.chatId,
    threadId: update?.threadId,
    adapter: ctx.channel?.id ?? update?.adapter ?? "chat",
  };
}

function isVoiceEnabled(config) {
  return config?.capture?.voice?.enabled === true;
}

function mediaFile(message, kind) {
  const files = Array.isArray(message.files) ? message.files : [];
  return files.find((file) => file?.kind === kind && typeof file.fileId === "string" && file.fileId);
}

function classifiedFile(kind, text, file) {
  return {
    kind, text, fileId: file.fileId,
    ...(typeof file.mimeType === "string" ? { mimeType: file.mimeType } : {}),
  };
}

function linkText(message, text) {
  const entities = Array.isArray(message.entities) ? message.entities : [];
  const urls = entities.filter((entity) => entity.type === "text_link" && typeof entity.url === "string")
    .map((entity) => entity.url);
  const content = [...new Set([text, ...urls])].filter(Boolean).join("\n");
  return /https?:\/\/\S+/i.test(text) || entities.some((entity) => entity.type === "url" || entity.type === "text_link")
    ? content : null;
}

/**
 * @param {{text?: string, forwarded?: boolean, files?: Array<{kind: "voice"|"photo"|"file",
 * fileId: string, mimeType?: string}>, entities?: Array<{type: string, url?: string}>}} update
 * @returns {{kind: string, text: string, fileId?: string, mimeType?: string}|null}
 */
export function classifyMessage(update) {
  const message = update ?? {};
  const text = messageText(message);
  const linked = linkText(message, text);
  const content = linked ?? text;
  const voice = mediaFile(message, "voice");
  if (voice) return classifiedFile("voice", content, voice);
  if (message.forwarded === true) return { kind: "forward", text: content };
  const photo = mediaFile(message, "photo");
  if (photo) return classifiedFile("photo", content, photo);
  const file = mediaFile(message, "file");
  if (file) return classifiedFile("file", content, file);
  return linked === null ? null : { kind: "link", text: linked };
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

function selectionStage(action) {
  if (action === "u") return "transcript";
  if (action.startsWith("r")) return "remember";
  return "triage";
}

function validStage(pending, action) {
  return action === "x"
    ? ["transcript", "remember"].includes(pending.stage)
    : pending.stage === selectionStage(action);
}

function isWriteSelection(action) {
  return action.startsWith("r") || ["0", "1", "2"].includes(action);
}

function checkSelection(ctx, input, time) {
  const match = /^([0-9a-f]{8}):([0-3]|u|x|r[0-4])$/.exec(String(input.payload ?? ""));
  if (!match) return { error: "Invalid selection." };
  const [, id, action] = match;
  const pending = latestPending(ctx.store, id);
  if (!pending || pending.expiresAt <= time) return { error: "This capture expired." };
  if (pending.used) return { error: "This capture was already used." };
  if (!identityMatches(pending, input)) return { error: "This capture belongs to a different user, chat, or topic." };
  if (!validStage(pending, action)) return { error: "Invalid selection." };
  const caller = isWriteSelection(action) ? captureWriteCaller({
    config: ctx.config, caller: input.caller, adapter: input.adapter ?? pending.adapter,
  }) : input.caller;
  if (!caller) return { error: CAPTURE_WRITE_DENIED };
  const project = ctx.config.projects?.find((entry) => entry.id === pending.projectId);
  if (!project) return { error: "This capture expired." };
  return { id, action, pending, caller, project };
}

function untrustedContext(pending) {
  return [{
    kind: UNTRUSTED_KINDS[pending.kind] ?? "other",
    ...(pending.source ? { source: pending.source } : {}),
    text: pending.text,
  }];
}

export function createTriageService(ctx) {
  const now = ctx.now ?? Date.now;
  const idFactory = ctx.idFactory ?? (() => randomBytes(CAPTURE_ID_BYTES).toString("hex"));
  const captureService = ctx.captureService ?? createCaptureService(ctx);
  const askService = ctx.askService ?? createAskService(ctx);
  const inFlight = new Map();

  async function send({ chatId, threadId, text, replyMarkup }) {
    const safe = safeText(ctx.secrets, text);
    for (const chunk of chunkText(safe, CAPTURE_REPLY_CHARS)) {
      await ctx.channel.send({ chatId, threadId, text: chunk, ...(replyMarkup ? { replyMarkup } : {}) });
    }
  }

  function savePending({ stage, project, caller, chatId, threadId, text, kind, source, adapter }) {
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
      origin: "untrusted",
      ...(kind ? { kind } : {}),
      ...(source ? { source } : {}),
      ...(adapter ? { adapter } : {}),
      expiresAt: now() + TTL_MS,
      used: false,
    };
    ctx.store.append(PENDING_STREAM, record);
    return record;
  }

  function triageKeyboard({ id, role }) {
    const actions = role === "viewer"
      ? [ASK_TRIAGE_INDEX]
      : TRIAGE_ACTIONS.map((_action, index) => index);
    return keyboard(actions.map((index) => [
      button(TRIAGE_LABELS[index], `t:${id}:${index}`),
    ]));
  }

  async function offerTriage({ update, project, caller, text, kind, source }) {
    const { chatId, threadId, adapter } = captureAddress(ctx, update);
    const captureKind = kind ?? "other";
    const content = safeText(ctx.secrets, text ?? messageText(update))
      || `[${captureKind} capture]`;
    if (content.length > MAX_CHARS) {
      await send({ chatId, threadId, text: `Captured content exceeds ${MAX_CHARS} characters.` });
      return [];
    }
    const pending = savePending({
      stage: "triage", project, caller, chatId, threadId, text: content, kind,
      source: source ?? `${adapter}:${captureKind}`, adapter,
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
    const { chatId, threadId, adapter } = captureAddress(ctx, update);
    if (!isVoiceEnabled(ctx.config)) {
      await send({ chatId, threadId, text: "Voice capture is not enabled." });
      return [];
    }

    const result = await transcribeCaptureAudio({
      channel: ctx.channel, stt: ctx.sttService, home: ctx.home, classified, logger: ctx.logger,
    });
    if (!result?.ok || typeof result.text !== "string" || !result.text.trim()) {
      const code = captureErrorCode({ code: result?.error }, "STT_REQUEST_FAILED");
      await send({ chatId, threadId, text: `Voice transcription failed (${code}).` });
      return [];
    }
    const content = safeText(ctx.secrets, result.text);
    if (content.length > MAX_CHARS) {
      await send({ chatId, threadId, text: `Captured content exceeds ${MAX_CHARS} characters.` });
      return [];
    }
    const pending = savePending({
      stage: "transcript", project, caller, chatId, threadId, text: content, kind: "voice",
      adapter, source: `${adapter}:voice`,
    });
    await send({
      chatId, threadId, text: `Transcript:\n${content}\n\nUse this transcript or discard it.`,
      replyMarkup: keyboard([
        [button("✅ Use", `t:${pending.id}:u`), button("✖ Discard", `t:${pending.id}:x`)],
      ]),
    });
    return [];
  }

  async function handleInbound({ update, project, caller } = {}) {
    const { chatId, threadId } = captureAddress(ctx, update);
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

  async function offerRemember({ pending, project, caller, chatId, threadId }) {
    const content = sanitizeRecord({ config: ctx.config, secrets: ctx.secrets, text: pending.text });
    const next = savePending({
      ...pending, stage: "remember", project, caller, chatId, threadId, text: content,
    });
    const rows = MEMORY_TYPE_LABELS.map((label, index) => [button(label, `t:${next.id}:r${index}`)]);
    rows.push([button("✖ Cancel", `t:${next.id}:x`)]);
    await send({
      chatId, threadId,
      text: `Store exactly this as untrusted memory? Pick a type to confirm.\n\n${content}`,
      replyMarkup: keyboard(rows),
    });
    return [];
  }

  async function executeSelection({ id, action, pending, project, caller, chatId, threadId }) {
    if (action === "x") {
      await send({ chatId, threadId, text: "Discarded." });
      return [];
    }
    if (action === "u") return offerTriage({
      update: { chatId, threadId, adapter: pending.adapter }, project, caller,
      text: pending.text, kind: "voice", source: pending.source,
    });
    const selected = TRIAGE_ACTIONS[Number(action)];
    if (selected === "remember") return offerRemember({ pending, project, caller, chatId, threadId });
    if (selected === "ask") return askService.ask({
      project, caller, chatId, threadId, adapter: pending.adapter,
      text: ASK_PROMPT, untrustedContext: untrustedContext(pending),
    });
    const replies = action.startsWith("r")
      ? await captureService.captureConfirmed({
        project, caller, chatId, threadId, adapter: pending.adapter, key: `triage:${id}`,
        type: MEMORY_TYPES[Number(action.slice(1))], content: pending.text, origin: "untrusted",
        ref: "capture", confirmed: true,
      })
      : await captureService[selected]({
        project, caller, chatId, threadId, adapter: pending.adapter,
        text: pending.text, updateId: `triage:${id}`, origin: "untrusted",
        untrustedContext: untrustedContext(pending),
      });
    for (const reply of Array.isArray(replies) ? replies : [replies]) {
      if (typeof reply?.text === "string") await send({ chatId, threadId, ...reply });
    }
    return [];
  }

  async function complete(input) {
    const { chatId, threadId } = input;
    const selection = checkSelection(ctx, input, now());
    if (selection.error) {
      await send({ chatId, threadId, text: selection.error });
      return [];
    }
    if (inFlight.has(selection.id)) return inFlight.get(selection.id);
    ctx.store.append(PENDING_STREAM, { id: selection.id, used: true });
    const operation = executeSelection({ ...selection, chatId, threadId });
    inFlight.set(selection.id, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(selection.id);
    }
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
    voiceEnabled: isVoiceEnabled(ctx.config),
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
