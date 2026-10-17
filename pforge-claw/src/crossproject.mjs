import { randomBytes } from "node:crypto";
import { ClawError } from "./errors.mjs";
import { authorizeJobRequest, currentCaller } from "./handlers/c2-command-context.mjs";
import { createJob, currentJobs, JOBS_STREAM, TERMINAL, transition } from "./jobs/model.mjs";
import {
  APPROVER_ROLES,
  FANOUT_ATTRIBUTION_FIELDS,
  FANOUT_MAX_TARGETS,
  approvalRoleFor as currentRole,
  declaredFanoutChildren as declaredChildren,
  fanoutDeclarationDigest as declarationDigest,
  fanoutProofFor,
  isDeclaredFanoutChild,
  isGeneralProjectVisible,
  isValidFanoutDeclaration as validDeclaration,
  storedFanoutParentFor as matchingParent,
} from "./jobs/approval-proof.mjs";
import {
  findRequestJob,
  normalizeRequestFields,
  requestIdentity,
  withRequestIdentity,
} from "./jobs/request-identity.mjs";
import { isCrossProjectReadable } from "./memory/memory-client.mjs";

/**
 * @typedef {import("./jobs/approval-proof.mjs").FanoutParent} FanoutParent
 * @typedef {ReturnType<typeof import("./state/store.mjs").createStore>} ClawStore
 */

export {
  FANOUT_MAX_TARGETS,
  approvedChoicesFor,
  consumedApprovalFor,
  fanoutProofFor,
  isDeclaredFanoutChild,
} from "./jobs/approval-proof.mjs";

export const FANOUT_DELIM = "--";
const FANOUT_ID_BYTES = 12;
const FANOUT_APPROVAL_REQUIRED = "FANOUT_APPROVAL_REQUIRED";
export const ACTIVE_STATES = Object.freeze([
  "awaiting-approval",
  "approved",
  "held-budget",
  "leased",
  "running",
  "needs-input",
]);

let activeDependencies = null;

function projectsFor({ config, registry } = {}) {
  return registry?.all?.() ?? config?.projects ?? [];
}

export function visibleProjects({ config, registry, scope, projectId } = {}) {
  const projects = projectsFor({ config, registry });
  if (scope === "general") return projects.filter(isGeneralProjectVisible);
  if (scope === "project") {
    const project = projects.find((candidate) => String(candidate.id) === String(projectId));
    return project ? [project] : [];
  }
  return [];
}

function jobCounts(projectJobs) {
  return {
    queued: projectJobs.filter((job) => job.state === "queued").length,
    "awaiting-approval": projectJobs.filter((job) => job.state === "awaiting-approval").length,
    "held-budget": projectJobs.filter((job) => job.state === "held-budget").length,
    running: projectJobs.filter((job) => ["leased", "running", "needs-input"].includes(job.state)).length,
  };
}

function spendFor(budgetSummary, projectId) {
  const usage = budgetSummary?.projects?.[projectId];
  return {
    costUSD: usage?.costUSD ?? null,
    premiumRequests: usage?.premiumRequests ?? null,
  };
}

function capFor(project, unit) {
  if (unit === "costUSD") return project.budget?.dailyUSD ?? project.budget?.costUSD ?? null;
  return project.budget?.dailyPremiumRequests ?? project.budget?.premiumRequests ?? null;
}

export function buildStatusRollup({
  store,
  budget,
  config = {},
  registry,
  scope,
  projectId,
  now = Date.now,
} = {}) {
  const projects = visibleProjects({ config, registry, scope, projectId });
  const jobs = Object.values(currentJobs(store));
  const budgetSummary = budget?.today?.({ epochMs: now() }) ?? null;
  const rows = projects.map((project) => {
    const projectJobs = jobs.filter((job) => String(job.projectId) === String(project.id));
    const activeJobs = projectJobs.filter((job) => ACTIVE_STATES.includes(job.state));
    const activeJobIds = activeJobs.slice(0, 3).map((job) => job.id);
    if (activeJobs.length > activeJobIds.length) {
      activeJobIds.push(`+${activeJobs.length - activeJobIds.length} more`);
    }
    return {
      id: project.id,
      name: project.name ?? project.id,
      counts: jobCounts(projectJobs),
      activeJobIds,
      spend: spendFor(budgetSummary, project.id),
      caps: {
        costUSD: capFor(project, "costUSD"),
        premiumRequests: capFor(project, "premiumRequests"),
      },
    };
  });
  const total = {
    counts: rows.reduce((sum, row) => ({
      queued: sum.queued + row.counts.queued,
      "awaiting-approval": sum["awaiting-approval"] + row.counts["awaiting-approval"],
      "held-budget": sum["held-budget"] + row.counts["held-budget"],
      running: sum.running + row.counts.running,
    }), { queued: 0, "awaiting-approval": 0, "held-budget": 0, running: 0 }),
    spend: {
      costUSD: rows.length > 0 && rows.every((row) => row.spend.costUSD !== null)
        ? rows.reduce((sum, row) => sum + (row.spend.costUSD ?? 0), 0)
        : null,
      premiumRequests: rows.length > 0 && rows.every((row) => row.spend.premiumRequests !== null)
        ? rows.reduce((sum, row) => sum + (row.spend.premiumRequests ?? 0), 0)
        : null,
    },
  };
  return {
    projects: rows,
    total,
    message: rows.length ? null : "No visible projects configured.",
  };
}

function formatSpend(value, unit) {
  if (value === null || value === undefined) return "unknown";
  return unit === "costUSD" ? `$${Number(value).toFixed(2)}` : String(value);
}

function renderCounts(counts) {
  return `queued ${counts.queued}, awaiting approval ${counts["awaiting-approval"]}, held ${counts["held-budget"]}, running ${counts.running}`;
}

export function renderStatusRollup(rollup) {
  if (!rollup.projects.length) return rollup.message ?? "No visible projects configured.";
  const lines = rollup.projects.map((project) => {
    const idle = Object.values(project.counts).every((count) => count === 0);
    const jobs = project.activeJobIds.length ? `; jobs ${project.activeJobIds.join(", ")}` : "";
    return `${project.name}: ${idle ? "idle" : renderCounts(project.counts)}; spend ${formatSpend(project.spend.costUSD, "costUSD")} / ${formatSpend(project.caps.costUSD, "costUSD")}; premium ${formatSpend(project.spend.premiumRequests, "premiumRequests")} / ${formatSpend(project.caps.premiumRequests, "premiumRequests")}${jobs}`;
  });
  lines.push(`Total: ${renderCounts(rollup.total.counts)}; spend ${formatSpend(rollup.total.spend.costUSD, "costUSD")}; premium ${formatSpend(rollup.total.spend.premiumRequests, "premiumRequests")}`);
  return lines.join("\n");
}

export function parseFanoutArgs(argsText) {
  if (typeof argsText !== "string") throw new ClawError("FANOUT_USAGE");
  const delimiterAt = argsText.indexOf(FANOUT_DELIM);
  const task = (delimiterAt < 0 ? argsText : argsText.slice(0, delimiterAt)).trim();
  if (!task) throw new ClawError("FANOUT_USAGE");
  if (delimiterAt < 0) return { task, projectIds: null };
  const ids = argsText.slice(delimiterAt + FANOUT_DELIM.length).trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) throw new ClawError("FANOUT_NO_TARGETS");
  return { task, projectIds: [...new Set(ids)] };
}

export function parseRecallAll(argsText) {
  if (typeof argsText !== "string") return null;
  const match = /^--all(?:\s+|$)([\s\S]*)$/.exec(argsText.trim());
  if (!match) return null;
  const query = match[1].trim();
  if (!query) throw new ClawError("RECALL_USAGE");
  return { all: true, query };
}

function appendTransition({ store, bus, logger }, job, to, reason) {
  const updated = transition(job, to, { reason });
  store.append(JOBS_STREAM, updated.event);
  try {
    bus?.emit("job.transition", updated.event);
  } catch (error) {
    logger?.error?.("Cross-project transition listener failed", {
      code: error?.code ?? "EVENT_LISTENER_FAILED",
    });
  }
  return updated.job;
}

function auditChildApproval({ approvals, parentId, jobId, approverId }) {
  approvals?.audit?.({
    kind: "fanout.child-approved",
    parentId,
    jobId,
    approverId,
  });
}

function refuseParent(deps, parent, code = FANOUT_APPROVAL_REQUIRED) {
  deps.approvals?.audit?.({ kind: "fanout.authorization-refused", parentId: parent.id, code });
  deps.logger?.error?.("Fan-out authorization refused", { parentId: parent.id, code });
}

function inheritBudgetOverride({ deps, parent, child, approverId, budgetRecords, currentDay }) {
  const override = budgetRecords.find((record) => (
    record.kind === "override" && record.jobId === parent.id && record.day === currentDay
  ));
  if (!override || currentDay === undefined) return;
  if (currentRole(deps.config, override.approverId, parent.adapter) !== APPROVER_ROLES[0]) return;
  if (budgetRecords.some((record) => (
    record.kind === "override" && record.jobId === child.id && record.day === currentDay
  ))) return;
  deps.store.append("budget", {
    v: 1, kind: "override", jobId: child.id, day: currentDay, approverId: override.approverId,
  });
  deps.approvals?.audit?.({
    kind: "fanout.budget-override-inherited", parentId: parent.id, jobId: child.id, approverId,
  });
}

function approveQueuedChildren(deps, parent, approverId) {
  const budgetRecords = [...deps.store.read("budget")].map(({ record }) => record);
  const currentDay = deps.budget?.today?.().day;
  for (const target of parent.targets) {
    let child = currentJobs(deps.store)[target.childId];
    if (!["queued", "awaiting-approval"].includes(child.state)) continue;
    inheritBudgetOverride({ deps, parent, child, approverId, budgetRecords, currentDay });
    if (child.state === "queued") child = appendTransition(deps, child, "awaiting-approval", `fanout:${parent.id}`);
    appendTransition(deps, child, "approved", `fanout:${parent.id}`);
    auditChildApproval({ approvals: deps.approvals, parentId: parent.id, jobId: child.id, approverId });
  }
}

function selectFanoutTargets({ config, registry }, argsText) {
  const parsed = parseFanoutArgs(argsText);
  const visible = visibleProjects({ config, registry, scope: "general" });
  if (parsed.projectIds?.length > FANOUT_MAX_TARGETS) throw new ClawError("FANOUT_TOO_MANY");
  let targets;
  if (parsed.projectIds) {
    const allowed = new Map(visible.map((project) => [String(project.id), project]));
    targets = parsed.projectIds.map((id) => {
      const project = allowed.get(id);
      if (!project) throw new ClawError("FANOUT_UNKNOWN_PROJECT");
      return project;
    });
  } else {
    targets = visible;
  }
  if (targets.length > FANOUT_MAX_TARGETS) throw new ClawError("FANOUT_TOO_MANY");
  if (targets.length === 0) throw new ClawError("FANOUT_NO_TARGETS");
  return { task: parsed.task, targets };
}

function parentRequest(deps, input) {
  const authority = currentCaller(deps.config, deps.caller);
  if (!authority) throw new ClawError("CALLER_NOT_ALLOWED");
  const adapter = input.adapter ?? deps.adapter ?? authority.channel;
  if (adapter !== authority.channel) throw new ClawError("CALLER_NOT_ALLOWED");
  return normalizeRequestFields({
    type: "fanout",
    projectId: "general",
    parentId: null,
    callerId: authority.userId,
    adapter,
    updateId: input.updateId ?? deps.updateId ?? null,
    chatId: deps.chatId ?? null,
    threadId: deps.threadId ?? null,
  });
}

function authorizeTargets(deps, projects, caller) {
  let authority = null;
  for (const project of projects) {
    const verdict = authorizeJobRequest({
      config: deps.config, project, caller, store: deps.store, secrets: deps.secrets, lanes: deps.lanes,
    });
    if (!verdict.ok) throw new ClawError(verdict.code);
    authority = verdict.caller;
  }
  return authority;
}

function declaredProjects(deps, parent) {
  const visible = new Map(visibleProjects({
    config: deps.config, registry: deps.registry, scope: "general",
  }).map((project) => [String(project.id), project]));
  return parent.targets.map((target) => {
    const project = visible.get(target.projectId);
    if (!project) throw new ClawError("FANOUT_UNKNOWN_PROJECT");
    return project;
  });
}

function authorizeParent(deps, parent) {
  return authorizeTargets(deps, declaredProjects(deps, parent), {
    userId: parent.callerId, channel: parent.adapter,
  });
}

function createFanoutParent({ request, task, targets, callerRole, now }) {
  const parentId = randomBytes(FANOUT_ID_BYTES).toString("hex");
  const declarations = targets.map((project) => {
    const childId = randomBytes(FANOUT_ID_BYTES).toString("hex");
    return { projectId: String(project.id), childId, branch: `claw/${childId}` };
  });
  const targetsList = declarations.map((target) => (
    `${target.projectId} → job ${target.childId}, branch ${target.branch}`
  ));
  const parent = {
    ...createJob({ id: parentId, type: "fanout", projectId: "general", parentId: null }).job,
    ...request,
    description: `${task}\n\nTargets (${declarations.length}):\n${targetsList.join("\n")}`,
    task,
    callerRole,
    createdAt: new Date(now()).toISOString(),
    targets: declarations,
    targetBranch: "per-target (see list)",
    lane: "per-target",
  };
  parent.approvalDigest = declarationDigest(parent);
  return parent;
}

function childFor(parent, target) {
  return {
    ...createJob({ id: target.childId, type: "task", projectId: target.projectId, parentId: parent.id }).job,
    ...Object.fromEntries(FANOUT_ATTRIBUTION_FIELDS.map((field) => [field, parent[field]])),
    description: parent.task,
    createdAt: parent.createdAt,
    fanoutParentId: parent.id,
    targetBranch: target.branch,
  };
}

function recoverFanoutFamily(store, parent) {
  if (!matchingParent(store, parent)) throw new ClawError("FANOUT_REQUEST_MISMATCH");
  for (const target of parent.targets) {
    const child = currentJobs(store)[target.childId];
    if (!child) store.append(JOBS_STREAM, { kind: "job.created", job: childFor(parent, target) });
    else if (!isDeclaredFanoutChild({ parent, child })) throw new ClawError("FANOUT_REQUEST_MISMATCH");
  }
  if (parent.state !== "queued") return parent;
  const awaiting = transition(parent, "awaiting-approval");
  store.append(JOBS_STREAM, awaiting.event);
  return awaiting.job;
}

function fanoutReceipt(parent) {
  const state = parent.state === "awaiting-approval" ? "awaiting approval" : parent.state;
  return {
    text: `Fan-out ${parent.id} ${state} for ${parent.targets.length} projects.`,
    jobId: parent.id,
    state: parent.state,
  };
}

/**
 * Creates or recovers one durable family; only G1 may lease its parent or children.
 * @returns {Promise<{text:string,jobId:string,state:string}>}
 */
export async function prepareFanout(deps = {}, input = {}) {
  const { store, now = Date.now } = deps;
  if (!store || typeof store.append !== "function") throw new ClawError("SERVICE_UNAVAILABLE");
  const selection = selectFanoutTargets(deps, input.argsText ?? "");
  const request = parentRequest(deps, input);
  const identity = requestIdentity(request);
  return withRequestIdentity({ identity }, () => {
    let parent = findRequestJob(store, request);
    const authority = authorizeTargets(deps, parent ? declaredProjects(deps, parent) : selection.targets, deps.caller);
    if (!parent) {
      parent = createFanoutParent({ request, ...selection, callerRole: authority.role, now });
      store.append(JOBS_STREAM, { kind: "job.created", job: parent });
    }
    return fanoutReceipt(recoverFanoutFamily(store, parent));
  });
}

function requestParentStart(deps, parent) {
  deps.budget.gate(parent.id);
  if (currentJobs(deps.store)[parent.id].state === "approved") deps.bus?.emit("fanout.ready", { parentId: parent.id });
}

function hasParentServices(deps, parent) {
  if (typeof deps.budget?.gate !== "function") {
    refuseParent(deps, parent, "FANOUT_BUDGET_UNAVAILABLE");
    return false;
  }
  try {
    authorizeParent(deps, parent);
    return true;
  } catch (error) {
    refuseParent(deps, parent, error instanceof ClawError ? error.code : "FANOUT_FAILED");
    return false;
  }
}

export function onParentApproved(deps = {}, event = {}) {
  const parent = currentJobs(deps.store)[event.jobId];
  if (parent?.type !== "fanout" || !["approved", "leased", "running"].includes(parent.state)) return;
  const proof = fanoutProofFor({ store: deps.store, config: deps.config, parent });
  if (!proof) {
    refuseParent(deps, parent);
    return;
  }
  if (parent.state === "leased") return;
  if (!hasParentServices(deps, parent)) return;
  if (parent.state === "approved") {
    requestParentStart(deps, parent);
    return;
  }
  approveQueuedChildren(deps, parent, proof.approverId);
  for (const target of parent.targets) deps.budget.gate(target.childId);
}

export function onParentClosed(deps = {}, event = {}) {
  const parent = currentJobs(deps.store)[event.jobId];
  if (parent?.type !== "fanout" || !["rejected", "expired"].includes(parent.state)) return;
  const children = declaredChildren(deps.store, parent);
  if (!children) {
    refuseParent(deps, parent, "FANOUT_REQUEST_MISMATCH");
    return;
  }
  for (let child of children) {
    const reason = `fanout:${parent.id}:${parent.state}`;
    if (child.state === "queued") child = appendTransition(deps, child, "awaiting-approval", reason);
    if (child.state === "awaiting-approval") appendTransition(deps, child, parent.state, reason);
  }
}

async function sendCombinedReport(deps, parent, children) {
  const allowedProjects = new Map(visibleProjects({
    config: deps.config,
    registry: deps.registry,
    scope: "general",
  }).map((project) => [String(project.id), project]));
  const lines = children.map((child) => {
    const project = allowedProjects.get(String(child.projectId));
    if (!project) return `Restricted project: ${child.state}`;
    const url = child.prUrl ?? child.pullRequestUrl;
    return `${project?.name ?? child.projectId}: ${child.state}${url ? ` — ${url}` : ""}`;
  });
  try {
    await deps.channel.send({
      chatId: String(parent.chatId),
      threadId: parent.threadId ?? null,
      text: [`Fan-out ${parent.id} complete (${parent.state})`, ...lines].join("\n"),
    });
    deps.store.append("audit", { kind: "fanout.report-sent", parentId: parent.id });
  } catch (error) {
    deps.approvals?.audit?.({
      kind: "fanout.report-failed",
      parentId: parent.id,
      code: error?.code ?? "CHANNEL_SEND_FAILED",
    });
    deps.logger?.error?.("Fan-out report could not be sent", {
      code: error?.code ?? "CHANNEL_SEND_FAILED",
    });
  }
}

function terminalChildFamily(store, event) {
  if (!TERMINAL.includes(event.to)) return null;
  const jobs = currentJobs(store);
  const child = jobs[event.jobId];
  if (!child?.parentId || child.state !== event.to) return null;
  const parent = jobs[child.parentId];
  if (parent?.type !== "fanout" || !["running", "succeeded", "failed", "cancelled"].includes(parent.state)) return null;
  return { parent, child };
}

export async function onChildTerminal(deps = {}, event = {}) {
  const family = terminalChildFamily(deps.store, event);
  if (!family) return;
  const { parent, child } = family;
  if (!fanoutProofFor({ store: deps.store, config: deps.config, parent, child })) {
    refuseParent(deps, parent);
    return;
  }
  if (parent.state !== "running") {
    await onParentTerminal(deps, { jobId: parent.id, to: parent.state });
    return;
  }
  const completion = fanoutCompletionFor({ store: deps.store, parent });
  if (completion) deps.bus?.emit("fanout.settle", { parentId: parent.id, ...completion });
}

/**
 * G1 owns the transition; this only determines the combined terminal intent.
 * @param {{store?:ClawStore,parent?:FanoutParent}} options
 * @returns {{to:"succeeded"|"failed",reason:string}|null}
 */
export function fanoutCompletionFor({ store, parent } = {}) {
  const children = declaredChildren(store, parent);
  if (!children || children.some((child) => !TERMINAL.includes(child.state))) return null;
  return {
    to: children.every((child) => child.state === "succeeded") ? "succeeded" : "failed",
    reason: "fanout:complete",
  };
}

const reportFlights = new WeakMap();

async function reportTerminalParent(deps, parent) {
  const sent = [...deps.store.read("audit")].some(({ record }) => (
    record.kind === "fanout.report-sent" && record.parentId === parent.id
  ));
  if (sent) return;
  const children = declaredChildren(deps.store, parent);
  if (!children || !fanoutCompletionFor({ store: deps.store, parent })) return;
  await sendCombinedReport(deps, parent, children);
}

export async function onParentTerminal(deps = {}, event = {}) {
  const parent = currentJobs(deps.store)[event.jobId];
  if (parent?.type !== "fanout" || !["succeeded", "failed", "cancelled"].includes(parent.state)) return;
  if (!fanoutProofFor({ store: deps.store, config: deps.config, parent })) {
    refuseParent(deps, parent);
    return;
  }
  const flights = reportFlights.get(deps.store) ?? new Map();
  reportFlights.set(deps.store, flights);
  if (flights.has(parent.id)) return flights.get(parent.id);
  const pending = Promise.resolve().then(() => reportTerminalParent(deps, parent))
    .finally(() => flights.delete(parent.id));
  flights.set(parent.id, pending);
  return pending;
}

export async function reconcile(deps = {}) {
  const parents = Object.values(currentJobs(deps.store)).filter((job) => job.type === "fanout");
  for (const parent of parents) {
    if (validDeclaration(parent)) {
      try {
        authorizeParent(deps, parent);
        recoverFanoutFamily(deps.store, parent);
      } catch (error) {
        refuseParent(deps, parent, error instanceof ClawError ? error.code : "FANOUT_FAILED");
        continue;
      }
    }
    const event = { jobId: parent.id, to: parent.state };
    if (["rejected", "expired"].includes(parent.state)) onParentClosed(deps, event);
    onParentApproved(deps, event);
    const children = declaredChildren(deps.store, parent);
    const terminalChild = children?.find((child) => TERMINAL.includes(child.state));
    if (terminalChild) await onChildTerminal(deps, { jobId: terminalChild.id, to: terminalChild.state });
    await onParentTerminal(deps, event);
  }
}

function recallHit(hit, allowed) {
  const projectId = String(hit.projectId ?? hit.project?.id ?? hit.project ?? "");
  const project = allowed.get(projectId);
  if (!project || hit.visibility === "restricted") return [];
  const snippet = String(hit.snippet ?? hit.content ?? hit.text ?? "")
    .slice(0, 240)
    .replace(/```/g, "'''");
  return [{
    project: { id: project.id, name: project.name ?? project.id },
    recordRef: typeof (hit.recordRef ?? hit.id) === "string"
      ? (hit.recordRef ?? hit.id).slice(0, 160)
      : null,
    origin: hit.origin === "trusted" ? "trusted" : "untrusted",
    snippet: `\`\`\`\n${snippet}\n\`\`\``,
  }];
}

function recallMessage(query, hits, errors) {
  if (!hits.length && errors.length) return `No matches returned; ${errors.length} project searches failed.`;
  if (!hits.length) return `No matches for "${query}".`;
  if (errors.length) return `${hits.length} matches returned; ${errors.length} project searches failed.`;
  return `${hits.length} matches returned.`;
}

export async function recallAll({ memory, config = {}, registry }, { query, limit } = {}) {
  if (!memory || typeof memory.fanoutSearch !== "function") {
    throw new ClawError("SERVICE_UNAVAILABLE");
  }
  const visible = visibleProjects({ config, registry, scope: "general" }).filter(isCrossProjectReadable);
  const allowed = new Map(visible.map((project) => [String(project.id), project]));
  const result = await memory.fanoutSearch(query, { limit });
  const hits = (result?.hits ?? []).flatMap((hit) => recallHit(hit, allowed));
  const errors = (result?.errors ?? []).filter((error) => allowed.has(String(error.projectId)))
    .map((error) => ({
      projectId: error.projectId,
      code: /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error.code ?? ""))
        ? error.code
        : "MEMORY_SEARCH_FAILED",
    }));
  return { hits, errors, total: hits.length, message: recallMessage(query, hits, errors) };
}

export function renderRecallAll(result) {
  const rows = (result?.hits ?? []).map((hit) => [
    `${hit.origin === "untrusted" ? "⚠ untrusted: " : ""}• [${hit.project.name}]`
      + `${hit.recordRef ? ` (${hit.recordRef})` : ""}`,
    hit.snippet,
  ].join("\n"));
  return [result?.message ?? "No matches.", ...rows].join("\n");
}

export function bindCrossprojectDependencies(dependencies) {
  activeDependencies = dependencies;
  return () => {
    if (activeDependencies === dependencies) activeDependencies = null;
  };
}

export function getCrossprojectDependencies() {
  return activeDependencies;
}
