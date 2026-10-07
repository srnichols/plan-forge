import { randomBytes } from "node:crypto";
import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { createJob, JOBS_STREAM, transition } from "../jobs/model.mjs";

function parseMetadataResult(result) {
  if (Array.isArray(result?.content)) {
    const text = result.content.find((entry) => entry?.type === "text")?.text;
    if (typeof text === "string") {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
  }
  return result?.data ?? result?.capabilities ?? result;
}

async function skillMetadata(mcp, name, project) {
  if (!mcp) throw new ClawError("SERVICE_UNAVAILABLE", { service: "mcp" });
  const result = typeof mcp.skillMetadata === "function"
    ? await mcp.skillMetadata({ name, project })
    : await mcp.call("forge_run_skill", {
      skill: name,
      dryRun: true,
      path: project.repo.path,
    });
  if (result?.isError) throw new ClawError("SKILL_METADATA_FAILED");
  const metadata = parseMetadataResult(result);
  if (metadata?.status === "dry-run" && metadata.skillName === name) {
    return { ...metadata, name: metadata.skillName };
  }
  const skills = Array.isArray(metadata) ? metadata : metadata?.skills ?? [];
  return skills.find((skill) => skill?.name === name) ?? null;
}

export async function prepareSkill({ store, mcp, project, caller, chatId, threadId } = {}, { args = [] } = {}) {
  if (!store || !project?.id || !project?.repo?.path || !mcp) return { text: "SERVICE_UNAVAILABLE: skill" };
  const [name, ...rest] = args;
  if (typeof name !== "string" || !name) return { text: "Usage: /skill <skill> [args]" };
  let metadata;
  try {
    metadata = await skillMetadata(mcp, name, project);
  } catch (error) {
    return { text: `${error instanceof ClawError ? error.code : "SKILL_METADATA_FAILED"}: Skill metadata is unavailable.` };
  }
  if (!metadata) return { text: `Unknown skill "${name}".` };
  const readOnly = metadata.readOnly === true;
  const created = createJob({
    id: randomBytes(12).toString("hex"),
    type: "skill",
    projectId: project.id,
    readOnly,
  });
  const job = {
    ...created.job,
    skill: name,
    args: rest.join(" "),
    callerId: String(caller?.userId ?? ""),
    createdAt: new Date().toISOString(),
    chatId: chatId ?? null,
    threadId: threadId ?? null,
  };
  store.append(JOBS_STREAM, { kind: "job.created", job });
  if (readOnly) return { text: `Read-only skill job ${job.id} is queued.` };
  const awaiting = transition(job, "awaiting-approval");
  store.append(JOBS_STREAM, awaiting.event);
  return { text: `Skill job ${job.id} is awaiting approval.` };
}

export default Object.freeze({
  name: "skill", aliases: [], args: "<skill> [args]", summary: "Run a Plan Forge skill",
  details: "Run a configured Plan Forge skill.", examples: ["/skill code-review", "/skill test-sweep"],
  roles: [ROLES[0], ROLES[1]], scope: "project", mutating: true,
  available: true, sinceSlice: 9, group: "Work",
  async handle(context, input) {
    try {
      return await prepareSkill({ ...context?.services, project: context?.project }, input);
    } catch (error) {
      return { text: `${error instanceof ClawError ? error.code : "SKILL_FAILED"}: The skill job was not created.` };
    }
  },
});
