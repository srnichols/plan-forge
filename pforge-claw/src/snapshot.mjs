import { JOBS_STREAM, reduceJobs } from "./jobs/model.mjs";

const MAX_SNAPSHOT_BYTES = 4096;
const SENSITIVE_KEY = /secret|token|message|content|api.?key|credential/i;

function projectRecord(record, projectId) {
  if (!record || typeof record !== "object") return false;
  const id = record.projectId ?? record.project?.id ?? record.project ?? record.job?.projectId;
  return id !== undefined && id !== null && String(id) === String(projectId);
}

function readRecords(store, stream, project) {
  if (typeof store?.read !== "function") return { available: false, records: [] };
  const records = [...store.read(stream)].map(({ record }) => record).filter((record) => {
    if (!project) return true;
    if (projectRecord(record, project?.id)) return true;
    if (stream !== "sessions" || !project?.channel) return false;
    return String(record.chatId ?? "") === String(project.channel.chatId ?? "")
      && String(record.topicId ?? "") === String(project.channel.topicId ?? "");
  });
  return { available: records.length > 0, records };
}

function safeValue(value, redact, seen = new WeakSet()) {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => safeValue(item, redact, seen));
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, child]) => [key, safeValue(child, redact, seen)]));
}

function countSessions(records) {
  const latest = new Map();
  for (const record of records) {
    if (typeof record.chatId !== "string") continue;
    const key = `${record.chatId}:${record.topicId ?? 0}`;
    latest.set(key, record.sessionId ?? null);
  }
  return [...latest.values()].filter(Boolean).length;
}

function spendForToday(records) {
  const today = new Date().toISOString().slice(0, 10);
  const todayRecords = records.filter((record) => String(record.ts ?? "").startsWith(today));
  if (todayRecords.length === 0) return null;
  const costs = todayRecords.map(({ usage }) => usage?.costUsd ?? usage?.usd ?? usage?.cost)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  return costs.length === 0 ? null : costs.reduce((total, amount) => total + amount, 0);
}

function trimSnapshot(snapshot) {
  while (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_SNAPSHOT_BYTES) {
    const features = snapshot.data.features ?? {};
    const largestFeature = Object.entries(features)
      .sort((left, right) => JSON.stringify(right[1]).length - JSON.stringify(left[1]).length)[0];
    if (largestFeature) {
      delete features[largestFeature[0]];
      snapshot.truncated = true;
      continue;
    }
    const arrays = [];
    function collectArrays(value) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) arrays.push(value);
      else Object.values(value).forEach(collectArrays);
    }
    collectArrays(snapshot.data);
    const largest = arrays.sort((left, right) => right.length - left.length)[0];
    if (largest?.length) {
      largest.pop();
      snapshot.truncated = true;
      continue;
    }
    snapshot.data = { sessions: { available: false }, queue: { available: false }, approvals: { available: false }, spendToday: null };
    snapshot.project = { id: snapshot.project?.id ?? null };
    snapshot.truncated = true;
    break;
  }
  return snapshot;
}

export function buildClawSnapshot(ctx, { project, features = ctx?.features ?? [] } = {}) {
  const store = ctx?.store;
  const redact = ctx?.secrets?.redact ?? ((value) => value);
  const projectId = project?.id;
  const sessions = readRecords(store, "sessions", project);
  const jobEvents = readRecords(store, JOBS_STREAM, null);
  const approvals = readRecords(store, "approvals", project);
  const budget = readRecords(store, "budget", project);
  const jobs = jobEvents.available
    ? Object.values(jobEvents.records.reduce(reduceJobs, {}))
      .filter((job) => String(job.projectId) === String(projectId))
    : [];
  const data = {
    sessions: sessions.available ? { available: true, count: countSessions(sessions.records) } : { available: false },
    queue: jobEvents.available
      ? {
        available: true,
        queued: jobs.filter((job) => job.state === "queued").length,
        held: jobs.filter((job) => job.state === "held-budget").length,
      }
      : { available: false },
    approvals: approvals.available
      ? { available: true, pending: approvals.records.filter((record) => record.state === "pending" || record.status === "pending").length }
      : jobEvents.available
        ? { available: true, pending: jobs.filter((job) => job.state === "awaiting-approval").length }
        : { available: false },
    spendToday: budget.available ? spendForToday(budget.records) : null,
    features: {},
  };
  for (const feature of features) {
    if (!feature?.available || typeof feature.snapshot !== "function") continue;
    try {
      const result = feature.snapshot(ctx, { project });
      if (result !== null && result !== undefined) data.features[feature.name] = safeValue(result, redact);
    } catch {
      data.features[feature.name] = { available: false };
    }
  }
  return trimSnapshot({
    kind: "pforge-claw-state",
    v: 1,
    project: project ? {
      id: redact(String(project.id)),
      name: redact(String(project.displayName ?? project.name ?? project.id)),
      visibility: project.visibility ?? "normal",
    } : null,
    data,
    truncated: false,
  });
}
