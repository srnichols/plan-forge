import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { createJob, JOBS_STREAM, transition } from "../jobs/model.mjs";
import { resolvePlan } from "../jobs/runners.mjs";
import { isInside } from "../jobs/worktree.mjs";

const QUORUMS = new Set(["auto", "power", "speed", "false"]);
const PENDING_TTL_MS = 10 * 60 * 1000;
const CALLBACK_ID_LENGTH = 10;

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

function persistAwaitingJob({ store, project, caller, chatId, threadId, fields }) {
  const created = createJob({
    id: randomBytes(12).toString("hex"),
    type: "plan",
    projectId: project.id,
  });
  const job = {
    ...created.job,
    ...fields,
    callerId: String(caller?.userId ?? ""),
    createdAt: new Date().toISOString(),
    chatId: chatId ?? null,
    threadId: threadId ?? null,
  };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  const awaiting = transition(job, "awaiting-approval");
  store.append(JOBS_STREAM, awaiting.event);
  return awaiting.job;
}

function selectionKeyboard({ id, candidates }) {
  return {
    inline_keyboard: candidates.map((candidate, index) => [{
      text: path.basename(candidate),
      callback_data: `s:${id}:${index}`,
    }]),
  };
}

async function resolveSelectedPlan(root, selectedPath) {
  const absolute = path.resolve(root, selectedPath);
  const relative = path.relative(path.resolve(root), absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !(await isInside(root, absolute))) return null;
  try {
    return (await stat(absolute)).isFile() ? relative : null;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

export async function prepareRun(deps, input = {}) {
  const { store, mcp, project, pending } = deps ?? {};
  const { caller, chatId, threadId } = input;
  if (!store || !project?.id || !project?.repo?.path) return { text: "SERVICE_UNAVAILABLE: run" };
  const parsed = parseRunArgs(input);
  if (!parsed.plan) return { text: "Usage: /run <plan> [quorum]" };
  const requestedPlan = parsed.plan;
  const quorum = QUORUMS.has(parsed.quorum) ? parsed.quorum : "auto";
  let resolved;
  if (input.selectedPath) {
    const selected = await resolveSelectedPlan(project.repo.path, input.selectedPath);
    resolved = selected ? { kind: "exact", candidates: [selected] } : { kind: "none", candidates: [] };
  } else {
    resolved = await resolvePlan({ root: project.repo.path, input: requestedPlan });
  }
  if (resolved.kind === "none") return { text: `No plan found matching "${requestedPlan}".` };
  if (resolved.kind === "multiple") {
    if (!pending || typeof pending.set !== "function") {
      return { text: "SERVICE_UNAVAILABLE: pending selections" };
    }
    const id = randomBytes(CALLBACK_ID_LENGTH).toString("hex");
    pending.set(id, {
      callerId: String(caller?.userId ?? ""),
      projectId: project.id,
      chatId: chatId ?? null,
      threadId: threadId ?? null,
      candidates: resolved.candidates,
      expiresAt: Date.now() + PENDING_TTL_MS,
    });
    return {
      text: `More than one plan matches "${requestedPlan}". Choose one:`,
      keyboard: selectionKeyboard({ id, candidates: resolved.candidates }),
    };
  }

  const planPath = resolved.candidates[0];
  let estimate = null;
  if (mcp) {
    try {
      estimate = await mcp.call("forge_estimate_quorum", {
        planPath,
        path: project.repo.path,
      });
      if (estimate?.isError || estimate?.ok === false) {
        return { text: "ESTIMATE_UNAVAILABLE: Could not estimate this plan; no job was created." };
      }
    } catch {
      return { text: "ESTIMATE_UNAVAILABLE: Could not estimate this plan; no job was created." };
    }
  }
  const job = persistAwaitingJob({
    store,
    project,
    caller,
    chatId,
    threadId,
    fields: { planPath, description: planPath, quorum, estimate },
  });
  const estimateText = estimate ? `\nEstimate: ${JSON.stringify(estimate).slice(0, 1200)}` : "";
  return { text: `Plan job ${job.id} is awaiting approval.${estimateText}` };
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
      return { text: `${error instanceof ClawError ? error.code : "RUN_FAILED"}: The plan job was not created.` };
    }
  },
});
