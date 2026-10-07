import { randomBytes } from "node:crypto";
import { ClawError } from "./errors.mjs";
import { createJob, currentJobs, JOBS_STREAM, TERMINAL, transition } from "./jobs/model.mjs";

export const FANOUT_MAX_TARGETS = 20;
export const FANOUT_DELIM = "--";
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
  if (scope === "general") return projects.filter((project) => project.visibility !== "restricted");
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

function auditChildApproval(approvals, parentId, jobId, approverId) {
  approvals?.audit?.({
    kind: "fanout.child-approved",
    parentId,
    jobId,
    approverId: approverId ?? null,
  });
}

function approverFor(approvals, parentId) {
  const records = approvals?.fold?.()?.byHash;
  if (!records) return null;
  return [...records.values()].find((record) => (
    record.kind === "approval.consumed" && record.jobId === parentId && record.decision === "approve"
  ))?.approverId ?? null;
}

function approveQueuedChildren(deps, parent, approverId) {
  const budgetRecords = [...(deps.store.read?.("budget") ?? [])].map(({ record }) => record);
  const currentDay = deps.budget?.today?.().day;
  const inheritedOverride = budgetRecords
    .find((record) => record.kind === "override" && record.jobId === parent.id);
  for (const target of parent.targets ?? []) {
    let child = currentJobs(deps.store)[target.childId];
    if (child?.state !== "queued") continue;
    const activeOverride = inheritedOverride
      && (currentDay === undefined || inheritedOverride.day === currentDay);
    const alreadyInherited = activeOverride && budgetRecords.some((record) => (
      record.kind === "override" && record.jobId === child.id && record.day === inheritedOverride.day
    ));
    if (activeOverride && !alreadyInherited) {
      deps.store.append("budget", {
        v: 1,
        kind: "override",
        jobId: child.id,
        day: inheritedOverride.day,
        approverId: inheritedOverride.approverId,
      });
      deps.approvals?.audit?.({
        kind: "fanout.budget-override-inherited",
        parentId: parent.id,
        jobId: child.id,
        approverId: inheritedOverride.approverId ?? approverId ?? null,
      });
    }
    child = appendTransition(deps, child, "awaiting-approval", `fanout:${parent.id}`);
    child = appendTransition(deps, child, "approved", `fanout:${parent.id}`);
    auditChildApproval(deps.approvals, parent.id, child.id, approverId);
  }
}

export function prepareFanout(deps = {}, { argsText = "" } = {}) {
  const { store, config = {}, registry, caller, chatId, threadId } = deps;
  if (!store || typeof store.append !== "function") throw new ClawError("SERVICE_UNAVAILABLE");
  const parsed = parseFanoutArgs(argsText);
  const visible = visibleProjects({ config, registry, scope: "general" });
  if (parsed.projectIds?.length > FANOUT_MAX_TARGETS || visible.length > FANOUT_MAX_TARGETS) {
    throw new ClawError("FANOUT_TOO_MANY");
  }
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

  const parentId = randomBytes(12).toString("hex");
  const parentCreated = createJob({
    id: parentId,
    type: "fanout",
    projectId: "general",
    parentId: null,
  });
  const children = targets.map((project) => {
    const created = createJob({
      id: randomBytes(12).toString("hex"),
      type: "task",
      projectId: project.id,
      parentId,
    });
    return {
      ...created.job,
      description: parsed.task,
      callerId: String(caller?.userId ?? ""),
      createdAt: new Date().toISOString(),
      chatId: chatId ?? null,
      threadId: threadId ?? null,
      fanoutParentId: parentId,
      targetBranch: `claw/${created.job.id}`,
    };
  });
  const targetsList = children.map((child) => (
    `${child.projectId} → job ${child.id}, branch claw/${child.id}`
  ));
  const parent = {
    ...parentCreated.job,
    description: `${parsed.task}\n\nTargets (${children.length}):\n${targetsList.join("\n")}`,
    callerId: String(caller?.userId ?? ""),
    createdAt: new Date().toISOString(),
    chatId: chatId ?? null,
    threadId: threadId ?? null,
    targets: children.map((child) => ({
      projectId: child.projectId,
      childId: child.id,
      branch: `claw/${child.id}`,
    })),
    targetBranch: "per-target (see list)",
    lane: "per-target",
  };
  store.append(JOBS_STREAM, { kind: "job.created", job: parent });
  for (const child of children) {
    store.append(JOBS_STREAM, { kind: "job.created", job: child });
  }
  const awaiting = transition(parent, "awaiting-approval");
  store.append(JOBS_STREAM, awaiting.event);
  return { text: `Fan-out ${parent.id} awaiting approval for ${children.length} projects.` };
}

export function onParentApproved(deps = {}, event = {}) {
  let parent = currentJobs(deps.store)[event.jobId];
  if (parent?.type !== "fanout" || parent.state !== "approved") return;
  const approverId = approverFor(deps.approvals, parent.id);
  parent = appendTransition(deps, parent, "leased", "fanout:coordinator");
  parent = appendTransition(deps, parent, "running", "fanout:coordinator");
  approveQueuedChildren(deps, parent, approverId);
}

export function onParentClosed(deps = {}, event = {}) {
  const parent = currentJobs(deps.store)[event.jobId];
  if (parent?.type !== "fanout" || !["rejected", "expired"].includes(parent.state)) return;
  for (const target of parent.targets ?? []) {
    let child = currentJobs(deps.store)[target.childId];
    if (child?.state !== "queued") continue;
    child = appendTransition(deps, child, "awaiting-approval", `fanout:${parent.id}:${parent.state}`);
    appendTransition(deps, child, parent.state, `fanout:${parent.id}:${parent.state}`);
  }
}

function parentChildren(store, parent) {
  const jobs = currentJobs(store);
  return (parent.targets ?? []).map((target) => jobs[target.childId]).filter(Boolean);
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
      text: [`Fan-out ${parent.id} complete`, ...lines].join("\n"),
    });
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

export async function onChildTerminal(deps = {}, event = {}) {
  if (!TERMINAL.includes(event.to)) return;
  const child = currentJobs(deps.store)[event.jobId];
  if (!child?.parentId) return;
  const parent = currentJobs(deps.store)[child.parentId];
  if (parent?.type !== "fanout" || parent.state !== "running") return;
  const children = parentChildren(deps.store, parent);
  if (children.length !== parent.targets?.length
    || !children.length
    || children.some((entry) => !TERMINAL.includes(entry.state))) return;
  const result = children.every((entry) => entry.state === "succeeded") ? "succeeded" : "failed";
  const finished = appendTransition(deps, parent, result, "fanout:complete");
  await sendCombinedReport(deps, finished, children);
}

export async function reconcile(deps = {}) {
  const jobs = currentJobs(deps.store);
  for (const parent of Object.values(jobs).filter((job) => job.type === "fanout")) {
    if (["rejected", "expired"].includes(parent.state)) {
      onParentClosed(deps, { jobId: parent.id, to: parent.state });
      continue;
    }
    if (parent.state === "approved") {
      deps.budget?.gate?.(parent.id);
      onParentApproved(deps, { jobId: parent.id, to: "approved" });
      continue;
    }
    let coordinatedParent = parent;
    if (parent.state === "leased") {
      coordinatedParent = appendTransition(deps, parent, "running", "fanout:coordinator");
    }
    if (coordinatedParent.state === "running") {
      approveQueuedChildren(deps, coordinatedParent, approverFor(deps.approvals, parent.id));
      for (const target of coordinatedParent.targets ?? []) {
        const child = currentJobs(deps.store)[target.childId];
        if (child?.state === "approved") deps.budget?.gate?.(child.id);
      }
      const children = parentChildren(deps.store, coordinatedParent);
      const terminalChild = children.find((child) => TERMINAL.includes(child.state));
      if (terminalChild) {
        await onChildTerminal(deps, { jobId: terminalChild.id, to: terminalChild.state });
      }
    }
  }
}

export async function recallAll({ memory, config = {}, registry }, { query, limit } = {}) {
  if (!memory || typeof memory.fanoutSearch !== "function") {
    throw new ClawError("SERVICE_UNAVAILABLE");
  }
  const visible = visibleProjects({ config, registry, scope: "general" });
  const allowed = new Map(visible.map((project) => [String(project.id), project]));
  const result = await memory.fanoutSearch(query, { limit });
  const hits = (result?.hits ?? []).flatMap((hit) => {
    const projectId = String(hit.projectId ?? hit.project?.id ?? "");
    const project = allowed.get(projectId);
    if (!project || hit.visibility === "restricted") return [];
    const snippet = String(hit.snippet ?? hit.text ?? "")
      .slice(0, 240)
      .replace(/```/g, "'''");
    return [{
      project: { id: project.id, name: project.name ?? project.id },
      recordRef: typeof (hit.recordRef ?? hit.id) === "string"
        ? (hit.recordRef ?? hit.id).slice(0, 160)
        : null,
      snippet: `\`\`\`\n${snippet}\n\`\`\``,
    }];
  });
  const errors = (result?.errors ?? []).filter((error) => allowed.has(String(error.projectId)))
    .map((error) => ({
      projectId: error.projectId,
      code: /^[A-Z][A-Z0-9_]{0,63}$/.test(String(error.code ?? ""))
        ? error.code
        : "MEMORY_SEARCH_FAILED",
    }));
  let message;
  if (!hits.length && errors.length) {
    message = `No matches returned; ${errors.length} project searches failed.`;
  } else if (!hits.length) {
    message = `No matches for "${query}".`;
  } else if (errors.length) {
    message = `${hits.length} matches returned; ${errors.length} project searches failed.`;
  } else {
    message = `${hits.length} matches returned.`;
  }
  return { hits, errors, total: hits.length, message };
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
