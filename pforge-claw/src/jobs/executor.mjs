import { ClawError } from "../errors.mjs";
import { createRunners } from "./runners.mjs";
import { buildLaunch } from "../mcp/project-client.mjs";
import { createAgentRuntime, normalizeRuntimeId } from "../runtime/agent-runtime.mjs";

function projectFor(config, job) {
  return config?.projects?.find((project) => project.id === job?.projectId) ?? null;
}

function callerRole(config, job) {
  return config?.allowlist?.find((entry) => String(entry.userId) === String(job?.callerId))?.role;
}

function selectedRuntime(config, job) {
  return normalizeRuntimeId(projectFor(config, job)?.runtime
    ?? config?.runtimes?.default
    ?? "copilot-sdk");
}

export async function resolveJobRuntime({ job, config, runtimeFactory } = {}) {
  const id = selectedRuntime(config, job);
  const ghcpRoles = config?.policy?.ghcpRoles ?? ["owner"];
  if (id === "copilot-sdk" && !ghcpRoles.includes(callerRole(config, job))) {
    throw new ClawError("RUNTIME_POLICY_DENIED");
  }
  if (typeof runtimeFactory !== "function") throw new ClawError("RUNTIME_BAD_CONTRACT");
  const runtime = await runtimeFactory({ id, job, config, project: projectFor(config, job) });
  if (!runtime || runtime.id !== id || typeof runtime.run !== "function") {
    throw new ClawError("RUNTIME_BAD_CONTRACT");
  }
  return runtime;
}

export function createJobExecutor({
  ctx, clients, runtimeFactory, createSession, jobsFor, workspaceFor,
} = {}) {
  const runtimes = new Map();

  async function runtimeFor(job) {
    const id = selectedRuntime(ctx.config, job);
    if (!runtimes.has(id)) {
      const factory = runtimeFactory ?? ((options) => createAgentRuntime({
        ...options,
        secrets: ctx.secrets,
        createSession,
      }));
      const pending = resolveJobRuntime({ job, config: ctx.config, runtimeFactory: factory });
      runtimes.set(id, pending);
      pending.catch(() => {
        if (runtimes.get(id) === pending) runtimes.delete(id);
      });
    }
    const runtime = await runtimes.get(id);
    const project = projectFor(ctx.config, job);
    const scopedMcp = {
      call: (tool, args) => clients.call(job.projectId, tool, args),
    };
    const runner = createRunners({
      ...ctx,
      runtime,
      mcp: scopedMcp,
      mcpLaunchForWorktree: ({ project: currentProject, cwd }) => buildLaunch({
        ...currentProject,
        repo: { ...currentProject.repo, path: cwd },
        homeLane: "local",
      }, ctx.config, { registry: ctx.registry }),
    }, {
      ...(typeof jobsFor === "function" ? { jobs: jobsFor(job) } : {}),
      ...(typeof workspaceFor === "function" ? { workspace: workspaceFor(job) } : {}),
    });
    return {
      id,
      run: (input, options = {}) => runner.runJob({
        ...input,
        projectId: project?.id ?? input.projectId,
      }, {
        signal: options.signal ?? input.signal,
        emit: options.emit ?? input.emit,
      }),
    };
  }

  return { runtimeFor };
}
