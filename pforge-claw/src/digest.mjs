import { randomBytes } from "node:crypto";
import { dayKey, foldLedger } from "./budget.mjs";
import { ClawError } from "./errors.mjs";
import { button, keyboard } from "./channels/telegram/format.mjs";

export const DIGEST_TOOLS = Object.freeze({
  plan: "forge_plan_status",
  bugs: "forge_bug_list",
  drift: "forge_drift_report",
  audit: "forge_master_audit",
});
export const DIGEST_PROPOSAL_TTL_MS = 12 * 60 * 60_000;
export const SOURCE_TIMEOUT_MS = 15_000;

const MESSAGE_LIMIT = 4096;
const DAY_MS = 86_400_000;
const RISK_LIMIT = 3;
const PROPOSAL_ID_BYTES = 6;
const PROPOSAL_LIMIT = 100;
const CALLBACK_LIMIT_BYTES = 64;
const BUTTON_DETAIL_LIMIT = 32;
const PROJECT_NAME_LIMIT = 40;
const COMPACT_NAME_LIMIT = 18;
const PLAN_STATUS_LIMIT = 16;
const DRIFT_SUMMARY_LIMIT = 24;
const COMPACT_ID_LIMIT = 8;
const SHORT_ID_LIMIT = 6;
const MINIMAL_ID_LIMIT = 3;
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled", "expired", "rejected"]);
const FAILED_STATES = new Set(["failed", "cancelled", "expired", "rejected"]);
const PROPOSAL_REQUIRED_ARGS = Object.freeze({
  task: "description",
  skill: "name",
  plan: "plan",
  run: "plan",
  retry: "jobId",
  abort: "jobId",
  bug: "text",
  idea: "text",
  remember: "text",
});

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : "MCP_SOURCE_FAILED";
}

function unwrap(value) {
  if (value?.isError || value?.ok === false || value?.error) {
    throw new ClawError(typeof value.error === "string" ? value.error : "MCP_TOOL_ERROR");
  }
  if (Array.isArray(value?.content)) {
    const text = value.content.find((entry) => entry?.type === "text")?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }
  }
  return value?.data ?? value;
}

async function sourceCall(mcp, projectId, tool) {
  let timer;
  try {
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new ClawError("SOURCE_TIMEOUT")), SOURCE_TIMEOUT_MS);
    });
    const value = await Promise.race([mcp.call(projectId, tool, {}), timeout]);
    return { ok: true, value: unwrap(value) };
  } catch (error) {
    return { ok: false, code: errorCode(error) };
  } finally {
    clearTimeout(timer);
  }
}

function sourceCount(value) {
  if (!value?.ok) return null;
  const result = value.value;
  for (const count of [result?.total, result?.count, result?.totalCount]) {
    if (typeof count === "number" && Number.isFinite(count)) return count;
  }
  for (const list of [result?.bugs, result?.hits, result?.items, result?.issues]) {
    if (Array.isArray(list)) return list.length;
  }
  return null;
}

function jobCounts(records, now) {
  const projectByJob = new Map();
  const counts = new Map();
  const cutoff = now - DAY_MS;
  for (const record of records) {
    if (record?.kind === "job.created" && record.job?.id) {
      projectByJob.set(record.job.id, record.job.projectId);
      continue;
    }
    if (record?.kind !== "job.transition" || !TERMINAL_STATES.has(record.to)) continue;
    const at = Date.parse(record.ts ?? "");
    if (!Number.isFinite(at) || at < cutoff || at > now) continue;
    const projectId = record.projectId ?? projectByJob.get(record.jobId);
    if (projectId === undefined || projectId === null) continue;
    const projectKey = String(projectId);
    const current = counts.get(projectKey) ?? { succeeded: 0, failed: 0 };
    if (record.to === "succeeded") current.succeeded += 1;
    else if (FAILED_STATES.has(record.to)) current.failed += 1;
    counts.set(projectKey, current);
  }
  return counts;
}

function readRecords(store, stream) {
  return [...store.read(stream)].map(({ record }) => record);
}

function normalizedAction(action, projectId, secrets) {
  const kind = action?.kind ?? action?.type;
  const required = PROPOSAL_REQUIRED_ARGS[kind];
  if (!required || !action.args || typeof action.args !== "object" || Array.isArray(action.args)) return null;
  if (action.projectId && String(action.projectId) !== String(projectId)) return null;
  const rawRequired = action.args[required];
  if (typeof rawRequired !== "string" || !rawRequired.trim() || rawRequired.length > 1000) return null;
  const args = Object.fromEntries(Object.entries(action.args)
    .filter(([key, value]) => ["description", "name", "plan", "quorum", "jobId", "text"].includes(key)
      && (typeof value === "string" && value.length <= (key === required ? 1000 : 100)))
    .map(([key, value]) => [key, secrets?.redact ? secrets.redact(value) : value]));
  return { kind, args };
}

function actionRows(result) {
  const candidates = [
    ...(Array.isArray(result?.p0Actions) ? result.p0Actions : []),
    ...(Array.isArray(result?.actions) ? result.actions : []),
    ...(Array.isArray(result?.proposedActions) ? result.proposedActions : []),
  ];
  return candidates.filter((action) => String(action?.priority ?? action?.severity ?? "").toUpperCase() === "P0");
}

function auditSummary(result, project, secrets) {
  if (!result?.ok) return { projectId: project?.id ?? null, risks: [], actions: [], unavailable: result?.code ?? "MCP_SOURCE_FAILED" };
  const value = result.value ?? {};
  const allRisks = Array.isArray(value.risks) ? value.risks : [];
  const risks = project?.visibility === "restricted" ? [] : allRisks
    .slice(0, RISK_LIMIT)
    .map((risk) => ({
      title: String(risk.title ?? risk.summary ?? risk.description ?? "Risk"),
      ...(risk.priority ? { priority: risk.priority } : {}),
    }));
  const actions = project?.visibility === "restricted" ? [] : actionRows(value)
    .map((action) => normalizedAction(action, project.id, secrets))
    .filter(Boolean)
    .map((action) => ({
      ...action,
      projectId: project.id,
      proposalId: randomBytes(PROPOSAL_ID_BYTES).toString("base64url"),
    }));
  return {
    projectId: project?.id ?? null,
    risks,
    riskCount: allRisks.length,
    restricted: project?.visibility === "restricted",
    actions,
  };
}

export async function collectDigest({ store, config = {}, mcp, now = Date.now(), timeZone } = {}) {
  const projects = Array.isArray(config.projects) ? config.projects : [];
  const timezone = timeZone ?? config.timezone;
  const timestamp = typeof now === "function" ? now() : now;
  let jobsByProject = new Map();
  try {
    jobsByProject = jobCounts(readRecords(store, "jobs"), timestamp);
  } catch {
    jobsByProject = new Map();
  }
  const projectResults = await Promise.allSettled(projects.map(async (project) => {
    const sourceEntries = await Promise.allSettled(
      Object.entries(DIGEST_TOOLS)
        .filter(([name]) => name !== "audit")
        .map(async ([name, tool]) => [name, await sourceCall(mcp, project.id, tool)]),
    );
    const sources = {};
    for (const result of sourceEntries) {
      if (result.status === "fulfilled") {
        const [name, value] = result.value;
        sources[name] = value;
      } else {
        sources.plan ??= { ok: false, code: errorCode(result.reason) };
      }
    }
    const jobs = jobsByProject.get(String(project.id)) ?? { succeeded: 0, failed: 0 };
    return {
      id: String(project.id),
      name: String(project.displayName ?? project.name ?? project.id),
      restricted: project.visibility === "restricted",
      sources,
      jobs,
      costUSD: null,
    };
  }));

  const projectData = projectResults.map((result, index) => result.status === "fulfilled"
    ? result.value
    : {
      id: String(projects[index]?.id ?? index),
      name: String(projects[index]?.displayName ?? projects[index]?.id ?? "Project"),
      restricted: projects[index]?.visibility === "restricted",
      sources: Object.fromEntries(["plan", "bugs", "drift"].map((name) => [name, {
        ok: false,
        code: errorCode(result.reason),
      }])),
      jobs: { succeeded: 0, failed: 0 },
      costUSD: null,
    });

  let spend = { projects: {} };
  try {
    spend = foldLedger({
      records: readRecords(store, "budget"),
      timeZone: timezone,
      day: dayKey({ epochMs: timestamp - DAY_MS, timeZone: timezone }),
    });
  } catch {
    spend = { projects: {} };
  }
  for (const project of projectData) {
    project.costUSD = spend.projects?.[project.id]?.costUSD ?? null;
  }

  let audit = { projectId: null, risks: [], actions: [], unavailable: "NO_PROJECT" };
  for (let index = 0; index < projectData.length; index += 1) {
    const project = projects[index];
    const sources = projectData[index].sources;
    if (!["plan", "bugs", "drift"].every((name) => sources[name]?.ok)) continue;
    audit = auditSummary(
      await sourceCall(mcp, project.id, DIGEST_TOOLS.audit),
      project,
    );
    break;
  }
  return { generatedAt: new Date(timestamp).toISOString(), projects: projectData, lookAtFirst: audit };
}

function planStatus(project) {
  if (!project.sources?.plan?.ok) return "unavailable";
  const value = project.sources.plan.value;
  return String(value?.status ?? value?.plan?.status ?? "?").slice(0, PLAN_STATUS_LIMIT);
}

function driftSummary(project) {
  if (project.restricted || !project.sources?.drift?.ok) return "?";
  const value = project.sources.drift.value;
  return String(value?.summary ?? value?.status ?? "?").slice(0, DRIFT_SUMMARY_LIMIT);
}

function compactProjectLine(project, compact = false) {
  const name = (compact ? project.id : project.name)
    .slice(0, compact ? COMPACT_NAME_LIMIT : PROJECT_NAME_LIMIT);
  const bugs = sourceCount(project.sources?.bugs);
  const spend = typeof project.costUSD === "number" && Number.isFinite(project.costUSD)
    ? `$${project.costUSD.toFixed(2)}`
    : "?";
  return `• ${name} — plan ${planStatus(project)} · jobs ✅${project.jobs?.succeeded ?? 0} ❌${project.jobs?.failed ?? 0} · ${spend} · bugs ${bugs ?? "?"} · drift ${driftSummary(project)}`;
}

function unavailableAuditLines(audit) {
  return audit.unavailable ? [`Audit unavailable (${audit.unavailable})`] : [];
}

function lookAtFirstLines(audit) {
  const risks = (audit.risks ?? []).slice(0, RISK_LIMIT);
  const riskLines = risks.map((risk) => `• ${risk.title ?? risk.summary ?? "Risk"}`);
  return [
    "Look at first",
    ...unavailableAuditLines(audit),
    ...(audit.restricted ? [`${audit.riskCount ?? 0} risks (restricted)`] : []),
    ...riskLines,
    ...(audit.actions?.length ? [`P0 actions: ${audit.actions.length}`] : []),
  ];
}

function fullDigestText({ projects, audit }) {
  return ["Plan Forge morning digest", ...projects.map((project) => compactProjectLine(project)),
    "", ...lookAtFirstLines(audit)].join("\n");
}

function compactDigestText({ projects, audit }) {
  const lines = projects.map((project) => (
    `• ${String(project.id).slice(0, COMPACT_ID_LIMIT)} P${project.sources?.plan?.ok ? "✓" : "?"} J${project.jobs?.succeeded ?? 0}/${project.jobs?.failed ?? 0} ${typeof project.costUSD === "number" ? `$${project.costUSD.toFixed(2)}` : "?"} B${sourceCount(project.sources?.bugs) ?? "?"} D?`
  ));
  return ["Plan Forge morning digest", ...lines, "", "Look at first", ...unavailableAuditLines(audit)].join("\n");
}

function minimalDigestText({ projects, audit, idLimit, includeUnavailable = false }) {
  const lines = projects.map((project) => (
    `• ${String(project.id).slice(0, idLimit)} ${project.jobs?.succeeded ?? 0}/${project.jobs?.failed ?? 0}`
  ));
  return ["Plan Forge digest", ...lines, ...(includeUnavailable ? [] : [""]), "Look first",
    ...(includeUnavailable ? unavailableAuditLines(audit) : [])].join("\n");
}

function boundedDigestText({ projects, audit, redact }) {
  const builders = [
    () => fullDigestText({ projects, audit }),
    () => compactDigestText({ projects, audit }),
    () => minimalDigestText({ projects, audit, idLimit: SHORT_ID_LIMIT }),
    () => minimalDigestText({ projects, audit, idLimit: MINIMAL_ID_LIMIT, includeUnavailable: true }),
  ];
  for (const build of builders) {
    const text = redact(build());
    if (text.length <= MESSAGE_LIMIT) return text;
  }
  throw new ClawError("DIGEST_TOO_LARGE");
}

function proposalButton(action, secrets) {
  const detail = action.args?.description ?? action.args?.name
    ?? action.args?.plan ?? action.args?.text ?? action.kind;
  const label = `${action.kind}: ${String(detail).slice(0, BUTTON_DETAIL_LIMIT)}`;
  return button(secrets?.redact ? secrets.redact(label) : label, `p:${action.proposalId}`);
}

export function renderDigest(data, { secrets } = {}) {
  const audit = data?.lookAtFirst ?? { risks: [], actions: [] };
  const text = boundedDigestText({
    projects: data?.projects ?? [],
    audit,
    redact: secrets?.redact ?? String,
  });
  const buttons = (audit.actions ?? []).filter((action) => action.proposalId)
    .map((action) => proposalButton(action, secrets));
  return { text, replyMarkup: buttons.length ? keyboard(buttons.map((item) => [item])) : null };
}

function auditSkip(store, reason) {
  store.append("audit", { v: 1, kind: "digest.skipped", reason });
  return { sent: false, reason };
}

function actionProjectId(action, data) {
  return String(action.projectId ?? data?.lookAtFirst?.projectId ?? "");
}

function redactProposalAction(action, secrets) {
  return {
    kind: action.kind,
    args: Object.fromEntries(Object.entries(action.args ?? {}).map(([key, value]) => [
      key,
      secrets?.redact ? secrets.redact(String(value)) : String(value),
    ])),
  };
}

function persistProposal({ store, action, projectId, generalChat, secrets, timestamp }) {
  const id = action.proposalId ?? randomBytes(PROPOSAL_ID_BYTES).toString("base64url");
  const proposalAction = redactProposalAction(action, secrets);
  const callbackData = `p:${id}`;
  if (Buffer.byteLength(callbackData, "utf8") > CALLBACK_LIMIT_BYTES) throw new ClawError("CALLBACK_DATA_TOO_LONG");
  store.append("proposals", {
    v: 1,
    id,
    project: projectId,
    chatId: String(generalChat.chatId),
    topicId: generalChat.topicId ?? null,
    action: proposalAction,
    untrusted: true,
    expiresAt: timestamp + DIGEST_PROPOSAL_TTL_MS,
    used: false,
  });
  return proposalButton({ ...proposalAction, proposalId: id }, secrets);
}

function digestTarget(config, channel) {
  const generalChat = config.channels?.telegram?.generalChat;
  if (generalChat?.chatId === undefined || generalChat?.chatId === null
    || String(generalChat.chatId).trim() === "") {
    return { reason: "no-general-chat" };
  }
  if (!channel || typeof channel.send !== "function") return { reason: "no-channel" };
  return { generalChat };
}

export async function sendDigest({
  store, channel, config = {}, data, secrets, now = Date.now, rendered,
} = {}) {
  const { generalChat, reason } = digestTarget(config, channel);
  if (reason) return auditSkip(store, reason);

  const timestamp = typeof now === "function" ? now() : now;
  const projectById = new Map((config.projects ?? []).map((project) => [String(project.id), project]));
  const actions = (data?.lookAtFirst?.actions ?? [])
    .filter((action) => projectById.has(actionProjectId(action, data)))
    .slice(0, PROPOSAL_LIMIT);
  const callbacks = actions.map((action) => persistProposal({
    store, action, projectId: actionProjectId(action, data), generalChat, secrets, timestamp,
  }));
  const renderData = {
    ...data,
    lookAtFirst: { ...data?.lookAtFirst, actions },
  };
  const result = rendered ?? renderDigest(renderData, { secrets });
  const text = result.text;
  const renderedMarkup = result.replyMarkup;
  const replyMarkup = callbacks.length ? renderedMarkup : null;
  await channel.send({
    chatId: String(generalChat.chatId),
    threadId: generalChat.topicId ?? null,
    text,
    replyMarkup,
  });
  return { sent: true, proposalCount: callbacks.length };
}
