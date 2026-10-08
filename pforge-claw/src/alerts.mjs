import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { APPROVER_ROLES } from "./approvals.mjs";
import { button, escapeMdV2, keyboard } from "./channels/telegram/format.mjs";
import { getBoundCaptureService } from "./handlers/capture-commands.mjs";
import { prepareTask } from "./commands/task.mjs";
import { currentJobs, JOBS_STREAM } from "./jobs/model.mjs";

export const ALERT_DEFAULTS = Object.freeze({
  pollMs: 60_000,
  pageLimit: 25,
  maxPages: 3,
  dedupeWindowMs: 6 * 3_600_000,
  staleDays: 7,
  heldBudgetMs: 24 * 3_600_000,
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

function insightData(item) {
  const insight = item?.insight ?? item;
  const evidence = Array.isArray(insight?.evidence) ? insight.evidence : [];
  return {
    insight,
    evidence,
    seq: Number(item?.seq),
    eventType: evidence[0]?.eventType ?? "observer-insight",
    summary: insight?.summary ?? item?.summary ?? "Observer insight",
    insightId: typeof insight?.id === "string" ? insight.id : undefined,
  };
}

function makeKeyboard(fp, suggestedAction) {
  const ref = createHash("sha256").update(fp).digest("hex").slice(0, 8);
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
  for (const row of evidence.slice(0, 3)) {
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

function hasNeverRunMetadata(plan) {
  if (plan?.runCount > 0 || plan?.hasRun === true || plan?.lastRunAt || plan?.lastRun
    || plan?.lastRunId) return false;
  return plan?.runCount === 0
    || plan?.hasRun === false
    || plan?.neverRun === true
    || (Object.hasOwn(plan ?? {}, "lastRunAt") && plan.lastRunAt === null)
    || (Object.hasOwn(plan ?? {}, "lastRun") && plan.lastRun === null);
}

export function createAlertsService({
  store,
  mcp,
  registry,
  channel,
  config,
  logger,
  secrets,
  now = Date.now,
  options = {},
} = {}) {
  const settings = { ...ALERT_DEFAULTS, ...options };
  const projectSources = new Map();
  const projectPolls = new Map();
  let lastPollAt = null;
  let emissions = readEmissions(store, now, settings.dedupeWindowMs);
  const projectPollTimes = new Map();
  const projectErrors = new Map();

  function projectById(projectId) {
    return typeof registry?.byId === "function"
      ? registry.byId(projectId)
      : listProjects(registry, config).find((project) => project.id === projectId);
  }

  function isDuplicate({ projectId, eventType, fp, insightId }) {
    const cutoff = now() - settings.dedupeWindowMs;
    return emissions.some((record) => {
      const emittedAt = timestamp(record.ts);
      if (emittedAt === null || emittedAt < cutoff) return false;
      if (insightId && record.projectId === projectId && record.insightId === insightId) return true;
      return record.projectId === projectId && record.eventType === eventType && record.fp === fp;
    });
  }

  function advanceProject(projectId, changes) {
    const state = saveProjectState(store, projectId, changes);
    projectSources.set(projectId, state.source ?? null);
    return state;
  }

  async function emitAlert(project, {
    eventType,
    summary,
    severity = "info",
    evidence = [],
    insightId,
    suggestedAction,
  }) {
    const cleanSummary = redact(secrets, summary);
    const cleanEventType = redact(secrets, eventType);
    const cleanEvidence = redactValue(secrets, evidence.slice(0, 3));
    const cleanInsightId = insightId ? redact(secrets, insightId) : undefined;
    const fp = fingerprint({ projectId: project.id, eventType: cleanEventType, text: cleanSummary });
    if (isDuplicate({ projectId: project.id, eventType: cleanEventType, fp, insightId: cleanInsightId })) {
      return { sent: false, duplicate: true, fp };
    }
    if (!channel?.send || !project?.channel?.chatId) return { sent: false, unavailable: true, fp };

    const { ref, replyMarkup } = makeKeyboard(fp, suggestedAction);
    const text = renderAlert({
      severity,
      summary: cleanSummary,
      evidence: cleanEvidence,
      secrets,
    });
    const delivery = await channel.send({
      chatId: project.channel.chatId,
      threadId: project.channel.topicId ?? null,
      text,
      replyMarkup,
    });
    if (delivery?.ok === false || delivery?.isError === true) {
      throw Object.assign(new Error(delivery.error ?? "Alert delivery failed."), {
        code: delivery.error ?? "ALERT_DELIVERY_FAILED",
      });
    }

    const record = store.append(ALERT_STREAM, {
      v: 1,
      kind: "alert.emitted",
      projectId: project.id,
      eventType: cleanEventType,
      fp,
      ...(cleanInsightId ? { insightId: cleanInsightId } : {}),
      ref,
      ts: now(),
      severity: redact(secrets, severity),
      summary: cleanSummary.slice(0, 500),
      evidence: cleanEvidence,
      ...(suggestedAction ? { suggestedAction: redactValue(secrets, suggestedAction) } : {}),
    });
    emissions.push(record);
    if (emissions.length > MAX_RETAINED_EMISSIONS) emissions = emissions.slice(-MAX_RETAINED_EMISSIONS);
    return { sent: true, record, fp };
  }

  async function pollWatchLive(project, state) {
    state = advanceProject(project.id, { ...state, source: "watch-live" });
    if (typeof mcp?.isOpen === "function" && !mcp.isOpen(project.id) && !project.keepAlive) {
      return { source: "watch-live", skipped: "client-not-open" };
    }
    const raw = await mcp.call(project.id, "forge_watch_live", {
      targetPath: project.repo.path,
      durationMs: settings.watchDurationMs,
      maxCapturedEvents: settings.watchMaxEvents,
      verbose: true,
    });
    const result = toolPayload(raw);
    if (raw?.isError || result?.isError || result?.ok === false) {
      throw Object.assign(new Error(result.error ?? "WATCH_LIVE_FAILED"), { code: result.error ?? "WATCH_LIVE_FAILED" });
    }
    if (!Array.isArray(result?.events)) {
      throw Object.assign(new Error("Watch-live response omitted its events list."), { code: "WATCH_LIVE_RESPONSE_INVALID" });
    }
    const events = result.events;
    const cursor = timestamp(state.watchTs);
    const relevant = events
      .filter((event) => RAW_EVENT_TYPES.includes(event?.type))
      .filter((event) => {
        const at = eventTime(event);
        return at !== null && (cursor === null || at > cursor);
      })
      .sort((left, right) => eventTime(left) - eventTime(right));
    let watchTs = state.watchTs ?? null;
    for (const event of relevant) {
      const outcome = await emitAlert(project, {
        eventType: event.type,
        severity: event.severity ?? event.data?.severity ?? "warn",
        summary: event.summary ?? event.message ?? event.data?.summary ?? event.data?.message ?? event.type,
        evidence: [{ eventType: event.type, ref: event.correlationId ?? event.data?.ref ?? "" }],
      });
      if (outcome.sent || outcome.duplicate) {
        watchTs = event.ts ?? event.timestamp ?? event.at;
        advanceProject(project.id, { ...state, source: "watch-live", watchTs });
      }
    }
    advanceProject(project.id, { ...state, source: "watch-live", watchTs });
    projectSources.set(project.id, "watch-live");
    return { source: "watch-live", events: relevant.length };
  }

  async function pollObserver(project, initialState) {
    let state = { ...initialState, source: "observer" };
    advanceProject(project.id, state);
    let cursor = state.resumeCursor ?? undefined;
    let resumeTraversal = cursor !== undefined;
    let highWaterCutoff = resumeTraversal ? 0 : Number(state.insightSeq ?? 0);
    let seenCursors = new Set();
    let nextPage = 0;
    let firstSeq = null;
    let stopAtHighWater = false;
    let headLoaded = cursor !== undefined;

    while (nextPage < settings.maxPages) {
      const args = { action: "status", limit: settings.pageLimit, ...(cursor ? { cursor } : {}) };
      let raw;
      try {
        raw = await mcp.call(project.id, "forge_master_observe", args);
      } catch (error) {
        if (errorCode(error) === FALLBACK_CODE) return pollWatchLive(project, state);
        throw error;
      }
      const result = toolPayload(raw);
      if (isUnavailableResult(result)) {
        return pollWatchLive(project, state);
      }
      if (raw?.isError || result?.isError) {
        throw Object.assign(new Error(result?.error ?? "MCP_TOOL_ERROR"), { code: result?.error ?? "MCP_TOOL_ERROR" });
      }
      if (result?.ok === false || result?.error) {
        throw Object.assign(new Error(result.error), { code: result.error });
      }
      if (isObserverStopped(result)) return pollWatchLive(project, state);

      if (!result?.status || typeof result.status !== "object" || Array.isArray(result.status)) {
        throw Object.assign(new Error("Observer status response is malformed."), { code: "OBSERVER_STATUS_INVALID" });
      }
      const page = result?.insights ?? {};
      if (!Array.isArray(page.items)) {
        throw Object.assign(new Error("Observer insight page is malformed."), { code: "OBSERVER_PAGE_INVALID" });
      }
      const items = page.items;
      let pageHighWater = Number(state.insightSeq ?? 0);
      if (page.truncated) logger?.debug?.("Observer insight page is truncated", { projectId: project.id });
      if (!headLoaded) {
        firstSeq = Number(items[0]?.seq);
        if (Number.isFinite(firstSeq) && firstSeq < Number(state.insightSeq ?? 0)) {
          state = { ...state, insightSeq: 0, resumeCursor: null };
          highWaterCutoff = 0;
          pageHighWater = 0;
          advanceProject(project.id, state);
        }
        headLoaded = true;
      }

      for (const item of items) {
        const data = insightData(item);
        if (!Number.isFinite(data.seq)) continue;
        if (!resumeTraversal && data.seq <= highWaterCutoff) {
          stopAtHighWater = true;
          break;
        }
        const outcome = await emitAlert(project, {
          eventType: data.eventType,
          summary: data.summary,
          severity: data.insight?.severity,
          evidence: data.evidence,
          insightId: data.insightId,
          suggestedAction: data.insight?.suggestedAction ?? undefined,
        });
        if (!outcome.sent && !outcome.duplicate) {
          return { source: "observer", unavailable: true };
        }
        pageHighWater = Math.max(pageHighWater, data.seq);
      }

      if (stopAtHighWater || !page.hasMore) {
        state = advanceProject(project.id, {
          ...state,
          source: "observer",
          insightSeq: pageHighWater,
          resumeCursor: null,
        });
        break;
      }
      const nextCursor = page.nextCursor;
      const numericNext = Number(nextCursor);
      const numericCursor = cursor === undefined ? Infinity : Number(cursor);
      if (typeof nextCursor !== "string" || !/^\d+$/.test(nextCursor)
        || !Number.isFinite(numericNext) || numericNext >= numericCursor
        || seenCursors.has(nextCursor)) {
        logger?.warn?.("Observer cursor did not decrease", { projectId: project.id, code: "OBSERVER_CURSOR_INVALID" });
        state = advanceProject(project.id, {
          ...state,
          source: "observer",
          insightSeq: pageHighWater,
          resumeCursor: null,
        });
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
      resumeTraversal = true;
      state = advanceProject(project.id, {
        ...state,
        source: "observer",
        insightSeq: pageHighWater,
        resumeCursor: cursor,
      });
      nextPage += 1;
    }
    projectSources.set(project.id, "observer");
    return {
      source: "observer",
      ...(firstSeq !== null && Number.isFinite(firstSeq) ? { headSeq: firstSeq } : {}),
      resumeCursor: state.resumeCursor ?? null,
    };
  }

  async function pollProject(project) {
    if (!project?.id || !mcp?.call || !store) throw new Error("Alerts service is missing a project, MCP client, or store.");
    const inFlight = projectPolls.get(project.id);
    if (inFlight) return inFlight;
    const operation = (async () => {
      const saved = cursorState(store).projects[project.id] ?? {};
      try {
        const result = await pollObserver(project, saved);
        const at = now();
        lastPollAt = at;
        projectPollTimes.set(project.id, at);
        projectErrors.delete(project.id);
        projectSources.set(project.id, result.source ?? projectSources.get(project.id) ?? saved.source);
        return result;
      } catch (error) {
        projectErrors.set(project.id, errorCode(error));
        const current = cursorState(store).projects[project.id] ?? saved;
        advanceProject(project.id, { ...current, source: current.source ?? "observer" });
        logger?.warn?.("Alerts project poll failed", { projectId: project.id, code: errorCode(error) });
        throw error;
      } finally {
        projectPolls.delete(project.id);
      }
    })();
    projectPolls.set(project.id, operation);
    return operation;
  }

  async function pollAll() {
    const projects = listProjects(registry, config);
    return Promise.allSettled(projects.map((project) => pollProject(project)));
  }

  async function collectNudges() {
    const projects = listProjects(registry, config);
    const generated = [];
    for (const project of projects) {
      try {
        const raw = await mcp.call(project.id, "forge_plan_status", { path: project.repo.path });
        const status = toolPayload(raw);
        if (raw?.isError || status?.isError || status?.error || status?.ok === false) {
          throw Object.assign(new Error(status?.error ?? "PLAN_STATUS_FAILED"), {
            code: status?.error ?? "PLAN_STATUS_FAILED",
          });
        }
        for (const plan of stalePlans(status)) {
          const hardenedAt = timestamp(plan.hardenedAt ?? plan.hardened_at);
          if (hardenedAt === null) {
            logger?.debug?.("Stale plan age is unknown", { projectId: project.id, code: "ALERTS_PLAN_AGE_UNKNOWN" });
            continue;
          }
          if (!hasNeverRunMetadata(plan)) {
            if (!plan?.runCount && plan?.hasRun === undefined && !plan?.lastRunAt
              && !plan?.lastRun && !plan?.lastRunId && plan?.neverRun !== true) {
              logger?.debug?.("Stale plan run history is unknown", { projectId: project.id, code: "ALERTS_PLAN_RUN_UNKNOWN" });
            }
            continue;
          }
          if (now() - hardenedAt <= settings.staleDays * 86_400_000) continue;
          const outcome = await emitAlert(project, {
            eventType: "nudge.stale-phase",
            severity: "info",
            summary: `Hardened plan ${plan.name ?? plan.plan ?? plan.path ?? "unknown"} has not been run for over ${settings.staleDays} days.`,
            evidence: [{ eventType: "plan-status", ref: plan.path ?? plan.name ?? "" }],
          });
          if (outcome.sent) generated.push({ projectId: project.id, eventType: "nudge.stale-phase", fp: outcome.fp });
        }
      } catch (error) {
        logger?.warn?.("Plan status nudge check failed", { projectId: project.id, code: errorCode(error) });
      }
    }

    const jobs = currentJobs(store);
    const heldAt = heldSinceTimes(store);
    const cleaned = cleanedWorktrees(store);
    for (const job of Object.values(jobs)) {
      try {
        if (job.projectId && !projects.some((project) => project.id === job.projectId)) continue;
        if (job.state === "held-budget") {
          const enteredAt = heldAt.get(job.id);
          if (enteredAt === null || enteredAt === undefined || now() - enteredAt <= settings.heldBudgetMs) continue;
          const project = projectById(job.projectId);
          if (!project) continue;
          const outcome = await emitAlert(project, {
            eventType: "nudge.held-budget",
            severity: "warn",
            summary: `Job ${job.id} has been held for budget approval for more than ${settings.heldBudgetMs / 3_600_000} hours.`,
            evidence: [{ eventType: "held-budget", ref: job.id }],
          });
          if (outcome.sent) generated.push({ projectId: project.id, eventType: "nudge.held-budget", fp: outcome.fp });
        }
        if (!["failed", "cancelled"].includes(job.state)) continue;
        const worktreePath = job.worktreePath ?? job.worktree?.path;
        if (typeof worktreePath !== "string" || !worktreePath
          || cleaned.has(job.id) || cleaned.has(worktreePath)) continue;
        try {
          await access(worktreePath);
        } catch (error) {
          if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
            logger?.warn?.("Failed worktree could not be checked", {
              jobId: job.id,
              code: error.code ?? "WORKTREE_CHECK_FAILED",
            });
          }
          continue;
        }
        const project = projectById(job.projectId);
        if (!project) continue;
        const outcome = await emitAlert(project, {
          eventType: "nudge.failed-worktree",
          severity: "warn",
          summary: `Failed job ${job.id} still has a worktree that needs cleanup.`,
          evidence: [{ eventType: "worktree", ref: worktreePath }],
        });
        if (outcome.sent) generated.push({ projectId: project.id, eventType: "nudge.failed-worktree", fp: outcome.fp });
      } catch (error) {
        logger?.warn?.("Job nudge could not be delivered", {
          jobId: job.id,
          code: errorCode(error),
        });
      }
    }
    return generated;
  }

  function recordAction(ref, action, caller, outcome, jobId) {
    return store.append(ALERT_STREAM, {
      v: 1,
      kind: "alert.action",
      ref: typeof ref === "string" ? ref.slice(0, 8) : null,
      action: typeof action === "string" ? action : "invalid",
      caller: String(caller?.userId ?? ""),
      outcome,
      ...(jobId ? { jobId } : {}),
    });
  }

  async function handleAction({ action, ref, caller, chatId, topicId, threadId } = {}) {
    const cleanRef = typeof ref === "string" ? ref.slice(0, 8) : null;
    const reject = (reason, reply) => {
      recordAction(cleanRef, action, caller, reason);
      return { ok: false, error: reason, text: reply };
    };
    if (!["b", "d", "s"].includes(action) || !/^[0-9a-f]{8}$/.test(String(ref ?? ""))) {
      return reject("bad-payload", "Invalid alert action.");
    }
    if (!APPROVER_ROLES.includes(caller?.role)) {
      return reject("role", "This action requires an owner or approver.");
    }
    const emitted = findActionRecord(store, ref);
    if (!emitted || now() - (timestamp(emitted.ts) ?? 0) > settings.dedupeWindowMs) {
      return reject("unknown-or-expired", "This alert expired.");
    }
    const project = projectById(emitted.projectId);
    if (!project || String(project.channel?.chatId) !== String(chatId)
      || String(project.channel?.topicId ?? "") !== String(topicId ?? threadId ?? "")) {
      return reject("wrong-topic", "This alert belongs to a different topic.");
    }
    const previous = priorAction(store, ref);
    if (previous) {
      recordAction(ref, action, caller, "duplicate", previous.jobId);
      return { ok: true, duplicate: true, jobId: previous.jobId, text: `Task job ${previous.jobId} is already awaiting approval.` };
    }

    try {
      let jobId;
      if (action === "b") {
        const capture = getBoundCaptureService();
        if (capture?.bug) {
          await capture.bug({
            project,
            caller,
            chatId,
            threadId: topicId ?? threadId,
            text: emitted.summary ?? "Observer alert",
            updateId: `alert:${ref}`,
          });
        } else {
          const raw = await mcp.call(project.id, "forge_bug_file", {
            title: `Observer alert: ${emitted.summary ?? emitted.eventType}`,
            description: emitted.summary ?? emitted.eventType,
            severity: emitted.severity ?? "medium",
            evidence: emitted.evidence ?? [],
          });
          const result = toolPayload(raw);
          if (raw?.isError || result?.isError || result?.ok === false || result?.error) {
            throw Object.assign(new Error(result?.error ?? "BUG_FILE_FAILED"), {
              code: result?.error ?? "BUG_FILE_FAILED",
            });
          }
        }
        recordAction(ref, action, caller, "accepted");
        return { ok: true, text: "Bug report filed." };
      }

      const requested = action === "s" && emitted.suggestedAction
        ? `⚠️ from observer insight\n${emitted.summary ?? ""}\nSuggested action data: ${JSON.stringify(emitted.suggestedAction)}`
        : `Draft a fix for this observer alert: ${emitted.summary ?? emitted.eventType}`;
      const response = await prepareTask({
        store,
        project,
        caller,
        chatId,
        threadId: topicId ?? threadId ?? null,
      }, { argsText: redact(secrets, requested) });
      const match = /Task job ([A-Za-z0-9._-]+)/.exec(String(response?.text ?? ""));
      if (!match) throw Object.assign(new Error("Task preparation did not return a job id."), { code: "TASK_PREPARE_FAILED" });
      jobId = match[1];
      recordAction(ref, action, caller, "accepted", jobId);
      return { ok: true, jobId, text: response.text };
    } catch (error) {
      const code = errorCode(error);
      recordAction(ref, action, caller, code);
      return { ok: false, error: code, text: "This alert action could not be completed." };
    }
  }

  function sourceFor(projectId) {
    const saved = cursorState(store).projects[projectId];
    return projectSources.get(projectId) ?? saved?.source ?? null;
  }

  return {
    store,
    channel,
    logger,
    pollProject,
    pollAll,
    collectNudges,
    handleAction,
    sourceFor,
    get lastPollAt() { return lastPollAt; },
    snapshot() {
      return {
        projects: listProjects(registry, config).slice(0, 100).map((project) => ({
          id: project.id,
          source: sourceFor(project.id),
          lastPollAt: projectPollTimes.get(project.id) ?? null,
          ...(projectErrors.has(project.id) ? { lastError: projectErrors.get(project.id) } : {}),
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
