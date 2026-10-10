import { ClawError } from "../errors.mjs";
import { buildWorktreeLaunch, connectProject } from "../mcp/project-client.mjs";

async function runnerLaunch({ ctx, project, worktree, env, signal }) {
  if (typeof ctx.mcpLaunchForWorktree === "function") {
    const launch = await ctx.mcpLaunchForWorktree({ project, cwd: worktree, env, signal });
    signal?.throwIfAborted();
    return { ...launch, env: { ...launch.env, ...env } };
  }
  const launch = ctx.mcpLaunch ?? await buildWorktreeLaunch({
    project, config: ctx.config, cwd: worktree, env, registry: ctx.registry,
  });
  return { ...launch, env: { ...launch.env, ...env } };
}

async function launchedClient({ ctx, project, worktree, env, signal, client }) {
  try {
    signal?.throwIfAborted();
    if (typeof client?.call !== "function") throw new ClawError("SERVICE_UNAVAILABLE", { service: "mcp" });
    const launch = await runnerLaunch({ ctx, project, worktree, env, signal });
    signal?.throwIfAborted();
    return { ...client, launch: { ...launch, env: { ...launch.env, ...env } } };
  } catch (error) {
    await closeRunnerMcp(client, ctx);
    throw error;
  }
}

/**
 * Own the executing workspace's MCP transport in its prepared environment.
 * @param {{ctx: object, project: object, worktree: string, env: object, signal?: AbortSignal}} options
 * @returns {Promise<object>}
 */
export async function openRunnerMcp({ ctx, project, worktree, env, signal }) {
  signal?.throwIfAborted();
  if (typeof ctx.projectClients?.forWorktree === "function") {
    return ctx.projectClients.forWorktree({ projectId: project.id, cwd: worktree, env, signal });
  }
  if (typeof ctx.mcp === "function") {
    const client = await ctx.mcp({ projectId: project.id, cwd: worktree, env, signal });
    if (client?.launch && typeof ctx.mcpLaunchForWorktree !== "function") {
      return launchedClient({ ctx: { ...ctx, mcpLaunch: client.launch }, project, worktree, env, signal, client });
    }
    return launchedClient({ ctx, project, worktree, env, signal, client });
  }
  const launch = await runnerLaunch({ ctx, project, worktree, env, signal });
  signal?.throwIfAborted();
  const client = await (ctx.connectProject ?? connectProject)(launch, { redact: ctx.secrets?.redact });
  if (signal?.aborted) {
    await client.close();
    throw new ClawError("JOB_CANCELLED");
  }
  return { ...client, launch };
}

/** Await transport cleanup without hiding the primary execution error. */
export async function closeRunnerMcp(client, ctx) {
  try {
    await client?.close?.();
    return true;
  } catch {
    ctx.logger?.warn?.("Job MCP cleanup failed", { code: "MCP_CLOSE_FAILED" });
    return false;
  }
}
