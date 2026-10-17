import { APPROVER_ROLES } from "./approvals.mjs";
import { button, keyboard } from "./channels/telegram/format.mjs";
import { authorizeJobRequest, currentCaller, readCurrentConfig } from "./handlers/c2-command-context.mjs";
import { approvedChoicesFor, consumedApprovalFor } from "./jobs/approval-proof.mjs";
import { JOBS_STREAM, currentJobs } from "./jobs/model.mjs";
import {
  ensureRequestJob, findRequestJob, normalizeRequestFields, requestIdentity, requestKey, withRequestIdentity,
} from "./jobs/request-identity.mjs";
import { ClawError } from "./errors.mjs";

const MAX_REASON_LENGTH = 1500;
const MAX_FAILURE_CONTEXT = 2000;
const PROGRESS_STREAM = "progress";
const MISSING = "n/a";
const MAX_CALLBACK_BYTES = 64;
const SECONDS_PER_MINUTE = 60;
const ID_PREFIX_LENGTH = 8;
const RECOVERY_MODES = Object.freeze(["retry", "resume", "suggestion"]);
const RECOVERY_FIELDS = Object.freeze([
  "description", "plan", "planPath", "skill", "args", "model", "models", "resumeFrom", "readOnly", "origin",
]);
const RECOVERY_SCOPE_FIELDS = Object.freeze(["projectId", "callerId", "chatId", "threadId"]);
const MAX_SUGGESTIONS = 5;
const MAX_SUGGESTION_LABEL_LENGTH = 80;
const MAX_SUGGESTION_DESCRIPTION_LENGTH = 1000;
const EXPLANATION_UNAVAILABLE = "MCP_TOOL_ERROR: couldn't explain right now.";

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
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`;
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
  const short = String(job?.id ?? "").slice(0, ID_PREFIX_LENGTH);
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

function captureArtifact(state, data) {
  const artifact = data.name ?? data.path ?? data.url ?? data.kind;
  if (artifact !== undefined && artifact !== null) state.artifacts.push(String(artifact));
  if (data.kind === "pr" && typeof data.url === "string") state.prUrl = data.url;
}

function updateLaneState(state, job, event) {
  const data = event.data ?? {};
  if (event.type === "started") {
    state.lane = data.lane ?? data.laneId ?? job.lane ?? null;
    return renderProgress(state);
  }
  if (event.type === "progress") {
    const percent = percentValue(data);
    if (percent !== null) state.percent = Math.max(state.percent ?? 0, percent);
    return renderProgress(state);
  }
  if (event.type === "slice") {
    state.slice = sliceValues(data);
    return renderSliceComplete(state, state.slice);
  }
  if (event.type === "cost") {
    const amount = costValue(data);
    if (amount !== null) state.spend = (state.spend ?? 0) + amount;
    return renderProgress(state);
  }
  if (event.type === "artifact") {
    captureArtifact(state, data);
    return renderProgress(state);
  }
  if (event.type === "needs-input") {
    state.state = "needs-input";
    return renderProgress(state);
  }
  return null;
}

function resolveProgressJob(store, ref, { projectId, chatId, threadId, callerId, states = [] } = {}) {
  let jobs;
  try {
    jobs = Object.values(currentJobs(store));
  } catch {
    throw new ClawError("JOBS_UNAVAILABLE");
  }
  const positions = new Map(jobs.map((job, index) => [job.id, index]));
  const requesterId = normalizeRequestFields({ callerId }).callerId;
  const candidates = jobs.filter((job) => job.projectId === projectId
    && sameChatAndTopic(job, chatId, threadId)
    && (!states.length || states.includes(job.state))
    && (requesterId === null || normalizeRequestFields({ callerId: job.callerId }).callerId === requesterId));
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

function recoveryFailure(code, text = "Recovery job was not created.") {
  return { ok: false, error: code, text: `${code}: ${text}` };
}

function recoveryCallerFields(context, options) {
  const caller = options.caller ?? {};
  return {
    adapter: options.adapter ?? caller.channel ?? context.channel?.id,
    callerId: caller.userId ?? caller.callerId,
  };
}

function recoveryDeliveryIdentity({ request, mode, messageId, callback, suggestionIndex }) {
  if (requestIdentity(request) === null) return null;
  return requestIdentity({
    ...request,
    updateId: JSON.stringify([mode, callback ? "callback" : "delivery",
      callback ? messageId : request.updateId, suggestionIndex]),
  });
}

function recoveryRequest({ context, parent, options, mode }) {
  const request = normalizeRequestFields({
    ...recoveryCallerFields(context, options),
    updateId: options.updateId,
    type: mode === "suggestion" ? "task" : parent.type,
    projectId: options.project?.id ?? options.projectId ?? parent.projectId,
    chatId: options.chatId,
    threadId: options.threadId,
    parentId: parent.id,
  });
  const delivery = requestIdentity(request);
  const messageId = normalizeRequestFields({ updateId: options.messageId }).updateId;
  const suggestionIndex = normalizeRequestFields({ updateId: options.suggestionIndex }).updateId;
  const callback = options.fromCallback === true && !!messageId && delivery !== null;
  const identity = recoveryDeliveryIdentity({ request, mode, messageId, callback, suggestionIndex });
  return { request, identity, messageId, callback };
}

function validateRecoveryScope({ parent, request, project }) {
  const scope = normalizeRequestFields(parent);
  if (!RECOVERY_SCOPE_FIELDS.every((field) => scope[field] === request[field])) {
    throw new ClawError("JOB_NOT_FOUND");
  }
  if (scope.adapter !== null && scope.adapter !== request.adapter) throw new ClawError("JOB_NOT_FOUND");
  const route = project.channel;
  if (route?.adapter !== request.adapter
    || !sameChatAndTopic({ chatId: route?.chatId, threadId: route?.topicId }, request.chatId, request.threadId)) {
    throw new ClawError("JOB_NOT_FOUND");
  }
}

function admitRecovery(context, delivery, options) {
  const source = options.services ?? context.authoritySource;
  const config = readCurrentConfig(source);
  const { request } = delivery;
  const caller = currentCaller(config, { callerId: request.callerId, channel: request.adapter });
  const admitted = authorizeJobRequest({
    config, project: { id: request.projectId }, caller,
    secrets: source?.secrets ?? context.secrets, store: context.store,
    lanes: source?.lanes ?? context.lanes,
  });
  if (!admitted.ok) throw new ClawError(admitted.code);
  const parent = currentJobs(context.store)[request.parentId];
  if (!parent || parent.state !== "failed") throw new ClawError("NOT_RETRYABLE");
  validateRecoveryScope({ parent, request, project: admitted.project });
  return { ...admitted, config, parent };
}

function validateRecoveryChild(job, delivery, mode) {
  const stored = requestIdentity(job);
  const expected = requestIdentity({ ...delivery.request, updateId: job.updateId });
  if (!stored || requestKey(stored) !== requestKey(expected)
    || job.recoveryMode !== mode || requestKey(job.recoveryRequest) !== requestKey(delivery.identity)) {
    throw new ClawError("RECOVERY_REQUEST_CONFLICT");
  }
}

function findRecoveryJob(store, delivery, mode) {
  let job = findRequestJob(store, delivery.request);
  if (!job && delivery.callback) {
    const matches = Object.values(currentJobs(store)).filter((candidate) => candidate.recoveryMode === mode
      && requestKey(candidate.recoveryRequest) === requestKey(delivery.identity));
    if (matches.length > 1) throw new ClawError("REQUEST_DUPLICATE");
    job = matches.length ? findRequestJob(store, matches[0]) : null;
  }
  if (job) validateRecoveryChild(job, delivery, mode);
  return job;
}

function nextRecoverySlice(context, parent) {
  if (parent.type !== "plan") throw new ClawError("NOT_RESUMABLE");
  const slice = context.ensureState(parent)?.slice ?? {};
  if (!Number.isFinite(slice.n) || !Number.isFinite(slice.m) || slice.n >= slice.m) {
    throw new ClawError("NOT_RESUMABLE");
  }
  return slice.n + 1;
}

function buildRecoveryFields({ context, admitted, mode, description, delivery }) {
  const { parent, config, caller, constraint } = admitted;
  const copied = Object.fromEntries(RECOVERY_FIELDS
    .filter((field) => parent[field] !== undefined)
    .map((field) => [field, parent[field]]));
  const approval = consumedApprovalFor({ store: context.store, config, job: parent });
  const choices = approvedChoicesFor({ job: parent, approval });
  if (choices.quorum !== null) copied.quorum = choices.quorum;
  else if (parent.quorum !== undefined) copied.quorum = parent.quorum;
  if (parent.type === "plan") copied.planPath = parent.plan ?? parent.planPath;
  if (mode === "resume") copied.resumeFrom = nextRecoverySlice(context, parent);
  if (mode === "suggestion") {
    copied.description = String(description ?? "").trim();
    copied.readOnly = false;
    if (!copied.description) throw new ClawError("SUGGESTION_EXPIRED");
  }
  return {
    ...copied, callerRole: caller.role, ...(constraint ? { constraint } : {}),
    messageId: delivery.messageId, recoveryMode: mode, recoveryRequest: delivery.identity,
  };
}

function recoveryStore(store, mode, events) {
  return {
    fold: (...args) => store.fold(...args),
    read: (...args) => store.read(...args),
    append(stream, record) {
      const event = record.kind === "job.transition" ? { ...record, reason: `progress:${mode}` } : record;
      const stored = store.append(stream, event);
      events.push(stored);
      return stored;
    },
  };
}

function recoveryReply(job, recovered) {
  const state = job.state === "awaiting-approval" ? "awaiting approval" : job.state;
  return {
    ok: true, jobId: job.id, ...(recovered ? { existing: true } : { job }),
    text: `Recovery job ${job.id} is ${recovered ? "already " : ""}${state}.`,
  };
}

function persistRecoveryJob(context, { admitted, delivery, mode, fields, existing }) {
  const { store, bus, audit, now } = context;
  const events = [];
  const request = existing ? normalizeRequestFields(existing) : delivery.request;
  try {
    const { job, recovered } = ensureRequestJob({ store: recoveryStore(store, mode, events), request, fields, now });
    for (const event of events) {
      if (event.kind === "job.transition") bus?.emit?.("job.transition", event);
    }
    const receipt = {
      kind: "progress.recovered", jobId: admitted.parent.id, childId: job.id, mode,
      request: requestIdentity(job), recoveryRequest: delivery.identity,
    };
    if (!context.records().some((record) => record.kind === receipt.kind
      && record.jobId === receipt.jobId && record.childId === receipt.childId
      && record.mode === mode && requestKey(record.recoveryRequest) === requestKey(delivery.identity))) {
      store.append(PROGRESS_STREAM, receipt);
    }
    audit({
      kind: "progress-recovery-created", jobId: admitted.parent.id, childId: job.id, mode,
      userId: admitted.caller.userId, chatId: request.chatId, threadId: request.threadId,
      updateId: delivery.request.updateId, adapter: delivery.request.adapter, existing: recovered,
    });
    return recoveryReply(job, recovered);
  } catch (error) {
    const code = errorCode(error, "RECOVERY_FAILED");
    audit({ kind: "progress-recovery-failed", jobId: admitted.parent.id, mode, reason: code });
    return recoveryFailure(code, existing || events.length
      ? "Recovery job could not be confirmed. Retry this action."
      : "Recovery job was not created.");
  }
}

async function recoverProgressJob(context, failedJob, options = {}) {
  const mode = options.mode ?? "retry";
  try {
    if (!RECOVERY_MODES.includes(mode)) throw new ClawError("RECOVERY_MODE_INVALID");
    if (Object.hasOwn(options, "runtime") || Object.hasOwn(options, "provider")) {
      throw new ClawError("RUNTIME_POLICY_DENIED");
    }
    const parent = currentJobs(context.store)[failedJob?.id];
    if (!parent || parent.state !== "failed") {
      return recoveryFailure("NOT_RETRYABLE", "only failed jobs can be recovered.");
    }
    const delivery = recoveryRequest({ context, parent, options, mode });
    admitRecovery(context, delivery, options);
    return await withRequestIdentity({ identity: delivery.identity }, () => {
      const admitted = admitRecovery(context, delivery, options);
      const existing = findRecoveryJob(context.store, delivery, mode);
      const fields = existing ? {} : buildRecoveryFields({
        context, admitted, mode, description: options.description, delivery,
      });
      return persistRecoveryJob(context, { admitted, delivery, mode, fields, existing });
    });
  } catch (error) {
    const code = errorCode(error, "RECOVERY_FAILED");
    context.audit({ kind: "progress-recovery-failed", jobId: failedJob?.id, mode, reason: code });
    return recoveryFailure(code);
  }
}

function progressLane(lanes, laneId) {
  return typeof lanes === "function"
    ? lanes(laneId)
    : typeof lanes?.get === "function"
      ? lanes.get(laneId)
      : lanes?.[laneId];
}

async function abortProgressJob(context, job, caller) {
  const { lanes, audit, ensureState, channel, scheduleEdit } = context;
  if (!job) return { ok: false, error: "JOB_NOT_FOUND", text: "JOB_NOT_FOUND: job not found." };
  if (["leased", "running", "needs-input"].includes(job.state)) {
    const lane = progressLane(lanes, job.lane);
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

function failureExplanationRequest({ job, state, caller, threadId, channel, secrets }) {
  const failureSummary = truncate(redact(secrets, renderFailure(state, job?.reason ?? "failed")), MAX_FAILURE_CONTEXT);
  return {
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
}

function failureExplanationError(result) {
  if (result?.error === "pforge-master not installed") {
    return { error: "MCP_NOT_INSTALLED", text: "Forge-Master isn't installed for this project. Run `pforge claw doctor`." };
  }
  if (result?.error || result?.isError || result?.ok === false) {
    return { error: "MCP_TOOL_ERROR", text: EXPLANATION_UNAVAILABLE };
  }
  return null;
}

function failureSuggestions(result, secrets) {
  return (Array.isArray(result?.proposedActions) ? result.proposedActions : [])
    .filter((action) => action
      && typeof (action.label ?? action.summary) === "string"
      && String(action.label ?? action.summary).trim())
    .slice(0, MAX_SUGGESTIONS)
    .map((action) => ({
      label: truncate(redact(secrets, action.label ?? action.summary), MAX_SUGGESTION_LABEL_LENGTH),
      description: truncate(redact(secrets, action.summary ?? action.label), MAX_SUGGESTION_DESCRIPTION_LENGTH),
    }));
}

function failureReplyMarkup(job, state, items) {
  const buttons = items.map((item, index) => button(item.label, `f:s:${job.id.slice(0, ID_PREFIX_LENGTH)}:${index}`));
  return buttons.length
    ? keyboard([
      ...(failureKeyboard(job, {
        canResume: job.type === "plan" && state.slice.n < state.slice.m,
      }).inline_keyboard),
      ...buttons.map((item) => [item]),
    ])
    : failureKeyboard(job, { canResume: job.type === "plan" && state.slice.n < state.slice.m });
}

function failureAnswer(result, state, job) {
  return typeof (result.reply ?? result.text ?? result.answer) === "string"
    ? truncate(result.reply ?? result.text ?? result.answer)
    : renderFailure(state, job.reason ?? "failed");
}

async function sendProgressReply(context, { chatId, threadId, text, replyMarkup }) {
  const { channel, format, logger } = context;
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

async function explainProgressFailure(context, job, { caller, chatId, threadId } = {}) {
  const { ensureState, channel, secrets, mcp, suggestions, store, logger, scheduleEdit, format } = context;
  const state = ensureState(job);
  const args = failureExplanationRequest({ job, state, caller, threadId, channel, secrets });
  let result;
  try {
    if (!mcp || typeof mcp.call !== "function") throw new ClawError("MCP_TOOL_ERROR");
    result = await mcp.call(job.projectId, "forge_master_ask", args);
  } catch {
    await sendProgressReply(context, { chatId, threadId, text: EXPLANATION_UNAVAILABLE });
    return { ok: false, error: "MCP_TOOL_ERROR" };
  }
  const explanationError = failureExplanationError(result);
  if (explanationError) {
    await sendProgressReply(context, { chatId, threadId, text: explanationError.text });
    return { ok: false, error: explanationError.error };
  }
  const items = failureSuggestions(result, secrets);
  suggestions.set(job.id, items);
  try {
    store?.append?.(PROGRESS_STREAM, { kind: "progress.suggestions", jobId: job.id, items });
  } catch (error) {
    logger?.error?.("Progress suggestions could not be saved", {
      code: errorCode(error, "PROGRESS_SUGGESTIONS_WRITE_FAILED"),
    });
    await sendProgressReply(context, { chatId, threadId, text: EXPLANATION_UNAVAILABLE });
    return { ok: false, error: "PROGRESS_SUGGESTIONS_WRITE_FAILED" };
  }
  const replyMarkup = failureReplyMarkup(job, state, items);
  const answer = failureAnswer(result, state, job);
  if (state.messageId && channel?.edit) {
    scheduleEdit(state, format(answer), replyMarkup);
  } else {
    await sendProgressReply(context, { chatId, threadId, text: answer, replyMarkup });
  }
  return { ok: true, items };
}

async function applyProgressSuggestion({ context, job, index, options }) {
  const { suggestions, records } = context;
  const items = suggestions.get(job.id) ?? records().findLast((record) => (
    record.kind === "progress.suggestions" && record.jobId === job.id
  ))?.items ?? [];
  const item = items[index];
  if (!item) {
    return { ok: false, error: "SUGGESTION_EXPIRED", text: "suggestion expired" };
  }
  return recoverProgressJob(context, job, {
    ...options,
    mode: "suggestion",
    suggestionIndex: index,
    description: item.description || item.label,
  });
}

function createProgressActions(context) {
  return {
    resolveJob: (ref, options = {}) => resolveProgressJob(context.store, ref, options),
    createRecoveryJob: (job, options = {}) => recoverProgressJob(context, job, options),
    abortJob: (job, caller) => abortProgressJob(context, job, caller),
    explainFailure: (job, options = {}) => explainProgressFailure(context, job, options),
    applySuggestion: (job, index, options) => applyProgressSuggestion({ context, job, index, options }),
    sendReply: (options) => sendProgressReply(context, options),
  };
}

export function createProgressService(options = {}) {
  const {
    store, bus, channel, mcp, secrets, lanes, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout, logger, minEditMs = 3000,
  } = options;
  const tracked = new Map();
  const suggestions = new Map();
  const inFlight = new Set();
  const refs = new Map();
  let stopped = false;

  for (const record of streamRecords(store, PROGRESS_STREAM)) {
    if (record.kind === "progress.message" && typeof record.jobId === "string") {
      refs.set(record.jobId, String(record.messageId));
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
    const text = updateLaneState(state, job, event);
    if (text !== null) scheduleEdit(state, text);
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

  const { resolveJob, createRecoveryJob, abortJob, explainFailure, applySuggestion, sendReply } = createProgressActions({
    store,
    bus,
    channel,
    mcp,
    secrets,
    lanes,
    now,
    logger,
    authoritySource: options,
    suggestions,
    records,
    ensureState,
    scheduleEdit,
    format,
    audit,
  });

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
    getConfig: () => readCurrentConfig(options),
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
