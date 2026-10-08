import { randomBytes } from "node:crypto";
import { APPROVER_ROLES } from "./approvals.mjs";
import { button, keyboard } from "./channels/telegram/format.mjs";
import { JOBS_STREAM, currentJobs, createJob, transition } from "./jobs/model.mjs";
import { ClawError } from "./errors.mjs";

const MAX_REASON_LENGTH = 1500;
const MAX_FAILURE_CONTEXT = 2000;
const PROGRESS_STREAM = "progress";
const MISSING = "n/a";
const MAX_CALLBACK_BYTES = 64;

function redact(secrets, value) {
  return (secrets?.redact ?? String)(String(value));
}

// Rendered text stays plain; the channel adapter owns MarkdownV2 escaping.
function display(state, value) {
  return redact(state?.secrets, value);
}

function truncate(value, maxLength = MAX_REASON_LENGTH) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  const marker = "… [truncated]";
  return `${text.slice(0, maxLength - marker.length)}${marker}`;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return MISSING;
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatSpend(value) {
  return Number.isFinite(value) ? `$${value.toFixed(2)}` : MISSING;
}

function formatSlice(slice) {
  const n = Number.isFinite(slice?.n) ? String(slice.n) : MISSING;
  const m = Number.isFinite(slice?.m) ? String(slice.m) : MISSING;
  return `${n}/${m}`;
}

function commonFields(state) {
  return [
    `State: ${display(state, state?.state ?? MISSING)}`,
    `Lane: ${display(state, state?.lane ?? MISSING)}`,
    `Slice: ${display(state, formatSlice(state?.slice))}`,
    ...(Number.isFinite(state?.percent) ? [`Progress: ${state.percent}%`] : []),
    `Elapsed: ${display(state, formatDuration((state?.now ?? Date.now)() - state?.startedAt))}`,
    `Spend: ${display(state, formatSpend(state?.spend))}`,
  ];
}

export function renderProgress(state) {
  return ["Progress Update", ...commonFields(state)].join("\n");
}

export function renderSliceComplete(state, slice) {
  const normalized = {
    ...state,
    slice: {
      n: slice?.index ?? slice?.n ?? state?.slice?.n,
      m: slice?.total ?? slice?.m ?? state?.slice?.m,
    },
  };
  return ["Slice Complete", ...commonFields(normalized)].join("\n");
}

export function renderFailure(state, reason) {
  const fields = commonFields({ ...state, state: state?.state ?? "failed" });
  fields.push(`Reason: ${display(state, truncate(redact(state?.secrets, reason)))}`);
  return ["Failure", ...fields].join("\n");
}

export function renderRunSummary(state, result) {
  const summary = typeof result === "string"
    ? result
    : result?.summary ?? result?.message ?? result?.reason ?? "";
  const artifactText = state?.prUrl
    ? `Pull request: ${state.prUrl}`
    : state?.artifacts?.length
      ? `Artifacts: ${state.artifacts.join(", ")}`
      : "Artifacts: No artifacts reported";
  return [
    "Run Summary",
    ...commonFields({ ...state, state: state?.state ?? "succeeded" }),
    `Result: ${display(state, truncate(redact(state?.secrets, summary || MISSING)))}`,
    display(state, artifactText),
  ].join("\n");
}

export function failureKeyboard(job, { canResume = false } = {}) {
  const short = String(job?.id ?? "").slice(0, 8);
  const entries = [
    button("🔁 Retry", `f:r:${short}`),
    ...(canResume && job?.type === "plan" ? [button("⏭ Resume-from-next", `f:n:${short}`)] : []),
    button("🛑 Abort", `f:a:${short}`),
    button("🤔 Why?", `f:w:${short}`),
  ];
  for (const entry of entries) {
    if (Buffer.byteLength(entry.callback_data, "utf8") > MAX_CALLBACK_BYTES) {
      throw new ClawError("CALLBACK_DATA_TOO_LONG");
    }
  }
  return keyboard([entries]);
}

function normalizeMessageRef(result) {
  const message = Array.isArray(result) ? result[0] : result;
  return message?.messageId === undefined || message?.messageId === null
    ? null
    : { messageId: String(message.messageId) };
}

function streamRecords(store, stream) {
  if (!store || typeof store.read !== "function") return [];
  return [...store.read(stream)].map(({ record }) => record);
}

function sliceValues(data = {}) {
  const raw = data.index ?? data.n;
  const n = Number.isFinite(raw) ? (raw === 0 ? 1 : raw) : null;
  const m = Number.isFinite(data.total ?? data.m) ? data.total ?? data.m : null;
  return { n, m };
}

function percentValue(data = {}) {
  const value = data.percent;
  return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
}

function costValue(data = {}) {
  for (const key of ["costUsd", "costUSD", "usd", "cost"]) {
    if (Number.isFinite(data[key])) return data[key];
  }
  return null;
}

function jobTime(job) {
  const time = Date.parse(job?.createdAt ?? "");
  return Number.isFinite(time) ? time : 0;
}

function sameChatAndTopic(job, chatId, threadId) {
  return String(job?.chatId ?? "") === String(chatId ?? "")
    && String(job?.threadId ?? "") === String(threadId ?? "");
}

function errorCode(error, fallback = "INTERNAL") {
  return typeof error?.code === "string" ? error.code : fallback;
}

export function createProgressService({
  store,
  bus,
  channel,
  mcp,
  secrets,
  lanes,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  logger,
  minEditMs = 3000,
} = {}) {
  const tracked = new Map();
  const recoveryChains = new Map();
  const suggestions = new Map();
  const inFlight = new Set();
  const refs = new Map();
  const recovered = new Map();
  let stopped = false;

  for (const record of streamRecords(store, PROGRESS_STREAM)) {
    if (record.kind === "progress.message" && typeof record.jobId === "string") {
      refs.set(record.jobId, String(record.messageId));
    } else if (record.kind === "progress.recovered" && typeof record.jobId === "string") {
      recovered.set(`${record.jobId}:${record.mode}`, record.childId);
    } else if (record.kind === "progress.suggestions" && typeof record.jobId === "string") {
      suggestions.set(record.jobId, record.items ?? []);
    }
  }

  function audit(record) {
    try {
      store?.append?.("audit", record);
    } catch (error) {
      logger?.error?.("Progress audit write failed", { code: errorCode(error, "STORE_WRITE_FAILED") });
    }
  }

  function records() {
    return streamRecords(store, PROGRESS_STREAM);
  }

  function findJob(jobId) {
    try {
      return currentJobs(store)[jobId] ?? null;
    } catch (error) {
      logger?.error?.("Progress job lookup failed", { code: errorCode(error, "JOBS_UNAVAILABLE") });
      return null;
    }
  }

  function ensureState(job, event) {
    if (!job?.id) return null;
    let state = tracked.get(job.id);
    if (state) {
      state.state = event?.to ?? state.state ?? job.state;
      if (job.lane) state.lane = job.lane;
      return state;
    }
    const startedAt = Number.isFinite(now()) ? now() : Date.now();
    state = {
      job,
      jobId: job.id,
      state: event?.to ?? job.state ?? "running",
      chatId: job.chatId ?? null,
      threadId: job.threadId ?? null,
      messageId: refs.get(job.id) ?? null,
      startedAt,
      lane: job.lane ?? null,
      slice: { n: null, m: null },
      percent: null,
      spend: null,
      artifacts: [],
      prUrl: null,
      lastSeq: 0,
      lastText: null,
      terminal: false,
      lastEditAt: null,
      pending: null,
      timer: null,
      sending: null,
      secrets,
      now,
    };
    tracked.set(job.id, state);
    return state;
  }

  function format(text) {
    return redact(secrets, text);
  }

  function trackPromise(promise) {
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
    return promise;
  }

  async function ensureMessage(state) {
    if (state.messageId || !channel?.send) return state.messageId;
    if (state.sending) return state.sending;
    const sendPromise = (async () => {
      try {
        const text = renderProgress(state);
        const sent = await channel.send({
          chatId: state.chatId,
          threadId: state.threadId,
          text,
        });
        const ref = normalizeMessageRef(sent);
        if (!ref) {
          logger?.error?.("Progress message reference missing", { code: "CHANNEL_MESSAGE_REFERENCE_MISSING" });
          return null;
        }
        state.messageId = ref.messageId;
        // Record what was actually sent so a pending identical edit is skipped.
        state.lastText = text;
        state.lastEditAt = null;
        store?.append?.(PROGRESS_STREAM, {
          kind: "progress.message",
          jobId: state.jobId,
          messageId: state.messageId,
        });
        refs.set(state.jobId, state.messageId);
        return state.messageId;
      } catch (error) {
        logger?.error?.("Progress message could not be sent", { code: errorCode(error, "CHANNEL_SEND_FAILED") });
        return null;
      }
    })();
    state.sending = trackPromise(sendPromise);
    try {
      return await sendPromise;
    } finally {
      if (state.sending === sendPromise) state.sending = null;
      if (state.pending) scheduleTimer(state);
    }
  }

  function scheduleTimer(state) {
    if (stopped || state.timer || !state.pending) return;
    const elapsed = state.lastEditAt === null ? minEditMs : now() - state.lastEditAt;
    const delay = Math.max(0, minEditMs - elapsed);
    state.timer = setTimer(() => {
      state.timer = null;
      void flushEdit(state);
    }, delay);
    state.timer?.unref?.();
  }

  async function flushEdit(state) {
    if (!state.pending || state.sending) return;
    if (!state.messageId) {
      await ensureMessage(state);
      if (!state.messageId) return;
    }
    const elapsed = state.lastEditAt === null ? minEditMs : now() - state.lastEditAt;
    if (elapsed < minEditMs) {
      scheduleTimer(state);
      return;
    }
    const update = state.pending;
    state.pending = null;
    // A redundant edit would spend the 3 s budget and delay the next real update.
    if (update.text === state.lastText && !update.keyboard) return;
    const editPromise = (async () => {
      try {
        await channel.edit({
          chatId: state.chatId,
          threadId: state.threadId,
          messageId: state.messageId,
          text: update.text,
          ...(update.keyboard ? { replyMarkup: update.keyboard } : {}),
        });
        state.lastEditAt = now();
        state.lastText = update.text;
      } catch (error) {
        const code = String(error?.code ?? "");
        const message = String(error?.message ?? "").toLowerCase();
        if (message.includes("message is not modified") || code === "MESSAGE_NOT_MODIFIED") return;
        if (["MESSAGE_NOT_FOUND", "MESSAGE_DELETED"].includes(code)
          || message.includes("message to edit not found") || message.includes("message was deleted")) {
          audit({ kind: "progress-edit-failed", jobId: state.jobId, reason: code || "MESSAGE_NOT_FOUND" });
          return;
        }
        logger?.error?.("Progress message edit failed", { code: code || "CHANNEL_EDIT_FAILED" });
      }
    })();
    state.sending = trackPromise(editPromise);
    try {
      await editPromise;
    } finally {
      if (state.sending === editPromise) state.sending = null;
      if (state.pending) scheduleTimer(state);
    }
  }

  function scheduleEdit(state, text, replyMarkup) {
    if (stopped || text === state.lastText || text === state.pending?.text) return;
    state.pending = { text, keyboard: replyMarkup ?? null };
    if (!state.sending
      && (state.lastEditAt === null || now() - state.lastEditAt >= minEditMs)) {
      void flushEdit(state);
    } else {
      scheduleTimer(state);
    }
  }

  function captureLaneEvent(event) {
    const job = findJob(event?.jobId);
    if (!job) return;
    const state = ensureState(job);
    if (!state || state.terminal || !Number.isFinite(event?.seq) || event.seq <= state.lastSeq) return;
    state.lastSeq = event.seq;
    const data = event.data ?? {};
    if (event.type === "started") {
      state.lane = data.lane ?? data.laneId ?? job.lane ?? null;
      scheduleEdit(state, renderProgress(state));
    } else if (event.type === "progress") {
      const percent = percentValue(data);
      if (percent !== null) state.percent = Math.max(state.percent ?? 0, percent);
      scheduleEdit(state, renderProgress(state));
    } else if (event.type === "slice") {
      state.slice = sliceValues(data);
      scheduleEdit(state, renderSliceComplete(state, state.slice));
    } else if (event.type === "cost") {
      const amount = costValue(data);
      if (amount !== null) state.spend = (state.spend ?? 0) + amount;
      scheduleEdit(state, renderProgress(state));
    } else if (event.type === "artifact") {
      const artifact = data.name ?? data.path ?? data.url ?? data.kind;
      if (artifact !== undefined && artifact !== null) state.artifacts.push(String(artifact));
      if (data.kind === "pr" && typeof data.url === "string") state.prUrl = data.url;
      scheduleEdit(state, renderProgress(state));
    } else if (event.type === "needs-input") {
      state.state = "needs-input";
      scheduleEdit(state, renderProgress(state));
    }
  }

  async function onJobTransition(event) {
    if (!["leased", "running"].includes(event?.to)) return;
    const job = findJob(event.jobId);
    if (!job) return;
    const state = ensureState(job, event);
    await ensureMessage(state);
  }

  function onLaneEvent(event) {
    captureLaneEvent(event);
  }

  function onJobFinished(event) {
    const job = findJob(event?.jobId);
    const state = ensureState(job, { to: event?.state });
    if (!state) return;
    state.state = event.state ?? state.state;
    state.terminal = true;
    if (state.state === "succeeded" && Number.isFinite(state.percent)) state.percent = 100;
    const done = async () => {
      await ensureMessage(state);
      const failure = ["failed", "cancelled"].includes(state.state);
      const text = failure
        ? renderFailure(state, event.reason ?? state.state)
        : renderRunSummary(state, event.result ?? {});
      const canResume = job.type === "plan" && Number.isFinite(state.slice.n)
        && Number.isFinite(state.slice.m) && state.slice.n < state.slice.m;
      scheduleEdit(state, text, failure ? failureKeyboard(job, { canResume }) : null);
    };
    const promise = done().catch((error) => {
      logger?.error?.("Progress finish update failed", { code: errorCode(error, "PROGRESS_FINISH_FAILED") });
    });
    trackPromise(promise);
  }

  function resolveJob(ref, { projectId, chatId, threadId, states = [] } = {}) {
    let jobs;
    try {
      jobs = Object.values(currentJobs(store));
    } catch {
      throw new ClawError("JOBS_UNAVAILABLE");
    }
    const positions = new Map(jobs.map((job, index) => [job.id, index]));
    const candidates = jobs.filter((job) => job.projectId === projectId
      && sameChatAndTopic(job, chatId, threadId)
      && (!states.length || states.includes(job.state)));
    if (String(ref ?? "").toLowerCase() === "latest") {
      candidates.sort((left, right) => jobTime(right) - jobTime(left)
        || positions.get(right.id) - positions.get(left.id));
      if (candidates[0]) return candidates[0];
      throw new ClawError("JOB_NOT_FOUND");
    }
    const prefix = String(ref ?? "");
    if (!/^[0-9a-f]{8,24}$/i.test(prefix)) throw new ClawError("JOB_NOT_FOUND");
    const normalizedPrefix = prefix.toLowerCase();
    const matches = candidates.filter((job) => job.id.toLowerCase().startsWith(normalizedPrefix));
    if (matches.length > 1) throw new ClawError("AMBIGUOUS_JOB");
    if (matches.length === 0) throw new ClawError("JOB_NOT_FOUND");
    return matches[0];
  }

  function serializeRecovery(jobId, operation) {
    const previous = recoveryChains.get(jobId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    recoveryChains.set(jobId, current);
    return current.finally(() => {
      if (recoveryChains.get(jobId) === current) recoveryChains.delete(jobId);
    });
  }

  async function createRecoveryJob(failedJob, {
    mode = "retry",
    caller,
    chatId,
    threadId,
    description,
  } = {}) {
    if (!failedJob || failedJob.state !== "failed") {
      return { ok: false, error: "NOT_RETRYABLE", text: "NOT_RETRYABLE: only failed jobs can be recovered." };
    }
    if (!["retry", "resume", "suggestion"].includes(mode)) {
      return { ok: false, error: "RECOVERY_MODE_INVALID", text: "RECOVERY_MODE_INVALID: recovery was not created." };
    }
    return serializeRecovery(failedJob.id, async () => {
      const key = `${failedJob.id}:${mode}`;
      const existing = recovered.get(key) ?? records()
        .findLast((record) => record.kind === "progress.recovered"
          && record.jobId === failedJob.id && record.mode === mode)?.childId;
      if (existing) return { ok: true, jobId: existing, existing: true, text: `Recovery job ${existing} is already awaiting approval.` };
      if (mode === "resume" && failedJob.type !== "plan") {
        return { ok: false, error: "NOT_RESUMABLE", text: "NOT_RESUMABLE: only plan jobs can resume." };
      }
      const state = ensureState(failedJob);
      if (mode === "resume" && (!Number.isFinite(state?.slice?.n)
        || !Number.isFinite(state?.slice?.m) || state.slice.n >= state.slice.m)) {
        return { ok: false, error: "NOT_RESUMABLE", text: "NOT_RESUMABLE: no next plan slice is known." };
      }
      const source = mode === "suggestion"
        ? { ...failedJob, type: "task", description: String(description ?? "").trim() }
        : failedJob;
      if (mode === "suggestion" && !source.description) {
        return { ok: false, error: "SUGGESTION_EXPIRED", text: "suggestion expired" };
      }
      const id = randomBytes(12).toString("hex");
      try {
        const created = createJob({
          id,
          type: source.type,
          projectId: failedJob.projectId,
          parentId: failedJob.id,
        });
        const allowlisted = ["description", "plan", "skill", "args", "chatId", "threadId"];
        const copied = Object.fromEntries(allowlisted
          .filter((field) => source[field] !== undefined)
          .map((field) => [field, source[field]]));
        if (source.type === "plan") {
          const planPath = source.plan ?? source.planPath;
          if (typeof planPath === "string") copied.planPath = planPath;
        }
        const job = {
          ...created.job,
          ...copied,
          ...(mode === "suggestion" ? { description: source.description } : {}),
          ...(chatId !== undefined ? { chatId } : {}),
          ...(threadId !== undefined ? { threadId } : {}),
          callerId: String(caller?.userId ?? ""),
          createdAt: new Date(now()).toISOString(),
          ...(mode === "resume" ? { resumeFrom: state?.slice?.n + 1 } : {}),
        };
        store.append(JOBS_STREAM, { kind: "job.created", job });
        const awaiting = transition(job, "awaiting-approval", { reason: `progress:${mode}` });
        store.append(JOBS_STREAM, awaiting.event);
        bus?.emit?.("job.transition", awaiting.event);
        store.append(PROGRESS_STREAM, {
          kind: "progress.recovered",
          jobId: failedJob.id,
          childId: job.id,
          mode,
        });
        recovered.set(key, job.id);
        audit({
          kind: "progress-recovery-created",
          jobId: failedJob.id,
          childId: job.id,
          mode,
          userId: caller?.userId,
          chatId,
          threadId,
        });
        return { ok: true, jobId: job.id, job: awaiting.job, text: `Recovery job ${job.id} is awaiting approval.` };
      } catch (error) {
        const code = errorCode(error, "RECOVERY_FAILED");
        audit({ kind: "progress-recovery-failed", jobId: failedJob.id, mode, reason: code });
        return { ok: false, error: code, text: `${code}: Recovery job was not created.` };
      }
    });
  }

  async function abortJob(job, caller) {
    if (!job) return { ok: false, error: "JOB_NOT_FOUND", text: "JOB_NOT_FOUND: job not found." };
    if (["leased", "running", "needs-input"].includes(job.state)) {
      const lane = typeof lanes === "function"
        ? lanes(job.lane)
        : typeof lanes?.get === "function"
          ? lanes.get(job.lane)
          : lanes?.[job.lane];
      if (!lane || typeof lane.cancel !== "function") {
        audit({ kind: "progress-abort-failed", jobId: job.id, userId: caller?.userId, reason: "LANE_UNAVAILABLE" });
        return { ok: false, error: "LANE_UNAVAILABLE", text: "LANE_UNAVAILABLE: cancellation not delivered." };
      }
      try {
        const result = await lane.cancel(job.id);
        if (result?.ok === false) {
          const code = typeof result.error === "string" ? result.error : "LANE_CANCEL_FAILED";
          audit({ kind: "progress-abort-failed", jobId: job.id, userId: caller?.userId, reason: code });
          return { ok: false, error: code, text: `${code}: cancellation was not delivered.` };
        }
        audit({ kind: "progress-abort-requested", jobId: job.id, userId: caller?.userId });
        return { ok: true, text: "Cancellation requested." };
      } catch (error) {
        const code = errorCode(error, "LANE_CANCEL_FAILED");
        audit({ kind: "progress-abort-failed", jobId: job.id, userId: caller?.userId, reason: code });
        return { ok: false, error: code, text: `${code}: cancellation was not delivered.` };
      }
    }
    if (job.state !== "failed") {
      return { ok: false, error: "NOT_ABORTABLE", text: "NOT_ABORTABLE: only leased, running, needs-input, or failed jobs can be aborted." };
    }
    audit({ kind: "progress.discarded", jobId: job.id, userId: caller?.userId });
    const state = ensureState(job);
    if (state?.messageId && channel?.edit) {
      scheduleEdit(state, renderFailure(state, "Job discarded."), { inline_keyboard: [] });
    }
    return { ok: true, text: "Failed job dismissed." };
  }

  async function sendReply({ chatId, threadId, text, replyMarkup }) {
    if (!channel?.send || chatId === undefined || chatId === null) return;
    try {
      await channel.send({
        chatId,
        threadId,
        text: format(text),
        ...(replyMarkup ? { replyMarkup } : {}),
      });
    } catch (error) {
      logger?.error?.("Progress reply could not be sent", { code: errorCode(error, "CHANNEL_SEND_FAILED") });
    }
  }

  async function explainFailure(job, { caller, chatId, threadId } = {}) {
    const state = ensureState(job);
    const failureSummary = truncate(redact(secrets, renderFailure(state, job?.reason ?? "failed")), MAX_FAILURE_CONTEXT);
    const args = {
      message: `Why did job ${job.id} fail? Suggest fixes.`,
      caller: {
        role: caller?.role,
        channel: "chat",
        surface: channel?.id ?? "telegram",
        project: job.projectId,
        topic: threadId,
      },
      responseFormat: { style: "brief", maxChars: 3500 },
      proposeActions: true,
      contextBlocks: [{ title: "Failure summary", text: failureSummary }],
    };
    let result;
    try {
      if (!mcp || typeof mcp.call !== "function") throw new ClawError("MCP_TOOL_ERROR");
      result = await mcp.call(job.projectId, "forge_master_ask", args);
    } catch {
      await sendReply({ chatId, threadId, text: "MCP_TOOL_ERROR: couldn't explain right now." });
      return { ok: false, error: "MCP_TOOL_ERROR" };
    }
    if (result?.error === "pforge-master not installed") {
      await sendReply({ chatId, threadId, text: "Forge-Master isn't installed for this project. Run `pforge claw doctor`." });
      return { ok: false, error: "MCP_NOT_INSTALLED" };
    }
    if (result?.error || result?.isError || result?.ok === false) {
      await sendReply({ chatId, threadId, text: "MCP_TOOL_ERROR: couldn't explain right now." });
      return { ok: false, error: "MCP_TOOL_ERROR" };
    }
    const items = (Array.isArray(result?.proposedActions) ? result.proposedActions : [])
      .filter((action) => action
        && typeof (action.label ?? action.summary) === "string"
        && String(action.label ?? action.summary).trim())
      .slice(0, 5)
      .map((action) => ({
        label: truncate(redact(secrets, action.label ?? action.summary), 80),
        description: truncate(redact(secrets, action.summary ?? action.label), 1000),
      }));
    suggestions.set(job.id, items);
    try {
      store?.append?.(PROGRESS_STREAM, { kind: "progress.suggestions", jobId: job.id, items });
    } catch (error) {
      logger?.error?.("Progress suggestions could not be saved", {
        code: errorCode(error, "PROGRESS_SUGGESTIONS_WRITE_FAILED"),
      });
      await sendReply({ chatId, threadId, text: "MCP_TOOL_ERROR: couldn't explain right now." });
      return { ok: false, error: "PROGRESS_SUGGESTIONS_WRITE_FAILED" };
    }
    const buttons = items.map((item, index) => button(item.label, `f:s:${job.id.slice(0, 8)}:${index}`));
    const replyMarkup = buttons.length
      ? keyboard([
        ...(failureKeyboard(job, {
          canResume: job.type === "plan" && state.slice.n < state.slice.m,
        }).inline_keyboard),
        ...buttons.map((item) => [item]),
      ])
      : failureKeyboard(job, { canResume: job.type === "plan" && state.slice.n < state.slice.m });
    const answer = typeof (result.reply ?? result.text ?? result.answer) === "string"
      ? truncate(result.reply ?? result.text ?? result.answer)
      : renderFailure(state, job.reason ?? "failed");
    if (state.messageId && channel?.edit) {
      scheduleEdit(state, format(answer), replyMarkup);
    } else {
      await sendReply({ chatId, threadId, text: answer, replyMarkup });
    }
    return { ok: true, items };
  }

  async function applySuggestion(job, index, options) {
    const items = suggestions.get(job.id) ?? records().findLast((record) => (
      record.kind === "progress.suggestions" && record.jobId === job.id
    ))?.items ?? [];
    const item = items[index];
    if (!item) {
      return { ok: false, error: "SUGGESTION_EXPIRED", text: "suggestion expired" };
    }
    return createRecoveryJob(job, {
      ...options,
      mode: "suggestion",
      description: item.description || item.label,
    });
  }

  async function stop() {
    stopped = true;
    for (const state of tracked.values()) {
      if (state.timer) clearTimer(state.timer);
      state.timer = null;
    }
    await Promise.allSettled([...inFlight, ...[...tracked.values()].map((state) => state.sending).filter(Boolean)]);
  }

  return {
    store,
    channel,
    onJobTransition,
    onLaneEvent,
    onJobFinished,
    scheduleEdit,
    resolveJob,
    createRecoveryJob,
    abortJob,
    explainFailure,
    applySuggestion,
    sendReply,
    audit,
    stop,
    snapshot() {
      return {
        tracked: tracked.size,
        pendingEdits: [...tracked.values()].filter((state) => state.pending !== null).length,
      };
    },
  };
}

let progressService = null;
let auditTap = null;

export function bindProgressService(service) {
  progressService = service;
  auditTap = service?.audit ?? auditTap;
  return () => {
    if (progressService === service) progressService = null;
  };
}

export function getProgressService() {
  return progressService;
}

export function writeProgressAudit(record) {
  try {
    auditTap?.(record);
  } catch {
    // Audit failures must not prevent a progress callback from being handled.
  }
}
