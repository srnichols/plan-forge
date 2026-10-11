import { ROLES } from "../enums.mjs";
import { currentJobs } from "../jobs/model.mjs";
import { getCrossprojectDependencies, visibleProjects } from "../crossproject.mjs";

const MAX_JOBS = 20;

function parseFilters(args) {
  const filters = {};
  for (const raw of args ?? []) {
    const separator = raw.indexOf("=");
    if (separator > 0) filters[raw.slice(0, separator)] = raw.slice(separator + 1);
    else if (!filters.state) filters.state = raw;
  }
  return filters;
}

function visibleToCaller(job, caller) {
  return caller?.role === ROLES[0] || caller?.role === ROLES[1]
    || job.callerId === String(caller?.userId ?? "");
}

function jobsForScope(jobs, { filters, caller, project, config, registry }) {
  if (project && filters.project && String(filters.project) !== String(project.id)) {
    return { text: "JOBS_SCOPE_MISMATCH: Project filters cannot change this topic's scope." };
  }
  if (!Array.isArray(config?.projects) && typeof registry?.all !== "function") {
    return { text: "SERVICE_UNAVAILABLE: Project visibility unavailable." };
  }
  const projectIds = new Set(visibleProjects({
    config, registry, scope: project ? "project" : "general", projectId: project?.id,
  }).map(({ id }) => String(id)));
  const projectFilter = project?.id ?? filters.project;
  return { jobs: jobs.filter((job) =>
    projectIds.has(String(job.projectId))
    && visibleToCaller(job, caller)
    && (!filters.state || job.state === filters.state)
    && (!projectFilter || String(job.projectId) === String(projectFilter))) };
}

export function currentJobsText(store, { args = [], caller, project, config, registry } = {}) {
  if (!store) return { text: "SERVICE_UNAVAILABLE: jobs" };
  try {
    const filters = parseFilters(args);
    const scoped = jobsForScope(Object.values(currentJobs(store)), {
      filters, caller, project, config, registry,
    });
    if (scoped.text) return { text: scoped.text };
    const jobs = scoped.jobs;
    jobs.sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
    const total = jobs.length;
    const shown = jobs.slice(0, MAX_JOBS);
    if (shown.length === 0) return { text: "No jobs match the requested filters." };
    const lines = shown.map((job) =>
      `${job.id}  ${job.state}  ${job.type}  ${job.projectId}${job.description ? ` — ${job.description}` : ""}`);
    if (total > shown.length) lines.push(`+${total - shown.length} more`);
    return { text: lines.join("\n") };
  } catch {
    return { text: "JOBS_UNAVAILABLE: Could not read the job list." };
  }
}

export default Object.freeze({
  name: "jobs", aliases: [], args: "[filter]", summary: "List recent jobs",
  details: "List jobs visible to this dispatcher.", examples: ["/jobs", "/jobs running"],
  roles: [ROLES[0], ROLES[1]], scope: "both", mutating: false,
  available: true, sinceSlice: 9, group: "Status & budget",
  async handle(context, input = {}) {
    const services = { ...(getCrossprojectDependencies() ?? {}), ...(context?.services ?? {}) };
    return currentJobsText(services.store, {
      ...input,
      caller: input.caller,
      project: context?.project,
      config: services.config,
      registry: services.registry,
    });
  },
});
