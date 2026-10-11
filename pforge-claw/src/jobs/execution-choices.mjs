import { ClawError } from "../errors.mjs";
import { QUORUM_MODES } from "../enums.mjs";
import { DEFAULT_COPY_PATHS, validateCopyEntry } from "./bootstrap.mjs";
import { normalizeRuntimeId } from "../runtime/agent-runtime.mjs";

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MODEL_FIELDS = Object.freeze(["chat", "work"]);

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeDeep(child, seen);
  return Object.freeze(value);
}

/** Detaches execution inputs before asynchronous dispatch or worker handoff. */
export function snapshotExecutionChoices(value) {
  return freezeDeep(structuredClone(value));
}

/** Approved plan choices are never silently replaced with defaults. */
export function planExecutionChoices(job) {
  const choices = {};
  if (job.quorum !== undefined) {
    if (!QUORUM_MODES.includes(job.quorum)) throw new ClawError("APPROVAL_QUORUM_INVALID");
    choices.quorum = job.quorum;
  }
  if (job.resumeFrom !== undefined) {
    if (!Number.isSafeInteger(job.resumeFrom) || job.resumeFrom < 1) throw new ClawError("PLAN_RESUME_INVALID");
    choices.resumeFrom = job.resumeFrom;
  }
  return choices;
}

function projectModels(models) {
  if (models === undefined) return undefined;
  if (!models || typeof models !== "object" || Array.isArray(models)) throw new ClawError("MODEL_MISSING");
  const selected = {};
  for (const field of MODEL_FIELDS) {
    if (models[field] === undefined) continue;
    if (typeof models[field] !== "string" || !models[field].trim()) throw new ClawError("MODEL_MISSING");
    selected[field] = models[field];
  }
  return selected;
}

function bootstrapNames(env) {
  if (!Array.isArray(env) || env.some((name) => typeof name !== "string" || !SECRET_NAME.test(name))) {
    throw new ClawError("BOOTSTRAP_ENV_INVALID");
  }
  return [...env];
}

function bootstrapChoices({ config, project, lane }) {
  const copy = project.bootstrap?.copy ?? config?.bootstrap?.copy ?? DEFAULT_COPY_PATHS;
  if (!Array.isArray(copy)) throw new ClawError("BOOTSTRAP_COPY_INVALID");
  return {
    copy: copy.map(validateCopyEntry),
    env: bootstrapNames(project.bootstrap?.env ?? config?.bootstrap?.env ?? []),
    install: project.bootstrap?.install ?? (lane?.kind === "k8s" ? "ci" : config?.bootstrap?.install ?? "none"),
  };
}

/**
 * Signed project metadata has no host paths, channel identities, or secret values.
 * Workers retain their own checkout path while using the dispatcher's execution choices.
 */
export function projectExecutionChoices({ config, project, lane }) {
  if (!project?.id || !project.repo) throw new ClawError("PROJECT_NOT_FOUND");
  const models = projectModels(project.models);
  return {
    id: project.id,
    repo: {
      url: project.repo.url ?? project.repo.remote,
      defaultBranch: project.repo.defaultBranch ?? project.repo.baseBranch,
    },
    ...(models !== undefined ? { models } : {}),
    bootstrap: bootstrapChoices({ config, project, lane }),
  };
}

function providerChoices(job) {
  const reference = job.provider;
  if (!reference || reference.type !== normalizeRuntimeId(job.runtime)
    || typeof reference.keySecret !== "string" || !SECRET_NAME.test(reference.keySecret)
    || Object.hasOwn(reference, "apiKey")) throw new ClawError("RUNTIME_BAD_CONTRACT");
  if (reference.endpoint !== undefined && (typeof reference.endpoint !== "string" || !reference.endpoint.trim())) {
    throw new ClawError("RUNTIME_BAD_CONTRACT");
  }
  return {
    keySecret: reference.keySecret,
    ...(reference.endpoint !== undefined ? { endpoint: reference.endpoint } : {}),
  };
}

function scopedProject(current, approved) {
  if (!approved) return current;
  if (approved.id !== current.id) throw new ClawError("RUNTIME_BAD_CONTRACT");
  const models = projectModels(approved.models);
  const repo = { ...current.repo };
  if (approved.repo?.url !== undefined) repo.remote = approved.repo.url;
  if (approved.repo?.defaultBranch !== undefined) repo.baseBranch = approved.repo.defaultBranch;
  return {
    ...current,
    repo,
    ...(models !== undefined ? { models } : {}),
    ...(approved.bootstrap ? { bootstrap: bootstrapChoices({ config: {}, project: approved }) } : {}),
  };
}

/** Call only after grant verification for leased jobs; unsigned jobs use local config. */
export function executionConfigFor({ job, config }) {
  if (!job.leaseGrant) return snapshotExecutionChoices(config);
  planExecutionChoices(job);
  const current = config?.projects?.find((entry) => entry.id === job.projectId);
  if (!current) throw new ClawError("PROJECT_NOT_FOUND");
  const project = scopedProject(current, job.project);
  const runtimes = { ...config.runtimes };
  if (job.provider !== undefined) {
    runtimes.byok = { ...runtimes.byok, [job.provider.type]: providerChoices(job) };
  }
  return snapshotExecutionChoices({
    ...config,
    runtimes,
    projects: config.projects.map((entry) => entry.id === project.id ? project : entry),
    ...(project.bootstrap ? { bootstrap: project.bootstrap } : {}),
  });
}
