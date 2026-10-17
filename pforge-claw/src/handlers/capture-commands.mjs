import { randomBytes } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { JOBS_STREAM, createJob, transition } from "../jobs/model.mjs";
import { button, chunkText, keyboard } from "../channels/telegram/format.mjs";
import {
  createMemoryClient, MAX_CONTENT, MEMORY_TYPES, normalizeToolResult, sanitizeRecord, toolFailureCode,
} from "../memory/memory-client.mjs";
import {
  captureErrorCode, captureOrigin, captureWriteCaller, CAPTURE_CALLBACK_BYTES,
  CAPTURE_ID_BYTES, CAPTURE_PENDING_TTL_MS, CAPTURE_REPLY_CHARS, CAPTURE_WRITE_DENIED,
} from "../capture-policy.mjs";

export { MEMORY_TYPES };
export const MEMORY_TYPE_LABELS = Object.freeze(["Decision", "Lesson", "Convention", "Pattern", "Gotcha"]);
const PENDING_STREAM = "memory-pending";
const CAPTURE_STREAM = "capture-writes";
const PENDING_TTL_MS = CAPTURE_PENDING_TTL_MS;
const MAX_CONTENT_CHARS = MAX_CONTENT;
const RECALL_LIMIT = 5;
const SNIPPET_MAX = 200;
const OPENBRAIN_HINT = " Configure OpenBrain with `pforge claw init` before retrying.";

class ToolFailure extends Error {
  constructor(code, result) {
    super(code);
    this.code = code;
    this.result = result;
  }
}

function safeText(secrets, text) {
  return String(secrets?.redact ? secrets.redact(String(text)) : text);
}

function isOpenBrainError(code, message) {
  const normalized = `${code} ${message ?? ""}`.replace(/[_-]/g, " ");
  return /openbrain/i.test(normalized)
    && /not configured|unconfigured|missing|unavailable|disabled/i.test(normalized);
}

function projectName(project) {
  return project?.displayName ?? project?.id ?? "this project";
}

function latestRecord(store, stream, key) {
  return store.fold(stream, (latest, record) => (record.key === key ? record : latest), null);
}

function captureRecord(store, key) {
  return latestRecord(store, CAPTURE_STREAM, key);
}

function latestPending(store, id) {
  return store.fold(PENDING_STREAM, (latest, record) => (record.id === id ? { ...latest, ...record } : latest), null);
}

function toolErrorMessage(command, code, result) {
  const hint = isOpenBrainError(code, result?.message ?? result?.text)
    ? `${OPENBRAIN_HINT}`
    : "";
  return `/${command} couldn't save (${code}). Try again or run \`pforge claw doctor\`.${hint}`;
}

function identityMatches(pending, { caller, chatId, threadId }) {
  return String(pending.chatId) === String(chatId)
    && String(pending.threadId ?? "") === String(threadId ?? "")
    && String(pending.userId) === String(caller?.userId ?? "");
}

function pendingRememberError(pending, input, time) {
  if (!pending || pending.expiresAt <= time) return "This memory capture expired; send /remember again.";
  if (!identityMatches(pending, input)) return "This memory capture belongs to a different user, chat, or topic.";
  return null;
}

function recallFallback(query, project) {
  return `No memories matched "${query}" in ${projectName(project)}. Try broader terms.`;
}

function renderHit(hit) {
  const source = typeof hit?.source === "string" ? hit.source : "unknown";
  const snippet = String(hit?.snippet ?? hit?.text ?? "").slice(0, SNIPPET_MAX);
  const date = hit?.date ?? hit?.timestamp ?? hit?.createdAt;
  const dateText = typeof date === "string" && date ? date.slice(0, 10) : "date unavailable";
  const recordRef = hit?.recordRef ?? hit?.id ?? "reference unavailable";
  const prefix = hit?.origin === "untrusted" ? "⚠ untrusted: " : "";
  return `${prefix}• [${source}] ${snippet} — ${dateText} (${recordRef})`;
}

function getErrorText(error, command, result) {
  const code = captureErrorCode(error, "MCP_TOOL_ERROR");
  return toolErrorMessage(command, code, result ?? error?.result);
}

function sharedMemoryReceipt({ destination, type, result }) {
  if (result?.id) return `Saved ${type} to ${destination} — id ${result.id}`;
  if (result?.url) return `Saved ${type} to ${destination} — ${result.url}`;
  const instructionalText = result?.text ?? result?.message;
  const excerpt = typeof instructionalText === "string"
    ? `\n${instructionalText.slice(0, SNIPPET_MAX)}` : "";
  return `Submitted ${type} to ${destination} (no record id returned by forge_memory_capture)${excerpt}`;
}

function memoryReceipt({ project, type, result }) {
  const destination = projectName(project);
  if (result.ok && result.l3 === false) return `Stored ${type} locally for ${destination} (L3 off).`;
  if (result.code === "MEMORY_PENDING") {
    const failure = result.errorCode ? `${toolErrorMessage("remember", result.errorCode, result)}\n` : "";
    return `${failure}Memory capture is pending for ${destination}; queued, not yet saved.`;
  }
  if (result.ok === false && result.code !== "MEMORY_CAPTURE_UNCONFIRMED") {
    return toolErrorMessage("remember", result.code, result);
  }
  return sharedMemoryReceipt({ destination, type, result });
}

function createRememberFlow(ctx, runtime) {
  const { now, idFactory, redact, replyMessages, sendText, validateText, projectError, runCommand } = runtime;
  const memory = createMemoryClient({ ...ctx, registry: ctx.registry ?? ctx.projectRegistry });
  const inFlight = new Map();
  const currentCaller = (input) => captureWriteCaller({
    config: ctx.config, caller: input.caller, adapter: input.adapter ?? ctx.channel?.id,
  });

  async function startRemember(input) {
    const { project, chatId, threadId, text } = input;
    const validation = validateText("remember", text) ?? projectError(project, "remember");
    if (validation) return replyMessages(validation);
    const caller = currentCaller(input);
    if (!caller) return replyMessages(CAPTURE_WRITE_DENIED);
    const content = sanitizeRecord({ config: ctx.config, secrets: ctx.secrets, text });
    const id = String(idFactory());
    const origin = captureOrigin(input);
    const pending = {
      v: 1, id, projectId: project.id, chatId: String(chatId), threadId: threadId ?? null,
      userId: String(caller.userId), role: caller.role, text: content, origin,
      expiresAt: now() + PENDING_TTL_MS, used: false, updateId: input.updateId ?? null,
    };
    const markup = keyboard(MEMORY_TYPE_LABELS.map((label, index) => [button(redact(label), `m:${id}:${index}`)]));
    const maxBytes = ctx.channel?.limits?.maxCallbackDataBytes ?? CAPTURE_CALLBACK_BYTES;
    if (markup.inline_keyboard.some((row) => Buffer.byteLength(row[0].callback_data, "utf8") > maxBytes)) {
      throw new ClawError("CALLBACK_DATA_TOO_LONG");
    }
    ctx.store.append(PENDING_STREAM, pending);
    await sendText({
      chatId, threadId, text: `Store exactly this as ${origin} memory? Choose a type to confirm.\n\n${content}`,
      replyMarkup: markup,
    });
    return [];
  }

  async function captureConfirmed(input) {
    const { project, content, type, key, origin = "trusted", ref = "remember" } = input;
    const caller = currentCaller(input);
    if (!caller) return replyMessages(CAPTURE_WRITE_DENIED);
    if (origin === "untrusted" && input.confirmed !== true) {
      return replyMessages("Untrusted memory requires explicit confirmation.");
    }
    const existing = captureRecord(ctx.store, key);
    if (existing) return replyMessages(existing.receipt);
    if (inFlight.has(key)) return replyMessages(await inFlight.get(key));
    const operation = runCommand({
      command: "remember", jobType: "capture", project, caller, origin,
      execute: async () => {
        const captured = await memory.capture(project.id, {
          content, type, origin, lane: project.homeLane ?? "local", ref, caller,
        });
        if (!captured.ok) throw new ToolFailure(captured.errorCode ?? captured.code, captured);
        return captured;
      },
      render: (result) => memoryReceipt({ project, type, result }),
      failureRender: (error) => memoryReceipt({
        project, type, result: error.result ?? { ok: false, code: captureErrorCode(error, "MCP_TOOL_ERROR") },
      }),
    }).then(({ receipt }) => {
      ctx.store.append(CAPTURE_STREAM, {
        v: 1, key, kind: "remember", project: project.id, receipt, origin, at: now(),
      });
      return receipt;
    });
    inFlight.set(key, operation);
    try {
      return replyMessages(await operation);
    } finally {
      inFlight.delete(key);
    }
  }

  async function completeRemember(input) {
    const { payload, chatId, threadId } = input;
    const match = /^([A-Za-z0-9._-]{1,80}):([0-4])$/.exec(String(payload ?? ""));
    const reject = async (message) => {
      await sendText({ chatId, threadId, text: message });
      return [];
    };
    if (!match) return reject("Invalid selection.");
    const [, id, rawIndex] = match;
    const pending = latestPending(ctx.store, id);
    const pendingError = pendingRememberError(pending, input, now());
    if (pendingError) return reject(pendingError);
    const caller = currentCaller(input);
    if (!caller) return reject(CAPTURE_WRITE_DENIED);
    const project = ctx.config.projects?.find((entry) => entry.id === pending.projectId);
    if (!project) return reject("This memory capture expired; send /remember again.");
    const key = `remember:${id}`;
    const existing = captureRecord(ctx.store, key);
    if (existing) return reject(existing.receipt);
    if (pending.used) return reject("This memory capture was already used.");
    ctx.store.append(PENDING_STREAM, { id, used: true });
    const replies = await captureConfirmed({
      ...input, project, caller, key, content: pending.text, type: MEMORY_TYPES[Number(rawIndex)],
      origin: pending.origin ?? "trusted", confirmed: true,
    });
    for (const reply of replies) await sendText({ chatId, threadId, text: reply.text });
    return [];
  }

  return { startRemember, completeRemember, captureConfirmed };
}

export function createCaptureService(ctx) {
  const now = ctx.now ?? Date.now;
  const idFactory = ctx.idFactory ?? (() => randomBytes(CAPTURE_ID_BYTES).toString("hex"));
  const inFlightCaptures = new Map();

  function redact(text) {
    return safeText(ctx.secrets, text);
  }

  async function sendText({ chatId, threadId, text, replyMarkup }) {
    for (const chunk of replyMessages(text)) {
      await ctx.channel.send({
        chatId,
        threadId,
        text: chunk.text,
        ...(replyMarkup ? { replyMarkup } : {}),
      });
    }
  }

  function replyMessages(text) {
    return chunkText(redact(text), CAPTURE_REPLY_CHARS).map((chunk) => ({ text: chunk }));
  }

  function validateText(command, text) {
    if (typeof text !== "string" || !text.trim()) return `Usage: /${command} <${command === "remember" ? "fact" : command === "recall" ? "query" : command === "idea" ? "idea" : "description"}>`;
    if (text.length > MAX_CONTENT_CHARS) return `/${command} accepts at most ${MAX_CONTENT_CHARS} characters.`;
    return null;
  }

  function projectError(project, command) {
    if (project?.id) return null;
    return `/${command} works in a project topic only.`;
  }

  function writeAudit({ command, project, jobType, outcome, origin }) {
    ctx.store.append("audit", {
      kind: "capture",
      command,
      project: project.id,
      jobType,
      outcome,
      ...(origin ? { origin } : {}),
    });
  }

  function beginJob({ project, caller, jobType, origin }) {
    const created = createJob({
      id: idFactory(),
      type: jobType,
      projectId: project.id,
    });
    const job = {
      ...created.job,
      callerId: String(caller?.userId ?? ""),
      callerRole: caller?.role ?? "unknown",
      ...(origin ? { meta: { ...created.job.meta, origin } } : {}),
      createdAt: new Date(now()).toISOString(),
    };
    ctx.store.append(JOBS_STREAM, { ...created.event, job });
    const leased = transition(job, "leased");
    ctx.store.append(JOBS_STREAM, leased.event);
    const running = transition(leased.job, "running");
    ctx.store.append(JOBS_STREAM, running.event);
    return running.job;
  }

  function finishJob(job, outcome) {
    const completed = transition(job, outcome === "success" ? "succeeded" : "failed");
    ctx.store.append(JOBS_STREAM, completed.event);
  }

  async function callTool(projectId, name, args) {
    const raw = await ctx.mcp.call(projectId, name, args);
    const result = normalizeToolResult(raw);
    const code = toolFailureCode(raw, result);
    if (code) throw new ToolFailure(code, result);
    return result;
  }

  async function runCommand({ command, jobType, project, caller, toolName, args, execute, render, failureRender, origin }) {
    const job = beginJob({ project, caller, jobType, origin });
    let result;
    try {
      result = execute ? await execute() : await callTool(project.id, toolName, args);
    } catch (error) {
      finishJob(job, "failed");
      const receipt = redact(failureRender ? failureRender(error) : getErrorText(error, command, error?.result));
      writeAudit({
        command,
        project,
        jobType,
        outcome: captureErrorCode(error, "MCP_TRANSPORT_ERROR"),
        origin,
      });
      return { error, receipt, result: null };
    }
    finishJob(job, "success");
    const receipt = redact(render(result));
    writeAudit({ command, project, jobType, outcome: "success", origin });
    return { result, receipt };
  }

  const remember = createRememberFlow(ctx, {
    now, idFactory, redact, replyMessages, sendText, validateText, projectError, runCommand,
  });

  async function recall(input) {
    const { project, caller, chatId, threadId, text } = input;
    const validation = validateText("recall", text);
    if (validation) return replyMessages(validation);
    const scopeError = projectError(project, "recall");
    if (scopeError) return replyMessages(scopeError);
    const query = redact(text.trim());
    const { result, receipt } = await runCommand({
      command: "recall",
      jobType: "ask",
      project,
      caller,
      chatId,
      threadId,
      toolName: "forge_search",
      args: { query, limit: RECALL_LIMIT },
      render: (found) => {
        const hits = Array.isArray(found?.hits) ? found.hits : [];
        if (Number(found?.total ?? hits.length) === 0) {
          return typeof found?.message === "string" && found.message
            ? found.message
            : recallFallback(query, project);
        }
        const rows = hits.slice(0, RECALL_LIMIT).map(renderHit);
        if (found?.truncated) rows.push("More results available — refine your query.");
        return rows.join("\n");
      },
    });
    return replyMessages(receipt);
  }

  function captureReplay(writeKey) {
    const existing = captureRecord(ctx.store, writeKey);
    if (existing) return replyMessages(existing.receipt);
    const inflight = inFlightCaptures.get(writeKey);
    return inflight ? inflight.then(replyMessages) : null;
  }

  async function idea(input) {
    const { project, caller, chatId, threadId, text } = input;
    const validation = validateText("idea", text);
    if (validation) return replyMessages(validation);
    const scopeError = projectError(project, "idea");
    if (scopeError) return replyMessages(scopeError);
    const content = redact(text.trim());
    const origin = captureOrigin(input);
    const writeKey = `idea:${project.id}:${String(input.updateId ?? idFactory())}`;
    const replay = captureReplay(writeKey);
    if (replay) return replay;
    const operation = runCommand({
      command: "idea",
      jobType: "capture",
      project,
      caller,
      origin,
      chatId,
      threadId,
      toolName: "forge_crucible_submit",
      args: { rawIdea: content, source: "human" },
      render: (smelt) => {
        const details = [
          smelt?.id ? `id ${smelt.id}` : "",
          smelt?.lane ? `lane ${smelt.lane}` : "",
          smelt?.firstQuestion ? `First question: ${smelt.firstQuestion}` : "",
        ].filter(Boolean).join(" — ");
        const preview = content.length > SNIPPET_MAX ? `${content.slice(0, SNIPPET_MAX)}…` : content;
        return `Submitted idea to ${projectName(project)}${details ? ` — ${details}` : ""}.\n> ${preview}`;
      },
    });
    inFlightCaptures.set(writeKey, operation.then(({ receipt, result }) => {
      if (result) ctx.store.append(CAPTURE_STREAM, {
        v: 1, key: writeKey, kind: "idea", project: project.id, receipt, origin, at: now(),
      });
      return receipt;
    }));
    try {
      return replyMessages(await inFlightCaptures.get(writeKey));
    } finally {
      inFlightCaptures.delete(writeKey);
    }
  }

  async function bug(input) {
    const { project, caller, chatId, threadId, text } = input;
    const validation = validateText("bug", text);
    if (validation) return replyMessages(validation);
    const scopeError = projectError(project, "bug");
    if (scopeError) return replyMessages(scopeError);
    const content = redact(text.trim());
    const origin = captureOrigin(input);
    const writeKey = `bug:${project.id}:${String(input.updateId ?? idFactory())}`;
    const replay = captureReplay(writeKey);
    if (replay) return replay;
    const operation = runCommand({
      command: "bug",
      jobType: "capture",
      project,
      caller,
      origin,
      chatId,
      threadId,
      toolName: "forge_bug_register",
      args: {
        // "contract" is the closest legal scanner enum; forge_bug_register has no operator-report option.
        scanner: "contract",
        severity: "medium",
        evidence: {
          testName: "operator-report",
          assertionMessage: content,
          reportedVia: "pforge-claw",
          ...(origin === "untrusted" ? { origin } : {}),
        },
      },
      render: (registered) => {
        if (registered?.classification === "infra" || registered?.type === "infra") {
          return "Recorded as infra, no bug id created.";
        }
        if (registered?.bugId) {
          const link = registered.issueUrl ?? registered.url ?? registered.issue?.html_url ?? registered.issue?.url;
          return `Registered bug ${registered.bugId}${link ? ` — ${link}` : ""}.`;
        }
        return `Bug report submitted to ${projectName(project)}.`;
      },
    });
    inFlightCaptures.set(writeKey, operation.then(({ result, receipt, error }) => {
      let finalReceipt = receipt;
      if (error instanceof ToolFailure && error.code === "DUPLICATE_BUG") {
        const existingId = error.result?.existingBugId ?? error.result?.bugId ?? error.result?.existing?.bugId;
        finalReceipt = existingId ? `Already registered as ${existingId}.` : "This bug was already registered.";
      }
      if (result || (error instanceof ToolFailure && error.code === "DUPLICATE_BUG")) {
        ctx.store.append(CAPTURE_STREAM, {
          v: 1, key: writeKey, kind: "bug", project: project.id, receipt: finalReceipt, origin, at: now(),
        });
      }
      return finalReceipt;
    }));
    try {
      return replyMessages(await inFlightCaptures.get(writeKey));
    } finally {
      inFlightCaptures.delete(writeKey);
    }
  }

  return { ...remember, recall, idea, bug };
}

let boundCaptureService = null;

export function bindCaptureService(service) {
  boundCaptureService = service;
  return () => {
    if (boundCaptureService === service) boundCaptureService = null;
  };
}

export function getBoundCaptureService() {
  return boundCaptureService;
}
