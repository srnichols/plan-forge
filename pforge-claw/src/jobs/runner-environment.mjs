import { ClawError } from "../errors.mjs";
import { byokProviderReference } from "../runtime/byok.mjs";
import { normalizeRuntimeId, resolveRuntimeId } from "../runtime/agent-runtime.mjs";

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AUTH_ENVIRONMENTS = Object.freeze([
  { secret: "PFORGE_CLAW_COPILOT_TOKEN", names: ["COPILOT_GITHUB_TOKEN"] },
  { secret: "PFORGE_CLAW_GH_TOKEN", names: ["GH_TOKEN", "GITHUB_TOKEN"] },
]);

function secretValue(name, env, secrets) {
  const value = env[name] ?? secrets?.get?.(name);
  return typeof value === "string" && value ? value : null;
}

function requireSecret({ name, env, secrets, code }) {
  if (typeof name !== "string" || !ENVIRONMENT_NAME.test(name)) {
    throw new ClawError("BOOTSTRAP_ENV_INVALID");
  }
  const value = secretValue(name, env, secrets);
  if (value === null) throw new ClawError(code);
  env[name] = value;
}

function addAuthentication(env, secrets) {
  for (const reference of AUTH_ENVIRONMENTS) {
    const value = secretValue(reference.secret, env, secrets);
    if (value === null) continue;
    for (const name of reference.names) env[name] = value;
  }
}

function providerReference(job, project, config) {
  if (job?.provider !== undefined) return job.provider;
  const lane = config.lanes?.find((entry) => entry.id === job?.lane);
  const runtime = job?.runtime !== undefined
    ? normalizeRuntimeId(job.runtime) : resolveRuntimeId({ config, project, lane });
  return byokProviderReference({ type: runtime, config });
}

/**
 * Resolve only this executing job's references into a detached child environment.
 * @param {{job?: object, project?: object, config?: object, secrets?: object, env?: object, signal?: AbortSignal}} options
 * @returns {object} In-memory environment; never a lease, state, or log payload.
 */
export function prepareJobEnvironment({
  job, project, config = {}, secrets, env = process.env, signal,
} = {}) {
  signal?.throwIfAborted();
  const prepared = { ...env };
  const names = project?.bootstrap?.env ?? config.bootstrap?.env ?? [];
  if (!Array.isArray(names)) throw new ClawError("BOOTSTRAP_ENV_INVALID");
  for (const name of names) {
    requireSecret({ name, env: prepared, secrets, code: "BOOTSTRAP_SECRET_MISSING" });
  }
  const provider = providerReference(job, project, config);
  if (provider) {
    requireSecret({ name: provider.keySecret, env: prepared, secrets, code: "BYOK_KEY_MISSING" });
  }
  addAuthentication(prepared, secrets);
  signal?.throwIfAborted();
  return prepared;
}
