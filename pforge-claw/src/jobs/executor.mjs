import { ClawError } from "../errors.mjs";
import { createRunners } from "./runners.mjs";
import { buildWorktreeLaunch } from "../mcp/project-client.mjs";
import { createAgentRuntime, resolveJobRuntime, resolveJobRuntimeId } from "../runtime/agent-runtime.mjs";
import { byokProviderReference } from "../runtime/byok.mjs";
import { canonical } from "../protocol/lease-grant.mjs";
import { executionConfigFor, snapshotExecutionChoices } from "./execution-choices.mjs";

export function createJobExecutor({
  ctx, clients, runtimeFactory, createSession, jobsFor, workspaceFor,
} = {}) {
  const runtimes = new Map();

  async function runtimeFor(inputJob) {
    const job = snapshotExecutionChoices(inputJob);
    if (job.runtime !== undefined && !job.leaseGrant) throw new ClawError("RUNTIME_POLICY_DENIED");
    const config = executionConfigFor({ job, config: ctx.config });
    const id = resolveJobRuntimeId({ job, config });
    const cacheKey = canonical({ id, provider: byokProviderReference({ type: id, config }) });
    if (!runtimes.has(cacheKey)) {
      const factory = runtimeFactory ?? ((options) => createAgentRuntime({
        ...options,
        secrets: ctx.secrets,
        createSession,
      }));
      const pending = resolveJobRuntime({ job, config, runtimeFactory: factory });
      runtimes.set(cacheKey, pending);
      pending.catch(() => {
        if (runtimes.get(cacheKey) === pending) runtimes.delete(cacheKey);
      });
    }
    const runtime = await runtimes.get(cacheKey);
    const project = config?.projects?.find((candidate) => candidate.id === job?.projectId) ?? null;
    const scopedMcp = {
      call: (tool, args) => clients.call(job.projectId, tool, args),
    };
    const runner = createRunners({
      ...ctx,
      config,
      runtime,
      mcp: scopedMcp,
      mcpLaunchForWorktree: ({ project: currentProject, cwd, env }) => buildWorktreeLaunch({
        project: currentProject, config, cwd, env, registry: ctx.registry,
      }),
    }, {
      ...(typeof jobsFor === "function" ? { jobs: jobsFor(job) } : {}),
      ...(typeof workspaceFor === "function" ? { workspace: workspaceFor(job) } : {}),
    });
    return {
      id,
      run: (input = {}, options = {}) => runner.runJob({
        ...job,
        projectId: project?.id ?? input.projectId,
      }, {
        signal: options.signal ?? input.signal,
        emit: options.emit ?? input.emit,
      }),
    };
  }

  return { runtimeFor };
}

export { executionConfigFor, resolveJobRuntime };
