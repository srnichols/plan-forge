import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadConfig, resolveHome, requiredSecretNames } from "../config.mjs";
import { ClawError } from "../errors.mjs";
import { reduceJobs } from "../jobs/model.mjs";
import { createSecrets } from "../secrets.mjs";

const USAGE = "Usage: pforge claw status [--home <dir>] [--project <id>] [--json]";
const MAX_ITEMS = 15;
const MAX_LABEL_LENGTH = 100;
const QUEUE_STATES = Object.freeze(["queued", "awaiting-approval", "held-budget", "running"]);

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) throw new ClawError("STATUS_STATE_CORRUPT");
    throw error;
  }
}

async function readJsonl(file) {
  let contents;
  try {
    contents = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const complete = contents.toString("utf8").split("\n");
  complete.pop();
  return complete.filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new ClawError("STATUS_STATE_CORRUPT");
    }
  });
}

function countJobs(jobs, projects) {
  const counts = Object.fromEntries(projects.map(({ id }) => [String(id), {
    queued: 0, "awaiting-approval": 0, "held-budget": 0, running: 0,
  }]));
  for (const job of Object.values(jobs)) {
    const row = counts[String(job.projectId)];
    if (row && QUEUE_STATES.includes(job.state)) row[job.state] += 1;
  }
  return counts;
}

function boundedLabel(value) {
  const text = String(value ?? "unknown");
  return text.length <= MAX_LABEL_LENGTH
    ? text
    : `${text.slice(0, MAX_LABEL_LENGTH - 1)}…`;
}

function successfulDigest(state, schedules) {
  const ids = new Set((Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => schedule?.kind === "digest").map(({ id }) => id));
  const latest = Object.entries(state?.schedules ?? {})
    .filter(([id, entry]) => ids.has(id) && entry?.status === "done"
      && typeof entry.lastRunAt === "string" && Number.isFinite(Date.parse(entry.lastRunAt)))
    .map(([, entry]) => entry.lastRunAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return latest ?? "no digest has run yet";
}

function laneStateMap(value) {
  if (Array.isArray(value)) return new Map(value.map((lane) => [String(lane.id), lane]));
  if (value?.lanes && typeof value.lanes === "object") return new Map(Object.entries(value.lanes));
  return value && typeof value === "object" ? new Map(Object.entries(value)) : new Map();
}

async function laneHealth({ lanes, statePath, lanesState }) {
  const byId = laneStateMap(lanesState);
  const lockPath = path.join(statePath, "dispatcher.lock");
  let lock = null;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  return lanes.slice(0, MAX_ITEMS).map((lane) => describeLane({
    lane, current: byId.get(String(lane.id)), lock,
  }));
}

function describeLane({ lane, current, lock }) {
  const id = boundedLabel(lane.id);
  if (isLaneDisabled(lane, current)) return { id, kind: lane.kind, state: "disabled" };
  if (lane.kind === "local") return localLaneStatus({ id, lane, lock });
  if (lane.kind === "remote" || lane.kind === "k8s") return remoteLaneStatus({ id, lane, current });
  return { id, kind: lane.kind, state: "unknown" };
}

function isLaneDisabled(lane, current) {
  return lane.enabled === false || current?.enabled === false || current?.on === false;
}

function localLaneStatus({ id, lane, lock }) {
  return {
    id,
    kind: lane.kind,
    state: lock ? "running" : "stopped",
    ...(Number.isInteger(lock?.pid) ? { pid: lock.pid } : {}),
  };
}

function remoteLaneStatus({ id, lane, current }) {
  return {
    id,
    kind: lane.kind,
    state: current?.enabled === true || current?.on === true ? "on" : "unknown",
    heartbeat: boundedLabel(current?.lastHeartbeat ?? current?.heartbeatAt ?? current?.lastSeen),
  };
}

async function pollerStatus({ config, statePath }) {
  if (config.channels?.telegram?.mode === "webhook") {
    const ready = await readJson(path.join(statePath, ".readyz"), null);
    return `/readyz ${ready?.ready === true ? "ready" : "unknown"}`;
  }
  const updates = await readJsonl(path.join(statePath, "updates.jsonl"));
  const latest = updates.at(-1);
  if (latest?.ts) return `${boundedLabel(latest.ts)} (approximate (offline))`;
  try {
    const offsets = await stat(path.join(statePath, "offsets.json"));
    return `${new Date(offsets.mtimeMs).toISOString()} (approximate (offline))`;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return "unknown (approximate (offline))";
  }
}

/**
 * Read dispatcher state without constructing the store, creating directories,
 * or acquiring the dispatcher lock.
 * @param {{home?:string,config?:object,env?:NodeJS.ProcessEnv,project?:string}} options
 * @returns {Promise<object>}
 */
export async function collectStatus({
  home = resolveHome(), config, env = process.env, project,
} = {}) {
  const loaded = config ? { ok: true, config } : await loadConfig({ home });
  const currentConfig = loaded.config ?? {};
  const secrets = await createSecrets({
    env,
    file: path.join(home, "secrets.json"),
    trackNames: requiredSecretNames(currentConfig),
  });
  const statePath = path.join(home, "state");
  const projects = selectProjects({ config: currentConfig, project });
  const events = await readJsonl(path.join(statePath, "jobs.jsonl"));
  const jobs = events.reduce(reduceJobs, {});
  const counts = countJobs(jobs, projects);
  const schedulesState = await readJson(path.join(statePath, "schedules.json"), null);
  const lanesState = await readJson(path.join(statePath, "lanes.json"), null);
  const configuredLanes = Array.isArray(currentConfig.lanes)
    ? currentConfig.lanes.filter((lane) => lane && typeof lane === "object")
    : [];
  const [pollerLag, lanes] = await Promise.all([
    pollerStatus({ config: currentConfig, statePath }),
    laneHealth({ lanes: configuredLanes, statePath, lanesState }),
  ]);
  const report = buildStatusReport({
    loaded, currentConfig, projects, counts, schedulesState, pollerLag, lanes, configuredLanes,
  });
  return JSON.parse(secrets.redact(JSON.stringify(report)));
}

function selectProjects({ config, project }) {
  const configured = Array.isArray(config.projects) ? config.projects : [];
  const selected = configured.filter((entry) => entry && typeof entry === "object"
    && (project === undefined || String(entry.id) === String(project)));
  if (project !== undefined && selected.length === 0) throw new ClawError("STATUS_PROJECT_UNKNOWN");
  return selected;
}

function buildStatusReport({
  loaded, currentConfig, projects, counts, schedulesState, pollerLag, lanes, configuredLanes,
}) {
  return {
    ok: loaded.ok === true,
    ...(loaded.ok ? {} : { config: loaded.errors?.[0]?.code ?? "CONFIG_INVALID" }),
    projects: Object.fromEntries(projects.slice(0, MAX_ITEMS).map((entry) => [
      boundedLabel(entry.id),
      { name: boundedLabel(entry.displayName ?? entry.name ?? entry.id), counts: counts[String(entry.id)] },
    ])),
    ...(projects.length > MAX_ITEMS ? { projectsTruncated: true } : {}),
    lastDigest: boundedLabel(successfulDigest(schedulesState, currentConfig.schedules)),
    pollerLag: boundedLabel(pollerLag),
    lanes,
    ...(configuredLanes.length > MAX_ITEMS ? { lanesTruncated: true } : {}),
  };
}

function formatProjectLine(id, project) {
  const counts = project.counts;
  return `  ${project.name} (${id}): queued ${counts.queued}, awaiting-approval ${counts["awaiting-approval"]}, held-budget ${counts["held-budget"]}, running ${counts.running}`;
}

function formatLaneLine(lane) {
  const heartbeat = lane.heartbeat ? `, heartbeat ${lane.heartbeat}` : "";
  const pid = lane.pid ? `, pid ${lane.pid}` : "";
  return `  ${lane.id}: ${lane.state}${heartbeat}${pid}`;
}

/**
 * Render a bounded human-readable status report.
 * @param {object} report
 * @returns {string}
 */
export function formatStatus(report) {
  const projectEntries = Object.entries(report.projects ?? {});
  const laneEntries = report.lanes ?? [];
  const lines = [
    `Configuration: ${report.ok ? "loaded" : report.config}`,
    `Last digest: ${report.lastDigest}`,
    `Poller lag: ${report.pollerLag}`,
    "Queue depth:",
    ...(projectEntries.length ? projectEntries.map(([id, project]) => formatProjectLine(id, project)) : ["  empty"]),
    ...(report.projectsTruncated ? ["  additional projects omitted"] : []),
    "Lanes:",
    ...(laneEntries.length ? laneEntries.map(formatLaneLine) : ["  empty"]),
    ...(report.lanesTruncated ? ["  additional lanes omitted"] : []),
  ];
  return lines.join("\n");
}

async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        home: { type: "string" }, project: { type: "string" }, json: { type: "boolean" },
      },
    });
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  try {
    const report = await collectStatus({
      ...(parsed.values.home ? { home: parsed.values.home } : {}),
      ...(parsed.values.project ? { project: parsed.values.project } : {}),
    });
    process.stdout.write(`${parsed.values.json ? JSON.stringify(report) : formatStatus(report)}\n`);
    return report.ok ? 0 : 1;
  } catch (error) {
    const failure = error instanceof ClawError ? error : new ClawError("STATUS_UNAVAILABLE");
    process.stderr.write(`${failure.code}\n`);
    return failure.code === "STATUS_PROJECT_UNKNOWN" ? 2 : 1;
  }
}

export default {
  name: "status",
  summary: "Show dispatcher, queue, and lane status",
  usage: USAGE,
  run,
};
