import { ROLES } from "../enums.mjs";
import { ClawError } from "../errors.mjs";
import { preparationFailure, prepareProducer } from "../jobs/c2-job-producer.mjs";

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
  if (isFailedMetadata(result)) throw new ClawError("SKILL_METADATA_FAILED");
  const metadata = parseMetadataResult(result);
  if (isFailedMetadata(metadata)) throw new ClawError("SKILL_METADATA_FAILED");
  if (metadata?.status === "dry-run" && [name, "unknown", ""].includes(metadata.skillName)) {
    return normalizeNativeMetadata(metadata, name);
  }
  const skills = Array.isArray(metadata) ? metadata : metadata?.skills ?? [];
  return skills.find((skill) => skill?.name === name) ?? null;
}

function normalizeNativeMetadata(metadata, name) {
  return { ...metadata, name, readOnly: metadata.skillName === name && metadata.readOnly === true };
}

function isFailedMetadata(result) {
  return result?.isError || result?.ok === false || Boolean(result?.error);
}

async function prepareSkillFields({ mcp, project, name, rest }) {
  let metadata;
  try {
    metadata = await skillMetadata(mcp, name, project);
  } catch (error) {
    return preparationFailure(`${error instanceof ClawError ? error.code : "SKILL_METADATA_FAILED"}: Skill metadata is unavailable.`);
  }
  if (!metadata) return preparationFailure(`Unknown skill "${name}".`);
  return { fields: { skill: name, args: rest.join(" "), readOnly: metadata.readOnly === true } };
}

/** Returns the exact durable job identity/state, or explicit null metadata on every refusal. */
export async function prepareSkill(deps = {}, input = {}) {
  if (!deps.store || !deps.project?.id || !deps.project?.repo?.path || !deps.mcp) {
    return preparationFailure("SERVICE_UNAVAILABLE: skill");
  }
  const args = Array.isArray(input.args) ? input.args : [];
  const [name, ...rest] = args;
  if (typeof name !== "string" || !name.trim() || !rest.every((argument) => typeof argument === "string")) {
    return preparationFailure("Usage: /skill <skill> [args]");
  }
  try {
    return await prepareProducer({ deps, input, type: "skill", label: "Skill" }, ({ project }) => prepareSkillFields({
      mcp: deps.mcp, project, name, rest,
    }));
  } catch (error) {
    return preparationFailure(`${error instanceof ClawError ? error.code : "SKILL_FAILED"}: The skill job was not created.`);
  }
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
      return preparationFailure(`${error instanceof ClawError ? error.code : "SKILL_FAILED"}: The skill job was not created.`);
    }
  },
});
