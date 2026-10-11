import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { APPROVER_ROLES } from "./approvals.mjs";
import { button, escapeMdV2, keyboard } from "./channels/telegram/format.mjs";
import { getBoundCaptureService } from "./handlers/capture-commands.mjs";
import { prepareTask } from "./commands/task.mjs";
import { JOB_STATES } from "./enums.mjs";
import { currentJobs, JOBS_STREAM } from "./jobs/model.mjs";

const MILLISECONDS_PER_HOUR = 3_600_000;
const MILLISECONDS_PER_DAY = 86_400_000;
const DEFAULT_DEDUPE_WINDOW_MS = 21_600_000;
const MAX_EVIDENCE_ITEMS = 3;
const ALERT_REF_LENGTH = 8;
const MAX_SUMMARY_LENGTH = 500;

export const ALERT_DEFAULTS = Object.freeze({
  pollMs: 60_000,
  pageLimit: 25,
  maxPages: 3,
  dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS,
  staleDays: 7,
  heldBudgetMs: MILLISECONDS_PER_DAY,
  watchDurationMs: 2_000,
  watchMaxEvents: 50,
});

export const RAW_EVENT_TYPES = Object.freeze([
  "liveguard",
  "liveguard-tool-completed",
  "secret-scan",
  "drift-alert",
  "run-failed",
]);

const CURSOR_FILE = "cursors.json";
const ALERT_STREAM = "alerts";
const MAX_RETAINED_EMISSIONS = 2000;
const MESSAGE_LIMIT = 3800;
const FALLBACK_CODE = "FORGE_MASTER_UNAVAILABLE";
const SEVERITY_ICONS = Object.freeze({
  critical: "🚨",
  high: "🔴",
  error: "🔴",
  warn: "🟠",
  warning: "🟠",
  info: "🔵",
  low: "🔵",
});

let boundService = null;
let auditTap = null;
let replyTap = null;
let loggerTap = null;

function redact(secrets, value) {
  return String(secrets?.redact ? secrets.redact(String(value)) : value ?? "");
}

function normalizedText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(run|job|id|ref|correlation)[\s:=#-]+[a-z0-9._-]+\b/gi, "$1 <id>")
    .replace(/\b[0-9a-f]{8,}\b/gi, " ")
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprint({ projectId, eventType, text } = {}) {
  const value = [
    String(projectId ?? "").toLowerCase(),
    String(eventType ?? "").toLowerCase(),
    normalizedText(text),
  ].join("|");
  return createHash("sha256").update(value).digest("hex");
}

function toolPayload(raw) {
  if (raw?.structuredContent !== undefined) {
    if (typeof raw.structuredContent === "string") {
      try {
        return JSON.parse(raw.structuredContent);
      } catch {
        return { text: raw.structuredContent };
      }
    }
    return raw.structuredContent;
  }
  const content = raw?.content?.find?.((item) => item?.type === "text")?.text;
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return { text: content };
    }
  }
  return raw;
}

function errorCode(error) {
  if (typeof error?.code === "string") return error.code;
  const detail = `${error?.detail ?? ""} ${error?.message ?? ""}`;
  return detail.includes(FALLBACK_CODE) ? FALLBACK_CODE : "MCP_TOOL_ERROR";
}

function timestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTime(event) {
  return timestamp(event?.ts ?? event?.timestamp ?? event?.at);
}

function listProjects(registry, config) {
  if (typeof registry?.all === "function") return registry.all();
  if (Array.isArray(registry?.projects)) return registry.projects;
  return Array.isArray(config?.projects) ? config.projects : [];
}

function redactValue(secrets, value) {
  if (typeof value === "string") return redact(secrets, value);
  if (Array.isArray(value)) return value.map((child) => redactValue(secrets, child));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, redactValue(secrets, child)]));
  }
  return value;
}

function cursorState(store) {
  const state = store.readJson(CURSOR_FILE, { v: 1, projects: {} });
  return state && typeof state === "object" && !Array.isArray(state)
    ? { ...state, v: 1, projects: { ...(state.projects ?? {}) } }
    : { v: 1, projects: {} };
}

function saveProjectState(store, projectId, changes) {
  const state = cursorState(store);
  state.projects[projectId] = { ...(state.projects[projectId] ?? {}), ...changes };
  store.writeJsonAtomic(CURSOR_FILE, state);
  return state.projects[projectId];
}

function insightSummary(insight, item) {
  return insight?.summary ?? item?.summary ?? "Observer insight";
}

function insightData(item) {
  const insight = item?.insight ?? item;
  const evidence = Array.isArray(insight?.evidence) ? insight.evidence : [];
  return {
    insight,
    evidence,
    seq: Number(item?.seq),
    eventType: evidence[0]?.eventType ?? "observer-insight",
    summary: insightSummary(insight, item),
    insightId: typeof insight?.id === "string" ? insight.id : undefined,
  };
}

function makeKeyboard(fp, suggestedAction) {
  const ref = createHash("sha256").update(fp).digest("hex").slice(0, ALERT_REF_LENGTH);
  const rows = [
    [button("📝 File bug", `x:b:${ref}`), button("🛠 Draft fix", `x:d:${ref}`)],
  ];
  if (suggestedAction) rows.push([button("✨ Suggested action", `x:s:${ref}`)]);
  return { ref, replyMarkup: keyboard(rows) };
}

function renderAlert({ severity, summary, evidence, secrets }) {
  const icon = SEVERITY_ICONS[String(severity ?? "info").toLowerCase()] ?? "🔵";
  const cleanSummary = escapeMdV2(redact(secrets, summary));
  const lines = [icon, cleanSummary];
  for (const row of evidence.slice(0, MAX_EVIDENCE_ITEMS)) {
    const eventType = redact(secrets, row?.eventType ?? "evidence");
    const ref = redact(secrets, row?.ref ?? "");
    const line = `• ${eventType}${ref ? `: ${ref}` : ""}`;
    lines.push(escapeMdV2(line));
  }
  return lines.join("\n").slice(0, MESSAGE_LIMIT);
}

function appendAudit(store, logger, record) {
  try {
    store?.append?.(ALERT_STREAM, record);
  } catch (error) {
    logger?.error?.("Alerts audit write failed", { code: errorCode(error) });
  }
}

function readEmissions(store, now, windowMs) {
  const records = [];
  for (const { record } of store.read(ALERT_STREAM)) {
    if (record?.kind !== "alert.emitted") continue;
    const at = timestamp(record.ts);
    if (at !== null && now() - at <= windowMs) records.push(record);
  }
  return records.slice(-MAX_RETAINED_EMISSIONS);
}

function isUnavailableResult(result) {
  return result?.error === FALLBACK_CODE
    || result?.structuredContent?.error === FALLBACK_CODE;
}

function isObserverStopped(result) {
  return result?.status?.stopped === true
    || result?.running === false
    || result?.status?.running === false;
}

function findActionRecord(store, ref) {
  let found = null;
  for (const { record } of store.read(ALERT_STREAM)) {
    if (record?.kind === "alert.emitted" && record.ref === ref) found = record;
  }
  return found;
}

function priorAction(store, ref) {
  let found = null;
  for (const { record } of store.read(ALERT_STREAM)) {
    if (record?.kind === "alert.action" && record.ref === ref && record.jobId) found = record;
  }
  return found;
}

function heldSinceTimes(store) {
  const heldAt = new Map();
  for (const { record } of store.read(JOBS_STREAM)) {
    if (record?.kind !== "job.transition" || !record.jobId) continue;
    if (record.to === "held-budget") heldAt.set(record.jobId, timestamp(record.ts));
    else if (record.from === "held-budget") heldAt.delete(record.jobId);
  }
  return heldAt;
}

function cleanedWorktrees(store) {
  const cleaned = new Set();
  for (const stream of [JOBS_STREAM, "audit", "worktrees"]) {
    for (const { record } of store.read(stream)) {
      if (!/clean|remov|cleanup/i.test(String(record?.kind ?? ""))) continue;
      if (record.jobId) cleaned.add(String(record.jobId));
      if (record.path) cleaned.add(String(record.path));
      if (record.worktreePath) cleaned.add(String(record.worktreePath));
    }
  }
  return cleaned;
}

function stalePlans(result) {
  const plans = [
    ...(Array.isArray(result?.plans) ? result.plans : []),
    ...(Array.isArray(result?.hardenedPlans) ? result.hardenedPlans : []),
    ...(result?.plan && typeof result.plan === "object" ? [result.plan] : []),
  ];
  if (result?.hardened === true || result?.status === "hardened") plans.push(result);
  return plans.filter((plan) => (
    plan?.hardened === true || plan?.status === "hardened" || plan?.state === "hardened"
  ));
}

function hasRunMetadata(plan) {
  return plan?.runCount > 0 || plan?.hasRun === true || plan?.lastRunAt || plan?.lastRun || plan?.lastRunId;
}

function hasNullRunMarker(plan, key) {
  return Object.hasOwn(plan ?? {}, key) && plan[key] === null;
}

function hasNeverRunMetadata(plan) {
  if (hasRunMetadata(plan)) return false;
  return plan?.runCount === 0
    || plan?.hasRun === false
    || plan?.neverRun === true
    || hasNullRunMarker(plan, "lastRunAt")
    || hasNullRunMarker(plan, "lastRun");
}

function projectById(ctx, projectId) {
  return typeof ctx.registry?.byId === "function"
    ? ctx.registry.byId(projectId)
    : listProjects(ctx.registry, ctx.config).find((project) => project.id === projectId);
}

function isDuplicate(ctx, { projectId, eventType, fp, insightId }) {
  const cutoff = ctx.now() - ctx.settings.dedupeWindowMs;
  return ctx.emissions.some((record) => {
    const emittedAt = timestamp(record.ts);
    if (emittedAt === null || emittedAt < cutoff) return false;
    if (insightId && record.projectId === projectId && record.insightId === insightId) return true;
    return record.projectId === projectId && record.eventType === eventType && record.fp === fp;
  });
}

function advanceProject(ctx, projectId, changes) {
  const state = saveProjectState(ctx.store, projectId, changes);
  ctx.projectSources.set(projectId, state.source ?? null);
  return state;
}

function assertAlertDelivery(delivery) {
  if (delivery?.ok === false || delivery?.isError === true) {
    throw Object.assign(new Error(delivery.error ?? "Alert delivery failed."), {
      code: delivery.error ?? "ALERT_DELIVERY_FAILED",
    });
  }
}

async function emitAlert(ctx, project, {
  eventType, summary, severity = "info", evidence = [], insightId, suggestedAction,
}) {
  const cleanSummary = redact(ctx.secrets, summary);
  const cleanEventType = redact(ctx.secrets, eventType);
  const cleanEvidence = redactValue(ctx.secrets, evidence.slice(0, MAX_EVIDENCE_ITEMS));
  const cleanInsightId = insightId ? redact(ctx.secrets, insightId) : undefined;
  const fp = fingerprint({ projectId: project.id, eventType: cleanEventType, text: cleanSummary });
  if (isDuplicate(ctx, { projectId: project.id, eventType: cleanEventType, fp, insightId: cleanInsightId })) {
    return { sent: false, duplicate: true, fp };
  }
  if (!ctx.channel?.send || !project?.channel?.chatId) return { sent: false, unavailable: true, fp };
  const { ref, replyMarkup } = makeKeyboard(fp, suggestedAction);
  const text = renderAlert({ severity, summary: cleanSummary, evidence: cleanEvidence, secrets: ctx.secrets });
  const delivery = await ctx.channel.send({
    chatId: project.channel.chatId, threadId: project.channel.topicId ?? null, text, replyMarkup,
  });
  assertAlertDelivery(delivery);
  const record = ctx.store.append(ALERT_STREAM, {
    v: 1, kind: "alert.emitted", projectId: project.id, eventType: cleanEventType, fp,
    ...(cleanInsightId ? { insightId: cleanInsightId } : {}),
    ref, ts: ctx.now(), severity: redact(ctx.secrets, severity),
    summary: cleanSummary.slice(0, MAX_SUMMARY_LENGTH), evidence: cleanEvidence,
    ...(suggestedAction ? { suggestedAction: redactValue(ctx.secrets, suggestedAction) } : {}),
  });
  ctx.emissions.push(record);
  if (ctx.emissions.length > MAX_RETAINED_EMISSIONS) ctx.emissions = ctx.emissions.slice(-MAX_RETAINED_EMISSIONS);
  return { sent: true, record, fp };
}

function watchEvents(raw, state) {
  const result = toolPayload(raw);
  if (raw?.isError || result?.isError || result?.ok === false) {
    throw Object.assign(new Error(result.error ?? "WATCH_LIVE_FAILED"), { code: result.error ?? "WATCH_LIVE_FAILED" });
  }
  if (!Array.isArray(result?.events)) {
    throw Object.assign(new Error("Watch-live response omitted its events list."), { code: "WATCH_LIVE_RESPONSE_INVALID" });
  }
  const cursor = timestamp(state.watchTs);
  return result.events
    .filter((event) => RAW_EVENT_TYPES.includes(event?.type))
    .filter((event) => {
      const at = eventTime(event);
      return at !== null && (cursor === null || at > cursor);
    })
    .sort((left, right) => eventTime(left) - eventTime(right));
}

function rawEventSummary(event) {
  return event.summary ?? event.message ?? event.data?.summary ?? event.data?.message ?? event.type;
}

function rawEventAlert(event) {
  return {
    eventType: event.type,
    severity: event.severity ?? event.data?.severity ?? "warn",
    summary: rawEventSummary(event),
    evidence: [{ eventType: event.type, ref: event.correlationId ?? event.data?.ref ?? "" }],
  };
}

async function pollWatchLive(ctx, project, state) {
  state = advanceProject(ctx, project.id, { ...state, source: "watch-live" });
  if (typeof ctx.mcp?.isOpen === "function" && !ctx.mcp.isOpen(project.id) && !project.keepAlive) {
    return { source: "watch-live", skipped: "client-not-open" };
  }
  const raw = await ctx.mcp.call(project.id, "forge_watch_live", {
    targetPath: project.repo.path, durationMs: ctx.settings.watchDurationMs,
    maxCapturedEvents: ctx.settings.watchMaxEvents, verbose: true,
  });
  const relevant = watchEvents(raw, state);
  let watchTs = state.watchTs ?? null;
  for (const event of relevant) {
    const outcome = await emitAlert(ctx, project, rawEventAlert(event));
    if (outcome.sent || outcome.duplicate) {
      watchTs = event.ts ?? event.timestamp ?? event.at;
      advanceProject(ctx, project.id, { ...state, source: "watch-live", watchTs });
    }
  }
  advanceProject(ctx, project.id, { ...state, source: "watch-live", watchTs });
  ctx.projectSources.set(project.id, "watch-live");
  return { source: "watch-live", events: relevant.length };
}

function assertObserverResult(raw, result) {
  if (raw?.isError || result?.isError) {
    throw Object.assign(new Error(result?.error ?? "MCP_TOOL_ERROR"), { code: result?.error ?? "MCP_TOOL_ERROR" });
  }
  if (result?.ok === false || result?.error) {
    throw Object.assign(new Error(result.error), { code: result.error });
  }
}

function observerPage(result) {
  if (!result?.status || typeof result.status !== "object" || Array.isArray(result.status)) {
    throw Object.assign(new Error("Observer status response is malformed."), { code: "OBSERVER_STATUS_INVALID" });
  }
  const page = result?.insights ?? {};
  if (!Array.isArray(page.items)) {
    throw Object.assign(new Error("Observer insight page is malformed."), { code: "OBSERVER_PAGE_INVALID" });
  }
  return page;
}

async function loadObserverPage(ctx, project, cursor) {
  const args = { action: "status", limit: ctx.settings.pageLimit, ...(cursor ? { cursor } : {}) };
  let raw;
  try {
    raw = await ctx.mcp.call(project.id, "forge_master_observe", args);
  } catch (error) {
    if (errorCode(error) === FALLBACK_CODE) return null;
    throw error;
  }
  const result = toolPayload(raw);
  if (isUnavailableResult(result)) return null;
  assertObserverResult(raw, result);
  if (isObserverStopped(result)) return null;
  return observerPage(result);
}

function beginObserverPage(ctx, project, traversal) {
  let pageHighWater = Number(traversal.state.insightSeq ?? 0);
  if (traversal.headLoaded) return pageHighWater;
  if (Number.isFinite(traversal.firstSeq) && traversal.firstSeq < Number(traversal.state.insightSeq ?? 0)) {
    traversal.state = { ...traversal.state, insightSeq: 0, resumeCursor: null };
    traversal.highWaterCutoff = 0;
    pageHighWater = 0;
    advanceProject(ctx, project.id, traversal.state);
  }
  traversal.headLoaded = true;
  return pageHighWater;
}

async function deliverObserverPage(ctx, project, { traversal, page }) {
  if (!traversal.headLoaded) traversal.firstSeq = Number(page.items[0]?.seq);
  let pageHighWater = beginObserverPage(ctx, project, traversal);
  for (const item of page.items) {
    const data = insightData(item);
    if (!Number.isFinite(data.seq)) continue;
    if (!traversal.resumeTraversal && data.seq <= traversal.highWaterCutoff) {
      traversal.stopAtHighWater = true;
      break;
    }
    const outcome = await emitAlert(ctx, project, {
      eventType: data.eventType, summary: data.summary, severity: data.insight?.severity,
      evidence: data.evidence, insightId: data.insightId,
      suggestedAction: data.insight?.suggestedAction ?? undefined,
    });
    if (!outcome.sent && !outcome.duplicate) return { unavailable: true };
    pageHighWater = Math.max(pageHighWater, data.seq);
  }
  return { pageHighWater };
}

function isDecreasingCursor(traversal, nextCursor) {
  const numericNext = Number(nextCursor);
  const numericCursor = traversal.cursor === undefined ? Infinity : Number(traversal.cursor);
  // Keep the rejection comparison when a stored cursor converts to NaN.
  return typeof nextCursor === "string" && /^\d+$/.test(nextCursor)
    && Number.isFinite(numericNext) && !(numericNext >= numericCursor)
    && !traversal.seenCursors.has(nextCursor);
}

function advanceObserverPage(ctx, project, { traversal, page, pageHighWater }) {
  let resumeCursor = null;
  let hasNext = false;
  if (!traversal.stopAtHighWater && page.hasMore) {
    const nextCursor = page.nextCursor;
    if (isDecreasingCursor(traversal, nextCursor)) {
      traversal.seenCursors.add(nextCursor);
      traversal.cursor = nextCursor;
      traversal.resumeTraversal = true;
      resumeCursor = nextCursor;
      hasNext = true;
    } else {
      ctx.logger?.warn?.("Observer cursor did not decrease", { projectId: project.id, code: "OBSERVER_CURSOR_INVALID" });
    }
  }
  traversal.state = advanceProject(ctx, project.id, {
    ...traversal.state, source: "observer", insightSeq: pageHighWater, resumeCursor,
  });
  return hasNext;
}

async function pollObserver(ctx, project, initialState) {
  const state = { ...initialState, source: "observer" };
  advanceProject(ctx, project.id, state);
  const cursor = state.resumeCursor ?? undefined;
  const traversal = {
    state, cursor, resumeTraversal: cursor !== undefined,
    highWaterCutoff: cursor !== undefined ? 0 : Number(state.insightSeq ?? 0),
    seenCursors: new Set(), firstSeq: null, stopAtHighWater: false, headLoaded: cursor !== undefined,
  };
  for (let nextPage = 0; nextPage < ctx.settings.maxPages; nextPage += 1) {
    const page = await loadObserverPage(ctx, project, traversal.cursor);
    if (page === null) return pollWatchLive(ctx, project, traversal.state);
    if (page.truncated) ctx.logger?.debug?.("Observer insight page is truncated", { projectId: project.id });
    const progress = await deliverObserverPage(ctx, project, { traversal, page });
    if (progress.unavailable) return { source: "observer", unavailable: true };
    if (!advanceObserverPage(ctx, project, { traversal, page, pageHighWater: progress.pageHighWater })) break;
  }
  ctx.projectSources.set(project.id, "observer");
  return {
    source: "observer",
    ...(traversal.firstSeq !== null && Number.isFinite(traversal.firstSeq) ? { headSeq: traversal.firstSeq } : {}),
    resumeCursor: traversal.state.resumeCursor ?? null,
  };
}

function createProjectPolling(ctx) {
  async function pollProject(project) {
    if (!project?.id || !ctx.mcp?.call || !ctx.store) throw new Error("Alerts service is missing a project, MCP client, or store.");
    const inFlight = ctx.projectPolls.get(project.id);
    if (inFlight) return inFlight;
    const operation = (async () => {
      const saved = cursorState(ctx.store).projects[project.id] ?? {};
      try {
        const result = await pollObserver(ctx, project, saved);
        const at = ctx.now();
        ctx.lastPollAt = at;
        ctx.projectPollTimes.set(project.id, at);
        ctx.projectErrors.delete(project.id);
        ctx.projectSources.set(project.id, result.source ?? ctx.projectSources.get(project.id) ?? saved.source);
        return result;
      } catch (error) {
        ctx.projectErrors.set(project.id, errorCode(error));
        const current = cursorState(ctx.store).projects[project.id] ?? saved;
        advanceProject(ctx, project.id, { ...current, source: current.source ?? "observer" });
        ctx.logger?.warn?.("Alerts project poll failed", { projectId: project.id, code: errorCode(error) });
        throw error;
      } finally {
        ctx.projectPolls.delete(project.id);
      }
    })();
    ctx.projectPolls.set(project.id, operation);
    return operation;
  }
  async function pollAll() {
    const projects = listProjects(ctx.registry, ctx.config);
    return Promise.allSettled(projects.map((project) => pollProject(project)));
  }
  return { pollProject, pollAll };
}

function hasUnknownRunMetadata(plan) {
  return !plan?.runCount && plan?.hasRun === undefined && !plan?.lastRunAt
    && !plan?.lastRun && !plan?.lastRunId && plan?.neverRun !== true;
}

function stalePlanAlert(ctx, project, plan) {
  const hardenedAt = timestamp(plan.hardenedAt ?? plan.hardened_at);
  if (hardenedAt === null) {
    ctx.logger?.debug?.("Stale plan age is unknown", { projectId: project.id, code: "ALERTS_PLAN_AGE_UNKNOWN" });
    return null;
  }
  if (!hasNeverRunMetadata(plan)) {
    if (hasUnknownRunMetadata(plan)) {
      ctx.logger?.debug?.("Stale plan run history is unknown", { projectId: project.id, code: "ALERTS_PLAN_RUN_UNKNOWN" });
    }
    return null;
  }
  if (ctx.now() - hardenedAt <= ctx.settings.staleDays * MILLISECONDS_PER_DAY) return null;
  return {
    eventType: "nudge.stale-phase", severity: "info",
    summary: `Hardened plan ${plan.name ?? plan.plan ?? plan.path ?? "unknown"} has not been run for over ${ctx.settings.staleDays} days.`,
    evidence: [{ eventType: "plan-status", ref: plan.path ?? plan.name ?? "" }],
  };
}

async function emitNudge(ctx, project, { alert, generated }) {
  const outcome = await emitAlert(ctx, project, alert);
  if (outcome.sent) generated.push({ projectId: project.id, eventType: alert.eventType, fp: outcome.fp });
}

function assertPlanStatus(raw, status) {
  if (raw?.isError || status?.isError || status?.error || status?.ok === false) {
    throw Object.assign(new Error(status?.error ?? "PLAN_STATUS_FAILED"), {
      code: status?.error ?? "PLAN_STATUS_FAILED",
    });
  }
}

async function collectPlanNudges(ctx, project, generated) {
  try {
    const raw = await ctx.mcp.call(project.id, "forge_plan_status", { path: project.repo.path });
    const status = toolPayload(raw);
    assertPlanStatus(raw, status);
    for (const plan of stalePlans(status)) {
      const alert = stalePlanAlert(ctx, project, plan);
      if (alert) await emitNudge(ctx, project, { alert, generated });
    }
  } catch (error) {
    ctx.logger?.warn?.("Plan status nudge check failed", { projectId: project.id, code: errorCode(error) });
  }
}

async function collectHeldBudgetNudge(ctx, job, { heldAt, generated }) {
  const enteredAt = heldAt.get(job.id);
  if (enteredAt === null || enteredAt === undefined || ctx.now() - enteredAt <= ctx.settings.heldBudgetMs) return;
  const project = projectById(ctx, job.projectId);
  if (!project) return;
  await emitNudge(ctx, project, { generated, alert: {
    eventType: "nudge.held-budget", severity: "warn",
    summary: `Job ${job.id} has been held for budget approval for more than ${ctx.settings.heldBudgetMs / MILLISECONDS_PER_HOUR} hours.`,
    evidence: [{ eventType: "held-budget", ref: job.id }],
  } });
}

async function worktreeExists(ctx, job, worktreePath) {
  try {
    await access(worktreePath);
    return true;
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
      ctx.logger?.warn?.("Failed worktree could not be checked", {
        jobId: job.id, code: error.code ?? "WORKTREE_CHECK_FAILED",
      });
    }
    return false;
  }
}

async function collectFailedWorktreeNudge(ctx, job, { cleaned, generated }) {
  if (!["failed", "cancelled"].includes(job.state)) return;
  const worktreePath = job.worktreePath ?? job.worktree?.path;
  if (typeof worktreePath !== "string" || !worktreePath || cleaned.has(job.id) || cleaned.has(worktreePath)) return;
  if (!await worktreeExists(ctx, job, worktreePath)) return;
  const project = projectById(ctx, job.projectId);
  if (!project) return;
  await emitNudge(ctx, project, { generated, alert: {
    eventType: "nudge.failed-worktree", severity: "warn",
    summary: `Failed job ${job.id} still has a worktree that needs cleanup.`,
    evidence: [{ eventType: "worktree", ref: worktreePath }],
  } });
}

async function collectJobNudges(ctx, job, checks) {
  try {
    if (job.projectId && !checks.projects.some((project) => project.id === job.projectId)) return;
    if (job.state === "held-budget") await collectHeldBudgetNudge(ctx, job, checks);
    await collectFailedWorktreeNudge(ctx, job, checks);
  } catch (error) {
    ctx.logger?.warn?.("Job nudge could not be delivered", { jobId: job.id, code: errorCode(error) });
  }
}

function createNudgeCollector(ctx) {
  return async function collectNudges() {
    const projects = listProjects(ctx.registry, ctx.config);
    const generated = [];
    for (const project of projects) await collectPlanNudges(ctx, project, generated);
    const jobs = currentJobs(ctx.store);
    const checks = { projects, generated, heldAt: heldSinceTimes(ctx.store), cleaned: cleanedWorktrees(ctx.store) };
    for (const job of Object.values(jobs)) await collectJobNudges(ctx, job, checks);
    return generated;
  };
}

function recordAction(ctx, { ref, action, caller, outcome, jobId }) {
  return ctx.store.append(ALERT_STREAM, {
    v: 1, kind: "alert.action",
    ref: typeof ref === "string" ? ref.slice(0, ALERT_REF_LENGTH) : null,
    action: typeof action === "string" ? action : "invalid",
    caller: String(caller?.userId ?? ""), outcome,
    ...(jobId ? { jobId } : {}),
  });
}

function actionPayloadError({ action, ref, caller }) {
  if (!["b", "d", "s"].includes(action) || !/^[0-9a-f]{8}$/.test(String(ref ?? ""))) {
    return { reason: "bad-payload", text: "Invalid alert action." };
  }
  if (!APPROVER_ROLES.includes(caller?.role)) {
    return { reason: "role", text: "This action requires an owner or approver." };
  }
  return null;
}

function matchesAlertTopic(project, { chatId, topicId, threadId }) {
  if (!project) return false;
  return String(project.channel?.chatId) === String(chatId)
    && String(project.channel?.topicId ?? "") === String(topicId ?? threadId ?? "");
}

function resolveAlertAction(ctx, request) {
  const invalid = actionPayloadError(request);
  if (invalid) return invalid;
  const emitted = findActionRecord(ctx.store, request.ref);
  if (!emitted || ctx.now() - (timestamp(emitted.ts) ?? 0) > ctx.settings.dedupeWindowMs) {
    return { reason: "unknown-or-expired", text: "This alert expired." };
  }
  const project = projectById(ctx, emitted.projectId);
  if (!matchesAlertTopic(project, request)) {
    return { reason: "wrong-topic", text: "This alert belongs to a different topic." };
  }
  return { project, emitted };
}

function assertBugFiled(raw, result) {
  if (raw?.isError || result?.isError || result?.ok === false || result?.error) {
    throw Object.assign(new Error(result?.error ?? "BUG_FILE_FAILED"), {
      code: result?.error ?? "BUG_FILE_FAILED",
    });
  }
}

async function fileAlertBug(ctx, request, { project, emitted }) {
  const capture = getBoundCaptureService();
  if (capture?.bug) {
    await capture.bug({
      project, caller: request.caller, chatId: request.chatId,
      threadId: request.topicId ?? request.threadId, text: emitted.summary ?? "Observer alert",
      updateId: `alert:${request.ref}`,
    });
    return;
  }
  const raw = await ctx.mcp.call(project.id, "forge_bug_file", {
    title: `Observer alert: ${emitted.summary ?? emitted.eventType}`,
    description: emitted.summary ?? emitted.eventType, severity: emitted.severity ?? "medium",
    evidence: emitted.evidence ?? [],
  });
  assertBugFiled(raw, toolPayload(raw));
}

function alertTaskDescription(action, emitted) {
  return action === "s" && emitted.suggestedAction
    ? `⚠️ from observer insight\n${emitted.summary ?? ""}\nSuggested action data: ${JSON.stringify(emitted.suggestedAction)}`
    : `Draft a fix for this observer alert: ${emitted.summary ?? emitted.eventType}`;
}

function alertUpdateId(emitted) {
  // Legacy emissions have no id; use their persisted record metadata, not display text.
  const recordId = typeof emitted.id === "string" && emitted.id
    ? emitted.id
    : createHash("sha256").update(JSON.stringify([
      emitted.projectId, emitted.fp ?? emitted.ref, emitted.ts ?? null,
    ])).digest("hex");
  return `alert:${recordId}`;
}

function assertTaskPrepared(response) {
  if (typeof response?.jobId !== "string" || !response.jobId
    || typeof response.text !== "string" || !JOB_STATES.includes(response.state)) {
    throw Object.assign(new Error("Task preparation did not return a durable job result."), { code: "TASK_PREPARE_FAILED" });
  }
}

async function prepareAlertTask(ctx, request, { project, emitted }) {
  const requested = alertTaskDescription(request.action, emitted);
  const response = await prepareTask({
    store: ctx.store, registry: ctx.registry, project,
    get config() { return typeof ctx.getConfig === "function" ? ctx.getConfig() : ctx.config; },
    secrets: ctx.secrets, lanes: ctx.lanes, getConfig: ctx.getConfig, now: ctx.now,
  }, {
    argsText: redact(ctx.secrets, requested), caller: request.caller, chatId: request.chatId,
    threadId: request.topicId ?? request.threadId ?? null,
    adapter: ctx.channel?.id ?? request.caller?.channel,
    updateId: alertUpdateId(emitted),
    ...(request.action === "s" ? { origin: "untrusted" } : {}),
  });
  assertTaskPrepared(response);
  return { jobId: response.jobId, state: response.state, text: response.text };
}

function createActionHandler(ctx) {
  return async function handleAction({ action, ref, caller, chatId, topicId, threadId } = {}) {
    const cleanRef = typeof ref === "string" ? ref.slice(0, ALERT_REF_LENGTH) : null;
    const request = { action, ref, caller, chatId, topicId, threadId };
    const resolved = resolveAlertAction(ctx, request);
    if (resolved.reason) {
      recordAction(ctx, { ref: cleanRef, action, caller, outcome: resolved.reason });
      return { ok: false, error: resolved.reason, text: resolved.text };
    }
    const previous = priorAction(ctx.store, ref);
    if (action === "b" && previous) {
      recordAction(ctx, { ref, action, caller, outcome: "duplicate", jobId: previous.jobId });
      return { ok: true, duplicate: true, jobId: previous.jobId, text: `Task job ${previous.jobId} is already awaiting approval.` };
    }
    try {
      if (action === "b") {
        await fileAlertBug(ctx, request, resolved);
        recordAction(ctx, { ref, action, caller, outcome: "accepted" });
        return { ok: true, text: "Bug report filed." };
      }
      const response = await prepareAlertTask(ctx, request, resolved);
      const isDuplicate = previous?.jobId === response.jobId;
      recordAction(ctx, { ref, action, caller, outcome: isDuplicate ? "duplicate" : "accepted", jobId: response.jobId });
      return { ok: true, ...(isDuplicate ? { duplicate: true } : {}), ...response };
    } catch (error) {
      const code = errorCode(error);
      recordAction(ctx, { ref, action, caller, outcome: code });
      return { ok: false, error: code, text: "This alert action could not be completed." };
    }
  };
}

export function createAlertsService({
  store, mcp, registry, channel, config, getConfig, lanes, logger, secrets, now = Date.now, options = {},
} = {}) {
  const settings = { ...ALERT_DEFAULTS, ...options };
  const ctx = {
    store, mcp, registry, channel, config, getConfig, lanes, logger, secrets, now: () => now(), settings,
    projectSources: new Map(), projectPolls: new Map(), lastPollAt: null,
    emissions: readEmissions(store, now, settings.dedupeWindowMs),
    projectPollTimes: new Map(), projectErrors: new Map(),
  };
  const { pollProject, pollAll } = createProjectPolling(ctx);
  function sourceFor(projectId) {
    const saved = cursorState(store).projects[projectId];
    return ctx.projectSources.get(projectId) ?? saved?.source ?? null;
  }
  return {
    store, channel, logger, pollProject, pollAll,
    collectNudges: createNudgeCollector(ctx), handleAction: createActionHandler(ctx), sourceFor,
    get lastPollAt() { return ctx.lastPollAt; },
    snapshot() {
      return {
        projects: listProjects(registry, config).slice(0, 100).map((project) => ({
          id: project.id, source: sourceFor(project.id),
          lastPollAt: ctx.projectPollTimes.get(project.id) ?? null,
          ...(ctx.projectErrors.has(project.id) ? { lastError: ctx.projectErrors.get(project.id) } : {}),
        })),
      };
    },
  };
}

export function bindAlertsService(service) {
  boundService = service;
  if (service) {
    auditTap = (record) => appendAudit({ append: (stream, item) => service.store.append(stream, item) }, service.logger, record);
    replyTap = (chatId, threadId, text) => service.channel?.send?.({ chatId, threadId, text });
    loggerTap = service.logger;
  }
  return () => {
    if (boundService === service) boundService = null;
  };
}

export function getAlertsService() {
  return boundService;
}

export function writeAlertsAudit(record) {
  if (!auditTap) return false;
  try {
    auditTap?.(record);
    return true;
  } catch (error) {
    loggerTap?.error?.("Alerts callback audit failed", { code: errorCode(error) });
    return false;
  }
}

export async function replyAlerts(chatId, threadId, text) {
  try {
    await replyTap?.(chatId, threadId, text);
  } catch (error) {
    loggerTap?.warn?.("Alerts callback reply failed", { code: errorCode(error) });
  }
}
