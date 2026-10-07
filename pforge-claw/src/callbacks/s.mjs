import { stat } from "node:fs/promises";
import path from "node:path";
import { ClawError } from "../errors.mjs";
import { prepareRun } from "../commands/run.mjs";
import { isInside } from "../jobs/worktree.mjs";

function idMatches(selection, { caller, chatId, threadId, project }) {
  return selection.callerId === String(caller?.userId ?? "")
    && selection.projectId === project?.id
    && String(selection.chatId ?? "") === String(chatId ?? "")
    && String(selection.threadId ?? "") === String(threadId ?? "");
}

export async function selectPlan(deps, input = {}) {
  const { pending, store, mcp, project } = deps ?? {};
  const { payload, caller, chatId, threadId } = input;
  if (!pending || typeof pending.get !== "function" || !store || !project?.repo?.path) {
    return { text: "SERVICE_UNAVAILABLE: plan selection" };
  }
  const separator = typeof payload === "string" ? payload.lastIndexOf(":") : -1;
  if (separator < 1) return { text: "This plan selection is invalid." };
  const id = payload.slice(0, separator);
  const index = Number(payload.slice(separator + 1));
  const selection = pending.get(id);
  if (!selection || !Number.isInteger(index) || index < 0
    || !Array.isArray(selection.candidates) || index >= selection.candidates.length
    || !idMatches(selection, { caller, chatId, threadId, project })
    || !Number.isFinite(selection.expiresAt) || Date.now() > selection.expiresAt) {
    return { text: "This plan selection has expired or is not available to you." };
  }
  const candidate = selection.candidates[index];
  if (typeof candidate !== "string" || !candidate) return { text: "This plan selection is invalid." };
  const absolute = path.resolve(project.repo.path, candidate);
  const relative = path.relative(path.resolve(project.repo.path), absolute);
  let contained = false;
  try {
    contained = await isInside(project.repo.path, absolute);
  } catch {
    return { text: "The selected plan could not be revalidated." };
  }
  if (relative.startsWith("..") || path.isAbsolute(relative) || !contained) {
    return { text: "This plan selection is invalid." };
  }
  try {
    if (!(await stat(absolute)).isFile()) return { text: "The selected path is not a plan file." };
  } catch (error) {
    if (error.code !== "ENOENT") return { text: "The selected plan could not be revalidated." };
    return { text: "The selected plan is no longer available." };
  }
  pending.delete?.(id);
  return prepareRun({ store, mcp, project, pending }, {
    args: [candidate],
    selectedPath: candidate,
    caller,
    chatId,
    threadId,
  });
}

export default Object.freeze({
  prefix: "s",
  sinceSlice: 9,
  available: true,
  async handle(context, input) {
    try {
      return await selectPlan({ ...context?.services, project: context?.project }, input);
    } catch (error) {
      return { text: `${error instanceof ClawError ? error.code : "SELECTION_FAILED"}: The plan was not selected.` };
    }
  },
});
