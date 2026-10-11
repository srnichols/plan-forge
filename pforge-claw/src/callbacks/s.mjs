import { ClawError } from "../errors.mjs";
import { ROLES } from "../enums.mjs";
import runCommand, { completePlanSelection, loadPlanSelection, validateSelectedPlan } from "../commands/run.mjs";
import { authorizeCommand, createCommandContext, readCurrentConfig } from "../handlers/c2-command-context.mjs";
import { preparationFailure } from "../jobs/c2-job-producer.mjs";
import { requestIdentity, withRequestIdentity } from "../jobs/request-identity.mjs";

function idMatches(selection, { caller, chatId, threadId, project }) {
  return selection.callerId === String(caller?.userId ?? "")
    && selection.projectId === project?.id
    && String(selection.chatId ?? "") === String(chatId ?? "")
    && String(selection.threadId ?? "") === String(threadId ?? "");
}

function parseSelection(payload) {
  const separator = typeof payload === "string" ? payload.lastIndexOf(":") : -1;
  if (separator < 1 || !/^(0|[1-9]\d*)$/.test(payload.slice(separator + 1))) return null;
  return { id: payload.slice(0, separator), index: Number(payload.slice(separator + 1)) };
}

function validSelection(selection, { parsed, input, project, now }) {
  return selection && Array.isArray(selection.candidates) && parsed.index < selection.candidates.length
    && idMatches(selection, { ...input, project })
    && Number.isFinite(selection.expiresAt) && selection.expiresAt > now();
}

async function dispatchSelection({ deps, input, parsed, command, context, caller }) {
  const selection = loadPlanSelection({ ...deps, id: parsed.id });
  if (!validSelection(selection, { parsed, input, project: context.project, now: deps.now ?? Date.now })) {
    return preparationFailure("This plan selection has expired or is not available to you.");
  }
  if (selection.used) return selection.result ?? preparationFailure("This plan selection was already used.");
  const candidate = selection.candidates[parsed.index];
  const checked = await validateSelectedPlan({ mcp: context.mcp ?? context.services.mcp, candidate, signal: input.signal });
  if (!checked.ok) return preparationFailure(checked.text);
  const result = await command.handle(context, {
    ...input, caller, project: context.project, args: [checked.relative], argsText: checked.relative,
    selectedPath: checked.relative, quorum: selection.quorum ?? "auto",
    adapter: selection.adapter ?? input.adapter,
    updateId: selection.updateId ?? `selection:${parsed.id}`,
  });
  if (result?.jobId) completePlanSelection({ ...deps, selection: { ...selection, id: parsed.id }, result });
  return result;
}

export async function selectPlan(deps = {}, input = {}) {
  if (!deps.store) return preparationFailure("SERVICE_UNAVAILABLE: plan selection");
  const parsed = parseSelection(input.payload);
  if (!parsed) return preparationFailure("This plan selection is invalid.");
  const selection = loadPlanSelection({ ...deps, id: parsed.id });
  if (!selection) return preparationFailure("This plan selection has expired or is not available to you.");
  if (!idMatches(selection, { ...input, project: { id: selection.projectId } })) {
    return preparationFailure("This plan selection has expired or is not available to you.");
  }
  const config = readCurrentConfig(deps);
  if (!config) return preparationFailure("SERVICE_UNAVAILABLE: plan selection");
  const route = { chatId: input.chatId, threadId: input.threadId, projectId: selection.projectId };
  const context = deps.contextFor?.(route) ?? createCommandContext({
    config, registry: deps.getRegistry?.() ?? deps.registry, services: deps, ...route,
  });
  const command = deps.commands ? deps.commands.find((candidate) => candidate.name === "run") : runCommand;
  const decision = authorizeCommand({ config, command, caller: input.caller, context });
  if (!decision.ok) return preparationFailure(decision.text);
  context.project = decision.project;
  const identity = requestIdentity({
    adapter: input.adapter, updateId: `selection:${parsed.id}`, type: "selection",
    projectId: context.project.id, callerId: decision.caller.userId, chatId: input.chatId, threadId: input.threadId,
  });
  return withRequestIdentity({ identity }, () => dispatchSelection({
    deps: { ...context.services, project: context.project }, input, parsed, command, context, caller: decision.caller,
  }));
}

export default Object.freeze({
  prefix: "s",
  sinceSlice: 9,
  available: true,
  roles: [ROLES[0], ROLES[1]],
  async handle(context, input) {
    try {
      return await selectPlan({ ...context?.services, project: context?.project }, input);
    } catch (error) {
      return preparationFailure(`${error instanceof ClawError ? error.code : "SELECTION_FAILED"}: The plan was not selected.`);
    }
  },
});
