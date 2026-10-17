import { randomBytes } from "node:crypto";
import path from "node:path";
import { HOME_PLAN_RESOLVE_TOOL, QUORUM_MODES, ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { preparationFailure, prepareProducer } from "../jobs/c2-job-producer.mjs";
import { requestKey } from "../jobs/request-identity.mjs";
import { parsePlanResolveRequest, validatePlanResolution } from "../jobs/plan-resolution.mjs";

const QUORUMS = new Set(QUORUM_MODES);
const PENDING_TTL_MS = 10 * 60 * 1000;
const CALLBACK_ID_LENGTH = 10;
const SELECTION_STREAM = "plan-selections";

function readDependencies(context) {
  return context?.services ?? {};
}

function parseRunArgs(input) {
  if (typeof input?.argsText === "string") {
    const text = input.argsText.trim();
    const match = /^(.*?)(?:\s+)(auto|power|speed|false)$/i.exec(text);
    return {
      plan: (match ? match[1] : text).trim(),
      quorum: match ? match[2].toLowerCase() : "auto",
    };
  }
  const args = Array.isArray(input?.args) ? [...input.args] : [];
  const quorum = ["auto", "power", "speed", "false"].includes(args.at(-1)) ? args.pop() : "auto";
  return { plan: args.join(" "), quorum };
}

function selectionKeyboard({ id, candidates }) {
  return {
    inline_keyboard: candidates.map((candidate, index) => [{
      text: path.basename(candidate),
      callback_data: `s:${id}:${index}`,
    }]),
  };
}

async function homeResolution(mcp, request, signal) {
  if (!mcp || typeof mcp.call !== "function") throw new ClawError("SERVICE_UNAVAILABLE");
  signal?.throwIfAborted();
  const args = parsePlanResolveRequest(request);
  const result = await mcp.call(HOME_PLAN_RESOLVE_TOOL, args, { signal });
  signal?.throwIfAborted();
  return validatePlanResolution(result);
}

/** Revalidates a stored selection only through the authenticated configured project-home service. */
export async function validateSelectedPlan({ mcp, candidate, signal }) {
  try {
    const resolved = await homeResolution(mcp, { input: candidate, exact: true }, signal);
    return resolved.kind === "exact"
      ? { ok: true, relative: resolved.candidates[0] }
      : { ok: false, text: "The selected plan is no longer available." };
  } catch (error) {
    return { ok: false, text: `${error instanceof ClawError ? error.code : "PLAN_RESOLVE_FAILED"}: The selected plan could not be revalidated.` };
  }
}

/** Loads durable pending/accepted selection state, including after a response failure or restart. */
export function loadPlanSelection({ store, pending, id }) {
  const durable = store.fold(SELECTION_STREAM, (latest, record) => record.id === id ? record : latest, null);
  return durable ?? pending?.get?.(id) ?? null;
}

/** Records acceptance only after successful command preparation; failed dispatch stays selectable. */
export function completePlanSelection({ store, pending, selection, result }) {
  store.append(SELECTION_STREAM, { ...selection, used: true, result });
  pending?.delete?.(selection.id);
}

function selectionForRequest({ store, request, now }) {
  const key = requestKey(request);
  if (key === null) return null;
  const records = store.fold(SELECTION_STREAM, (latest, record) => {
    latest.set(record.id, record);
    return latest;
  }, new Map());
  return [...records.values()].find((selection) => requestKey(selection) === key
    && !selection.used && selection.expiresAt > now()) ?? null;
}

function prepareSelection({ deps, request, requestedPlan, quorum, candidates, caller }) {
  const { store, pending, now = Date.now } = deps;
  if (!pending || typeof pending.set !== "function") return preparationFailure("SERVICE_UNAVAILABLE: pending selections");
  let selection = selectionForRequest({ store, request, now });
  if (!selection) {
    const id = randomBytes(CALLBACK_ID_LENGTH).toString("hex");
    selection = {
      v: 1, ...request, id, callerRole: caller.role,
      updateId: request.updateId ?? `selection:${id}`,
      candidates, requestedPlan, quorum, expiresAt: now() + PENDING_TTL_MS, used: false,
    };
    store.append(SELECTION_STREAM, selection);
  }
  pending.set(selection.id, selection);
  return {
    ...preparationFailure(`More than one plan matches "${requestedPlan}". Choose one:`),
    keyboard: selectionKeyboard(selection),
  };
}

async function estimatePlan({ mcp, project, planPath }) {
  if (!mcp || typeof mcp.call !== "function") return preparationFailure("ESTIMATE_UNAVAILABLE: Could not estimate this plan; no job was created.");
  try {
    const estimate = await mcp.call("forge_estimate_quorum", { planPath, path: project.repo.path });
    if (!estimate || estimate.isError || estimate.ok === false) {
      return preparationFailure("ESTIMATE_UNAVAILABLE: Could not estimate this plan; no job was created.");
    }
    return { estimate };
  } catch {
    return preparationFailure("ESTIMATE_UNAVAILABLE: Could not estimate this plan; no job was created.");
  }
}

async function preparePlanFields({ deps, input, parsed, project, caller, request }) {
  const requestedPlan = parsed.plan;
  const quorum = QUORUMS.has(input.quorum) ? input.quorum : parsed.quorum;
  let resolved;
  try {
    resolved = await homeResolution(deps.mcp, {
      input: input.selectedPath ?? requestedPlan, exact: Boolean(input.selectedPath),
    }, input.signal);
  } catch (error) {
    return preparationFailure(`${error instanceof ClawError ? error.code : "PLAN_RESOLVE_FAILED"}: Project-home plan resolution is unavailable.`);
  }
  if (resolved.kind === "none") return preparationFailure(`No plan found matching "${requestedPlan}".`);
  if (resolved.truncated) return preparationFailure(resolved.message);
  if (resolved.kind === "multiple") return prepareSelection({
    deps, request, requestedPlan, quorum, candidates: resolved.candidates, caller,
  });
  const planPath = resolved.candidates[0];
  const estimate = await estimatePlan({ mcp: deps.mcp, project, planPath });
  if (!estimate.estimate) return estimate;
  return {
    fields: { planPath, description: planPath, quorum, estimate: estimate.estimate },
    suffix: `\nEstimate: ${JSON.stringify(estimate.estimate).slice(0, 1200)}`,
  };
}

export async function prepareRun(deps = {}, input = {}) {
  if (!deps.store || !deps.project?.id || !deps.project?.repo?.path) return preparationFailure("SERVICE_UNAVAILABLE: run");
  const parsed = parseRunArgs(input);
  if (!parsed.plan) return preparationFailure("Usage: /run <plan> [quorum]");
  return prepareProducer({ deps, input, type: "plan", label: "Plan" }, (authority) => preparePlanFields({
    deps, input, parsed, ...authority,
  }));
}

export default Object.freeze({
  name: "run", aliases: [], args: "<plan> [quorum]", summary: "Run a plan",
  details: "Execute a hardened plan for the current project.", examples: ["/run Phase-1-PLAN.md", "/run cleanup speed"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: true, sinceSlice: 9, group: "Work",
  async handle(context, input) {
    try {
      return await prepareRun({ ...readDependencies(context), project: context?.project }, input);
    } catch (error) {
      return preparationFailure(`${error instanceof ClawError ? error.code : "RUN_FAILED"}: The plan job was not created.`);
    }
  },
});
