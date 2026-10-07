import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { button, keyboard } from "./channels/telegram/format.mjs";
import { ROLES } from "./enums.mjs";
import { currentJobs, JOBS_STREAM, transition } from "./jobs/model.mjs";

export const BUDGET_STREAM = "budget";
export const BUDGET_UNITS = Object.freeze(["costUSD", "premiumRequests"]);
export const USAGE_SOURCES = Object.freeze(["session", "ask", "cost-report"]);
export const OVERRIDE_PREFIX = "b";
export const DEFAULT_TZ = "Etc/UTC";

const CALLBACK_BYTES = 64;
const OVERRIDE_TTL_MS = 15 * 60_000;
const FORMATTERS = new Map();
let warnedInvalidTimeZone = false;
let budgetService = null;

function finiteNonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function normalizeUsage(raw = {}) {
  const usage = raw && typeof raw === "object" ? raw : {};
  return {
    costUSD: finiteNonnegative(usage.costUSD ?? usage.costUsd ?? usage.usd ?? usage.cost),
    premiumRequests: finiteNonnegative(usage.premiumRequests ?? usage.premium_requests),
  };
}

function formatterFor(timeZone) {
  if (FORMATTERS.has(timeZone)) return FORMATTERS.get(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    FORMATTERS.set(timeZone, formatter);
    return formatter;
  } catch {
    if (!warnedInvalidTimeZone) {
      console.warn(`Invalid budget time zone; using ${DEFAULT_TZ}.`);
      warnedInvalidTimeZone = true;
    }
    return formatterFor(DEFAULT_TZ);
  }
}

function effectiveTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    formatterFor(timeZone);
    return DEFAULT_TZ;
  }
}

export function dayKey({ epochMs, timeZone = DEFAULT_TZ } = {}) {
  const parts = formatterFor(timeZone).formatToParts(new Date(epochMs));
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

function recordTime(record) {
  if (typeof record?.at === "number" && Number.isFinite(record.at)) return record.at;
  const parsed = Date.parse(record?.at ?? record?.ts ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function usageForRecord(record) {
  return normalizeUsage(record.kind === "ask" ? record.usage : record);
}

function projectForRecord(record) {
  const project = record.projectId ?? record.project;
  return project && typeof project === "object" ? project.id : project;
}

function deduplicateRecords(records) {
  const withoutJob = [];
  const byJobAndSource = new Map();
  for (const record of records) {
    if (!record?.jobId) {
      withoutJob.push(record);
      continue;
    }
    byJobAndSource.set(`${record.jobId}\u0000${record.source ?? (record.kind === "ask" ? "ask" : "unknown")}`, record);
  }
  const selected = [...withoutJob, ...byJobAndSource.values()];
  const costReports = new Set(selected
    .filter((record) => record.source === "cost-report" && record.jobId)
    .map((record) => record.jobId));
  return selected.filter((record) => !(record.source === "session" && costReports.has(record.jobId)));
}

function emptyTotals() {
  return { costUSD: null, premiumRequests: null, unknownUsageJobs: 0 };
}

function addUsage(totals, usage) {
  for (const unit of BUDGET_UNITS) {
    if (usage[unit] === null) continue;
    totals[unit] = (totals[unit] ?? 0) + usage[unit];
  }
}

export function foldLedger({ records = [], timeZone = DEFAULT_TZ, day } = {}) {
  const global = emptyTotals();
  const projects = {};
  const unknownIds = new Set();
  let unidentifiedUnknowns = 0;
  const projectUnknownIds = new Map();
  const projectUnidentifiedUnknowns = new Map();
  for (const record of deduplicateRecords(records)) {
    if (!["usage", "ask"].includes(record?.kind)) continue;
    const at = recordTime(record);
    if (at === null || dayKey({ epochMs: at, timeZone }) !== day) continue;
    const projectId = projectForRecord(record);
    if (projectId === undefined || projectId === null) continue;
    const key = String(projectId);
    projects[key] ??= emptyTotals();
    const usage = usageForRecord(record);
    addUsage(global, usage);
    addUsage(projects[key], usage);
    if (usage.costUSD === null && usage.premiumRequests === null) {
      if (record.jobId) unknownIds.add(String(record.jobId));
      else unidentifiedUnknowns += 1;
      if (record.jobId) {
        projectUnknownIds.set(key, projectUnknownIds.get(key) ?? new Set());
        projectUnknownIds.get(key).add(String(record.jobId));
      } else {
        projectUnidentifiedUnknowns.set(key, (projectUnidentifiedUnknowns.get(key) ?? 0) + 1);
      }
    }
  }
  global.unknownUsageJobs = unknownIds.size + unidentifiedUnknowns;
  for (const [projectId, totals] of Object.entries(projects)) {
    totals.unknownUsageJobs = (projectUnknownIds.get(projectId)?.size ?? 0)
      + (projectUnidentifiedUnknowns.get(projectId) ?? 0);
  }
  return { global, projects };
}

function storedRecords(store, stream) {
  return typeof store?.read === "function"
    ? [...store.read(stream)].map(({ record }) => record)
    : [];
}

function hashNonce(nonce) {
  return createHash("sha256").update(nonce).digest("hex");
}

function hashesMatch(expected, actual) {
  if (!/^[0-9a-f]{64}$/.test(expected ?? "") || !/^[0-9a-f]{64}$/.test(actual ?? "")) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(actual, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function validCap(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function estimateCost(estimate, job) {
  if (typeof estimate === "number") return finiteNonnegative(estimate);
  if (!estimate || typeof estimate !== "object") return 0;
  const mode = job.quorum ?? estimate.recommended;
  const selected = estimate[mode] ?? estimate;
  return finiteNonnegative(selected.estimatedCostUSD ?? selected.costUSD) ?? 0;
}

function capResult({ scope, unit, spent, cap }) {
  const reason = unit === "costUSD" ? "cap-usd" : "cap-premium";
  return { ok: false, reason, scope, unit, spent, cap };
}

function capFor(budget, unit) {
  return validCap(budget?.[unit === "costUSD" ? "dailyUSD" : "dailyPremiumRequests"]);
}

function overrideRows(store) {
  return storedRecords(store, BUDGET_STREAM);
}

function heldReasons(store) {
  const reasons = new Map();
  for (const event of storedRecords(store, JOBS_STREAM)) {
    if (event?.kind === "job.transition" && event.to === "held-budget") reasons.set(event.jobId, event.reason ?? "budget");
    if (event?.kind === "job.transition" && event.from === "held-budget") reasons.delete(event.jobId);
  }
  return reasons;
}

function formatCap(cap, unit) {
  if (cap === null) return "no cap";
  return unit === "costUSD" ? `$${cap.toFixed(2)}` : String(cap);
}

function formatSpend(spend, unit) {
  if (spend === null) return "unreported";
  return unit === "costUSD" ? `$${spend.toFixed(2)}` : String(spend);
}

function configuredProject(config, projectId) {
  return config?.projects?.find((project) => String(project.id) === String(projectId));
}

export function createBudgetService({
  store, bus, config = {}, mcp, channel, logger, now = Date.now,
} = {}) {
  const timeZone = effectiveTimeZone(typeof config.timezone === "string" ? config.timezone : DEFAULT_TZ);

  function append(stream, record) {
    if (typeof store?.append !== "function") throw Object.assign(new Error("Budget store unavailable"), { code: "SERVICE_UNAVAILABLE" });
    return store.append(stream, record);
  }

  function ledger(day = dayKey({ epochMs: now(), timeZone })) {
    return foldLedger({ records: storedRecords(store, BUDGET_STREAM), timeZone, day });
  }

  function recordUsage({ source, projectId, jobId = null, usage, at = now() } = {}) {
    if (!USAGE_SOURCES.includes(source)) throw Object.assign(new Error("Invalid usage source"), { code: "BUDGET_SOURCE_INVALID" });
    const normalized = normalizeUsage(usage);
    return append(BUDGET_STREAM, {
      v: 1, kind: "usage", source, project: projectId, jobId, at,
      costUSD: normalized.costUSD, premiumRequests: normalized.premiumRequests,
    });
  }

  function today({ projectId } = {}) {
    const day = dayKey({ epochMs: now(), timeZone });
    const folded = ledger(day);
    const visibleProjects = projectId === undefined
      ? folded.projects
      : Object.fromEntries(Object.entries(folded.projects).filter(([id]) => id === String(projectId)));
    return {
      day,
      timeZone,
      global: folded.global,
      projects: visibleProjects,
      caps: {
        global: config.budget ?? {},
        projects: Object.fromEntries((config.projects ?? []).map(({ id, budget: projectBudget }) => [id, projectBudget ?? {}])),
      },
    };
  }

  function check(job, { estimate } = {}) {
    if (job?.mutating !== true) return { ok: true };
    const day = dayKey({ epochMs: now(), timeZone });
    const records = overrideRows(store);
    if (records.some((record) => record.kind === "override" && record.jobId === job.id && record.day === day)) {
      return { ok: true };
    }
    const folded = ledger(day);
    const projectId = String(job.projectId);
    const projectBudget = configuredProject(config, projectId)?.budget ?? {};
    const globalBudget = config.budget ?? {};
    const projectTotals = folded.projects[projectId] ?? emptyTotals();
    const estimateUSD = job.type === "plan" ? estimateCost(estimate, job) : 0;
    for (const [scope, budget, totals] of [
      ["project", projectBudget, projectTotals],
      ["global", globalBudget, folded.global],
    ]) {
      for (const unit of BUDGET_UNITS) {
        const cap = capFor(budget, unit);
        if (cap === null) continue;
        const spent = totals[unit] ?? 0;
        const projected = spent + (unit === "costUSD" ? estimateUSD : 0);
        if (spent > cap || projected > cap) return capResult({ scope, unit, spent: projected, cap });
      }
      const unknownCap = validCap(budget.maxUnknownPerDay);
      if (unknownCap !== null && totals.unknownUsageJobs > unknownCap) {
        return {
          ok: false, reason: "unknown-limit", scope, unit: "unknownUsageJobs",
          spent: totals.unknownUsageJobs, cap: unknownCap,
        };
      }
    }
    return { ok: true };
  }

  function issueOverride(job, reason, result) {
    const nonce = randomBytes(16).toString("base64url");
    const shortId = job.id.slice(0, 8);
    const record = {
      v: 1, kind: "override.issued", jobId: job.id, shortId,
      chatId: job.chatId === undefined || job.chatId === null ? null : String(job.chatId),
      threadId: job.threadId ?? null,
      nonceHash: hashNonce(nonce),
      expiresAt: now() + OVERRIDE_TTL_MS,
      reason, spent: result?.spent ?? null, cap: result?.cap ?? null,
    };
    append(BUDGET_STREAM, record);
    const payload = `${OVERRIDE_PREFIX}:${shortId}:${nonce}`;
    if (Buffer.byteLength(payload, "utf8") > CALLBACK_BYTES) throw Object.assign(new Error("Callback data too long"), { code: "CALLBACK_DATA_TOO_LONG" });
    if (channel && record.chatId) {
      const summary = result
        ? `${result.reason}: ${formatSpend(result.spent ?? null, result.unit)} / ${formatCap(result.cap ?? null, result.unit)}`
        : reason;
      const text = `Job ${job.id} held by budget governor\nReason: ${summary}`;
      const replyMarkup = keyboard([[button("Approve over budget", payload)]]);
      void Promise.resolve().then(() => channel.send({
        chatId: record.chatId, threadId: record.threadId, text, replyMarkup,
      })).catch((error) => {
        logger?.warn?.("Budget hold card could not be sent", { code: error?.code ?? "CHANNEL_SEND_FAILED" });
      });
    }
  }

  function gate(jobId) {
    const job = currentJobs(store)[jobId];
    if (job?.state !== "approved" || !job.mutating) return;
    let result;
    try {
      result = check(job);
      if (result.ok) return;
    } catch (error) {
      logger?.error?.("Budget check failed; holding job", { code: error?.code ?? "BUDGET_CHECK_FAILED" });
      result = { ok: false, reason: "error" };
    }
    const updated = transition(job, "held-budget", {
      reason: `budget:${result.reason === "error" ? "error" : result.reason}`,
    });
    append(JOBS_STREAM, updated.event);
    try {
      bus?.emit("job.transition", updated.event);
    } catch (error) {
      logger?.error?.("Budget hold transition listener failed", { code: error?.code ?? "EVENT_LISTENER_FAILED" });
    }
    try {
      issueOverride(job, result.reason === "error" ? "budget:error" : result.reason, result);
    } catch (error) {
      logger?.error?.("Budget override could not be issued", { code: error?.code ?? "BUDGET_OVERRIDE_ISSUE_FAILED" });
    }
  }

  function override({ payload, caller, chatId, threadId } = {}) {
    try {
      if (caller?.role !== ROLES[0]) return { ok: false, reason: "role" };
      const match = typeof payload === "string"
        ? /^(?:b:)?([A-Za-z0-9._-]{1,8}):([A-Za-z0-9_-]{22})$/.exec(payload)
        : null;
      if (!match || Buffer.byteLength(payload, "utf8") > CALLBACK_BYTES) return { ok: false, reason: "tampered" };
      const [, shortId, nonce] = match;
      const nonceHash = hashNonce(nonce);
      const rows = overrideRows(store);
      const issue = rows.findLast((record) => record.kind === "override.issued"
        && record.shortId === shortId && hashesMatch(record.nonceHash, nonceHash));
      if (!issue) return { ok: false, reason: "tampered" };
      if (String(chatId ?? "") !== String(issue.chatId ?? "")
        || String(threadId ?? "") !== String(issue.threadId ?? "")) return { ok: false, reason: "chat" };
      if (now() > issue.expiresAt) return { ok: false, reason: "expired" };
      if (rows.some((record) => record.kind === "override.consumed" && record.nonceHash === issue.nonceHash)) {
        return { ok: false, reason: "used" };
      }
      const job = currentJobs(store)[issue.jobId];
      if (job?.state !== "held-budget") return { ok: false, reason: "stale" };
      const day = dayKey({ epochMs: now(), timeZone });
      append(BUDGET_STREAM, {
        v: 1, kind: "override.consumed", jobId: job.id, day,
        approverId: String(caller.userId), usedAt: now(), nonceHash: issue.nonceHash,
      });
      append(BUDGET_STREAM, {
        v: 1, kind: "override", jobId: job.id, day, approverId: String(caller.userId),
      });
      const updated = transition(job, "approved", { reason: "budget:override" });
      append(JOBS_STREAM, updated.event);
      try {
        bus?.emit("job.transition", updated.event);
      } catch (error) {
        logger?.error?.("Budget release transition listener failed", { code: error?.code ?? "EVENT_LISTENER_FAILED" });
      }
      return { ok: true, jobId: job.id };
    } catch (error) {
      logger?.error?.("Budget override failed", { code: error?.code ?? "BUDGET_OVERRIDE_FAILED" });
      return { ok: false, reason: "internal" };
    }
  }

  function render({ projectId, visibleProjects } = {}) {
    const summary = today();
    const selected = visibleProjects
      ? new Set(visibleProjects.map((project) => String(project.id ?? project)))
      : null;
    const projects = Object.entries(summary.projects)
      .filter(([id]) => (projectId === undefined || id === String(projectId)) && (!selected || selected.has(id)));
    const lines = [];
    const hasRecords = projects.length > 0 || Object.keys(summary.projects).some((id) => !selected || selected.has(id));
    if (!hasRecords) lines.push(`No budget activity recorded today (${summary.day}, ${summary.timeZone}).`);
    for (const [id, totals] of projects) {
      const cap = configuredProject(config, id)?.budget ?? {};
      lines.push(`${id}  ${formatSpend(totals.costUSD, "costUSD")} / ${formatCap(capFor(cap, "costUSD"), "costUSD")} · ${formatSpend(totals.premiumRequests, "premiumRequests")} / ${formatCap(capFor(cap, "premiumRequests"), "premiumRequests")} premium · unknown ${totals.unknownUsageJobs}`);
    }
    if (projectId === undefined) {
      const globalCap = config.budget ?? {};
      lines.push(`global  ${formatSpend(summary.global.costUSD, "costUSD")} / ${formatCap(capFor(globalCap, "costUSD"), "costUSD")} · ${formatSpend(summary.global.premiumRequests, "premiumRequests")} / ${formatCap(capFor(globalCap, "premiumRequests"), "premiumRequests")} premium · unknown ${summary.global.unknownUsageJobs}`);
    }
    lines.push(`Time zone: ${summary.timeZone}`);
    const held = Object.values(currentJobs(store))
      .filter((job) => job.state === "held-budget"
        && (projectId === undefined || String(job.projectId) === String(projectId))
        && (!selected || selected.has(String(job.projectId))));
    const reasons = heldReasons(store);
    const shown = held.slice(0, 20);
    if (shown.length) {
      lines.push("Held jobs:");
      for (const job of shown) lines.push(`${job.id}  ${reasons.get(job.id) ?? "budget"}`);
      if (held.length > shown.length) lines.push(`+${held.length - shown.length} more`);
    }
    return lines.join("\n");
  }

  function snapshot() {
    const current = today();
    const jobs = Object.values(currentJobs(store)).filter((job) => job.state === "held-budget");
    const result = {
      day: current.day,
      tz: current.timeZone,
      spendToday: current.global.costUSD,
      caps: {
        dailyUSD: config.budget?.dailyUSD ?? null,
        dailyPremiumRequests: config.budget?.dailyPremiumRequests ?? null,
      },
      unknown: current.global.unknownUsageJobs,
      held: jobs.length,
    };
    return result;
  }

  function audit(record) {
    try {
      append("audit", { v: 1, action: record.kind, ...record, kind: "budget-audit" });
    } catch (error) {
      logger?.error?.("Budget audit write failed", { code: error?.code ?? "STORE_WRITE_FAILED" });
    }
  }

  return {
    store, config, channel, audit, recordUsage, today, check, gate, override, render, snapshot,
  };
}

export function bindBudgetService(service) {
  budgetService = service;
  return () => {
    if (budgetService === service) budgetService = null;
  };
}

export function getBudgetService() {
  return budgetService;
}
