import { ROLES } from "../enums.mjs";
import { currentJobs } from "../jobs/model.mjs";

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

export function currentJobsText(store, { args = [], caller, project } = {}) {
  if (!store) return { text: "SERVICE_UNAVAILABLE: jobs" };
  try {
    const filters = parseFilters(args);
    let jobs = Object.values(currentJobs(store)).filter((job) => visibleToCaller(job, caller));
    if (filters.state) jobs = jobs.filter((job) => job.state === filters.state);
    const projectFilter = filters.project ?? project?.id;
    if (projectFilter) jobs = jobs.filter((job) => job.projectId === projectFilter);
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
    return currentJobsText(context?.services?.store, {
      ...input,
      caller: input.caller,
      project: context?.project,
    });
  },
});
