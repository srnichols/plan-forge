import { randomBytes } from "node:crypto";
import { ClawError } from "../errors.mjs";
import { JOBS_STREAM, createJob, transition } from "../jobs/model.mjs";
import { button, chunkText, keyboard } from "../channels/telegram/format.mjs";

export const MEMORY_TYPES = Object.freeze(["decision", "lesson", "convention", "pattern", "gotcha"]);
export const MEMORY_TYPE_LABELS = Object.freeze(["Decision", "Lesson", "Convention", "Pattern", "Gotcha"]);
const PENDING_STREAM = "memory-pending";
const CAPTURE_STREAM = "capture-writes";
const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_CONTENT_CHARS = 3500;
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

function parseStructured(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { text: value };
  }
}

function normalizeToolResult(result) {
  if (result?.structuredContent !== undefined) return parseStructured(result.structuredContent);
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof text === "string") return parseStructured(text);
  return result && typeof result === "object" ? result : { text: String(result ?? "") };
}

function toolErrorCode(result) {
  const code = result?.code ?? result?.error;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)
    ? code
    : "MCP_TOOL_ERROR";
}

function isOpenBrainError(code, message) {
  const normalized = `${code} ${message ?? ""}`.replace(/[_-]/g, " ");
  return /openbrain/i.test(normalized)
    && /not configured|unconfigured|missing|unavailable|disabled/i.test(normalized);
}

function sanitize(value) {
  return String(value ?? "local").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "local";
}

function configuredAlias(config, userId) {
  return config?.allowlist?.find((entry) => String(entry.userId) === String(userId))?.alias;
}

function createdBy(config, caller) {
  const alias = configuredAlias(config, caller?.userId);
  if (typeof alias === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(alias)
    && alias !== String(caller?.userId ?? "")) {
    return `pforge-claw:${alias}`;
  }
  return `pforge-claw:${caller?.role ?? "unknown"}`;
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
  const code = error instanceof ToolFailure
    ? error.code
    : /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error?.code ?? "")) ? error.code : "MCP_TOOL_ERROR";
  return toolErrorMessage(command, code, result ?? error?.result);
}

export function createCaptureService(ctx) {
  const now = ctx.now ?? Date.now;
  const idFactory = ctx.idFactory ?? (() => randomBytes(4).toString("hex"));
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
    return chunkText(redact(text), 1900).map((chunk) => ({ text: chunk }));
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

  function writeAudit({ command, project, jobType, outcome }) {
    ctx.store.append("audit", {
      kind: "capture",
      command,
      project: project.id,
      jobType,
      outcome,
    });
  }

  function beginJob({ project, caller, jobType }) {
    const created = createJob({
      id: idFactory(),
      type: jobType,
      projectId: project.id,
    });
    const job = {
      ...created.job,
      callerId: String(caller?.userId ?? ""),
      createdAt: new Date(now()).toISOString(),
    };
    ctx.store.append(JOBS_STREAM, created.event);
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
    if (raw?.isError || result?.ok === false) throw new ToolFailure(toolErrorCode(result), result);
    return result;
  }

  async function runCommand({ command, jobType, project, caller, toolName, args, render }) {
    const job = beginJob({ project, caller, jobType });
    let result;
    try {
      result = await callTool(project.id, toolName, args);
    } catch (error) {
      finishJob(job, "failed");
      const receipt = redact(getErrorText(error, command, error?.result));
      writeAudit({
        command,
        project,
        jobType,
        outcome: error instanceof ToolFailure ? error.code : error?.code ?? "MCP_TRANSPORT_ERROR",
      });
      return { error, receipt, result: null };
    }
    finishJob(job, "success");
    const receipt = redact(render(result));
    writeAudit({ command, project, jobType, outcome: "success" });
    return { result, receipt };
  }

  async function startRemember(input) {
    const { project, caller, chatId, threadId, text } = input;
    const validation = validateText("remember", text);
    if (validation) return replyMessages(validation);
    const scopeError = projectError(project, "remember");
    if (scopeError) return replyMessages(scopeError);
    const content = redact(text);
    const id = String(idFactory());
    const pending = {
      v: 1,
      id,
      projectId: project.id,
      chatId: String(chatId),
      threadId: threadId ?? null,
      userId: String(caller?.userId ?? ""),
      role: caller?.role ?? "unknown",
      text: content,
      expiresAt: now() + PENDING_TTL_MS,
      used: false,
      updateId: input.updateId ?? null,
    };
    const preview = content.length > SNIPPET_MAX ? `${content.slice(0, SNIPPET_MAX)}…` : content;
    const buttons = MEMORY_TYPE_LABELS.map((label, index) => [button(redact(label), `m:${id}:${index}`)]);
    const markup = keyboard(buttons);
    if (markup.inline_keyboard.some((row) => Buffer.byteLength(row[0].callback_data, "utf8") > 64)) {
      throw new ClawError("CALLBACK_DATA_TOO_LONG");
    }
    ctx.store.append(PENDING_STREAM, pending);
    await sendText({
      chatId,
      threadId,
      text: `Save as which type?\n> ${preview}`,
      replyMarkup: markup,
    });
    return [];
  }

  async function completeRemember({ payload, caller, chatId, threadId }) {
    const match = /^([A-Za-z0-9._-]{1,80}):([0-4])$/.exec(String(payload ?? ""));
    const reject = async (message) => {
      await sendText({ chatId, threadId, text: message });
      return [];
    };
    if (!match) return reject("Invalid selection.");
    const [, id, rawIndex] = match;
    const key = `remember:${id}`;
    const existing = captureRecord(ctx.store, key);
    if (existing) {
      await sendText({ chatId, threadId, text: existing.receipt });
      return [];
    }
    const pending = latestPending(ctx.store, id);
    if (!pending) return reject("This memory capture expired; send /remember again.");
    if (pending.expiresAt <= now()) return reject("This memory capture expired; send /remember again.");
    if (pending.used) return reject("This memory capture was already used.");
    if (!identityMatches(pending, { caller, chatId, threadId })) {
      return reject("This memory capture belongs to a different user, chat, or topic.");
    }
    const project = ctx.config.projects?.find((entry) => entry.id === pending.projectId);
    if (!project) return reject("This memory capture expired; send /remember again.");
    ctx.store.append(PENDING_STREAM, { id, used: true });
    const index = Number(rawIndex);
    const type = MEMORY_TYPES[index];
    const visibility = ["normal", "restricted"].includes(project.visibility) ? project.visibility : "normal";
    const source = `pforge-claw/${sanitize(ctx.config.instanceId)}/${sanitize(project.homeLane ?? "local")}/remember`;
    const args = {
      content: redact(pending.text),
      type,
      origin: "trusted",
      project: project.id,
      visibility,
      source,
      created_by: createdBy(ctx.config, { userId: pending.userId, role: pending.role }),
    };
    const { result, receipt } = await runCommand({
      command: "remember",
      jobType: "capture",
      project,
      caller,
      chatId,
      threadId,
      toolName: "forge_memory_capture",
      args,
      render: (saved) => {
        const savedId = saved?.id ?? saved?.url;
        if (savedId) return `Saved ${type} to ${projectName(project)} — id ${savedId}`;
        const instructionalText = saved?.text ?? saved?.message;
        const excerpt = typeof instructionalText === "string"
          ? `\n${instructionalText.slice(0, SNIPPET_MAX)}`
          : "";
        return `Submitted ${type} to ${projectName(project)} (no record id returned by forge_memory_capture)${excerpt}`;
      },
    });
    if (!result) {
      await sendText({ chatId, threadId, text: receipt });
      return [];
    }
    ctx.store.append(CAPTURE_STREAM, {
      v: 1, key, kind: "remember", project: project.id, receipt, at: now(),
    });
    await sendText({ chatId, threadId, text: receipt });
    return [];
  }

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

  async function idea(input) {
    const { project, caller, chatId, threadId, text } = input;
    const validation = validateText("idea", text);
    if (validation) return replyMessages(validation);
    const scopeError = projectError(project, "idea");
    if (scopeError) return replyMessages(scopeError);
    const content = redact(text.trim());
    const writeKey = `idea:${project.id}:${String(input.updateId ?? idFactory())}`;
    const existing = captureRecord(ctx.store, writeKey);
    if (existing) return replyMessages(existing.receipt);
    const inflight = inFlightCaptures.get(writeKey);
    if (inflight) return replyMessages(await inflight);
    const operation = runCommand({
      command: "idea",
      jobType: "capture",
      project,
      caller,
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
        v: 1, key: writeKey, kind: "idea", project: project.id, receipt, at: now(),
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
    const writeKey = `bug:${project.id}:${String(input.updateId ?? idFactory())}`;
    const existing = captureRecord(ctx.store, writeKey);
    if (existing) return replyMessages(existing.receipt);
    const inflight = inFlightCaptures.get(writeKey);
    if (inflight) return replyMessages(await inflight);
    const operation = runCommand({
      command: "bug",
      jobType: "capture",
      project,
      caller,
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
          v: 1, key: writeKey, kind: "bug", project: project.id, receipt: finalReceipt, at: now(),
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

  return { startRemember, completeRemember, recall, idea, bug };
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
